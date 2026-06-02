import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { CreateInvitationDto, CreateJoinCodeDto, RedeemJoinCodeDto } from './dto/invitation.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService, ActivityAction } from '../activity/activity.service';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  async create(requestingUserId: string, dto: CreateInvitationDto) {
    await this.assertRole(dto.orgId, requestingUserId, ['OWNER', 'ADMIN']);

    const normalizedInviteEmail = dto.email.trim().toLowerCase();

    const org = await this.prisma.organization.findUnique({ where: { id: dto.orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const requester = await this.prisma.user.findUnique({ where: { id: requestingUserId } });

    // If invitee already has an account, check they're not already a member
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedInviteEmail,
          mode: 'insensitive',
        },
      },
    });
    if (existingUser) {
      const alreadyMember = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: dto.orgId, userId: existingUser.id } },
      });
      if (alreadyMember) throw new ConflictException('User is already a member');
    }

    // Prevent duplicate pending invites
    const existingInvite = await this.prisma.invitation.findFirst({
      where: {
        organizationId: dto.orgId,
        status: 'PENDING',
        email: {
          equals: normalizedInviteEmail,
          mode: 'insensitive',
        },
      },
    });
    if (existingInvite) throw new ConflictException('A pending invitation already exists for this email');

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: dto.orgId,
        email: normalizedInviteEmail,
        token,
        role: (dto.role as any) ?? 'AGENT',
        invitedById: requestingUserId,
        expiresAt,
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    try {
      await this.mail.sendInvitationEmail({
        to: normalizedInviteEmail,
        orgName: org.name,
        inviterName: requester?.name ?? requester?.email ?? 'A team member',
        inviteUrl: `${appUrl}/invitations/${token}`,
      });
    } catch (err) {
      // If email fails, delete the invitation since the invitee won't receive it
      await this.prisma.invitation.delete({ where: { id: invitation.id } });
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Failed to send invitation email: ${msg}`);
    }

    // Activity log
    await this.activity.log(
      dto.orgId,
      requestingUserId,
      requester?.name ?? requester?.email ?? 'Unknown',
      ActivityAction.INVITATION_SENT,
      'invitation',
      invitation.id,
      { email: normalizedInviteEmail, role: invitation.role },
    );

    return invitation;
  }

  async findMine(userEmail: string) {
    const normalizedUserEmail = userEmail.trim().toLowerCase();

    // Auto-expire stale invitations
    await this.prisma.invitation.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const invites = await this.prisma.invitation.findMany({
      where: {
        status: 'PENDING',
        email: {
          equals: normalizedUserEmail,
          mode: 'insensitive',
        },
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.log(
      `findMine lookup email=${normalizedUserEmail} pendingInvites=${invites.length}`,
    );

    return invites;
  }

  async findMineDebug(userEmail: string) {
    const normalizedUserEmail = userEmail.trim().toLowerCase();

    const invites = await this.prisma.invitation.findMany({
      where: {
        status: 'PENDING',
        email: {
          equals: normalizedUserEmail,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      inputEmail: userEmail,
      normalizedEmail: normalizedUserEmail,
      pendingCount: invites.length,
      invites,
    };
  }

  async findByOrg(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.invitation.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createJoinCode(requestingUserId: string, dto: CreateJoinCodeDto) {
    await this.assertWorkspaceAccessManager(dto.orgId, requestingUserId);

    const user = await this.prisma.user.findUnique({ where: { id: requestingUserId } });
    if (!user) throw new NotFoundException('User not found');

    const org = await this.prisma.organization.findUnique({ where: { id: dto.orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const joinId = this.generateJoinId();
    const code = this.generateJoinCode();
    const expiresInHours = dto.expiresInHours ?? 72;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const created = await this.prisma.workspaceJoinCode.create({
      data: {
        organizationId: dto.orgId,
        joinId,
        codeHash: this.hashJoinCode(code),
        role: (dto.role as any) ?? 'AGENT',
        createdById: requestingUserId,
        expiresAt,
      },
      select: {
        id: true,
        organizationId: true,
        joinId: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    await this.activity.log(
      dto.orgId,
      requestingUserId,
      user.name ?? user.email,
      ActivityAction.INVITATION_SENT,
      'workspace_join_code',
      created.id,
      { joinId: created.joinId, role: created.role, expiresAt: created.expiresAt },
    );

    return {
      ...created,
      code,
    };
  }

  async listJoinCodesByOrg(orgId: string, requestingUserId: string) {
    await this.assertWorkspaceAccessManager(orgId, requestingUserId);

    const now = new Date();
    return this.prisma.workspaceJoinCode.findMany({
      where: {
        organizationId: orgId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        joinId: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async redeemJoinCode(userId: string, dto: RedeemJoinCodeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const joinId = dto.joinId.trim().toUpperCase();
    const code = dto.code.trim();
    const invite = await this.prisma.workspaceJoinCode.findUnique({ where: { joinId } });
    if (!invite) throw new NotFoundException('Join ID or code is invalid');

    if (invite.consumedAt) {
      throw new BadRequestException('This join code has already been used');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('This join code has expired');
    }

    if (!this.matchesJoinCode(code, invite.codeHash)) {
      throw new BadRequestException('Join ID or code is invalid');
    }

    const alreadyMember = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
    });
    if (alreadyMember) {
      throw new ConflictException('You are already a member of this workspace');
    }

    await this.prisma.organizationMember.create({
      data: {
        organizationId: invite.organizationId,
        userId,
        role: invite.role,
      },
    });

    await this.prisma.workspaceJoinCode.update({
      where: { id: invite.id },
      data: {
        consumedAt: new Date(),
        consumedById: userId,
      },
    });

    await this.notifications.createOrgNotification(
      invite.organizationId,
      'member_joined',
      `${user.name ?? user.email} joined the workspace`,
      `${user.name ?? user.email} joined via one-time code as ${invite.role}.`,
      { userId: user.id, role: invite.role, joinId: invite.joinId },
    );

    await this.activity.log(
      invite.organizationId,
      user.id,
      user.name ?? user.email,
      ActivityAction.MEMBER_JOINED,
      'member',
      user.id,
      { role: invite.role, joinId: invite.joinId, source: 'one_time_code' },
    );

    await this.markSetupRequestAsContactedOnMembership(
      invite.createdById,
      userId,
    );

    const org = await this.prisma.organization.findUnique({
      where: { id: invite.organizationId },
      select: { id: true, slug: true, name: true },
    });

    return {
      message: 'Workspace joined successfully',
      organization: org,
      role: invite.role,
    };
  }

  async revokeJoinCode(joinIdParam: string, requestingUserId: string) {
    const joinId = joinIdParam.trim().toUpperCase();
    const invite = await this.prisma.workspaceJoinCode.findUnique({ where: { joinId } });
    if (!invite) throw new NotFoundException('Join code not found');

    await this.assertWorkspaceAccessManager(invite.organizationId, requestingUserId);

    if (invite.consumedAt) {
      throw new BadRequestException('Join code has already been used');
    }

    await this.prisma.workspaceJoinCode.update({
      where: { id: invite.id },
      data: { expiresAt: new Date() },
    });

    return { message: 'Join code revoked' };
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

    const invite = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!invite) throw new NotFoundException('Invitation not found');

    if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase())
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

    // Notify OWNER/ADMIN that a member joined
    await this.notifications.createOrgNotification(
      invite.organizationId,
      'member_joined',
      `${user.name ?? user.email} joined the workspace`,
      `${user.name ?? user.email} accepted an invitation and joined as ${invite.role}.`,
      { userId: user.id, role: invite.role },
    );

    // Activity log
    await this.activity.log(
      invite.organizationId,
      user.id,
      user.name ?? user.email,
      ActivityAction.MEMBER_JOINED,
      'member',
      user.id,
      { role: invite.role },
    );

    await this.markSetupRequestAsContactedOnMembership(
      invite.invitedById,
      userId,
    );

    try {
      const managers = await this.prisma.organizationMember.findMany({
        where: {
          organizationId: invite.organizationId,
          role: { in: ['OWNER', 'ADMIN'] },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      const recipients = new Map<string, { name?: string | null }>();
      if (invite.invitedBy?.email) {
        recipients.set(invite.invitedBy.email, { name: invite.invitedBy.name });
      }
      managers.forEach((member) => {
        if (member.user?.email) {
          recipients.set(member.user.email, { name: member.user.name });
        }
      });

      await Promise.allSettled(
        Array.from(recipients.entries()).map(([email, meta]) =>
          this.mail.sendInvitationStatusEmail({
            to: email,
            recipientName: meta.name ?? undefined,
            inviteeNameOrEmail: user.name ?? user.email,
            workspaceName: invite.organization.name,
            status: 'ACCEPTED',
          }),
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to send invitation accepted status emails: ${msg}`);
    }

    return { message: 'Invitation accepted' };
  }

  async decline(token: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const invite = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!invite) throw new NotFoundException('Invitation not found');

    if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase())
      throw new ForbiddenException('This invitation is not for your account');

    if (invite.status !== 'PENDING')
      throw new BadRequestException(`Invitation is already ${invite.status.toLowerCase()}`);

    await this.prisma.invitation.update({ where: { token }, data: { status: 'DECLINED' } });

    try {
      const managers = await this.prisma.organizationMember.findMany({
        where: {
          organizationId: invite.organizationId,
          role: { in: ['OWNER', 'ADMIN'] },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      const recipients = new Map<string, { name?: string | null }>();
      if (invite.invitedBy?.email) {
        recipients.set(invite.invitedBy.email, { name: invite.invitedBy.name });
      }
      managers.forEach((member) => {
        if (member.user?.email) {
          recipients.set(member.user.email, { name: member.user.name });
        }
      });

      await Promise.allSettled(
        Array.from(recipients.entries()).map(([email, meta]) =>
          this.mail.sendInvitationStatusEmail({
            to: email,
            recipientName: meta.name ?? undefined,
            inviteeNameOrEmail: user.name ?? user.email,
            workspaceName: invite.organization.name,
            status: 'DECLINED',
          }),
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to send invitation declined status emails: ${msg}`);
    }

    return { message: 'Invitation declined' };
  }

  /** OWNER/ADMIN cancels an invitation they sent */
  async revoke(token: string, requestingUserId: string) {
    const invite = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException('Invitation not found');

    if (invite.status !== 'PENDING')
      throw new BadRequestException(`Invitation is already ${invite.status.toLowerCase()}`);

    // Must be OWNER or ADMIN of the org that sent the invite
    await this.assertRole(invite.organizationId, requestingUserId, ['OWNER', 'ADMIN']);

    await this.prisma.invitation.update({ where: { token }, data: { status: 'DECLINED' } });
    return { message: 'Invitation revoked' };
  }

  private async assertRole(orgId: string, userId: string, roles: string[]) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member || !roles.includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private async assertWorkspaceAccessManager(orgId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: { role: true },
    });

    if (!member) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (member.role === 'OWNER' || member.role === 'ADMIN') {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { canCreateWorkspace: true },
    });

    if (user?.canCreateWorkspace) {
      return;
    }

    throw new ForbiddenException('Insufficient permissions');
  }

  private generateJoinId() {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  private generateJoinCode() {
    const numeric = Number.parseInt(randomBytes(4).toString('hex').slice(0, 8), 16);
    return String((numeric % 900000) + 100000);
  }

  private hashJoinCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private matchesJoinCode(code: string, expectedHash: string) {
    const actual = Buffer.from(this.hashJoinCode(code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  private async markSetupRequestAsContactedOnMembership(
    managerId: string | null,
    requesterId: string,
  ) {
    if (!managerId || !requesterId) return;

    const request = await this.prisma.workspaceSetupRequest.findFirst({
      where: {
        managerId,
        requesterId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { name: true, email: true } },
        manager: { select: { name: true, email: true } },
      },
    });

    if (!request) return;

    const updated = await this.prisma.workspaceSetupRequest.update({
      where: { id: request.id },
      data: { status: 'CONTACTED' },
      include: {
        requester: { select: { name: true, email: true } },
        manager: { select: { name: true, email: true } },
      },
    });

    const requesterNameOrEmail = updated.requester.name ?? updated.requester.email;
    const managerNameOrEmail = updated.manager.name ?? updated.manager.email;

    if (updated.manager.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.manager.email,
        recipientRole: 'MANAGER',
        recipientName: updated.manager.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'CONTACTED',
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to send manager contacted status email: ${msg}`);
      });
    }

    if (updated.requester.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.requester.email,
        recipientRole: 'REQUESTER',
        recipientName: updated.requester.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'CONTACTED',
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to send requester contacted status email: ${msg}`);
      });
    }
  }
}
