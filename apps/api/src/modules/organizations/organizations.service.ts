import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreditLedgerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/organization.dto';
import { ActivityService, ActivityAction } from '../activity/activity.service';
import { CREDIT_UNITS_PER_CREDIT } from '../billing/credit-model';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }

    const slugTaken = await this.prisma.organization.findUnique({ where: { slug: dto.slug } });
    if (slugTaken) throw new ConflictException('Slug already taken');

    // Policy: users can create unlimited organizations. Only their first org gets free starter credits.
    const existingMembershipCount = await this.prisma.organizationMember.count({
      where: { userId },
    });
    const starterCreditGrant = existingMembershipCount === 0 ? 100 : 0;
    const starterCreditUnits = starterCreditGrant * CREDIT_UNITS_PER_CREDIT;

    const org = await this.prisma.$transaction(async (tx) => {
      const createdOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          members: {
            create: { userId, role: 'OWNER' },
          },
          billing: {
            create: {
              plan: 'STARTER',
              messageCount: 0,
              // Reusing existing billing capacity fields for startup wallet allocation.
              messageLimit: starterCreditGrant,
              creditBalanceUnits: starterCreditUnits,
              committedMonthlyCreditsUnits: 0,
            },
          },
        },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
          billing: true,
        },
      });

      if (starterCreditGrant > 0 && createdOrg.billing) {
        await tx.creditLedger.create({
          data: {
            organizationId: createdOrg.id,
            billingId: createdOrg.billing.id,
            type: CreditLedgerType.GRANT,
            creditsDeltaUnits: starterCreditUnits,
            balanceAfterUnits: starterCreditUnits,
            description: `Starter credit grant on organization creation (${starterCreditGrant} credits)`,
            idempotencyKey: `org:${createdOrg.id}:starter-credit-grant`,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
            },
          },
        });

        await tx.activityLog.create({
          data: {
            orgId: createdOrg.id,
            actorId: userId,
            actorName: createdOrg.members[0]?.user?.name ?? createdOrg.members[0]?.user?.email ?? 'Organization Owner',
            action: 'BILLING_CREDIT_GRANTED',
            targetType: 'billing',
            targetId: createdOrg.billing.id,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
              balanceAfterCredits: starterCreditGrant,
              balanceAfterUnits: starterCreditUnits,
            },
          },
        });

        await tx.notification.create({
          data: {
            orgId: createdOrg.id,
            type: 'billing_credit_granted',
            title: 'Starter credits granted',
            body: `${starterCreditGrant} starter credits were allocated to this organization.`,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
            },
            targetUserId: null,
          },
        });
      }

      return createdOrg;
    });

    return org;
  }

  async findAllForUser(userId: string) {
    const orgs = await this.prisma.organization.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        billing: {
          select: {
            plan: true,
            messageCount: true,
            messageLimit: true,
            creditBalanceUnits: true,
            committedMonthlyCreditsUnits: true,
            commitmentRenewsAt: true,
            renewsAt: true,
          },
        },
        _count: { select: { bots: true, conversations: true } },
      },
    });

    return orgs.map((org) => ({
      ...org,
      billing: org.billing
        ? {
            ...org.billing,
            creditBalance: Number((org.billing.creditBalanceUnits / 100).toFixed(2)),
            committedMonthlyCredits: Number((org.billing.committedMonthlyCreditsUnits / 100).toFixed(2)),
          }
        : org.billing,
    }));
  }

  async findOne(slug: string, userId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const membership = await this.getMembershipOrThrow(org.id, userId);

    if (membership.role === 'AGENT') {
      return org;
    }

    return this.prisma.organization.findUnique({
      where: { slug },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { bots: true, conversations: true, knowledgeFiles: true } },
      },
    });
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
    await this.getMembershipOrThrow(orgId, requestingUserId);
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

  private async getMembershipOrThrow(orgId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this organization');
    return member;
  }

  private async assertRole(orgId: string, userId: string, roles: string[]) {
    const member = await this.getMembershipOrThrow(orgId, userId);
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

    // Count only actively handled human workloads.
    // PENDING often represents post-resolution states (e.g. awaiting CSAT) and should not consume live capacity.
    const withLoad = await Promise.all(
      agents.map(async (a) => {
        const load = await this.prisma.conversation.count({
          where: {
            organizationId: orgId,
            assignedAgentId: a.userId,
            mode: 'HUMAN',
            status: { in: ['OPEN', 'ESCALATED'] as any[] },
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

  async listContactEndpoints(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.contactEndpoint.findMany({
      where: { orgId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createContactEndpoint(
    orgId: string,
    requestingUserId: string,
    data: {
      label: string;
      channel: 'TELEGRAM' | 'EMAIL';
      destination: string;
      userId?: string | null;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (data.userId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: data.userId } },
      });
      if (!member) throw new NotFoundException('Member not found');
    }

    return this.prisma.contactEndpoint.create({
      data: {
        orgId,
        label: data.label.trim(),
        channel: data.channel,
        destination: data.destination.trim(),
        userId: data.userId ?? null,
        isPrimary: data.isPrimary ?? false,
        metadata: (data.metadata ?? {}) as any,
      },
    });
  }

  async updateContactEndpoint(
    orgId: string,
    requestingUserId: string,
    endpointId: string,
    data: {
      label?: string;
      channel?: 'TELEGRAM' | 'EMAIL';
      destination?: string;
      userId?: string | null;
      isActive?: boolean;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    if (data.userId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: data.userId } },
      });
      if (!member) throw new NotFoundException('Member not found');
    }

    return this.prisma.contactEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(data.label !== undefined && { label: data.label.trim() }),
        ...(data.channel !== undefined && { channel: data.channel }),
        ...(data.destination !== undefined && { destination: data.destination.trim() }),
        ...(data.userId !== undefined && { userId: data.userId }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
        ...(data.metadata !== undefined && { metadata: data.metadata as any }),
      },
    });
  }

  async deleteContactEndpoint(orgId: string, requestingUserId: string, endpointId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    return this.prisma.contactEndpoint.delete({ where: { id: endpointId } });
  }

  async listContactPolicies(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.contactPolicy.findMany({
      where: { orgId },
      orderBy: [{ scope: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        endpoint: true,
        bot: { select: { id: true, name: true } },
      },
    });
  }

  async createContactPolicy(
    orgId: string,
    requestingUserId: string,
    data: {
      name: string;
      scope: 'ORGANIZATION' | 'BOT';
      endpointId?: string | null;
      botId?: string | null;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (data.endpointId) {
      const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: data.endpointId } });
      if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    }
    if (data.botId) {
      const bot = await this.prisma.bot.findUnique({ where: { id: data.botId } });
      if (!bot || bot.organizationId !== orgId) throw new NotFoundException('Bot not found');
    }

    return this.prisma.contactPolicy.create({
      data: {
        orgId,
        name: data.name.trim(),
        scope: data.scope,
        endpointId: data.endpointId ?? null,
        botId: data.scope === 'BOT' ? (data.botId ?? null) : null,
        isDefault: data.isDefault ?? false,
        rules: (data.rules ?? {}) as any,
      },
      include: { endpoint: true, bot: { select: { id: true, name: true } } },
    });
  }

  async updateContactPolicy(
    orgId: string,
    requestingUserId: string,
    policyId: string,
    data: {
      name?: string;
      endpointId?: string | null;
      botId?: string | null;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const policy = await this.prisma.contactPolicy.findUnique({ where: { id: policyId } });
    if (!policy || policy.orgId !== orgId) throw new NotFoundException('Contact policy not found');
    if (data.endpointId) {
      const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: data.endpointId } });
      if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    }
    if (data.botId) {
      const bot = await this.prisma.bot.findUnique({ where: { id: data.botId } });
      if (!bot || bot.organizationId !== orgId) throw new NotFoundException('Bot not found');
    }

    return this.prisma.contactPolicy.update({
      where: { id: policyId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.endpointId !== undefined && { endpointId: data.endpointId }),
        ...(data.botId !== undefined && { botId: data.botId }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.rules !== undefined && { rules: data.rules as any }),
      },
      include: { endpoint: true, bot: { select: { id: true, name: true } } },
    });
  }

  async deleteContactPolicy(orgId: string, requestingUserId: string, policyId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const policy = await this.prisma.contactPolicy.findUnique({ where: { id: policyId } });
    if (!policy || policy.orgId !== orgId) throw new NotFoundException('Contact policy not found');
    return this.prisma.contactPolicy.delete({ where: { id: policyId } });
  }

  private parseLimit(limit?: string, fallback = 50): number {
    if (!limit) return fallback;
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, 200);
  }

  private parsePage(page?: string): number {
    if (!page) return 1;
    const parsed = Number.parseInt(page, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }

  async listActionTasks(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.actionType ? { actionType: query.actionType } : {}),
      ...(query.q
        ? {
            OR: [
              { summary: { contains: query.q, mode: 'insensitive' } },
              { dedupeKey: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.actionTask.count({ where: where as any });

    const items = await this.prisma.actionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        conversation: { select: { id: true, customerName: true, customerEmail: true, channel: true } },
        assignedEndpoint: { select: { id: true, label: true, channel: true, destination: true, isActive: true } },
        routedPolicy: { select: { id: true, name: true, scope: true, isDefault: true } },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listLeads(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { interest: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.lead.count({ where: where as any });

    const items = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: { select: { id: true, actionType: true, status: true, summary: true, createdAt: true } },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listBookings(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { customerName: { contains: query.q, mode: 'insensitive' } },
              { customerEmail: { contains: query.q, mode: 'insensitive' } },
              { preferredDatetime: { contains: query.q, mode: 'insensitive' } },
              { notes: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const prismaAny = this.prisma as any;
    const total = await prismaAny.booking.count({ where: where as any });

    const items = await prismaAny.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: { select: { id: true, actionType: true, status: true, summary: true, createdAt: true } },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listSalesOrders(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { customerName: { contains: query.q, mode: 'insensitive' } },
              { customerEmail: { contains: query.q, mode: 'insensitive' } },
              { product: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.salesOrder.count({ where: where as any });

    const items = await this.prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: { select: { id: true, actionType: true, status: true, summary: true, createdAt: true } },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listTechnicalIssues(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { reporterName: { contains: query.q, mode: 'insensitive' } },
              { reporterEmail: { contains: query.q, mode: 'insensitive' } },
              { summary: { contains: query.q, mode: 'insensitive' } },
              { issueCategory: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.technicalIssue.count({ where: where as any });

    const items = await this.prisma.technicalIssue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: { select: { id: true, actionType: true, status: true, summary: true, createdAt: true } },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }
}
