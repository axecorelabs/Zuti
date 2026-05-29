import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AttachmentKind, AiUsageType, Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CsatClassifierService } from '../ai-usage/csat-classifier.service';
import { LanguagePreferenceService } from '../ai-usage/language-preference.service';
import { BillingService } from '../billing/billing.service';
import { computeUsageCredits } from '../billing/credit-model';
import { buildAgentSystemPrompt, buildSkillBehaviorPromptBlock } from '../../common/utils/agent-config';
import { buildCompactAiContext, buildConversationMetadataPatch } from '../../common/utils/ai-context';
import {
  buildDeterministicFollowUpMessage,
  buildOperationalIntegrityPromptBlock,
  buildTruthAwareResponseTemplate,
  sanitizeOperationalClaims,
} from '../../common/utils/operational-integrity';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import { ActionForwardingService, ActionForwardingResult } from '../action-forwarding/action-forwarding.service';
import { WHATSAPP_QUEUE } from './queue.module';
import { extractWhatsAppConfig, sendWhatsAppText } from '../../common/utils/whatsapp';
import { buildLocalizedCsatPositiveMessage, getPreferredLanguageFromMetadata } from '../../common/utils/language';
import { resolveSupabaseStorageConfig, uploadBufferToSupabaseStorage } from '../../common/utils/supabase-storage';
import { callMediaProcess } from '../../common/utils/media-processing';

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function estimateUsageCredits(promptTokens: number, completionTokens: number): number {
  return computeUsageCredits(promptTokens, completionTokens, 1);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export interface WhatsAppMessageJob {
  botId: string;
  organizationId: string;
  provider: 'META' | 'TWILIO';
  userId: string;
  phoneNumber: string | null;
  profileName?: string;
  messageId: string;
  text: string;
  messageType?: string;
  media?: {
    type?: string;
    mediaId?: string;
    mediaUrl?: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
  };
}

@Processor(WHATSAPP_QUEUE)
export class WhatsAppProcessor {
  private readonly logger = new Logger(WhatsAppProcessor.name);
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
    private readonly aiUsage: AiUsageService,
    private readonly csatClassifier: CsatClassifierService,
    private readonly languagePreference: LanguagePreferenceService,
    private readonly billing: BillingService,
    private readonly activity: ActivityService,
    private readonly actionForwarding: ActionForwardingService,
  ) {}

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

  private extensionIsBlocked(fileName?: string): boolean {
    const lower = (fileName ?? '').toLowerCase();
    return Array.from(WhatsAppProcessor.BLOCKED_UPLOAD_EXTENSIONS).some((ext) => lower.endsWith(ext));
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

    if (content.includes(Buffer.from(WhatsAppProcessor.EICAR_SIGNATURE))) {
      return { clean: false, reason: 'EICAR test signature detected' };
    }

    const scanUrl = this.fileScanUrl;
    if (!scanUrl) {
      if (this.fileScanRequired) {
        return { clean: false, reason: 'FILE_SCAN_URL is not configured' };
      }
      this.logger.warn(`FILE_SCAN_URL is not configured; accepted WhatsApp media ${fileName ?? '(unnamed)'} using heuristic checks only.`);
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

  private extractFileNameFromContentDisposition(value?: string | null): string | undefined {
    if (!value) return undefined;
    const plain = value.match(/filename="?([^";]+)"?/i);
    if (plain && plain[1]) return plain[1].trim();
    return undefined;
  }

  private async downloadWhatsAppMedia(
    bot: {
      whatsappProvider: 'META' | 'TWILIO' | null;
      whatsappConfig: unknown;
    },
    media: NonNullable<WhatsAppMessageJob['media']>,
  ): Promise<{ bytes: Buffer; mimeType?: string; fileName?: string } | null> {
    const config = extractWhatsAppConfig(bot.whatsappConfig);
    const timeoutSignal = AbortSignal.timeout(this.fileScanTimeoutMs);

    if (bot.whatsappProvider === 'META') {
      const mediaId = media.mediaId?.trim();
      const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
      if (!mediaId || !accessToken) return null;

      const metaResponse = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeoutSignal,
      });
      if (!metaResponse.ok) return null;
      const metaJson = await metaResponse.json().catch(() => null) as Record<string, unknown> | null;
      const url = typeof metaJson?.url === 'string' ? metaJson.url : null;
      if (!url) return null;

      const fileResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeoutSignal,
      });
      if (!fileResponse.ok) return null;

      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      const mimeType = fileResponse.headers.get('content-type') ?? media.mimeType;
      const fileName = media.fileName
        ?? this.extractFileNameFromContentDisposition(fileResponse.headers.get('content-disposition'))
        ?? `${mediaId}`;
      return { bytes, mimeType: mimeType ?? undefined, fileName: fileName ?? undefined };
    }

    if (bot.whatsappProvider === 'TWILIO') {
      const mediaUrl = media.mediaUrl?.trim();
      const accountSid = typeof config.accountSid === 'string' ? config.accountSid.trim() : '';
      const authToken = typeof config.authToken === 'string' ? config.authToken.trim() : '';
      if (!mediaUrl || !accountSid || !authToken) return null;

      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const fileResponse = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${auth}` },
        signal: timeoutSignal,
      });
      if (!fileResponse.ok) return null;

      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      const mimeType = fileResponse.headers.get('content-type') ?? media.mimeType;
      const fileName = media.fileName
        ?? this.extractFileNameFromContentDisposition(fileResponse.headers.get('content-disposition'))
        ?? `twilio-media`;
      return { bytes, mimeType: mimeType ?? undefined, fileName: fileName ?? undefined };
    }

    return null;
  }

  @Process()
  async handle(job: Job<WhatsAppMessageJob>) {
    const { botId, organizationId, userId, phoneNumber, profileName, messageId, text, messageType, media } = job.data;
    this.logger.log(`Processing WhatsApp message for bot=${botId} user=${userId}`);

    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        aiConfig: true,
        routeToRoles: true,
        actionForwardingEnabled: true,
        whatsappProvider: true,
        whatsappChannelIdentifier: true,
        whatsappPhoneNumber: true,
        whatsappConfig: true,
      },
    });
    if (!bot) return;

    const existing = await this.prisma.conversation.findFirst({
      where: {
        botId,
        organizationId,
        channel: 'WHATSAPP',
        AND: [
          {
            OR: [
              { whatsappUserId: userId },
              ...(phoneNumber ? [{ whatsappPhoneNumber: phoneNumber }] : []),
            ],
          },
          {
            OR: [
              { status: { not: 'RESOLVED' } },
              { status: 'RESOLVED', metadata: { path: ['awaitingCsat'], equals: true } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const customerName = profileName?.trim() || phoneNumber || userId;
    let conversation: Awaited<ReturnType<typeof this.prisma.conversation.create>>;

    if (!existing) {
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId,
          botId,
          channel: 'WHATSAPP',
          customerName,
          whatsappUserId: userId,
          whatsappPhoneNumber: phoneNumber,
          whatsappProfileName: profileName ?? null,
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
    } else {
      conversation = await this.prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastMessageAt: new Date(),
          customerName,
          whatsappPhoneNumber: phoneNumber,
          whatsappProfileName: profileName ?? existing.whatsappProfileName,
        },
      });
    }

    const normalizedType = (messageType ?? 'text').toLowerCase();
    const isVideoMessage = normalizedType === 'video';
    let resolvedUserText = text?.trim() || (isVideoMessage
      ? '[Video received — a human agent will review]'
      : normalizedType === 'image'
        ? '[Customer sent an image. Visual content analysis unavailable — do not describe the image; ask the customer what they need help with.]'
        : normalizedType === 'audio' || normalizedType === 'voice'
          ? '[Audio message received]'
          : normalizedType === 'document'
            ? '[Document received]'
            : '[Attachment received]');

    let mediaScanStatus: 'SKIPPED' | 'CLEAN' | 'BLOCKED' = 'SKIPPED';
    let mediaScanReason: string | undefined;
    let mediaStorageKey: string | undefined;
    let mediaPublicUrl: string | undefined;
    if (normalizedType !== 'text' && media) {
      const downloaded = await this.downloadWhatsAppMedia(bot, media).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`WhatsApp media download failed for scan: ${reason}`);
        return null;
      });
      if (!downloaded) {
        mediaScanStatus = this.fileScanRequired ? 'BLOCKED' : 'SKIPPED';
        mediaScanReason = this.fileScanRequired ? 'Unable to retrieve media for virus scan' : 'Media retrieval skipped';
      } else {
        const verdict = await this.runFileScan(downloaded.bytes, downloaded.fileName ?? media.fileName, downloaded.mimeType ?? media.mimeType);
        mediaScanStatus = verdict.clean ? 'CLEAN' : 'BLOCKED';
        mediaScanReason = verdict.reason;
        if (verdict.clean) {
          // Upload ALL clean media to Supabase (audio/docs for AI context; video for agent viewing)
          const storage = resolveSupabaseStorageConfig(this.config);
          if (storage) {
            try {
              const uploaded = await uploadBufferToSupabaseStorage(storage, {
                buffer: downloaded.bytes,
                mimeType: downloaded.mimeType ?? media.mimeType ?? 'application/octet-stream',
                organizationId,
                channel: 'whatsapp',
                fileName: downloaded.fileName ?? media.fileName,
              });
              mediaStorageKey = uploaded.storageKey;
              mediaPublicUrl = uploaded.publicUrl;
              if (!mediaPublicUrl) {
                this.logger.warn(
                  `WhatsApp media uploaded without preview URL (bucket likely private and signed URL unavailable): ${uploaded.storageKey}`,
                );
              }
            } catch (error: unknown) {
              const reason = error instanceof Error ? error.message : String(error);
              this.logger.warn(`WhatsApp media upload to Supabase failed: ${reason}`);
            }
          }
          // AI media understanding — extract content so the AI can respond meaningfully.
          // Skip video: it is escalated to a human agent who will view it directly.
          if (!isVideoMessage) {
            if (await this.isMediaProcessingAllowed(organizationId)) {
              const rawMimeType = downloaded.mimeType ?? media.mimeType ?? 'application/octet-stream';
              const normalizedMimeType = rawMimeType.toLowerCase().split(';')[0].trim();
              const mimeForAi = normalizedType === 'image' && (!normalizedMimeType || normalizedMimeType === 'application/octet-stream')
                ? 'image/jpeg'
                : rawMimeType;
              const understanding = await callMediaProcess(
                this.config,
                downloaded.bytes,
                mimeForAi,
                downloaded.fileName ?? media.fileName,
              );
              if (understanding?.text) {
                const caption = text?.trim() ?? '';
                let mediaUsageType: 'MEDIA_TRANSCRIPTION' | 'MEDIA_VISION' | null = null;
                if (normalizedType === 'audio' || normalizedType === 'voice') {
                  resolvedUserText = caption
                    ? `${caption}\n[Voice note transcript: ${understanding.text}]`
                    : `[Voice note] ${understanding.text}`;
                  mediaUsageType = 'MEDIA_TRANSCRIPTION';
                } else if (normalizedType === 'image') {
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
                    metadata: { channel: 'WHATSAPP', kind: normalizedType },
                  }).catch(() => null);
                  await this.billing.debitUsageCredits({
                    organizationId,
                    usageType: mediaUsageType,
                    promptTokens: 0,
                    completionTokens: 0,
                    idempotencyKey: `wa:media:${messageId}`,
                    metadata: { channel: 'WHATSAPP', kind: normalizedType },
                  }).catch(() => null);
                }
              } else {
                const reason = understanding === null
                  ? 'media processing helper returned null (stale API build or unexpected path)'
                  : understanding.error ?? 'media processing returned empty text with no error detail';
                this.logger.warn(
                  `WhatsApp media understanding unavailable for ${normalizedType} (${media.fileName ?? media.mediaId}): ${reason}`,
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

    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: resolvedUserText,
        whatsappMsgId: messageId,
        ...(normalizedType !== 'text'
          ? {
              metadata: {
                media: {
                  type: normalizedType,
                  mediaId: media?.mediaId,
                  mediaUrl: media?.mediaUrl,
                  mimeType: media?.mimeType,
                  fileName: media?.fileName,
                  caption: media?.caption,
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

      if (normalizedType !== 'text') {
        const attachmentKind = normalizedType === 'video'
          ? AttachmentKind.VIDEO
          : normalizedType === 'image'
            ? AttachmentKind.IMAGE
            : normalizedType === 'audio'
              ? AttachmentKind.AUDIO
              : normalizedType === 'voice'
                ? AttachmentKind.VOICE
                : normalizedType === 'document'
                  ? AttachmentKind.DOCUMENT
                  : AttachmentKind.FILE;
        await this.prisma.messageAttachment.create({
          data: {
            messageId: userMessage.id,
            kind: attachmentKind,
            sourceRef: media?.mediaId ?? undefined,
            url: mediaPublicUrl ?? undefined,
            storageKey: mediaStorageKey,
            fileName: media?.fileName ?? undefined,
            mimeType: media?.mimeType ?? undefined,
            caption: media?.caption ?? undefined,
            metadata: {
              type: normalizedType,
              mediaId: media?.mediaId,
              mediaUrl: media?.mediaUrl,
              storageKey: mediaStorageKey,
              url: mediaPublicUrl,
              mediaScanStatus,
              mediaScanReason,
            },
          },
        });
      }

    this.events.emitNewMessage(organizationId, {
      conversationId: conversation.id,
      message: userMessage,
      customerName: conversation.customerName,
    });

    if (mediaScanStatus === 'BLOCKED') {
      await sendWhatsAppText(this.http, {
        provider: bot.whatsappProvider,
        channelIdentifier: bot.whatsappChannelIdentifier,
        phoneNumber: bot.whatsappPhoneNumber,
        config: bot.whatsappConfig,
      }, phoneNumber ?? userId, 'For security reasons, we could not accept that attachment. Please share a safe file format or contact a human agent.');
      return;
    }

    if (isVideoMessage && conversation.mode === 'AI') {
      const bestAgent = await this.orgs.findBestAgent(organizationId, 'video', bot.routeToRoles?.length ? bot.routeToRoles : ['AGENT']);
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
          'Escalated WhatsApp video message with no agent available',
          'A customer sent a video. The conversation was escalated but no agent was available.',
          { conversationId: conversation.id, reason: 'video_requires_human' },
        );
      }
      await sendWhatsAppText(this.http, {
        provider: bot.whatsappProvider,
        channelIdentifier: bot.whatsappChannelIdentifier,
        phoneNumber: bot.whatsappPhoneNumber,
        config: bot.whatsappConfig,
      }, phoneNumber ?? userId, 'Thanks for sharing the video. I am connecting you with a human agent to review it now.');
      return;
    }

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

    await this.actionForwarding.detectAndQueue({
      organizationId,
      botId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: resolvedUserText,
      channel: 'WHATSAPP',
      customerName,
      customerEmail: null,
      actionForwardingEnabled: bot.actionForwardingEnabled === true,
    }).then((result) => {
      forwardingResult = result;
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Action forwarding detect failed (whatsapp): ${msg}`);
    });

    if (conversation.mode !== 'AI') return;

    const convMeta = (conversation.metadata as Record<string, unknown>) ?? {};
    if (conversation.status === 'PENDING' && convMeta.awaitingCsat === true) {
      const lastAssistantMessage = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, role: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      const rating = await this.csatClassifier.classify({
        organizationId,
        botId,
        conversationId: conversation.id,
        channel: 'WHATSAPP' as any,
        userReply: text.trim(),
        lastAssistantMessage: lastAssistantMessage?.content ?? null,
      });
      if (rating === 'positive') {
        const preferredLanguage = getPreferredLanguageFromMetadata(convMeta);
        const positiveMessage = buildLocalizedCsatPositiveMessage(preferredLanguage);
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'RESOLVED', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'positive' } },
        });
        await this.activity.log(organizationId, null, 'CSAT System', ActivityAction.CSAT_RECORDED_POSITIVE, 'conversation', conversation.id, { channel: 'WHATSAPP', rating: 'positive' }).catch(() => null);
        await sendWhatsAppText(this.http, {
          provider: bot.whatsappProvider,
          channelIdentifier: bot.whatsappChannelIdentifier,
          phoneNumber: bot.whatsappPhoneNumber,
          config: bot.whatsappConfig,
        }, phoneNumber ?? userId, positiveMessage);
        return;
      }
      if (rating === 'negative') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'negative' } },
        });
      } else {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false } },
        });
      }
    }

    await this.callAiAndRespond(conversation.id, bot, resolvedUserText, phoneNumber ?? userId, forwardingResult, userMessage.id);
  }

  private async callAiAndRespond(
    conversationId: string,
    bot: {
      id: string;
      name: string;
      organizationId: string;
      aiConfig: unknown;
      routeToRoles: string[];
      whatsappProvider: 'META' | 'TWILIO' | null;
      whatsappChannelIdentifier: string | null;
      whatsappPhoneNumber: string | null;
      whatsappConfig: unknown;
    },
    userText: string,
    replyTarget: string,
    forwardingResult: ActionForwardingResult,
    inboundMessageId?: string,
  ) {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const organizationId = bot.organizationId;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const aiConfig = (bot.aiConfig as Record<string, unknown>) ?? {};
    const systemPrompt = buildAgentSystemPrompt(aiConfig, bot.name ?? 'Assistant');
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const priorForAi = recentMessages.filter((m) => !(m.role === 'USER' && m.content.trim() === userText.trim()));
    const latestConversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!latestConversation) return;
    const languageDecision = await this.languagePreference.resolveForTurn({
      userMessage: userText,
      channel: 'WHATSAPP',
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
      priorMessages: priorForAi,
      forwarding: forwardingResult,
      previousCustomerContext: null,
    });
    const effectiveSystemPrompt = [
      systemPrompt,
      aiContext.statePrompt,
      aiContext.responseStylePrompt,
      languageDecision.promptBlock,
      buildSkillBehaviorPromptBlock(aiConfig, forwardingResult.actionType),
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

    const contextMetadataPatch = buildConversationMetadataPatch(latestConversation.metadata, aiContext) as Record<string, unknown>;
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
      data: { metadata: mergedMetadataPatch as Prisma.InputJsonValue },
    }).catch(() => null);

    const promptTokens = estimateTokens({ userText, history: aiContext.history, customerContext: aiContext.customerContext });
    await this.billing.assertMinimumCredits(organizationId, estimateUsageCredits(promptTokens, 1));

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/chat`, {
          conversation_id: conversationId,
          organization_id: organizationId,
          bot_id: bot.id,
          message: userText,
          history: aiContext.history,
          bot_name: bot.name,
          org_name: org?.name ?? null,
          system_prompt: effectiveSystemPrompt,
          customer_context: [aiContext.customerContext, await this.cannedResponses.buildPromptBlock(organizationId)].filter(Boolean).join('\n\n') || null,
          forwarding_status: forwardingResult.status,
          forwarding_reason: forwardingResult.reason,
          action_task_id: forwardingResult.actionTaskId ?? null,
          can_claim_completed: forwardingResult.canClaimCompleted,
          missing_fields: forwardingResult.missingFields ?? [],
          blocked_capability: forwardingResult.blockedCapability ?? null,
          claim_level: forwardingResult.claimLevel,
          delivery_status: forwardingResult.deliveryStatus,
          operational_truth: forwardingResult.operationalTruth,
        }),
      );

      const aiText = String(response.data?.reply ?? 'I am unable to respond right now.');
      const shouldResolve = response.data?.should_resolve === true;
      const completionTokens = estimateTokens(aiText);

      await this.billing.debitUsageCredits({
        organizationId,
        usageType: 'CUSTOMER_REPLY',
        promptTokens,
        completionTokens,
        idempotencyKey: `whatsapp:${inboundMessageId ?? conversationId}`,
        metadata: { channel: 'WHATSAPP', conversationId, botId: bot.id },
      }).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to debit CUSTOMER_REPLY usage for WhatsApp conversation ${conversationId}: ${reason}`);
      });

      await this.aiUsage.record({
        organizationId,
        botId: bot.id,
        conversationId,
        usageType: 'CUSTOMER_REPLY',
        provider: bot.whatsappProvider === 'TWILIO' ? 'twilio' : 'meta',
        promptTokens,
        completionTokens,
        metadata: { channel: 'WHATSAPP' },
      }).catch(() => null);

      const escalationPhrases = [
        "i don't know", "i am not sure", "i'm not sure", "i cannot help",
        "i can't help", "please contact support", "speak to a human",
        "talk to an agent", "reach out to our team", "contact us directly",
      ];
      const lowerReply = aiText.toLowerCase();
      const shouldEscalate = response.data?.should_escalate === true || escalationPhrases.some((phrase) => lowerReply.includes(phrase));
      if (shouldEscalate) {
        const bestAgent = await this.orgs.findBestAgent(organizationId, response.data?.escalation_topic || undefined, bot.routeToRoles?.length ? bot.routeToRoles : ['AGENT']);
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
            'Escalated WhatsApp conversation with no agent available',
            'The AI escalated a WhatsApp conversation but no agent was available.',
            { conversationId },
          );
        }
      }

      const deterministicFollowUp = buildDeterministicFollowUpMessage({
        actionType: forwardingResult.actionType,
        missingFields: forwardingResult.missingFields,
        canClaimCompleted: forwardingResult.canClaimCompleted,
        forwardingReason: forwardingResult.reason,
        blockedCapability: forwardingResult.blockedCapability,
      });
      let finalAiText = sanitizeOperationalClaims(aiText, {
        forwardingStatus: forwardingResult.status,
        forwardingReason: forwardingResult.reason,
        actionTaskId: forwardingResult.actionTaskId,
        canClaimCompleted: forwardingResult.canClaimCompleted,
        claimLevel: forwardingResult.claimLevel,
        deliveryStatus: forwardingResult.deliveryStatus,
        missingFields: forwardingResult.missingFields,
        blockedCapability: forwardingResult.blockedCapability,
      });
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
      if (deterministicFollowUp && (forwardingResult.reason === 'MISSING_CONTACT_INFO' || forwardingResult.reason === 'MISSING_REQUIRED_FIELDS')) {
        finalAiText = deterministicFollowUp;
      }
      if (truthTemplate) {
        finalAiText = truthTemplate;
      }

      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: finalAiText,
        },
      });
      this.events.emitNewMessage(organizationId, { conversationId, message: aiMessage });

      await sendWhatsAppText(this.http, {
        provider: bot.whatsappProvider,
        channelIdentifier: bot.whatsappChannelIdentifier,
        phoneNumber: bot.whatsappPhoneNumber,
        config: bot.whatsappConfig,
      }, replyTarget, finalAiText);

      if (shouldResolve && !shouldEscalate) {
        const currentMeta = ((await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { metadata: true } }))?.metadata as Record<string, unknown> | null) ?? {};
        const { csatRating, ...metaWithoutCsatRating } = currentMeta;
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'PENDING', metadata: { ...metaWithoutCsatRating, awaitingCsat: true } },
        });
        this.events.emitConversationUpdate(organizationId, { conversationId, status: 'PENDING' });
      }

      if (shouldEscalate) {
        await sendWhatsAppText(this.http, {
          provider: bot.whatsappProvider,
          channelIdentifier: bot.whatsappChannelIdentifier,
          phoneNumber: bot.whatsappPhoneNumber,
          config: bot.whatsappConfig,
        }, replyTarget, 'I am connecting you with a human agent who will follow up shortly.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for WhatsApp conversation ${conversationId}: ${msg}`);
    }
  }
}
