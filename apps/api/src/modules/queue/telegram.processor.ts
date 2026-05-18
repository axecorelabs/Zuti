import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TELEGRAM_QUEUE } from './queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EventsGateway } from '../events/events.gateway';

/** Convert markdown to Telegram HTML (parse_mode: 'HTML').
 *  Telegram supports: <b>, <i>, <s>, <u>, <code>, <pre>, <a href="">.
 */
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
      // Emit new conversation to inbox
      this.events.emitNewConversation(organizationId, {
        ...conversation,
        bot: { id: botId, name: '' },
        messages: [],
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
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'ESCALATED', mode: 'HUMAN' },
      });
      this.events.emitConversationUpdate(organizationId, {
        conversationId,
        status: 'ESCALATED',
        mode: 'HUMAN',
      });
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: 'Of course! I am connecting you with a human agent who will follow up shortly.',
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

      // Send reply to Telegram — convert markdown to Telegram HTML for proper formatting
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: markdownToTelegramHtml(aiText),
          parse_mode: 'HTML',
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
