import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const ActivityAction = {
  AGENT_TOOK_OVER:          'AGENT_TOOK_OVER',
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
        metadata: metadata ?? {},
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
}
