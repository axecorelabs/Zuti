import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateBotDto, UpdateBotDto } from './dto/bot.dto';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CsatClassifierService } from '../ai-usage/csat-classifier.service';
import { LanguagePreferenceService } from '../ai-usage/language-preference.service';
import { TeamChatService } from '../team-chat/team-chat.service';
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
import { OrganizationsService } from '../organizations/organizations.service';
import { ActionForwardingService, ActionForwardingResult } from '../action-forwarding/action-forwarding.service';
import { CustomerIdentityService } from '../customers/customer-identity.service';
import { extractWhatsAppConfig, prepareWhatsAppConfigForStorage } from '../../common/utils/whatsapp';
import { buildLocalizedCsatPositiveMessage, getPreferredLanguageFromMetadata } from '../../common/utils/language';
import { buildCommerceGroundingContextBlock } from '../../common/utils/commerce-grounding';

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function estimateUsageCredits(promptTokens: number, completionTokens: number): number {
  return computeUsageCredits(promptTokens, completionTokens, 1);
}

type BotTemplate = 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL' | 'ECOMMERCE';
type BotSkill = 'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING';
type CapabilitySkill = 'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING';
type BotMode = 'GENERALIST' | 'SPECIALIST';
type BotPrimaryChannel = 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';
type WhatsAppProvider = 'META' | 'TWILIO';
type WhatsAppIntegrationMode = 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';

interface SpecialistProfile {
  mode: BotMode;
  skill: BotSkill;
  strictScope: boolean;
}

interface WhatsAppConnectionInput {
  provider: WhatsAppProvider;
  integrationMode: WhatsAppIntegrationMode;
  channelIdentifier: string;
  phoneNumber?: string;
  displayName?: string;
  verifyToken?: string;
  config?: Record<string, unknown>;
}

interface MetaEmbeddedStatePayload {
  state: string;
  issuedAt: string;
  consumedAt?: string;
}

interface MetaEmbeddedPhoneOption {
  businessAccountId: string;
  businessAccountName?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface MetaEmbeddedSelectionRequiredResponse {
  requiresSelection: true;
  sessionId: string;
  options: MetaEmbeddedPhoneOption[];
}

const BOT_SKILLS: BotSkill[] = ['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'];

function normalizeSkills(input?: string[]): BotSkill[] {
  if (!input || input.length === 0) return [];
  const set = new Set<BotSkill>();
  for (const item of input) {
    if (BOT_SKILLS.includes(item as BotSkill)) {
      set.add(item as BotSkill);
    }
  }
  return Array.from(set);
}

function buildCapabilitiesFromSkills(skills: BotSkill[]) {
  const has = (skill: BotSkill) => skills.includes(skill);
  return {
    skills: {
      SALES: has('SALES'),
      BOOKING: has('BOOKING'),
      SUPPORT: has('SUPPORT'),
      TECHNICAL: has('TECHNICAL'),
      FORWARDING: has('FORWARDING'),
    },
    // Backward-compatible flags consumed by existing forwarding/reporting logic.
    canCreateLead: has('SALES'),
    canCreateOrder: has('SALES'),
    canNotifyOwner: has('FORWARDING'),
    canNotifyTeam: has('FORWARDING'),
    canCreateMeetingRequest: has('BOOKING'),
    canCreateTechnicalIssue: has('SUPPORT') || has('TECHNICAL'),
    // Registration is a general self-service capability, not tied to any one specialist skill.
    canCreateRegistration: true,
  };
}

function extractSkillsFromCapabilities(capabilities: Record<string, unknown>): BotSkill[] {
  const skills = (capabilities.skills ?? {}) as Record<string, unknown>;
  const enabled = BOT_SKILLS.filter((skill) => skills[skill] === true);
  return enabled;
}

function isSkillEnabledForAction(
  actionType: string | undefined,
  capabilities: Record<string, unknown>,
): boolean {
  if (!actionType) return false;

  const skills = (capabilities.skills ?? {}) as Record<string, unknown>;
  switch (actionType) {
    case 'CONSULTATION_REQUEST':
    case 'SALES_ORDER_REQUEST':
      return capabilities.canCreateOrder === true || capabilities.canCreateLead === true || skills.SALES === true;
    case 'MEETING_REQUEST':
      return capabilities.canCreateMeetingRequest === true || skills.BOOKING === true;
    case 'TECHNICAL_ISSUE':
      return capabilities.canCreateTechnicalIssue === true || skills.SUPPORT === true || skills.TECHNICAL === true;
    case 'OWNER_ATTENTION_NEEDED':
      return capabilities.canNotifyOwner === true || capabilities.canNotifyTeam === true || skills.FORWARDING === true;
    default:
      return false;
  }
}

function buildCapabilityAvailabilityPrompt(capabilities: Record<string, unknown>): string {
  const skills = (capabilities.skills ?? {}) as Record<string, unknown>;
  const allSkills: CapabilitySkill[] = ['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'];
  const enabled = allSkills.filter((skill) => skills[skill] === true);
  const disabled = allSkills.filter((skill) => !enabled.includes(skill));

  return [
    'Capability availability for this bot:',
    `- Enabled workflows: ${enabled.length > 0 ? enabled.join(', ') : 'none'}.`,
    `- Disabled workflows: ${disabled.length > 0 ? disabled.join(', ') : 'none'}.`,
    '- Do not imply you can execute disabled workflows.',
    '- If a user requests a disabled workflow, explicitly say it is not enabled on this bot and offer human routing.',
  ].join('\n');
}

function applyForwardingPreference(skills: BotSkill[], actionForwardingEnabled?: boolean): BotSkill[] {
  if (actionForwardingEnabled === undefined) return skills;
  const withoutForwarding = skills.filter((skill) => skill !== 'FORWARDING');
  return actionForwardingEnabled ? [...withoutForwarding, 'FORWARDING'] : withoutForwarding;
}

function templateForSpecialistSkill(skill: BotSkill): BotTemplate {
  switch (skill) {
    case 'SALES':
      return 'SALES';
    case 'BOOKING':
      return 'BOOKING';
    case 'TECHNICAL':
    case 'SUPPORT':
      return 'TECHNICAL';
    case 'FORWARDING':
      return 'GENERAL';
    default:
      return 'GENERAL';
  }
}

function parseSpecialistProfile(aiConfig: unknown): SpecialistProfile | null {
  if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) return null;
  const profile = (aiConfig as Record<string, unknown>).specialistProfile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;

  const mode = (profile as Record<string, unknown>).mode;
  const skill = (profile as Record<string, unknown>).skill;
  const strictScope = (profile as Record<string, unknown>).strictScope;
  if ((mode !== 'GENERALIST' && mode !== 'SPECIALIST') || !BOT_SKILLS.includes(skill as BotSkill)) {
    return null;
  }

  return {
    mode,
    skill: skill as BotSkill,
    strictScope: strictScope !== false,
  };
}

function normalizeSpecialistIntent(
  botMode: BotMode,
  specialistSkill: BotSkill | null,
  requestedSkills: BotSkill[],
  actionForwardingPreference?: boolean,
): { mode: BotMode; specialistSkill: BotSkill | null; skills: BotSkill[] } {
  if (botMode !== 'SPECIALIST') {
    if (specialistSkill) {
      throw new BadRequestException('specialistSkill can only be set when botMode is SPECIALIST');
    }
    return {
      mode: 'GENERALIST',
      specialistSkill: null,
      skills: applyForwardingPreference(requestedSkills, actionForwardingPreference),
    };
  }

  if (!specialistSkill) {
    throw new BadRequestException('specialistSkill is required when botMode is SPECIALIST');
  }

  const nonForwardingRequested = requestedSkills.filter((skill) => skill !== 'FORWARDING');
  if (nonForwardingRequested.length > 0 && nonForwardingRequested.some((skill) => skill !== specialistSkill)) {
    throw new BadRequestException('SPECIALIST bots can only enable their specialist skill (and optional FORWARDING).');
  }

  return {
    mode: 'SPECIALIST',
    specialistSkill,
    skills: applyForwardingPreference([specialistSkill], actionForwardingPreference ?? true),
  };
}

function isBlockedCapabilityReason(reason: string | undefined): boolean {
  return reason === 'SKILL_NOT_ENABLED'
    || reason === 'CHANNEL_NOT_ALLOWED'
    || reason === 'EXECUTOR_DISABLED'
    || reason === 'FORWARDING_DISABLED';
}

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

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
    return withoutProtocol.split('/')[0].split(':')[0].trim();
  }
}

function sanitizePhoneNumber(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/^\+/, '')}`;
}

function isE164PhoneNumber(value: string | null): boolean {
  return Boolean(value && /^\+[1-9]\d{6,14}$/.test(value));
}

function normalizeWhatsAppConnection(input: WhatsAppConnectionInput): WhatsAppConnectionInput {
  return {
    provider: input.provider,
    integrationMode: input.integrationMode,
    channelIdentifier: input.channelIdentifier.trim(),
    phoneNumber: sanitizePhoneNumber(input.phoneNumber) ?? undefined,
    displayName: input.displayName?.trim() || undefined,
    verifyToken: input.verifyToken?.trim() || undefined,
    config: input.config ?? {},
  };
}

function parseMetaEmbeddedState(config: unknown): MetaEmbeddedStatePayload | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const embedded = (config as Record<string, unknown>).metaEmbedded as Record<string, unknown> | undefined;
  if (!embedded) return null;
  const state = typeof embedded.state === 'string' ? embedded.state : '';
  const issuedAt = typeof embedded.issuedAt === 'string' ? embedded.issuedAt : '';
  const consumedAt = typeof embedded.consumedAt === 'string' ? embedded.consumedAt : undefined;
  if (!state || !issuedAt) return null;
  return { state, issuedAt, consumedAt };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toMetaEmbeddedOptions(accounts: Array<{
  id: string;
  name?: string;
  phone_numbers?: {
    data?: Array<{
      id: string;
      display_phone_number?: string;
      verified_name?: string;
    }>;
  };
}>): MetaEmbeddedPhoneOption[] {
  const options: MetaEmbeddedPhoneOption[] = [];
  for (const account of accounts) {
    const numbers = Array.isArray(account?.phone_numbers?.data) ? account.phone_numbers.data : [];
    for (const phone of numbers) {
      if (!phone?.id) continue;
      options.push({
        businessAccountId: account.id,
        businessAccountName: account.name,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        verifiedName: phone.verified_name,
      });
    }
  }
  return options;
}

function extractHostFromHeader(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
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

function getTemplatePreset(template: BotTemplate) {
  switch (template) {
    case 'SALES':
      return {
        capabilities: {
          canCreateLead: true,
          canCreateOrder: true,
          canNotifyOwner: true,
          canNotifyTeam: true,
          canCreateMeetingRequest: true,
          canCreateTechnicalIssue: false,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: true,
      };
    case 'SUPPORT':
      return {
        capabilities: {
          canCreateLead: false,
          canCreateOrder: false,
          canNotifyOwner: true,
          canNotifyTeam: true,
          canCreateMeetingRequest: false,
          canCreateTechnicalIssue: true,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: true,
      };
    case 'BOOKING':
      return {
        capabilities: {
          canCreateLead: false,
          canCreateOrder: false,
          canNotifyOwner: true,
          canNotifyTeam: true,
          canCreateMeetingRequest: true,
          canCreateTechnicalIssue: false,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: true,
      };
    case 'TECHNICAL':
      return {
        capabilities: {
          canCreateLead: false,
          canCreateOrder: false,
          canNotifyOwner: true,
          canNotifyTeam: true,
          canCreateMeetingRequest: false,
          canCreateTechnicalIssue: true,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: true,
      };
    case 'ECOMMERCE':
      return {
        capabilities: {
          canCreateLead: false,
          canCreateOrder: true,
          canNotifyOwner: true,
          canNotifyTeam: false,
          canCreateMeetingRequest: false,
          canCreateTechnicalIssue: false,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: true,
        aiConfig: {
          guidedPreset: 'ecommerce',
          mission: 'Help customers discover products and place orders. You are a friendly, persuasive sales assistant who knows the product catalog well. Guide customers toward purchase, collect their order details, and confirm their order before submitting.',
          persona: 'Persuasive sales assistant',
          tone: 'Friendly and conversational',
          escalationPolicy: 'Only escalate if the customer explicitly asks to speak with a human.',
        },
      };
    case 'GENERAL':
    default:
      return {
        capabilities: {
          canCreateLead: true,
          canCreateOrder: true,
          canNotifyOwner: true,
          canNotifyTeam: true,
          canCreateMeetingRequest: true,
          canCreateTechnicalIssue: true,
          canCreateRegistration: true,
        },
        actionForwardingEnabled: false,
      };
  }
}

function getTemplateCatalog() {
  const templates: BotTemplate[] = ['GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL', 'ECOMMERCE'];
  return templates.map((template) => {
    const preset = getTemplatePreset(template);
    return {
      template,
      name: template.charAt(0) + template.slice(1).toLowerCase(),
      description: {
        GENERAL: 'Flexible bot for mixed use cases and general routing.',
        SALES: 'Lead capture and order intake with owner/team alerts.',
        SUPPORT: 'Support-focused bot with technical issue forwarding.',
        BOOKING: 'Meeting and scheduling focused bot.',
        TECHNICAL: 'Technical issue and incident intake bot.',
        ECOMMERCE: 'Sales-first bot that takes product orders and sends customers a payment link automatically.',
      }[template],
      actionForwardingEnabled: preset.actionForwardingEnabled,
      capabilities: preset.capabilities,
    };
  });
}

const FORWARDING_CONFIG_REDIRECT = '/settings/forwarding';

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
    private readonly cannedResponses: CannedResponsesService,
    private readonly aiUsage: AiUsageService,
    private readonly csatClassifier: CsatClassifierService,
    private readonly languagePreference: LanguagePreferenceService,
    private readonly teamChat: TeamChatService,
    private readonly billing: BillingService,
    private readonly activity: ActivityService,
    private readonly orgs: OrganizationsService,
    private readonly actionForwarding: ActionForwardingService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {}

  private async hasForwardingRouteConfiguration(organizationId: string, botId?: string): Promise<boolean> {
    const [botPolicies, orgPolicies, endpoints] = await Promise.all([
      botId
        ? this.prisma.contactPolicy.findMany({ where: { orgId: organizationId, botId } })
        : Promise.resolve([]),
      this.prisma.contactPolicy.findMany({ where: { orgId: organizationId, botId: null } }),
      this.prisma.contactEndpoint.findMany({ where: { orgId: organizationId, isActive: true } }),
    ]);

    const route = this.actionForwarding.resolveRoute({
      actionType: 'OWNER_ATTENTION_NEEDED',
      botPolicies: botPolicies as any,
      orgPolicies: orgPolicies as any,
      endpoints: endpoints as any,
    });

    return Boolean(route.endpoint && route.policy);
  }

  private throwForwardingConfigurationRequired(): never {
    throw new BadRequestException({
      code: 'FORWARDING_CONFIG_REQUIRED',
      message: 'Forwarding requires at least one active endpoint and a default routing policy.',
      redirectTo: FORWARDING_CONFIG_REDIRECT,
    });
  }

  private sanitizeBot<T extends Record<string, unknown>>(bot: T): Omit<T, 'whatsappConfig' | 'whatsappVerifyToken'> {
    const { whatsappConfig: _whatsappConfig, whatsappVerifyToken: _whatsappVerifyToken, ...safeBot } = bot as T & {
      whatsappConfig?: unknown;
      whatsappVerifyToken?: unknown;
    };
    return safeBot;
  }

  async create(organizationId: string, dto: CreateBotDto) {
    const primaryChannel: BotPrimaryChannel = dto.primaryChannel ?? 'TELEGRAM';
    const telegramToken = dto.telegramToken?.trim();
    const needsTelegram = primaryChannel === 'TELEGRAM';
    const requestedWhatsAppConnection = dto.whatsappProvider && dto.whatsappIntegrationMode && dto.whatsappChannelIdentifier
      ? normalizeWhatsAppConnection({
          provider: dto.whatsappProvider,
          integrationMode: dto.whatsappIntegrationMode,
          channelIdentifier: dto.whatsappChannelIdentifier,
          phoneNumber: dto.whatsappPhoneNumber,
          displayName: dto.whatsappDisplayName,
          config: dto.whatsappConfig,
        })
      : null;
    const initialAllowedDomains = Array.from(new Set(
      (dto.webWidgetAllowedDomains ?? [])
        .map((domain) => normalizeDomain(domain))
        .filter(Boolean),
    ));
    const requestedBotMode: BotMode = dto.botMode ?? 'GENERALIST';
    const requestedSpecialistSkill = (dto.specialistSkill ?? null) as BotSkill | null;
    const specialistResolution = normalizeSpecialistIntent(
      requestedBotMode,
      requestedSpecialistSkill,
      normalizeSkills(dto.skills),
      dto.actionForwardingEnabled ?? true,
    );
    const requestedSkills = specialistResolution.skills;
    const isEcommerceTemplate = dto.template === 'ECOMMERCE';
    const template: BotTemplate = isEcommerceTemplate
      ? 'ECOMMERCE'
      : specialistResolution.mode === 'SPECIALIST' && specialistResolution.specialistSkill
        ? templateForSpecialistSkill(specialistResolution.specialistSkill)
        : 'GENERAL';
    const ecommercePreset = isEcommerceTemplate ? getTemplatePreset('ECOMMERCE') : null;
    const capabilities = isEcommerceTemplate
      ? ecommercePreset!.capabilities
      : buildCapabilitiesFromSkills(requestedSkills);
    const actionForwardingEnabled = isEcommerceTemplate
      ? true
      : requestedSkills.includes('FORWARDING');
    const aiConfig: Record<string, unknown> = isEcommerceTemplate
      ? { ...(ecommercePreset!.aiConfig ?? {}) }
      : specialistResolution.mode === 'SPECIALIST' && specialistResolution.specialistSkill
        ? {
            specialistProfile: {
              mode: 'SPECIALIST',
              skill: specialistResolution.specialistSkill,
              strictScope: true,
            },
          }
        : {};

    const nameConflict = await this.prisma.bot.findFirst({
      where: { organizationId, name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (nameConflict) throw new BadRequestException('A bot with this name already exists in your organization');

    if (actionForwardingEnabled) {
      const hasRoute = await this.hasForwardingRouteConfiguration(organizationId);
      if (!hasRoute) this.throwForwardingConfigurationRequired();
    }

    if (dto.commerceStoreId) {
      const storeExists = await this.prisma.commerceStore.findFirst({
        where: { id: dto.commerceStoreId, organizationId },
        select: { id: true },
      });
      if (!storeExists) throw new NotFoundException('Commerce store not found');
    }

    if (needsTelegram && !telegramToken) {
      throw new BadRequestException('Telegram token is required for Telegram bots');
    }

    if (primaryChannel === 'WEB_WIDGET' && initialAllowedDomains.length === 0) {
      throw new BadRequestException('Set at least one allowed widget domain before enabling the web widget channel');
    }

    if (primaryChannel === 'WHATSAPP' && !requestedWhatsAppConnection) {
      throw new BadRequestException('WhatsApp connection details are required when WhatsApp is the primary channel');
    }

    if (requestedWhatsAppConnection) {
      await this.validateWhatsAppConnection(requestedWhatsAppConnection);
      await this.ensureWhatsAppChannelAvailable(requestedWhatsAppConnection.channelIdentifier);
    }

    const requestedWhatsAppConfig = requestedWhatsAppConnection
      ? prepareWhatsAppConfigForStorage(requestedWhatsAppConnection.provider, (requestedWhatsAppConnection.config ?? {}) as Record<string, unknown>)
      : {};

    let telegramUsername: string | null = null;

    if (telegramToken) {
      // Validate token with Telegram
      const botInfo = await this.getTelegramBotInfo(telegramToken);
      telegramUsername = botInfo.username;

      const existing = await this.prisma.bot.findUnique({
        where: { telegramToken },
      });
      if (existing) {
        throw new BadRequestException('This Telegram bot token is already registered');
      }
    }

    const created = await this.prisma.bot.create({
      data: {
        organizationId,
        name: dto.name,
        primaryChannel,
        telegramToken: telegramToken ?? null,
        telegramUsername,
        webWidgetEnabled: primaryChannel === 'WEB_WIDGET',
        webWidgetKey: primaryChannel === 'WEB_WIDGET' ? this.generateWidgetKey() : null,
        webWidgetAllowedDomains: initialAllowedDomains,
        whatsappEnabled: primaryChannel === 'WHATSAPP',
        whatsappProvider: requestedWhatsAppConnection?.provider,
        whatsappIntegrationMode: requestedWhatsAppConnection?.integrationMode,
        whatsappChannelIdentifier: requestedWhatsAppConnection?.channelIdentifier,
        whatsappPhoneNumber: requestedWhatsAppConnection?.phoneNumber ?? null,
        whatsappDisplayName: requestedWhatsAppConnection?.displayName ?? null,
        whatsappVerifyToken: requestedWhatsAppConnection?.verifyToken ?? this.generateWhatsappVerifyToken(),
        whatsappConfig: requestedWhatsAppConfig as Prisma.InputJsonValue,
        isActive: true,
        aiConfig: aiConfig as Prisma.InputJsonValue,
        template,
        capabilities: capabilities as any,
        actionForwardingEnabled,
        ...(dto.commerceStoreId && { commerceStoreId: dto.commerceStoreId }),
      },
    });
    return this.sanitizeBot(created as any);
  }

  getTemplateCatalog() {
    return getTemplateCatalog();
  }

  async findAll(organizationId: string) {
    const bots = await this.prisma.bot.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return bots.map((bot) => this.sanitizeBot(bot as any));
  }

  async findOne(organizationId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId },
    });
    if (!bot) throw new NotFoundException('Bot not found');
    return this.sanitizeBot(bot as any);
  }

  async update(organizationId: string, botId: string, dto: UpdateBotDto) {
    const existing = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId },
    });
    if (!existing) throw new NotFoundException('Bot not found');

    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
      const nameConflict = await this.prisma.bot.findFirst({
        where: { organizationId, name: { equals: dto.name, mode: 'insensitive' }, id: { not: botId } },
        select: { id: true },
      });
      if (nameConflict) throw new BadRequestException('A bot with this name already exists in your organization');
    }

    const enableWidget = dto.webWidgetEnabled === true;
    const currentAllowedDomains = Array.from(new Set(
      (existing.webWidgetAllowedDomains ?? [])
        .map((domain) => normalizeDomain(domain))
        .filter(Boolean),
    ));
    const nextAllowedDomains = dto.webWidgetAllowedDomains === undefined
      ? undefined
      : Array.from(new Set(dto.webWidgetAllowedDomains.map((domain) => normalizeDomain(domain)).filter(Boolean)));
    const resolvedAllowedDomains = nextAllowedDomains ?? currentAllowedDomains;
    const widgetWillBeEnabled = dto.webWidgetEnabled === undefined ? existing.webWidgetEnabled : dto.webWidgetEnabled;
    const whatsappWillBeEnabled = dto.whatsappEnabled === undefined ? existing.whatsappEnabled : dto.whatsappEnabled;
    const existingWhatsAppConfig = extractWhatsAppConfig(existing.whatsappConfig);
    const nextTemplate = (dto.template ?? existing.template) as BotTemplate;
    const preset = getTemplatePreset(nextTemplate);
    const isExistingEcommerce = (existing.template as BotTemplate) === 'ECOMMERCE';
    const existingAiConfig = ((existing.aiConfig as Record<string, unknown> | null) ?? {});
    const existingSpecialistProfile = parseSpecialistProfile(existingAiConfig);
    const requestedBotMode: BotMode = dto.botMode
      ?? existingSpecialistProfile?.mode
      ?? 'GENERALIST';
    const requestedSpecialistSkill = (dto.specialistSkill
      ?? existingSpecialistProfile?.skill
      ?? null) as BotSkill | null;
    const currentSkills = extractSkillsFromCapabilities((existing.capabilities as Record<string, unknown> | null) ?? {});
    const skillInputBase = dto.skills !== undefined ? normalizeSkills(dto.skills) : currentSkills;
    const specialistResolution = normalizeSpecialistIntent(
      requestedBotMode,
      requestedSpecialistSkill,
      skillInputBase,
      dto.actionForwardingEnabled ?? existing.actionForwardingEnabled,
    );
    const requestedSkills = specialistResolution.skills;
    const hasSkillsUpdate = dto.skills !== undefined;
    const specialistTouched = dto.botMode !== undefined || dto.specialistSkill !== undefined;
    const resolvedSpecialistSkill = specialistResolution.mode === 'SPECIALIST'
      ? specialistResolution.specialistSkill
      : null;
    const isSpecialistMode = !!resolvedSpecialistSkill;
    // ECOMMERCE bots keep their template, capabilities, and forwarding state locked regardless
    // of any skills/specialist payload — prevents accidental demotion to GENERAL.
    const resolvedCapabilities = isExistingEcommerce
      ? preset.capabilities
      : (hasSkillsUpdate || specialistTouched)
        ? buildCapabilitiesFromSkills(requestedSkills)
        : (dto.template !== undefined ? preset.capabilities : undefined);
    const resolvedTemplate = isExistingEcommerce
      ? 'ECOMMERCE'
      : isSpecialistMode
        ? templateForSpecialistSkill(resolvedSpecialistSkill)
        : (hasSkillsUpdate ? 'GENERAL' : (dto.template !== undefined ? nextTemplate : undefined));
    const resolvedActionForwardingEnabled = isExistingEcommerce
      ? true
      : (hasSkillsUpdate || specialistTouched)
        ? requestedSkills.includes('FORWARDING')
        : dto.actionForwardingEnabled;

    const mergedAiConfig: Record<string, unknown> = {
      ...existingAiConfig,
      ...((dto.aiConfig as Record<string, unknown> | undefined) ?? {}),
    };
    if (isSpecialistMode) {
      mergedAiConfig.specialistProfile = {
        mode: 'SPECIALIST',
        skill: specialistResolution.specialistSkill,
        strictScope: true,
      };
    } else if (specialistTouched) {
      delete mergedAiConfig.specialistProfile;
    }

    if (resolvedActionForwardingEnabled === true && existing.actionForwardingEnabled !== true) {
      const hasRoute = await this.hasForwardingRouteConfiguration(organizationId, botId);
      if (!hasRoute) this.throwForwardingConfigurationRequired();
    }

    if (dto.commerceStoreId) {
      const storeExists = await this.prisma.commerceStore.findFirst({
        where: { id: dto.commerceStoreId, organizationId },
        select: { id: true },
      });
      if (!storeExists) throw new NotFoundException('Commerce store not found');
    }

    if (widgetWillBeEnabled && resolvedAllowedDomains.length === 0) {
      throw new BadRequestException('Set at least one allowed widget domain before enabling the web widget channel');
    }

    if (whatsappWillBeEnabled && !existing.whatsappChannelIdentifier && !dto.whatsappChannelIdentifier) {
      throw new BadRequestException('Connect WhatsApp before enabling the WhatsApp channel');
    }

    const resolvedWhatsAppProvider = (dto.whatsappProvider ?? existing.whatsappProvider ?? undefined) as WhatsAppProvider | undefined;
    const resolvedWhatsAppMode = (dto.whatsappIntegrationMode ?? existing.whatsappIntegrationMode ?? undefined) as WhatsAppIntegrationMode | undefined;
    const resolvedWhatsAppChannelIdentifier = (dto.whatsappChannelIdentifier ?? existing.whatsappChannelIdentifier ?? '').trim();
    const resolvedWhatsAppPhoneNumber = dto.whatsappPhoneNumber !== undefined
      ? sanitizePhoneNumber(dto.whatsappPhoneNumber)
      : existing.whatsappPhoneNumber;
    const resolvedWhatsAppDisplayName = dto.whatsappDisplayName !== undefined
      ? (dto.whatsappDisplayName.trim() || null)
      : existing.whatsappDisplayName;
    const resolvedWhatsAppConfig = dto.whatsappConfig !== undefined
      ? dto.whatsappConfig
      : existingWhatsAppConfig;

    const whatsappConnectionTouched = dto.whatsappProvider !== undefined
      || dto.whatsappIntegrationMode !== undefined
      || dto.whatsappChannelIdentifier !== undefined
      || dto.whatsappPhoneNumber !== undefined
      || dto.whatsappDisplayName !== undefined
      || dto.whatsappConfig !== undefined;
    const whatsappConnectionIdentityTouched = dto.whatsappProvider !== undefined
      || dto.whatsappIntegrationMode !== undefined
      || dto.whatsappChannelIdentifier !== undefined;

    let normalizedWhatsAppConnection: WhatsAppConnectionInput | null = null;
    let preparedWhatsAppConfig: Record<string, unknown> | null = null;

    if (whatsappConnectionTouched || (whatsappWillBeEnabled && (resolvedWhatsAppProvider || resolvedWhatsAppChannelIdentifier))) {
      if (!resolvedWhatsAppProvider || !resolvedWhatsAppMode || !resolvedWhatsAppChannelIdentifier) {
        if (whatsappWillBeEnabled) {
          throw new BadRequestException('Connect WhatsApp before enabling the WhatsApp channel');
        }
      } else {
        normalizedWhatsAppConnection = normalizeWhatsAppConnection({
          provider: resolvedWhatsAppProvider,
          integrationMode: resolvedWhatsAppMode,
          channelIdentifier: resolvedWhatsAppChannelIdentifier,
          phoneNumber: resolvedWhatsAppPhoneNumber ?? undefined,
          displayName: resolvedWhatsAppDisplayName ?? undefined,
          config: (resolvedWhatsAppConfig ?? {}) as Record<string, unknown>,
        });
        await this.validateWhatsAppConnection(normalizedWhatsAppConnection);
        await this.ensureWhatsAppChannelAvailable(normalizedWhatsAppConnection.channelIdentifier, botId);
        preparedWhatsAppConfig = prepareWhatsAppConfigForStorage(
          normalizedWhatsAppConnection.provider,
          (normalizedWhatsAppConnection.config ?? {}) as Record<string, unknown>,
        );
      }
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...((dto.aiConfig !== undefined || specialistTouched) && { aiConfig: mergedAiConfig as Prisma.InputJsonValue }),
        ...(dto.routeToRoles !== undefined && { routeToRoles: dto.routeToRoles }),
        ...(dto.webWidgetEnabled !== undefined && { webWidgetEnabled: dto.webWidgetEnabled }),
        ...(nextAllowedDomains !== undefined && { webWidgetAllowedDomains: nextAllowedDomains }),
        ...(dto.whatsappEnabled !== undefined && { whatsappEnabled: dto.whatsappEnabled }),
        ...(dto.whatsappProvider !== undefined && { whatsappProvider: normalizedWhatsAppConnection?.provider ?? dto.whatsappProvider }),
        ...(dto.whatsappIntegrationMode !== undefined && { whatsappIntegrationMode: normalizedWhatsAppConnection?.integrationMode ?? dto.whatsappIntegrationMode }),
        ...(dto.whatsappChannelIdentifier !== undefined && { whatsappChannelIdentifier: normalizedWhatsAppConnection?.channelIdentifier ?? null }),
        ...(dto.whatsappPhoneNumber !== undefined && { whatsappPhoneNumber: normalizedWhatsAppConnection?.phoneNumber ?? null }),
        ...(dto.whatsappDisplayName !== undefined && { whatsappDisplayName: normalizedWhatsAppConnection?.displayName ?? null }),
        ...((dto.whatsappConfig !== undefined || whatsappConnectionIdentityTouched) && {
          whatsappConfig: ((preparedWhatsAppConfig ?? resolvedWhatsAppConfig ?? {}) as Prisma.InputJsonValue),
        }),
        ...(resolvedCapabilities !== undefined && { capabilities: resolvedCapabilities as any }),
        ...(resolvedTemplate !== undefined && { template: resolvedTemplate as BotTemplate }),
        ...(resolvedActionForwardingEnabled !== undefined && { actionForwardingEnabled: resolvedActionForwardingEnabled }),
        ...((enableWidget && !existing.webWidgetKey) && { webWidgetKey: this.generateWidgetKey() }),
        ...(dto.commerceStoreId !== undefined && { commerceStoreId: dto.commerceStoreId || null }),
      },
    });
    return this.sanitizeBot(updated as any);
  }

  async remove(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    // Optionally delete webhook before removal
    if (bot.webhookSet && bot.telegramToken) {
      await this.deleteWebhook(bot.telegramToken).catch(() => null);
    }
    await this.prisma.bot.delete({ where: { id: botId } });
  }

  // ── Telegram channel ──────────────────────────────────────────────────────

  async connectTelegram(organizationId: string, botId: string, token: string) {
    await this.findOne(organizationId, botId);
    const trimmedToken = token.trim();

    const botInfo = await this.getTelegramBotInfo(trimmedToken);

    const existing = await this.prisma.bot.findUnique({ where: { telegramToken: trimmedToken } });
    if (existing && existing.id !== botId) {
      throw new BadRequestException('This Telegram bot token is already registered');
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        telegramToken: trimmedToken,
        telegramUsername: botInfo.username,
        webhookSet: false,
      },
    });
  }

  async disconnectTelegram(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    if (!bot.telegramToken) throw new BadRequestException('Telegram is not connected');

    if (bot.webhookSet) {
      await this.deleteWebhook(bot.telegramToken).catch(() => null);
    }

    return this.prisma.bot.update({
      where: { id: botId },
      data: {
        telegramToken: null,
        telegramUsername: null,
        webhookSet: false,
      },
    });
  }

  // ── WhatsApp channel ─────────────────────────────────────────────────────

  async connectWhatsApp(organizationId: string, botId: string, input: WhatsAppConnectionInput) {
    await this.findOne(organizationId, botId);
    const connection = normalizeWhatsAppConnection(input);
    await this.validateWhatsAppConnection(connection);
    await this.ensureWhatsAppChannelAvailable(connection.channelIdentifier, botId);
    const storedConfig = prepareWhatsAppConfigForStorage(connection.provider, (connection.config ?? {}) as Record<string, unknown>);

    const verifyToken = connection.verifyToken ?? this.generateWhatsappVerifyToken();

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        whatsappEnabled: true,
        whatsappProvider: connection.provider,
        whatsappIntegrationMode: connection.integrationMode,
        whatsappChannelIdentifier: connection.channelIdentifier,
        whatsappPhoneNumber: connection.phoneNumber ?? null,
        whatsappDisplayName: connection.displayName ?? null,
        whatsappVerifyToken: verifyToken,
        whatsappConfig: storedConfig as Prisma.InputJsonValue,
      },
    });
    return this.sanitizeBot(updated as any);
  }

  async disconnectWhatsApp(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    if (!bot.whatsappChannelIdentifier) {
      throw new BadRequestException('WhatsApp is not connected');
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        whatsappEnabled: false,
        whatsappProvider: null,
        whatsappIntegrationMode: null,
        whatsappChannelIdentifier: null,
        whatsappPhoneNumber: null,
        whatsappDisplayName: null,
        whatsappVerifyToken: null,
        whatsappConfig: {} as Prisma.InputJsonValue,
      },
    });
    return this.sanitizeBot(updated as any);
  }

  async startMetaEmbeddedSignup(organizationId: string, botId: string) {
    await this.findOne(organizationId, botId);
    const appId = (this.config.get<string>('META_APP_ID') ?? '').trim();
    if (!appId) {
      throw new BadRequestException('META_APP_ID is not configured');
    }

    const state = randomBytes(24).toString('hex');
    const redirectUri = this.getMetaEmbeddedRedirectUri();
    const existing = await this.prisma.bot.findUnique({ where: { id: botId }, select: { whatsappConfig: true } });
    const currentConfig = (existing?.whatsappConfig && typeof existing.whatsappConfig === 'object' && !Array.isArray(existing.whatsappConfig))
      ? existing.whatsappConfig as Record<string, unknown>
      : {};

    await this.prisma.bot.update({
      where: { id: botId },
      data: {
        whatsappConfig: {
          ...currentConfig,
          metaEmbedded: {
            state,
            issuedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'business_management,whatsapp_business_management,whatsapp_business_messaging',
      state,
    });

    return {
      authUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`,
      state,
      redirectUri,
    };
  }

  async completeMetaEmbeddedSignup(
    organizationId: string,
    botId: string,
    code: string,
    state: string,
    selectedBusinessAccountId?: string,
    selectedPhoneNumberId?: string,
  ): Promise<Record<string, unknown> | MetaEmbeddedSelectionRequiredResponse> {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId },
      select: { id: true, whatsappConfig: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');

    const appId = (this.config.get<string>('META_APP_ID') ?? '').trim();
    const appSecret = (this.config.get<string>('META_APP_SECRET') ?? '').trim();
    if (!appId || !appSecret) {
      throw new BadRequestException('META_APP_ID and META_APP_SECRET must be configured');
    }

    const embeddedState = parseMetaEmbeddedState(bot.whatsappConfig);
    if (!embeddedState || embeddedState.state !== state) {
      throw new BadRequestException('Invalid or expired embedded signup state');
    }
    if (embeddedState.consumedAt) {
      throw new BadRequestException('Embedded signup state already used. Restart the connection flow.');
    }

    const ageMs = Date.now() - new Date(embeddedState.issuedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
      throw new BadRequestException('Embedded signup state expired. Restart the connection flow.');
    }

    const currentConfig = (bot.whatsappConfig && typeof bot.whatsappConfig === 'object' && !Array.isArray(bot.whatsappConfig))
      ? bot.whatsappConfig as Record<string, unknown>
      : {};
    const currentMetaEmbedded = (currentConfig.metaEmbedded && typeof currentConfig.metaEmbedded === 'object' && !Array.isArray(currentConfig.metaEmbedded))
      ? currentConfig.metaEmbedded as Record<string, unknown>
      : {};

    const redirectUri = this.getMetaEmbeddedRedirectUri();
    const tokenRes = await firstValueFrom(
      this.http.get<{ access_token: string }>('https://graph.facebook.com/v20.0/oauth/access_token', {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      }),
    ).catch(() => null);

    const accessToken = tokenRes?.data?.access_token?.trim();
    if (!accessToken) {
      throw new BadRequestException('Failed to exchange Meta authorization code');
    }

    const wabaRes = await firstValueFrom(
      this.http.get<{
        data?: Array<{
          id: string;
          name?: string;
          phone_numbers?: {
            data?: Array<{
              id: string;
              display_phone_number?: string;
              verified_name?: string;
            }>;
          };
        }>;
      }>('https://graph.facebook.com/v20.0/me/owned_whatsapp_business_accounts', {
        params: {
          access_token: accessToken,
          fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
        },
      }),
    ).catch(() => null);

    const fallbackWabaRes = wabaRes?.data?.data?.length
      ? null
      : await firstValueFrom(
          this.http.get<{
            data?: Array<{
              id: string;
              name?: string;
              phone_numbers?: {
                data?: Array<{
                  id: string;
                  display_phone_number?: string;
                  verified_name?: string;
                }>;
              };
            }>;
          }>('https://graph.facebook.com/v20.0/me/whatsapp_business_accounts', {
            params: {
              access_token: accessToken,
              fields: 'id,name,phone_numbers{id,display_phone_number,verified_name}',
            },
          }),
        ).catch(() => null);

    const accounts = wabaRes?.data?.data?.length
      ? (wabaRes.data.data ?? [])
      : (fallbackWabaRes?.data?.data ?? []);
    const options = toMetaEmbeddedOptions(accounts);
    if (options.length === 0) {
      throw new BadRequestException('No WhatsApp phone number found for this Meta account');
    }

    const resolvedPhoneNumberId = selectedPhoneNumberId?.trim() || null;
    const resolvedBusinessAccountId = selectedBusinessAccountId?.trim() || null;
    const selectedOption = resolvedPhoneNumberId
      ? options.find((option) =>
          option.phoneNumberId === resolvedPhoneNumberId
          && (!resolvedBusinessAccountId || option.businessAccountId === resolvedBusinessAccountId),
        )
      : null;

    if (!selectedOption && options.length > 1) {
      const sessionId = randomBytes(24).toString('hex');
      const pendingCredentials = prepareWhatsAppConfigForStorage('META', { accessToken, appSecret });
      const optionsForStorage = options.map((option) => ({
        businessAccountId: option.businessAccountId,
        businessAccountName: option.businessAccountName ?? null,
        phoneNumberId: option.phoneNumberId,
        displayPhoneNumber: option.displayPhoneNumber ?? null,
        verifiedName: option.verifiedName ?? null,
      }));

      await this.prisma.bot.update({
        where: { id: botId },
        data: {
          whatsappConfig: {
            ...currentConfig,
            metaEmbedded: {
              ...currentMetaEmbedded,
              consumedAt: new Date().toISOString(),
              pendingSelection: {
                sessionId,
                issuedAt: new Date().toISOString(),
                options: optionsForStorage,
                credentials: pendingCredentials,
              },
            },
          } as Prisma.InputJsonValue,
        },
      });

      return {
        requiresSelection: true,
        sessionId,
        options,
      };
    }

    const option = selectedOption ?? options[0];

    await this.prisma.bot.update({
      where: { id: botId },
      data: {
        whatsappConfig: {
          ...currentConfig,
          metaEmbedded: {
            ...currentMetaEmbedded,
            consumedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });

    const connected = await this.connectWhatsApp(organizationId, botId, {
      provider: 'META',
      integrationMode: 'META_EMBEDDED_SIGNUP',
      channelIdentifier: option.phoneNumberId,
      phoneNumber: option.displayPhoneNumber,
      displayName: option.verifiedName,
      config: {
        accessToken,
        appSecret,
        businessAccountId: option.businessAccountId,
      },
    });

    return connected;
  }

  async completeMetaEmbeddedSelection(
    organizationId: string,
    botId: string,
    sessionId: string,
    selectedPhoneNumberId: string,
    selectedBusinessAccountId?: string,
  ): Promise<Record<string, unknown>> {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId },
      select: { whatsappConfig: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');

    const currentConfig = (bot.whatsappConfig && typeof bot.whatsappConfig === 'object' && !Array.isArray(bot.whatsappConfig))
      ? bot.whatsappConfig as Record<string, unknown>
      : {};
    const metaEmbedded = (currentConfig.metaEmbedded && typeof currentConfig.metaEmbedded === 'object' && !Array.isArray(currentConfig.metaEmbedded))
      ? currentConfig.metaEmbedded as Record<string, unknown>
      : {};
    const pendingSelection = (metaEmbedded.pendingSelection && typeof metaEmbedded.pendingSelection === 'object' && !Array.isArray(metaEmbedded.pendingSelection))
      ? metaEmbedded.pendingSelection as Record<string, unknown>
      : null;

    const pendingSessionId = typeof pendingSelection?.sessionId === 'string' ? pendingSelection.sessionId : '';
    if (!pendingSelection || !pendingSessionId || pendingSessionId !== sessionId) {
      throw new BadRequestException('Embedded signup selection session is invalid or expired');
    }

    const pendingIssuedAt = typeof pendingSelection.issuedAt === 'string' ? pendingSelection.issuedAt : '';
    const ageMs = Date.now() - new Date(pendingIssuedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
      throw new BadRequestException('Embedded signup selection expired. Restart the connection flow.');
    }

    const optionsRaw = Array.isArray(pendingSelection.options) ? pendingSelection.options : [];
    const options = optionsRaw
      .filter((option): option is MetaEmbeddedPhoneOption => Boolean(
        option
        && typeof option === 'object'
        && typeof (option as MetaEmbeddedPhoneOption).phoneNumberId === 'string'
        && typeof (option as MetaEmbeddedPhoneOption).businessAccountId === 'string',
      ));

    const resolvedPhoneNumberId = selectedPhoneNumberId.trim();
    const resolvedBusinessAccountId = selectedBusinessAccountId?.trim() || null;
    const selectedOption = options.find((option) =>
      option.phoneNumberId === resolvedPhoneNumberId
      && (!resolvedBusinessAccountId || option.businessAccountId === resolvedBusinessAccountId),
    );
    if (!selectedOption) {
      throw new BadRequestException('Selected WhatsApp phone number is not available for this session');
    }

    const credentialsRaw = (pendingSelection.credentials && typeof pendingSelection.credentials === 'object' && !Array.isArray(pendingSelection.credentials))
      ? pendingSelection.credentials
      : {};
    const credentials = extractWhatsAppConfig(credentialsRaw);
    const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
    const appSecret = typeof credentials.appSecret === 'string' ? credentials.appSecret.trim() : '';
    if (!accessToken || !appSecret) {
      throw new BadRequestException('Embedded signup credentials expired. Restart the connection flow.');
    }

    const connected = await this.connectWhatsApp(organizationId, botId, {
      provider: 'META',
      integrationMode: 'META_EMBEDDED_SIGNUP',
      channelIdentifier: selectedOption.phoneNumberId,
      phoneNumber: selectedOption.displayPhoneNumber,
      displayName: selectedOption.verifiedName,
      config: {
        accessToken,
        appSecret,
        businessAccountId: selectedOption.businessAccountId,
      },
    });

    return connected as Record<string, unknown>;
  }

  // ── Email channel ──────────────────────────────────────────────────────────

  async enableEmail(organizationId: string, botId: string, localPart: string) {
    const bot = await this.findOne(organizationId, botId);

    // Validate localPart: lowercase letters, numbers, hyphens only
    if (!/^[a-z0-9-]{1,32}$/.test(localPart)) {
      throw new BadRequestException(
        'Email local part must be 1–32 characters: lowercase letters, numbers, hyphens only',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const emailAddress = `${localPart}@${org.slug}.bords.app`;

    // Check uniqueness
    const conflict = await this.prisma.bot.findFirst({
      where: { emailAddress, NOT: { id: botId } },
    });
    if (conflict) {
      throw new BadRequestException(`The address ${emailAddress} is already in use`);
    }

    const updated = await this.prisma.bot.update({
      where: { id: botId },
      data: { emailEnabled: true, emailAddress },
    });

    // Register SendGrid Inbound Parse rule for this org subdomain
    await this.registerSendGridParseRule(`${org.slug}.bords.app`).catch((err) =>
      this.logger.warn(`SendGrid parse rule registration failed: ${err?.message}`),
    );

    return { emailAddress: updated.emailAddress };
  }

  async disableEmail(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    const emailAddress = bot.emailAddress;

    await this.prisma.bot.update({
      where: { id: botId },
      data: { emailEnabled: false },
    });

    // Remove SendGrid Inbound Parse rule only if no other active email bots exist for this org subdomain
    if (emailAddress) {
      const domain = emailAddress.split('@')[1];
      const otherEmailBots = await this.prisma.bot.count({
        where: { organizationId, emailEnabled: true, id: { not: botId } },
      });
      if (otherEmailBots === 0) {
        await this.deleteSendGridParseRule(domain).catch((err) =>
          this.logger.warn(`SendGrid parse rule deletion failed: ${err?.message}`),
        );
      }
    }

    return { ok: true };
  }

  async syncSendGridParseRuleForOrganization(organizationId: string): Promise<{ ok: true; hostname: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const hostname = `${org.slug}.bords.app`;
    await this.syncSendGridParseRule(hostname);
    return { ok: true, hostname };
  }

  private async registerSendGridParseRule(hostname: string): Promise<void> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) return;
    const baseWebhookUrl = `${this.config.get<string>('WEBHOOK_BASE_URL')}/api/webhooks/email`;
    const emailWebhookSecret = (this.config.get<string>('EMAIL_WEBHOOK_SECRET') ?? '').trim();
    if (!emailWebhookSecret) {
      this.logger.warn('EMAIL_WEBHOOK_SECRET is not configured; skipping SendGrid parse rule registration.');
      return;
    }
    const webhookUrl = `${baseWebhookUrl}?token=${encodeURIComponent(emailWebhookSecret)}`;

    try {
      await firstValueFrom(
        this.http.post(
          'https://api.sendgrid.com/v3/user/webhooks/parse/settings',
          { hostname, url: webhookUrl, spam_check: false, send_raw: false },
          { headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );
      return;
    } catch (error: unknown) {
      const status = Number((error as any)?.response?.status ?? 0);
      // Hostname may already exist; keep enable flow create-only and use explicit sync endpoint to update.
      if (status !== 400 && status !== 409) {
        throw error;
      }
      this.logger.warn(`SendGrid parse setting already exists for ${hostname}; run manual sync to update URL/token.`);
    }
  }

  private async syncSendGridParseRule(hostname: string): Promise<void> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('SENDGRID_API_KEY is not configured');
    }
    const baseWebhookUrl = `${this.config.get<string>('WEBHOOK_BASE_URL')}/api/webhooks/email`;
    const emailWebhookSecret = (this.config.get<string>('EMAIL_WEBHOOK_SECRET') ?? '').trim();
    if (!emailWebhookSecret) {
      throw new BadRequestException('EMAIL_WEBHOOK_SECRET is not configured');
    }

    const webhookUrl = `${baseWebhookUrl}?token=${encodeURIComponent(emailWebhookSecret)}`;

    try {
      await firstValueFrom(
        this.http.patch(
          `https://api.sendgrid.com/v3/user/webhooks/parse/settings/${hostname}`,
          { url: webhookUrl, spam_check: false, send_raw: false },
          { headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );
      return;
    } catch (error: unknown) {
      const status = Number((error as any)?.response?.status ?? 0);
      if (status !== 404) throw error;
    }

    await firstValueFrom(
      this.http.post(
        'https://api.sendgrid.com/v3/user/webhooks/parse/settings',
        { hostname, url: webhookUrl, spam_check: false, send_raw: false },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  private async deleteSendGridParseRule(hostname: string): Promise<void> {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) return;
    await firstValueFrom(
      this.http.delete(
        `https://api.sendgrid.com/v3/user/webhooks/parse/settings/${hostname}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );
  }

  async setWebhook(organizationId: string, botId: string) {
    const bot = await this.findOne(organizationId, botId);
    if (!bot.telegramToken) {
      throw new BadRequestException('Telegram channel is not connected for this bot');
    }
    const baseUrl = this.config.get<string>('WEBHOOK_BASE_URL');
    if (!baseUrl) {
      throw new BadRequestException('WEBHOOK_BASE_URL is not configured');
    }

    // Generate a secret token (max 256 chars, alphanumeric+underscore per Telegram docs)
    const webhookSecret = randomBytes(32).toString('hex');
    const webhookUrl = `${baseUrl}/api/webhooks/telegram/${botId}`;
    const res = await firstValueFrom(
      this.http.post<any>(`https://api.telegram.org/bot${bot.telegramToken}/setWebhook`, {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    );

    if (!res.data.ok) {
      throw new BadRequestException(`Telegram error: ${res.data.description}`);
    }

    await this.prisma.bot.update({
      where: { id: botId },
      data: { webhookSet: true, webhookSecret },
    });

    return { webhookUrl, telegramResponse: (res as any).data };
  }

  async deleteWebhook(telegramToken: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`https://api.telegram.org/bot${telegramToken}/deleteWebhook`),
    );
  }

  private async getTelegramBotInfo(token: string): Promise<{ username: string; id: number }> {
    try {
      const res = await firstValueFrom(
        this.http.get<any>(`https://api.telegram.org/bot${token}/getMe`),
      );
      if (!res.data.ok) {
        throw new BadRequestException('Invalid Telegram bot token');
      }
      return { username: res.data.result.username, id: res.data.result.id };
    } catch {
      throw new BadRequestException('Invalid Telegram bot token');
    }
  }

  private generateWhatsappVerifyToken(): string {
    return randomBytes(24).toString('hex');
  }

  private async ensureWhatsAppChannelAvailable(channelIdentifier: string, currentBotId?: string): Promise<void> {
    const existing = await this.prisma.bot.findFirst({ where: { whatsappChannelIdentifier: channelIdentifier } });
    if (existing && existing.id !== currentBotId) {
      throw new BadRequestException('This WhatsApp channel is already connected to another bot');
    }
  }

  private async validateWhatsAppConnection(connection: WhatsAppConnectionInput): Promise<void> {
    if (!connection.channelIdentifier) {
      throw new BadRequestException('WhatsApp channel identifier is required');
    }

    if (connection.phoneNumber && !isE164PhoneNumber(connection.phoneNumber ?? null)) {
      throw new BadRequestException('WhatsApp phone number must be in E.164 format');
    }

    if (connection.provider === 'META') {
      if (!['META_EMBEDDED_SIGNUP', 'META_MANUAL'].includes(connection.integrationMode)) {
        throw new BadRequestException('Meta provider must use embedded signup or manual mode');
      }
      const accessToken = typeof connection.config?.accessToken === 'string' ? connection.config.accessToken.trim() : '';
      const appSecret = typeof connection.config?.appSecret === 'string' ? connection.config.appSecret.trim() : '';
      if (!accessToken) {
        throw new BadRequestException('Meta WhatsApp access token is required');
      }
      if (!appSecret) {
        throw new BadRequestException('Meta app secret is required for secure webhook verification');
      }
      try {
        await firstValueFrom(
          this.http.get(`https://graph.facebook.com/v20.0/${connection.channelIdentifier}`, {
            params: { access_token: accessToken, fields: 'id,display_phone_number,verified_name' },
          }),
        );
      } catch {
        throw new BadRequestException('Unable to validate Meta WhatsApp connection');
      }
      return;
    }

    if (connection.provider === 'TWILIO') {
      if (connection.integrationMode !== 'TWILIO') {
        throw new BadRequestException('Twilio provider must use TWILIO integration mode');
      }
      const accountSid = typeof connection.config?.accountSid === 'string' ? connection.config.accountSid.trim() : '';
      const authToken = typeof connection.config?.authToken === 'string' ? connection.config.authToken.trim() : '';
      if (!accountSid || !authToken) {
        throw new BadRequestException('Twilio Account SID and Auth Token are required');
      }
      try {
        await firstValueFrom(
          this.http.get(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
            auth: { username: accountSid, password: authToken },
          }),
        );
      } catch {
        throw new BadRequestException('Unable to validate Twilio WhatsApp connection');
      }
      return;
    }

    throw new BadRequestException('Unsupported WhatsApp provider');
  }

  private getMetaEmbeddedRedirectUri(): string {
    const explicit = (this.config.get<string>('META_EMBEDDED_REDIRECT_URI') ?? '').trim();
    if (explicit) {
      return explicit;
    }
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${appUrl}/bots`;
  }

  async findByWidgetKey(widgetKey: string) {
    const bot = await this.prisma.bot.findUnique({
      where: { webWidgetKey: widgetKey },
      include: { organization: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');
    if (!bot.webWidgetEnabled) throw new ForbiddenException('Widget is not enabled for this bot');
    if (!bot.isActive) throw new ForbiddenException('Bot is not active');
    const allowedDomains = (bot.webWidgetAllowedDomains ?? []).map((domain) => normalizeDomain(domain)).filter(Boolean);
    if (allowedDomains.length === 0) {
      throw new ForbiddenException('Widget is not configured with allowed domains');
    }
    return bot;
  }

  async handleWidgetMessage(
    widgetKey: string,
    payload: { message: string; visitorId?: string; visitorEmail?: string },
    requestOrigin?: string,
    requestReferer?: string,
  ) {
    const bot = await this.findByWidgetKey(widgetKey);
    this.assertWidgetDomainAllowed(bot.webWidgetAllowedDomains, requestOrigin, requestReferer);
    const { message: userText, visitorId, visitorEmail } = payload;

    if (!userText || !userText.trim()) {
      throw new BadRequestException('Message cannot be empty');
    }

    const customerName = visitorEmail || visitorId || 'Anonymous';
    const visitorIdKey = visitorId ? `widget_${visitorId}` : `email_${visitorEmail}`;

    // Find or create conversation — only search if at least one identifier is provided
    const visitorConditions: Array<{ widgetVisitorId?: string; widgetVisitorEmail?: string }> = [];
    if (visitorId) visitorConditions.push({ widgetVisitorId: visitorIdKey });
    if (visitorEmail) visitorConditions.push({ widgetVisitorEmail: visitorEmail });

    const existing = visitorConditions.length === 0
      ? null
      : await this.prisma.conversation.findFirst({
          where: {
            botId: bot.id,
            organizationId: bot.organizationId,
            // Never match Telegram-only conversations (they have null widget fields)
            NOT: { widgetVisitorId: null, widgetVisitorEmail: null },
            AND: [
              { OR: visitorConditions },
              // Never reuse a RESOLVED conversation — a new inbound message always starts fresh.
              // (Previously RESOLVED+awaitingCsat was reused, which trapped messages in a dead
              // thread the AI never answered; CSAT is only ever interpreted for PENDING status.)
              { status: { not: 'RESOLVED' } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });

    let conversation: Awaited<ReturnType<typeof this.prisma.conversation.create>>;

    if (!existing) {
      // Create new conversation
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId: bot.organizationId,
          botId: bot.id,
          customerName,
          widgetVisitorId: visitorId ? visitorIdKey : null,
          widgetVisitorEmail: visitorEmail,
          channel: 'WIDGET',
          status: 'OPEN',
          mode: 'AI',
          lastMessageAt: new Date(),
        },
      });
      this.events.emitNewConversation(bot.organizationId, {
        id: conversation.id,
        customerName,
        status: 'OPEN',
        mode: 'AI',
        botId: bot.id,
        bot: { id: bot.id, name: bot.name },
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: [],
      });
    } else {
      // Update existing conversation
      conversation = await this.prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
    }

    // Customer hub: link this conversation to its unified person (fire-and-forget, off the reply path).
    if (!conversation.customerId) {
      this.customerIdentity
        .linkConversation(conversation)
        .catch((e) => this.logger.warn(`Customer link failed for conversation ${conversation.id}: ${e?.message ?? e}`));
    }

    // Store user message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: userText.trim(),
      },
    });

    this.events.emitNewMessage(bot.organizationId, {
      conversationId: conversation.id,
      message: { id: userMessage.id, role: userMessage.role, content: userMessage.content, createdAt: userMessage.createdAt },
    });

    const priorMessagesPromise = this.prisma.message.findMany({
      where: { conversationId: conversation.id, NOT: { id: userMessage.id } },
      orderBy: { createdAt: 'desc' },
      take: 40,
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
      organizationId: bot.organizationId,
      botId: bot.id,
      conversationId: conversation.id,
      messageId: userMessage.id,
      messageText: userText.trim(),
      channel: 'WIDGET',
      customerName,
      customerEmail: visitorEmail ?? null,
      actionForwardingEnabled: bot.actionForwardingEnabled === true,
    }).then((result) => {
      forwardingResult = result;
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Action forwarding detect failed (widget): ${msg}`);
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

    // CSAT collection: if conversation is awaiting satisfaction response, handle it
    const convMeta = (conversation.metadata as Record<string, unknown>) ?? {};
    if (conversation.status === 'PENDING' && convMeta.awaitingCsat === true) {
      const lastAssistantMessage = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, role: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      const aiConfig = (bot.aiConfig as Record<string, string>) ?? {};
      const rating = await this.csatClassifier.classify({
        organizationId: bot.organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        channel: 'WIDGET',
        userReply: userText.trim(),
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
          bot.organizationId,
          null,
          'CSAT System',
          ActivityAction.CSAT_RECORDED_POSITIVE,
          'conversation',
          conversation.id,
          { channel: 'WIDGET', rating: 'positive' },
        ).catch(() => null);
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'RESOLVED' });
        const thankMsg = await this.prisma.message.create({
          data: { conversationId: conversation.id, role: 'ASSISTANT', content: positiveMessage },
        });
        this.events.emitNewMessage(bot.organizationId, {
          conversationId: conversation.id,
          message: { id: thankMsg.id, role: thankMsg.role, content: thankMsg.content, createdAt: thankMsg.createdAt },
        });
        return { conversationId: conversation.id, message: thankMsg.content };
      } else if (rating === 'negative') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false, csatRating: 'negative' } },
        });
        await this.activity.log(
          bot.organizationId,
          null,
          'CSAT System',
          ActivityAction.CSAT_RECORDED_NEGATIVE,
          'conversation',
          conversation.id,
          { channel: 'WIDGET', rating: 'negative' },
        ).catch(() => null);
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'OPEN' });
        // Fall through — re-engage AI
      } else {
        // New question — reopen silently, let AI handle it
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN', metadata: { ...convMeta, awaitingCsat: false } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'OPEN' });
      }
    }
    const priorMessages = await priorMessagesPromise;
    // Build customer context from previous conversations — only on the first message,
    // so we don't waste tokens repeating it on every turn of an ongoing conversation.
    const prevWhere = conversation.widgetVisitorEmail
      ? { widgetVisitorEmail: conversation.widgetVisitorEmail }
      : conversation.widgetVisitorId
        ? { widgetVisitorId: conversation.widgetVisitorId }
        : null;
    const previousCustomerContextKey = prevWhere
      ? `widget:${conversation.widgetVisitorEmail ?? conversation.widgetVisitorId ?? 'unknown'}`
      : null;
    let previousCustomerContext: string | null = getCachedPreviousCustomerContext(conversation.metadata, previousCustomerContextKey);
    if (!previousCustomerContext && priorMessages.length === 0 && prevWhere) {
      const prevConvs = await this.prisma.conversation.findMany({
        where: {
          organizationId: bot.organizationId,
          ...prevWhere,
          NOT: { id: conversation.id },
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

    const latestConversation = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
    }) ?? conversation;
    const languageDecision = await this.languagePreference.resolveForTurn({
      userMessage: userText.trim(),
      channel: 'WIDGET',
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
      priorMessages,
      forwarding: forwardingResult,
      previousCustomerContext,
      userMessage: userText.trim(),
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
      where: { id: conversation.id },
      data: {
        metadata: mergedMetadataPatch as Prisma.InputJsonValue,
      },
    }).catch(() => null);

    // Call AI service and get response
    let aiReply = '';
    const deterministicFollowUp = buildDeterministicFollowUpMessage({
      actionType: forwardingResult.actionType,
      missingFields: forwardingResult.missingFields,
      canClaimCompleted: forwardingResult.canClaimCompleted,
      forwardingReason: forwardingResult.reason,
      blockedCapability: forwardingResult.blockedCapability,
    });

    if (deterministicFollowUp && isBlockedCapabilityReason(forwardingResult.reason)) {
      aiReply = deterministicFollowUp;

      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: aiReply,
        },
      });

      this.events.emitNewMessage(bot.organizationId, {
        conversationId: conversation.id,
        message: { id: aiMessage.id, role: aiMessage.role, content: aiMessage.content, createdAt: aiMessage.createdAt },
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      return {
        conversationId: conversation.id,
        message: aiReply,
      };
    }

    const [commerceGrounding, customerProfileBlock] = await Promise.all([
      buildCommerceGroundingContextBlock({
        prisma: this.prisma,
        organizationId: bot.organizationId,
        aiConfig: bot.aiConfig as Record<string, unknown>,
        userText: userText.trim(),
      }),
      this.customerIdentity.getAgentContextBlock(conversation).catch(() => null), // Customer hub read loop
    ]);
    const effectiveCustomerContext = [
      customerContext,
      customerProfileBlock,
      commerceGrounding,
      await this.cannedResponses.buildPromptBlock(bot.organizationId),
    ].filter(Boolean).join('\n\n') || null;

    const preflightPromptTokens = estimateTokens({ userText, history, customerContext: effectiveCustomerContext });
    const preflightCredits = estimateUsageCredits(preflightPromptTokens, 1);
    await this.billing.assertMinimumCredits(bot.organizationId, preflightCredits);
    try {
      const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
      const internalApiKey = (this.config.get<string>('INTERNAL_API_SECRET') ?? this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
      const aiConfig = (bot.aiConfig as Record<string, unknown>) ?? {};
      const botCapabilities = ((bot.capabilities as Record<string, unknown> | null) ?? {});
      const canApplySkillBehavior = isSkillEnabledForAction(forwardingResult.actionType, botCapabilities);
      const effectiveSystemPrompt = [
        buildAgentSystemPrompt(aiConfig, bot.name),
        buildCapabilityAvailabilityPrompt(botCapabilities),
        aiContext.statePrompt,
        aiContext.responseStylePrompt,
        languageDecision.promptBlock,
        canApplySkillBehavior ? buildSkillBehaviorPromptBlock(aiConfig, forwardingResult.actionType) : null,
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

      const response = await firstValueFrom(
        this.http.post<any>(
          `${aiServiceUrl}/api/v1/chat`,
          {
            conversation_id: conversation.id,
            organization_id: bot.organizationId,
            bot_id: bot.id,
            message: userText.trim(),
            history,
            bot_name: bot.name,
            org_name: bot.organization?.name,
            system_prompt: effectiveSystemPrompt,
            customer_context: effectiveCustomerContext,
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

      aiReply = response.data?.reply ?? 'I am unable to respond right now. Please try again later.';
      const shouldResolve: boolean = response.data?.should_resolve === true;
      const promptTokens = estimateTokens({ userText, history, customerContext: effectiveCustomerContext });
      const completionTokens = estimateTokens(aiReply);

      await this.billing.debitUsageCredits({
        organizationId: bot.organizationId,
        usageType: 'CUSTOMER_REPLY',
        promptTokens,
        completionTokens,
        idempotencyKey: `widget:${userMessage.id}`,
        metadata: {
          channel: 'WIDGET',
          conversationId: conversation.id,
          botId: bot.id,
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
          riskProfile: aiContext.risk,
        },
      });

      await this.aiUsage.record({
        organizationId: bot.organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        usageType: 'CUSTOMER_REPLY',
        provider: 'openrouter',
        promptTokens,
        completionTokens,
        metadata: {
          channel: 'WIDGET',
          sourceCount: Array.isArray(response.data?.sources) ? response.data.sources.length : 0,
        },
      }).catch(() => null);

      await this.aiUsage.record({
        organizationId: bot.organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        usageType: 'ESCALATION_ANALYSIS',
        provider: 'openrouter',
        promptTokens: 0,
        completionTokens: 0,
        metadata: {
          channel: 'WIDGET',
          decision: response.data?.should_escalate === true ? 'ESCALATE' : 'CONTINUE_AI',
          reason: response.data?.should_escalate === true ? 'model_signal' : 'no_signal',
          answerability: response.data?.answerability,
          confidence: response.data?.confidence,
        },
      }).catch(() => null);

      const shouldEscalate = response.data?.should_escalate === true;

      if (shouldEscalate) {
        const topic = response.data?.escalation_topic || undefined;
        const routeToRoles = Array.isArray(bot.routeToRoles) && bot.routeToRoles.length > 0
          ? bot.routeToRoles
          : ['AGENT'];
        const bestAgent = await this.orgs.findBestAgent(bot.organizationId, topic, routeToRoles);
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'ESCALATED',
            mode: 'HUMAN',
            ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
          },
        });
        this.events.emitConversationUpdate(bot.organizationId, {
          conversationId: conversation.id,
          status: 'ESCALATED',
          mode: 'HUMAN',
          ...(bestAgent ? { assignedAgentId: bestAgent.userId } : {}),
        });
        await this.teamChat.ensureKnowledgeGapThread(bot.organizationId, {
          conversationId: conversation.id,
          question: userText.trim(),
          topic,
          assignedUserId: bestAgent?.userId,
          senderId: bestAgent?.userId ?? (await this.findOrgSystemSender(bot.organizationId)),
          metadata: {
            source: 'widget_ai_uncertainty',
            answerability: response.data?.answerability,
            confidence: response.data?.confidence,
            routeToRoles,
          },
        }).catch((err) => this.logger.warn(`Knowledge gap thread failed: ${err?.message ?? err}`));
      }

      aiReply = sanitizeOperationalClaims(aiReply, {
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

      if (
        deterministicFollowUp
        && (forwardingResult.reason === 'MISSING_CONTACT_INFO' || forwardingResult.reason === 'MISSING_REQUIRED_FIELDS')
        && /logged|submitted|queued|noted|team\s+will\s+reach\s+out|owner\s+has\s+been\s+notified/i.test(aiReply)
      ) {
        aiReply = deterministicFollowUp;
      }

      aiReply = enforceReplyTrustConsistency(aiReply, forwardingResult);

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
          || /logged|submitted|queued|noted|team\s+will\s+reach\s+out|owner\s+has\s+been\s+notified|i\s+can\s+confirm|i\s+checked/i.test(aiReply)
        )
      ) {
        aiReply = truthTemplate;
      }

      const latestAssistantReply = priorMessages.find((m) => m.role === 'ASSISTANT')?.content;
      if (shouldCollapseRepeatedReply(aiReply, latestAssistantReply)) {
        const hasMissingFieldReason = forwardingResult.reason === 'MISSING_CONTACT_INFO' || forwardingResult.reason === 'MISSING_REQUIRED_FIELDS';
        if (forwardingResult.canClaimCompleted) {
          aiReply = 'I have already logged the internal request for review in this conversation. I cannot confirm downstream delivery yet.';
        } else if (hasMissingFieldReason) {
          aiReply = deterministicFollowUp
            ?? 'I understand. I can continue helping once you share the remaining required details.';
        }
      }

      // Store AI message
      const aiMessage = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: aiReply,
        },
      });

      this.events.emitNewMessage(bot.organizationId, {
        conversationId: conversation.id,
        message: { id: aiMessage.id, role: aiMessage.role, content: aiMessage.content, createdAt: aiMessage.createdAt },
      });

      // Auto-resolve: AI signalled done and no escalation is needed.
      // Keep in PENDING awaiting CSAT so the next customer reply is classified
      // on the same conversation before final RESOLVED/OPEN transition.
      if (shouldResolve && !shouldEscalate) {
        const currentMeta = ((await this.prisma.conversation.findUnique({ where: { id: conversation.id }, select: { metadata: true } }))?.metadata as Record<string, unknown> | null) ?? {};
        const { csatRating, ...metaWithoutCstatRating } = currentMeta;
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'PENDING', metadata: { ...metaWithoutCstatRating, awaitingCsat: true } },
        });
        this.events.emitConversationUpdate(bot.organizationId, { conversationId: conversation.id, status: 'PENDING' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI service error for widget message: ${msg}`);
      aiReply = 'I am unable to respond right now. Please try again later.';
    }

    return {
      conversationId: conversation.id,
      message: aiReply,
    };
  }

  private generateWidgetKey(): string {
    return `zwk_${randomBytes(18).toString('hex')}`;
  }

  private async findOrgSystemSender(organizationId: string): Promise<string> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (member?.userId) return member.userId;
    const fallback = await this.prisma.organizationMember.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return fallback?.userId ?? '';
  }

  private assertWidgetDomainAllowed(
    allowedDomains: string[] | null | undefined,
    requestOrigin?: string,
    requestReferer?: string,
  ) {
    const normalizedAllowedDomains = Array.isArray(allowedDomains)
      ? Array.from(new Set(allowedDomains.map((domain) => normalizeDomain(domain)).filter(Boolean)))
      : [];

    // Backward-compatible default: if no domains are configured for the bot, allow all.
    if (normalizedAllowedDomains.length === 0) return;

    const requestHost = extractHostFromHeader(requestOrigin) ?? extractHostFromHeader(requestReferer);
    if (!requestHost) {
      throw new ForbiddenException('Widget origin is not allowed');
    }

    const isAllowed = normalizedAllowedDomains.some((domain) => {
      return requestHost === domain || requestHost.endsWith(`.${domain}`);
    });

    if (!isAllowed) {
      throw new ForbiddenException('Widget origin is not allowed');
    }
  }
}
