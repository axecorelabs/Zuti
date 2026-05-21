import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateBotDto, UpdateBotDto } from './dto/bot.dto';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { TeamChatService } from '../team-chat/team-chat.service';
import { BillingService } from '../billing/billing.service';
import { computeUsageCredits } from '../billing/credit-model';

function detectSatisfaction(text: string): 'positive' | 'negative' | 'unclear' {
  const t = text.toLowerCase().trim();
  const POSITIVE = /\b(yes|yep|yeah|thanks|thank you|thank you so much|great|perfect|awesome|helpful|solved|sorted|works|working|excellent|exactly|good|brilliant|wonderful|that'?s all|nothing else|all good|all set|no more questions|no more|that'?s it|that helped|you helped)\b/;
  const NEGATIVE = /\b(no|nope|not really|still|doesn'?t|don'?t|isn'?t|not working|not solved|not helpful|still broken|frustrated|useless|terrible|didn'?t help|not fixed|not resolved)\b/;
  if (POSITIVE.test(t) && !NEGATIVE.test(t)) return 'positive';
  if (NEGATIVE.test(t)) return 'negative';
  return 'unclear';
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function estimateUsageCredits(promptTokens: number, completionTokens: number): number {
  return computeUsageCredits(promptTokens, completionTokens, 1);
}

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
    private readonly cannedResponses: CannedResponsesService,
    private readonly aiUsage: AiUsageService,
    private readonly teamChat: TeamChatService,
    private readonly billing: BillingService,
  ) {}

  async create(organizationId: string, dto: CreateBotDto) {
    const primaryChannel = dto.primaryChannel ?? 'TELEGRAM';
    const telegramToken = dto.telegramToken?.trim();
    const needsTelegram = primaryChannel === 'TELEGRAM';

    if (needsTelegram && !telegramToken) {
      throw new BadRequestException('Telegram token is required for Telegram bots');
    }

    let telegramUsername: string | null = null;

    if (telegramToken) {
      // Validate token with Telegram
      const botInfo = await this.getTelegramBotInfo(telegramToken);
      telegramUsername = botInfo.username;

      const existing = await this.prisma.bot.findUnique({
        where: { telegramToken },
      });
      if (existing) {
        throw new BadRequestException('This Telegram bot token is already registered');
      }
    }

    return this.prisma.bot.create({
      data: {
        organizationId,
        name: dto.name,
        primaryChannel,
        telegramToken: telegramToken ?? null,
        telegramUsername,
        webWidgetEnabled: primaryChannel === 'WEB_WIDGET',
        webWidgetKey: primaryChannel === 'WEB_WIDGET' ? this.generateWidgetKey() : null,
        isActive: true,
      },
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.bot.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(organizationId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId },
    });
    if (!bot) throw new NotFoundException('Bot not found');
    return bot;
  }

  async update(organizationId: string, botId: string, dto: UpdateBotDto) {
    const existing = await this.findOne(organizationId, botId);
    const enableWidget = dto.webWidgetEnabled === true;
    const nextAllowedDomains = dto.webWidgetAllowedDomains?.map((d) => d.trim().toLowerCase()).filter(Boolean);

    return this.prisma.bot.update({
      where: { id: botId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.aiConfig !== undefined && { aiConfig: dto.aiConfig as any }),
        ...(dto.routeToRoles !== undefined && { routeToRoles: dto.routeToRoles }),
        ...(dto.webWidgetEnabled !== undefined && { webWidgetEnabled: dto.webWidgetEnabled }),
        ...(nextAllowedDomains !== undefined && { webWidgetAllowedDomains: nextAllowedDomains }),
        ...((enableWidget && !existing.webWidgetKey) && { webWidgetKey: this.generateWidgetKey() }),
      },
    });
  }

  async remove(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    // Optionally delete webhook before removal
    if (bot.webhookSet && bot.telegramToken) {
      await this.deleteWebhook(bot.telegramToken).catch(() => null);
    }
    await this.prisma.bot.delete({ where: { id: botId } });
  }

  // ── Telegram channel ──────────────────────────────────────────────────────

  async connectTelegram(organizationId: string, botId: string, token: string) {
    await this.findOne(organizationId, botId);
    const trimmedToken = token.trim();

    const botInfo = await this.getTelegramBotInfo(trimmedToken);

    const existing = await this.prisma.bot.findUnique({ where: { telegramToken: trimmedToken } });
    if (existing && existing.id !== botId) {
      throw new BadRequestException('This Telegram bot token is already registered');
    }

    return this.prisma.bot.update({
      where: { id: botId },
      data: {
        telegramToken: trimmedToken,
        telegramUsername: botInfo.username,
        webhookSet: false,
      },
    });
  }

  async disconnectTelegram(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    if (!bot.telegramToken) throw new BadRequestException('Telegram is not connected');

    if (bot.webhookSet) {
      await this.deleteWebhook(bot.telegramToken).catch(() => null);
    }

    return this.prisma.bot.update({
      where: { id: botId },
      data: {
        telegramToken: null,
        telegramUsername: null,
        webhookSet: false,
      },
    });
  }

  // ── Email channel ──────────────────────────────────────────────────────────

  async enableEmail(organizationId: string, botId: string, localPart: string) {
    const bot = await this.findOne(organizationId, botId);

    // Validate localPart: lowercase letters, numbers, hyphens only
    if (!/^[a-z0-9-]{1,32}$/.test(localPart)) {
      throw new BadRequestException(
        'Email local part must be 1–32 characters: lowercase letters, numbers, hyphens only',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const emailAddress = `${localPart}@${org.slug}.bords.app`;

    // Check uniqueness
    const conflict = await this.prisma.bot.findFirst({
      where: { emailAddress, NOT: { id: botId } },
    });
    if (conflict) {
      throw new BadRequestException(`The address ${emailAddress} is already in use`);
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: { emailEnabled: true, emailAddress },
    });

    // Register SendGrid Inbound Parse rule for this org subdomain
    await this.registerSendGridParseRule(`${org.slug}.bords.app`).catch((err) =>
      this.logger.warn(`SendGrid parse rule registration failed: ${err?.message}`),
    );

    return { emailAddress: updated.emailAddress };
  }

  async disableEmail(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    const emailAddress = bot.emailAddress;

    await this.prisma.bot.update({
      where: { id: botId },
      data: { emailEnabled: false },
    });

    // Remove SendGrid Inbound Parse rule only if no other active email bots exist for this org subdomain
    if (emailAddress) {
      const domain = emailAddress.split('@')[1];
      const otherEmailBots = await this.prisma.bot.count({
        where: { organizationId, emailEnabled: true, id: { not: botId } },
      });
      if (otherEmailBots === 0) {
        await this.deleteSendGridParseRule(domain).catch((err) =>
          this.logger.warn(`SendGrid parse rule deletion failed: ${err?.message}`),
        );
      }
    }

    return { ok: true };
  }

  private async registerSendGridParseRule(hostname: string): Promise<void> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) return;
    const webhookUrl = `${this.config.get<string>('WEBHOOK_BASE_URL')}/api/webhooks/email`;
    await firstValueFrom(
      this.http.post(
        'https://api.sendgrid.com/v3/user/webhooks/parse/settings',
        { hostname, url: webhookUrl, spam_check: false, send_raw: false },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  private async deleteSendGridParseRule(hostname: string): Promise<void> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) return;
    await firstValueFrom(
      this.http.delete(
        `https://api.sendgrid.com/v3/user/webhooks/parse/settings/${hostname}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  async setWebhook(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    if (!bot.telegramToken) {
      throw new BadRequestException('Telegram channel is not connected for this bot');
    }
    const baseUrl = this.config.get<string>('WEBHOOK_BASE_URL');
    if (!baseUrl) {
      throw new BadRequestException('WEBHOOK_BASE_URL is not configured');
    }

    // Generate a secret token (max 256 chars, alphanumeric+underscore per Telegram docs)
    const webhookSecret = randomBytes(32).toString('hex');
    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${botId}`;
    const res = await firstValueFrom(
      this.http.post<any>(`https://api.telegram.org/bot${bot.telegramToken}/setWebhook`, {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    );

    if (!res.data.ok) {
      throw new BadRequestException(`Telegram error: ${res.data.description}`);
    }

    await this.prisma.bot.update({
      where: { id: botId },
      data: { webhookSet: true, webhookSecret },
    });

    return { webhookUrl, telegramResponse: (res as any).data };
  }

  async deleteWebhook(telegramToken: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`https://api.telegram.org/bot${telegramToken}/deleteWebhook`),
    );
  }

  private async getTelegramBotInfo(token: string): Promise<{ username: string; id: number }> {
    try {
      const res = await firstValueFrom(
        this.http.get<any>(`https://api.telegram.org/bot${token}/getMe`),
      );
      if (!res.data.ok) {
        throw new BadRequestException('Invalid Telegram bot token');
      }
      return { username: res.data.result.username, id: res.data.result.id };
    } catch {
      throw new BadRequestException('Invalid Telegram bot token');
    }
  }

  async findByWidgetKey(widgetKey: string) {
    const bot = await this.prisma.bot.findUnique({
      where: { webWidgetKey: widgetKey },
      include: { organization: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');
    if (!bot.webWidgetEnabled) throw new ForbiddenException('Widget is not enabled for this bot');
    if (!bot.isActive) throw new ForbiddenException('Bot is not active');
    return bot;
  }

  async handleWidgetMessage(
    widgetKey: string,
    payload: { message: string; visitorId?: string; visitorEmail?: string },
  ) {
    const bot = await this.findByWidgetKey(widgetKey);
    const { message: userText, visitorId, visitorEmail } = payload;

    if (!userText || !userText.trim()) {
      throw new BadRequestException('Message cannot be empty');
    }

    const customerName = visitorEmail || visitorId || 'Anonymous';
    const visitorIdKey = visitorId ? `widget_${visitorId}` : `email_${visitorEmail}`;

    // Find or create conversation — only search if at least one identifier is provided
    const visitorConditions: Array<{ widgetVisitorId?: string; widgetVisitorEmail?: string }> = [];
    if (visitorId) visitorConditions.push({ widgetVisitorId: visitorIdKey });
    if (visitorEmail) visitorConditions.push({ widgetVisitorEmail: visitorEmail });

    const existing = visitorConditions.length === 0
      ? null
      : await this.prisma.conversation.findFirst({
          where: {
            botId: bot.id,
            organizationId: bot.organizationId,
            // Never match Telegram-only conversations (they have null widget fields)
            NOT: { widgetVisitorId: null, widgetVisitorEmail: null },
            OR: visitorConditions,
            status: { not: 'RESOLVED' },
          },
          orderBy: { createdAt: 'desc' },
        });

    let conversation: Awaited<ReturnType<typeof this.prisma.conversation.create>>;

    if (!existing) {
      // Create new conversation
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId: bot.organizationId,
          botId: bot.id,
          customerName,
          widgetVisitorId: visitorId ? visitorIdKey : null,
          widgetVisitorEmail: visitorEmail,
          channel: 'WIDGET',
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      this.events.emitNewConversation(bot.organizationId, {
        id: conversation.id,
        customerName,
        status: 'OPEN',
        mode: 'AI',
        botId: bot.id,
        bot: { id: bot.id, name: bot.name },
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: [],
      });
    } else {
      // Update existing conversation
      conversation = await this.prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
    }

    // Store user message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: userText.trim(),
      },
    });

    this.events.emitNewMessage(bot.organizationId, {
      conversationId: conversation.id,
      message: { id: userMessage.id, role: userMessage.role, content: userMessage.content, createdAt: userMessage.createdAt },
    });

    // CSAT collection: if conversation is awaiting satisfaction response, handle it
    const convMeta = (conversation.metadata as Record<string, unknown>) ?? {};
    if (conversation.status === 'PENDING' && convMeta.awaitingCsat === true) {
      const rating = detectSatisfaction(userText.trim());
      if (rating === 'positive') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'RESOLVED', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'positive' } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'RESOLVED' });
        const thankMsg = await this.prisma.message.create({
          data: { conversationId: conversation.id, role: 'ASSISTANT', content: 'Great, glad I could help! Feel free to reach out any time.' },
        });
        this.events.emitNewMessage(bot.organizationId, {
          conversationId: conversation.id,
          message: { id: thankMsg.id, role: thankMsg.role, content: thankMsg.content, createdAt: thankMsg.createdAt },
        });
        return { conversationId: conversation.id, message: thankMsg.content };
      } else if (rating === 'negative') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'negative' } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'OPEN' });
        // Fall through — re-engage AI
      } else {
        // New question — reopen silently, let AI handle it
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'OPEN' });
      }
    }
    // Fetch newest 40 from DB (cheap), then trim by token budget in memory
    const priorMessages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, NOT: { id: userMessage.id } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    // Build token-budgeted window (~4 chars ≈ 1 token, budget = 3000 tokens)
    const TOKEN_BUDGET = 3000;
    let tokenCount = 0;
    const trimmed: typeof priorMessages = [];
    for (const m of priorMessages) { // already newest-first
      const est = Math.ceil(m.content.length / 4);
      if (tokenCount + est > TOKEN_BUDGET) break;
      tokenCount += est;
      trimmed.unshift(m); // restore chronological order
    }
    const history = trimmed.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Build customer context from previous conversations — only on the first message,
    // so we don't waste tokens repeating it on every turn of an ongoing conversation.
    const prevWhere = conversation.widgetVisitorEmail
      ? { widgetVisitorEmail: conversation.widgetVisitorEmail }
      : conversation.widgetVisitorId
        ? { widgetVisitorId: conversation.widgetVisitorId }
        : null;
    let customerContext: string | null = null;
    if (history.length === 0 && prevWhere) {
      const prevConvs = await this.prisma.conversation.findMany({
        where: {
          organizationId: bot.organizationId,
          ...prevWhere,
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

    // Call AI service and get response
    let aiReply = '';
    const preflightPromptTokens = estimateTokens({ userText, history, customerContext });
    const preflightCredits = estimateUsageCredits(preflightPromptTokens, 1);
    await this.billing.assertMinimumCredits(bot.organizationId, preflightCredits);
    try {
      const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
      const aiConfig = (bot.aiConfig as Record<string, string>) ?? {};

      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversation.id,
          organization_id: bot.organizationId,
          bot_id: bot.id,
          message: userText.trim(),
          history,
          bot_name: bot.name,
          org_name: bot.organization?.name,
          system_prompt: aiConfig.systemPrompt ?? null,
          customer_context: [customerContext, await this.cannedResponses.buildPromptBlock(bot.organizationId)].filter(Boolean).join('\n\n') || null,
        }),
      );

      aiReply = response.data?.reply ?? 'I am unable to respond right now. Please try again later.';
      const shouldResolve: boolean = response.data?.should_resolve === true;
      const promptTokens = estimateTokens({ userText, history, customerContext });
      const completionTokens = estimateTokens(aiReply);

      await this.billing.debitUsageCredits({
        organizationId: bot.organizationId,
        usageType: 'CUSTOMER_REPLY',
        promptTokens,
        completionTokens,
        idempotencyKey: `widget:${userMessage.id}`,
        metadata: {
          channel: 'WIDGET',
          conversationId: conversation.id,
          botId: bot.id,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      });

      await this.aiUsage.record({
        organizationId: bot.organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        usageType: 'CUSTOMER_REPLY',
        provider: 'openrouter',
        model: typeof aiConfig.model === 'string' ? aiConfig.model : undefined,
        promptTokens,
        completionTokens,
        metadata: {
          channel: 'WIDGET',
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      }).catch(() => null);

      await this.aiUsage.record({
        organizationId: bot.organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        usageType: 'ESCALATION_ANALYSIS',
        provider: 'openrouter',
        model: typeof aiConfig.model === 'string' ? aiConfig.model : undefined,
        promptTokens: 0,
        completionTokens: 0,
        metadata: {
          channel: 'WIDGET',
          decision: response.data?.should_escalate === true ? 'ESCALATE' : 'CONTINUE_AI',
          reason: response.data?.should_escalate === true ? 'model_signal' : 'no_signal',
          answerability: response.data?.answerability,
          confidence: response.data?.confidence,
        },
      }).catch(() => null);

      if (response.data?.should_escalate === true) {
        const topic = response.data?.escalation_topic || undefined;
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'ESCALATED', mode: 'HUMAN' },
        });
        this.events.emitConversationUpdate(bot.organizationId, {
          conversationId: conversation.id,
          status: 'ESCALATED',
          mode: 'HUMAN',
        });
        await this.teamChat.ensureKnowledgeGapThread(bot.organizationId, {
          conversationId: conversation.id,
          question: userText.trim(),
          topic,
          senderId: await this.findOrgSystemSender(bot.organizationId),
          metadata: {
            source: 'widget_ai_uncertainty',
            answerability: response.data?.answerability,
            confidence: response.data?.confidence,
          },
        }).catch((err) => this.logger.warn(`Knowledge gap thread failed: ${err?.message ?? err}`));
      }

      // Store AI message
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: aiReply,
        },
      });

      this.events.emitNewMessage(bot.organizationId, {
        conversationId: conversation.id,
        message: { id: aiMessage.id, role: aiMessage.role, content: aiMessage.content, createdAt: aiMessage.createdAt },
      });

      // Auto-resolve: AI signalled done — set PENDING, await CSAT response
      if (shouldResolve) {
        const currentMeta = (await this.prisma.conversation.findUnique({ where: { id: conversation.id }, select: { metadata: true } }))?.metadata as Record<string, unknown> ?? {};
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'PENDING', metadata: { ...currentMeta, awaitingCsat: true } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'PENDING' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for widget message: ${msg}`);
      aiReply = 'I am unable to respond right now. Please try again later.';
    }

    return {
      conversationId: conversation.id,
      message: aiReply,
    };
  }

  private generateWidgetKey(): string {
    return `zwk_${randomBytes(18).toString('hex')}`;
  }

  private async findOrgSystemSender(organizationId: string): Promise<string> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (member?.userId) return member.userId;
    const fallback = await this.prisma.organizationMember.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return fallback?.userId ?? '';
  }
}
