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
        status: { not: 'RESOLVED' },
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
    } else if (existing.status === 'RESOLVED') {
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

    if (conversation.mode !== 'AI') return;

    const aiConfig = (bot.aiConfig as Record<string, string>) ?? {};
    await this.callAiAndRespond(
      conversation, botId, toAddress, fromEmail, organizationId,
      bodyText.trim(), bot.name, aiConfig.systemPrompt ?? null,
      bot.organization?.name ?? null,
      bot.organization?.slug ?? null,
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
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'ESCALATED', mode: 'HUMAN' },
      });
      this.events.emitConversationUpdate(organizationId, {
        conversationId: conversation.id,
        status: 'ESCALATED',
        mode: 'HUMAN',
      });
      await this.sendEmail(
        fromAddress, toAddress, customerEmail,
        `Re: ${conversation.emailSubject ?? 'Your enquiry'}`,
        'Of course! I am connecting you with a human agent who will follow up shortly.',
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
          system_prompt: systemPrompt,
        }),
      );

      const aiText: string = response.data?.reply ?? 'I am unable to respond right now.';

      // Auto-escalate check
      const escalationPhrases = [
        "i don't know", "i am not sure", "i'm not sure", "i cannot help",
        "i can't help", "please contact support", "contact us directly",
      ];
      if (escalationPhrases.some((p) => aiText.toLowerCase().includes(p))) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'ESCALATED', mode: 'HUMAN' },
        });
        this.events.emitConversationUpdate(organizationId, {
          conversationId: conversation.id,
          status: 'ESCALATED',
          mode: 'HUMAN',
        });
      }

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'ASSISTANT', content: aiText },
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
        aiText,
        conversation.emailThreadId,
        botName, orgName ?? '',
      );
    } catch (err) {
      this.logger.error(`AI/email error for conversation ${conversation.id}: ${err}`);
    }
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
    const fromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';

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
