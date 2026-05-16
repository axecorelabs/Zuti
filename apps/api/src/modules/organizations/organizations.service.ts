import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto, InviteMemberDto } from './dto/organization.dto';

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
      include: { _count: { select: { bots: true, conversations: true } } },
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

  async inviteMember(orgId: string, requestingUserId: string, dto: InviteMemberDto) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('No user with that email');

    const existing = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    });
    if (existing) throw new ConflictException('User is already a member');

    return this.prisma.organizationMember.create({
      data: { organizationId: orgId, userId: user.id, role: 'AGENT' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async removeMember(orgId: string, requestingUserId: string, targetUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot remove yourself');
    return this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
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
