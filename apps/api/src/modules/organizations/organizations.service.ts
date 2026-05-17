import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/organization.dto';
import { ActivityService, ActivityAction } from '../activity/activity.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const slugTaken = await this.prisma.organization.findUnique({ where: { slug: dto.slug } });
    if (slugTaken) throw new ConflictException('Slug already taken');

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        members: {
          create: { userId, role: 'OWNER' },
        },
      },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    return org;
  }

  async findAllForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: { select: { bots: true, conversations: true } },
      },
    });
  }

  async findOne(slug: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { bots: true, conversations: true, knowledgeFiles: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    this.assertMember(org, userId);
    return org;
  }

  async removeMember(orgId: string, requestingUserId: string, targetUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot remove yourself');

    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') throw new ForbiddenException('Cannot remove an owner');

    const requester = await this.prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { name: true, email: true },
    });

    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    });

    await this.activity.log(
      orgId,
      requestingUserId,
      requester?.name ?? requester?.email ?? 'Unknown',
      ActivityAction.MEMBER_REMOVED,
      'member',
      targetUserId,
      { removedUserName: target.user.name ?? target.user.email },
    );
  }

  async listMembers(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMemberRole(orgId: string, requestingUserId: string, targetUserId: string, role: string) {
    const requester = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: requestingUserId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!requester || requester.role !== 'OWNER') {
      throw new ForbiddenException('Only OWNER can change roles');
    }
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot change your own role');

    const updated = await this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      data: { role: role as any },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await this.activity.log(
      orgId,
      requestingUserId,
      requester.user?.name ?? requester.user?.email ?? 'Unknown',
      ActivityAction.MEMBER_ROLE_CHANGED,
      'member',
      targetUserId,
      { newRole: role, targetName: updated.user.name ?? updated.user.email },
    );

    return updated;
  }

  private assertMember(org: { members: { userId: string }[] }, userId: string) {
    const isMember = org.members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Not a member of this organization');
  }

  private async assertRole(orgId: string, userId: string, roles: string[]) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member || !roles.includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Smart agent routing: find the best available agent for a given org + optional topic.
   * Scoring: specialization match → least loaded → first available.
   * Returns null if no agents are available (all offline or all at capacity).
   */
  async findBestAgent(
    orgId: string,
    topic?: string,
    allowedRoles: string[] = ['AGENT'],
  ): Promise<{ userId: string; name: string } | null> {
    const safeRoles = allowedRoles.filter((r) => ['AGENT', 'ADMIN', 'OWNER'].includes(r));
    if (!safeRoles.length) return null;
    const agents = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId, role: { in: safeRoles as any[] }, isAvailable: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!agents.length) return null;

    // Count each agent's current open (non-resolved) conversations
    const withLoad = await Promise.all(
      agents.map(async (a) => {
        const load = await this.prisma.conversation.count({
          where: {
            organizationId: orgId,
            assignedAgentId: a.userId,
            status: { not: 'RESOLVED' as any },
          },
        });
        return { ...a, load };
      }),
    );

    // Filter out agents who are at capacity
    const available = withLoad.filter((a) => a.load < a.maxConcurrentConversations);
    if (!available.length) return null;

    // If a topic is given, prefer agents who list it as a specialization
    let pool = available;
    if (topic) {
      const topicLower = topic.toLowerCase();
      const specialists = available.filter((a) =>
        a.specializations.some(
          (s) => topicLower.includes(s.toLowerCase()) || s.toLowerCase().includes(topicLower),
        ),
      );
      if (specialists.length) pool = specialists;
    }

    // Among the pool, pick the least loaded (tie-break: first in list = longest-tenured)
    const best = pool.sort((a, b) => a.load - b.load)[0];
    return { userId: best.userId, name: best.user.name ?? best.user.email };
  }

  /** Update agent profile fields (specializations, availability, capacity) */
  async updateAgentProfile(
    orgId: string,
    requestingUserId: string,
    targetUserId: string,
    dto: { specializations?: string[]; isAvailable?: boolean; maxConcurrentConversations?: number },
  ) {
    // Agents can update their own profile; OWNER/ADMIN can update any agent
    if (requestingUserId !== targetUserId) {
      await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    }
    // Sanitize specializations: lowercase, max 30 chars each, max 20 tags
    const specializations = dto.specializations
      ?.map((s) => s.trim().toLowerCase().slice(0, 30))
      .filter(Boolean)
      .slice(0, 20);
    return this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      data: {
        ...(specializations !== undefined && { specializations }),
        ...(dto.isAvailable !== undefined && { isAvailable: dto.isAvailable }),
        ...(dto.maxConcurrentConversations !== undefined && {
          maxConcurrentConversations: dto.maxConcurrentConversations,
        }),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }
}
