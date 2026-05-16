import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface FindAllFilters {
  status?: string;
  mode?: string;
  botId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
