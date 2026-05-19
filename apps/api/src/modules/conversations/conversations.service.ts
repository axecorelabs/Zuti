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

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
  assignedAgentId?: string;
  q?: string;
  /** When set, only return conversations assigned to this agent or unassigned */
  agentId?: string;
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

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.status && { status: dto.status as any }),
        ...(dto.mode && { mode: dto.mode as any }),
        // When switching to HUMAN mode, auto-assign the actor if no one is assigned yet
        ...(dto.mode === 'HUMAN' && conversation.mode !== 'HUMAN' && !conversation.assignedAgentId
          ? { assignedAgentId: actorId }
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
    }

    // Conversation escalated
    if (dto.status === 'ESCALATED' && conversation.status !== 'ESCALATED') {
      await this.prisma.escalation.create({
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
        const fromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
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

  async sendMessage(organizationId: string, conversationId: string, content: string, agentId?: string) {
    const where: Record<string, unknown> = { id: conversationId, organizationId };
    if (agentId) {
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
      const fromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
      if (apiKey && conversation.bot.emailAddress && conversation.customerEmail) {
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
}
