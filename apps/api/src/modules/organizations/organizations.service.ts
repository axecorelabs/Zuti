import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    });
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
    });
    if (!requester || requester.role !== 'OWNER') {
      throw new ForbiddenException('Only OWNER can change roles');
    }
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot change your own role');
    return this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      data: { role: role as any },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
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
}
