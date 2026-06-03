import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import * as React from 'react';
import { BotReplyEmail } from '../mail/templates/BotReplyEmail';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService, ActivityAction } from '../activity/activity.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TeamChatService } from '../team-chat/team-chat.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { BillingService } from '../billing/billing.service';
import { sendWhatsAppText } from '../../common/utils/whatsapp';

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
  assignedAgentId?: string;
  q?: string;
  searchScope?: 'conversation' | 'all';
  messageSearchDays?: number;
  limit?: number;
  cursor?: string;
  /** When set, only return conversations assigned to this agent or unassigned */
  agentId?: string;
}

interface FindOneOptions {
  messageLimit?: number;
  before?: string;
  includeContext?: boolean;
}

interface StartInternalConversationInput {
  botId: string;
  customerEmail: string;
  customerName?: string;
  subject?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
  sourceActionTaskId?: string;
  sourceConversationId?: string;
  allowExternalDelivery?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function toTitleWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function buildBrandedFromName(
  organizationName: string | null | undefined,
  replyToEmail: string | null | undefined,
  fallback: string,
): string {
  const org = (organizationName ?? '').trim();
  const localPart = (replyToEmail ?? '').split('@')[0] ?? '';
  const prefix = toTitleWords(localPart);

  if (org && prefix) return `${org} ${prefix}`;
  if (org) return org;
  return fallback;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly teamChat: TeamChatService,
    private readonly aiUsage: AiUsageService,
    private readonly billing: BillingService,
    @Inject(forwardRef(() => OrganizationsService))
    private readonly orgs: OrganizationsService,
  ) {}

  async findAll(organizationId: string, filters: FindAllFilters) {
    const andClauses: any[] = [];

    const parsedLimit = Number.isFinite(filters.limit)
      ? Math.min(Math.max(Number(filters.limit), 1), 100)
      : undefined;
    const isPaginated = parsedLimit !== undefined || Boolean(filters.cursor);

    if (filters.cursor) {
      const [rawTimestamp, rawId] = filters.cursor.split('|');
      const cursorDate = new Date(rawTimestamp);
      if (!Number.isNaN(cursorDate.getTime()) && rawId) {
        andClauses.push({
          OR: [
            { lastMessageAt: { lt: cursorDate } },
            { AND: [{ lastMessageAt: cursorDate }, { id: { lt: rawId } }] },
          ],
        });
      }
    }

    if (filters.agentId) {
      andClauses.push({
        OR: [
          { assignedAgentId: filters.agentId },
          { assignedAgentId: null },
        ],
      });
    }

    if (filters.assignedAgentId) {
      andClauses.push(
        filters.assignedAgentId === 'unassigned'
          ? { assignedAgentId: null }
          : { assignedAgentId: filters.assignedAgentId },
      );
    }

    if (filters.q?.trim()) {
      const q = filters.q.trim();
      const searchTerms: any[] = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerUsername: { contains: q, mode: 'insensitive' } },
      ];
      if ((filters.searchScope ?? 'conversation') === 'all' && q.length >= 3) {
        const messageSearchDays = Number.isFinite(filters.messageSearchDays)
          ? Math.min(Math.max(Number(filters.messageSearchDays), 1), 90)
          : 30;
        const cutoff = new Date(Date.now() - messageSearchDays * 24 * 60 * 60 * 1000);
        searchTerms.push({
          messages: {
            some: {
              content: { contains: q, mode: 'insensitive' },
              createdAt: { gte: cutoff },
            },
          },
        });
      }
      andClauses.push({
        OR: searchTerms,
      });
    }

    const rows = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        ...(filters.status && { status: filters.status as any }),
        ...(filters.mode && { mode: filters.mode as any }),
        ...(filters.botId && { botId: filters.botId }),
        ...(andClauses.length > 0 && { AND: andClauses }),
      },
      include: {
        bot: { select: { id: true, name: true, telegramUsername: true } },
        assignedAgent: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      ...(parsedLimit ? { take: parsedLimit + 1 } : {}),
    });

    if (!isPaginated) return rows;

    const limit = parsedLimit ?? 30;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last?.lastMessageAt
      ? `${last.lastMessageAt.toISOString()}|${last.id}`
      : null;

    return {
      items,
      hasMore,
      nextCursor,
    };
  }

  async findOne(organizationId: string, conversationId: string, agentId?: string, options?: FindOneOptions) {
    const where: Record<string, unknown> = { id: conversationId, organizationId };
    if (agentId) {
      // AGENT: must be assigned to this conversation or it must be unassigned
      (where as any).OR = [
        { assignedAgentId: agentId },
        { assignedAgentId: null },
      ];
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: where as any,
      include: {
        bot: { select: { id: true, name: true, telegramUsername: true } },
        assignedAgent: { select: { id: true, name: true, email: true } },
        escalations: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const messageLimit = Number.isFinite(options?.messageLimit)
      ? Math.min(Math.max(Number(options?.messageLimit), 1), 100)
      : 50;
    const beforeDate = options?.before ? new Date(options.before) : null;
    const messageRows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(beforeDate && !Number.isNaN(beforeDate.getTime())
          ? { createdAt: { lt: beforeDate } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: messageLimit + 1,
      include: {
        attachments: {
          select: {
            id: true,
            kind: true,
            storageKey: true,
            url: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            durationSec: true,
            caption: true,
          },
        },
      },
    });
    const hasMoreMessages = messageRows.length > messageLimit;
    const pagedRows = hasMoreMessages ? messageRows.slice(0, messageLimit) : messageRows;
    const messages = [...pagedRows].reverse();
    const oldestLoaded = messages[0]?.createdAt;

    const includeContext = options?.includeContext === true;
    const prevCustomerWhere = conversation.telegramChatId
      ? { telegramChatId: conversation.telegramChatId }
      : conversation.customerEmail
        ? { customerEmail: conversation.customerEmail }
        : null;

    const [previousConversations, escalationHistory] = includeContext
      ? await Promise.all([
        prevCustomerWhere ? this.prisma.conversation.findMany({
          where: {
            organizationId,
            ...prevCustomerWhere,
            NOT: { id: conversation.id },
          },
          include: {
            bot: { select: { id: true, name: true, telegramUsername: true } },
            assignedAgent: { select: { id: true, name: true, email: true } },
            _count: { select: { messages: true } },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
        }) : Promise.resolve([]),
        this.prisma.activityLog.findMany({
          where: {
            orgId: organizationId,
            targetType: 'conversation',
            targetId: conversation.id,
            action: {
              in: [
                ActivityAction.CONVERSATION_ESCALATED,
                ActivityAction.CONVERSATION_ASSIGNED,
                ActivityAction.AGENT_TOOK_OVER,
                ActivityAction.CONVERSATION_RESOLVED,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
      ])
      : [undefined, undefined];

    return {
      ...conversation,
      messages,
      messagePage: {
        limit: messageLimit,
        hasMore: hasMoreMessages,
        nextBefore: hasMoreMessages && oldestLoaded ? oldestLoaded.toISOString() : null,
      },
      ...(includeContext
        ? {
            previousConversations,
            escalationHistory,
          }
        : {}),
    };
  }

  async update(
    organizationId: string,
    conversationId: string,
    dto: { status?: string; mode?: string; assignedAgentId?: string; escalationTopic?: string },
    actorId: string,
    actorRole?: string,
  ) {
    const where: Record<string, unknown> = { id: conversationId, organizationId };
    if (actorRole === 'AGENT') {
      // AGENT can only update conversations assigned to them or unassigned
      (where as any).OR = [
        { assignedAgentId: actorId },
        { assignedAgentId: null },
      ];
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: where as any,
      include: { bot: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Resolve actor name for logging
    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } })
      : null;
    const actorName = actor?.name ?? actor?.email ?? 'Unknown';
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    const existingMetadata =
      conversation.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    const isInternalOnly = existingMetadata.internalOnly === true;
    const allowExternalDelivery = isInternalOnly
      ? existingMetadata.allowExternalDelivery !== false
      : true;
    const canSendExternalEmail = conversation.channel === 'EMAIL' && (!isInternalOnly || allowExternalDelivery);
    const canSendExternalWhatsApp = conversation.channel === 'WHATSAPP' && (!isInternalOnly || allowExternalDelivery);

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.status && { status: dto.status as any }),
        ...(dto.mode && { mode: dto.mode as any }),
        ...(dto.status === 'RESOLVED'
          ? { metadata: { ...existingMetadata, awaitingCsat: false } }
          : {}),
        // When switching to HUMAN mode, auto-assign the actor if no one is assigned yet
        ...(dto.mode === 'HUMAN' && conversation.mode !== 'HUMAN' && !conversation.assignedAgentId
          ? { assignedAgentId: actorId }
          // When handing back to AI, clear the assigned agent
          : dto.mode === 'AI' && conversation.mode !== 'AI'
            ? { assignedAgentId: null }
            : dto.assignedAgentId !== undefined
              ? { assignedAgentId: dto.assignedAgentId }
              : {}),
      },
      include: {
        bot: { select: { id: true, name: true } },
        assignedAgent: { select: { id: true, name: true, email: true } },
      },
    });

    const token = conversation.bot.telegramToken;
    const chatId = conversation.telegramChatId;

    // Helper: send a plain-text notification email to the customer
    const sendCustomerEmail = async (text: string) => {
      if (!canSendExternalEmail) return;
      const emailApiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
      const baseFromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
      const fromName = buildBrandedFromName(organization?.name, conversation.bot.emailAddress, baseFromName);
      if (!emailApiKey || !conversation.bot.emailAddress || !conversation.customerEmail) return;
      const botEmail = conversation.bot.emailAddress;
      const botDomain = botEmail.split('@')[1] ?? '';
      const orgSlug = botDomain.replace(/\.bords\.app$/, '');
      const fromAddress = orgSlug && orgSlug !== botDomain
        ? `${orgSlug}@bords.app`
        : (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app');
      const mimeHeaders: Record<string, string> = (conversation as any).emailThreadId
        ? { 'In-Reply-To': `<${(conversation as any).emailThreadId}>`, References: `<${(conversation as any).emailThreadId}>` }
        : {};
      await firstValueFrom(
        this.http.post(
          'https://api.zeptomail.com/v1.1/email',
          {
            from: { address: fromAddress, name: fromName },
            reply_to: [{ address: botEmail }],
            to: [{ email_address: { address: conversation.customerEmail } }],
            subject: `Re: ${(conversation as any).emailSubject ?? 'Your enquiry'}`,
            textbody: text,
            htmlbody: `<p style="font-family:sans-serif;font-size:14px;color:#333;">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
            ...(Object.keys(mimeHeaders).length > 0 ? { mime_headers: mimeHeaders } : {}),
          },
          { headers: { Authorization: `Zoho-enczapikey ${emailApiKey}`, 'Content-Type': 'application/json' } },
        ),
      ).catch(() => null);
    };

    // Helper: send a widget notification message (visible to customer in the widget)
    const sendWidgetMessage = async (text: string) => {
      if (conversation.channel !== 'WIDGET') return;
      const msg = await this.prisma.message.create({
        data: { conversationId, role: 'ASSISTANT', content: text },
      });
      this.events.emitNewMessage(organizationId, {
        conversationId,
        message: { id: msg.id, role: msg.role, content: msg.content, createdAt: msg.createdAt },
      });
    };

    const sendCustomerWhatsApp = async (text: string) => {
      if (!canSendExternalWhatsApp) return;
      const target = conversation.whatsappPhoneNumber ?? conversation.whatsappUserId;
      if (!target) return;
      await sendWhatsAppText(this.http, {
        provider: conversation.bot.whatsappProvider,
        channelIdentifier: conversation.bot.whatsappChannelIdentifier,
        phoneNumber: conversation.bot.whatsappPhoneNumber,
        config: conversation.bot.whatsappConfig,
      }, target, text).catch(() => null);
    };

    // Agent takes over from AI
    if (dto.mode === 'HUMAN' && conversation.mode !== 'HUMAN') {
      if (token && chatId) {
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: '👤 You have been connected to a support agent. We will be with you shortly.',
          }),
        ).catch(() => null);
      }
      await sendCustomerEmail('You have been connected to a support agent. We will be with you shortly.');
      await sendCustomerWhatsApp('You have been connected to a support agent. We will be with you shortly.');
      await sendWidgetMessage('You have been connected to a support agent. We will be with you shortly.');

      await Promise.all([
        this.activity.log(
          organizationId, actorId, actorName,
          ActivityAction.AGENT_TOOK_OVER,
          'conversation', conversationId,
          { previousMode: 'AI' },
        ),
        this.notifications.createOrgNotification(
          organizationId,
          'agent_took_over',
          `${actorName} took over a conversation`,
          `${actorName} switched conversation to human mode and is now handling it.`,
          { conversationId, actorId },
        ),
      ]);

      // Fire-and-forget: generate AI handoff summary in the background
      this.generateHandoffSummary(organizationId, conversationId).catch(() => null);
    }

    // Agent hands back to AI
    if (dto.mode === 'AI' && conversation.mode !== 'AI') {
      if (token && chatId) {
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: '🤖 You\'ve been reconnected to our AI assistant. Feel free to continue the conversation.',
          }),
        ).catch(() => null);
      }
      await sendCustomerEmail('You\'ve been reconnected to our AI assistant. Feel free to reply to this email if you need further help.');
      await sendCustomerWhatsApp('You\'ve been reconnected to our AI assistant. Feel free to continue the conversation.');
      await sendWidgetMessage('You\'ve been reconnected to our AI assistant. Feel free to continue the conversation.');

      await this.activity.log(
        organizationId, actorId, actorName,
        ActivityAction.HANDED_BACK_TO_AI,
        'conversation', conversationId,
        { previousMode: 'HUMAN' },
      );
    }

    // Conversation escalated
    if (dto.status === 'ESCALATED' && conversation.status !== 'ESCALATED') {
      const escalation = await this.prisma.escalation.create({
        data: {
          conversationId,
          reason: dto.escalationTopic ?? null,
          triggeredBy: 'AGENT_MANUAL',
        },
      });

      // Smart-route using the bot's allowed roles (default: AGENT only)
      const routeToRoles: string[] =
        Array.isArray((conversation.bot as any).routeToRoles) &&
        (conversation.bot as any).routeToRoles.length > 0
          ? (conversation.bot as any).routeToRoles
          : ['AGENT'];
      const bestAgent = await this.orgs.findBestAgent(organizationId, dto.escalationTopic, routeToRoles);
      const assignedTo = bestAgent ?? null;

      if (assignedTo) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { assignedAgentId: assignedTo.userId },
        });

        // Notify the assigned agent personally
        await this.notifications.createUserNotification(
          organizationId,
          assignedTo.userId,
          'conversation_assigned',
          'New conversation assigned to you',
          `A${dto.escalationTopic ? ` ${dto.escalationTopic}` : ''} support conversation has been routed to you.`,
          { conversationId, topic: dto.escalationTopic },
        );

        const latestUserMessage = await this.prisma.message.findFirst({
          where: { conversationId, role: 'USER' },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        });

        await this.teamChat.createEscalationThread(organizationId, {
          conversationId,
          escalationId: escalation.id,
          assignedUserId: assignedTo.userId,
          topic: dto.escalationTopic ?? null,
          question: latestUserMessage?.content ?? dto.escalationTopic ?? 'A customer conversation needs specialist review.',
          senderId: actorId,
          metadata: {
            source: 'manual_escalation',
            actorId,
          },
        });
      }

      // Telegram message to customer — plain text (no parse_mode) avoids injection
      const agentLabel = assignedTo
        ? `You've been connected to ${assignedTo.name}, one of our support agents.`
        : 'Your request has been escalated to our support team. An agent will be with you shortly.';
      if (token && chatId) {
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: agentLabel,
          }),
        ).catch(() => null);
      }

      await Promise.all([
        this.activity.log(
          organizationId, actorId, actorName,
          ActivityAction.CONVERSATION_ESCALATED,
          'conversation', conversationId,
          { topic: dto.escalationTopic, assignedTo: assignedTo?.userId },
        ),
        this.notifications.createOrgNotification(
          organizationId,
          'conversation_escalated',
          'Conversation escalated',
          `A conversation was escalated${dto.escalationTopic ? ` (${dto.escalationTopic})` : ''}${assignedTo ? ` → assigned to ${assignedTo.name}` : ' — no agents available'}.`,
          { conversationId, actorId, topic: dto.escalationTopic, assignedTo: assignedTo?.userId },
        ),
      ]);
    }

    // Conversation resolved
    if (dto.status === 'RESOLVED' && conversation.status !== 'RESOLVED') {
      await this.prisma.escalation.updateMany({
        where: { conversationId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });

      const resolvedText = '✅ Your support request has been resolved. Feel free to message us again if you need further help.';

      if (token && chatId) {
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: resolvedText,
          }),
        ).catch(() => null);
      }

      await sendCustomerWhatsApp(resolvedText);

      // Send resolution email
      if (canSendExternalEmail) {
        const emailApiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
        const baseFromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
        const fromName = buildBrandedFromName(organization?.name, conversation.bot.emailAddress, baseFromName);
        if (emailApiKey && conversation.bot.emailAddress && conversation.customerEmail) {
          const botEmail = conversation.bot.emailAddress;
          const botDomain = botEmail.split('@')[1] ?? '';
          const orgSlug = botDomain.replace(/\.bords\.app$/, '');
          const fromAddress = orgSlug && orgSlug !== botDomain
            ? `${orgSlug}@bords.app`
            : (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app');
          const mimeHeaders: Record<string, string> = conversation.emailThreadId
            ? { 'In-Reply-To': `<${conversation.emailThreadId}>`, References: `<${conversation.emailThreadId}>` }
            : {};
          const botName = conversation.bot.name ?? 'Support';
          const orgName = orgSlug || botName;
          const htmlbody = await render(
            React.createElement(BotReplyEmail, { botName, orgName, replyText: resolvedText }),
          );
          await firstValueFrom(
            this.http.post(
              'https://api.zeptomail.com/v1.1/email',
              {
                from: { address: fromAddress, name: fromName },
                reply_to: [{ address: botEmail }],
                to: [{ email_address: { address: conversation.customerEmail } }],
                subject: `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
                htmlbody,
                textbody: resolvedText,
                ...(Object.keys(mimeHeaders).length > 0 ? { mime_headers: mimeHeaders } : {}),
              },
              {
                headers: {
                  Authorization: `Zoho-enczapikey ${emailApiKey}`,
                  'Content-Type': 'application/json',
                },
              },
            ),
          ).catch(() => null);
        }
      }

      await this.activity.log(
        organizationId, actorId, actorName,
        ActivityAction.CONVERSATION_RESOLVED,
        'conversation', conversationId,
      );
    }

    // Explicit assignment change
    if (
      dto.assignedAgentId !== undefined &&
      dto.assignedAgentId !== conversation.assignedAgentId &&
      !(dto.mode === 'HUMAN' && !conversation.assignedAgentId) // don't double-log auto-assign
    ) {
      await this.activity.log(
        organizationId, actorId, actorName,
        ActivityAction.CONVERSATION_ASSIGNED,
        'conversation', conversationId,
        { assignedTo: dto.assignedAgentId },
      );
    }

    // Emit conversation update to inbox
    this.events.emitConversationUpdate(organizationId, {
      conversationId,
      ...(dto.status && { status: dto.status }),
      ...(dto.mode && { mode: dto.mode }),
      ...(updated.assignedAgentId !== conversation.assignedAgentId && { assignedAgentId: updated.assignedAgentId }),
    });

    return updated;
  }

  async startInternalConversation(
    organizationId: string,
    actorId: string,
    input: StartInternalConversationInput,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: input.botId, organizationId },
      select: { id: true, name: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');

    const customerEmail = input.customerEmail.trim().toLowerCase();
    const metadataFilters: any[] = [
      { metadata: { path: ['internalOnly'], equals: true } },
      { metadata: { path: ['initiatedFrom'], equals: 'OPERATIONS' } },
    ];
    if (input.sourceRecordType) {
      metadataFilters.push({ metadata: { path: ['sourceRecordType'], equals: input.sourceRecordType } });
    }
    if (input.sourceRecordId) {
      metadataFilters.push({ metadata: { path: ['sourceRecordId'], equals: input.sourceRecordId } });
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.conversation.findFirst({
            where: {
              organizationId,
              botId: bot.id,
              channel: 'EMAIL',
              customerEmail,
              status: { in: ['OPEN', 'PENDING', 'ESCALATED'] },
              AND: metadataFilters,
            },
            orderBy: { updatedAt: 'desc' },
          });

          if (existing) {
            const existingMetadata =
              existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>)
                : {};
            const shouldAllowExternalDelivery = input.allowExternalDelivery !== false;
            const needsMetadataUpdate = shouldAllowExternalDelivery && existingMetadata.allowExternalDelivery === false;
            const needsAssignmentUpdate = !existing.assignedAgentId;

            if (!needsMetadataUpdate && !needsAssignmentUpdate) {
              return { conversation: existing, reused: true, assignedUpdated: false, isNew: false };
            }

            const updated = await tx.conversation.update({
              where: { id: existing.id },
              data: {
                ...(needsMetadataUpdate
                  ? { metadata: { ...existingMetadata, allowExternalDelivery: true } as Prisma.InputJsonValue }
                  : {}),
                ...(needsAssignmentUpdate ? { assignedAgentId: actorId } : {}),
              },
            });
            return { conversation: updated, reused: true, assignedUpdated: needsAssignmentUpdate, isNew: false };
          }

          const metadata: Record<string, unknown> = {
            internalOnly: true,
            allowExternalDelivery: input.allowExternalDelivery !== false,
            initiatedFrom: 'OPERATIONS',
            initiatedByUserId: actorId,
            ...(input.sourceRecordType ? { sourceRecordType: input.sourceRecordType } : {}),
            ...(input.sourceRecordId ? { sourceRecordId: input.sourceRecordId } : {}),
            ...(input.sourceActionTaskId ? { sourceActionTaskId: input.sourceActionTaskId } : {}),
            ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
          };

          const created = await tx.conversation.create({
            data: {
              organizationId,
              botId: bot.id,
              channel: 'EMAIL',
              customerEmail,
              customerName: input.customerName?.trim() || null,
              emailSubject: input.subject?.trim() || 'Support follow-up',
              status: 'OPEN',
              mode: 'HUMAN',
              assignedAgentId: actorId,
              metadata: metadata as Prisma.InputJsonValue,
              lastMessageAt: new Date(),
            },
          });

          return { conversation: created, reused: false, assignedUpdated: false, isNew: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (result.assignedUpdated) {
          this.events.emitConversationUpdate(organizationId, {
            conversationId: result.conversation.id,
            assignedAgentId: actorId,
          });
        }

        if (result.isNew) {
          this.events.emitNewConversation(organizationId, {
            ...result.conversation,
            bot: { id: bot.id, name: bot.name },
            messages: [],
          });
        }

        return { ...result.conversation, reused: result.reused };
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < maxAttempts) {
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException('Failed to start internal conversation');
  }

  async sendMessage(organizationId: string, conversationId: string, content: string, agentId?: string, restrictToOwn = false) {
    const where: Record<string, unknown> = { id: conversationId, organizationId };
    if (agentId && restrictToOwn) {
      (where as any).OR = [
        { assignedAgentId: agentId },
        { assignedAgentId: null },
      ];
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: where as any,
      include: { bot: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const conversationMetadata =
      conversation.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    const isInternalOnly = conversationMetadata.internalOnly === true;
    const allowExternalDelivery = isInternalOnly
      ? conversationMetadata.allowExternalDelivery !== false
      : true;
    if (conversation.mode !== 'HUMAN') {
      throw new BadRequestException('Can only send messages in HUMAN mode');
    }

    // Auto-assign: first agent to reply to an unassigned escalated conversation claims it
    if (agentId && !conversation.assignedAgentId) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { assignedAgentId: agentId },
      });
      this.events.emitConversationUpdate(organizationId, {
        conversationId,
        assignedAgentId: agentId,
      });
    }

    // Look up agent name for signature
    let agentName = 'Support Agent';
    if (agentId) {
      const agent = await this.prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
      if (agent?.name) agentName = agent.name;
    }
    const signedContent = `${content}\n\n\n${agentName}\nCustomer Support`;

    // Save message to DB
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'AGENT',
        content: signedContent,
      },
    });

    if (conversation.channel === 'EMAIL' && (!isInternalOnly || allowExternalDelivery)) {
      await this.setEmailDeliveryMeta(organizationId, conversationId, message.id, 'ATTEMPTED');
      // Send reply via ZeptoMail
      const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
      if (!apiKey) {
        await this.setEmailDeliveryMeta(organizationId, conversationId, message.id, 'FAILED', 'Email provider not configured');
        throw new BadRequestException('Email provider not configured');
      }
      if (!conversation.bot.emailAddress || !conversation.customerEmail) {
        await this.setEmailDeliveryMeta(organizationId, conversationId, message.id, 'FAILED', 'Bot email or customer email is missing');
        throw new BadRequestException('Bot email or customer email is missing for outbound email delivery');
      }
      try {
        await this.deliverEmailReply(
          organizationId,
          conversation as any,
          signedContent,
          agentName,
        );
        await this.setEmailDeliveryMeta(organizationId, conversationId, message.id, 'SENT');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.setEmailDeliveryMeta(organizationId, conversationId, message.id, 'FAILED', errorMessage);
        this.logger.warn(`Failed to send outbound email for conversation ${conversationId}: ${errorMessage}`);
        throw new BadRequestException('Failed to send outbound email');
      }
    } else if (conversation.channel === 'WHATSAPP' && (!isInternalOnly || allowExternalDelivery)) {
      const target = conversation.whatsappPhoneNumber ?? conversation.whatsappUserId;
      if (!target) {
        throw new BadRequestException('WhatsApp recipient is missing for outbound delivery');
      }
      try {
        await sendWhatsAppText(this.http, {
          provider: conversation.bot.whatsappProvider,
          channelIdentifier: conversation.bot.whatsappChannelIdentifier,
          phoneNumber: conversation.bot.whatsappPhoneNumber,
          config: conversation.bot.whatsappConfig,
        }, target, signedContent);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to send outbound WhatsApp for conversation ${conversationId}: ${errorMessage}`);
        throw new BadRequestException('Failed to send outbound WhatsApp message');
      }
    } else if (conversation.bot.telegramToken && conversation.telegramChatId) {
      // Send via Telegram
      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${conversation.bot.telegramToken}/sendMessage`,
          { chat_id: conversation.telegramChatId, text: signedContent },
        ),
      ).catch(() => null);
    }

    // Update lastMessageAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }

  async retryEmailDelivery(
    organizationId: string,
    conversationId: string,
    agentId?: string,
    restrictToOwn = false,
  ) {
    const where: Record<string, unknown> = { id: conversationId, organizationId };
    if (agentId && restrictToOwn) {
      (where as any).OR = [
        { assignedAgentId: agentId },
        { assignedAgentId: null },
      ];
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: where as any,
      include: { bot: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.channel !== 'EMAIL') throw new BadRequestException('Conversation is not an email conversation');

    const conversationMetadata =
      conversation.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
        ? (conversation.metadata as Record<string, unknown>)
        : {};
    const isInternalOnly = conversationMetadata.internalOnly === true;
    const allowExternalDelivery = isInternalOnly
      ? conversationMetadata.allowExternalDelivery !== false
      : true;
    if (!allowExternalDelivery) {
      throw new BadRequestException('External delivery is disabled for this conversation');
    }

    const latestAgentMessage = await this.prisma.message.findFirst({
      where: { conversationId, role: 'AGENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true },
    });
    if (!latestAgentMessage) {
      throw new BadRequestException('No agent message available to retry');
    }

    await this.setEmailDeliveryMeta(organizationId, conversationId, latestAgentMessage.id, 'ATTEMPTED', undefined, true);
    try {
      await this.deliverEmailReply(
        organizationId,
        conversation as any,
        latestAgentMessage.content,
      );
      await this.setEmailDeliveryMeta(organizationId, conversationId, latestAgentMessage.id, 'SENT');
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.setEmailDeliveryMeta(organizationId, conversationId, latestAgentMessage.id, 'FAILED', errorMessage);
      this.logger.warn(`Retry email delivery failed for conversation ${conversationId}: ${errorMessage}`);
      throw new BadRequestException('Failed to retry email delivery');
    }
  }

  async addNote(
    organizationId: string,
    conversationId: string,
    content: string,
    agentId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const agent = await this.prisma.user.findUnique({
      where: { id: agentId },
      select: { name: true },
    });
    const agentName = agent?.name ?? 'Agent';

    return this.prisma.message.create({
      data: {
        conversationId,
        role: 'SYSTEM',
        content,
        metadata: { internal: true, authorId: agentId, authorName: agentName },
      },
    });
  }

  private async generateHandoffSummary(
    organizationId: string,
    conversationId: string,
  ): Promise<void> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, NOT: { role: 'SYSTEM' } },
      orderBy: { createdAt: 'asc' },
      take: 30,
      select: { role: true, content: true },
    });
    if (messages.length < 2) return;

    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const internalApiKey = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
    await this.billing.assertMinimumCredits(organizationId, 1);
    const { data: summaryData } = await firstValueFrom(
      this.http.post<{ summary: string }>(
        `${aiServiceUrl}/api/v1/summarize`,
        {
          messages: messages.map((m) => ({
            role: m.role === 'USER' ? 'user' : 'assistant',
            content: m.content,
          })),
        },
        internalApiKey ? { headers: { 'X-Internal-Key': internalApiKey } } : undefined,
      ),
    );
    if (!summaryData?.summary) return;

    const promptTokens = estimateTokens(messages);
    const completionTokens = estimateTokens(summaryData.summary);
    await this.billing.debitUsageCredits({
      organizationId,
      usageType: 'SUMMARIZATION',
      promptTokens,
      completionTokens,
      idempotencyKey: `summary:${conversationId}:${messages.length}`,
      metadata: {
        purpose: 'handoff_summary',
        conversationId,
      },
    });

    await this.aiUsage.record({
      organizationId,
      conversationId,
      usageType: 'SUMMARIZATION',
      provider: 'ai-service',
      promptTokens,
      completionTokens,
      metadata: { purpose: 'handoff_summary' },
    }).catch(() => null);

    const current = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const existingMeta = (current?.metadata as Record<string, unknown>) ?? {};
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: { ...existingMeta, handoffSummary: summaryData.summary } },
    });

    this.events.emitConversationUpdate(organizationId, {
      conversationId,
      metadata: { handoffSummary: summaryData.summary },
    });
  }

  async getAnalytics(organizationId: string, days: number, botId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Fetch all conversations in the period (lightweight — no messages yet)
    const conversations = await this.prisma.conversation.findMany({
      where: { organizationId, createdAt: { gte: since }, ...(botId ? { botId } : {}) },
      select: {
        id: true,
        status: true,
        mode: true,
        channel: true,
        createdAt: true,
        metadata: true,
        // First AI response per conversation for response-time metric
        messages: {
          where: { role: 'ASSISTANT' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const total = conversations.length;
    const resolved = conversations.filter((c) => c.status === 'RESOLVED').length;
    const escalated = conversations.filter((c) => c.status === 'ESCALATED').length;
    const open = conversations.filter((c) => c.status === 'OPEN').length;
    const pending = conversations.filter((c) => c.status === 'PENDING').length;

    // Resolution rate: resolved / conversations that reached a terminal state
    const terminal = resolved + escalated;
    const resolutionRate = terminal > 0 ? Math.round((resolved / terminal) * 100) : null;
    const escalationRate = total > 0 ? Math.round((escalated / total) * 100) : null;

    // AI resolution: resolved conversations that are still in AI mode (never handed to human)
    const aiResolved = conversations.filter((c) => c.status === 'RESOLVED' && c.mode === 'AI').length;
    const aiResolutionRate = resolved > 0 ? Math.round((aiResolved / resolved) * 100) : null;

    // Avg first response time (seconds)
    const responseTimes = conversations
      .filter((c) => c.messages.length > 0)
      .map((c) => (new Date(c.messages[0].createdAt).getTime() - new Date(c.createdAt).getTime()) / 1000);
    const avgFirstResponseSec = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

    // Channel breakdown
    const channelBreakdown: Record<string, number> = { WIDGET: 0, TELEGRAM: 0, EMAIL: 0, WHATSAPP: 0 };
    for (const c of conversations) channelBreakdown[c.channel] = (channelBreakdown[c.channel] ?? 0) + 1;

    // Volume by day (UTC date buckets)
    const volumeMap: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      volumeMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const c of conversations) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10);
      if (key in volumeMap) volumeMap[key]++;
    }
    const volumeByDay = Object.entries(volumeMap).map(([date, count]) => ({ date, count }));

    return {
      period: { start: since.toISOString(), end: new Date().toISOString(), days },
      totals: { conversations: total, resolved, escalated, open, pending },
      rates: { resolutionRate, escalationRate, aiResolutionRate },
      avgFirstResponseSec,
      channelBreakdown,
      volumeByDay,
      // CSAT — computed from conversations where a satisfaction rating was recorded
      csatScore: (() => {
        const rated = conversations.filter((c) => {
          const m = c.metadata as Record<string, unknown> | null;
          return m?.csatRating === 'positive' || m?.csatRating === 'negative';
        });
        if (rated.length === 0) return null as number | null;
        const positive = rated.filter((c) => (c.metadata as Record<string, unknown>)?.csatRating === 'positive').length;
        return Math.round((positive / rated.length) * 100) as number;
      })(),
      csatSampleSize: conversations.filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return m?.csatRating === 'positive' || m?.csatRating === 'negative';
      }).length,
    };
  }

  async getOverview(organizationId: string, agentId?: string) {
    const baseWhere: Prisma.ConversationWhereInput = {
      organizationId,
      ...(agentId
        ? {
            OR: [
              { assignedAgentId: agentId },
              { assignedAgentId: null },
            ],
          }
        : {}),
    };

    const [total, groupedByStatus, recentConversations, recentForVolume] = await Promise.all([
      this.prisma.conversation.count({ where: baseWhere }),
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { status: true },
      }),
      this.prisma.conversation.findMany({
        where: baseWhere,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          status: true,
          customerName: true,
          lastMessageAt: true,
          createdAt: true,
        },
      }),
      this.prisma.conversation.findMany({
        where: {
          ...baseWhere,
          createdAt: {
            gte: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
          },
        },
        select: { createdAt: true },
      }),
    ]);

    const countsByStatus = groupedByStatus.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {});

    const open = countsByStatus.OPEN ?? 0;
    const resolved = countsByStatus.RESOLVED ?? 0;
    const escalated = countsByStatus.ESCALATED ?? 0;
    const pending = countsByStatus.PENDING ?? 0;

    const volumeMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      volumeMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const c of recentForVolume) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10);
      if (key in volumeMap) volumeMap[key] += 1;
    }

    return {
      totals: { total, open, resolved, escalated, pending },
      volumeByDay: Object.entries(volumeMap).map(([date, count]) => ({ date, count })),
      recentConversations: recentConversations.map((c) => ({
        id: c.id,
        status: c.status,
        customerName: c.customerName,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      })),
    };
  }

  private async setEmailDeliveryMeta(
    organizationId: string,
    conversationId: string,
    messageId: string,
    status: 'ATTEMPTED' | 'SENT' | 'FAILED',
    errorMessage?: string,
    incrementRetry = false,
  ) {
    const latestConversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const latestMetadata =
      latestConversation?.metadata && typeof latestConversation.metadata === 'object' && !Array.isArray(latestConversation.metadata)
        ? (latestConversation.metadata as Record<string, unknown>)
        : {};

    const existingDelivery =
      latestMetadata.emailDelivery && typeof latestMetadata.emailDelivery === 'object' && !Array.isArray(latestMetadata.emailDelivery)
        ? (latestMetadata.emailDelivery as Record<string, unknown>)
        : {};
    const previousRetryCount = typeof existingDelivery.retryCount === 'number' ? existingDelivery.retryCount : 0;
    const retryCount = incrementRetry ? previousRetryCount + 1 : previousRetryCount;
    const payload = {
      status,
      attemptedAt: new Date().toISOString(),
      messageId,
      retryCount,
      ...(status === 'SENT' ? { sentAt: new Date().toISOString() } : {}),
      ...(status === 'FAILED' ? { failedAt: new Date().toISOString() } : {}),
      ...(errorMessage ? { error: errorMessage.slice(0, 500) } : {}),
    };

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: {
          ...latestMetadata,
          emailDelivery: payload,
        } as Prisma.InputJsonValue,
      },
    });

    this.events.emitConversationUpdate(organizationId, {
      conversationId,
      metadata: { emailDelivery: payload },
    });
  }

  private async deliverEmailReply(
    organizationId: string,
    conversation: {
      bot: { emailAddress: string | null; name: string | null };
      customerEmail: string | null;
      emailThreadId: string | null;
      emailSubject: string | null;
    },
    replyText: string,
    authorName?: string,
  ) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    if (!apiKey) throw new Error('Email provider not configured');
    if (!conversation.bot.emailAddress || !conversation.customerEmail) {
      throw new Error('Bot email or customer email is missing');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    const baseFromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
    const fromName = buildBrandedFromName(org?.name, conversation.bot.emailAddress, baseFromName);

    const botEmail = conversation.bot.emailAddress;
    const botDomain = botEmail.split('@')[1] ?? '';
    const orgSlug = botDomain.replace(/\.bords\.app$/, '');
    const fromAddress = orgSlug && orgSlug !== botDomain
      ? `${orgSlug}@bords.app`
      : (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app');
    const mimeHeaders: Record<string, string> = conversation.emailThreadId
      ? { 'In-Reply-To': `<${conversation.emailThreadId}>`, References: `<${conversation.emailThreadId}>` }
      : {};

    const botName = authorName ?? conversation.bot.name ?? 'Support';
    const orgName = orgSlug || botName;
    const htmlbody = await render(
      React.createElement(BotReplyEmail, { botName, orgName, replyText }),
    );
    const textbody = replyText
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[-*]\s/gm, '\u2022 ')
      .trim();

    await firstValueFrom(
      this.http.post(
        'https://api.zeptomail.com/v1.1/email',
        {
          from: { address: fromAddress, name: fromName },
          reply_to: [{ address: botEmail }],
          to: [{ email_address: { address: conversation.customerEmail } }],
          subject: `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
          htmlbody,
          textbody,
          ...(Object.keys(mimeHeaders).length > 0 ? { mime_headers: mimeHeaders } : {}),
        },
        {
          headers: {
            Authorization: `Zoho-enczapikey ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
  }
}
