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
  BILLING_CHECKOUT_INITIALIZED: 'BILLING_CHECKOUT_INITIALIZED',
  BILLING_IDEMPOTENCY_REUSED:   'BILLING_IDEMPOTENCY_REUSED',
  BILLING_STATUS_UPDATED:       'BILLING_STATUS_UPDATED',
  BILLING_VERIFICATION_FAILED:  'BILLING_VERIFICATION_FAILED',
  BILLING_CREDIT_APPLIED:       'BILLING_CREDIT_APPLIED',
  BILLING_SECURITY_ALERT:       'BILLING_SECURITY_ALERT',
  ACCOUNT_PASSWORD_CHANGED:     'ACCOUNT_PASSWORD_CHANGED',
  CSAT_RECORDED_POSITIVE:       'CSAT_RECORDED_POSITIVE',
  CSAT_RECORDED_NEGATIVE:       'CSAT_RECORDED_NEGATIVE',
  COMMERCE_PRODUCT_CREATED:     'COMMERCE_PRODUCT_CREATED',
  COMMERCE_PRODUCT_UPDATED:     'COMMERCE_PRODUCT_UPDATED',
  COMMERCE_VARIANT_CREATED:     'COMMERCE_VARIANT_CREATED',
  COMMERCE_VARIANT_UPDATED:     'COMMERCE_VARIANT_UPDATED',
  COMMERCE_INVENTORY_UPDATED:   'COMMERCE_INVENTORY_UPDATED',
} as const;

export type ActivityAction = typeof ActivityAction[keyof typeof ActivityAction];

type ActivityListQuery = {
  page?: string;
  limit?: string;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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

  async list(orgId: string, query?: ActivityListQuery) {
    const page = parsePositiveInt(query?.page, 1);
    const limit = clamp(parsePositiveInt(query?.limit, 50), 1, 200);
    const skip = (page - 1) * limit;
    const where = { orgId };

    const total = await this.prisma.activityLog.count({ where });
    const items = await this.prisma.activityLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listForMember(orgId: string, userId: string, query?: ActivityListQuery) {
    const page = parsePositiveInt(query?.page, 1);
    const limit = clamp(parsePositiveInt(query?.limit, 50), 1, 200);
    const skip = (page - 1) * limit;
    const where = {
      orgId,
      OR: [
        { actorId: userId },
        { targetType: 'member', targetId: userId },
      ],
    };

    const total = await this.prisma.activityLog.count({ where });
    const items = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
