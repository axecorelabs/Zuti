import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const ActivityAction = {
  AGENT_TOOK_OVER:          'AGENT_TOOK_OVER',
  HANDED_BACK_TO_AI:        'HANDED_BACK_TO_AI',
  CONVERSATION_ESCALATED:   'CONVERSATION_ESCALATED',
  CONVERSATION_ASSIGNED:    'CONVERSATION_ASSIGNED',
  CONVERSATION_RESOLVED:    'CONVERSATION_RESOLVED',
  MEMBER_JOINED:            'MEMBER_JOINED',
  MEMBER_REMOVED:           'MEMBER_REMOVED',
  MEMBER_ROLE_CHANGED:      'MEMBER_ROLE_CHANGED',
  INVITATION_SENT:          'INVITATION_SENT',
} as const;

export type ActivityAction = typeof ActivityAction[keyof typeof ActivityAction];

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    orgId: string,
    actorId: string | null,
    actorName: string,
    action: ActivityAction,
    targetType?: string,
    targetId?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.activityLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action,
        targetType,
        targetId,
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(orgId: string, limit = 200) {
    return this.prisma.activityLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listForMember(orgId: string, userId: string, limit = 200) {
    return this.prisma.activityLog.findMany({
      where: {
        orgId,
        OR: [
          { actorId: userId },
          { targetType: 'member', targetId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
