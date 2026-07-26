import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AttachmentKind, AiUsageType, Prisma } from '@prisma/client';
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
import { LanguagePreferenceService } from '../ai-usage/language-preference.service';
import { BillingService } from '../billing/billing.service';
import { computeUsageCredits } from '../billing/credit-model';
import { buildAgentSystemPrompt, buildSkillBehaviorPromptBlock } from '../../common/utils/agent-config';
import { buildCompactAiContext, buildConversationMetadataPatch, getCachedPreviousCustomerContext } from '../../common/utils/ai-context';
import {
  buildDeterministicFollowUpMessage,
  buildOperationalIntegrityPromptBlock,
  buildTruthAwareResponseTemplate,
  sanitizeOperationalClaims,
} from '../../common/utils/operational-integrity';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import { ActionForwardingService, ActionForwardingResult } from '../action-forwarding/action-forwarding.service';
import { CustomerIdentityService } from '../customers/customer-identity.service';
import { buildLocalizedCsatPositiveMessage, getPreferredLanguageFromMetadata } from '../../common/utils/language';
import { resolveSupabaseStorageConfig, uploadBufferToSupabaseStorage } from '../../common/utils/supabase-storage';
import { callMediaProcess } from '../../common/utils/media-processing';
import { buildCommerceGroundingContextBlock } from '../../common/utils/commerce-grounding';
import { buildRegistrationContextBlock } from '../../common/utils/registration-grounding';
import { isAgenticEnabled, ensurePaymentLink } from '../../common/utils/agentic';

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
  // Registration requests are self-service and completed directly by this turn —
  // the escalation/logging language checks below don't apply to them.
  if (forwardingResult.actionType === 'REGISTRATION_REQUEST') return reply;

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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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
    text?: string;
    media?: {
      kind: 'video' | 'voice' | 'audio' | 'document' | 'image';
      fileId?: string;
      mimeType?: string;
      fileName?: string;
      durationSec?: number;
      sizeBytes?: number;
      caption?: string;
    };
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
  private static readonly BLOCKED_UPLOAD_EXTENSIONS = new Set([
    '.exe', '.dll', '.msi', '.scr', '.bat', '.cmd', '.com', '.ps1', '.vbs', '.js',
    '.jar', '.apk', '.ipa', '.pkg', '.dmg', '.iso', '.lnk', '.reg', '.hta',
  ]);
  private static readonly EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

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
    private readonly languagePreference: LanguagePreferenceService,
    private readonly billing: BillingService,
    private readonly activity: ActivityService,
    private readonly actionForwarding: ActionForwardingService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {}

  private get fileScanUrl(): string {
    return (this.config.get<string>('FILE_SCAN_URL') ?? '').trim();
  }

  private get fileScanRequired(): boolean {
    const raw = (this.config.get<string>('FILE_SCAN_REQUIRED') ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  private get fileScanTimeoutMs(): number {
    const parsed = Number(this.config.get<string>('FILE_SCAN_TIMEOUT_MS') ?? '10000');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
  }

  private extensionIsBlocked(fileName?: string): boolean {
    const lower = (fileName ?? '').toLowerCase();
    return Array.from(TelegramProcessor.BLOCKED_UPLOAD_EXTENSIONS).some((ext) => lower.endsWith(ext));
  }

  private async isMediaProcessingAllowed(organizationId: string): Promise<boolean> {
    const limit = Number(this.config.get<string>('MEDIA_PROCESSING_DAILY_LIMIT') ?? '200');
    if (!Number.isFinite(limit) || limit <= 0) return true;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const count = await this.prisma.aiUsageEvent.count({
      where: {
        organizationId,
        usageType: { in: ['MEDIA_TRANSCRIPTION', 'MEDIA_VISION'] as any[] },
        createdAt: { gte: startOfDay },
      },
    });
    return count < limit;
  }

  private async runFileScan(content: Buffer, fileName?: string, mimeType?: string): Promise<{ clean: boolean; reason?: string }> {
    if (this.extensionIsBlocked(fileName)) {
      return { clean: false, reason: `Blocked file type: ${fileName ?? 'unknown'}` };
    }

    if (content.includes(Buffer.from(TelegramProcessor.EICAR_SIGNATURE))) {
      return { clean: false, reason: 'EICAR test signature detected' };
    }

    const scanUrl = this.fileScanUrl;
    if (!scanUrl) {
      if (this.fileScanRequired) {
        return { clean: false, reason: 'FILE_SCAN_URL is not configured' };
      }
      this.logger.warn(`FILE_SCAN_URL is not configured; accepted Telegram media ${fileName ?? '(unnamed)'} using heuristic checks only.`);
      return { clean: true };
    }

    try {
      const response = await fetch(scanUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fileName,
          content_type: mimeType,
          content_base64: content.toString('base64'),
        }),
        signal: AbortSignal.timeout(this.fileScanTimeoutMs),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return { clean: false, reason: `scan service rejected file (${response.status})` };
      }
      if (!result || result.clean !== true) {
        return { clean: false, reason: typeof result?.reason === 'string' ? result.reason : 'malware detected' };
      }
      return { clean: true };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return { clean: false, reason: `scan request failed: ${reason}` };
    }
  }

  private async downloadTelegramMedia(
    telegramToken: string,
    media: NonNullable<TelegramMessageJob['message']['media']>,
  ): Promise<{ bytes: Buffer; mimeType?: string; fileName?: string } | null> {
    if (!media.fileId) return null;
    const timeoutSignal = AbortSignal.timeout(this.fileScanTimeoutMs);

    const metaResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/getFile?file_id=${encodeURIComponent(media.fileId)}`, {
      signal: timeoutSignal,
    });
    if (!metaResponse.ok) return null;
    const metaJson = await metaResponse.json().catch(() => null) as { ok?: boolean; result?: { file_path?: string } } | null;
    if (!metaJson?.ok || !metaJson.result?.file_path) return null;

    const fileResponse = await fetch(`https://api.telegram.org/file/bot${telegramToken}/${metaJson.result.file_path}`, {
      signal: timeoutSignal,
    });
    if (!fileResponse.ok) return null;

    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const mimeType = fileResponse.headers.get('content-type') ?? media.mimeType;
    const fileName = media.fileName ?? metaJson.result.file_path.split('/').pop() ?? media.fileId;
    return { bytes, mimeType: mimeType ?? undefined, fileName: fileName ?? undefined };
  }

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
    } else if (existing.status === 'RESOLVED') {
      // Customer re-opened after resolution — always start a fresh conversation.
      // A RESOLVED conversation's CSAT window is already closed, so awaitingCsat must NOT
      // gate this: a resolved thread with a stale awaitingCsat flag (which pairs only with
      // PENDING in the normal flow) would otherwise trap the message in a dead thread the
      // AI never answers (especially when mode is HUMAN).
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

    // Customer hub: link this conversation to its unified person. Fire-and-forget — off the reply
    // path, and only when not already linked (existing threads keep their customerId, so this is a
    // near-zero check on follow-up messages).
    if (!conversation.customerId) {
      this.customerIdentity
        .linkConversation(conversation)
        .catch((e) => this.logger.warn(`Customer link failed for conversation ${conversation.id}: ${e?.message ?? e}`));
    }

    const mediaKind = message.media?.kind;
    const isVideoMessage = mediaKind === 'video';
    const incomingText = (message.text ?? '').trim();
    let resolvedUserText = incomingText || (isVideoMessage
      ? '[Video received — a human agent will review]'
      : mediaKind === 'image'
        ? '[Customer sent an image. Visual content analysis unavailable — do not describe the image; ask the customer what they need help with.]'
        : mediaKind === 'audio' || mediaKind === 'voice'
          ? '[Audio message received]'
          : mediaKind === 'document'
            ? '[Document received]'
            : '[Attachment received]');

    let mediaScanStatus: 'SKIPPED' | 'CLEAN' | 'BLOCKED' = 'SKIPPED';
    let mediaScanReason: string | undefined;
    let mediaStorageKey: string | undefined;
    let mediaPublicUrl: string | undefined;
    if (message.media) {
      const downloaded = await this.downloadTelegramMedia(telegramToken, message.media).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Telegram media download failed for scan: ${reason}`);
        return null;
      });
      if (!downloaded) {
        mediaScanStatus = this.fileScanRequired ? 'BLOCKED' : 'SKIPPED';
        mediaScanReason = this.fileScanRequired ? 'Unable to retrieve media for virus scan' : 'Media retrieval skipped';
      } else {
        const verdict = await this.runFileScan(downloaded.bytes, downloaded.fileName ?? message.media.fileName, downloaded.mimeType ?? message.media.mimeType);
        mediaScanStatus = verdict.clean ? 'CLEAN' : 'BLOCKED';
        mediaScanReason = verdict.reason;
        if (verdict.clean) {
          // Upload ALL clean media to Supabase (audio/docs for AI context; video for agent viewing)
          const storage = resolveSupabaseStorageConfig(this.config);
          if (storage) {
            try {
              const uploaded = await uploadBufferToSupabaseStorage(storage, {
                buffer: downloaded.bytes,
                mimeType: downloaded.mimeType ?? message.media.mimeType ?? 'application/octet-stream',
                organizationId,
                channel: 'telegram',
                fileName: downloaded.fileName ?? message.media.fileName,
              });
              mediaStorageKey = uploaded.storageKey;
              mediaPublicUrl = uploaded.publicUrl;
              if (!mediaPublicUrl) {
                this.logger.warn(
                  `Telegram media uploaded without preview URL (bucket likely private and signed URL unavailable): ${uploaded.storageKey}`,
                );
              }
            } catch (error: unknown) {
              const reason = error instanceof Error ? error.message : String(error);
              this.logger.warn(`Telegram media upload to Supabase failed: ${reason}`);
            }
          }
          // AI media understanding — extract content so the AI can respond meaningfully.
          // Skip video: it is escalated to a human agent who will view it directly.
          if (!isVideoMessage) {
            if (await this.isMediaProcessingAllowed(organizationId)) {
              const rawMimeType = downloaded.mimeType ?? message.media.mimeType ?? 'application/octet-stream';
              const normalizedMimeType = rawMimeType.toLowerCase().split(';')[0].trim();
              const mimeForAi = mediaKind === 'image' && (!normalizedMimeType || normalizedMimeType === 'application/octet-stream')
                ? 'image/jpeg'
                : rawMimeType;
              const understanding = await callMediaProcess(
                this.config,
                downloaded.bytes,
                mimeForAi,
                downloaded.fileName ?? message.media.fileName,
              );
              if (understanding?.text) {
                const caption = incomingText || message.media.caption?.trim() || '';
                let mediaUsageType: 'MEDIA_TRANSCRIPTION' | 'MEDIA_VISION' | null = null;
                if (mediaKind === 'audio' || mediaKind === 'voice') {
                  resolvedUserText = caption
                    ? `${caption}\n[Voice note transcript: ${understanding.text}]\n[Transcription note: may contain recognition errors for accents/dialects. Confirm key intent before triggering workflows.]`
                    : `[Voice note transcript] ${understanding.text}\n[Transcription note: may contain recognition errors for accents/dialects. Confirm key intent before triggering workflows.]`;
                  mediaUsageType = 'MEDIA_TRANSCRIPTION';
                } else if (mediaKind === 'image') {
                  resolvedUserText = caption
                    ? `${caption}\n[Image: ${understanding.text}]`
                    : understanding.text;
                  mediaUsageType = 'MEDIA_VISION';
                } else {
                  // document, file, other — text extracted locally, no external API cost
                  resolvedUserText = caption
                    ? `${caption}\n[Attachment content: ${understanding.text}]`
                    : `[Attachment] ${understanding.text}`;
                }
                if (mediaUsageType) {
                  await this.aiUsage.record({
                    organizationId,
                    botId,
                    conversationId: conversation.id,
                    usageType: mediaUsageType as unknown as AiUsageType,
                    metadata: { channel: 'TELEGRAM', kind: mediaKind },
                  }).catch(() => null);
                  await this.billing.debitUsageCredits({
                    organizationId,
                    usageType: mediaUsageType,
                    promptTokens: 0,
                    completionTokens: 0,
                    idempotencyKey: `tg:media:${message.messageId}`,
                    metadata: { channel: 'TELEGRAM', kind: mediaKind },
                  }).catch(() => null);
                }
              } else {
                const reason = understanding === null
                  ? 'media processing helper returned null (stale API build or unexpected path)'
                  : understanding.error ?? 'media processing returned empty text with no error detail';
                this.logger.warn(
                  `Telegram media understanding unavailable for ${message.media.kind} (${message.media.fileName ?? message.media.fileId}): ${reason}`,
                );
              }
            } else {
              this.logger.warn(`Daily media processing limit reached for org ${organizationId} — skipping AI understanding`);
            }
          }
        }
      }
    }

    // Cap resolved text to prevent excessive token usage in downstream AI calls
    if (resolvedUserText.length > 8000) {
      resolvedUserText = resolvedUserText.slice(0, 8000) + '\n[... content truncated]';
    }

    // Store incoming message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: resolvedUserText,
        telegramMsgId: message.messageId,
        ...(message.media
          ? {
              metadata: {
                media: {
                  kind: message.media.kind,
                  fileId: message.media.fileId,
                  mimeType: message.media.mimeType,
                  fileName: message.media.fileName,
                  durationSec: message.media.durationSec,
                  sizeBytes: message.media.sizeBytes,
                  caption: message.media.caption,
                  storageKey: mediaStorageKey,
                  url: mediaPublicUrl,
                },
                mediaScan: {
                  status: mediaScanStatus,
                  reason: mediaScanReason,
                },
              },
            }
          : {}),
      },
    });

    if (message.media) {
      const attachmentKind = message.media.kind === 'video'
        ? AttachmentKind.VIDEO
        : message.media.kind === 'image'
          ? AttachmentKind.IMAGE
          : message.media.kind === 'audio'
            ? AttachmentKind.AUDIO
            : message.media.kind === 'voice'
              ? AttachmentKind.VOICE
              : message.media.kind === 'document'
                ? AttachmentKind.DOCUMENT
                : AttachmentKind.FILE;
      await this.prisma.messageAttachment.create({
        data: {
          messageId: userMessage.id,
          kind: attachmentKind,
          sourceRef: message.media.fileId,
          url: mediaPublicUrl,
          storageKey: mediaStorageKey,
          fileName: message.media.fileName,
          mimeType: message.media.mimeType,
          sizeBytes: message.media.sizeBytes,
          durationSec: message.media.durationSec,
          caption: message.media.caption,
          metadata: {
            kind: message.media.kind,
            fileId: message.media.fileId,
            storageKey: mediaStorageKey,
            url: mediaPublicUrl,
            mediaScanStatus,
            mediaScanReason,
          },
        },
      });
    }

    // Emit to inbox in real-time
    this.events.emitNewMessage(organizationId, {
      conversationId: conversation.id,
      message: userMessage,
      customerName: conversation.customerName,
    });

    const recentMessagesPromise = this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    if (mediaScanStatus === 'BLOCKED') {
      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: 'For security reasons, we could not accept that attachment. Please share a safe file format or contact a human agent.',
        }),
      );
      return;
    }

    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: { name: true, aiConfig: true, routeToRoles: true, actionForwardingEnabled: true },
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
    // Pre-check: keyword detection + capability checks only. AI classification is deferred
    // to the unified chat call, which returns action_type alongside the reply.
    await this.actionForwarding.detectAndQueue({
      organizationId,
      botId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: resolvedUserText,
      channel: 'TELEGRAM',
      customerName: conversation.customerName,
      customerEmail: null,
      actionForwardingEnabled: bot?.actionForwardingEnabled === true,
      skipAiClassification: true,
      // When the agentic loop is on, it's the sole task writer — this keyword pre-check only
      // classifies (no draft persisted), so no orphaned tasks when the model doesn't call a tool.
      classifyOnly: isAgenticEnabled(this.config),
    }).then((result) => {
      forwardingResult = result;
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Action forwarding detect failed (telegram): ${msg}`);
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
          userReply: resolvedUserText.trim(),
          lastAssistantMessage: lastAssistantMessage?.content ?? null,
        });
        if (rating === 'positive') {
          const preferredLanguage = getPreferredLanguageFromMetadata(convMeta);
          const positiveMessage = buildLocalizedCsatPositiveMessage(preferredLanguage);
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
              text: positiveMessage,
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
      const aiConfig = (bot?.aiConfig as Record<string, unknown>) ?? {};
      const systemPrompt = buildAgentSystemPrompt(aiConfig, bot?.name ?? 'Assistant');
      const routeToRoles = Array.isArray(bot?.routeToRoles) && bot.routeToRoles.length > 0
        ? bot.routeToRoles
        : ['AGENT'];

      if (isVideoMessage) {
        const bestAgent = await this.orgs.findBestAgent(organizationId, 'video', routeToRoles);
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
            'Escalated Telegram video message with no agent available',
            'A customer sent a video. The conversation was escalated but no agent was available.',
            { conversationId: conversation.id, reason: 'video_requires_human' },
          );
        }
        await firstValueFrom(
          this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            chat_id: telegramChatId,
            text: 'Thanks for sharing the video. I am connecting you with a human agent to review it now.',
          }),
        );
        return;
      }

      await this.callAiAndRespond(
        conversation.id, botId, telegramChatId, telegramToken, organizationId, resolvedUserText,
        bot?.name ?? 'Assistant', systemPrompt, aiConfig, buildSkillBehaviorPromptBlock(aiConfig, forwardingResult.actionType), org?.name ?? null, forwardingResult, routeToRoles, userMessage.id, recentMessagesPromise,
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
    aiConfig: Record<string, unknown>,
    skillBehaviorPrompt: string | null = null,
    orgName: string | null = null,
    forwardingResult: ActionForwardingResult,
    routeToRoles: string[] = ['AGENT'],
    inboundMessageId?: string,
    preloadedRecentMessages?: Promise<Array<{ role: string; content: string }>>,
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

    // Hard capability gate before any LLM call.
    if (isBlockedCapabilityReason(forwardingResult.reason)) {
      const deterministic = buildDeterministicFollowUpMessage({
        actionType: forwardingResult.actionType,
        forwardingReason: forwardingResult.reason,
        blockedCapability: forwardingResult.blockedCapability,
      }) ?? 'This workflow is not enabled on this bot. I can route you to a human teammate for help.';

      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: deterministic,
        },
      });
      this.events.emitNewMessage(organizationId, {
        conversationId,
        message: aiMessage,
      });
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      await firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: deterministic,
        }),
      );
      return;
    }

    // Fetch compact history inputs
    const recentMessages = preloadedRecentMessages
      ? await preloadedRecentMessages
      : await this.prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'desc' },
          take: 40,
        });
    const priorForAi = recentMessages.filter((m) => !(m.role === 'USER' && m.content.trim() === userText.trim()));

    const latestConversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!latestConversation) return;

    // Use stored conversation summary to cap history: once a summary exists we only need
    // the last 8 turns for recency context — older turns are captured in the summary.
    const storedMeta = asObject(latestConversation.metadata);
    const storedConversationSummary = typeof storedMeta.conversationSummary === 'string' && storedMeta.conversationSummary.trim()
      ? storedMeta.conversationSummary
      : null;
    const cappedPriorForAi = storedConversationSummary ? priorForAi.slice(0, 8) : priorForAi;

    // Build customer context from previous Telegram conversations — only on first message.
    const conv = cappedPriorForAi.length === 0
      ? await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { telegramChatId: true },
        })
      : null;
    const previousCustomerContextKey = conv?.telegramChatId ? `telegram:${conv.telegramChatId}` : null;
    let previousCustomerContext: string | null = getCachedPreviousCustomerContext(latestConversation.metadata, previousCustomerContextKey);
    if (!previousCustomerContext && conv?.telegramChatId) {
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
        if (lines.length > 0) previousCustomerContext = lines.join('\n');
      }
    }

    const languageDecision = await this.languagePreference.resolveForTurn({
      userMessage: userText,
      channel: 'TELEGRAM',
      metadata: latestConversation.metadata,
    });
    const conversationForContext = {
      ...latestConversation,
      metadata: {
        ...asObject(latestConversation.metadata),
        ...languageDecision.metadataPatch,
        customerMemory: {
          ...asObject(asObject(latestConversation.metadata).customerMemory),
          ...asObject(languageDecision.metadataPatch.customerMemory),
        },
      },
    };
    const aiContext = buildCompactAiContext({
      conversation: conversationForContext,
      priorMessages: cappedPriorForAi,
      forwarding: forwardingResult,
      previousCustomerContext,
      userMessage: userText,
    });
    const history = aiContext.history;
    const customerContext = aiContext.customerContext;

    const contextMetadataPatch = buildConversationMetadataPatch(latestConversation.metadata, {
      ...aiContext,
      previousCustomerContext,
      previousCustomerContextKey,
    }) as Record<string, unknown>;
    const mergedMetadataPatch: Record<string, unknown> = {
      ...contextMetadataPatch,
      ...languageDecision.metadataPatch,
      customerMemory: {
        ...asObject(contextMetadataPatch.customerMemory),
        ...asObject(languageDecision.metadataPatch.customerMemory),
      },
    };

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: mergedMetadataPatch as Prisma.InputJsonValue,
      },
    }).catch(() => null);

    const effectiveSystemPrompt = [
      systemPrompt,
      aiContext.statePrompt,
      aiContext.responseStylePrompt,
      languageDecision.promptBlock,
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

    const [commerceGrounding, registrationContext, customerProfileBlock] = await Promise.all([
      buildCommerceGroundingContextBlock({ prisma: this.prisma, organizationId, botId, aiConfig, userText }),
      buildRegistrationContextBlock({ prisma: this.prisma, botId, orgId: organizationId }),
      this.customerIdentity.getAgentContextBlock(latestConversation).catch(() => null), // Customer hub read loop
    ]);
    const effectiveCustomerContext = [
      customerContext,
      customerProfileBlock,
      commerceGrounding,
      registrationContext,
      await this.cannedResponses.buildPromptBlock(organizationId),
    ].filter(Boolean).join('\n\n') || null;

    const preflightPromptTokens = estimateTokens({ userText, history, customerContext: effectiveCustomerContext });
    const preflightCredits = estimateUsageCredits(preflightPromptTokens, 1);
    await this.billing.assertMinimumCredits(organizationId, preflightCredits);

    // Route action-capable bots through the agentic tool-use loop (default ON; the
    // REGISTRATION_AGENTIC env var is a kill-switch). The model calls the matching tool
    // (book_meeting, create_sales_order, register_for_event, …) and composes its reply from the
    // real result, so the classic classify→re-queue→guardrail machinery is bypassed for this turn.
    // Only tools the bot's capabilities actually allow are offered.
    const forwardingEnabled = aiConfig.actionForwardingEnabled === true || forwardingResult.status !== 'DISABLED';
    const enabledTools: string[] = [];
    if (forwardingEnabled) {
      const botCaps = await this.prisma.bot.findUnique({ where: { id: botId }, select: { capabilities: true, commerceStoreId: true } });
      const capabilities = (botCaps?.capabilities as Record<string, unknown> | null) ?? {};
      enabledTools.push(...this.actionForwarding.getEnabledActionTools(capabilities, { hasCommerceStore: Boolean(botCaps?.commerceStoreId) }));
    }
    if (registrationContext) enabledTools.push('register_for_event');
    const useTools = isAgenticEnabled(this.config); // knowledge grounding makes every bot agentic; enabled_tools may still be empty (search_knowledge is added AI-side)

    // Show a "typing…" indicator while the (multi-second) AI call runs so the wait feels responsive.
    // Fire-and-forget + self-capping; stopped in the finally once the reply has been sent.
    const stopTyping = this.startTelegramTyping(telegramToken, telegramChatId);
    try {
      const internalApiKey = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
      const response = await firstValueFrom(
        this.http.post<any>(
          `${aiServiceUrl}/api/v1/chat`,
          {
            conversation_id: conversationId,
            organization_id: organizationId,
            bot_id: botId,
            message: userText,
            history,
            bot_name: botName,
            org_name: orgName,
            system_prompt: effectiveSystemPrompt,
            customer_context: effectiveCustomerContext,
            action_forwarding_enabled: aiConfig.actionForwardingEnabled === true || forwardingResult.status !== 'DISABLED',
            use_tools: useTools,
            enabled_tools: enabledTools,
            channel: 'TELEGRAM',
            conversation_summary: storedConversationSummary ?? null,
            forwarding_status: forwardingResult.status,
            forwarding_reason: forwardingResult.reason,
            action_task_id: forwardingResult.actionTaskId ?? null,
            can_claim_completed: forwardingResult.canClaimCompleted,
            missing_fields: forwardingResult.missingFields ?? [],
            blocked_capability: forwardingResult.blockedCapability ?? null,
            claim_level: forwardingResult.claimLevel,
            delivery_status: forwardingResult.deliveryStatus,
            operational_truth: forwardingResult.operationalTruth,
            risk_profile: aiContext.risk,
            needs_verifier: aiContext.risk.needsVerifier,
          },
          internalApiKey ? { headers: { 'X-Internal-Key': internalApiKey } } : undefined,
        ),
      );

      const aiText: string = response.data?.reply ?? 'I am unable to respond right now.';
      const shouldResolve: boolean = response.data?.should_resolve === true;

      // Store conversation summary returned by the unified chat call.
      const returnedSummary: string | null = typeof response.data?.conversation_summary === 'string' && response.data.conversation_summary.trim()
        ? response.data.conversation_summary.trim()
        : null;
      if (returnedSummary) {
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: { metadata: { ...asObject(storedMeta), conversationSummary: returnedSummary } as Prisma.InputJsonValue },
        }).catch(() => null);
      }

      // If the unified call classified an intent the keyword pre-check missed, queue it now.
      const chatActionType = typeof response.data?.action_type === 'string' ? response.data.action_type : 'NONE';
      const chatIntentConfidence: number = typeof response.data?.intent_confidence === 'number' ? response.data.intent_confidence : 0;
      const chatRegistrationProductId: string = typeof response.data?.registration_product_id === 'string' ? response.data.registration_product_id.trim() : '';
      const chatCollectedFields: Record<string, string> = (response.data?.collected_fields && typeof response.data.collected_fields === 'object' && !Array.isArray(response.data.collected_fields))
        ? response.data.collected_fields as Record<string, string>
        : {};
      // Also re-queue for REGISTRATION_REQUEST when the AI provides a productId that the keyword
      // pre-check didn't have — this is the only way the entry + payment get created in multi-turn flows.
      // Must NOT require forwardingResult.status !== 'NO_INTENT' — the keyword-only pre-check
      // returns NO_INTENT for virtually every registration turn (no keyword signal), which is
      // exactly the case this branch exists to handle. Requiring the opposite meant this almost
      // never fired, so the re-queue ran fire-and-forget and the reply was built from the stale
      // pre-classification result (no actionType, no missingFields, no payment link) every time.
      // In agentic mode the register_for_event tool already did the work — never re-queue.
      const registrationHandledByTool = useTools && response.data?.registration_handled === true;
      const shouldRequeueForRegistration =
        !useTools &&
        chatActionType === 'REGISTRATION_REQUEST' &&
        chatRegistrationProductId.length > 0;
      if (
        !registrationHandledByTool &&
        chatActionType !== 'NONE' &&
        chatIntentConfidence >= 0.6 &&
        (forwardingResult.status === 'NO_INTENT' || shouldRequeueForRegistration)
      ) {
        const reQueueCall = this.actionForwarding.detectAndQueue(
          {
            organizationId,
            botId,
            conversationId,
            messageId: inboundMessageId ?? conversationId,
            messageText: userText,
            channel: 'TELEGRAM',
            customerName: null,
            customerEmail: null,
            actionForwardingEnabled: true,
            skipAiClassification: true,
            conversationContext: returnedSummary ?? storedConversationSummary ?? null,
            registrationProductId: chatRegistrationProductId || undefined,
            aiCollectedFields: chatCollectedFields,
          },
          {
            actionType: chatActionType as any,
            confidence: chatIntentConfidence,
            summary: typeof response.data?.intent_summary === 'string' && response.data.intent_summary.trim()
              ? response.data.intent_summary.trim()
              : userText.slice(0, 300),
          },
        );
        // For registration re-queues, await so registrationPaymentUrl is available before we
        // send the follow-up payment message below. For all other cases, fire-and-forget.
        if (shouldRequeueForRegistration) {
          await reQueueCall.then((result) => { forwardingResult = result; }).catch((err: unknown) => {
            this.logger.warn(`Post-chat registration re-queue failed (telegram): ${err instanceof Error ? err.message : String(err)}`);
          });
        } else {
          reQueueCall.catch((err: unknown) => {
            this.logger.warn(`Post-chat action queuing failed (telegram): ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }

      const promptTokens = estimateTokens({ userText, history, customerContext: effectiveCustomerContext });
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
      }).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to debit CUSTOMER_REPLY usage for Telegram conversation ${conversationId}: ${reason}`);
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

      // Agentic replies are already truthful by construction (the model only states what the
      // register_for_event tool actually returned), so the classic guardrail chain is skipped
      // entirely — this is exactly the win the tool-use loop buys us.
      let finalAiText = aiText;
      if (!useTools) {
        const safeAiText = sanitizeOperationalClaims(aiText, {
          forwardingStatus: forwardingResult.status,
          forwardingReason: forwardingResult.reason,
          actionTaskId: forwardingResult.actionTaskId,
          canClaimCompleted: forwardingResult.canClaimCompleted,
          claimLevel: forwardingResult.claimLevel,
          deliveryStatus: forwardingResult.deliveryStatus,
          missingFields: forwardingResult.missingFields,
          blockedCapability: forwardingResult.blockedCapability,
          actionType: forwardingResult.actionType,
        });
        const deterministicFollowUp = buildDeterministicFollowUpMessage({
          actionType: forwardingResult.actionType,
          missingFields: forwardingResult.missingFields,
          canClaimCompleted: forwardingResult.canClaimCompleted,
          forwardingReason: forwardingResult.reason,
          blockedCapability: forwardingResult.blockedCapability,
        });
        finalAiText = safeAiText;
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
          const hasMissingFieldReason = forwardingResult.reason === 'MISSING_CONTACT_INFO' || forwardingResult.reason === 'MISSING_REQUIRED_FIELDS';
          if (forwardingResult.canClaimCompleted) {
            finalAiText = 'I have already logged the internal request for review in this conversation. I cannot confirm downstream delivery yet.';
          } else if (hasMissingFieldReason) {
            finalAiText = deterministicFollowUp
              ?? 'I understand. I can continue helping once you share the remaining required details.';
          }
        }
      }

      this.logger.debug(
        `Operational truth (telegram): status=${forwardingResult.status} reason=${forwardingResult.reason} claimLevel=${forwardingResult.claimLevel} delivery=${forwardingResult.deliveryStatus} canClaimCompleted=${forwardingResult.canClaimCompleted}`,
      );

      // Agentic path: the reply already came from the tool result. Safety-net the payment link
      // in case the model composed a reply but omitted the tool-returned link.
      if (useTools) {
        finalAiText = ensurePaymentLink(finalAiText, response.data?.payment_url);
      }

      // Classic path: fold the registration payment link / notice into the AI reply so it is
      // persisted and visible in the inbox. A pending payment also means the conversation is
      // NOT resolved. (In agentic mode registrationPaymentUrl is empty, so these are no-ops.)
      const hasPendingPayment = Boolean(forwardingResult.registrationPaymentUrl) || (useTools && Boolean(response.data?.payment_url));
      if (forwardingResult.registrationNotice) {
        finalAiText = `${finalAiText}\n\n${forwardingResult.registrationNotice}`;
      }
      if (forwardingResult.registrationPaymentUrl) {
        finalAiText = `${finalAiText}\n\nTo complete your registration, please make payment via this secure link:\n${forwardingResult.registrationPaymentUrl}`;
      }
      const effectiveShouldResolve = shouldResolve && !hasPendingPayment;

      // Store AI reply
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: finalAiText,
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
          text: markdownToTelegramHtml(finalAiText),
          parse_mode: 'HTML',
        }),
      );

      // Auto-resolve: AI signalled the conversation is done and no escalation is needed.
      // Keep in PENDING awaiting CSAT so the next reply is classified on this same conversation.
      if (effectiveShouldResolve && !shouldEscalate) {
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

      // (Registration payment link is now folded into the AI reply above, so it is persisted
      // and visible in the inbox — no separate unsaved follow-up send.)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for conversation ${conversationId}: ${msg}`);
    } finally {
      stopTyping();
    }
  }

  /**
   * Show Telegram's "typing…" indicator for the duration of the AI call. Telegram clears a chat
   * action after ~5s, so we re-send every 4s until stop() is called (or a 30s safety cap trips, so a
   * missed stop can never loop forever). All sends are fire-and-forget — a failed indicator must
   * never affect message handling. Telegram auto-clears the indicator the moment the reply arrives.
   */
  private startTelegramTyping(telegramToken: string, telegramChatId: string): () => void {
    const post = () => {
      void firstValueFrom(
        this.http.post(`https://api.telegram.org/bot${telegramToken}/sendChatAction`, {
          chat_id: telegramChatId,
          action: 'typing',
        }),
      ).catch(() => undefined);
    };
    post();
    const interval = setInterval(post, 4000);
    const cap = setTimeout(() => clearInterval(interval), 30000);
    return () => {
      clearInterval(interval);
      clearTimeout(cap);
    };
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
