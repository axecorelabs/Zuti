import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class TeamChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async listMessages(organizationId: string, limit = 60, before?: string) {
    const take = Math.min(Math.max(limit || 60, 1), 200);

    const rows = await this.prisma.teamChatMessage.findMany({
      where: {
        organizationId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows.reverse();
  }

  async sendMessage(
    organizationId: string,
    senderId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    const row = await this.prisma.teamChatMessage.create({
      data: {
        organizationId,
        senderId,
        content,
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
    });

    this.events.emitTeamChatMessage(organizationId, {
      id: row.id,
      organizationId: row.organizationId,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.createdAt,
      sender: row.sender,
    });

    return row;
  }
}
