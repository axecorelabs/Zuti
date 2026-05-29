import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Prisma } from '@prisma/client';
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
}

@Processor(WHATSAPP_QUEUE)
export class WhatsAppProcessor {
  private readonly logger = new Logger(WhatsAppProcessor.name);

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

  @Process()
  async handle(job: Job<WhatsAppMessageJob>) {
    const { botId, organizationId, userId, phoneNumber, profileName, messageId, text } = job.data;
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

    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: text.trim(),
        whatsappMsgId: messageId,
      },
    });

    this.events.emitNewMessage(organizationId, {
      conversationId: conversation.id,
      message: userMessage,
      customerName: conversation.customerName,
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

    await this.actionForwarding.detectAndQueue({
      organizationId,
      botId,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: text.trim(),
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

    await this.callAiAndRespond(conversation.id, bot, text.trim(), phoneNumber ?? userId, forwardingResult, userMessage.id);
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
