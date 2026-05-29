import {
  Controller, Post, Param, Body, Headers, Get, Query,
  Logger, HttpCode, HttpStatus, UseInterceptors, Req, ForbiddenException, UploadedFiles,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { TELEGRAM_QUEUE, EMAIL_QUEUE, WHATSAPP_QUEUE } from '../queue/queue.module';
import { TelegramMessageJob } from '../queue/telegram.processor';
import { EmailMessageJob } from '../queue/email.processor';
import { WhatsAppMessageJob } from '../queue/whatsapp.processor';
import { BillingService } from '../billing/billing.service';
import { ConfigService } from '@nestjs/config';
import { extractWhatsAppConfig, verifyMetaWebhookSignature, verifyTwilioWebhookSignature } from '../../common/utils/whatsapp';
import { resolveSupabaseStorageConfig, uploadBufferToSupabaseStorage } from '../../common/utils/supabase-storage';
import { callMediaProcess } from '../../common/utils/media-processing';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private static readonly BLOCKED_UPLOAD_EXTENSIONS = new Set([
    '.exe', '.dll', '.msi', '.scr', '.bat', '.cmd', '.com', '.ps1', '.vbs', '.js',
    '.jar', '.apk', '.ipa', '.pkg', '.dmg', '.iso', '.lnk', '.reg', '.hta',
  ]);
  private static readonly EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  private get fileScanUrl(): string {
    return (this.config.get<string>('FILE_SCAN_URL') ?? '').trim();
  }

  private get fileScanRequired(): boolean {
    const raw = (this.config.get<string>('FILE_SCAN_REQUIRED') ?? 'false').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  private get fileScanTimeoutMs(): number {
    const parsed = Number(this.config.get<string>('FILE_SCAN_TIMEOUT_MS') ?? '10000');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  }

  private async scanInboundFiles(files: Array<Express.Multer.File>): Promise<void> {
    for (const file of files) {
      const lowerName = (file.originalname ?? '').toLowerCase();
      const blocked = Array.from(WebhooksController.BLOCKED_UPLOAD_EXTENSIONS).some((ext) => lowerName.endsWith(ext));
      if (blocked) {
        throw new ForbiddenException(`Blocked attachment type: ${file.originalname}`);
      }

      const payload = file.buffer ?? Buffer.alloc(0);
      if (payload.includes(Buffer.from(WebhooksController.EICAR_SIGNATURE))) {
        throw new ForbiddenException('Attachment failed virus scan (EICAR signature detected)');
      }

      const scanUrl = this.fileScanUrl;
      if (scanUrl) {
        const response = await fetch(scanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.originalname,
            content_type: file.mimetype,
            content_base64: payload.toString('base64'),
          }),
          signal: AbortSignal.timeout(this.fileScanTimeoutMs),
        });

        let result: any = null;
        try {
          result = await response.json();
        } catch {
          result = null;
        }

        if (!response.ok) {
          throw new ForbiddenException(`Attachment scan service rejected file (${response.status})`);
        }
        if (!result || result.clean !== true) {
          throw new ForbiddenException(`Attachment failed virus scan${result?.reason ? `: ${String(result.reason)}` : ''}`);
        }
        continue;
      }

      if (this.fileScanRequired) {
        throw new ForbiddenException('Attachment virus scanning is required but FILE_SCAN_URL is not configured');
      }

      this.logger.warn(`FILE_SCAN_URL is not configured; accepted ${file.originalname} using heuristic checks only.`);
    }
  }

  private getTwilioSignatureUrl(req: any): string {
    const forwardedProtoRaw = typeof req?.headers?.['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto']
      : undefined;
    const forwardedHostRaw = typeof req?.headers?.['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host']
      : undefined;
    const proto = (forwardedProtoRaw ?? req?.protocol ?? 'https').split(',')[0].trim();
    const host = (forwardedHostRaw ?? req?.get?.('host') ?? '').split(',')[0].trim();
    const path = typeof req?.originalUrl === 'string' ? req.originalUrl : '';
    return `${proto}://${host}${path}`;
  }

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue,
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  // ── Telegram ──────────────────────────────────────────────────────────────

  @Post('telegram/:botId')
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async handleTelegramUpdate(
    @Param('botId') botId: string,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() update: any,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, telegramToken: { not: null } },
    });

    if (!bot) {
      this.logger.warn(`Received webhook for unknown/inactive bot: ${botId}`);
      return { ok: true };
    }

    if (bot.webhookSecret) {
      if (!secretHeader || secretHeader !== bot.webhookSecret) {
        this.logger.warn(`Webhook secret mismatch for bot ${botId} — request rejected`);
        return { ok: true };
      }
    }

    const message = update?.message;
    if (!message) return { ok: true };

    const telegramMedia = message.video
      ? {
          kind: 'video' as const,
          fileId: String(message.video.file_id),
          mimeType: message.video.mime_type ? String(message.video.mime_type) : undefined,
          fileName: message.video.file_name ? String(message.video.file_name) : undefined,
          durationSec: typeof message.video.duration === 'number' ? message.video.duration : undefined,
          sizeBytes: typeof message.video.file_size === 'number' ? message.video.file_size : undefined,
          caption: typeof message.caption === 'string' ? message.caption : undefined,
        }
      : message.voice
        ? {
            kind: 'voice' as const,
            fileId: String(message.voice.file_id),
            mimeType: message.voice.mime_type ? String(message.voice.mime_type) : undefined,
            durationSec: typeof message.voice.duration === 'number' ? message.voice.duration : undefined,
            sizeBytes: typeof message.voice.file_size === 'number' ? message.voice.file_size : undefined,
            caption: typeof message.caption === 'string' ? message.caption : undefined,
          }
        : message.audio
          ? {
              kind: 'audio' as const,
              fileId: String(message.audio.file_id),
              mimeType: message.audio.mime_type ? String(message.audio.mime_type) : undefined,
              fileName: message.audio.file_name ? String(message.audio.file_name) : undefined,
              durationSec: typeof message.audio.duration === 'number' ? message.audio.duration : undefined,
              sizeBytes: typeof message.audio.file_size === 'number' ? message.audio.file_size : undefined,
              caption: typeof message.caption === 'string' ? message.caption : undefined,
            }
          : message.document
            ? {
                kind: 'document' as const,
                fileId: String(message.document.file_id),
                mimeType: message.document.mime_type ? String(message.document.mime_type) : undefined,
                fileName: message.document.file_name ? String(message.document.file_name) : undefined,
                sizeBytes: typeof message.document.file_size === 'number' ? message.document.file_size : undefined,
                caption: typeof message.caption === 'string' ? message.caption : undefined,
              }
            : Array.isArray(message.photo) && message.photo.length > 0
              ? {
                  kind: 'image' as const,
                  fileId: String(message.photo[message.photo.length - 1].file_id),
                  sizeBytes: typeof message.photo[message.photo.length - 1].file_size === 'number'
                    ? message.photo[message.photo.length - 1].file_size
                    : undefined,
                  caption: typeof message.caption === 'string' ? message.caption : undefined,
                }
              : undefined;

    const textValue = typeof message.text === 'string'
      ? message.text
      : (typeof message.caption === 'string' ? message.caption : '');

    if (!textValue && !telegramMedia) return { ok: true };

    const job: TelegramMessageJob = {
      botId: bot.id,
      telegramChatId: String(message.chat.id),
      telegramToken: bot.telegramToken as string,
      organizationId: bot.organizationId,
      message: {
        messageId: message.message_id,
        text: textValue,
        media: telegramMedia,
        from: {
          id: message.from.id,
          username: message.from.username,
          firstName: message.from.first_name,
          lastName: message.from.last_name,
        },
      },
    };

    await this.telegramQueue.add(job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { ok: true };
  }

  // ── Email (SendGrid Inbound Parse) ────────────────────────────────────────
  // SendGrid POSTs multipart/form-data to this single endpoint.
  // The bot is identified by the `to` address (Zuti-hosted OR custom domain).

  @Post('email')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @UseInterceptors(AnyFilesInterceptor())
  @HttpCode(HttpStatus.OK)
  async handleEmailInbound(
    @Body() body: Record<string, string>,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    let toAddress: string = body.to ?? '';
    let fromEmail: string = body.from ?? '';

    // `from` may be "Name <email@example.com>" — extract just the email
    const emailMatch = fromEmail.match(/<([^>]+)>/);
    if (emailMatch) fromEmail = emailMatch[1];
    const fromName = body.from?.replace(/<[^>]+>/, '').trim().replace(/"/g, '') ?? '';

    // `to` may also contain display name
    const toMatch = toAddress.match(/<([^>]+)>/);
    if (toMatch) toAddress = toMatch[1];
    toAddress = toAddress.toLowerCase().trim();

    // Extract Message-ID and In-Reply-To from raw headers string
    const headers: string = body.headers ?? '';
    const msgIdMatch = headers.match(/^Message-ID:\s*<([^>]+)>/im);
    const inReplyToMatch = headers.match(/^In-Reply-To:\s*<([^>]+)>/im);
    const messageId = msgIdMatch ? msgIdMatch[1] : `${Date.now()}@zuti`;
    const inReplyTo = inReplyToMatch ? inReplyToMatch[1] : undefined;

    const subject = body.subject ?? '(no subject)';
    const rawText = body.text ?? body.html?.replace(/<[^>]+>/g, ' ').trim() ?? '';

    const declaredAttachmentCount = Number.parseInt(String(body.attachments ?? '0'), 10);

    if ((files ?? []).length > 0) {
      await this.scanInboundFiles(files);
    }

    // Strip quoted reply history: remove "On ... wrote:" delimiter and everything after,
    // then strip any remaining lines starting with ">" (inline quotes)
    const stripped = rawText
      .replace(/^On\s.+?wrote:\s*$/ms, '')   // "On Tue, 19 May ... wrote:"
      .split('\n')
      .filter(line => !line.trimStart().startsWith('>'))
      .join('\n')
      .trim();
    const bodyText = stripped || rawText.trim();  // fallback to raw if stripping removes everything

    if (!toAddress || !fromEmail || !bodyText.trim()) return { ok: true };

    // Find bot by toAddress — checks Zuti-hosted OR custom domain address
    const bot = await this.prisma.bot.findFirst({
      where: {
        isActive: true,
        emailEnabled: true,
        OR: [
          { emailAddress: toAddress },
          { customEmailAddress: toAddress, customEmailVerified: true },
        ],
      },
    });

    if (!bot) {
      this.logger.warn(`No active email-enabled bot found for address: ${toAddress}`);
      return { ok: true };
    }

    const storage = resolveSupabaseStorageConfig(this.config);
    const inboundAttachments = await Promise.all((files ?? []).map(async (file) => {
      const payload: {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        storageKey?: string;
        url?: string;
        extractedText?: string;
      } = {
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      };

      const fileBytes = file.buffer ?? Buffer.alloc(0);
      const isVideo = (file.mimetype ?? '').toLowerCase().startsWith('video/');

      // Upload ALL clean media to Supabase (images/docs for context; video for agent viewing)
      if (storage) {
        try {
          const uploaded = await uploadBufferToSupabaseStorage(storage, {
            buffer: fileBytes,
            mimeType: file.mimetype || 'application/octet-stream',
            organizationId: bot.organizationId,
            channel: 'email',
            fileName: file.originalname,
          });
          payload.storageKey = uploaded.storageKey;
          payload.url = uploaded.publicUrl;
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Email attachment upload to Supabase failed for ${file.originalname}: ${reason}`);
        }
      }

      // AI media understanding — extract content for non-video attachments
      if (!isVideo && fileBytes.length > 0) {
        const understanding = await callMediaProcess(
          this.config,
          fileBytes,
          file.mimetype || 'application/octet-stream',
          file.originalname,
        );
        if (understanding?.text) {
          payload.extractedText = understanding.text;
        }
      }

      return payload;
    }));

    const job: EmailMessageJob = {
      botId: bot.id,
      organizationId: bot.organizationId,
      toAddress,
      fromEmail,
      fromName,
      subject,
      bodyText,
      messageId,
      inReplyTo,
      hasAttachments: Number.isFinite(declaredAttachmentCount) ? declaredAttachmentCount > 0 : inboundAttachments.length > 0,
      attachments: inboundAttachments,
    };

    await this.emailQueue.add(job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { ok: true };
  }

  @Get('whatsapp/:botId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyWhatsAppWebhook(
    @Param('botId') botId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, whatsappEnabled: true, whatsappChannelIdentifier: { not: null } },
      select: { whatsappVerifyToken: true },
    });

    if (!bot || mode !== 'subscribe' || !verifyToken || verifyToken !== bot.whatsappVerifyToken) {
      throw new ForbiddenException('forbidden');
    }

    return challenge ?? 'ok';
  }

  @Post('whatsapp/:botId')
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async handleWhatsAppInbound(
    @Param('botId') botId: string,
    @Headers('x-hub-signature-256') metaSignature: string | undefined,
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Req() req: any,
    @Body() body: Record<string, any>,
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, isActive: true, whatsappEnabled: true, whatsappChannelIdentifier: { not: null } },
    });

    if (!bot) {
      this.logger.warn(`Received WhatsApp webhook for unknown/inactive bot: ${botId}`);
      return { ok: true };
    }

    const config = extractWhatsAppConfig(bot.whatsappConfig);
    if (bot.whatsappProvider === 'META') {
      const appSecret = typeof config.appSecret === 'string' ? config.appSecret.trim() : '';
      if (!appSecret || !verifyMetaWebhookSignature(appSecret, req?.rawBody ?? Buffer.from(''), metaSignature)) {
        this.logger.warn(`Meta WhatsApp signature mismatch for bot ${botId}`);
        return { ok: true };
      }

      const entries = Array.isArray(body.entry) ? body.entry : [];
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value ?? {};
          const contacts = Array.isArray(value.contacts) ? value.contacts : [];
          const messages = Array.isArray(value.messages) ? value.messages : [];
          for (const message of messages) {
            const messageType = typeof message?.type === 'string' ? message.type : 'text';
            const text = typeof message?.text?.body === 'string'
              ? message.text.body
              : (typeof message?.[messageType]?.caption === 'string' ? message[messageType].caption : '');

            const media = messageType !== 'text' && message?.[messageType]
              ? {
                  type: messageType,
                  mediaId: typeof message[messageType].id === 'string' ? message[messageType].id : undefined,
                  mimeType: typeof message[messageType].mime_type === 'string' ? message[messageType].mime_type : undefined,
                  fileName: typeof message[messageType].filename === 'string' ? message[messageType].filename : undefined,
                  caption: typeof message[messageType].caption === 'string' ? message[messageType].caption : undefined,
                }
              : undefined;

            if (!text && !media) continue;
            const contact = contacts.find((item: any) => item?.wa_id === message?.from);
            const job: WhatsAppMessageJob = {
              botId: bot.id,
              organizationId: bot.organizationId,
              provider: 'META',
              userId: String(message.from),
              phoneNumber: String(message.from),
              profileName: contact?.profile?.name,
              messageId: String(message.id),
              text,
              messageType,
              media,
            };
            await this.whatsappQueue.add(job, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: false,
            });
          }
        }
      }

      return { ok: true };
    }

    if (bot.whatsappProvider === 'TWILIO') {
      const authToken = typeof config.authToken === 'string' ? config.authToken.trim() : '';
      const url = this.getTwilioSignatureUrl(req);
      if (!authToken || !verifyTwilioWebhookSignature(authToken, twilioSignature, url, body as Record<string, string | string[] | undefined>)) {
        this.logger.warn(`Twilio WhatsApp signature mismatch for bot ${botId}`);
        return { ok: true };
      }

      const text = typeof body.Body === 'string' ? body.Body.trim() : '';
      const numMedia = Number.parseInt(typeof body.NumMedia === 'string' ? body.NumMedia : '0', 10);
      const hasMedia = Number.isFinite(numMedia) && numMedia > 0;

      let mediaType = 'text';
      let media: WhatsAppMessageJob['media'];
      if (hasMedia) {
        const rawMime = typeof body.MediaContentType0 === 'string' ? body.MediaContentType0 : undefined;
        if (rawMime?.startsWith('video/')) mediaType = 'video';
        else if (rawMime?.startsWith('image/')) mediaType = 'image';
        else if (rawMime?.startsWith('audio/')) mediaType = 'audio';
        else mediaType = 'document';

        media = {
          type: mediaType,
          mediaUrl: typeof body.MediaUrl0 === 'string' ? body.MediaUrl0 : undefined,
          mimeType: rawMime,
        };
      }

      if (!text && !hasMedia) return { ok: true };

      const job: WhatsAppMessageJob = {
        botId: bot.id,
        organizationId: bot.organizationId,
        provider: 'TWILIO',
        userId: typeof body.WaId === 'string' ? body.WaId : String(body.From ?? ''),
        phoneNumber: typeof body.From === 'string' ? body.From.replace(/^whatsapp:/, '') : null,
        profileName: typeof body.ProfileName === 'string' ? body.ProfileName : undefined,
        messageId: typeof body.MessageSid === 'string' ? body.MessageSid : `${Date.now()}`,
        text,
        messageType: hasMedia ? mediaType : 'text',
        media,
      };

      await this.whatsappQueue.add(job, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }

    return { ok: true };
  }

  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handlePaystack(
    @Headers('x-paystack-signature') signature: string | undefined,
    @Req() req: any,
    @Body() payload: any,
  ) {
    const rawBody = req?.rawBody as Buffer | undefined;
    return this.billing.handlePaystackWebhook(signature, rawBody ?? Buffer.from(''), payload);
  }
}
