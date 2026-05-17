import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TELEGRAM_QUEUE } from './queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EventsGateway } from '../events/events.gateway';

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
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
    } else if (existing.status === 'RESOLVED') {
      // Customer re-opened after resolution — create a fresh conversation
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          telegramChatId,
          customerName,
          customerUsername: message.from.username,
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

    // If in AI mode, call AI service
    if (conversation.mode === 'AI') {
      const bot = await this.prisma.bot.findUnique({ where: { id: botId }, select: { name: true, aiConfig: true } });
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
      const aiConfig = (bot?.aiConfig as Record<string, string>) ?? {};
      await this.callAiAndRespond(
        conversation.id, botId, telegramChatId, telegramToken, organizationId, message.text,
        bot?.name ?? 'Assistant', aiConfig.systemPrompt ?? null, org?.name ?? null,
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
  ) {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversationId,
          organization_id: organizationId,
          bot_id: botId,
          message: userText,
          bot_name: botName,
          org_name: orgName,
          system_prompt: systemPrompt,
        }),
      );

      const aiText: string = response.data?.reply ?? 'I am unable to respond right now.';

      // Auto-escalate if AI expresses uncertainty
      const escalationPhrases = [
        "i don't know", "i am not sure", "i'm not sure", "i cannot help",
        "i can't help", "please contact support", "speak to a human",
        "talk to an agent", "reach out to our team", "contact us directly",
      ];
      const lowerReply = aiText.toLowerCase();
      const shouldEscalate = escalationPhrases.some((p) => lowerReply.includes(p));

      if (shouldEscalate) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'ESCALATED', mode: 'HUMAN' },
        });
        this.events.emitConversationUpdate(organizationId, {
          conversationId,
          status: 'ESCALATED',
          mode: 'HUMAN',
        });
      }

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: aiText,
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

      // Send reply to Telegram (plain text — model is instructed to avoid markdown)
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: aiText,
        }),
      );

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
}
