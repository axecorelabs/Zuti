import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CreateInvitationDto } from './dto/invitation.dto';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async create(requestingUserId: string, dto: CreateInvitationDto) {
    await this.assertRole(dto.orgId, requestingUserId, ['OWNER', 'ADMIN']);

    const org = await this.prisma.organization.findUnique({ where: { id: dto.orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const requester = await this.prisma.user.findUnique({ where: { id: requestingUserId } });

    // If invitee already has an account, check they're not already a member
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      const alreadyMember = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: dto.orgId, userId: existingUser.id } },
      });
      if (alreadyMember) throw new ConflictException('User is already a member');
    }

    // Prevent duplicate pending invites
    const existingInvite = await this.prisma.invitation.findFirst({
      where: { organizationId: dto.orgId, email: dto.email, status: 'PENDING' },
    });
    if (existingInvite) throw new ConflictException('A pending invitation already exists for this email');

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: dto.orgId,
        email: dto.email,
        token,
        role: (dto.role as any) ?? 'AGENT',
        invitedById: requestingUserId,
        expiresAt,
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    await this.mail.sendInvitationEmail({
      to: dto.email,
      orgName: org.name,
      inviterName: requester?.name ?? requester?.email ?? 'A team member',
      inviteUrl: `${appUrl}/invitations/${token}`,
    });

    return invitation;
  }

  async findMine(userEmail: string) {
    // Auto-expire stale invitations
    await this.prisma.invitation.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    return this.prisma.invitation.findMany({
      where: { email: userEmail, status: 'PENDING' },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByOrg(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByToken(token: string) {
    const invite = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invite) throw new NotFoundException('Invitation not found');
    return invite;
  }

  async accept(token: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const invite = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException('Invitation not found');

    if (invite.email !== user.email)
      throw new ForbiddenException('This invitation is not for your account');

    if (invite.status !== 'PENDING')
      throw new BadRequestException(`Invitation is already ${invite.status.toLowerCase()}`);

    if (invite.expiresAt < new Date()) {
      await this.prisma.invitation.update({ where: { token }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('Invitation has expired');
    }

    await this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
      create: { organizationId: invite.organizationId, userId, role: invite.role },
      update: {},
    });

    await this.prisma.invitation.update({ where: { token }, data: { status: 'ACCEPTED' } });
    return { message: 'Invitation accepted' };
  }

  async decline(token: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const invite = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException('Invitation not found');

    if (invite.email !== user.email)
      throw new ForbiddenException('This invitation is not for your account');

    if (invite.status !== 'PENDING')
      throw new BadRequestException(`Invitation is already ${invite.status.toLowerCase()}`);

    await this.prisma.invitation.update({ where: { token }, data: { status: 'DECLINED' } });
    return { message: 'Invitation declined' };
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
