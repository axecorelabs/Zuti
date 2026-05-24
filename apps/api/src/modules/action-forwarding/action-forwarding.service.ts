import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHash } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import {
  ActionCapabilityRegistry,
  ActionForwardingReason,
  ActionForwardingResult,
  ActionForwardingResultStatus,
  ActionType,
  AiActionClassifierResponse,
  CapabilityKey,
  ContactEndpointConfig,
  ContactPolicyConfig,
  ResolveRouteInput,
  ResolveRouteResult,
  RuntimeChannel,
} from './action-forwarding.types';

export type {
  ActionForwardingReason,
  ActionForwardingResult,
  ActionForwardingResultStatus,
} from './action-forwarding.types';

interface InboundActionSignalInput {
  organizationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  messageText: string;
  channel: RuntimeChannel;
  customerName?: string | null;
  customerEmail?: string | null;
  actionForwardingEnabled?: boolean;
}

type SkillKey = 'SALES' | 'BOOKING' | 'TECHNICAL';

interface SkillIntakeFieldConfig {
  key: string;
  label?: string;
  required?: boolean;
  aliases?: string[];
}

interface SkillIntakeConfig {
  version?: number;
  fields?: SkillIntakeFieldConfig[];
}

interface BotAiConfig {
  skillIntakeConfig?: Partial<Record<SkillKey, SkillIntakeConfig>>;
  [key: string]: unknown;
}

type ContractFieldKey =
  | 'customer_name'
  | 'customer_email'
  | 'preferred_datetime'
  | 'booking_reason'
  | 'product'
  | 'issue_summary';

interface ActionContractDefinition {
  requiredFields: ContractFieldKey[];
}

const ACTION_CAPABILITY_REGISTRY: ActionCapabilityRegistry = {
  version: '2026-05-24',
  actions: {
    MEETING_REQUEST: {
      actionType: 'MEETING_REQUEST',
      capabilityKey: 'BOOKING',
      requiredFields: ['customer_name', 'customer_email', 'preferred_datetime', 'booking_reason'],
      allowedChannels: ['WIDGET', 'EMAIL', 'TELEGRAM'],
      executor: {
        kind: 'ACTION_TASK',
        enabled: true,
      },
      claimRules: {
        requiresActionTaskIdToConfirm: true,
        forbidSystemLookupClaimWithoutLookupId: true,
      },
    },
    SALES_ORDER_REQUEST: {
      actionType: 'SALES_ORDER_REQUEST',
      capabilityKey: 'SALES',
      requiredFields: ['customer_name', 'customer_email', 'product'],
      allowedChannels: ['WIDGET', 'EMAIL', 'TELEGRAM'],
      executor: {
        kind: 'ACTION_TASK',
        enabled: true,
      },
      claimRules: {
        requiresActionTaskIdToConfirm: true,
        forbidSystemLookupClaimWithoutLookupId: true,
      },
    },
    TECHNICAL_ISSUE: {
      actionType: 'TECHNICAL_ISSUE',
      capabilityKey: 'TECHNICAL',
      requiredFields: ['issue_summary'],
      allowedChannels: ['WIDGET', 'EMAIL', 'TELEGRAM'],
      executor: {
        kind: 'ACTION_TASK',
        enabled: true,
      },
      claimRules: {
        requiresActionTaskIdToConfirm: true,
        forbidSystemLookupClaimWithoutLookupId: true,
      },
    },
    OWNER_ATTENTION_NEEDED: {
      actionType: 'OWNER_ATTENTION_NEEDED',
      capabilityKey: 'FORWARDING',
      requiredFields: ['customer_name', 'customer_email'],
      allowedChannels: ['WIDGET', 'EMAIL', 'TELEGRAM'],
      executor: {
        kind: 'ACTION_TASK',
        enabled: true,
      },
      claimRules: {
        requiresActionTaskIdToConfirm: true,
        forbidSystemLookupClaimWithoutLookupId: true,
      },
    },
  },
};

const ACTION_CONTRACTS: Partial<Record<ActionType, ActionContractDefinition>> = {
  MEETING_REQUEST: {
    requiredFields: ACTION_CAPABILITY_REGISTRY.actions.MEETING_REQUEST.requiredFields as ContractFieldKey[],
  },
  SALES_ORDER_REQUEST: {
    requiredFields: ACTION_CAPABILITY_REGISTRY.actions.SALES_ORDER_REQUEST.requiredFields as ContractFieldKey[],
  },
  TECHNICAL_ISSUE: {
    requiredFields: ACTION_CAPABILITY_REGISTRY.actions.TECHNICAL_ISSUE.requiredFields as ContractFieldKey[],
  },
};

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isStrictEmail(value: string): boolean {
  return /^(?=.{6,254}$)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.trim());
}

function rankActionPriority(sourceText: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
  const source = sourceText.toLowerCase();
  if (/(urgent|asap|critical|emergency|outage|immediately|today)/i.test(source)) return 'URGENT';
  if (/(enterprise|contract|procurement|migration|security|incident|priority)/i.test(source)) return 'HIGH';
  if (/(demo|pricing|plan|feature|onboarding|integration)/i.test(source)) return 'NORMAL';
  return 'LOW';
}

@Injectable()
export class ActionForwardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    @InjectQueue(ACTION_FORWARDING_QUEUE) private readonly queue: Queue,
  ) {}

  resolveRoute(input: ResolveRouteInput): ResolveRouteResult {
    const activeEndpoints = new Map<string, ContactEndpointConfig>();
    for (const endpoint of input.endpoints) {
      if (endpoint.isActive) activeEndpoints.set(endpoint.id, endpoint);
    }

    const endpointFromPolicy = (policy: ContactPolicyConfig): ContactEndpointConfig | null => {
      if (!policy.endpointId) return null;
      return activeEndpoints.get(policy.endpointId) ?? null;
    };

    const botDefault = input.botPolicies.find((policy) => policy.isDefault);
    if (botDefault) {
      const endpoint = endpointFromPolicy(botDefault);
      if (endpoint) {
        return { endpoint, policy: botDefault, reason: 'BOT_OVERRIDE' };
      }
    }

    const orgDefault = input.orgPolicies.find((policy) => policy.isDefault);
    if (orgDefault) {
      const endpoint = endpointFromPolicy(orgDefault);
      if (endpoint) {
        return { endpoint, policy: orgDefault, reason: 'ORG_DEFAULT' };
      }
    }

    return { endpoint: null, policy: null, reason: 'NO_ROUTE' };
  }

  buildDedupeKey(orgId: string, conversationId: string | null, fingerprint: string): string {
    const conversation = conversationId ?? 'no-conversation';
    return `${orgId}:${conversation}:${fingerprint}`;
  }

  private detectActionByKeywords(text: string): { actionType: ActionType; confidence: number; summary: string } | null {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return null;

    const meetingPhrases = [
      'schedule a meeting', 'book a meeting', 'book a call', 'schedule a call',
      'talk to the owner', 'speak with the owner', 'meet with the owner',
    ];
    const orderPhrases = [
      'place an order', 'buy', 'purchase', 'i want to order', 'order now',
    ];
    const technicalPhrases = [
      'bug', 'error', 'broken', 'not working', 'issue with', 'incident', 'outage',
    ];
    const ownerPhrases = [
      'contact the owner', 'owner should know', 'report this to management',
      'urgent for owner', 'escalate this to owner',
    ];

    if (meetingPhrases.some((p) => normalized.includes(p))) {
      return {
        actionType: 'MEETING_REQUEST',
        confidence: 0.72,
        summary: 'Customer requested a meeting with owner or team member.',
      };
    }

    if (orderPhrases.some((p) => normalized.includes(p))) {
      return {
        actionType: 'SALES_ORDER_REQUEST',
        confidence: 0.7,
        summary: 'Customer expressed order/purchase intent.',
      };
    }

    if (technicalPhrases.some((p) => normalized.includes(p))) {
      return {
        actionType: 'TECHNICAL_ISSUE',
        confidence: 0.68,
        summary: 'Customer reported a technical issue that requires follow-up.',
      };
    }

    if (ownerPhrases.some((p) => normalized.includes(p))) {
      return {
        actionType: 'OWNER_ATTENTION_NEEDED',
        confidence: 0.74,
        summary: 'Customer requested explicit owner/management attention.',
      };
    }

    return null;
  }

  private async detectActionWithAi(text: string): Promise<{ actionType: ActionType; confidence: number; summary: string } | null> {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const response = await firstValueFrom(
      this.http.post<AiActionClassifierResponse>(`${aiServiceUrl}/api/v1/action-intent/classify`, {
        user_message: text,
      }),
    );

    const data = response.data;
    if (!data || data.action_type === 'NONE') return null;
    return {
      actionType: data.action_type,
      confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
      summary: data.summary || 'Actionable customer intent detected.',
    };
  }

  private buildFingerprint(actionType: ActionType, text: string): string {
    const basis = `${actionType}:${text.trim().toLowerCase().slice(0, 200)}`;
    return createHash('sha256').update(basis).digest('hex').slice(0, 32);
  }

  private extractContractFields(
    actionType: ActionType,
    messageText: string,
    input: InboundActionSignalInput,
    customFields: SkillIntakeFieldConfig[] = [],
  ): Record<string, string> {
    const text = messageText.trim();
    const extracted: Record<string, string> = {};

    if (input.customerName?.trim()) extracted.customer_name = input.customerName.trim();
    if (input.customerEmail?.trim()) extracted.customer_email = input.customerEmail.trim().toLowerCase();

    const emailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if (emailMatch?.[0]) extracted.customer_email = emailMatch[0].toLowerCase();
    const nameMatch = text.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z][A-Za-z\s'-]{1,60})\b/i);
    if (nameMatch?.[1]) extracted.customer_name = nameMatch[1].trim();

    if (actionType === 'MEETING_REQUEST') {
      const datetimeMatch = text.match(/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{4}-\d{2}-\d{2})(?:\s+at\s+[0-2]?\d(?::[0-5]\d)?\s?(?:am|pm)?)?/i);
      const naturalDatetimeMatch = text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}(?:\s+(?:at\s+)?[0-2]?\d(?::[0-5]\d)?\s?(?:am|pm)?)?/i);
      if (datetimeMatch?.[0]) extracted.preferred_datetime = datetimeMatch[0].trim();
      else if (naturalDatetimeMatch?.[0]) extracted.preferred_datetime = naturalDatetimeMatch[0].trim();

      const reasonMatch = text.match(/\b(?:reason|subject|about|regarding|for)\b\s*(?:is|:)?\s*([^\n,.!?]{4,180})/i);
      if (reasonMatch?.[1]) extracted.booking_reason = reasonMatch[1].trim();
    }

    if (actionType === 'SALES_ORDER_REQUEST') {
      const productMatch = text.match(/\b(?:order|buy|purchase)\s+(?:a|an|the)?\s*([A-Za-z0-9][A-Za-z0-9\s\-]{1,80})\b/i);
      if (productMatch?.[1]) extracted.product = productMatch[1].trim();
    }

    if (actionType === 'TECHNICAL_ISSUE') {
      const summaryMatch = text.match(/\b(?:issue|problem|error|bug)(?:\s+is|\s*:\s*|\s*-\s*)(.{8,180})$/i);
      if (summaryMatch?.[1]) {
        extracted.issue_summary = summaryMatch[1].trim();
      } else if (text.length >= 8) {
        // Fallback to concise first sentence/segment for issue summary.
        const fallback = text.split(/[.!?\n]/).map((part) => part.trim()).find((part) => part.length >= 8);
        if (fallback) extracted.issue_summary = fallback.slice(0, 180);
      }
    }

    // Parse lightweight key/value lines (e.g. "company_size: 200").
    const keyValuePairs = new Map<string, string>();
    for (const line of text.split(/\n|;/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{1,50})\s*[:=-]\s*(.+?)\s*$/);
      if (!match) continue;
      const key = normalizeFieldKey(match[1]);
      const value = match[2].trim();
      if (key && value) keyValuePairs.set(key, value.slice(0, 200));
    }

    for (const field of customFields) {
      const key = normalizeFieldKey(field.key);
      if (!key) continue;
      const candidates = new Set<string>([
        key,
        normalizeFieldKey(field.label ?? ''),
        ...(Array.isArray(field.aliases) ? field.aliases.map((alias) => normalizeFieldKey(alias)) : []),
      ]);

      let value: string | undefined;
      for (const candidate of candidates) {
        if (!candidate) continue;
        const pairValue = keyValuePairs.get(candidate);
        if (pairValue) {
          value = pairValue;
          break;
        }

        const candidatePhrase = candidate.replace(/_/g, '[\\s_-]+');
        const phraseMatch = text.match(new RegExp(`\\b${candidatePhrase}\\b\\s*(?:is|=|:)\\s*([^\\n,.!?]{2,180})`, 'i'));
        if (phraseMatch?.[1]) {
          value = phraseMatch[1].trim();
          break;
        }
      }

      if (value && value.length > 0) {
        extracted[key] = value.slice(0, 200);
      }
    }

    return extracted;
  }

  private applyFieldCorrectnessChecks(
    actionType: ActionType,
    fields: Record<string, string>,
  ): { normalized: Record<string, string>; invalidFields: string[] } {
    const normalized = { ...fields };
    const invalidFields = new Set<string>();

    const email = normalized.customer_email;
    if (email && !isStrictEmail(email)) {
      delete normalized.customer_email;
      invalidFields.add('customer_email');
    }

    const name = normalized.customer_name;
    if (name && name.trim().length < 2) {
      delete normalized.customer_name;
      invalidFields.add('customer_name');
    }

    if (actionType === 'MEETING_REQUEST') {
      const reason = normalized.booking_reason;
      if (reason && reason.trim().length < 4) {
        delete normalized.booking_reason;
        invalidFields.add('booking_reason');
      }
    }

    if (actionType === 'TECHNICAL_ISSUE') {
      const summary = normalized.issue_summary;
      if (summary && summary.trim().length < 8) {
        delete normalized.issue_summary;
        invalidFields.add('issue_summary');
      }
    }

    return {
      normalized,
      invalidFields: Array.from(invalidFields),
    };
  }

  private skillForAction(actionType: ActionType): SkillKey | null {
    switch (actionType) {
      case 'MEETING_REQUEST':
        return 'BOOKING';
      case 'SALES_ORDER_REQUEST':
        return 'SALES';
      case 'TECHNICAL_ISSUE':
        return 'TECHNICAL';
      default:
        return null;
    }
  }

  private getCustomIntakeFields(aiConfig: BotAiConfig, actionType: ActionType): {
    fields: SkillIntakeFieldConfig[];
    requiredKeys: string[];
    version: number | null;
  } {
    const skill = this.skillForAction(actionType);
    if (!skill) return { fields: [], requiredKeys: [], version: null };

    const config = aiConfig.skillIntakeConfig?.[skill];
    const rawFields = Array.isArray(config?.fields) ? config.fields : [];
    const fields: SkillIntakeFieldConfig[] = rawFields
      .map((field) => ({
        key: typeof field?.key === 'string' ? field.key : '',
        label: typeof field?.label === 'string' ? field.label : undefined,
        required: field?.required === true,
        aliases: Array.isArray(field?.aliases) ? field.aliases.filter((a): a is string => typeof a === 'string') : undefined,
      }))
      .filter((field) => normalizeFieldKey(field.key).length > 0);

    const requiredKeys = fields
      .filter((field) => field.required === true)
      .map((field) => normalizeFieldKey(field.key));

    const version = typeof config?.version === 'number' && Number.isFinite(config.version)
      ? Math.trunc(config.version)
      : null;

    return {
      fields,
      requiredKeys: Array.from(new Set(requiredKeys)),
      version,
    };
  }

  private async updateConversationContractDraft(
    conversationId: string,
    actionType: ActionType,
    draft: {
      status: 'COLLECTING' | 'READY' | 'COMMITTED';
      requiredFields: string[];
      missingFields: string[];
      collected: Record<string, string>;
      actionTaskId?: string;
    },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    if (!conversation) return;

    const currentMetadata = ((conversation.metadata as Prisma.JsonObject | null) ?? {});
    const currentContractsRaw = currentMetadata.actionContracts;
    const currentContracts: Prisma.InputJsonObject =
      currentContractsRaw && typeof currentContractsRaw === 'object' && !Array.isArray(currentContractsRaw)
        ? (currentContractsRaw as Prisma.InputJsonObject)
        : {};

    const nextContracts: Prisma.InputJsonObject = {
      ...currentContracts,
      [actionType]: {
        status: draft.status,
        requiredFields: draft.requiredFields,
        missingFields: draft.missingFields,
        collected: draft.collected,
        actionTaskId: draft.actionTaskId ?? null,
        updatedAt: new Date().toISOString(),
      },
    };

    const nextMetadata: Prisma.InputJsonObject = {
      ...(currentMetadata as unknown as Prisma.InputJsonObject),
      actionContracts: nextContracts,
    };

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: nextMetadata,
      },
    });
  }

  private isActionEnabledByCapabilities(actionType: ActionType, capabilities: Record<string, unknown>): boolean {
    const skills = (capabilities.skills ?? {}) as Record<string, unknown>;
    switch (actionType) {
      case 'MEETING_REQUEST':
        return capabilities.canCreateMeetingRequest === true || skills.BOOKING === true;
      case 'SALES_ORDER_REQUEST':
        return capabilities.canCreateOrder === true || capabilities.canCreateLead === true || skills.SALES === true;
      case 'TECHNICAL_ISSUE':
        return capabilities.canCreateTechnicalIssue === true || skills.SUPPORT === true || skills.TECHNICAL === true;
      case 'OWNER_ATTENTION_NEEDED':
        return capabilities.canNotifyOwner === true || capabilities.canNotifyTeam === true || skills.FORWARDING === true;
      default:
        return false;
    }
  }

  private blockedCapabilityForAction(actionType: ActionType): string {
    const capability = ACTION_CAPABILITY_REGISTRY.actions[actionType]?.capabilityKey;
    if (capability) return capability;

    switch (actionType) {
      case 'MEETING_REQUEST':
        return 'BOOKING';
      case 'SALES_ORDER_REQUEST':
        return 'SALES';
      case 'TECHNICAL_ISSUE':
        return 'SUPPORT_OR_TECHNICAL';
      case 'OWNER_ATTENTION_NEEDED':
        return 'FORWARDING';
      default:
        return 'UNKNOWN';
    }
  }

  private findPendingContractAction(metadata: Record<string, unknown>): ActionType | null {
    const contracts = (metadata.actionContracts as Record<string, unknown> | null) ?? null;
    if (!contracts) return null;

    let best: { actionType: ActionType; updatedAt: number } | null = null;
    const candidateActionTypes: ActionType[] = ['MEETING_REQUEST', 'SALES_ORDER_REQUEST', 'TECHNICAL_ISSUE'];

    for (const actionType of candidateActionTypes) {
      const contract = contracts[actionType] as Record<string, unknown> | undefined;
      if (!contract) continue;
      if (contract.status !== 'COLLECTING') continue;

      const missingFields = Array.isArray(contract.missingFields)
        ? contract.missingFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
        : [];
      if (missingFields.length === 0) continue;

      const updatedAtRaw = typeof contract.updatedAt === 'string' ? contract.updatedAt : null;
      const updatedAt = updatedAtRaw ? Date.parse(updatedAtRaw) : 0;
      if (!best || updatedAt > best.updatedAt) {
        best = { actionType, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
      }
    }

    return best?.actionType ?? null;
  }

  private buildForwardingResult(result: {
    status: ActionForwardingResultStatus;
    reason: ActionForwardingReason;
    actionType?: ActionType;
    actionTaskId?: string;
    lookupId?: string;
    missingFields?: string[];
    blockedCapability?: string;
    capabilityKey?: CapabilityKey;
  }): ActionForwardingResult {
    const hasMissingOrInvalid = Array.isArray(result.missingFields) && result.missingFields.length > 0;
    const canClaimCompleted =
      (result.status === 'QUEUED' || result.status === 'DUPLICATE')
      && Boolean(result.actionTaskId)
      && !hasMissingOrInvalid;

    return {
      status: result.status,
      reason: result.reason,
      actionType: result.actionType,
      capabilityKey: result.capabilityKey,
      actionTaskId: result.actionTaskId,
      lookupId: result.lookupId,
      canClaimCompleted,
      missingFields: result.missingFields,
      blockedCapability: result.blockedCapability,
    };
  }

  async detectAndQueue(input: InboundActionSignalInput): Promise<ActionForwardingResult> {
    if (!input.actionForwardingEnabled) {
      return this.buildForwardingResult({
        status: 'DISABLED',
        reason: 'FORWARDING_DISABLED',
      });
    }

    let detected: { actionType: ActionType; confidence: number; summary: string } | null = null;
    try {
      detected = await this.detectActionWithAi(input.messageText);
    } catch {
      detected = null;
    }
    if (!detected) {
      detected = this.detectActionByKeywords(input.messageText);
    }
    if (!detected) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { metadata: true },
      });
      const metadata = ((conversation?.metadata as Record<string, unknown> | null) ?? {});
      const pendingActionType = this.findPendingContractAction(metadata);
      if (!pendingActionType) {
        return this.buildForwardingResult({
          status: 'NO_INTENT',
          reason: 'NO_ACTIONABLE_INTENT',
        });
      }

      detected = {
        actionType: pendingActionType,
        confidence: 0.5,
        summary: 'Customer provided additional details for pending workflow.',
      };
    }

    const capabilityConfig = ACTION_CAPABILITY_REGISTRY.actions[detected.actionType];
    const capabilityKey = capabilityConfig.capabilityKey;

    if (!capabilityConfig.allowedChannels.includes(input.channel)) {
      return this.buildForwardingResult({
        status: 'NO_INTENT',
        reason: 'CHANNEL_NOT_ALLOWED',
        actionType: detected.actionType,
        capabilityKey,
        blockedCapability: capabilityKey,
      });
    }

    if (!capabilityConfig.executor.enabled) {
      return this.buildForwardingResult({
        status: 'NO_INTENT',
        reason: 'EXECUTOR_DISABLED',
        actionType: detected.actionType,
        capabilityKey,
        blockedCapability: capabilityKey,
      });
    }

    const bot = await this.prisma.bot.findUnique({
      where: { id: input.botId },
      select: { capabilities: true, aiConfig: true },
    });
    const capabilities = ((bot?.capabilities as Record<string, unknown> | null) ?? {});
    if (!this.isActionEnabledByCapabilities(detected.actionType, capabilities)) {
      return this.buildForwardingResult({
        status: 'NO_INTENT',
        reason: 'SKILL_NOT_ENABLED',
        actionType: detected.actionType,
        capabilityKey,
        blockedCapability: this.blockedCapabilityForAction(detected.actionType),
      });
    }

    const contract = ACTION_CONTRACTS[detected.actionType];
    let collectedFields: Record<string, string> = {};
    let followUpMissingFields: string[] = [];
    let existingContractActionTaskId: string | null = null;
    const prismaAny = this.prisma as any;
    if (contract) {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, detected.actionType);
      const requiredFieldKeys = Array.from(new Set<string>([
        ...contract.requiredFields,
        ...customContract.requiredKeys,
      ]));

      const conversation = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { metadata: true },
      });
      const metadata = ((conversation?.metadata as Record<string, unknown> | null) ?? {});
      const contracts = ((metadata.actionContracts as Record<string, unknown> | null) ?? {});
      const previousDraft = ((contracts[detected.actionType] as Record<string, unknown> | null) ?? {});
      existingContractActionTaskId = typeof previousDraft.actionTaskId === 'string' ? previousDraft.actionTaskId : null;
      const previousCollected = ((previousDraft.collected as Record<string, unknown> | null) ?? {});
      const normalizedPrevious: Record<string, string> = {};
      for (const [key, value] of Object.entries(previousCollected)) {
        if (typeof value === 'string' && value.trim().length > 0) normalizedPrevious[key] = value.trim();
      }

      const extracted = this.extractContractFields(
        detected.actionType,
        input.messageText,
        input,
        customContract.fields,
      );
      collectedFields = {
        ...normalizedPrevious,
        ...Object.fromEntries(
          Object.entries(extracted)
            .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
            .map(([key, value]) => [key, value!.trim()]),
        ),
      };

      const correctness = this.applyFieldCorrectnessChecks(detected.actionType, collectedFields);
      collectedFields = correctness.normalized;

      const missingFields = requiredFieldKeys.filter((field) => {
        const value = collectedFields[field];
        return !value || value.trim().length === 0;
      });
      const missingOrInvalidFields = Array.from(new Set<string>([
        ...missingFields,
        ...correctness.invalidFields,
      ]));

      await this.updateConversationContractDraft(input.conversationId, detected.actionType, {
        status: missingOrInvalidFields.length > 0 ? 'COLLECTING' : 'READY',
        requiredFields: requiredFieldKeys,
        missingFields: missingOrInvalidFields,
        collected: collectedFields,
      });

      if (missingOrInvalidFields.length > 0) {
        followUpMissingFields = Array.from(new Set([...followUpMissingFields, ...missingOrInvalidFields]));
      }

      if (detected.actionType === 'TECHNICAL_ISSUE') {
        if (!collectedFields.customer_email || collectedFields.customer_email.trim().length === 0) {
          followUpMissingFields.push('customer_email');
        }
      }
    }

    const activeStatuses = [
      'DETECTED',
      'PENDING_CONFIRMATION',
      'QUEUED',
      'ROUTED',
      'SENT',
      'DELIVERED',
      'ACKNOWLEDGED',
      'CONFIGURATION_NEEDED',
    ];
    const activeConversationTask = await prismaAny.actionTask.findFirst({
      where: {
        orgId: input.organizationId,
        botId: input.botId,
        conversationId: input.conversationId,
        actionType: detected.actionType,
        status: { in: activeStatuses },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
      },
    });
    if (!existingContractActionTaskId && activeConversationTask?.id) {
      existingContractActionTaskId = activeConversationTask.id;
    }

    if (existingContractActionTaskId) {
      const existingTask = await prismaAny.actionTask.findFirst({
        where: {
          id: existingContractActionTaskId,
          orgId: input.organizationId,
          botId: input.botId,
          actionType: 'MEETING_REQUEST',
        },
        select: {
          id: true,
          status: true,
          payload: true,
        },
      });

      if (existingTask) {
        const existingPayload = ((existingTask.payload as Record<string, unknown> | null) ?? {});
        const currentFollowUpMissingFields = Array.from(new Set<string>(followUpMissingFields));
        const actionAiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});

        if (detected.actionType === 'MEETING_REQUEST') {
          const customContract = this.getCustomIntakeFields(actionAiConfig, detected.actionType);
          const customFields = Object.fromEntries(
            Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
          );

          const existingBooking = await prismaAny.booking.findFirst({
            where: {
              orgId: input.organizationId,
              botId: input.botId,
              actionTaskId: existingTask.id,
            },
            select: {
              id: true,
              metadata: true,
            },
          });

          if (existingBooking) {
            const existingBookingMetadata = ((existingBooking.metadata as Record<string, unknown> | null) ?? {});
            await prismaAny.booking.update({
              where: { id: existingBooking.id },
              data: {
                customerName: collectedFields.customer_name ?? input.customerName ?? undefined,
                customerEmail: collectedFields.customer_email ?? input.customerEmail ?? undefined,
                preferredDatetime: collectedFields.preferred_datetime ?? undefined,
                // Keep booking reason explicit for downstream ops triage.
                notes: input.messageText,
                metadata: {
                  ...existingBookingMetadata,
                  customFields,
                  customFieldVersion: customContract.version,
                  bookingReason: collectedFields.booking_reason ?? existingBookingMetadata.bookingReason ?? null,
                  followUpMissingFields: currentFollowUpMissingFields,
                },
              },
            });
          }

          await prismaAny.actionTask.update({
            where: { id: existingTask.id },
            data: {
              payload: {
                ...existingPayload,
                channel: input.channel,
                messageText: input.messageText,
                customerName: collectedFields.customer_name ?? input.customerName ?? null,
                customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
                preferredDatetime: collectedFields.preferred_datetime ?? null,
                bookingReason: collectedFields.booking_reason ?? null,
                followUpMissingFields: currentFollowUpMissingFields,
              },
            },
          });
        } else if (detected.actionType === 'SALES_ORDER_REQUEST') {
          const customContract = this.getCustomIntakeFields(actionAiConfig, detected.actionType);
          const customFields = Object.fromEntries(
            Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
          );

          const existingOrder = await prismaAny.salesOrder.findFirst({
            where: {
              orgId: input.organizationId,
              botId: input.botId,
              actionTaskId: existingTask.id,
            },
            select: {
              id: true,
              metadata: true,
            },
          });

          if (existingOrder) {
            const existingOrderMetadata = ((existingOrder.metadata as Record<string, unknown> | null) ?? {});
            await prismaAny.salesOrder.update({
              where: { id: existingOrder.id },
              data: {
                customerName: collectedFields.customer_name ?? input.customerName ?? null,
                customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
                product: collectedFields.product ?? null,
                notes: input.messageText,
                metadata: {
                  ...existingOrderMetadata,
                  customFields,
                  customFieldVersion: customContract.version,
                  followUpMissingFields: currentFollowUpMissingFields,
                },
              },
            });
          }

          await prismaAny.actionTask.update({
            where: { id: existingTask.id },
            data: {
              payload: {
                ...existingPayload,
                channel: input.channel,
                messageText: input.messageText,
                customerName: collectedFields.customer_name ?? input.customerName ?? null,
                customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
                product: collectedFields.product ?? null,
                followUpMissingFields: currentFollowUpMissingFields,
              },
            },
          });
        } else if (detected.actionType === 'TECHNICAL_ISSUE') {
          const customContract = this.getCustomIntakeFields(actionAiConfig, detected.actionType);
          const customFields = Object.fromEntries(
            Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
          );

          const existingIssue = await prismaAny.technicalIssue.findFirst({
            where: {
              orgId: input.organizationId,
              botId: input.botId,
              actionTaskId: existingTask.id,
            },
            select: {
              id: true,
              metadata: true,
            },
          });

          if (existingIssue) {
            const existingIssueMetadata = ((existingIssue.metadata as Record<string, unknown> | null) ?? {});
            await prismaAny.technicalIssue.update({
              where: { id: existingIssue.id },
              data: {
                reporterName: collectedFields.customer_name ?? input.customerName ?? null,
                reporterEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
                summary: collectedFields.issue_summary ?? input.messageText,
                details: input.messageText,
                metadata: {
                  ...existingIssueMetadata,
                  customFields,
                  customFieldVersion: customContract.version,
                  followUpMissingFields: currentFollowUpMissingFields,
                },
              },
            });
          }

          await prismaAny.actionTask.update({
            where: { id: existingTask.id },
            data: {
              payload: {
                ...existingPayload,
                channel: input.channel,
                messageText: input.messageText,
                customerName: collectedFields.customer_name ?? input.customerName ?? null,
                customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
                issueSummary: collectedFields.issue_summary ?? null,
                issueDetails: input.messageText,
                followUpMissingFields: currentFollowUpMissingFields,
              },
            },
          });
        }

        if (currentFollowUpMissingFields.length === 0 && existingTask.status === 'PENDING_CONFIRMATION') {
          await prismaAny.actionTask.update({
            where: { id: existingTask.id },
            data: { status: 'QUEUED' },
          });

          await this.queue.add(
            { actionTaskId: existingTask.id, organizationId: input.organizationId },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 15000 },
              removeOnComplete: true,
            },
          );

          await this.notifications.createOrgNotification(
            input.organizationId,
            'booking_requested',
            'New booking request captured',
            `${collectedFields.customer_name ?? input.customerName ?? 'A customer'} requested a meeting${collectedFields.preferred_datetime ? ` for ${collectedFields.preferred_datetime}` : ''}. Review the booking request in Operations.`,
            {
              actionTaskId: existingTask.id,
              bookingId: existingBooking?.id ?? null,
              botId: input.botId,
              customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
              preferredDatetime: collectedFields.preferred_datetime ?? null,
              bookingReason: collectedFields.booking_reason ?? null,
              followUpMissingFields: currentFollowUpMissingFields,
            },
          );
        }

        if (contract) {
          const customContract = this.getCustomIntakeFields(actionAiConfig, detected.actionType);
          const requiredFieldKeys = Array.from(new Set<string>([
            ...contract.requiredFields,
            ...customContract.requiredKeys,
          ]));
          await this.updateConversationContractDraft(input.conversationId, detected.actionType, {
            status: currentFollowUpMissingFields.length > 0 ? 'COLLECTING' : 'COMMITTED',
            requiredFields: requiredFieldKeys,
            missingFields: currentFollowUpMissingFields,
            collected: collectedFields,
            actionTaskId: existingTask.id,
          });
        }

        return this.buildForwardingResult({
          status: currentFollowUpMissingFields.length > 0 ? 'DUPLICATE' : 'QUEUED',
          reason: currentFollowUpMissingFields.length > 0 ? 'DUPLICATE_ACTION' : 'QUEUED_ACTION',
          actionType: detected.actionType,
          capabilityKey,
          actionTaskId: existingTask.id,
          missingFields: currentFollowUpMissingFields.length > 0 ? currentFollowUpMissingFields : undefined,
        });
      }
    }

    const fingerprint = this.buildFingerprint(detected.actionType, input.messageText);
    const dedupeKey = this.buildDedupeKey(input.organizationId, input.conversationId, fingerprint);
    const existing = await prismaAny.actionTask.findFirst({
      where: {
        orgId: input.organizationId,
        dedupeKey,
      },
      select: { id: true },
    });
    if (existing) {
      return this.buildForwardingResult({
        status: 'DUPLICATE',
        reason: 'DUPLICATE_ACTION',
        actionType: detected.actionType,
        capabilityKey,
        actionTaskId: existing.id,
      });
    }

    const task = await prismaAny.actionTask.create({
      data: {
        orgId: input.organizationId,
        botId: input.botId,
        conversationId: input.conversationId,
        sourceMessageId: input.messageId,
        actionType: detected.actionType,
        status: followUpMissingFields.length > 0
          ? 'PENDING_CONFIRMATION'
          : 'QUEUED',
        priority: detected.actionType === 'MEETING_REQUEST'
          ? rankActionPriority(`${collectedFields.booking_reason ?? ''} ${input.messageText}`)
          : detected.actionType === 'TECHNICAL_ISSUE'
            ? rankActionPriority(`${collectedFields.issue_summary ?? ''} ${input.messageText}`)
            : 'HIGH',
        summary: detected.summary,
        confidence: detected.confidence,
        dedupeKey,
        payload: {
          channel: input.channel,
          messageText: input.messageText,
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
          followUpMissingFields,
        },
      },
      select: { id: true, actionType: true, status: true },
    });

    if (task.actionType === 'SALES_ORDER_REQUEST') {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, task.actionType);
      const customFields = Object.fromEntries(
        Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
      );
      await prismaAny.salesOrder.create({
        data: {
          orgId: input.organizationId,
          botId: input.botId,
          actionTaskId: task.id,
          customerName: collectedFields.customer_name ?? input.customerName ?? null,
          customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
          product: collectedFields.product ?? null,
          notes: input.messageText,
          metadata: {
            customFields,
            customFieldVersion: customContract.version,
            followUpMissingFields,
          },
        },
      });

      await prismaAny.actionTask.update({
        where: { id: task.id },
        data: {
          payload: {
            channel: input.channel,
            messageText: input.messageText,
            customerName: collectedFields.customer_name ?? input.customerName ?? null,
            customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
            product: collectedFields.product ?? null,
            followUpMissingFields,
          },
        },
      });
    } else if (task.actionType === 'TECHNICAL_ISSUE') {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, task.actionType);
      const customFields = Object.fromEntries(
        Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
      );
      await prismaAny.technicalIssue.create({
        data: {
          orgId: input.organizationId,
          botId: input.botId,
          actionTaskId: task.id,
          reporterName: collectedFields.customer_name ?? input.customerName ?? null,
          reporterEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
          summary: collectedFields.issue_summary ?? detected.summary,
          details: input.messageText,
          metadata: {
            customFields,
            customFieldVersion: customContract.version,
          },
        },
      });

      await prismaAny.actionTask.update({
        where: { id: task.id },
        data: {
          payload: {
            channel: input.channel,
            messageText: input.messageText,
            customerName: collectedFields.customer_name ?? input.customerName ?? null,
            customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
            issueSummary: collectedFields.issue_summary ?? null,
            issueDetails: input.messageText,
            followUpMissingFields,
          },
        },
      });
    } else if (task.actionType === 'MEETING_REQUEST') {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, task.actionType);
      const customFields = Object.fromEntries(
        Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
      );
      const booking = await prismaAny.booking.create({
        data: {
          orgId: input.organizationId,
          botId: input.botId,
          actionTaskId: task.id,
          customerName: collectedFields.customer_name ?? input.customerName ?? null,
          customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
          preferredDatetime: collectedFields.preferred_datetime ?? null,
          status: 'REQUESTED',
          notes: input.messageText,
          metadata: {
            customFields,
            customFieldVersion: customContract.version,
            bookingReason: collectedFields.booking_reason ?? null,
            followUpMissingFields,
          },
        },
      });

      await prismaAny.actionTask.update({
        where: { id: task.id },
        data: {
          payload: {
            channel: input.channel,
            messageText: input.messageText,
            customerName: input.customerName ?? null,
            customerEmail: input.customerEmail ?? null,
            bookingId: booking.id,
            preferredDatetime: collectedFields.preferred_datetime ?? null,
            bookingReason: collectedFields.booking_reason ?? null,
            followUpMissingFields,
          },
        },
      });

      if (task.status === 'QUEUED') {
        await this.notifications.createOrgNotification(
          input.organizationId,
          'booking_requested',
          'New booking request captured',
          `${collectedFields.customer_name ?? input.customerName ?? 'A customer'} requested a meeting${collectedFields.preferred_datetime ? ` for ${collectedFields.preferred_datetime}` : ''}. Review the booking request in Operations.`,
          {
            actionTaskId: task.id,
            bookingId: booking.id,
            botId: input.botId,
            customerEmail: collectedFields.customer_email ?? input.customerEmail ?? null,
            preferredDatetime: collectedFields.preferred_datetime ?? null,
            bookingReason: collectedFields.booking_reason ?? null,
            followUpMissingFields,
          },
        );
      }
    }

    if (task.status === 'QUEUED') {
      await this.queue.add(
        { actionTaskId: task.id, organizationId: input.organizationId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
          removeOnComplete: true,
        },
      );
    }

    if (contract) {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, detected.actionType);
      const requiredFieldKeys = Array.from(new Set<string>([
        ...contract.requiredFields,
        ...customContract.requiredKeys,
      ]));
      await this.updateConversationContractDraft(input.conversationId, detected.actionType, {
        status: followUpMissingFields.length > 0 ? 'COLLECTING' : 'COMMITTED',
        requiredFields: requiredFieldKeys,
        missingFields: followUpMissingFields,
        collected: collectedFields,
        actionTaskId: task.id,
      });
    }

    return this.buildForwardingResult({
      status: 'QUEUED',
      reason: 'QUEUED_ACTION',
      actionType: detected.actionType,
      capabilityKey,
      actionTaskId: task.id,
      missingFields: followUpMissingFields.length > 0 ? followUpMissingFields : undefined,
    });
  }
}
