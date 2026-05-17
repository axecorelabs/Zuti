import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService, ActivityAction } from '../activity/activity.service';
import { OrganizationsService } from '../organizations/organizations.service';

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
  /** When set, only return conversations assigned to this agent or unassigned */
  agentId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly events: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    @Inject(forwardRef(() => OrganizationsService))
    private readonly orgs: OrganizationsService,
  ) {}

  async findAll(organizationId: string, filters: FindAllFilters) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        ...(filters.status && { status: filters.status as any }),
        ...(filters.mode && { mode: filters.mode as any }),
        ...(filters.botId && { botId: filters.botId }),
        // AGENT scope: show only their assigned conversations OR unassigned
        ...(filters.agentId && {
          OR: [
            { assignedAgentId: filters.agentId },
            { assignedAgentId: null },
          ],
        }),
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
    return conversation;
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
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: '👤 You have been connected to a support agent. We will be with you shortly.',
        }),
      ).catch(() => null);

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
      // Smart-route to best available agent
      const bestAgent = await this.orgs.findBestAgent(organizationId, dto.escalationTopic);
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

      // Telegram message to customer
      const agentLabel = assignedTo
        ? `👤 You've been connected to *${assignedTo.name}*, one of our support agents.`
        : '👤 Your request has been escalated to our support team. An agent will be with you shortly.';
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: agentLabel,
          parse_mode: 'Markdown',
        }),
      ).catch(() => null);

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
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: '✅ Your support request has been resolved. Feel free to message us again if you need further help.',
        }),
      ).catch(() => null);

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

    // Save message to DB
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'AGENT',
        content,
      },
    });

    // Send via Telegram
    await firstValueFrom(
      this.http.post(
        `https://api.telegram.org/bot${conversation.bot.telegramToken}/sendMessage`,
        { chat_id: conversation.telegramChatId, text: content },
      ),
    ).catch(() => null);

    // Update lastMessageAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }
}
