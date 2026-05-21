import { Injectable } from '@nestjs/common';
import { Prisma, AiUsageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface RecordUsageInput {
  organizationId: string;
  botId?: string | null;
  conversationId?: string | null;
  usageType: AiUsageType;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordUsageInput) {
    const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
    const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
    const totalTokens = Math.max(
      0,
      Math.floor(input.totalTokens ?? promptTokens + completionTokens),
    );

    return this.prisma.aiUsageEvent.create({
      data: {
        organizationId: input.organizationId,
        botId: input.botId ?? null,
        conversationId: input.conversationId ?? null,
        usageType: input.usageType,
        provider: input.provider ?? null,
        model: input.model ?? null,
        promptTokens,
        completionTokens,
        totalTokens,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async summarize(organizationId: string, days = 30, usageTypes?: AiUsageType[]) {
    const since = new Date();
    since.setDate(since.getDate() - Math.min(Math.max(days, 1), 365));

    const scopedUsageTypes = usageTypes?.length ? usageTypes : undefined;

    const rows = await this.prisma.aiUsageEvent.groupBy({
      by: ['usageType'],
      where: {
        organizationId,
        createdAt: { gte: since },
        ...(scopedUsageTypes ? { usageType: { in: scopedUsageTypes } } : {}),
      },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
      _count: { _all: true },
    });

    const byUsageType = rows.map((row) => ({
      usageType: row.usageType,
      calls: row._count._all,
      promptTokens: row._sum.promptTokens ?? 0,
      completionTokens: row._sum.completionTokens ?? 0,
      totalTokens: row._sum.totalTokens ?? 0,
    }));

    return {
      period: { start: since.toISOString(), end: new Date().toISOString(), days },
      totals: byUsageType.reduce(
        (acc, row) => ({
          calls: acc.calls + row.calls,
          promptTokens: acc.promptTokens + row.promptTokens,
          completionTokens: acc.completionTokens + row.completionTokens,
          totalTokens: acc.totalTokens + row.totalTokens,
        }),
        { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      ),
      byUsageType,
    };
  }

  async summarizeDailyCredits(organizationId: string, days = 30, usageTypes?: AiUsageType[]) {
    const windowDays = Math.min(Math.max(days, 1), 365);
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const scopedUsageTypes = usageTypes?.length ? usageTypes : undefined;

    const events = await this.prisma.aiUsageEvent.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
        ...(scopedUsageTypes ? { usageType: { in: scopedUsageTypes } } : {}),
      },
      select: {
        createdAt: true,
        promptTokens: true,
        completionTokens: true,
      },
    });

    const byDay = new Map<string, { promptTokens: number; completionTokens: number; calls: number }>();
    for (const event of events) {
      const dayKey = event.createdAt.toISOString().slice(0, 10);
      const current = byDay.get(dayKey) ?? { promptTokens: 0, completionTokens: 0, calls: 0 };
      current.promptTokens += event.promptTokens ?? 0;
      current.completionTokens += event.completionTokens ?? 0;
      current.calls += 1;
      byDay.set(dayKey, current);
    }

    const daysSummary = Array.from(byDay.entries())
      .map(([day, totals]) => ({
        day,
        promptTokens: totals.promptTokens,
        completionTokens: totals.completionTokens,
        calls: totals.calls,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      windowDays,
      activeDays: daysSummary.length,
      days: daysSummary,
    };
  }
}
