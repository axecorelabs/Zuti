import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHash } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import {
  ActionType,
  AiActionClassifierResponse,
  ContactEndpointConfig,
  ContactPolicyConfig,
  ResolveRouteInput,
  ResolveRouteResult,
} from './action-forwarding.types';

interface InboundActionSignalInput {
  organizationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  messageText: string;
  channel: 'EMAIL' | 'TELEGRAM' | 'WIDGET';
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
  | 'product'
  | 'issue_summary';

interface ActionContractDefinition {
  requiredFields: ContractFieldKey[];
}

const ACTION_CONTRACTS: Partial<Record<ActionType, ActionContractDefinition>> = {
  MEETING_REQUEST: {
    requiredFields: ['customer_name', 'customer_email', 'preferred_datetime'],
  },
  SALES_ORDER_REQUEST: {
    requiredFields: ['customer_name', 'customer_email', 'product'],
  },
  TECHNICAL_ISSUE: {
    requiredFields: ['customer_name', 'customer_email', 'issue_summary'],
  },
};

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type ActionForwardingResultStatus = 'DISABLED' | 'NO_INTENT' | 'DUPLICATE' | 'QUEUED';

export type ActionForwardingReason =
  | 'FORWARDING_DISABLED'
  | 'NO_ACTIONABLE_INTENT'
  | 'SKILL_NOT_ENABLED'
  | 'MISSING_CONTACT_INFO'
  | 'MISSING_REQUIRED_FIELDS'
  | 'DUPLICATE_ACTION'
  | 'QUEUED_ACTION'
  | 'SYSTEM_ERROR';

export type ActionForwardingMissingField = string;

export interface ActionForwardingResult {
  status: ActionForwardingResultStatus;
  reason: ActionForwardingReason;
  actionType?: ActionType;
  missingFields?: ActionForwardingMissingField[];
  blockedCapability?: string;
}

@Injectable()
export class ActionForwardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
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
      if (datetimeMatch?.[0]) extracted.preferred_datetime = datetimeMatch[0].trim();
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

  async detectAndQueue(input: InboundActionSignalInput): Promise<ActionForwardingResult> {
    if (!input.actionForwardingEnabled) {
      return {
        status: 'DISABLED',
        reason: 'FORWARDING_DISABLED',
      };
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
      return {
        status: 'NO_INTENT',
        reason: 'NO_ACTIONABLE_INTENT',
      };
    }

    const bot = await this.prisma.bot.findUnique({
      where: { id: input.botId },
      select: { capabilities: true, aiConfig: true },
    });
    const capabilities = ((bot?.capabilities as Record<string, unknown> | null) ?? {});
    if (!this.isActionEnabledByCapabilities(detected.actionType, capabilities)) {
      return {
        status: 'NO_INTENT',
        reason: 'SKILL_NOT_ENABLED',
        actionType: detected.actionType,
        blockedCapability: this.blockedCapabilityForAction(detected.actionType),
      };
    }

    const contract = ACTION_CONTRACTS[detected.actionType];
    let collectedFields: Record<string, string> = {};
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

      const missingFields = requiredFieldKeys.filter((field) => {
        const value = collectedFields[field];
        return !value || value.trim().length === 0;
      });

      await this.updateConversationContractDraft(input.conversationId, detected.actionType, {
        status: missingFields.length > 0 ? 'COLLECTING' : 'READY',
        requiredFields: requiredFieldKeys,
        missingFields,
        collected: collectedFields,
      });

      if (missingFields.length > 0) {
        return {
          status: 'NO_INTENT',
          reason: 'MISSING_REQUIRED_FIELDS',
          actionType: detected.actionType,
          missingFields,
        };
      }
    }

    const fingerprint = this.buildFingerprint(detected.actionType, input.messageText);
    const dedupeKey = this.buildDedupeKey(input.organizationId, input.conversationId, fingerprint);
    const prismaAny = this.prisma as any;

    const existing = await prismaAny.actionTask.findFirst({
      where: {
        orgId: input.organizationId,
        dedupeKey,
      },
      select: { id: true },
    });
    if (existing) {
      return {
        status: 'DUPLICATE',
        reason: 'DUPLICATE_ACTION',
        actionType: detected.actionType,
      };
    }

    const task = await prismaAny.actionTask.create({
      data: {
        orgId: input.organizationId,
        botId: input.botId,
        conversationId: input.conversationId,
        sourceMessageId: input.messageId,
        actionType: detected.actionType,
        status: 'QUEUED',
        priority: 'HIGH',
        summary: detected.summary,
        confidence: detected.confidence,
        dedupeKey,
        payload: {
          channel: input.channel,
          messageText: input.messageText,
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
        },
      },
      select: { id: true, actionType: true },
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
    } else if (task.actionType === 'MEETING_REQUEST') {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, task.actionType);
      const customFields = Object.fromEntries(
        Object.entries(collectedFields).filter(([key]) => customContract.fields.some((field) => normalizeFieldKey(field.key) === key)),
      );
      await prismaAny.booking.create({
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
          },
        },
      });
    }

    await this.queue.add(
      { actionTaskId: task.id, organizationId: input.organizationId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: true,
      },
    );

    if (contract) {
      const aiConfig = ((bot?.aiConfig as BotAiConfig | null) ?? {});
      const customContract = this.getCustomIntakeFields(aiConfig, detected.actionType);
      const requiredFieldKeys = Array.from(new Set<string>([
        ...contract.requiredFields,
        ...customContract.requiredKeys,
      ]));
      await this.updateConversationContractDraft(input.conversationId, detected.actionType, {
        status: 'COMMITTED',
        requiredFields: requiredFieldKeys,
        missingFields: [],
        collected: collectedFields,
        actionTaskId: task.id,
      });
    }

    return {
      status: 'QUEUED',
      reason: 'QUEUED_ACTION',
      actionType: detected.actionType,
    };
  }
}
