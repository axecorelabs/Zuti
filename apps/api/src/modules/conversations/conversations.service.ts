import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
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

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
  assignedAgentId?: string;
  q?: string;
  /** When set, only return conversations assigned to this agent or unassigned */
  agentId?: string;
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
      andClauses.push({
        OR: [
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerUsername: { contains: q, mode: 'insensitive' } },
          { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }

    return this.prisma.conversation.findMany({
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
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async findOne(organizationId: string, conversationId: string, agentId?: string) {
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
        messages: { orderBy: { createdAt: 'asc' } },
        escalations: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const prevCustomerWhere = conversation.telegramChatId
      ? { telegramChatId: conversation.telegramChatId }
      : conversation.customerEmail
        ? { customerEmail: conversation.customerEmail }
        : null;

    const [previousConversations, escalationHistory] = await Promise.all([
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
    ]);

    return {
      ...conversation,
      previousConversations,
      escalationHistory,
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
      if (conversation.channel !== 'EMAIL') return;
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

      // Send resolution email
      if (conversation.channel === 'EMAIL') {
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

    if (conversation.channel === 'EMAIL') {
      // Send reply via ZeptoMail
      const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
      if (apiKey && conversation.bot.emailAddress && conversation.customerEmail) {
        const org = await this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        });
        const baseFromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
        const fromName = buildBrandedFromName(org?.name, conversation.bot.emailAddress, baseFromName);
        // from = {orgSlug}@bords.app (verified sending domain); reply_to = bot's actual address
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
          React.createElement(BotReplyEmail, { botName: agentName, orgName, replyText: signedContent }),
        );
        const textbody = signedContent
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
        ).catch(() => null);
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
    await this.billing.assertMinimumCredits(organizationId, 1);
    const { data: summaryData } = await firstValueFrom(
      this.http.post<{ summary: string }>(`${aiServiceUrl}/api/v1/summarize`, {
        messages: messages.map((m) => ({
          role: m.role === 'USER' ? 'user' : 'assistant',
          content: m.content,
        })),
      }),
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
    const channelBreakdown: Record<string, number> = { WIDGET: 0, TELEGRAM: 0, EMAIL: 0 };
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
}
