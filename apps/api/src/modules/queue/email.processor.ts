import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Job } from 'bull';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import * as React from 'react';
import { BotReplyEmail } from '../mail/templates/BotReplyEmail';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { EMAIL_QUEUE } from './queue.module';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { TeamChatService } from '../team-chat/team-chat.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CsatClassifierService } from '../ai-usage/csat-classifier.service';
import { BillingService } from '../billing/billing.service';
import { computeUsageCredits } from '../billing/credit-model';
import { buildAgentSystemPrompt, buildSkillBehaviorPromptBlock } from '../../common/utils/agent-config';
import { buildCompactAiContext, buildConversationMetadataPatch } from '../../common/utils/ai-context';
import {
  buildDeterministicFollowUpMessage,
  buildOperationalIntegrityPromptBlock,
  buildTruthAwareResponseTemplate,
  sanitizeOperationalClaims,
} from '../../common/utils/operational-integrity';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import { ActionForwardingService, ActionForwardingResult } from '../action-forwarding/action-forwarding.service';

function normalizeReplyForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:()[\]{}"']/g, '')
    .trim();
}

function shouldCollapseRepeatedReply(currentReply: string, previousAssistantReply?: string): boolean {
  if (!previousAssistantReply) return false;
  const current = normalizeReplyForComparison(currentReply);
  const previous = normalizeReplyForComparison(previousAssistantReply);
  if (!current || !previous) return false;
  if (current === previous) return true;
  if (current.length < 30 || previous.length < 30) return false;
  return current.includes(previous) || previous.includes(current);
}

function enforceReplyTrustConsistency(reply: string, forwardingResult: ActionForwardingResult): string {
  const lower = reply.toLowerCase();
  const noDeliveryProof = forwardingResult.deliveryStatus !== 'DELIVERED_TO_TEAM';

  if (noDeliveryProof && /team\s+will\s+reach\s+out|please\s+expect\s+our\s+team|owner\s+has\s+been\s+notified|team\s+has\s+received/.test(lower)) {
    if (forwardingResult.canClaimCompleted) {
      return 'I have logged an internal request for review in this conversation context. I cannot confirm downstream team delivery yet.';
    }
    return 'I can help prepare this as a request for review once all required details are confirmed.';
  }

  if (!forwardingResult.canClaimCompleted && /i\s+(have|\'ve)\s+(logged|submitted|queued|noted)|request\s+(is|has\s+been|was)\s+(logged|submitted|queued|noted)/.test(lower)) {
    return forwardingResult.missingFields && forwardingResult.missingFields.length > 0
      ? `I can help log this for review once I have: ${forwardingResult.missingFields.join(', ')}.`
      : 'I can help prepare this as a request for review for our team.';
  }

  return reply;
}

function isBlockedCapabilityReason(reason?: string): boolean {
  return reason === 'SKILL_NOT_ENABLED'
    || reason === 'CHANNEL_NOT_ALLOWED'
    || reason === 'EXECUTOR_DISABLED'
    || reason === 'FORWARDING_DISABLED';
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function estimateUsageCredits(promptTokens: number, completionTokens: number): number {
  return computeUsageCredits(promptTokens, completionTokens, 1);
}

function toTitleWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function buildBrandedFromName(
  organizationName: string | null | undefined,
  replyToEmail: string | null | undefined,
  fallback: string,
): string {
  const org = (organizationName ?? '').trim();
  const localPart = (replyToEmail ?? '').split('@')[0] ?? '';
  const prefix = toTitleWords(localPart);

  if (org && prefix) return `${org} ${prefix}`;
  if (org) return org;
  return fallback;
}

export interface EmailMessageJob {
  botId: string;
  organizationId: string;
  /** The Zuti-hosted or custom address that received the email */
  toAddress: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  /** Message-ID header from the inbound email — used for In-Reply-To threading */
  messageId: string;
  /** In-Reply-To header — if set, this is a reply in an existing thread */
  inReplyTo?: string;
}

@Processor(EMAIL_QUEUE)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly events: EventsGateway,
    private readonly orgs: OrganizationsService,
    private readonly notifications: NotificationsService,
    private readonly cannedResponses: CannedResponsesService,
    private readonly teamChat: TeamChatService,
    private readonly aiUsage: AiUsageService,
    private readonly csatClassifier: CsatClassifierService,
    private readonly billing: BillingService,
    private readonly activity: ActivityService,
    private readonly actionForwarding: ActionForwardingService,
  ) {}

  @Process()
  async handle(job: Job<EmailMessageJob>) {
    const {
      botId, organizationId, toAddress,
      fromEmail, fromName, subject,
      bodyText, messageId, inReplyTo,
    } = job.data;

    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!bot) return;

    // ── Find or create conversation ──────────────────────────────────────────
    // Thread by: open conversation for this customer+bot, OR match by inReplyTo
    const existing = await this.prisma.conversation.findFirst({
      where: {
        botId,
        organizationId,
        channel: 'EMAIL',
        customerEmail: fromEmail.toLowerCase(),
        OR: [
          { status: { not: 'RESOLVED' } },
          {
            status: 'RESOLVED',
            metadata: { path: ['awaitingCsat'], equals: true },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    let conversation: Awaited<ReturnType<typeof this.prisma.conversation.create>>;

    if (!existing) {
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          channel: 'EMAIL',
          customerEmail: fromEmail.toLowerCase(),
          customerName: fromName || null,
          emailThreadId: messageId,  // anchor thread on first Message-ID
          emailSubject: subject,
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      this.events.emitNewConversation(organizationId, {
        ...conversation,
        bot: { id: botId, name: bot.name },
        messages: [],
      });
    } else if (existing.status === 'RESOLVED' && (existing.metadata as Record<string, unknown> | null)?.awaitingCsat !== true) {
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          channel: 'EMAIL',
          customerEmail: fromEmail.toLowerCase(),
          customerName: fromName || null,
          emailThreadId: messageId,
          emailSubject: subject,
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      this.events.emitNewConversation(organizationId, conversation);
    } else {
      conversation = await this.prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date(), customerName: fromName || existing.customerName },
      });
    }

    // Store user message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: bodyText.trim(),
      },
    });

    this.events.emitNewMessage(organizationId, {
      conversationId: conversation.id,
      message: userMessage,
      customerName: conversation.customerName,
    });

    let forwardingResult: ActionForwardingResult = {
      status: 'NO_INTENT',
      reason: 'SYSTEM_ERROR',
      canClaimCompleted: false,
      claimLevel: 'REQUESTED',
      deliveryStatus: 'DELIVERY_UNKNOWN',
      operationalTruth: {
        intentDetected: false,
        capabilityEnabled: false,
        actionAttempted: false,
        actionResult: 'FAILED',
        deliveryStatus: 'DELIVERY_UNKNOWN',
        missingFields: [],
        evidenceIds: [],
      },
    };
    await this.actionForwarding.detectAndQueue({
      organizationId,
      botId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: bodyText.trim(),
      channel: 'EMAIL',
      customerName: conversation.customerName,
      customerEmail: conversation.customerEmail,
      actionForwardingEnabled: bot.actionForwardingEnabled === true,
    }).then((result) => {
      forwardingResult = result;
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Action forwarding detect failed (email): ${msg}`);
      forwardingResult = {
        status: 'NO_INTENT',
        reason: 'SYSTEM_ERROR',
        canClaimCompleted: false,
        claimLevel: 'REQUESTED',
        deliveryStatus: 'DELIVERY_UNKNOWN',
        operationalTruth: {
          intentDetected: false,
          capabilityEnabled: false,
          actionAttempted: false,
          actionResult: 'FAILED',
          deliveryStatus: 'DELIVERY_UNKNOWN',
          missingFields: [],
          evidenceIds: [],
        },
      };
    });

    if (conversation.mode !== 'AI') return;

    // CSAT collection: if conversation is awaiting satisfaction response, handle it
    const existingMeta = (conversation as any).metadata as Record<string, unknown> | undefined;
    if (conversation.status === 'PENDING' && existingMeta?.awaitingCsat === true) {
      const aiConfig2 = (bot.aiConfig as Record<string, string>) ?? {};
      const lastAssistantMessage = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, role: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      const rating = await this.csatClassifier.classify({
        organizationId,
        botId,
        conversationId: conversation.id,
        channel: 'EMAIL',
        userReply: bodyText.trim(),
        lastAssistantMessage: lastAssistantMessage?.content ?? null,
      });
      const fromAddress2 = bot.organization?.slug
        ? `${bot.organization.slug}@bords.app`
        : (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app');
      if (rating === 'positive') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'RESOLVED', metadata: { ...existingMeta, awaitingCsat: false, csatRating: 'positive' } },
        });
        await this.activity.log(
          organizationId,
          null,
          'CSAT System',
          ActivityAction.CSAT_RECORDED_POSITIVE,
          'conversation',
          conversation.id,
          { channel: 'EMAIL', rating: 'positive' },
        ).catch(() => null);
        this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'RESOLVED' });
        await this.sendEmail(fromAddress2, toAddress, fromEmail, `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
          'Great, glad I could help! Feel free to reach out any time.', conversation.emailThreadId, bot.name, bot.organization?.name ?? '');
        return;
      } else if (rating === 'negative') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...existingMeta, awaitingCsat: false, csatRating: 'negative' } },
        });
        await this.activity.log(
          organizationId,
          null,
          'CSAT System',
          ActivityAction.CSAT_RECORDED_NEGATIVE,
          'conversation',
          conversation.id,
          { channel: 'EMAIL', rating: 'negative' },
        ).catch(() => null);
        this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'OPEN' });
        // Fall through — re-engage AI
      } else {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...existingMeta, awaitingCsat: false } },
        });
        this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'OPEN' });
      }
    }

    const aiConfig = (bot.aiConfig as Record<string, unknown>) ?? {};
    const systemPrompt = buildAgentSystemPrompt(aiConfig, bot.name);
    const routeToRoles = Array.isArray(bot.routeToRoles) && bot.routeToRoles.length > 0
      ? bot.routeToRoles
      : ['AGENT'];
    await this.callAiAndRespond(
      conversation, botId, toAddress, fromEmail, organizationId,
      bodyText.trim(), bot.name, systemPrompt,
      buildSkillBehaviorPromptBlock(aiConfig, forwardingResult.actionType),
      bot.organization?.name ?? null,
      bot.organization?.slug ?? null,
      forwardingResult,
      routeToRoles,
      userMessage.id,
    );
  }

  private async callAiAndRespond(
    conversation: { id: string; emailThreadId: string | null; emailSubject: string | null },
    botId: string,
    toAddress: string,
    customerEmail: string,
    organizationId: string,
    userText: string,
    botName: string,
    systemPrompt: string | null,
    skillBehaviorPrompt: string | null,
    orgName: string | null,
    orgSlug: string | null,
    forwardingResult: ActionForwardingResult,
    routeToRoles: string[] = ['AGENT'],
    inboundMessageId?: string,
  ) {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    // from = {orgSlug}@bords.app so it's on a verified sending domain; reply_to = bot's actual address
    const fromAddress = orgSlug
      ? `${orgSlug}@bords.app`
      : (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app');

    // Human escalation check (same phrases as Telegram)
    const humanRequestPhrases = [
      'speak to a human', 'talk to a human', 'speak with a human', 'talk with a human',
      'speak to a person', 'talk to a person', 'real person', 'real human',
      'live agent', 'human agent', 'i want a human', 'i need a human',
      'escalate', 'transfer me', 'transfer to human',
    ];
    if (humanRequestPhrases.some((p) => userText.toLowerCase().includes(p))) {
      const bestAgent = await this.orgs.findBestAgent(organizationId, undefined, routeToRoles);
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'ESCALATED',
          mode: 'HUMAN',
          ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
        },
      });
      this.events.emitConversationUpdate(organizationId, {
        conversationId: conversation.id,
        status: 'ESCALATED',
        mode: 'HUMAN',
        ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
      });
      if (!bestAgent) {
        await this.notifications.createOrgNotification(
          organizationId,
          'no_agent_available',
          '⚠️ Escalated conversation — no agent available',
          'A customer requested a human agent but all agents are unavailable or at capacity. Please assign the conversation manually.',
          { conversationId: conversation.id },
        );
      }
      const handoffMsg = bestAgent
        ? `Of course! I am connecting you with ${bestAgent.name}, one of our support agents, who will follow up shortly.`
        : 'Of course! I am connecting you with a human agent who will follow up shortly. Please note our team is currently busy — someone will reach out to you as soon as possible.';
      await this.sendEmail(
        fromAddress, toAddress, customerEmail,
        `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
        handoffMsg,
        conversation.emailThreadId,
        botName, orgName ?? '',
      );
      return;
    }

    // Hard capability gate before any LLM call.
    if (isBlockedCapabilityReason(forwardingResult.reason)) {
      const deterministic = buildDeterministicFollowUpMessage({
        actionType: forwardingResult.actionType,
        forwardingReason: forwardingResult.reason,
        blockedCapability: forwardingResult.blockedCapability,
      }) ?? 'This workflow is not enabled on this bot. I can route you to a human teammate for help.';

      const aiMessage = await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: deterministic },
      });
      this.events.emitNewMessage(organizationId, {
        conversationId: conversation.id,
        message: aiMessage,
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      await this.sendEmail(
        fromAddress, toAddress, customerEmail,
        `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
        deterministic,
        conversation.emailThreadId,
        botName, orgName ?? '',
      );
      return;
    }

    // Fetch compact history inputs
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const priorForAi = recentMessages.filter((m) => !(m.role === 'USER' && m.content.trim() === userText.trim()));

    // Build customer context from previous email conversations — only on first message.
    const emailConv = priorForAi.length === 0
      ? await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: { customerEmail: true },
        })
      : null;
    let previousCustomerContext: string | null = null;
    if (emailConv?.customerEmail) {
      const prevConvs = await this.prisma.conversation.findMany({
        where: {
          organizationId,
          customerEmail: emailConv.customerEmail,
          NOT: { id: conversation.id },
          status: 'RESOLVED',
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 3,
        select: {
          metadata: true,
          messages: {
            where: { role: 'USER' },
            orderBy: { createdAt: 'asc' },
            take: 10,
            select: { content: true },
          },
        },
      });
      if (prevConvs.length > 0) {
        const GREETINGS = /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|yo|sup)[^a-z]*$/i;
        const lines = prevConvs.map((pc, i) => {
          const meta = pc.metadata as Record<string, unknown> | null;
          const summary = typeof meta?.handoffSummary === 'string' ? meta.handoffSummary : null;
          if (summary) return `${i + 1}. ${summary.slice(0, 300)}`;
          const firstSubstantive = pc.messages.find((m) => m.content.trim().length > 10 && !GREETINGS.test(m.content.trim()));
          return firstSubstantive
            ? `${i + 1}. Customer previously asked: ${firstSubstantive.content.trim().slice(0, 200)}`
            : null;
        }).filter(Boolean);
        if (lines.length > 0) previousCustomerContext = lines.join('\n');
      }
    }

    const latestConversation = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { metadata: true },
    });
    const aiContext = buildCompactAiContext({
      conversation,
      priorMessages: priorForAi,
      forwarding: forwardingResult,
      previousCustomerContext,
    });
    const history = aiContext.history;
    const customerContext = aiContext.customerContext;

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        metadata: buildConversationMetadataPatch(latestConversation?.metadata, aiContext) as Prisma.InputJsonValue,
      },
    }).catch(() => null);

    const preflightPromptTokens = estimateTokens({ userText, history, customerContext });
    const preflightCredits = estimateUsageCredits(preflightPromptTokens, 1);
    await this.billing.assertMinimumCredits(organizationId, preflightCredits);

    const effectiveSystemPrompt = [
      systemPrompt,
      aiContext.statePrompt,
      aiContext.responseStylePrompt,
      skillBehaviorPrompt,
      buildOperationalIntegrityPromptBlock(
        forwardingResult.status,
        forwardingResult.reason,
        forwardingResult.missingFields,
        forwardingResult.blockedCapability,
        forwardingResult.actionTaskId,
        forwardingResult.claimLevel,
        forwardingResult.deliveryStatus,
      ),
    ].filter(Boolean).join('\n\n');

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversation.id,
          organization_id: organizationId,
          bot_id: botId,
          message: userText,
          history,
          bot_name: botName,
          org_name: orgName,
          system_prompt: effectiveSystemPrompt,
          customer_context: [customerContext, await this.cannedResponses.buildPromptBlock(organizationId)].filter(Boolean).join('\n\n') || null,
          forwarding_status: forwardingResult.status,
          forwarding_reason: forwardingResult.reason,
          action_task_id: forwardingResult.actionTaskId ?? null,
          can_claim_completed: forwardingResult.canClaimCompleted,
          missing_fields: forwardingResult.missingFields ?? [],
          blocked_capability: forwardingResult.blockedCapability ?? null,
          claim_level: forwardingResult.claimLevel,
          delivery_status: forwardingResult.deliveryStatus,
          operational_truth: forwardingResult.operationalTruth,
        }),
      );

      const aiText: string = response.data?.reply ?? 'I am unable to respond right now.';
      const shouldResolve: boolean = response.data?.should_resolve === true;
      const promptTokens = estimateTokens({ userText, history, customerContext });
      const completionTokens = estimateTokens(aiText);

      await this.billing.debitUsageCredits({
        organizationId,
        usageType: 'CUSTOMER_REPLY',
        promptTokens,
        completionTokens,
        idempotencyKey: `email:${inboundMessageId ?? conversation.id}`,
        metadata: {
          channel: 'EMAIL',
          conversationId: conversation.id,
          botId,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      });

      await this.aiUsage.record({
        organizationId,
        botId,
        conversationId: conversation.id,
        usageType: 'CUSTOMER_REPLY',
        provider: 'openrouter',
        promptTokens,
        completionTokens,
        metadata: {
          channel: 'EMAIL',
          answerability: response.data?.answerability,
          confidence: response.data?.confidence,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      }).catch(() => null);

      // Auto-escalate check
      const escalationPhrases = [
        "i don't know", "i am not sure", "i'm not sure", "i cannot help",
        "i can't help", "please contact support", "contact us directly",
      ];
      const shouldEscalate = response.data?.should_escalate === true ||
        escalationPhrases.some((p) => aiText.toLowerCase().includes(p));

      await this.aiUsage.record({
        organizationId,
        botId,
        conversationId: conversation.id,
        usageType: 'ESCALATION_ANALYSIS',
        provider: 'openrouter',
        promptTokens: 0,
        completionTokens: 0,
        metadata: {
          channel: 'EMAIL',
          decision: shouldEscalate ? 'ESCALATE' : 'CONTINUE_AI',
          reason: response.data?.should_escalate === true ? 'model_signal' : 'heuristic_signal',
          answerability: response.data?.answerability,
          confidence: response.data?.confidence,
        },
      }).catch(() => null);

      if (shouldEscalate) {
        const topic = response.data?.escalation_topic || undefined;
        const bestAgent = await this.orgs.findBestAgent(organizationId, topic, routeToRoles);
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'ESCALATED',
            mode: 'HUMAN',
            ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
          },
        });
        this.events.emitConversationUpdate(organizationId, {
          conversationId: conversation.id,
          status: 'ESCALATED',
          mode: 'HUMAN',
          ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
        });
        if (!bestAgent) {
          await this.notifications.createOrgNotification(
            organizationId,
            'no_agent_available',
            '⚠️ Escalated conversation — no agent available',
            'The AI escalated a conversation but all agents are unavailable or at capacity. Please assign the conversation manually.',
            { conversationId: conversation.id },
          );
        }
        await this.teamChat.ensureKnowledgeGapThread(organizationId, {
          conversationId: conversation.id,
          question: userText,
          topic,
          assignedUserId: bestAgent?.userId,
          senderId: bestAgent?.userId ?? (await this.findOrgSystemSender(organizationId)),
          metadata: {
            source: 'email_ai_uncertainty',
            answerability: response.data?.answerability,
            confidence: response.data?.confidence,
            routeToRoles,
          },
        }).catch((err) => this.logger.warn(`Knowledge gap thread failed: ${err?.message ?? err}`));
      }

      const safeAiText = sanitizeOperationalClaims(aiText, {
        forwardingStatus: forwardingResult.status,
        forwardingReason: forwardingResult.reason,
        actionTaskId: forwardingResult.actionTaskId,
        canClaimCompleted: forwardingResult.canClaimCompleted,
        claimLevel: forwardingResult.claimLevel,
        deliveryStatus: forwardingResult.deliveryStatus,
        missingFields: forwardingResult.missingFields,
        blockedCapability: forwardingResult.blockedCapability,
      });
      const deterministicFollowUp = buildDeterministicFollowUpMessage({
        actionType: forwardingResult.actionType,
        missingFields: forwardingResult.missingFields,
        canClaimCompleted: forwardingResult.canClaimCompleted,
        forwardingReason: forwardingResult.reason,
        blockedCapability: forwardingResult.blockedCapability,
      });
      let finalAiText = safeAiText;
      if (
        deterministicFollowUp
        && (forwardingResult.reason === 'MISSING_CONTACT_INFO' || forwardingResult.reason === 'MISSING_REQUIRED_FIELDS')
        && /logged|submitted|queued|noted|team\s+will\s+reach\s+out|owner\s+has\s+been\s+notified/i.test(safeAiText)
      ) {
        finalAiText = deterministicFollowUp;
      }
      finalAiText = enforceReplyTrustConsistency(finalAiText, forwardingResult);
      const truthTemplate = buildTruthAwareResponseTemplate({
        forwardingStatus: forwardingResult.status,
        forwardingReason: forwardingResult.reason,
        canClaimCompleted: forwardingResult.canClaimCompleted,
        claimLevel: forwardingResult.claimLevel,
        deliveryStatus: forwardingResult.deliveryStatus,
        actionType: forwardingResult.actionType,
        missingFields: forwardingResult.missingFields,
        blockedCapability: forwardingResult.blockedCapability,
      });
      if (
        truthTemplate
        && (
          Boolean(forwardingResult.actionType)
          ||
          forwardingResult.reason === 'SYSTEM_ERROR'
          || forwardingResult.operationalTruth.actionResult === 'UNKNOWN'
          || forwardingResult.operationalTruth.actionResult === 'FAILED'
          || /logged|submitted|queued|noted|team\s+will\s+reach\s+out|owner\s+has\s+been\s+notified|i\s+can\s+confirm|i\s+checked/i.test(finalAiText)
        )
      ) {
        finalAiText = truthTemplate;
      }
      const latestAssistantReply = recentMessages.find((m) => m.role === 'ASSISTANT')?.content;
      if (shouldCollapseRepeatedReply(finalAiText, latestAssistantReply)) {
        finalAiText = forwardingResult.canClaimCompleted
          ? 'I have already logged the internal request for review in this conversation. I cannot confirm downstream delivery yet.'
          : 'I understand. I can continue helping once you share the remaining required details.';
      }

      this.logger.debug(
        `Operational truth (email): status=${forwardingResult.status} reason=${forwardingResult.reason} claimLevel=${forwardingResult.claimLevel} delivery=${forwardingResult.deliveryStatus} canClaimCompleted=${forwardingResult.canClaimCompleted}`,
      );

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: finalAiText },
      });
      this.events.emitNewMessage(organizationId, {
        conversationId: conversation.id,
        message: aiMessage,
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // Send email reply
      await this.sendEmail(
        fromAddress, toAddress, customerEmail,
        `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
        finalAiText,
        conversation.emailThreadId,
        botName, orgName ?? '',
      );

      // Auto-resolve: AI signalled done and no escalation is needed.
      // Keep in PENDING awaiting CSAT so the next reply is classified on this thread.
      if (shouldResolve) {
        if (!shouldEscalate) {
          const currentMeta = ((await this.prisma.conversation.findUnique({ where: { id: conversation.id }, select: { metadata: true } }))?.metadata as Record<string, unknown> | null) ?? {};
          const { csatRating, ...metaWithoutCstatRating } = currentMeta;
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'PENDING', metadata: { ...metaWithoutCstatRating, awaitingCsat: true } },
          });
          this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'PENDING' });
        }
      }
    } catch (err) {
      this.logger.error(`AI/email error for conversation ${conversation.id}: ${err}`);
    }
  }

  private async findOrgSystemSender(organizationId: string): Promise<string> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (member) return member.userId;
    const fallback = await this.prisma.organizationMember.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return fallback?.userId ?? '';
  }

  private async sendEmail(
    from: string,
    replyTo: string,
    to: string,
    subject: string,
    text: string,
    inReplyTo: string | null,
    botName: string,
    orgName: string,
  ) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    if (!apiKey) {
      this.logger.warn('ZEPTOMAIL_API_KEY not set — skipping email send');
      return;
    }
    const baseFromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
    const fromName = buildBrandedFromName(orgName, replyTo, baseFromName);

    const mimeHeaders: Record<string, string> = {};
    if (inReplyTo) {
      mimeHeaders['In-Reply-To'] = `<${inReplyTo}>`;
      mimeHeaders['References'] = `<${inReplyTo}>`;
    }

    // Render HTML template
    const htmlbody = await render(
      React.createElement(BotReplyEmail, { botName, orgName: orgName || botName, replyText: text }),
    );

    // Strip markdown for plain-text fallback (** bold **, * italic *, # headings, - bullets)
    const textbody = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[-*]\s/gm, '• ')
      .trim();

    await firstValueFrom(
      this.http.post(
        'https://api.zeptomail.com/v1.1/email',
        {
          from: { address: from, name: fromName },
          reply_to: [{ address: replyTo }],
          to: [{ email_address: { address: to } }],
          subject,
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
    );
  }
}
