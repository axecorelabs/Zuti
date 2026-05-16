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
      await this.callAiAndRespond(conversation.id, botId, telegramChatId, telegramToken, organizationId, message.text);
    }
  }

  private async callAiAndRespond(
    conversationId: string,
    botId: string,
    telegramChatId: string,
    telegramToken: string,
    organizationId: string,
    userText: string,
  ) {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversationId,
          organization_id: organizationId,
          bot_id: botId,
          message: userText,
        }),
      );

      const aiText: string = response.data?.reply ?? 'I am unable to respond right now.';

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

      // Send reply to Telegram
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: aiText,
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for conversation ${conversationId}: ${msg}`);
    }
  }
}
