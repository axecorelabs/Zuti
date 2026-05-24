import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TELEGRAM_QUEUE } from './queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EventsGateway } from '../events/events.gateway';
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

/** Convert markdown to Telegram HTML (parse_mode: 'HTML').
 *  Telegram supports: <b>, <i>, <s>, <u>, <code>, <pre>, <a href="">.
 */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function estimateUsageCredits(promptTokens: number, completionTokens: number): number {
  return computeUsageCredits(promptTokens, completionTokens, 1);
}

function markdownToTelegramHtml(text: string): string {
  // Escape HTML special chars FIRST (before we insert our own tags)
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Process fenced code blocks first (multiline, preserve content)
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${esc(code.trim())}</code></pre>`,
  );

  // Process line by line for headings, blockquotes, lists
  text = text
    .split('\n')
    .map((line) => {
      // Headings → bold
      const heading = line.match(/^#{1,6}\s+(.+)/);
      if (heading) return `<b>${esc(heading[1])}</b>`;
      // Blockquotes → italic prefix
      const quote = line.match(/^>\s?(.*)/);
      if (quote) return `<i>${esc(quote[1])}</i>`;
      // Unordered list
      const ulist = line.match(/^[-*+]\s+(.*)/);
      if (ulist) return `\u2022 ${ulist[1]}`;
      // Ordered list — keep as-is
      return line;
    })
    .join('\n');

  // Inline formatting (order matters: bold+italic before bold/italic)
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/gs, (_, c) => `<b><i>${esc(c)}</i></b>`)
    .replace(/\*\*(.+?)\*\*/gs,     (_, c) => `<b>${esc(c)}</b>`)
    .replace(/__(.+?)__/gs,          (_, c) => `<b>${esc(c)}</b>`)
    .replace(/\*(.+?)\*/gs,          (_, c) => `<i>${esc(c)}</i>`)
    .replace(/_(.+?)_/gs,            (_, c) => `<i>${esc(c)}</i>`)
    .replace(/~~(.+?)~~/gs,          (_, c) => `<s>${esc(c)}</s>`)
    .replace(/`(.+?)`/gs,            (_, c) => `<code>${esc(c)}</code>`)
    .replace(/!\[.*?\]\(.*?\)/g, '') // remove images
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => `<a href="${url}">${esc(label)}</a>`);

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export interface TelegramMessageJob {
  botId: string;
  telegramChatId: string;
  telegramToken: string;
  organizationId: string;
  message: {
    messageId: number;
    text: string;
    from: {
      id: number;
      username?: string;
      firstName?: string;
      lastName?: string;
    };
  };
}

@Processor(TELEGRAM_QUEUE)
export class TelegramProcessor {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
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
  async handleMessage(job: Job<TelegramMessageJob>) {
    const { botId, telegramChatId, telegramToken, organizationId, message } = job.data;
    this.logger.log(`Processing message from chat ${telegramChatId}`);

    // Upsert conversation
    const customerName = [message.from.firstName, message.from.lastName]
      .filter(Boolean)
      .join(' ') || message.from.username || String(message.from.id);

    // Check for the most recent conversation for this customer
    const existing = await this.prisma.conversation.findFirst({
      where: { botId, telegramChatId },
      orderBy: { createdAt: 'desc' },
    });

    let conversation: Awaited<ReturnType<typeof this.prisma.conversation.create>>;

    if (!existing) {
      // First ever message from this customer
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          telegramChatId,
          customerName,
          customerUsername: message.from.username,
          channel: 'TELEGRAM',
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      // Emit new conversation to inbox
      this.events.emitNewConversation(organizationId, {
        ...conversation,
        bot: { id: botId, name: '' },
        messages: [],
      });
    } else if (existing.status === 'RESOLVED' && (existing.metadata as Record<string, unknown> | null)?.awaitingCsat !== true) {
      // Customer re-opened after resolution — create a fresh conversation
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          telegramChatId,
          customerName,
          customerUsername: message.from.username,
          channel: 'TELEGRAM',
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      // Emit new conversation to inbox
      this.events.emitNewConversation(organizationId, conversation);
    } else {
      // Existing active conversation — just update metadata
      conversation = await this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastMessageAt: new Date(),
          customerName,
          customerUsername: message.from.username,
        },
      });
    }

    // Store incoming message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: message.text,
        telegramMsgId: message.messageId,
      },
    });

    // Emit to inbox in real-time
    this.events.emitNewMessage(organizationId, {
      conversationId: conversation.id,
      message: userMessage,
      customerName: conversation.customerName,
    });

    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: { name: true, aiConfig: true, routeToRoles: true, actionForwardingEnabled: true },
    });
    let forwardingResult: ActionForwardingResult = {
      status: 'NO_INTENT',
      reason: 'SYSTEM_ERROR',
      canClaimCompleted: false,
    };
    await this.actionForwarding.detectAndQueue({
      organizationId,
      botId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: message.text,
      channel: 'TELEGRAM',
      customerName: conversation.customerName,
      customerEmail: null,
      actionForwardingEnabled: bot?.actionForwardingEnabled === true,
    }).then((result) => {
      forwardingResult = result;
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Action forwarding detect failed (telegram): ${msg}`);
      forwardingResult = {
        status: 'NO_INTENT',
        reason: 'SYSTEM_ERROR',
        canClaimCompleted: false,
      };
    });

    // If in AI mode, call AI service
    if (conversation.mode === 'AI') {
      // CSAT collection: if conversation is awaiting satisfaction response, handle it
      const convMeta = (conversation.metadata as Record<string, unknown>) ?? {};
      if (conversation.status === 'PENDING' && convMeta.awaitingCsat === true) {
        const lastAssistantMessage = await this.prisma.message.findFirst({
          where: { conversationId: conversation.id, role: 'ASSISTANT' },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        });
        const aiConfig = (bot?.aiConfig as Record<string, string>) ?? {};
        const rating = await this.csatClassifier.classify({
          organizationId,
          botId,
          conversationId: conversation.id,
          channel: 'TELEGRAM',
          userReply: message.text.trim(),
          lastAssistantMessage: lastAssistantMessage?.content ?? null,
        });
        if (rating === 'positive') {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'RESOLVED', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'positive' } },
          });
          await this.activity.log(
            organizationId,
            null,
            'CSAT System',
            ActivityAction.CSAT_RECORDED_POSITIVE,
            'conversation',
            conversation.id,
            { channel: 'TELEGRAM', rating: 'positive' },
          ).catch(() => null);
          this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'RESOLVED' });
          // Thank them naturally
          await firstValueFrom(
            this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
              chat_id: telegramChatId,
              text: 'Great, glad I could help! Feel free to reach out any time.',
            }),
          );
          return;
        } else if (rating === 'negative') {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'negative' } },
          });
          await this.activity.log(
            organizationId,
            null,
            'CSAT System',
            ActivityAction.CSAT_RECORDED_NEGATIVE,
            'conversation',
            conversation.id,
            { channel: 'TELEGRAM', rating: 'negative' },
          ).catch(() => null);
          this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'OPEN' });
          // Re-engage AI for the follow-up
        } else {
          // Unclear — new question or ambiguous, reopen and let AI handle it
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false } },
          });
          this.events.emitConversationUpdate(organizationId, { conversationId: conversation.id, status: 'OPEN' });
        }
      }
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
      const aiConfig = (bot?.aiConfig as Record<string, string>) ?? {};
      const systemPrompt = buildAgentSystemPrompt(aiConfig, bot?.name ?? 'Assistant');
      const routeToRoles = Array.isArray(bot?.routeToRoles) && bot.routeToRoles.length > 0
        ? bot.routeToRoles
        : ['AGENT'];
      await this.callAiAndRespond(
        conversation.id, botId, telegramChatId, telegramToken, organizationId, message.text,
        bot?.name ?? 'Assistant', systemPrompt, org?.name ?? null, forwardingResult, routeToRoles, userMessage.id,
      );
    }
  }

  private async callAiAndRespond(
    conversationId: string,
    botId: string,
    telegramChatId: string,
    telegramToken: string,
    organizationId: string,
    userText: string,
    botName: string = 'Assistant',
    systemPrompt: string | null = null,
    orgName: string | null = null,
    forwardingResult: ActionForwardingResult,
    routeToRoles: string[] = ['AGENT'],
    inboundMessageId?: string,
  ) {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const effectiveSystemPrompt = [
      systemPrompt,
      buildOperationalIntegrityPromptBlock(
        forwardingResult.status,
        forwardingResult.reason,
        forwardingResult.missingFields,
        forwardingResult.blockedCapability,
        forwardingResult.actionTaskId,
      ),
    ].filter(Boolean).join('\n\n');

    // Check if the user is explicitly requesting a human agent
    const humanRequestPhrases = [
      'speak to a human', 'talk to a human', 'speak with a human', 'talk with a human',
      'speak to a person', 'talk to a person', 'speak with a person', 'talk with a person',
      'speak to an agent', 'talk to an agent', 'speak with an agent', 'connect me to an agent',
      'real person', 'real human', 'actual person', 'live agent', 'human agent',
      'i want a human', 'i need a human', 'get me a human',
      'escalate', 'transfer me', 'transfer to human',
    ];
    const lowerUserText = userText.toLowerCase();
    const userRequestsHuman = humanRequestPhrases.some((p) => lowerUserText.includes(p));

    if (userRequestsHuman) {
      const bestAgent = await this.orgs.findBestAgent(organizationId, undefined, routeToRoles);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'ESCALATED',
          mode: 'HUMAN',
          ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
        },
      });
      this.events.emitConversationUpdate(organizationId, {
        conversationId,
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
          { conversationId },
        );
      }
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: bestAgent
            ? `Of course! I am connecting you with ${bestAgent.name}, one of our support agents, who will follow up shortly.`
            : 'Of course! I am connecting you with a human agent who will follow up shortly. Please note our team is currently busy — someone will reach out to you as soon as possible.',
        }),
      );
      return;
    }

    // Fetch conversation history — newest 40 from DB, then trim by token budget
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const TOKEN_BUDGET = 3000;
    let tokenCount = 0;
    const trimmed: typeof recentMessages = [];
    for (const m of recentMessages) { // already newest-first
      const est = Math.ceil(m.content.length / 4);
      if (tokenCount + est > TOKEN_BUDGET) break;
      tokenCount += est;
      trimmed.unshift(m); // restore chronological order
    }
    const history = trimmed.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Build customer context from previous Telegram conversations — only on first message.
    const conv = history.length === 0
      ? await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { telegramChatId: true },
        })
      : null;
    let customerContext: string | null = null;
    if (conv?.telegramChatId) {
      const prevConvs = await this.prisma.conversation.findMany({
        where: {
          organizationId,
          telegramChatId: conv.telegramChatId,
          NOT: { id: conversationId },
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

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversationId,
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
        idempotencyKey: `telegram:${inboundMessageId ?? conversationId}`,
        metadata: {
          channel: 'TELEGRAM',
          conversationId,
          botId,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      });

      await this.aiUsage.record({
        organizationId,
        botId,
        conversationId,
        usageType: 'CUSTOMER_REPLY',
        provider: 'openrouter',
        promptTokens,
        completionTokens,
        metadata: {
          channel: 'TELEGRAM',
          answerability: response.data?.answerability,
          confidence: response.data?.confidence,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      }).catch(() => null);

      // Auto-escalate if AI expresses uncertainty
      const escalationPhrases = [
        "i don't know", "i am not sure", "i'm not sure", "i cannot help",
        "i can't help", "please contact support", "speak to a human",
        "talk to an agent", "reach out to our team", "contact us directly",
      ];
      const lowerReply = aiText.toLowerCase();
      const shouldEscalate = response.data?.should_escalate === true ||
        escalationPhrases.some((p) => lowerReply.includes(p));

      await this.aiUsage.record({
        organizationId,
        botId,
        conversationId,
        usageType: 'ESCALATION_ANALYSIS',
        provider: 'openrouter',
        promptTokens: 0,
        completionTokens: 0,
        metadata: {
          channel: 'TELEGRAM',
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
          where: { id: conversationId },
          data: {
            status: 'ESCALATED',
            mode: 'HUMAN',
            ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
          },
        });
        this.events.emitConversationUpdate(organizationId, {
          conversationId,
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
            { conversationId },
          );
        }
        await this.teamChat.ensureKnowledgeGapThread(organizationId, {
          conversationId,
          question: userText,
          topic,
          assignedUserId: bestAgent?.userId,
          senderId: bestAgent?.userId ?? (await this.findOrgSystemSender(organizationId)),
          metadata: {
            source: 'telegram_ai_uncertainty',
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
        missingFields: forwardingResult.missingFields,
        blockedCapability: forwardingResult.blockedCapability,
      });

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: safeAiText,
        },
      });

      // Emit AI reply to inbox
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
      if (conv) {
        this.events.emitNewMessage(conv.organizationId, {
          conversationId,
          message: aiMessage,
        });
      }

      // Send reply to Telegram — convert markdown to Telegram HTML for proper formatting
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: markdownToTelegramHtml(safeAiText),
          parse_mode: 'HTML',
        }),
      );

      // Auto-resolve: AI signalled the conversation is done and no escalation is needed.
      // Keep in PENDING awaiting CSAT so the next reply is classified on this same conversation.
      if (shouldResolve && !shouldEscalate) {
        const currentMeta = ((await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { metadata: true } }))?.metadata as Record<string, unknown> | null) ?? {};
        const { csatRating, ...metaWithoutCstatRating } = currentMeta;
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'PENDING', metadata: { ...metaWithoutCstatRating, awaitingCsat: true } },
        });
        this.events.emitConversationUpdate(organizationId, { conversationId, status: 'PENDING' });
      }

      // If escalated, send a follow-up notice to the user
      if (shouldEscalate) {
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            chat_id: telegramChatId,
            text: 'I am connecting you with a human agent who will follow up shortly.',
          }),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for conversation ${conversationId}: ${msg}`);
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
}
