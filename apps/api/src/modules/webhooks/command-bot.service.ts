import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerIdentityService } from '../customers/customer-identity.service';
import { formatEventDateRange } from '../../common/utils/event-date';
import { decodeCommunityInviteToken } from '../../common/utils/community-invite-token';

interface TelegramMessage {
  text?: string;
  chat: { id: number | string };
  from?: { first_name?: string; username?: string };
}

interface TelegramChatMemberUpdate {
  chat: { id: number | string };
  new_chat_member: { user: { id: number | string }; status: string };
}

const MARKETING_PROMPT_COOLDOWN_MS = 14 * 24 * 3600_000; // 2 weeks

/**
 * Handles inbound Telegram updates for COMMAND-type bots (Tixtron's ticketing bot) — fixed
 * /commands only, no LLM call, no AI-usage billing. Runs synchronously in the webhook request
 * (no queue) since every command is a fast, deterministic DB read.
 *
 * Every interaction links the Telegram chat into the org's unified Customer record (same identity
 * engine AI bots use) — this is what "unique users reached" and Telegram marketing opt-in are
 * built on. Marketing consent is opt-in only: messaging the bot never implies consent by itself.
 */
@Injectable()
export class CommandBotService {
  private readonly logger = new Logger(CommandBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {}

  // Tixtron's own app, not Zuti's dashboard (APP_URL) — see registrations.service.ts's identical note.
  private getPublicAppUrl(): string {
    return (this.config.get<string>('TIXTRON_APP_URL') ?? 'http://localhost:3004').replace(/\/$/, '');
  }

  private async sendMessage(telegramToken: string, chatId: number | string, text: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to send command-bot reply: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A single-use invite link — the standard way a bot gets someone into a channel it admins,
   * since Telegram never lets a bot silently add a user. */
  private async createChannelInviteLink(telegramToken: string, telegramChatId: string): Promise<string | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<any>(`https://api.telegram.org/bot${telegramToken}/createChatInviteLink`, {
          chat_id: telegramChatId,
          member_limit: 1,
        }),
      );
      return res.data?.result?.invite_link ?? null;
    } catch (err: unknown) {
      this.logger.warn(`Failed to create channel invite link: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async handleUpdate(bot: { id: string; organizationId: string; name: string; telegramToken: string | null }, update: any): Promise<void> {
    const message = update?.message as TelegramMessage | undefined;
    if (!message?.chat?.id || !bot.telegramToken) return;

    const text = (message.text ?? '').trim();
    if (!text) return;

    // Link every interaction to the org's unified Customer record — the same identity engine AI
    // bots use. This is what powers "unique users reached" and the marketing opt-in flow below;
    // it is NOT itself consent to be marketed to.
    const customerId = await this.customerIdentity.resolve(
      bot.organizationId,
      [{ type: 'TELEGRAM_CHAT', value: String(message.chat.id), isAnchor: true, source: 'tixtron_command_bot' }],
      { displayName: message.from?.first_name ?? null, seenAt: new Date() },
    ).catch((err: unknown) => {
      this.logger.warn(`Customer link failed for chat ${message.chat.id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });

    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand.replace(/@\w+$/, '').toLowerCase(); // strip "@BotUsername" suffix

    switch (command) {
      case '/start':
        if (args[0]) {
          await this.handleCommunityJoin(bot, message, args[0]);
          await this.logCommand(bot, customerId, 'start_community_join');
          return;
        }
        await this.sendMessage(bot.telegramToken, message.chat.id, this.helpText(bot.name));
        await this.logCommand(bot, customerId, 'start');
        return;
      case '/help':
        await this.sendMessage(bot.telegramToken, message.chat.id, this.helpText(bot.name));
        await this.logCommand(bot, customerId, 'help');
        return;
      case '/events':
        await this.handleEvents(bot, message, customerId);
        await this.logCommand(bot, customerId, 'events');
        return;
      case '/mytickets': {
        const result = await this.handleMyTickets(bot, message, args.join(' '));
        await this.logCommand(bot, customerId, 'mytickets', { result });
        return;
      }
      case '/subscribe':
        await this.handleSubscribe(bot, message, customerId);
        await this.logCommand(bot, customerId, 'subscribe');
        return;
      case '/unsubscribe':
      case '/stop':
        await this.handleUnsubscribe(bot, message, customerId);
        await this.logCommand(bot, customerId, 'unsubscribe');
        return;
      default:
        await this.sendMessage(
          bot.telegramToken,
          message.chat.id,
          `I didn't recognize that command.\n\n${this.helpText(bot.name)}`,
        );
        await this.logCommand(bot, customerId, 'unknown', { raw: command });
    }
  }

  private async logCommand(
    bot: { id: string; organizationId: string },
    customerId: string | null,
    command: string,
    resultMeta?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.commandBotEvent.create({
      data: { botId: bot.id, orgId: bot.organizationId, customerId, command, resultMeta: (resultMeta ?? {}) as any },
    }).catch((err: unknown) => {
      this.logger.warn(`Failed to log command-bot event: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private helpText(botName: string): string {
    return [
      `👋 This is ${botName}, powered by Tixtron.`,
      '',
      'Commands:',
      '/events — see upcoming events',
      '/mytickets your@email.com — look up tickets you’ve registered with this email',
      '/subscribe — get a message here when new events go live',
      '/help — show this message',
    ].join('\n');
  }

  private async handleSubscribe(bot: { telegramToken: string | null }, message: TelegramMessage, customerId: string | null): Promise<void> {
    if (!bot.telegramToken) return;
    if (customerId) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { marketingConsentAt: new Date(), telegramOptOut: false } });
    }
    await this.sendMessage(bot.telegramToken, message.chat.id, 'You\'re subscribed — we\'ll message you here when new events go live. Reply /unsubscribe anytime to stop.');
  }

  private async handleUnsubscribe(bot: { telegramToken: string | null }, message: TelegramMessage, customerId: string | null): Promise<void> {
    if (!bot.telegramToken) return;
    if (customerId) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { telegramOptOut: true, marketingConsentAt: null } });
    }
    await this.sendMessage(bot.telegramToken, message.chat.id, 'You\'re unsubscribed — no more event updates here. Reply /subscribe anytime to turn them back on.');
  }

  /** Handles /start <token> deep-links from a "join our community" CTA on a ticket/receipt.
   * Never adds anyone to a channel directly — always via a single-use invite link they tap
   * themselves, which is what makes this consensual (see CommunityMembership doc comment). */
  private async handleCommunityJoin(bot: { id: string; telegramToken: string | null }, message: TelegramMessage, token: string): Promise<void> {
    if (!bot.telegramToken) return;
    const decoded = decodeCommunityInviteToken(token);
    if (!decoded) {
      await this.sendMessage(bot.telegramToken, message.chat.id, 'That invite link looks invalid — please use the link from your ticket.');
      return;
    }

    const community = await this.prisma.community.findUnique({ where: { id: decoded.communityId } });
    if (!community || !community.isActive || community.botId !== bot.id) {
      await this.sendMessage(bot.telegramToken, message.chat.id, 'This community invite is no longer valid.');
      return;
    }

    const telegramChatId = String(message.chat.id);
    await this.prisma.communityMembership.upsert({
      where: { communityId_telegramChatId: { communityId: community.id, telegramChatId } },
      create: { communityId: community.id, telegramChatId, sourceRegistrationEntryId: decoded.registrationEntryId, status: 'INVITED' },
      update: { status: 'INVITED', sourceRegistrationEntryId: decoded.registrationEntryId ?? undefined },
    });

    const inviteLink = await this.createChannelInviteLink(bot.telegramToken, community.telegramChatId);
    if (!inviteLink) {
      await this.sendMessage(bot.telegramToken, message.chat.id, 'Couldn\'t generate your invite right now — please try the link again in a moment.');
      return;
    }
    await this.sendMessage(bot.telegramToken, message.chat.id, `Tap to join ${community.name}:\n${inviteLink}`);
  }

  /** Telegram's chat_member update — the source of truth for whether an invite link was actually
   * used (or the person later left), since sending a link is not the same as joining. */
  async handleChatMemberUpdate(bot: { id: string }, update: { chat_member?: TelegramChatMemberUpdate }): Promise<void> {
    const cm = update?.chat_member;
    if (!cm?.chat?.id || !cm?.new_chat_member?.user?.id) return;

    const community = await this.prisma.community.findFirst({ where: { botId: bot.id, telegramChatId: String(cm.chat.id) } });
    if (!community) return;

    const telegramChatId = String(cm.new_chat_member.user.id);
    const isMember = ['member', 'administrator', 'creator'].includes(cm.new_chat_member.status);
    await this.prisma.communityMembership.updateMany({
      where: { communityId: community.id, telegramChatId },
      data: isMember ? { status: 'JOINED', joinedAt: new Date() } : { status: 'LEFT', leftAt: new Date() },
    });
  }

  /** Whether to append a /subscribe nudge to a reply: never once they've explicitly answered
   * (yes or no), otherwise at most once every ~2 weeks. */
  private shouldPromptSubscribe(customer: { marketingConsentAt: Date | null; telegramOptOut: boolean; lastMarketingPromptAt: Date | null }): boolean {
    if (customer.marketingConsentAt || customer.telegramOptOut) return false;
    if (!customer.lastMarketingPromptAt) return true;
    return Date.now() - new Date(customer.lastMarketingPromptAt).getTime() >= MARKETING_PROMPT_COOLDOWN_MS;
  }

  private async handleEvents(bot: { organizationId: string; telegramToken: string | null }, message: TelegramMessage, customerId: string | null): Promise<void> {
    if (!bot.telegramToken) return;
    const now = new Date();
    const events = await this.prisma.registrationProduct.findMany({
      where: { orgId: bot.organizationId, isActive: true, isPublic: true, slug: { not: null } },
      orderBy: { eventDate: 'asc' },
      take: 8,
    });
    // Prefer upcoming events but still show undated/ongoing ones if that's all there is.
    const upcoming = events.filter((e) => !e.eventDate || new Date(e.eventDate) >= now);
    const list = (upcoming.length > 0 ? upcoming : events).slice(0, 5);

    if (list.length === 0) {
      await this.sendMessage(bot.telegramToken, message.chat.id, 'No events are open for registration right now — check back soon!');
      return;
    }

    const appUrl = this.getPublicAppUrl();
    const lines = list.map((ev) => {
      const dateStr = ev.eventDate
        ? formatEventDateRange(new Date(ev.eventDate), ev.eventEndDate, ev.eventDateHasTime)
        : null;
      return [
        `🎫 ${ev.name}`,
        dateStr ? `   ${dateStr}` : null,
        ev.venue ? `   📍 ${ev.venue}` : null,
        `   ${appUrl}/e/${ev.slug}`,
      ].filter(Boolean).join('\n');
    });

    let reply = `Upcoming events:\n\n${lines.join('\n\n')}`;

    if (customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { marketingConsentAt: true, telegramOptOut: true, lastMarketingPromptAt: true },
      });
      if (customer && this.shouldPromptSubscribe(customer)) {
        reply += '\n\n💬 Want a heads-up when new events go live? Reply /subscribe (or /unsubscribe if you\'d rather not hear from us).';
        await this.prisma.customer.update({
          where: { id: customerId },
          data: { lastMarketingPromptAt: now, marketingPromptCount: { increment: 1 } },
        }).catch(() => null);
      }
    }

    await this.sendMessage(bot.telegramToken, message.chat.id, reply);
  }

  private async handleMyTickets(bot: { organizationId: string; telegramToken: string | null }, message: TelegramMessage, emailArg: string): Promise<'invalid_email' | 'found' | 'not_found'> {
    if (!bot.telegramToken) return 'invalid_email';
    const email = emailArg.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await this.sendMessage(bot.telegramToken, message.chat.id, 'Send it like this: /mytickets your@email.com');
      return 'invalid_email';
    }

    const entries = await this.prisma.registrationEntry.findMany({
      where: {
        orgId: bot.organizationId,
        customerEmail: { equals: email, mode: 'insensitive' },
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { product: { select: { name: true } } },
    });

    if (entries.length === 0) {
      await this.sendMessage(bot.telegramToken, message.chat.id, `No tickets found for ${email}.`);
      return 'not_found';
    }

    const appUrl = this.getPublicAppUrl();
    const statusLabel: Record<string, string> = {
      CONFIRMED: '✅ Confirmed',
      PENDING_PAYMENT: '⏳ Awaiting payment',
      AWAITING_APPROVAL: '⏳ Awaiting approval',
    };
    const lines = entries.map((e) =>
      [`🎟 ${e.product.name} — ${statusLabel[e.status] ?? e.status}`, `   ${appUrl}/ticket/${e.id}`].join('\n'),
    );

    await this.sendMessage(bot.telegramToken, message.chat.id, `Tickets for ${email}:\n\n${lines.join('\n\n')}`);
    return 'found';
  }
}
