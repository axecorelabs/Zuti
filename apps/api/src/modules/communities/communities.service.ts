import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerIdentityService } from '../customers/customer-identity.service';
import { CreateCommunityDto, UpdateCommunityDto } from './dto/community.dto';
import { encodeCommunityInviteToken } from '../../common/utils/community-invite-token';

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {}

  async create(orgId: string, dto: CreateCommunityDto) {
    const bot = await this.prisma.bot.findFirst({ where: { id: dto.botId, organizationId: orgId } });
    if (!bot) throw new NotFoundException('Bot not found for this organization');
    if (!bot.telegramToken) throw new BadRequestException('Connect a Telegram bot before setting up a community');

    try {
      return await this.prisma.community.create({
        data: {
          orgId,
          botId: dto.botId,
          telegramChatId: dto.telegramChatId,
          telegramChatUsername: dto.telegramChatUsername,
          name: dto.name,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('This organization already has a community set up');
      }
      throw error;
    }
  }

  async findForOrg(orgId: string) {
    const community = await this.prisma.community.findUnique({
      where: { orgId },
      include: { _count: { select: { memberships: { where: { status: 'JOINED' } } } } },
    });
    if (!community) return null;
    const { _count, ...rest } = community;
    return { ...rest, memberCount: _count.memberships };
  }

  /** Used by other modules (e.g. registrations) to decide whether to render a join-community CTA. */
  async findActiveForOrg(orgId: string) {
    return this.prisma.community.findFirst({ where: { orgId, isActive: true } });
  }

  /** The single platform-wide community (orgId: null) — spans ticket buyers across every organizer. */
  async findPlatformCommunity() {
    return this.prisma.community.findFirst({ where: { orgId: null, isActive: true } });
  }

  /** A generic (not tied to any purchase) invite into the platform community — for landing-page
   * "join our community" CTAs, where the visitor may not have bought a ticket at all. Same
   * bot-first, single-use-invite mechanism as the post-purchase flow (see command-bot.service.ts),
   * just with no sourceRegistrationEntryId to attach. */
  async getPlatformJoinLink(): Promise<{ deepLink: string; communityName: string } | null> {
    const community = await this.findPlatformCommunity();
    if (!community) return null;
    const bot = await this.prisma.bot.findUnique({ where: { id: community.botId }, select: { telegramUsername: true } });
    if (!bot?.telegramUsername) return null;
    const token = encodeCommunityInviteToken({ communityId: community.id, registrationEntryId: null });
    return { deepLink: `https://t.me/${bot.telegramUsername}?start=${token}`, communityName: community.name };
  }

  /** Tixtron's own email list — shared by the post-purchase ticket-page opt-in AND a cold
   * landing-page signup, since both are the same action (fresh, explicit consent to a new
   * purpose), just reached from different starting points. Scoped to the internal Tixtron org,
   * same consent primitives every org already has. */
  async optInEmail(email: string, displayName?: string | null): Promise<void> {
    const internalOrg = await this.prisma.organization.findFirst({ where: { isInternal: true }, select: { id: true } });
    if (!internalOrg) throw new BadRequestException('Tixtron has not set up its own organization yet');

    const customerId = await this.customerIdentity.resolve(
      internalOrg.id,
      [{ type: 'EMAIL', value: email, isAnchor: true, source: 'tixtron_email_optin' }],
      { displayName: displayName ?? null, email, minLifecycle: 'LEAD', seenAt: new Date() },
    );
    await this.prisma.customer.update({ where: { id: customerId }, data: { marketingConsentAt: new Date(), emailOptOut: false } });
  }

  async update(orgId: string, communityId: string, dto: UpdateCommunityDto) {
    await this.assertOwnership(orgId, communityId);
    return this.prisma.community.update({ where: { id: communityId }, data: dto });
  }

  async remove(orgId: string, communityId: string) {
    await this.assertOwnership(orgId, communityId);
    await this.prisma.community.delete({ where: { id: communityId } });
    return { success: true };
  }

  private async assertOwnership(orgId: string, communityId: string): Promise<void> {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community || community.orgId !== orgId) throw new NotFoundException('Community not found');
  }
}
