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

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
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

    return { emailAddress: updated.emailAddress };
  }

  async disableEmail(organizationId: string, botId: string) {
    await this.findOne(organizationId, botId);
    await this.prisma.bot.update({
      where: { id: botId },
      data: { emailEnabled: false },
    });
    return { ok: true };
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

    // Fetch recent conversation history (exclude the just-saved user message)
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

    // Call AI service and get response
    let aiReply = '';
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
        }),
      );

      aiReply = response.data?.reply ?? 'I am unable to respond right now. Please try again later.';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for widget message: ${msg}`);
      aiReply = 'I am unable to respond right now. Please try again later.';
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

    return {
      conversationId: conversation.id,
      message: aiReply,
    };
  }

  private generateWidgetKey(): string {
    return `zwk_${randomBytes(18).toString('hex')}`;
  }
}
