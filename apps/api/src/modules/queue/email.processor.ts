import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Job } from 'bull';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import * as React from 'react';
import { BotReplyEmail } from '../mail/templates/BotReplyEmail';

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
import { buildAgentSystemPrompt } from '../../common/utils/agent-config';
import {
  buildOperationalIntegrityPromptBlock,
  sanitizeOperationalClaims,
} from '../../common/utils/operational-integrity';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import { ActionForwardingService, ActionForwardingResult } from '../action-forwarding/action-forwarding.service';

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

    const aiConfig = (bot.aiConfig as Record<string, string>) ?? {};
    const systemPrompt = buildAgentSystemPrompt(aiConfig, bot.name);
    const routeToRoles = Array.isArray(bot.routeToRoles) && bot.routeToRoles.length > 0
      ? bot.routeToRoles
      : ['AGENT'];
    await this.callAiAndRespond(
      conversation, botId, toAddress, fromEmail, organizationId,
      bodyText.trim(), bot.name, systemPrompt,
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

    // Fetch token-budgeted history
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const TOKEN_BUDGET = 3000;
    let tokenCount = 0;
    const trimmed: typeof recentMessages = [];
    for (const m of recentMessages) {
      const est = Math.ceil(m.content.length / 4);
      if (tokenCount + est > TOKEN_BUDGET) break;
      tokenCount += est;
      trimmed.unshift(m);
    }
    const history = trimmed.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Build customer context from previous email conversations — only on first message.
    const emailConv = history.length === 0
      ? await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: { customerEmail: true },
        })
      : null;
    let customerContext: string | null = null;
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
        if (lines.length > 0) customerContext = lines.join('\n');
      }
    }

    const preflightPromptTokens = estimateTokens({ userText, history, customerContext });
    const preflightCredits = estimateUsageCredits(preflightPromptTokens, 1);
    await this.billing.assertMinimumCredits(organizationId, preflightCredits);

    const effectiveSystemPrompt = [
      systemPrompt,
      buildOperationalIntegrityPromptBlock(
        forwardingResult.status,
        forwardingResult.reason,
        forwardingResult.missingFields,
        forwardingResult.blockedCapability,
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
        missingFields: forwardingResult.missingFields,
        blockedCapability: forwardingResult.blockedCapability,
      });

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: safeAiText },
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
        safeAiText,
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
