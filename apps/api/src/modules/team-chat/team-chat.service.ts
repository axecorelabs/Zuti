import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { AiUsageService } from '../ai-usage/ai-usage.service';

interface CreateEscalationThreadInput {
  conversationId?: string;
  escalationId?: string;
  assignedUserId?: string | null;
  topic?: string | null;
  question: string;
  senderId: string;
  metadata?: Record<string, unknown>;
}

interface EnsureKnowledgeGapInput {
  conversationId: string;
  question: string;
  topic?: string | null;
  assignedUserId?: string | null;
  senderId: string;
  metadata?: Record<string, unknown>;
}

function topicKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 2)
    .slice(0, 8)
    .join('-') || 'general';
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

@Injectable()
export class TeamChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly aiUsage: AiUsageService,
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

    if (metadata?.kind === 'internal_assistant') {
      await this.aiUsage.record({
        organizationId,
        usageType: 'INTERNAL_ASSISTANT',
        provider: 'internal',
        promptTokens: estimateTokens(metadata?.prompt ?? null),
        completionTokens: estimateTokens(content),
        metadata: {
          source: 'team_chat_message',
          senderId,
          teamChatMessageId: row.id,
          ...(metadata ?? {}),
        },
      }).catch(() => null);
    }

    return row;
  }

  async listEscalationThreads(organizationId: string, status?: string) {
    return this.prisma.escalationThread.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
        conversation: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            customerUsername: true,
            channel: true,
            status: true,
          },
        },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, email: true } } },
        },
        knowledgeSuggestions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createEscalationThread(
    organizationId: string,
    input: CreateEscalationThreadInput,
  ) {
    const mention = input.assignedUserId ? await this.prisma.user.findUnique({
      where: { id: input.assignedUserId },
      select: { name: true, email: true },
    }) : null;
    const assignedLabel = mention ? `Assigned to ${mention.name ?? mention.email}.` : 'No specialist is assigned yet.';
    const content = [
      'AI needs specialist help',
      input.topic ? `Topic: ${input.topic}` : null,
      assignedLabel,
      `Question: ${input.question}`,
    ].filter(Boolean).join('\n');

    const message = await this.sendMessage(
      organizationId,
      input.senderId,
      content,
      {
        kind: 'ai_escalation_thread',
        conversationId: input.conversationId ?? null,
        escalationId: input.escalationId ?? null,
        assignedUserId: input.assignedUserId ?? null,
        topic: input.topic ?? null,
        ...(input.metadata ?? {}),
      },
    );

    return this.prisma.escalationThread.create({
      data: {
        organizationId,
        conversationId: input.conversationId ?? null,
        escalationId: input.escalationId ?? null,
        teamChatMessageId: message.id,
        assignedUserId: input.assignedUserId ?? null,
        topic: input.topic ?? null,
        question: input.question.trim(),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
        replies: true,
        knowledgeSuggestions: true,
      },
    });
  }

  async ensureKnowledgeGapThread(
    organizationId: string,
    input: EnsureKnowledgeGapInput,
  ) {
    const key = topicKey(input.topic || input.question);
    const existing = await this.prisma.knowledgeGap.findUnique({
      where: { organizationId_topicKey: { organizationId, topicKey: key } },
      include: { thread: true },
    });

    if (existing) {
      // A gap first recorded by the AI's report_knowledge_gap tool has no escalation thread. If that
      // topic now genuinely escalates, create and attach one so the human has somewhere to respond.
      let ensuredThread = existing.thread;
      if (!existing.threadId) {
        ensuredThread = await this.createEscalationThread(organizationId, {
          conversationId: input.conversationId,
          assignedUserId: input.assignedUserId,
          topic: input.topic ?? existing.topic ?? null,
          question: input.question,
          senderId: input.senderId,
          metadata: { ...(input.metadata ?? {}), source: input.metadata?.source ?? 'knowledge_gap' },
        });
      }

      const updated = await this.prisma.knowledgeGap.update({
        where: { id: existing.id },
        data: {
          seenCount: { increment: 1 },
          lastSeenAt: new Date(),
          conversationId: input.conversationId,
          question: input.question,
          ...(existing.threadId ? {} : { threadId: ensuredThread?.id ?? null }),
          metadata: {
            ...((existing.metadata as Record<string, unknown>) ?? {}),
            ...(input.metadata ?? {}),
            lastQuestion: input.question,
          } as any,
        },
        include: { thread: true },
      });

      if (updated.threadId) {
        await this.prisma.escalationThread.update({
          where: { id: updated.threadId },
          data: { duplicateCount: updated.seenCount },
        }).catch(() => null);
      }

      return { gap: updated, thread: updated.thread, created: false };
    }

    const thread = await this.createEscalationThread(organizationId, {
      conversationId: input.conversationId,
      assignedUserId: input.assignedUserId,
      topic: input.topic ?? null,
      question: input.question,
      senderId: input.senderId,
      metadata: {
        ...(input.metadata ?? {}),
        source: input.metadata?.source ?? 'knowledge_gap',
      },
    });

    const gap = await this.prisma.knowledgeGap.create({
      data: {
        organizationId,
        conversationId: input.conversationId,
        threadId: thread.id,
        topicKey: key,
        topic: input.topic ?? null,
        question: input.question,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: { thread: true },
    });

    return { gap, thread, created: true };
  }

  /**
   * Record a knowledge gap detected by the AI (the search_knowledge tool found no answer to a
   * genuine question) into the Gaps tab — WITHOUT opening an escalation thread or handing off to a
   * human. Dedups by topicKey with the escalation-driven gaps, so a repeated question just bumps
   * seenCount. This is the lightweight, tool-driven counterpart to ensureKnowledgeGapThread.
   */
  async recordKnowledgeGap(
    organizationId: string,
    input: { question: string; topic?: string | null; conversationId?: string | null; metadata?: Record<string, unknown> },
  ): Promise<{ created: boolean }> {
    const key = topicKey(input.topic || input.question);
    const existing = await this.prisma.knowledgeGap.findUnique({
      where: { organizationId_topicKey: { organizationId, topicKey: key } },
    });

    if (existing) {
      await this.prisma.knowledgeGap.update({
        where: { id: existing.id },
        data: {
          seenCount: { increment: 1 },
          lastSeenAt: new Date(),
          conversationId: input.conversationId ?? existing.conversationId,
          question: input.question,
          metadata: {
            ...((existing.metadata as Record<string, unknown>) ?? {}),
            ...(input.metadata ?? {}),
            lastQuestion: input.question,
          } as any,
        },
      });
      return { created: false };
    }

    await this.prisma.knowledgeGap.create({
      data: {
        organizationId,
        conversationId: input.conversationId ?? null,
        topicKey: key,
        topic: input.topic ?? null,
        question: input.question,
        metadata: {
          ...(input.metadata ?? {}),
          source: input.metadata?.source ?? 'ai_knowledge_tool',
        } as Prisma.InputJsonValue,
      },
    });
    return { created: true };
  }

  async replyToEscalationThread(
    organizationId: string,
    threadId: string,
    authorId: string,
    content: string,
    createKnowledgeSuggestion = true,
  ) {
    const thread = await this.prisma.escalationThread.findFirst({
      where: { id: threadId, organizationId },
      include: { conversation: { select: { id: true } } },
    });
    if (!thread) throw new NotFoundException('Escalation thread not found');
    if (!content.trim()) throw new BadRequestException('Reply cannot be empty');

    const reply = await this.prisma.escalationThreadReply.create({
      data: {
        threadId,
        authorId,
        content: content.trim(),
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    const updated = await this.prisma.escalationThread.update({
      where: { id: threadId },
      data: { status: 'ANSWERED' },
    });

    let suggestion: Awaited<ReturnType<typeof this.prisma.knowledgeSuggestion.create>> | null = null;
    if (createKnowledgeSuggestion) {
      suggestion = await this.prisma.knowledgeSuggestion.create({
        data: {
          organizationId,
          conversationId: thread.conversationId,
          threadId,
          title: thread.topic ? `Answer for ${thread.topic}` : 'Specialist answer',
          content: content.trim(),
          sourceQuestion: thread.question,
          sourceAnswer: content.trim(),
          metadata: {
            source: 'escalation_thread_reply',
            replyId: reply.id,
            assignedUserId: thread.assignedUserId,
          },
        },
      });

      await this.aiUsage.record({
        organizationId,
        conversationId: thread.conversationId,
        usageType: 'KNOWLEDGE_SUGGESTION',
        provider: 'internal',
        promptTokens: estimateTokens(thread.question),
        completionTokens: estimateTokens(content.trim()),
        metadata: {
          source: 'escalation_thread_reply',
          threadId,
          replyId: reply.id,
          knowledgeSuggestionId: suggestion.id,
          authorId,
        },
      }).catch(() => null);
    }

    await this.prisma.knowledgeGap.updateMany({
      where: { threadId },
      data: { status: 'ANSWERED' },
    });

    await this.sendMessage(
      organizationId,
      authorId,
      `Specialist answer added${thread.topic ? ` for ${thread.topic}` : ''}.\n${content.trim()}`,
      {
        kind: 'ai_escalation_answer',
        threadId,
        conversationId: thread.conversationId,
        knowledgeSuggestionId: suggestion?.id ?? null,
      },
    );

    return { thread: updated, reply, knowledgeSuggestion: suggestion };
  }

  async updateEscalationThreadStatus(
    organizationId: string,
    threadId: string,
    status: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DUPLICATE',
  ) {
    const existing = await this.prisma.escalationThread.findFirst({
      where: { id: threadId, organizationId },
    });
    if (!existing) throw new NotFoundException('Escalation thread not found');
    return this.prisma.escalationThread.update({
      where: { id: threadId },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
      },
    });
  }
}
