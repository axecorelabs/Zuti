import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly events: EventsGateway,
  ) {}

  async findAll(organizationId: string, filters: FindAllFilters) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        ...(filters.status && { status: filters.status as any }),
        ...(filters.mode && { mode: filters.mode as any }),
        ...(filters.botId && { botId: filters.botId }),
      },
      include: {
        bot: { select: { id: true, name: true, telegramUsername: true } },
        assignedAgent: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async findOne(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
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
    dto: { status?: string; mode?: string; assignedAgentId?: string },
    actorId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.status && { status: dto.status as any }),
        ...(dto.mode && { mode: dto.mode as any }),
        ...(dto.assignedAgentId !== undefined && { assignedAgentId: dto.assignedAgentId }),
      },
      include: {
        bot: { select: { id: true, name: true } },
        assignedAgent: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async sendMessage(organizationId: string, conversationId: string, content: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
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

    // Emit to other connected clients (e.g. other agent tabs)
    this.events.emitNewMessage(organizationId, { conversationId, message });

    return message;
  }
}
