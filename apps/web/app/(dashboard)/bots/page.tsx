'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Plus, Webhook, Trash2, Copy, Check, Settings, Zap, ZapOff, ExternalLink, ChevronRight, ChevronLeft, Sparkles, Globe, Mail, ChevronDown, MessageCircle, ShoppingCart, TrendingUp, Calendar, Headphones, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi, orgsApi, commerceApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { BotKnowledgeTab } from '@/components/bots/bot-knowledge-tab';

interface AiConfig {
  promptMode?: 'guided' | 'override';
  systemPrompt?: string;
  agentAlias?: string;
  guidedPreset?: string | null;
  mission?: string;
  persona?: string;
  tone?: string;
  languageStyle?: string;
  escalationPolicy?: string;
  prohibitedTopics?: string;
  extraDetails?: string;
  creativity?: number;
  verbosity?: number;
  skillIntakeConfig?: Partial<Record<'SALES' | 'BOOKING' | 'TECHNICAL', {
    version?: number;
    fields?: Array<{
      key: string;
      label?: string;
      required?: boolean;
      aliases?: string[];
    }>;
  }>>;
}

const TONE_PRESETS = [
  'Professional and concise',
  'Warm and empathetic',
  'Friendly and conversational',
  'Confident and direct',
  'Custom',
] as const;

const PERSONA_PRESETS = [
  'Helpful support specialist',
  'Technical product expert',
  'Patient onboarding guide',
  'Sales assistant',
  'Custom',
] as const;

const STYLE_PRESETS = [
  { label: 'Support', creativity: 35, verbosity: 45 },
  { label: 'Sales', creativity: 65, verbosity: 60 },
  { label: 'Technical', creativity: 25, verbosity: 70 },
] as const;

type BotSkill = 'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING';

type SkillIntakeKey = 'SALES' | 'BOOKING' | 'TECHNICAL';

interface SkillIntakeFieldConfig {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

type SkillIntakeConfigMap = Partial<Record<SkillIntakeKey, {
  version: number;
  fields: SkillIntakeFieldConfig[];
}>>;

type SkillIntakeOpenState = Record<SkillIntakeKey, boolean>;

const BOT_SKILL_OPTIONS: Array<{ skill: BotSkill; name: string; description: string; effects: string[] }> = [
  {
    skill: 'FORWARDING',
    name: 'Action Forwarding',
    description: 'Sends important customer intents to your team quickly.',
    effects: [
      'Important intents are forwarded to your owner/team channels faster.',
      'Your bot prepares cleaner handoff context for human follow-up.',
      'Keeps escalation and notification behavior active for enabled skills.',
    ],
  },
  {
    skill: 'SALES',
    name: 'Sales',
    description: 'Lead capture and order intake workflows.',
    effects: [
      'Your bot can collect buyer interest and capture lead details for follow-up.',
      'Your bot can recognize order requests and pass them to your team quickly.',
      'Your team gets clearer handoff context when sales intent appears.',
    ],
  },
  {
    skill: 'BOOKING',
    name: 'Booking',
    description: 'Meeting request and scheduling workflows.',
    effects: [
      'Your bot can detect booking requests and collect meeting details.',
      'Scheduling conversations are routed with better context to the right person.',
      'Customers get a smoother path from request to confirmed follow-up.',
    ],
  },
  {
    skill: 'SUPPORT',
    name: 'Support',
    description: 'General support handling and triage workflows.',
    effects: [
      'Your bot handles support questions with better triage and categorization.',
      'It can gather the key details your support team needs before handoff.',
      'Customers get faster first responses for common support issues.',
    ],
  },
  {
    skill: 'TECHNICAL',
    name: 'Technical',
    description: 'Technical issue intake and escalation workflows.',
    effects: [
      'Your bot can identify technical problems and collect useful diagnostics.',
      'Complex issues are prepared better before they reach technical staff.',
      'Customers get clearer guidance while waiting for deeper technical help.',
    ],
  },
];

const GUIDED_PACK_PRESETS = [
  {
    label: 'Concierge Host',
    description: 'Polished, high-trust assistant that makes customers feel personally guided.',
    mission: 'Deliver premium, attentive customer support that feels personal and proactive.',
    tone: 'Warm and empathetic',
    persona: 'Helpful support specialist',
    languageStyle: 'Use welcoming language, smooth transitions, and clear next steps.',
    escalationPolicy: 'Escalate account access, legal/compliance requests, and unresolved high-impact issues.',
    prohibitedTopics: 'Legal advice, medical advice, policy exceptions without approval',
    extraDetails: 'Acknowledge the customer context quickly, then guide them with confidence and calm.',
    creativity: 40,
    verbosity: 55,
    cardClass: 'border-emerald-500/25 bg-emerald-500/8 hover:border-emerald-400/40',
    selectedCardClass: 'border-emerald-400/50 bg-emerald-500/15',
  },
  {
    label: 'Strategic Advisor',
    description: 'Clear, confident, business-minded voice focused on outcomes and fit.',
    mission: 'Help customers choose the right plan confidently by highlighting value, fit, and clear next actions without overpromising.',
    tone: 'Confident and direct',
    persona: 'Sales assistant',
    languageStyle: 'Use decision-ready language with concise rationale and explicit trade-offs.',
    escalationPolicy: 'Escalate contract negotiation, custom pricing exceptions, enterprise security requests, and legal commitments.',
    prohibitedTopics: 'Unapproved discounts, legal commitments, competitor misinformation, guaranteed outcomes',
    extraDetails: 'Ask one high-signal discovery question before recommending when context is missing.',
    creativity: 55,
    verbosity: 50,
    cardClass: 'border-amber-500/25 bg-amber-500/8 hover:border-amber-400/40',
    selectedCardClass: 'border-amber-400/50 bg-amber-500/15',
  },
  {
    label: 'Technical Specialist',
    description: 'Methodical and precise, optimized for troubleshooting and reproducibility.',
    mission: 'Diagnose and resolve issues with reproducible steps, explicit assumptions, and low ambiguity.',
    tone: 'Professional and concise',
    persona: 'Technical product expert',
    languageStyle: 'Use precise technical wording and include concrete troubleshooting steps.',
    escalationPolicy: 'Escalate production incidents, data integrity concerns, and unresolved infrastructure issues.',
    prohibitedTopics: 'Speculative root causes, unsupported workarounds, security bypasses, irreversible actions without warning',
    extraDetails: 'Request environment/version details before advanced fixes. Prefer safest reversible steps first and state expected outcome per step.',
    creativity: 25,
    verbosity: 70,
    cardClass: 'border-cyan-500/25 bg-cyan-500/8 hover:border-cyan-400/40',
    selectedCardClass: 'border-cyan-400/50 bg-cyan-500/15',
  },
  {
    label: 'Calm Reassurer',
    description: 'Steady and empathetic style for stressed or frustrated customers.',
    mission: 'Reduce customer stress while moving each conversation toward resolution with clarity.',
    tone: 'Warm and empathetic',
    persona: 'Patient onboarding guide',
    languageStyle: 'Use short reassuring language and avoid abrupt phrasing.',
    escalationPolicy: 'Escalate urgent unresolved issues, billing disputes, and repeated failed attempts.',
    prohibitedTopics: 'Dismissive language, policy exceptions without approval, legal advice',
    extraDetails: 'Acknowledge emotions first, then present the next action clearly.',
    creativity: 35,
    verbosity: 55,
    cardClass: 'border-rose-500/25 bg-rose-500/8 hover:border-rose-400/40',
    selectedCardClass: 'border-rose-400/50 bg-rose-500/15',
  },
  {
    label: 'Concise Operator',
    description: 'Fast, lean responses for high-volume support workflows.',
    mission: 'Resolve requests quickly with minimal friction and clear action-focused responses.',
    tone: 'Professional and concise',
    persona: 'Helpful support specialist',
    languageStyle: 'Prefer short, direct sentences and compact bullet points.',
    escalationPolicy: 'Escalate unresolved operational blockers and access issues.',
    prohibitedTopics: 'Speculation, policy assumptions, unnecessary verbosity',
    extraDetails: 'Ask only for missing required details and avoid repeating already confirmed info.',
    creativity: 25,
    verbosity: 30,
    cardClass: 'border-slate-500/25 bg-slate-500/8 hover:border-slate-400/40',
    selectedCardClass: 'border-slate-400/50 bg-slate-500/15',
  },
  {
    label: 'Friendly Coach',
    description: 'Encouraging, educational voice for onboarding and feature discovery.',
    mission: 'Help customers build confidence and momentum while adopting the product effectively.',
    tone: 'Friendly and conversational',
    persona: 'Patient onboarding guide',
    languageStyle: 'Use supportive phrasing and simple teaching moments without talking down.',
    escalationPolicy: 'Escalate account blockers, billing constraints, and unresolved technical friction.',
    prohibitedTopics: 'Condescending phrasing, risky workaround advice, legal commitments',
    extraDetails: 'Teach by example in one small step at a time.',
    creativity: 55,
    verbosity: 65,
    cardClass: 'border-lime-500/25 bg-lime-500/8 hover:border-lime-400/40',
    selectedCardClass: 'border-lime-400/50 bg-lime-500/15',
  },
  {
    label: 'Brand Ambassador',
    description: 'Voice-forward, polished messaging tuned for brand consistency.',
    mission: 'Represent the brand with consistent tone while staying accurate and operationally reliable.',
    tone: 'Friendly and conversational',
    persona: 'Helpful support specialist',
    languageStyle: 'Use signature brand-friendly wording while preserving clarity and brevity.',
    escalationPolicy: 'Escalate exceptions, unresolved account concerns, and compliance-sensitive requests.',
    prohibitedTopics: 'Off-brand claims, legal promises, unsupported guarantees',
    extraDetails: 'Keep the voice memorable but never at the expense of accuracy.',
    creativity: 60,
    verbosity: 55,
    cardClass: 'border-fuchsia-500/25 bg-fuchsia-500/8 hover:border-fuchsia-400/40',
    selectedCardClass: 'border-fuchsia-400/50 bg-fuchsia-500/15',
  },
  {
    label: 'Enterprise Formal',
    description: 'Structured and formal communication for enterprise-facing teams.',
    mission: 'Provide high-clarity, low-ambiguity communication suitable for enterprise stakeholders.',
    tone: 'Professional and concise',
    persona: 'Technical product expert',
    languageStyle: 'Use formal structure, avoid slang, and present explicit assumptions.',
    escalationPolicy: 'Escalate security, legal/compliance, procurement, and SLA-impacting issues.',
    prohibitedTopics: 'Informal commitments, unsupported guarantees, policy speculation',
    extraDetails: 'Use consistent terminology and document next steps explicitly.',
    creativity: 30,
    verbosity: 60,
    cardClass: 'border-indigo-500/25 bg-indigo-500/8 hover:border-indigo-400/40',
    selectedCardClass: 'border-indigo-400/50 bg-indigo-500/15',
  },
  {
    label: 'Custom',
    description: 'Build your own personality profile from scratch.',
    mission: '',
    tone: 'Custom',
    persona: 'Custom',
    languageStyle: '',
    escalationPolicy: '',
    prohibitedTopics: '',
    extraDetails: '',
    creativity: 45,
    verbosity: 50,
    cardClass: 'border-zinc-600/30 bg-zinc-800/30 hover:border-zinc-500/50',
    selectedCardClass: 'border-zinc-400/50 bg-zinc-700/30',
    isCustom: true,
  },
] as const;

const GUIDED_STEPS = [
  { id: 1, label: 'Personality' },
  { id: 2, label: 'Preview' },
] as const;

const SKILL_INTAKE_META: Array<{ key: SkillIntakeKey; label: string; description: string }> = [
  {
    key: 'SALES',
    label: 'Sales Intake Fields',
    description: 'Collect extra lead and purchase details for sales workflows.',
  },
  {
    key: 'BOOKING',
    label: 'Booking Intake Fields',
    description: 'Collect extra scheduling details before creating a meeting request.',
  },
  {
    key: 'TECHNICAL',
    label: 'Technical Intake Fields',
    description: 'Collect diagnostic details before creating a technical issue request.',
  },
];

const SKILL_CORE_REQUIRED_FIELDS: Record<SkillIntakeKey, Array<{ key: string; label: string }>> = {
  SALES: [
    { key: 'customer_name', label: 'Customer name' },
    { key: 'customer_email', label: 'Customer email' },
    { key: 'product', label: 'Product' },
  ],
  BOOKING: [
    { key: 'customer_name', label: 'Customer name' },
    { key: 'customer_email', label: 'Customer email' },
    { key: 'preferred_datetime', label: 'Preferred date/time' },
  ],
  TECHNICAL: [
    { key: 'customer_name', label: 'Customer name' },
    { key: 'customer_email', label: 'Customer email' },
    { key: 'issue_summary', label: 'Issue summary' },
  ],
};

function asNonEmptyString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoundedNumber(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeFieldKeyInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toDisplayLabelFromKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeSkillIntakeConfig(value: unknown): SkillIntakeConfigMap {
  const result: SkillIntakeConfigMap = {};
  if (!value || typeof value !== 'object') return result;

  const source = value as Record<string, unknown>;
  for (const key of ['SALES', 'BOOKING', 'TECHNICAL'] as SkillIntakeKey[]) {
    const raw = source[key];
    if (!raw || typeof raw !== 'object') continue;
    const rawObj = raw as Record<string, unknown>;
    const fieldsRaw = Array.isArray(rawObj.fields) ? rawObj.fields : [];
    const fields: SkillIntakeFieldConfig[] = fieldsRaw
      .map((item) => {
        const field = item as Record<string, unknown>;
        const normalizedKey = normalizeFieldKeyInput(typeof field.key === 'string' ? field.key : '');
        if (!normalizedKey) return null;
        return {
          key: normalizedKey,
          label: typeof field.label === 'string' ? field.label : '',
          required: field.required === true,
          aliases: Array.isArray(field.aliases)
            ? field.aliases.filter((alias): alias is string => typeof alias === 'string').map((alias) => alias.trim()).filter(Boolean)
            : [],
        };
      })
      .filter((field): field is SkillIntakeFieldConfig => Boolean(field));

    const version = typeof rawObj.version === 'number' && Number.isFinite(rawObj.version)
      ? Math.max(1, Math.round(rawObj.version))
      : 1;

    result[key] = { version, fields };
  }

  return result;
}

function serializeSkillIntakeConfig(config: SkillIntakeConfigMap): AiConfig['skillIntakeConfig'] {
  const output: NonNullable<AiConfig['skillIntakeConfig']> = {};
  for (const key of ['SALES', 'BOOKING', 'TECHNICAL'] as SkillIntakeKey[]) {
    const entry = config[key];
    if (!entry) continue;
    const fields = entry.fields
      .map((field) => ({
        key: normalizeFieldKeyInput(field.key),
        label: field.label.trim() || undefined,
        required: field.required,
        aliases: field.aliases.map((alias) => alias.trim()).filter(Boolean),
      }))
      .filter((field) => field.key.length > 0);
    if (fields.length === 0) continue;

    output[key] = {
      version: Math.max(1, Math.round(entry.version || 1)),
      fields,
    };
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function extractSkillsFromBot(bot: BotRecord): BotSkill[] {
  if (Array.isArray(bot.skills) && bot.skills.length > 0) {
    return bot.skills.filter((value): value is BotSkill => BOT_SKILL_OPTIONS.some((item) => item.skill === value));
  }

  const capabilities = (bot.capabilities ?? {}) as Record<string, unknown>;
  const skillsObject = (capabilities.skills ?? {}) as Record<string, unknown>;
  const inferred: BotSkill[] = [];

  if (skillsObject.FORWARDING === true || bot.actionForwardingEnabled === true) inferred.push('FORWARDING');
  if (skillsObject.SALES === true || capabilities.canCreateLead === true || capabilities.canCreateOrder === true) inferred.push('SALES');
  if (skillsObject.BOOKING === true || capabilities.canCreateMeetingRequest === true) inferred.push('BOOKING');
  if (skillsObject.SUPPORT === true) inferred.push('SUPPORT');
  if (skillsObject.TECHNICAL === true || capabilities.canCreateTechnicalIssue === true) inferred.push('TECHNICAL');

  return Array.from(new Set(inferred));
}

function sortValues(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function buildSettingsSnapshot(input: {
  aiConfig?: AiConfig | null;
  routeToRoles: string[];
  webWidgetEnabled: boolean;
  webWidgetAllowedDomains: string[];
  skills: BotSkill[];
  skillIntakeConfig: SkillIntakeConfigMap;
}) {
  const aiConfig = input.aiConfig ?? {};
  return {
    agentAlias: asNonEmptyString(aiConfig.agentAlias ?? ''),
    guidedPreset: asNonEmptyString(aiConfig.guidedPreset ?? ''),
    mission: asNonEmptyString(aiConfig.mission ?? ''),
    persona: asNonEmptyString(aiConfig.persona ?? ''),
    tone: asNonEmptyString(aiConfig.tone ?? ''),
    languageStyle: asNonEmptyString(aiConfig.languageStyle ?? ''),
    escalationPolicy: asNonEmptyString(aiConfig.escalationPolicy ?? ''),
    prohibitedTopics: asNonEmptyString(aiConfig.prohibitedTopics ?? ''),
    extraDetails: asNonEmptyString(aiConfig.extraDetails ?? ''),
    creativity: toBoundedNumber(typeof aiConfig.creativity === 'number' ? aiConfig.creativity : 45),
    verbosity: toBoundedNumber(typeof aiConfig.verbosity === 'number' ? aiConfig.verbosity : 50),
    routeToRoles: sortValues(input.routeToRoles),
    webWidgetEnabled: input.webWidgetEnabled,
    webWidgetAllowedDomains: sortValues(input.webWidgetAllowedDomains.map((domain) => domain.trim()).filter(Boolean)),
    skills: sortValues(input.skills),
    skillIntakeConfig: serializeSkillIntakeConfig(input.skillIntakeConfig) ?? null,
  };
}

function buildGuidedPromptPreview(config: AiConfig, botName: string): string {
  const mission = asNonEmptyString(config.mission ?? '');
  const agentAlias = asNonEmptyString(config.agentAlias ?? '');
  const persona = asNonEmptyString(config.persona ?? '');
  const tone = asNonEmptyString(config.tone ?? '');
  const languageStyle = asNonEmptyString(config.languageStyle ?? '');
  const escalationPolicy = asNonEmptyString(config.escalationPolicy ?? '');
  const extraDetails = asNonEmptyString(config.extraDetails ?? '');
  const prohibitedTopics = splitList(config.prohibitedTopics ?? '');
  const creativity = typeof config.creativity === 'number' ? toBoundedNumber(config.creativity) : null;
  const verbosity = typeof config.verbosity === 'number' ? toBoundedNumber(config.verbosity) : null;

  const hasGuidedConfig = Boolean(
    mission ||
    agentAlias ||
    persona ||
    tone ||
    languageStyle ||
    escalationPolicy ||
    extraDetails ||
    prohibitedTopics.length ||
    creativity !== null ||
    verbosity !== null,
  );

  if (!hasGuidedConfig) return 'Guided preview will appear once you add at least one field.';

  const lines: string[] = [
    `You are ${agentAlias ?? botName}, a customer support AI assistant.`,
    'Follow these operating instructions:',
  ];

  if (agentAlias) lines.push(`- Agent name to use when introducing yourself: ${agentAlias}`);
  if (mission) lines.push(`- Mission: ${mission}`);
  if (persona) lines.push(`- Persona: ${persona}`);
  if (tone) lines.push(`- Tone: ${tone}`);
  if (languageStyle) lines.push(`- Language style: ${languageStyle}`);
  if (escalationPolicy) lines.push(`- Escalation policy: ${escalationPolicy}`);
  if (creativity !== null) {
    if (creativity <= 33) lines.push('- Creativity: low. Prioritize factual, direct responses over brainstorming.');
    else if (creativity <= 66) lines.push('- Creativity: balanced. Offer one useful alternative when relevant.');
    else lines.push('- Creativity: high. Provide creative alternatives while staying accurate and safe.');
  }
  if (verbosity !== null) {
    if (verbosity <= 33) lines.push('- Response depth: brief. Keep replies short and action-focused.');
    else if (verbosity <= 66) lines.push('- Response depth: medium. Keep explanations clear and compact.');
    else lines.push('- Response depth: detailed. Include richer context and step-by-step guidance when helpful.');
  }
  if (prohibitedTopics.length > 0) {
    lines.push(`- Do not handle these topics directly: ${prohibitedTopics.join(', ')}`);
    lines.push('- If any prohibited topic appears, ask clarifying questions only if needed and escalate to a human.');
  }
  if (extraDetails) lines.push(`- Additional instructions: ${extraDetails}`);
  lines.push('- Never fabricate facts, policies, prices, timelines, or account details.');
  lines.push('- If information is uncertain or missing, say what is unknown, ask a clarifying question when useful, and escalate when appropriate.');
  lines.push('- Keep responses concise, helpful, and context-aware.');
  return lines.join('\n');
}

function PresetDropdown({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-9 rounded-xl border px-3 text-sm transition-colors flex items-center justify-between ${
          open
            ? 'bg-zinc-900 border-blue-500/50 text-white'
            : 'bg-zinc-950 border-zinc-800 text-zinc-200 hover:border-zinc-700'
        }`}
      >
        <span className="truncate">{value}</span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          {options.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onSelect(option);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center justify-between ${
                  selected
                    ? 'bg-blue-600/15 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <span>{option}</span>
                {selected && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type BotTemplateKey = 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL' | 'ECOMMERCE';

const BOT_TEMPLATE_OPTIONS: Array<{
  key: BotTemplateKey;
  label: string;
  description: string;
  accentClass: string;
  selectedBorderClass: string;
  selectedBgClass: string;
  selectedIconBgClass: string;
  selectedTextClass: string;
  badgeClass: string;
  icon: React.ElementType;
  coreSkills: BotSkill[];
  forwardingLocked: boolean;
}> = [
  {
    key: 'GENERAL',
    label: 'General Bot',
    description: 'All-purpose chat, support, and routing. Enable skills in settings.',
    accentClass: 'blue',
    selectedBorderClass: 'border-blue-500/40',
    selectedBgClass: 'bg-blue-500/10',
    selectedIconBgClass: 'bg-blue-600/20',
    selectedTextClass: 'text-blue-300',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    icon: Bot,
    coreSkills: [],
    forwardingLocked: false,
  },
  {
    key: 'SALES',
    label: 'Sales Bot',
    description: 'Lead capture, consultations, and order intake with team alerts.',
    accentClass: 'violet',
    selectedBorderClass: 'border-violet-500/40',
    selectedBgClass: 'bg-violet-500/10',
    selectedIconBgClass: 'bg-violet-600/20',
    selectedTextClass: 'text-violet-300',
    badgeClass: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    icon: TrendingUp,
    coreSkills: ['SALES', 'FORWARDING'],
    forwardingLocked: true,
  },
  {
    key: 'BOOKING',
    label: 'Booking Bot',
    description: 'Meeting requests and scheduling with automatic forwarding.',
    accentClass: 'sky',
    selectedBorderClass: 'border-sky-500/40',
    selectedBgClass: 'bg-sky-500/10',
    selectedIconBgClass: 'bg-sky-600/20',
    selectedTextClass: 'text-sky-300',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    icon: Calendar,
    coreSkills: ['BOOKING', 'FORWARDING'],
    forwardingLocked: true,
  },
  {
    key: 'SUPPORT',
    label: 'Support Bot',
    description: 'Customer support with issue tracking and escalation.',
    accentClass: 'amber',
    selectedBorderClass: 'border-amber-500/40',
    selectedBgClass: 'bg-amber-500/10',
    selectedIconBgClass: 'bg-amber-600/20',
    selectedTextClass: 'text-amber-300',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    icon: Headphones,
    coreSkills: ['SUPPORT', 'FORWARDING'],
    forwardingLocked: true,
  },
  {
    key: 'TECHNICAL',
    label: 'Technical Support',
    description: 'Technical issue intake and incident forwarding to your team.',
    accentClass: 'orange',
    selectedBorderClass: 'border-orange-500/40',
    selectedBgClass: 'bg-orange-500/10',
    selectedIconBgClass: 'bg-orange-600/20',
    selectedTextClass: 'text-orange-300',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    icon: Wrench,
    coreSkills: ['TECHNICAL', 'FORWARDING'],
    forwardingLocked: true,
  },
  {
    key: 'ECOMMERCE',
    label: 'E-commerce Bot',
    description: 'Sells products, takes orders, sends payment links.',
    accentClass: 'emerald',
    selectedBorderClass: 'border-emerald-500/40',
    selectedBgClass: 'bg-emerald-500/10',
    selectedIconBgClass: 'bg-emerald-600/20',
    selectedTextClass: 'text-emerald-300',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    icon: ShoppingCart,
    coreSkills: ['SALES', 'FORWARDING'],
    forwardingLocked: true,
  },
];

function getCoreSkillsForTemplate(template: string | undefined): BotSkill[] {
  return BOT_TEMPLATE_OPTIONS.find((t) => t.key === template)?.coreSkills ?? [];
}

interface BotRecord {
  id: string;
  name: string;
  primaryChannel: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';
  template: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL' | 'ECOMMERCE';
  commerceStoreId?: string | null;
  commerceStore?: { id: string; name: string } | null;
  skills?: BotSkill[];
  capabilities?: Record<string, unknown>;
  actionForwardingEnabled: boolean;
  telegramToken: string | null;
  telegramUsername: string | null;
  webWidgetEnabled: boolean;
  webWidgetKey: string | null;
  webWidgetAllowedDomains: string[];
  emailEnabled: boolean;
  emailAddress: string | null;
  whatsappEnabled: boolean;
  whatsappProvider: 'META' | 'TWILIO' | null;
  whatsappIntegrationMode: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO' | null;
  whatsappChannelIdentifier: string | null;
  whatsappPhoneNumber: string | null;
  whatsappDisplayName: string | null;
  isActive: boolean;
  webhookSet: boolean;
  createdAt: string;
  aiConfig: AiConfig | null;
  routeToRoles: string[];
}

interface MetaEmbeddedSelectionOption {
  businessAccountId: string;
  businessAccountName?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

interface MetaEmbeddedSelectionResponse {
  requiresSelection: true;
  sessionId: string;
  options: MetaEmbeddedSelectionOption[];
}

interface ForwardingEndpointRecord {
  id: string;
  isActive: boolean;
}

interface ForwardingPolicyRecord {
  scope: 'ORGANIZATION' | 'BOT';
  isDefault: boolean;
  endpointId?: string | null;
}

type WidgetSnippetType = 'html' | 'react' | 'next' | 'vue' | 'prompt';

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function BotsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeOrgId } = useAuthStore();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPrimaryChannel, setCreatePrimaryChannel] = useState<'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL'>('TELEGRAM');
  const [createTelegramToken, setCreateTelegramToken] = useState('');
  const [createWidgetDomains, setCreateWidgetDomains] = useState('');
  const [createEmailLocalPart, setCreateEmailLocalPart] = useState('');
  const [createBotType, setCreateBotType] = useState<BotTemplateKey>('GENERAL');
  const [createCommerceStoreId, setCreateCommerceStoreId] = useState('');
  const [orgCommerceStores, setOrgCommerceStores] = useState<{ id: string; name: string }[]>([]);
  const [editCommerceStoreId, setEditCommerceStoreId] = useState('');
  const [commerceSaving, setCommerceSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [settingsBot, setSettingsBot] = useState<BotRecord | null>(null);
  const [editAgentAlias, setEditAgentAlias] = useState('');
  const [editMission, setEditMission] = useState('');
  const [editPersona, setEditPersona] = useState('Helpful support specialist');
  const [editPersonaCustom, setEditPersonaCustom] = useState('');
  const [editTone, setEditTone] = useState('Professional and concise');
  const [editToneCustom, setEditToneCustom] = useState('');
  const [editLanguageStyle, setEditLanguageStyle] = useState('');
  const [editEscalationPolicy, setEditEscalationPolicy] = useState('');
  const [editProhibitedTopics, setEditProhibitedTopics] = useState('');
  const [editExtraDetails, setEditExtraDetails] = useState('');
  const [editCreativity, setEditCreativity] = useState(45);
  const [editVerbosity, setEditVerbosity] = useState(50);
  const [selectedGuidedPreset, setSelectedGuidedPreset] = useState<string | null>(null);
  const [guidedStep, setGuidedStep] = useState(1);
  const [showPresetAgentNameModal, setShowPresetAgentNameModal] = useState(false);
  const [pendingGuidedPreset, setPendingGuidedPreset] = useState<(typeof GUIDED_PACK_PRESETS)[number] | null>(null);
  const [showCustomPersonalityModal, setShowCustomPersonalityModal] = useState(false);
  const [presetAgentNameDraft, setPresetAgentNameDraft] = useState('');
  const [settingsValidationError, setSettingsValidationError] = useState<string | null>(null);
  const [editRouteToRoles, setEditRouteToRoles] = useState<string[]>(['AGENT']);
  const [editSkills, setEditSkills] = useState<BotSkill[]>([]);
  const [editSkillIntakeConfig, setEditSkillIntakeConfig] = useState<SkillIntakeConfigMap>({});
  const [skillIntakeOpen, setSkillIntakeOpen] = useState<SkillIntakeOpenState>({
    SALES: false,
    BOOKING: false,
    TECHNICAL: false,
  });
  const [showSkillEnableModal, setShowSkillEnableModal] = useState(false);
  const [pendingSkillEnable, setPendingSkillEnable] = useState<(typeof BOT_SKILL_OPTIONS)[number] | null>(null);
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [editWidgetEnabled, setEditWidgetEnabled] = useState(false);
  const [editWidgetDomains, setEditWidgetDomains] = useState('');
  const [widgetSnippetType, setWidgetSnippetType] = useState<WidgetSnippetType>('html');
  const [settingsTab, setSettingsTab] = useState<'ai' | 'skills' | 'knowledge' | 'routing' | 'widget' | 'email' | 'telegram' | 'whatsapp' | 'commerce'>('ai');
  const [saving, setSaving] = useState(false);
  const [emailLocalPart, setEmailLocalPart] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [editTelegramToken, setEditTelegramToken] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [editWhatsAppProvider, setEditWhatsAppProvider] = useState<'META' | 'TWILIO'>('META');
  const [editWhatsAppMode, setEditWhatsAppMode] = useState<'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO'>('META_EMBEDDED_SIGNUP');
  const [editWhatsAppChannelIdentifier, setEditWhatsAppChannelIdentifier] = useState('');
  const [editWhatsAppPhoneNumber, setEditWhatsAppPhoneNumber] = useState('');
  const [editWhatsAppDisplayName, setEditWhatsAppDisplayName] = useState('');
  const [editWhatsAppAccessToken, setEditWhatsAppAccessToken] = useState('');
  const [editWhatsAppAppSecret, setEditWhatsAppAppSecret] = useState('');
  const [editWhatsAppBusinessAccountId, setEditWhatsAppBusinessAccountId] = useState('');
  const [editWhatsAppTwilioAccountSid, setEditWhatsAppTwilioAccountSid] = useState('');
  const [editWhatsAppTwilioAuthToken, setEditWhatsAppTwilioAuthToken] = useState('');
  const [editWhatsAppTwilioMessagingServiceSid, setEditWhatsAppTwilioMessagingServiceSid] = useState('');
  const [whatsAppSaving, setWhatsAppSaving] = useState(false);
  const [embeddedSignupCompleting, setEmbeddedSignupCompleting] = useState(false);
  const [showMetaSelectionModal, setShowMetaSelectionModal] = useState(false);
  const [metaSelectionSessionId, setMetaSelectionSessionId] = useState<string | null>(null);
  const [metaSelectionBotId, setMetaSelectionBotId] = useState<string | null>(null);
  const [metaSelectionOptions, setMetaSelectionOptions] = useState<MetaEmbeddedSelectionOption[]>([]);
  const [metaSelectionPhoneNumberId, setMetaSelectionPhoneNumberId] = useState('');
  const [metaSelectionBusinessAccountId, setMetaSelectionBusinessAccountId] = useState('');
  const [metaSelectionSaving, setMetaSelectionSaving] = useState(false);

  const hasOrgForwardingConfiguration = async (): Promise<boolean> => {
    if (!orgId) return false;
    const [endpointsRes, policiesRes] = await Promise.all([
      orgsApi.listContactEndpoints(orgId),
      orgsApi.listContactPolicies(orgId),
    ]);

    const endpoints = (endpointsRes.data ?? []) as ForwardingEndpointRecord[];
    const policies = (policiesRes.data ?? []) as ForwardingPolicyRecord[];
    const activeEndpointIds = new Set(
      endpoints.filter((endpoint) => endpoint.isActive).map((endpoint) => endpoint.id),
    );

    return policies.some(
      (policy) =>
        policy.scope === 'ORGANIZATION' &&
        policy.isDefault === true &&
        Boolean(policy.endpointId) &&
        activeEndpointIds.has(policy.endpointId as string),
    );
  };

  const redirectToForwardingSettings = (message?: string) => {
    toast.error(message || 'Configure forwarding before enabling this skill.');
    closeCreateModal();
    router.push(orgId ? `/settings/forwarding?org=${orgId}` : '/settings/forwarding');
  };

  const handleForwardingConfigRequired = (err: unknown): boolean => {
    const data = (err as { response?: { data?: { code?: string; redirectTo?: string; message?: string | string[] | { code?: string; redirectTo?: string; message?: string } } } })?.response?.data;
    const nested = data?.message && typeof data.message === 'object' && !Array.isArray(data.message)
      ? data.message
      : null;
    const code = data?.code ?? nested?.code;
    if (code !== 'FORWARDING_CONFIG_REQUIRED') return false;
    const messageRaw = nested?.message ?? data?.message;
    const message = typeof messageRaw === 'string'
      ? messageRaw
      : Array.isArray(messageRaw)
        ? (typeof messageRaw[0] === 'string' ? messageRaw[0] : '')
        : '';
    const redirectTo = data?.redirectTo ?? nested?.redirectTo;
    const defaultRedirect = orgId ? `/settings/forwarding?org=${orgId}` : '/settings/forwarding';
    toast.error(message || 'Configure forwarding before enabling this skill.');
    router.push(redirectTo || defaultRedirect);
    return true;
  };

  useEffect(() => {
    orgsApi.list().then((res) => {
      const orgs = res.data as { id: string }[];
      if (orgs.length > 0) {
        const preferred = activeOrgId
          ? (orgs.find((org) => org.id === activeOrgId) ?? orgs[0])
          : orgs[0];
        setOrgId(preferred.id);
      }
    }).catch(() => {});
  }, [activeOrgId]);

  useEffect(() => {
    if (!orgId) return;
    botsApi.list(orgId).then((res) => setBots(res.data)).catch(() => {}).finally(() => setLoading(false));
    commerceApi.listStores(orgId)
      .then((res) => {
        const stores = (res.data ?? []) as { id: string; name: string }[];
        setOrgCommerceStores(stores);
      })
      .catch(() => {});
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const botId = searchParams.get('wa_bot_id')
      ?? (typeof window !== 'undefined' ? window.localStorage.getItem('wa_embedded_signup_bot_id') : null);
    if (!code || !state || !botId || embeddedSignupCompleting) return;

    setEmbeddedSignupCompleting(true);
    botsApi.completeMetaEmbeddedSignup(orgId, botId, { code, state })
      .then(async (res) => {
        const payload = res.data as Partial<MetaEmbeddedSelectionResponse> | BotRecord;
        if ((payload as Partial<MetaEmbeddedSelectionResponse>).requiresSelection === true) {
          const selectionPayload = payload as MetaEmbeddedSelectionResponse;
          const options = Array.isArray(selectionPayload.options) ? selectionPayload.options : [];
          if (!selectionPayload.sessionId || options.length === 0) {
            toast.error('Meta signup completed but no selectable numbers were returned. Restart the flow.');
            return;
          }

          const defaultOption = options[0];
          setMetaSelectionSessionId(selectionPayload.sessionId);
          setMetaSelectionBotId(botId);
          setMetaSelectionOptions(options);
          setMetaSelectionPhoneNumberId(defaultOption.phoneNumberId);
          setMetaSelectionBusinessAccountId(defaultOption.businessAccountId);
          setShowMetaSelectionModal(true);
          toast('Choose which WhatsApp number to connect.');
          return;
        }

        const refreshed = await botsApi.list(orgId);
        setBots(refreshed.data);
        if (settingsBot?.id === botId) {
          setSettingsBot(payload as BotRecord);
        }
        toast.success('Meta embedded signup completed. WhatsApp connected.');
      })
      .catch((err: unknown) => {
        const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to complete Meta embedded signup';
        toast.error(Array.isArray(msg) ? msg[0] : msg);
      })
      .finally(() => {
        setEmbeddedSignupCompleting(false);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('wa_embedded_signup_bot_id');
        }
        router.replace('/bots');
      });
  }, [embeddedSignupCompleting, orgId, router, searchParams, settingsBot?.id]);

  const effectiveTone = useMemo(
    () => (editTone === 'Custom' ? editToneCustom.trim() : editTone),
    [editTone, editToneCustom],
  );

  const effectivePersona = useMemo(
    () => (editPersona === 'Custom' ? editPersonaCustom.trim() : editPersona),
    [editPersona, editPersonaCustom],
  );

  const guidedPromptPreview = useMemo(
    () => buildGuidedPromptPreview(
      {
        mission: editMission,
        agentAlias: editAgentAlias,
        persona: effectivePersona,
        tone: effectiveTone,
        languageStyle: editLanguageStyle,
        escalationPolicy: editEscalationPolicy,
        prohibitedTopics: editProhibitedTopics,
        extraDetails: editExtraDetails,
        creativity: editCreativity,
        verbosity: editVerbosity,
      },
      settingsBot?.name ?? 'Support Assistant',
    ),
    [
      editMission,
      editAgentAlias,
      effectivePersona,
      effectiveTone,
      editLanguageStyle,
      editEscalationPolicy,
      editProhibitedTopics,
      editExtraDetails,
      editCreativity,
      editVerbosity,
      settingsBot?.name,
    ],
  );

  const persistedSkills = useMemo(() => (settingsBot ? extractSkillsFromBot(settingsBot) : []), [settingsBot]);
  const hasUnsavedSkillChanges = useMemo(() => {
    if (!settingsBot) return false;
    const current = new Set(editSkills);
    const persisted = new Set(persistedSkills);
    if (current.size !== persisted.size) return true;
    for (const skill of current) {
      if (!persisted.has(skill)) return true;
    }
    return false;
  }, [editSkills, persistedSkills, settingsBot]);
  const persistedSettingsSnapshot = useMemo(() => {
    if (!settingsBot) return null;
    return buildSettingsSnapshot({
      aiConfig: settingsBot.aiConfig,
      routeToRoles: settingsBot.routeToRoles ?? [],
      webWidgetEnabled: Boolean(settingsBot.webWidgetEnabled),
      webWidgetAllowedDomains: settingsBot.webWidgetAllowedDomains ?? [],
      skills: extractSkillsFromBot(settingsBot),
      skillIntakeConfig: normalizeSkillIntakeConfig((settingsBot.aiConfig as AiConfig | null)?.skillIntakeConfig),
    });
  }, [settingsBot]);
  const currentSettingsSnapshot = useMemo(() => {
    if (!settingsBot) return null;
    return buildSettingsSnapshot({
      aiConfig: {
        ...(settingsBot.aiConfig ?? {}),
        agentAlias: editAgentAlias,
        guidedPreset: selectedGuidedPreset,
        mission: editMission,
        persona: effectivePersona,
        tone: effectiveTone,
        languageStyle: editLanguageStyle,
        escalationPolicy: editEscalationPolicy,
        prohibitedTopics: editProhibitedTopics,
        extraDetails: editExtraDetails,
        creativity: editCreativity,
        verbosity: editVerbosity,
      },
      routeToRoles: editRouteToRoles,
      webWidgetEnabled: editWidgetEnabled,
      webWidgetAllowedDomains: splitList(editWidgetDomains),
      skills: editSkills,
      skillIntakeConfig: editSkillIntakeConfig,
    });
  }, [
    editAgentAlias,
    editCreativity,
    editEscalationPolicy,
    editExtraDetails,
    editLanguageStyle,
    editMission,
    editProhibitedTopics,
    editRouteToRoles,
    editSkillIntakeConfig,
    editSkills,
    editVerbosity,
    editWidgetDomains,
    editWidgetEnabled,
    effectivePersona,
    effectiveTone,
    selectedGuidedPreset,
    settingsBot,
  ]);
  const hasUnsavedSettingsChanges = useMemo(() => {
    if (!persistedSettingsSnapshot || !currentSettingsSnapshot) return false;
    return JSON.stringify(persistedSettingsSnapshot) !== JSON.stringify(currentSettingsSnapshot);
  }, [currentSettingsSnapshot, persistedSettingsSnapshot]);

  const isSkillIntakeEnabled = (skill: SkillIntakeKey, skills: BotSkill[]) => {
    if (skill === 'TECHNICAL') {
      return skills.includes('TECHNICAL') || skills.includes('SUPPORT');
    }
    return skills.includes(skill);
  };

  useEffect(() => {
    setSkillIntakeOpen((prev) => ({
      SALES: isSkillIntakeEnabled('SALES', editSkills) ? prev.SALES : false,
      BOOKING: isSkillIntakeEnabled('BOOKING', editSkills) ? prev.BOOKING : false,
      TECHNICAL: isSkillIntakeEnabled('TECHNICAL', editSkills) ? prev.TECHNICAL : false,
    }));
  }, [editSkills]);

  const openCreateModal = () => {
    setCreateStep(1);
    setCreateName('');
    setCreatePrimaryChannel('TELEGRAM');
    setCreateTelegramToken('');
    setCreateWidgetDomains('');
    setCreateEmailLocalPart('');
    setCreateBotType('GENERAL');
    setCreateCommerceStoreId('');
    setShowCreate(true);
  };

  const closeCreateModal = () => {
    setShowCreate(false);
    setCreateStep(1);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setCreating(true);
    try {
      const createAllowedDomains = createWidgetDomains
        .split(/\n|,/)
        .map((domain) => domain.trim())
        .filter(Boolean);

      const templateConfig = BOT_TEMPLATE_OPTIONS.find((t) => t.key === createBotType)!;
      const isSkillBot = createBotType !== 'GENERAL';
      const payload = {
        name: createName,
        primaryChannel: createPrimaryChannel,
        template: createBotType,
        skills: isSkillBot
          ? (templateConfig.coreSkills as BotSkill[])
          : (['FORWARDING'] as BotSkill[]),
        actionForwardingEnabled: true,
        ...(createBotType === 'ECOMMERCE' && createCommerceStoreId ? { commerceStoreId: createCommerceStoreId } : {}),
        ...(createPrimaryChannel === 'TELEGRAM' ? { telegramToken: createTelegramToken } : {}),
        ...(createPrimaryChannel === 'WEB_WIDGET' ? { webWidgetAllowedDomains: createAllowedDomains } : {}),
      };
      const created = await botsApi.create(orgId, payload);
      const newBotId = (created.data as { id?: string })?.id;
      if (createPrimaryChannel === 'EMAIL' && createEmailLocalPart.trim() && newBotId) {
        try {
          await botsApi.enableEmail(orgId, newBotId, createEmailLocalPart.trim());
        } catch (emailErr: unknown) {
          try { await botsApi.delete(orgId, newBotId); } catch { /* ignore */ }
          const emailMsg = (emailErr as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Invalid email address';
          toast.error(Array.isArray(emailMsg) ? emailMsg[0] : emailMsg);
          return;
        }
      }
      const refreshed = await botsApi.list(orgId);
      setBots(refreshed.data);
      closeCreateModal();
      setCreateName('');
      setCreatePrimaryChannel('TELEGRAM');
      setCreateTelegramToken('');
      setCreateWidgetDomains('');
      setCreateEmailLocalPart('');
      setCreateBotType('GENERAL' as BotTemplateKey);
      setCreateCommerceStoreId('');
      toast.success('Bot created');
    } catch (err: unknown) {
      if (handleForwardingConfigRequired(err)) return;
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create bot';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setCreating(false);
    }
  };

  const totalCreateSteps = 3;
  const canAdvanceCreateStep =
    createStep === 1 ||
    (createStep === 2
      && createName.trim().length > 0
      && (createPrimaryChannel !== 'TELEGRAM' || createTelegramToken.trim().length > 0)
      && (createPrimaryChannel !== 'WEB_WIDGET' || createWidgetDomains.split(/\n|,/).map((d) => d.trim()).filter(Boolean).length > 0)
      && (createPrimaryChannel !== 'EMAIL' || createEmailLocalPart.trim().length > 0));

  const handleSetWebhook = async (bot: BotRecord) => {
    if (!orgId) return;
    if (!bot.telegramToken) {
      toast.error('Connect Telegram for this bot first');
      return;
    }
    try {
      await botsApi.setWebhook(orgId, bot.id);
      setBots((prev) => prev.map((b) => (b.id === bot.id ? { ...b, webhookSet: true } : b)));
      toast.success('Webhook set!');
    } catch { toast.error('Failed to set webhook'); }
  };

  const handleToggle = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      const res = await botsApi.update(orgId, bot.id, { isActive: !bot.isActive });
      setBots((prev) => prev.map((b) => (b.id === bot.id ? res.data : b)));
      // keep settings view in sync
      if (settingsBot?.id === bot.id) setSettingsBot(res.data);
    } catch { toast.error('Failed to update bot'); }
  };

  const handleDelete = async (bot: BotRecord) => {
    if (!orgId || !confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    try {
      await botsApi.delete(orgId, bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      if (settingsBot?.id === bot.id) setSettingsBot(null);
      toast.success('Bot deleted');
    } catch { toast.error('Failed to delete bot'); }
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getWidgetHost = () => {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  };

  const widgetSnippet = (key: string) => {
    const host = getWidgetHost();
    return `<script src="${host}/widget.js" data-zuti-widget-key="${key}" defer></script>`;
  };

  const widgetSnippets = (key: string, botName?: string): Record<WidgetSnippetType, string> => {
    const host = getWidgetHost();
    const htmlSnippet = widgetSnippet(key);
    const botNameAttr = botName ? ` data-zuti-bot-name="${botName}"` : '';

    return {
      html: `<script src="${host}/widget.js" data-zuti-widget-key="${key}"${botNameAttr} defer></script>`,
      react: `import { useEffect } from 'react';

export default function ZutiWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '${host}/widget.js';
    script.defer = true;
    script.setAttribute('data-zuti-widget-key', '${key}');${botNameAttr ? `\n    script.setAttribute('data-zuti-bot-name', '${botName}');` : ''}
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return null;
}`,
      next: `import Script from 'next/script';

export default function ZutiWidget() {
  return (
    <Script
      src="${host}/widget.js"
      data-zuti-widget-key="${key}"${botNameAttr}
      strategy="afterInteractive"
    />
  );
}`,
      vue: `<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';

let script: HTMLScriptElement | null = null;

onMounted(() => {
  script = document.createElement('script');
  script.src = '${host}/widget.js';
  script.defer = true;
  script.setAttribute('data-zuti-widget-key', '${key}');${botNameAttr ? `\n  script.setAttribute('data-zuti-bot-name', '${botName}');` : ''}
  document.body.appendChild(script);
});

onBeforeUnmount(() => {
  if (script) document.body.removeChild(script);
});
</script>`,
      prompt: `I need to integrate a customer support chat widget into my website. Here's the technical implementation guide:

## Widget Integration for Zuti Chat

**Widget Key:** \`${key}\`
**Bot Name:** ${botName || 'Your Support Bot'}
**Widget Host:** ${host}

### What This Does
- Adds a modern, minimalistic chat widget to your website
- Visitors can send messages that are handled by your AI bot
- The widget is powered by Zuti AI customer support platform
- Mobile-friendly with a fixed button in the bottom-right corner

### How to Integrate

Add a single line to your HTML:
\`\`\`html
<script src="${host}/widget.js" data-zuti-widget-key="${key}"${botNameAttr} defer></script>\`\`\`

**That's it!** Place this anywhere in your website's HTML (usually before the closing \`</body>\` tag).

### Framework-Specific Instructions

**React:**
\`\`\`jsx
import { useEffect } from 'react';

export default function ZutiWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '${host}/widget.js';
    script.defer = true;
    script.setAttribute('data-zuti-widget-key', '${key}');${botNameAttr ? `\n    script.setAttribute('data-zuti-bot-name', '${botName}');` : ''}
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);
  return null;
}
\`\`\`

**Next.js:**
\`\`\`jsx
import Script from 'next/script';

export default function ZutiWidget() {
  return (
    <Script
      src="${host}/widget.js"
      data-zuti-widget-key="${key}"${botNameAttr}
      strategy="afterInteractive"
    />
  );
}
\`\`\`

**Vue:**
\`\`\`vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';

let script: HTMLScriptElement | null = null;

onMounted(() => {
  script = document.createElement('script');
  script.src = '${host}/widget.js';
  script.defer = true;
  script.setAttribute('data-zuti-widget-key', '${key}');${botNameAttr ? `\n  script.setAttribute('data-zuti-bot-name', '${botName}');` : ''}
  document.body.appendChild(script);
});

onBeforeUnmount(() => {
  if (script) document.body.removeChild(script);
});
</script>
\`\`\`

### Customization
- The widget automatically appears in the bottom-right corner of your website
- It displays a minimalistic, modern design with your bot's name
- Visitors can click the leaf icon to open the chat interface
- Messages are automatically routed to your AI bot

### Troubleshooting
- **Widget not showing?** Make sure the widget key is correct and your domain is added to the allowed domains list
- **Script errors?** Check browser console (F12 > Console tab)
- **Messages not working?** Verify the bot is active in your Zuti dashboard

**Support:** If you encounter any issues, contact your Zuti account manager.`,
    };
  };

  const openSettings = async (bot: BotRecord) => {
    const sourceBot = orgId
      ? (await botsApi.get(orgId, bot.id).then((res) => res.data).catch(() => bot))
      : bot;

    setSettingsBot(sourceBot);
    const aiConfig = sourceBot.aiConfig ?? {};
    setEditAgentAlias(aiConfig.agentAlias ?? '');
    setEditMission(aiConfig.mission ?? '');
    const personaValue = aiConfig.persona ?? 'Helpful support specialist';
    const toneValue = aiConfig.tone ?? 'Professional and concise';

    if (PERSONA_PRESETS.some((option) => option === personaValue)) {
      setEditPersona(personaValue);
      setEditPersonaCustom('');
    } else {
      setEditPersona('Custom');
      setEditPersonaCustom(aiConfig.persona ?? '');
    }

    if (TONE_PRESETS.some((option) => option === toneValue)) {
      setEditTone(toneValue);
      setEditToneCustom('');
    } else {
      setEditTone('Custom');
      setEditToneCustom(aiConfig.tone ?? '');
    }

    setEditLanguageStyle(aiConfig.languageStyle ?? '');
    setEditEscalationPolicy(aiConfig.escalationPolicy ?? '');
    setEditProhibitedTopics(aiConfig.prohibitedTopics ?? '');
    setEditExtraDetails(aiConfig.extraDetails ?? '');
    setSelectedGuidedPreset(typeof aiConfig.guidedPreset === 'string' && aiConfig.guidedPreset ? aiConfig.guidedPreset : null);
    setGuidedStep(1);
    setSettingsValidationError(null);
    setEditCreativity(typeof aiConfig.creativity === 'number' ? Math.max(0, Math.min(100, Math.round(aiConfig.creativity))) : 45);
    setEditVerbosity(typeof aiConfig.verbosity === 'number' ? Math.max(0, Math.min(100, Math.round(aiConfig.verbosity))) : 50);
    setEditRouteToRoles(sourceBot.routeToRoles?.length ? sourceBot.routeToRoles : ['AGENT']);
    setEditWidgetEnabled(Boolean(sourceBot.webWidgetEnabled));
    setEditWidgetDomains((sourceBot.webWidgetAllowedDomains ?? []).join('\n'));
    setWidgetSnippetType('html');
    const sourceSkills = extractSkillsFromBot(sourceBot);
    setEditSkills(sourceSkills);
    setSkillIntakeOpen({
      SALES: false,
      BOOKING: false,
      TECHNICAL: false,
    });
    setEditSkillIntakeConfig(normalizeSkillIntakeConfig((aiConfig as AiConfig).skillIntakeConfig));
    setEmailLocalPart(sourceBot.emailAddress ? sourceBot.emailAddress.split('@')[0] : '');
    setEditTelegramToken('');
    setEditWhatsAppProvider(sourceBot.whatsappProvider ?? 'META');
    setEditWhatsAppMode(sourceBot.whatsappIntegrationMode ?? (sourceBot.whatsappProvider === 'TWILIO' ? 'TWILIO' : 'META_EMBEDDED_SIGNUP'));
    setEditWhatsAppChannelIdentifier(sourceBot.whatsappChannelIdentifier ?? '');
    setEditWhatsAppPhoneNumber(sourceBot.whatsappPhoneNumber ?? '');
    setEditWhatsAppDisplayName(sourceBot.whatsappDisplayName ?? '');
    setEditWhatsAppAccessToken('');
    setEditWhatsAppAppSecret('');
    setEditWhatsAppBusinessAccountId('');
    setEditWhatsAppTwilioAccountSid('');
    setEditWhatsAppTwilioAuthToken('');
    setEditWhatsAppTwilioMessagingServiceSid('');
    setEditCommerceStoreId(sourceBot.commerceStoreId ?? '');
    setSettingsTab('ai');
  };

  const toggleSkill = async (skill: BotSkill) => {
    if (!editSkills.includes(skill) && skill === 'FORWARDING') {
      try {
        const hasConfig = await hasOrgForwardingConfiguration();
        if (!hasConfig) {
          redirectToForwardingSettings('Set up forwarding endpoints and a default policy before enabling Action Forwarding.');
          return;
        }
      } catch {
        toast.error('Unable to verify forwarding settings right now.');
        return;
      }
    }

    setEditSkills((prev) => {
      if (prev.includes(skill)) {
        return prev.filter((value) => value !== skill);
      }
      const option = BOT_SKILL_OPTIONS.find((item) => item.skill === skill);
      if (option) {
        setPendingSkillEnable(option);
        setShowSkillEnableModal(true);
      }
      return prev;
    });
  };

  const setSkillIntakeVersion = (skill: SkillIntakeKey, value: number) => {
    setEditSkillIntakeConfig((prev) => {
      const current = prev[skill] ?? { version: 1, fields: [] };
      return {
        ...prev,
        [skill]: {
          ...current,
          version: Math.max(1, Math.round(value || 1)),
        },
      };
    });
  };

  const addSkillIntakeField = (skill: SkillIntakeKey) => {
    setEditSkillIntakeConfig((prev) => {
      const current = prev[skill] ?? { version: 1, fields: [] };
      return {
        ...prev,
        [skill]: {
          ...current,
          fields: [
            ...current.fields,
            { key: '', label: '', required: false, aliases: [] },
          ],
        },
      };
    });
  };

  const removeSkillIntakeField = (skill: SkillIntakeKey, index: number) => {
    setEditSkillIntakeConfig((prev) => {
      const current = prev[skill] ?? { version: 1, fields: [] };
      return {
        ...prev,
        [skill]: {
          ...current,
          fields: current.fields.filter((_, i) => i !== index),
        },
      };
    });
  };

  const updateSkillIntakeField = (
    skill: SkillIntakeKey,
    index: number,
    patch: Partial<SkillIntakeFieldConfig>,
  ) => {
    setEditSkillIntakeConfig((prev) => {
      const current = prev[skill] ?? { version: 1, fields: [] };
      return {
        ...prev,
        [skill]: {
          ...current,
          fields: current.fields.map((field, i) => {
            if (i !== index) return field;
            return {
              ...field,
              ...patch,
            };
          }),
        },
      };
    });
  };

  const confirmSkillEnable = () => {
    if (!pendingSkillEnable) return;
    setEditSkills((prev) => {
      if (prev.includes(pendingSkillEnable.skill)) return prev;
      const nextSkills = [...prev, pendingSkillEnable.skill];
      setSkillIntakeOpen((current) => ({
        ...current,
        SALES: isSkillIntakeEnabled('SALES', nextSkills) ? current.SALES || pendingSkillEnable.skill === 'SALES' : false,
        BOOKING: isSkillIntakeEnabled('BOOKING', nextSkills) ? current.BOOKING || pendingSkillEnable.skill === 'BOOKING' : false,
        TECHNICAL: isSkillIntakeEnabled('TECHNICAL', nextSkills)
          ? current.TECHNICAL || pendingSkillEnable.skill === 'TECHNICAL' || pendingSkillEnable.skill === 'SUPPORT'
          : false,
      }));
      return nextSkills;
    });
    setShowSkillEnableModal(false);
    setPendingSkillEnable(null);
  };

  const handleSaveSkillsOnly = async () => {
    if (!orgId || !settingsBot) return;
    setSkillsSaving(true);
    try {
      const res = await botsApi.update(orgId, settingsBot.id, {
        skills: editSkills,
        actionForwardingEnabled: editSkills.includes('FORWARDING'),
      });
      const savedBot = res.data as BotRecord;
      setBots((prev) => prev.map((bot) => (bot.id === settingsBot.id ? res.data : bot)));
      setSettingsBot(savedBot);
      setEditSkills(extractSkillsFromBot(savedBot));
      toast.success('Skills saved');
    } catch (err: unknown) {
      if (!handleForwardingConfigRequired(err)) {
        toast.error('Failed to save skill changes');
      }
    } finally {
      setSkillsSaving(false);
    }
  };

  const closeSkillEnableModal = () => {
    setShowSkillEnableModal(false);
    setPendingSkillEnable(null);
  };

  const toggleRouteRole = (role: string) => {
    setEditRouteToRoles((prev) =>
      prev.includes(role)
        ? prev.filter((r) => r !== role) // never allow empty — keep at least one
            .length === 0 ? prev : prev.filter((r) => r !== role)
        : [...prev, role],
    );
  };

  const handleSaveSettings = async () => {
    if (!orgId || !settingsBot) return;

    const validationError = validateAiConfig();
    if (validationError) {
      setSettingsValidationError(validationError);
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const allowedDomains = editWidgetDomains
        .split(/\n|,/) // allow newline or comma separated domains
        .map((d) => d.trim())
        .filter(Boolean);

      if (editWidgetEnabled && allowedDomains.length === 0) {
        toast.error('Set at least one allowed domain before enabling the web widget channel.');
        setSaving(false);
        return;
      }

      const nextAiConfig: AiConfig = {
        ...(settingsBot.aiConfig ?? {}),
        promptMode: 'guided',
        systemPrompt: undefined,
        agentAlias: editAgentAlias,
        guidedPreset: selectedGuidedPreset,
        mission: editMission,
        persona: effectivePersona,
        tone: effectiveTone,
        languageStyle: editLanguageStyle,
        escalationPolicy: editEscalationPolicy,
        prohibitedTopics: editProhibitedTopics,
        extraDetails: editExtraDetails,
        creativity: editCreativity,
        verbosity: editVerbosity,
        skillIntakeConfig: serializeSkillIntakeConfig(editSkillIntakeConfig),
      };

      const res = await botsApi.update(orgId, settingsBot.id, {
        aiConfig: nextAiConfig,
        routeToRoles: editRouteToRoles,
        webWidgetEnabled: editWidgetEnabled,
        webWidgetAllowedDomains: allowedDomains,
        skills: editSkills,
        actionForwardingEnabled: editSkills.includes('FORWARDING'),
      });
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? res.data : b)));
      setSettingsBot(res.data);
      setSettingsValidationError(null);
      toast.success('Settings saved');
    } catch (err: unknown) {
      if (!handleForwardingConfigRequired(err)) {
        toast.error('Failed to save settings');
      }
    } finally { setSaving(false); }
  };

  const handleSaveCommerce = async () => {
    if (!orgId || !settingsBot) return;
    setCommerceSaving(true);
    try {
      const res = await botsApi.update(orgId, settingsBot.id, {
        commerceStoreId: editCommerceStoreId || null,
      });
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? res.data : b)));
      setSettingsBot(res.data as BotRecord);
      toast.success('Commerce store updated');
    } catch {
      toast.error('Failed to update commerce store');
    } finally {
      setCommerceSaving(false);
    }
  };

  const handleEnableEmail = async () => {
    if (!orgId || !settingsBot || !emailLocalPart.trim()) return;
    setEmailSaving(true);
    try {
      const res = await botsApi.enableEmail(orgId, settingsBot.id, emailLocalPart.trim().toLowerCase());
      const updated = { ...settingsBot, emailEnabled: true, emailAddress: res.data.emailAddress };
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success(`Email channel enabled: ${res.data.emailAddress}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to enable email';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally { setEmailSaving(false); }
  };

  const handleDisableEmail = async () => {
    if (!orgId || !settingsBot || !confirm('Disable email channel? Emails to this address will no longer be processed.')) return;
    setEmailSaving(true);
    try {
      await botsApi.disableEmail(orgId, settingsBot.id);
      const updated = { ...settingsBot, emailEnabled: false };
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success('Email channel disabled');
    } catch { toast.error('Failed to disable email'); } finally { setEmailSaving(false); }
  };

  const handleConnectTelegram = async () => {
    if (!orgId || !settingsBot || !editTelegramToken.trim()) return;
    setTelegramSaving(true);
    try {
      const res = await botsApi.connectTelegram(orgId, settingsBot.id, editTelegramToken.trim());
      const updated = { ...settingsBot, telegramToken: res.data.telegramToken, telegramUsername: res.data.telegramUsername, webhookSet: false };
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      setEditTelegramToken('');
      toast.success(`Telegram connected: @${res.data.telegramUsername}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to connect Telegram';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally { setTelegramSaving(false); }
  };

  const handleDisconnectTelegram = async () => {
    if (!orgId || !settingsBot || !confirm('Disconnect Telegram? This bot will stop receiving Telegram messages.')) return;
    setTelegramSaving(true);
    try {
      await botsApi.disconnectTelegram(orgId, settingsBot.id);
      const updated = { ...settingsBot, telegramToken: null, telegramUsername: null, webhookSet: false };
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success('Telegram disconnected');
    } catch { toast.error('Failed to disconnect Telegram'); } finally { setTelegramSaving(false); }
  };

  const handleConnectWhatsApp = async () => {
    if (!orgId || !settingsBot || !editWhatsAppChannelIdentifier.trim()) return;
    setWhatsAppSaving(true);
    try {
      const config = editWhatsAppProvider === 'TWILIO'
        ? {
            accountSid: editWhatsAppTwilioAccountSid.trim(),
            authToken: editWhatsAppTwilioAuthToken.trim(),
            messagingServiceSid: editWhatsAppTwilioMessagingServiceSid.trim() || undefined,
          }
        : {
            accessToken: editWhatsAppAccessToken.trim(),
            appSecret: editWhatsAppAppSecret.trim(),
            businessAccountId: editWhatsAppBusinessAccountId.trim() || undefined,
          };

      const integrationMode = editWhatsAppProvider === 'TWILIO'
        ? 'TWILIO'
        : editWhatsAppMode;

      const res = await botsApi.connectWhatsApp(orgId, settingsBot.id, {
        provider: editWhatsAppProvider,
        integrationMode,
        channelIdentifier: editWhatsAppChannelIdentifier.trim(),
        phoneNumber: editWhatsAppPhoneNumber.trim() || undefined,
        displayName: editWhatsAppDisplayName.trim() || undefined,
        config,
      });

      const updated = res.data as BotRecord;
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      setEditWhatsAppAccessToken('');
      setEditWhatsAppAppSecret('');
      setEditWhatsAppTwilioAuthToken('');
      toast.success('WhatsApp connected');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to connect WhatsApp';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setWhatsAppSaving(false);
    }
  };

  const handleStartMetaEmbeddedSignup = async () => {
    if (!orgId || !settingsBot) return;
    setWhatsAppSaving(true);
    try {
      const res = await botsApi.startMetaEmbeddedSignup(orgId, settingsBot.id);
      const authUrl = (res.data?.authUrl as string | undefined) ?? '';
      if (!authUrl) {
        toast.error('Unable to start Meta embedded signup');
        setWhatsAppSaving(false);
        return;
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('wa_embedded_signup_bot_id', settingsBot.id);
      }
      window.location.href = authUrl;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to start Meta embedded signup';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
      setWhatsAppSaving(false);
    }
  };

  const handleCompleteMetaEmbeddedSelection = async () => {
    if (!orgId || !metaSelectionSessionId || !metaSelectionBotId || !metaSelectionPhoneNumberId) return;

    setMetaSelectionSaving(true);
    try {
      const res = await botsApi.completeMetaEmbeddedSelection(orgId, metaSelectionBotId, {
        sessionId: metaSelectionSessionId,
        selectedPhoneNumberId: metaSelectionPhoneNumberId,
        selectedBusinessAccountId: metaSelectionBusinessAccountId || undefined,
      });

      const updated = res.data as BotRecord;
      const refreshed = await botsApi.list(orgId);
      setBots(refreshed.data);
      if (settingsBot?.id === metaSelectionBotId) {
        setSettingsBot(updated);
      }

      setShowMetaSelectionModal(false);
      setMetaSelectionSessionId(null);
      setMetaSelectionBotId(null);
      setMetaSelectionOptions([]);
      setMetaSelectionPhoneNumberId('');
      setMetaSelectionBusinessAccountId('');
      toast.success('WhatsApp number selected and connected.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to finalize WhatsApp number selection';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setMetaSelectionSaving(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!orgId || !settingsBot || !confirm('Disconnect WhatsApp? This bot will stop receiving WhatsApp messages.')) return;
    setWhatsAppSaving(true);
    try {
      const res = await botsApi.disconnectWhatsApp(orgId, settingsBot.id);
      const updated = res.data as BotRecord;
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success('WhatsApp disconnected');
    } catch {
      toast.error('Failed to disconnect WhatsApp');
    } finally {
      setWhatsAppSaving(false);
    }
  };

  const handleSetWebhookInSettings = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      await botsApi.setWebhook(orgId, bot.id);
      const updated = { ...bot, webhookSet: true };
      setBots((prev) => prev.map((b) => (b.id === bot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success('Webhook set!');
    } catch { toast.error('Failed to set webhook'); }
  };

  const applyStylePreset = (creativity: number, verbosity: number) => {
    setEditCreativity(creativity);
    setEditVerbosity(verbosity);
    setSelectedGuidedPreset(null);
  };

  const applyGuidedPack = (preset: (typeof GUIDED_PACK_PRESETS)[number]) => {
    setEditMission(preset.mission);
    if (preset.tone === 'Custom') {
      setEditTone('Custom');
      setEditToneCustom('');
    } else {
      setEditTone(preset.tone);
      setEditToneCustom('');
    }
    if (preset.persona === 'Custom') {
      setEditPersona('Custom');
      setEditPersonaCustom('');
    } else {
      setEditPersona(preset.persona);
      setEditPersonaCustom('');
    }
    setEditLanguageStyle(preset.languageStyle);
    setEditEscalationPolicy(preset.escalationPolicy);
    setEditProhibitedTopics(preset.prohibitedTopics);
    setEditExtraDetails(preset.extraDetails);
    setEditCreativity(preset.creativity);
    setEditVerbosity(preset.verbosity);
    setSelectedGuidedPreset(preset.label);
  };

  const startGuidedPackFlow = (preset: (typeof GUIDED_PACK_PRESETS)[number]) => {
    setPendingGuidedPreset(preset);
    setPresetAgentNameDraft(editAgentAlias.trim() || `${settingsBot?.name ?? 'Support'} Assistant`);
    setShowPresetAgentNameModal(true);
  };

  const confirmGuidedPackFlow = () => {
    if (!pendingGuidedPreset) return;
    // Re-opening "Custom" on a bot that's already on a custom config must NOT overwrite the
    // (already-hydrated, possibly mid-edit) fields with the blank Custom template — that's the bug
    // where re-editing wiped everything and forced retyping from scratch. Only apply the preset's
    // canned values when actually switching TO a template (a genuine reset is the expected behavior
    // there). The agent-name prompt still runs every time, per how this is meant to work.
    const reopeningExistingCustom = pendingGuidedPreset.label === 'Custom' && selectedGuidedPreset === 'Custom';
    if (!reopeningExistingCustom) {
      applyGuidedPack(pendingGuidedPreset);
    }
    setEditAgentAlias(presetAgentNameDraft.trim());
    setGuidedStep(2);
    if (pendingGuidedPreset.label === 'Custom') {
      setShowCustomPersonalityModal(true);
    }
    setShowPresetAgentNameModal(false);
    setPendingGuidedPreset(null);
    setSettingsValidationError(null);
  };

  const closeGuidedPackFlow = () => {
    setShowPresetAgentNameModal(false);
    setPendingGuidedPreset(null);
  };

  const resetToRecommended = () => {
    applyGuidedPack(GUIDED_PACK_PRESETS[0]);
  };

  const resetGuidedForm = () => {
    setEditAgentAlias('');
    setEditMission('');
    setEditTone('Professional and concise');
    setEditToneCustom('');
    setEditPersona('Helpful support specialist');
    setEditPersonaCustom('');
    setEditLanguageStyle('');
    setEditEscalationPolicy('');
    setEditProhibitedTopics('');
    setEditExtraDetails('');
    setEditCreativity(45);
    setEditVerbosity(50);
    setSelectedGuidedPreset(null);
    setGuidedStep(1);
    setSettingsValidationError(null);
  };

  const validateAiConfig = (): string | null => {
    if (editExtraDetails.length > 2500) {
      return 'Extra Details is too long. Keep it under 2500 characters.';
    }

    if (editProhibitedTopics.length > 300) {
      return 'Prohibited Topics is too long. Keep it under 300 characters.';
    }

    const topics = splitList(editProhibitedTopics);
    if (topics.length > 12) {
      return 'Use up to 12 prohibited topics for clarity.';
    }
    if (topics.some((topic) => topic.length > 60)) {
      return 'Each prohibited topic should be 60 characters or less.';
    }
    if (topics.some((topic) => /[<>]/.test(topic))) {
      return 'Prohibited Topics contains unsupported characters.';
    }

    const broadTopic = topics.some((topic) => /^(all|everything|anything|any topic)$/i.test(topic));
    if (broadTopic) {
      return 'Prohibited topics cannot be set to broad values like "all" or "everything".';
    }

    if (topics.length > 0 && /never\s+escalate/i.test(editEscalationPolicy)) {
      return 'Escalation Policy conflicts with Prohibited Topics. Remove "never escalate" or adjust prohibited topics.';
    }

    return null;
  };

  const intakeKeyForSkillCard = (skill: BotSkill): SkillIntakeKey | null => {
    if (skill === 'SALES') return 'SALES';
    if (skill === 'BOOKING') return 'BOOKING';
    if (skill === 'TECHNICAL' && editSkills.includes('TECHNICAL')) return 'TECHNICAL';
    if (skill === 'SUPPORT' && editSkills.includes('SUPPORT') && !editSkills.includes('TECHNICAL')) return 'TECHNICAL';
    return null;
  };

  const renderSkillIntakePanel = (metaKey: SkillIntakeKey) => {
    const meta = SKILL_INTAKE_META.find((item) => item.key === metaKey);
    if (!meta) return null;
    const config = editSkillIntakeConfig[meta.key] ?? { version: 1, fields: [] };
    const isExpanded = skillIntakeOpen[meta.key];
    const coreRequired = SKILL_CORE_REQUIRED_FIELDS[meta.key];
    const customRequired = config.fields
      .filter((field) => field.required && normalizeFieldKeyInput(field.key).length > 0)
      .map((field) => ({
        key: normalizeFieldKeyInput(field.key),
        label: field.label.trim() || toDisplayLabelFromKey(normalizeFieldKeyInput(field.key)),
      }));
    const mergedRequiredMap = new Map<string, string>();
    coreRequired.forEach((field) => mergedRequiredMap.set(field.key, field.label));
    customRequired.forEach((field) => mergedRequiredMap.set(field.key, field.label));
    const mergedRequiredLabels = Array.from(mergedRequiredMap.values());
    const previewPrompt = mergedRequiredLabels.length > 0
      ? `To help with this request, please share: ${mergedRequiredLabels.join(', ')}.`
      : 'No required fields configured for this workflow.';

    return (
      <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
        <button
          type="button"
          onClick={() => setSkillIntakeOpen((prev) => ({ ...prev, [meta.key]: !prev[meta.key] }))}
          className="w-full flex items-center justify-between gap-3"
        >
          <div className="text-left">
            <p className="text-xs font-semibold text-white">{meta.label}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{meta.description}</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {isExpanded && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-zinc-500">Schema version</label>
              <input
                type="number"
                min={1}
                value={config.version}
                onChange={(e) => setSkillIntakeVersion(meta.key, Number(e.target.value))}
                className="w-20 h-8 bg-zinc-950 border border-zinc-800 rounded-lg px-2 text-xs text-zinc-200"
              />
            </div>

            <div className="space-y-2">
              {config.fields.length === 0 && (
                <p className="text-[11px] text-zinc-600">No custom fields yet.</p>
              )}

              {config.fields.map((field, index) => (
                <div key={`${meta.key}-field-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Field key</label>
                      <input
                        type="text"
                        value={field.key}
                        onChange={(e) => updateSkillIntakeField(meta.key, index, { key: normalizeFieldKeyInput(e.target.value) })}
                        placeholder="company_size"
                        className="w-full h-8 bg-zinc-950 border border-zinc-800 rounded-lg px-2 text-xs text-zinc-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Field label</label>
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => updateSkillIntakeField(meta.key, index, { label: e.target.value })}
                        placeholder="Company Size"
                        className="w-full h-8 bg-zinc-950 border border-zinc-800 rounded-lg px-2 text-xs text-zinc-200"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Aliases (comma separated)</label>
                      <input
                        type="text"
                        value={field.aliases.join(', ')}
                        onChange={(e) => updateSkillIntakeField(meta.key, index, {
                          aliases: e.target.value.split(',').map((alias) => alias.trim()).filter(Boolean),
                        })}
                        placeholder="team size, employee count"
                        className="w-full h-8 bg-zinc-950 border border-zinc-800 rounded-lg px-2 text-xs text-zinc-200"
                      />
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-[11px] text-zinc-400">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateSkillIntakeField(meta.key, index, { required: e.target.checked })}
                          className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-900 accent-blue-500"
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        onClick={() => removeSkillIntakeField(meta.key, index)}
                        className="px-2 py-1 rounded-md border border-red-500/20 bg-red-500/5 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => addSkillIntakeField(meta.key)}
                className="px-2.5 py-1.5 rounded-md border border-zinc-700 text-[11px] text-zinc-300 hover:text-white hover:border-zinc-600"
              >
                + Add field
              </button>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-1.5">
              <p className="text-[11px] text-zinc-400 font-medium">Missing-field prompt preview</p>
              <p className="text-[11px] text-zinc-500 leading-relaxed">{previewPrompt}</p>
              <p className="text-[10px] text-zinc-600">Core required fields are always enforced. Custom required fields are appended.</p>
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Settings step (full-page inline view) ─────────────────────────────────
  if (settingsBot) {
    return (
      <div className="ai-settings-page p-4 md:p-8">
        {/* Breadcrumb nav */}
        <div className="flex items-center gap-2 mb-8">
          <button
            onClick={() => setSettingsBot(null)}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Bots
          </button>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-sm text-white font-medium">{settingsBot.name}</span>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-sm text-zinc-500">
            {settingsTab === 'ai'
              ? 'Agent Behavior'
              : settingsTab === 'skills'
                ? 'Skills'
              : settingsTab === 'knowledge'
                ? 'Knowledge Packs'
                : settingsTab === 'routing'
                  ? 'Escalation Routing'
                  : settingsTab === 'commerce'
                    ? 'Commerce'
                    : settingsTab === 'email'
                      ? 'Email Channel'
                      : settingsTab === 'whatsapp'
                        ? 'WhatsApp Channel'
                      : settingsTab === 'telegram'
                        ? 'Telegram Channel'
                        : 'Website Widget'}
          </span>
        </div>

        <div className="mb-6">
          <div className="ai-settings-tabs inline-flex rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 flex-wrap gap-y-1">
            {([
              { key: 'ai', label: 'Behavior' },
              { key: 'skills', label: 'Skills' },
              { key: 'knowledge', label: 'Knowledge' },
              { key: 'routing', label: 'Routing' },
              ...(settingsBot?.template === 'ECOMMERCE' ? [{ key: 'commerce', label: 'Commerce' }] : []),
              { key: 'widget', label: 'Widget' },
              { key: 'email', label: 'Email' },
              { key: 'whatsapp', label: 'WhatsApp' },
              { key: 'telegram', label: 'Telegram' },
            ] as { key: 'ai' | 'skills' | 'knowledge' | 'routing' | 'commerce' | 'widget' | 'email' | 'whatsapp' | 'telegram'; label: string }[]).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSettingsTab(tab.key)}
                className={`ai-settings-tab-btn px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  settingsTab === tab.key
                    ? `is-active text-white ${tab.key === 'commerce' ? 'bg-emerald-600' : 'bg-blue-600'}`
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* Left: editor sections */}
          <div className="xl:col-span-2 space-y-5">
            {settingsTab === 'skills' && (
              <div className="card p-6 border border-zinc-800 space-y-4">
                {(() => {
                  const coreSkills = getCoreSkillsForTemplate(settingsBot?.template);
                  const isSkillBot = coreSkills.length > 0;
                  const tmplConfig = BOT_TEMPLATE_OPTIONS.find((t) => t.key === settingsBot?.template);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-white">Bot Skills</h2>
                          <p className="text-xs text-zinc-500 font-light">
                            {isSkillBot
                              ? `${tmplConfig?.label ?? 'Skill'} bots have their core skill and action forwarding always enabled.`
                              : 'Turn skills on or off any time. You can enable multiple skills on one bot.'}
                          </p>
                        </div>
                        {!isSkillBot && (
                          <div className="flex items-center gap-2">
                            <div className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
                              Enabled: <span className="text-white font-medium">{editSkills.length}</span>
                            </div>
                            <button
                              type="button"
                              onClick={handleSaveSkillsOnly}
                              disabled={!hasUnsavedSkillChanges || skillsSaving}
                              className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {skillsSaving ? 'Saving...' : 'Save skill changes'}
                            </button>
                          </div>
                        )}
                      </div>

                      {isSkillBot && tmplConfig && (
                        <div className={`rounded-xl border px-3 py-2.5 ${tmplConfig.selectedBorderClass} ${tmplConfig.selectedBgClass}`}>
                          <p className={`text-[11px] ${tmplConfig.selectedTextClass}`}>
                            Core skills for this bot type are locked. You can still enable additional skills to extend its capabilities.
                          </p>
                        </div>
                      )}

                      {!isSkillBot && hasUnsavedSkillChanges && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                          <p className="text-[11px] text-amber-300">You have unsaved skill changes. Click "Save skill changes" to persist.</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        {BOT_SKILL_OPTIONS
                          .filter((s) => settingsBot?.template !== 'ECOMMERCE' || s.skill === 'FORWARDING' || s.skill === 'SALES')
                          .map((skill) => {
                            const isCoreLocked = coreSkills.includes(skill.skill);
                            const intakeKey = intakeKeyForSkillCard(skill.skill);
                            const skillEnabled = isCoreLocked ? true : editSkills.includes(skill.skill);
                            return (
                              <div
                                key={skill.skill}
                                className={`rounded-xl border px-3 py-3 transition-all duration-200 ${
                                  skillEnabled
                                    ? 'border-blue-500/50 bg-blue-500/10 text-white shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
                                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm font-semibold text-white leading-none">{skill.name}</div>
                                      {isCoreLocked && tmplConfig && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tmplConfig.badgeClass}`}>Always on</span>
                                      )}
                                    </div>
                                    <div className="mt-1 text-[11px] leading-4 text-zinc-500">{skill.description}</div>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={`${skillEnabled ? 'Disable' : 'Enable'} ${skill.name} skill`}
                                    onClick={() => !isCoreLocked && toggleSkill(skill.skill)}
                                    disabled={isCoreLocked}
                                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                                      skillEnabled ? 'bg-blue-600' : 'bg-zinc-700'
                                    } ${isCoreLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                                  >
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${skillEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                  </button>
                                </div>

                                {!isCoreLocked && intakeKey && skillEnabled && renderSkillIntakePanel(intakeKey)}
                              </div>
                            );
                          })}
                      </div>
                    </>
                  );
                })()}

              </div>
            )}

            {/* System Prompt */}
            {settingsTab === 'ai' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white">Agent Behavior</h2>
                  <p className="text-xs text-zinc-500 font-light">Configure personality and response style here. Skills still control validation and workflow execution.</p>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {GUIDED_STEPS.map((step) => {
                    const active = guidedStep === step.id;
                    const complete = guidedStep > step.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setGuidedStep(step.id)}
                        className={`ai-settings-subtab-btn px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          active
                            ? 'is-active bg-blue-600 text-white'
                            : complete
                              ? 'is-complete bg-zinc-800 text-zinc-300'
                              : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        {step.id}. {step.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetToRecommended}
                    className="text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    Reset to recommended
                  </button>
                  <span className="text-zinc-700">•</span>
                  <button
                    type="button"
                    onClick={resetGuidedForm}
                    className="text-[11px] text-zinc-400 hover:text-white"
                  >
                    Reset personality config
                  </button>
                </div>
              </div>

              {guidedStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-zinc-400 font-medium mb-1.5">Choose a personality template</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {GUIDED_PACK_PRESETS.map((preset) => {
                        const selected = selectedGuidedPreset === preset.label;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => startGuidedPackFlow(preset)}
                            className={`text-left p-3 rounded-xl border transition-colors ${
                              selected
                                ? preset.selectedCardClass
                                : preset.cardClass
                            }`}
                          >
                            <p className="text-xs font-semibold text-white">{preset.label}</p>
                            <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{preset.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    After selecting a template, you will set the agent name. If you choose Custom, the full personality form opens in a modal.
                  </p>
                </div>
              )}

              {guidedStep === 2 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-zinc-300 font-medium">Runtime Prompt Preview</p>
                    <span className="text-[11px] text-zinc-600">Read-only</span>
                  </div>
                  <pre className="w-full overflow-x-auto bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-words max-h-64">
{guidedPromptPreview}
                  </pre>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setGuidedStep((s) => Math.max(1, s - 1))}
                  disabled={guidedStep === 1}
                  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setGuidedStep((s) => Math.min(2, s + 1))}
                  disabled={guidedStep === 2}
                  className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Next
                </button>
              </div>

            </div>
            )}

            {/* Routing */}
            {settingsTab === 'knowledge' && orgId && (
              <BotKnowledgeTab orgId={orgId} botId={settingsBot.id} active={settingsTab === 'knowledge'} />
            )}

            {/* Routing */}
            {settingsTab === 'routing' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Escalation Routing</h2>
                  <p className="text-xs text-zinc-500 font-light">Which roles the AI may auto-assign conversations to when escalating.</p>
                </div>
              </div>

              <div className="space-y-2">
                {([
                  { role: 'AGENT', label: 'Agents', description: 'Dedicated support staff — recommended' },
                  { role: 'ADMIN', label: 'Admins', description: 'Managers and team leads' },
                  { role: 'OWNER', label: 'Owners', description: 'Organization owners' },
                ] as { role: string; label: string; description: string }[]).map(({ role, label, description }) => {
                  const checked = editRouteToRoles.includes(role);
                  const isLast = editRouteToRoles.length === 1 && checked;
                  return (
                    <label
                      key={role}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-blue-600/8 border-blue-600/25'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                      } ${isLast ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLast}
                        onChange={() => toggleRouteRole(role)}
                        className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 accent-blue-500 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white leading-none mb-0.5">{label}</p>
                        <p className="text-[11px] text-zinc-500 font-light">{description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-600 mt-3 font-light">
                At least one role must be selected. Availability and capacity limits still apply.
              </p>
            </div>
            )}

            {/* Commerce */}
            {settingsTab === 'commerce' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-emerald-900/30 border border-emerald-800/40 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Commerce Store</h2>
                  <p className="text-xs text-zinc-500 font-light">Link a Zuti Commerce store to receive bot-captured orders and generate payment links automatically.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Connected store</label>
                  <select
                    value={editCommerceStoreId}
                    onChange={(e) => setEditCommerceStoreId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600/50 transition-colors"
                  >
                    <option value="">No store connected</option>
                    {orgCommerceStores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                  {orgCommerceStores.length === 0 && (
                    <p className="mt-1.5 text-[11px] text-zinc-600">No commerce stores found. Create one in the Commerce section first.</p>
                  )}
                </div>

                {editCommerceStoreId ? (
                  <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-3 py-2.5 text-[11px] text-emerald-600">
                    Orders captured by this bot will be created in the selected store. A Paystack payment link will be generated and sent to the customer automatically.
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-[11px] text-zinc-500">
                    Without a connected store, orders are forwarded to your team but no payment link is generated.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveCommerce}
                  disabled={commerceSaving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {commerceSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            )}

            {/* Website Widget */}
            {settingsTab === 'widget' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <Globe className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Website Widget</h2>
                  <p className="text-xs text-zinc-500 font-light">Enable website chat, set allowed domains, and copy your embed snippet.</p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">Widget channel</p>
                    <p className="text-xs text-zinc-500">{editWidgetEnabled ? 'Enabled for this bot' : 'Disabled'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditWidgetEnabled((v) => !v)}
                    title={editWidgetEnabled ? 'Disable widget' : 'Enable widget'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                      editWidgetEnabled ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      editWidgetEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>

              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Allowed domains</label>
              <textarea
                rows={4}
                value={editWidgetDomains}
                onChange={(e) => setEditWidgetDomains(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50 transition-colors font-light leading-relaxed"
                placeholder={'example.com\napp.example.com'}
              />
              <p className="text-[11px] text-zinc-600 mt-2 font-light">
                One domain per line (or comma-separated). Do not include protocol.
              </p>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs text-zinc-400 font-medium">{widgetSnippetType === 'prompt' ? 'Implementation Guide' : 'Embed Snippet'}</label>
                  {settingsBot.webWidgetKey && (
                    <button
                      type="button"
                      onClick={() => copyText(widgetSnippets(settingsBot.webWidgetKey as string, settingsBot.name)[widgetSnippetType], `snippet-${settingsBot.id}-${widgetSnippetType}`)}
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition-colors"
                    >
                      {copiedId === `snippet-${settingsBot.id}-${widgetSnippetType}` ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                      Copy
                    </button>
                  )}
                </div>
                {settingsBot.webWidgetKey && (
                  <div className="mb-2 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/70 p-1 flex-wrap gap-1">
                    {([
                      { key: 'code' as const, label: 'Code', options: [
                        { key: 'html' as const, label: 'HTML' },
                        { key: 'react' as const, label: 'React' },
                        { key: 'next' as const, label: 'Next.js' },
                        { key: 'vue' as const, label: 'Vue' },
                      ] },
                      { key: 'prompt' as const, label: 'AI Prompt', options: null },
                    ] as const).map((category) => (
                      <div key={category.key} className="flex items-center gap-1">
                        {category.options ? (
                          <>
                            {category.options.map((framework) => (
                              <button
                                key={framework.key}
                                type="button"
                                onClick={() => setWidgetSnippetType(framework.key)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                  widgetSnippetType === framework.key
                                    ? 'bg-blue-600 text-white'
                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                }`}
                              >
                                {framework.label}
                              </button>
                            ))}
                          </>
                        ) : (
                          <button
                            key={category.key}
                            type="button"
                            onClick={() => setWidgetSnippetType(category.key)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                              widgetSnippetType === category.key
                                ? 'bg-blue-600 text-white'
                                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                            }`}
                          >
                            {category.label}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <pre className={`w-full overflow-x-auto bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-300 whitespace-pre-wrap break-words max-h-96 ${widgetSnippetType === 'prompt' ? 'text-zinc-400' : ''}`}>
{settingsBot.webWidgetKey
  ? widgetSnippets(settingsBot.webWidgetKey, settingsBot.name)[widgetSnippetType]
  : 'Widget key will be generated after you save settings with Website Widget enabled.'}
                </pre>
              </div>
            </div>
            )}

            {/* Email Channel */}
            {settingsTab === 'email' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Email Channel</h2>
                  <p className="text-xs text-zinc-500 font-light">Give this bot its own email address to receive and reply to customer emails.</p>
                </div>
              </div>

              {settingsBot.emailEnabled && settingsBot.emailAddress ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-[11px] text-zinc-500 mb-1">Bot email address</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-blue-300 font-mono flex-1">{settingsBot.emailAddress}</code>
                      <button
                        type="button"
                        onClick={() => copyText(settingsBot.emailAddress!, `email-${settingsBot.id}`)}
                        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition-colors"
                      >
                        {copiedId === `email-${settingsBot.id}` ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1.5">
                    <p className="text-[11px] text-zinc-400 font-medium">How it works</p>
                    <p className="text-[11px] text-zinc-600 font-light">Customers email this address → your AI bot replies automatically. Agents can take over from the Inbox.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDisableEmail}
                    disabled={emailSaving}
                    className="w-full py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors text-xs font-medium disabled:opacity-50"
                  >
                    {emailSaving ? 'Disabling…' : 'Disable email channel'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Local part (before the @)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={emailLocalPart}
                        onChange={(e) => setEmailLocalPart(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                        placeholder="support"
                        className="flex-1 h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                      />
                      <span className="text-sm text-zinc-600 font-mono shrink-0">@….bords.app</span>
                    </div>
                    {emailLocalPart && (
                      <p className="text-[11px] text-zinc-500 mt-1.5 font-mono">{emailLocalPart}@[org-slug].bords.app</p>
                    )}
                    <p className="text-[11px] text-zinc-600 mt-1.5 font-light">Lowercase letters, numbers, dots, hyphens only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleEnableEmail}
                    disabled={!emailLocalPart.trim() || emailSaving}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                  >
                    {emailSaving ? 'Enabling…' : 'Enable email channel'}
                  </button>
                </div>
              )}
            </div>
            )}

            {settingsTab === 'whatsapp' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">WhatsApp Channel</h2>
                  <p className="text-xs text-zinc-500 font-light">Connect Meta embedded/manual setups or Twilio WhatsApp to this bot.</p>
                </div>
              </div>

              {settingsBot.whatsappEnabled && settingsBot.whatsappChannelIdentifier ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Provider</span>
                      <span className="text-sm text-blue-300 font-medium">{settingsBot.whatsappProvider ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Mode</span>
                      <span className="text-sm text-zinc-300 font-medium">{settingsBot.whatsappIntegrationMode ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-500">Identifier</span>
                      <span className="text-sm text-zinc-300 font-mono truncate max-w-[250px]">{settingsBot.whatsappChannelIdentifier}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-500">Phone number</span>
                      <span className="text-sm text-zinc-300 font-mono">{settingsBot.whatsappPhoneNumber ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-500">Display name</span>
                      <span className="text-sm text-zinc-300">{settingsBot.whatsappDisplayName ?? '—'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDisconnectWhatsApp}
                    disabled={whatsAppSaving}
                    className="w-full py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors text-xs font-medium disabled:opacity-50"
                  >
                    {whatsAppSaving ? 'Disconnecting…' : 'Disconnect WhatsApp'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Provider</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditWhatsAppProvider('META');
                          if (editWhatsAppMode === 'TWILIO') setEditWhatsAppMode('META_EMBEDDED_SIGNUP');
                        }}
                        className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          editWhatsAppProvider === 'META'
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        Meta
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditWhatsAppProvider('TWILIO');
                          setEditWhatsAppMode('TWILIO');
                        }}
                        className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          editWhatsAppProvider === 'TWILIO'
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        Twilio
                      </button>
                    </div>
                  </div>

                  {editWhatsAppProvider === 'META' && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Integration mode</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { key: 'META_EMBEDDED_SIGNUP', label: 'Embedded signup' },
                          { key: 'META_MANUAL', label: 'Manual credentials' },
                        ] as const).map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setEditWhatsAppMode(option.key)}
                            className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                              editWhatsAppMode === option.key
                                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Channel identifier</label>
                      <input
                        type="text"
                        value={editWhatsAppChannelIdentifier}
                        onChange={(e) => setEditWhatsAppChannelIdentifier(e.target.value)}
                        placeholder={editWhatsAppProvider === 'TWILIO' ? 'whatsapp:+14155238886 or MG...' : editWhatsAppMode === 'META_EMBEDDED_SIGNUP' ? 'Auto-detected after Meta login' : 'Phone Number ID'}
                        disabled={editWhatsAppProvider === 'META' && editWhatsAppMode === 'META_EMBEDDED_SIGNUP'}
                        className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Customer-facing number</label>
                      <input
                        type="text"
                        value={editWhatsAppPhoneNumber}
                        onChange={(e) => setEditWhatsAppPhoneNumber(e.target.value)}
                        placeholder="+2348000000000"
                        className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Display name</label>
                    <input
                      type="text"
                      value={editWhatsAppDisplayName}
                      onChange={(e) => setEditWhatsAppDisplayName(e.target.value)}
                      placeholder="Support"
                      className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                    />
                  </div>

                  {editWhatsAppProvider === 'META' && editWhatsAppMode === 'META_MANUAL' ? (
                    <>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Access token</label>
                        <input
                          type="password"
                          value={editWhatsAppAccessToken}
                          onChange={(e) => setEditWhatsAppAccessToken(e.target.value)}
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">App secret</label>
                        <input
                          type="password"
                          value={editWhatsAppAppSecret}
                          onChange={(e) => setEditWhatsAppAppSecret(e.target.value)}
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Business account ID</label>
                        <input
                          type="text"
                          value={editWhatsAppBusinessAccountId}
                          onChange={(e) => setEditWhatsAppBusinessAccountId(e.target.value)}
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                    </>
                  ) : editWhatsAppProvider === 'META' ? (
                    <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3">
                      <p className="text-[11px] text-blue-200 font-medium">Embedded signup mode</p>
                      <p className="text-[11px] text-blue-100/70 mt-1">You will authenticate directly with Meta and we will fetch channel credentials securely.</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Twilio Account SID</label>
                        <input
                          type="text"
                          value={editWhatsAppTwilioAccountSid}
                          onChange={(e) => setEditWhatsAppTwilioAccountSid(e.target.value)}
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Twilio Auth Token</label>
                        <input
                          type="password"
                          value={editWhatsAppTwilioAuthToken}
                          onChange={(e) => setEditWhatsAppTwilioAuthToken(e.target.value)}
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Messaging Service SID</label>
                        <input
                          type="text"
                          value={editWhatsAppTwilioMessagingServiceSid}
                          onChange={(e) => setEditWhatsAppTwilioMessagingServiceSid(e.target.value)}
                          placeholder="Optional"
                          className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                        />
                      </div>
                    </>
                  )}

                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-1.5">
                    <p className="text-[11px] text-zinc-400 font-medium">Webhook target</p>
                    <p className="text-[11px] text-zinc-600 font-light">After connection, point your provider webhook to <span className="font-mono text-zinc-500">/api/webhooks/whatsapp/{settingsBot.id}</span>.</p>
                  </div>

                  {editWhatsAppProvider === 'META' && editWhatsAppMode === 'META_EMBEDDED_SIGNUP' ? (
                    <button
                      type="button"
                      onClick={handleStartMetaEmbeddedSignup}
                      disabled={whatsAppSaving}
                      className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                    >
                      {whatsAppSaving ? 'Redirecting…' : 'Continue with Meta'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectWhatsApp}
                      disabled={!editWhatsAppChannelIdentifier.trim() || whatsAppSaving}
                      className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                    >
                      {whatsAppSaving ? 'Connecting…' : 'Connect WhatsApp'}
                    </button>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Telegram Channel */}
            {settingsTab === 'telegram' && (
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Telegram Channel</h2>
                  <p className="text-xs text-zinc-500 font-light">Connect a Telegram bot to receive and reply to messages on Telegram.</p>
                </div>
              </div>

              {settingsBot.telegramToken ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Username</span>
                      <span className="text-sm text-blue-300 font-mono">@{settingsBot.telegramUsername ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Webhook</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-lg font-medium ${
                        settingsBot.webhookSet ? 'bg-zinc-800 text-zinc-400' : 'bg-orange-500/15 text-orange-400'
                      }`}>
                        {settingsBot.webhookSet ? 'Ready' : 'Not set'}
                      </span>
                    </div>
                  </div>
                  {!settingsBot.webhookSet && (
                    <button
                      type="button"
                      onClick={() => handleSetWebhookInSettings(settingsBot)}
                      className="w-full py-2.5 rounded-xl border border-orange-500/20 bg-orange-500/8 text-orange-400 hover:bg-orange-500/12 transition-colors text-xs font-medium flex items-center justify-center gap-2"
                    >
                      <Webhook className="w-3.5 h-3.5" />
                      Set webhook
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => copyToken(settingsBot.telegramToken as string, `tg-${settingsBot.id}`)}
                    className="w-full py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-xs font-medium flex items-center justify-center gap-2"
                  >
                    {copiedId === `tg-${settingsBot.id}` ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy token
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectTelegram}
                    disabled={telegramSaving}
                    className="w-full py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors text-xs font-medium disabled:opacity-50"
                  >
                    {telegramSaving ? 'Disconnecting…' : 'Disconnect Telegram'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Bot token</label>
                    <input
                      type="text"
                      value={editTelegramToken}
                      onChange={(e) => setEditTelegramToken(e.target.value)}
                      placeholder="123456789:AAFxxxxxx…"
                      className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 font-mono"
                    />
                    <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-400 transition-colors">
                      Get token from @BotFather <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={handleConnectTelegram}
                    disabled={!editTelegramToken.trim() || telegramSaving}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                  >
                    {telegramSaving ? 'Connecting…' : 'Connect Telegram'}
                  </button>
                </div>
              )}
            </div>
            )}

            {/* Save / back */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSettingsBot(null)}
                className="px-5 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium"
              >
                ← Back to bots
              </button>
              {settingsTab !== 'knowledge' && settingsTab !== 'commerce' && (
                <button
                  onClick={handleSaveSettings}
                  disabled={saving || !hasUnsavedSettingsChanges}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {saving ? 'Saving…' : hasUnsavedSettingsChanges ? 'Save changes' : 'All changes saved'}
                </button>
              )}
            </div>
            {settingsTab !== 'knowledge' && settingsTab !== 'commerce' && hasUnsavedSettingsChanges && !settingsValidationError && (
              <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <p className="text-xs text-amber-300">You have unsaved changes. Click &quot;Save changes&quot; to persist them.</p>
              </div>
            )}
            {settingsValidationError && (
              <p className="text-xs text-amber-300 mt-2">{settingsValidationError}</p>
            )}
          </div>

          {/* Right: bot info sidebar */}
          <div className="space-y-4">
            {/* Status card */}
            <div className="card p-5 border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  settingsBot.isActive ? 'bg-blue-600/15 border border-blue-600/20' : 'bg-zinc-900 border border-zinc-800'
                }`}>
                  <Bot className={`w-5 h-5 ${settingsBot.isActive ? 'text-blue-400' : 'text-zinc-600'}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-white truncate">{settingsBot.name}</h3>
                  {settingsBot.telegramUsername && (
                    <p className="text-xs text-zinc-500 truncate">@{settingsBot.telegramUsername}</p>
                  )}
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {settingsBot.primaryChannel === 'TELEGRAM'
                      ? 'Telegram'
                      : settingsBot.primaryChannel === 'EMAIL'
                        ? 'Email'
                        : settingsBot.primaryChannel === 'WHATSAPP'
                          ? 'WhatsApp'
                          : 'Website Widget'} primary
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.isActive ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {settingsBot.telegramToken && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Webhook</span>
                    <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                      settingsBot.webhookSet ? 'bg-zinc-800 text-zinc-500' : 'bg-orange-500/15 text-orange-400'
                    }`}>
                      {settingsBot.webhookSet ? 'Ready' : 'Not set'}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Personality</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.aiConfig?.guidedPreset ? 'bg-blue-500/10 text-blue-500' : 'bg-zinc-800 text-zinc-600'
                  }`}>
                    {settingsBot.aiConfig?.guidedPreset ? settingsBot.aiConfig.guidedPreset : 'Guided'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-zinc-500 shrink-0">Routes to</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {(settingsBot.routeToRoles?.length ? settingsBot.routeToRoles : ['AGENT']).map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded-md font-medium text-[10px] bg-zinc-800 text-zinc-400">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Widget</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.webWidgetEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.webWidgetEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">WhatsApp</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.whatsappEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.whatsappEnabled ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                {settingsBot.webWidgetEnabled && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Domains</span>
                    <span className="px-2 py-0.5 rounded-lg font-medium text-[11px] bg-zinc-800 text-zinc-400">
                      {(settingsBot.webWidgetAllowedDomains ?? []).length}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Email</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.emailEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.emailEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                {settingsBot.emailEnabled && settingsBot.emailAddress && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 shrink-0">Address</span>
                    <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[160px] text-right">{settingsBot.emailAddress}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Telegram</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.telegramToken ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.telegramToken ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-800/60 space-y-1.5">
                <button
                  onClick={() => handleToggle(settingsBot)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors text-xs text-zinc-400 hover:text-white"
                >
                  <span>{settingsBot.isActive ? 'Deactivate bot' : 'Activate bot'}</span>
                  {settingsBot.isActive ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                </button>
                {settingsBot.telegramToken && !settingsBot.webhookSet && (
                  <button
                    onClick={() => handleSetWebhookInSettings(settingsBot)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 transition-colors text-xs text-orange-400"
                  >
                    <span>Set webhook</span>
                    <Webhook className="w-3.5 h-3.5" />
                  </button>
                )}
                {settingsBot.telegramToken && (
                  <button
                    onClick={() => copyToken(settingsBot.telegramToken as string, settingsBot.id)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors text-xs text-zinc-400 hover:text-white"
                  >
                    <span>Copy token</span>
                    {copiedId === settingsBot.id
                      ? <Check className="w-3.5 h-3.5 text-blue-400" />
                      : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(settingsBot)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors text-xs text-zinc-600 hover:text-red-400"
                >
                  <span>Delete bot</span>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Tips */}
            <div className="card p-4 border border-zinc-800/50 bg-zinc-950/40">
              <p className="text-[11px] font-medium text-zinc-500 mb-2.5">Tips for a good system prompt</p>
              <ul className="space-y-2">
                {[
                  "State the bot's name and purpose in the first line.",
                  'List what topics it should and should not discuss.',
                  'Specify when to escalate to a human agent.',
                  'Set the language and tone for your audience.',
                ].map((tip) => (
                  <li key={tip} className="text-[11px] text-zinc-600 font-light flex gap-1.5 leading-relaxed">
                    <span className="text-zinc-700 shrink-0 mt-px">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {showSkillEnableModal && pendingSkillEnable && (
          <Modal onClose={closeSkillEnableModal}>
            <div className="w-[92vw] max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-white">Turn on {pendingSkillEnable.name}?</h3>
              <p className="text-xs text-zinc-500 mt-1">
                This helps your bot handle more {pendingSkillEnable.name.toLowerCase()} conversations with better responses and smarter handoff.
              </p>

              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                <p className="text-xs text-zinc-400 mb-2">What changes after you turn this on</p>
                <ul className="space-y-1.5">
                  {pendingSkillEnable.effects.map((effect) => (
                    <li key={effect} className="text-[11px] text-zinc-300 leading-relaxed flex gap-1.5">
                      <span className="text-zinc-600">•</span>
                      <span>{effect}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSkillEnableModal}
                  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmSkillEnable}
                  className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500"
                >
                  Turn it on
                </button>
              </div>
            </div>
          </Modal>
        )}

        {showMetaSelectionModal && (
          <Modal
            onClose={() => {
              if (metaSelectionSaving) return;
              setShowMetaSelectionModal(false);
            }}
          >
            <div className="w-[92vw] max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-white">Choose WhatsApp Number</h3>
              <p className="text-xs text-zinc-500 mt-1">
                Meta returned multiple WhatsApp numbers. Select the exact number to connect to this bot.
              </p>

              <div className="mt-4 space-y-2">
                {metaSelectionOptions.map((option) => {
                  const selected = option.phoneNumberId === metaSelectionPhoneNumberId;
                  const label = option.displayPhoneNumber || option.verifiedName || option.phoneNumberId;
                  return (
                    <button
                      key={`${option.businessAccountId}:${option.phoneNumberId}`}
                      type="button"
                      onClick={() => {
                        setMetaSelectionPhoneNumberId(option.phoneNumberId);
                        setMetaSelectionBusinessAccountId(option.businessAccountId);
                      }}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {option.businessAccountName || option.businessAccountId}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowMetaSelectionModal(false)}
                  disabled={metaSelectionSaving}
                  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCompleteMetaEmbeddedSelection}
                  disabled={!metaSelectionPhoneNumberId || metaSelectionSaving}
                  className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {metaSelectionSaving ? 'Connecting…' : 'Connect selected number'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {showPresetAgentNameModal && pendingGuidedPreset && (
          <Modal onClose={closeGuidedPackFlow}>
            <div className="w-[92vw] max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-white">Set Agent Name</h3>
              <p className="text-xs text-zinc-500 mt-1">
                "{pendingGuidedPreset.label}" template will be applied. Choose how the agent introduces itself.
              </p>

              <div className="mt-4">
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Agent Name</label>
                <input
                  type="text"
                  value={presetAgentNameDraft}
                  onChange={(e) => setPresetAgentNameDraft(e.target.value)}
                  placeholder={`e.g. ${settingsBot.name} Assistant`}
                  className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                />
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeGuidedPackFlow}
                  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmGuidedPackFlow}
                  disabled={!presetAgentNameDraft.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Apply and continue
                </button>
              </div>
            </div>
          </Modal>
        )}

        {showCustomPersonalityModal && (
          <Modal onClose={() => setShowCustomPersonalityModal(false)}>
            <div className="w-[94vw] max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl max-h-[88vh] overflow-y-auto">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">Custom Personality Builder</h3>
                  <p className="text-xs text-zinc-500 mt-1">Define personality behavior fields directly. This only affects how the agent communicates.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomPersonalityModal(false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Mission</label>
                  <textarea
                    rows={2}
                    value={editMission}
                    onChange={(e) => setEditMission(e.target.value)}
                    placeholder="Resolve customer issues quickly while staying accurate and empathetic."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <PresetDropdown
                    label="Tone"
                    value={editTone}
                    options={TONE_PRESETS}
                    onSelect={setEditTone}
                  />
                  <PresetDropdown
                    label="Persona"
                    value={editPersona}
                    options={PERSONA_PRESETS}
                    onSelect={setEditPersona}
                  />
                </div>

                {editTone === 'Custom' && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Custom Tone</label>
                    <input
                      type="text"
                      value={editToneCustom}
                      onChange={(e) => setEditToneCustom(e.target.value)}
                      placeholder="Professional, calm, concise"
                      className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                    />
                  </div>
                )}

                {editPersona === 'Custom' && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Custom Persona</label>
                    <input
                      type="text"
                      value={editPersonaCustom}
                      onChange={(e) => setEditPersonaCustom(e.target.value)}
                      placeholder="Helpful product specialist"
                      className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Language Style</label>
                  <input
                    type="text"
                    value={editLanguageStyle}
                    onChange={(e) => setEditLanguageStyle(e.target.value)}
                    placeholder="Use plain English; avoid jargon"
                    className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Escalation Policy</label>
                  <textarea
                    rows={2}
                    value={editEscalationPolicy}
                    onChange={(e) => setEditEscalationPolicy(e.target.value)}
                    placeholder="Escalate billing disputes, account lockouts, and legal/compliance questions."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Prohibited Topics</label>
                  <input
                    type="text"
                    value={editProhibitedTopics}
                    onChange={(e) => setEditProhibitedTopics(e.target.value)}
                    placeholder="Legal advice, medical advice, refunds above $5000"
                    className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Extra Details</label>
                  <textarea
                    rows={3}
                    value={editExtraDetails}
                    onChange={(e) => setEditExtraDetails(e.target.value)}
                    placeholder="Any extra behavior notes not covered above (industry nuances, response constraints, preferred wording, etc)."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-4">
                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1.5">Recommended ranges</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STYLE_PRESETS.map((preset) => (
                        <button
                          key={`custom-style-${preset.label}`}
                          type="button"
                          onClick={() => applyStylePreset(preset.creativity, preset.verbosity)}
                          className="px-2 py-1 rounded-md text-[10px] border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                        >
                          {preset.label}: {preset.creativity}/{preset.verbosity}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-zinc-400 font-medium">Creativity</label>
                      <span className="text-xs text-amber-300 font-semibold">{editCreativity}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={editCreativity}
                      onChange={(e) => setEditCreativity(Number(e.target.value))}
                      className="w-full accent-amber-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-zinc-400 font-medium">Response Depth</label>
                      <span className="text-xs text-cyan-300 font-semibold">{editVerbosity}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={editVerbosity}
                      onChange={(e) => setEditVerbosity(Number(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomPersonalityModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
                >
                  Done
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="ai-agents-page p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">AI Agents</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Set up your AI agents across channels, then expand routing and automation in settings.</p>
        </div>
        <button onClick={openCreateModal} className="ai-agents-add-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Add AI agent
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal onClose={closeCreateModal}>
          <div className="card p-8 w-full max-w-2xl mx-4 border border-zinc-800">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-lg text-white tracking-tight">Add an AI agent</h2>
                  <p className="text-xs text-zinc-500">Set the agent shape first, then finalize the channel and launch details.</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Step {createStep} of {totalCreateSteps}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  {Array.from({ length: totalCreateSteps }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 w-8 rounded-full transition-colors ${index + 1 <= createStep ? 'bg-blue-500' : 'bg-zinc-800'}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
              {createStep === 1 && (
                <div className="space-y-5">
                  {/* Bot type selector */}
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2 font-medium">Bot type</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {BOT_TEMPLATE_OPTIONS.map((tmpl) => {
                        const selected = createBotType === tmpl.key;
                        const Icon = tmpl.icon;
                        return (
                          <button
                            key={tmpl.key}
                            type="button"
                            onClick={() => setCreateBotType(tmpl.key)}
                            className={`flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition-colors ${
                              selected
                                ? `${tmpl.selectedBorderClass} ${tmpl.selectedBgClass}`
                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                            }`}
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${selected ? tmpl.selectedIconBgClass : 'bg-zinc-800'}`}>
                              <Icon className={`w-3.5 h-3.5 ${selected ? tmpl.selectedTextClass : 'text-zinc-500'}`} />
                            </div>
                            <div>
                              <p className={`text-xs font-semibold ${selected ? tmpl.selectedTextClass : 'text-zinc-300'}`}>{tmpl.label}</p>
                              <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{tmpl.description}</p>
                            </div>
                            {tmpl.forwardingLocked && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tmpl.badgeClass}`}>Action forwarding on</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {createBotType === 'ECOMMERCE' && (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Commerce store <span className="text-zinc-600">(optional — can connect later)</span></label>
                      <select
                        value={createCommerceStoreId}
                        onChange={(e) => setCreateCommerceStoreId(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600/50 transition-colors"
                      >
                        <option value="">No store selected</option>
                        {orgCommerceStores.map((store) => (
                          <option key={store.id} value={store.id}>{store.name}</option>
                        ))}
                      </select>
                      {orgCommerceStores.length === 0 && (
                        <p className="mt-1.5 text-[11px] text-zinc-600">No commerce stores found. Create one in the Commerce section first.</p>
                      )}
                    </div>
                  )}

                  {(() => {
                    const tmpl = BOT_TEMPLATE_OPTIONS.find((t) => t.key === createBotType)!;
                    return (
                      <div className={`rounded-xl border px-3 py-2.5 text-[11px] ${tmpl.selectedBorderClass} ${tmpl.selectedBgClass} ${tmpl.selectedTextClass}`}>
                        Action forwarding is always enabled — actionable customer intents will be forwarded to your team automatically.
                      </div>
                    );
                  })()}
                </div>
              )}

              {createStep === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Primary channel</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setCreatePrimaryChannel('TELEGRAM')}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          createPrimaryChannel === 'TELEGRAM'
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <Bot className="w-4 h-4" /> Telegram
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreatePrimaryChannel('WEB_WIDGET')}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          createPrimaryChannel === 'WEB_WIDGET'
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <Globe className="w-4 h-4" /> Widget
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreatePrimaryChannel('EMAIL')}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          createPrimaryChannel === 'EMAIL'
                            ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <Mail className="w-4 h-4" /> Email
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Bot name</label>
                    <input
                      type="text"
                      required
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors"
                      placeholder="Support Bot"
                    />
                  </div>

                  {createPrimaryChannel === 'TELEGRAM' ? (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Telegram bot token</label>
                      <input
                        type="text"
                        required
                        value={createTelegramToken}
                        onChange={(e) => setCreateTelegramToken(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors"
                        placeholder="123456789:AAFxxxxxx…"
                      />
                      <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-400 transition-colors">
                        Get token from @BotFather <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  ) : createPrimaryChannel === 'WEB_WIDGET' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Allowed domains</label>
                        <textarea
                          required
                          value={createWidgetDomains}
                          onChange={(e) => setCreateWidgetDomains(e.target.value)}
                          rows={3}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors"
                          placeholder={'example.com\napp.example.com'}
                        />
                        <p className="mt-1.5 text-[11px] text-zinc-500">Add one domain per line (or comma-separated). The widget will be blocked on unlisted domains.</p>
                      </div>
                    </div>
                  ) : createPrimaryChannel === 'EMAIL' ? (
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Email address</label>
                      <div className="flex items-center gap-0">
                        <input
                          type="text"
                          required
                          value={createEmailLocalPart}
                          onChange={(e) => setCreateEmailLocalPart(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32))}
                          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-l-xl px-4 py-3 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors"
                          placeholder="support"
                        />
                        <span className="bg-zinc-800 border border-l-0 border-zinc-700 rounded-r-xl px-3 py-3 text-sm text-zinc-500 font-mono whitespace-nowrap">@….bords.app</span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-500">Customers can email this address and messages will appear as conversations.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-500">
                      Bot will be created with no channels active. Go to Settings later to configure a channel.
                    </div>
                  )}
                </div>
              )}

              {createStep === 3 && (
                <div className="space-y-4">
                  {(() => {
                    const tmpl = BOT_TEMPLATE_OPTIONS.find((t) => t.key === createBotType)!;
                    return (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-zinc-500 uppercase tracking-[0.2em]">Bot type</p>
                            <p className="text-sm text-white font-medium mt-1">{tmpl.label}</p>
                            <p className="text-xs text-zinc-500 mt-1">{tmpl.description}</p>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium border ${tmpl.badgeClass}`}>
                            Forwarding always on
                          </span>
                        </div>
                        <div className="grid gap-2 text-sm text-zinc-300">
                          <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2">
                            <span className="text-zinc-500">Bot name</span>
                            <span className="text-white font-medium">{createName.trim() || 'Untitled bot'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2">
                            <span className="text-zinc-500">Primary channel</span>
                            <span className="text-white font-medium">{createPrimaryChannel.replace('_', ' ')}</span>
                          </div>
                          {createBotType === 'ECOMMERCE' && createCommerceStoreId && (
                            <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2">
                              <span className="text-zinc-500">Commerce store</span>
                              <span className="text-white font-medium">{orgCommerceStores.find((s) => s.id === createCommerceStoreId)?.name ?? createCommerceStoreId}</span>
                            </div>
                          )}
                          {createPrimaryChannel === 'WEB_WIDGET' && (
                            <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2">
                              <span className="text-zinc-500">Allowed domains</span>
                              <span className="text-white font-medium">{createWidgetDomains.split(/\n|,/).map((d) => d.trim()).filter(Boolean).length}</span>
                            </div>
                          )}
                          {createPrimaryChannel === 'EMAIL' && createEmailLocalPart.trim() && (
                            <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-3 py-2">
                              <span className="text-zinc-500">Email address</span>
                              <span className="text-white font-medium font-mono">{createEmailLocalPart.trim()}@….bords.app</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs text-zinc-500">
                    Review the summary and create the bot. You can adjust skills, channel, and forwarding settings later.
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeCreateModal} className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium">
                  Cancel
                </button>
                {createStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setCreateStep((value) => value - 1)}
                    className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium inline-flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back
                  </button>
                ) : null}
                {createStep < totalCreateSteps ? (
                  <button
                    type="button"
                    disabled={!canAdvanceCreateStep}
                    onClick={() => setCreateStep((value) => Math.min(totalCreateSteps, value + 1))}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button type="submit" disabled={creating} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2">
                    {creating ? 'Creating…' : 'Create bot'} <Sparkles className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Bot list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 rounded-2xl">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse shrink-0" />

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-36 rounded bg-zinc-900 animate-pulse" />
                    <div className="h-4 w-20 rounded bg-zinc-900 animate-pulse" />
                    <div className="h-4 w-24 rounded bg-zinc-900 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-16 rounded bg-zinc-900 animate-pulse" />
                    <div className="h-4 w-28 rounded bg-zinc-900 animate-pulse" />
                    <div className="h-4 w-24 rounded bg-zinc-900 animate-pulse" />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-8 w-24 rounded-lg bg-zinc-900 animate-pulse" />
                  <div className="h-8 w-8 rounded-lg bg-zinc-900 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : bots.length === 0 ? (
        <div className="card p-16 flex flex-col items-center text-center border border-dashed border-zinc-800">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 flex items-center justify-center mb-4">
            <Bot className="w-7 h-7 text-zinc-700" />
          </div>
          <h3 className="font-semibold text-lg text-white mb-2">No bots yet</h3>
          <p className="text-sm text-zinc-600 font-light mb-6 max-w-xs">
            Add your first bot and choose Telegram or Website Widget as its first channel.
          </p>
          <button onClick={openCreateModal} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add your first bot
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map((bot) => (
            <div key={bot.id} className="card p-5 hover:border-zinc-700 transition-colors group">
              <div className="flex items-center gap-4">
                {/* Icon */}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  bot.isActive ? 'bg-blue-600/15 border border-blue-600/20' : 'bg-zinc-900 border border-zinc-800'
                }`}>
                  <Bot className={`w-5 h-5 ${bot.isActive ? 'text-blue-400' : 'text-zinc-600'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-medium text-white">{bot.name}</h3>
                    {bot.telegramUsername && (
                      <span className="text-xs text-zinc-600">@{bot.telegramUsername}</span>
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-zinc-800 text-zinc-400">
                      {bot.primaryChannel === 'TELEGRAM' ? 'Telegram'
                        : bot.primaryChannel === 'WEB_WIDGET' ? 'Widget'
                        : bot.primaryChannel === 'EMAIL' ? 'Email'
                        : bot.primaryChannel === 'WHATSAPP' ? 'WhatsApp'
                        : bot.primaryChannel}
                    </span>
                    {(() => {
                      const tmpl = BOT_TEMPLATE_OPTIONS.find((t) => t.key === (bot.template as BotTemplateKey));
                      if (!tmpl || tmpl.key === 'GENERAL') return null;
                      return (
                        <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium border ${tmpl.badgeClass}`}>
                          {tmpl.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium ${
                      bot.isActive ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {bot.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {bot.telegramToken && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium ${
                        bot.webhookSet ? 'bg-zinc-800 text-zinc-500' : 'bg-orange-500/15 text-orange-400'
                      }`}>
                        {bot.webhookSet ? 'Webhook ready' : '⚠ No webhook'}
                      </span>
                    )}
                    {bot.webWidgetEnabled && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-zinc-800 text-zinc-500">
                        Widget enabled
                      </span>
                    )}
                    {bot.emailEnabled && bot.emailAddress && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-teal-500/15 text-teal-400 border border-teal-500/20">
                        {bot.emailAddress}
                      </span>
                    )}
                    {bot.emailEnabled && !bot.emailAddress && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-teal-500/15 text-teal-400 border border-teal-500/20">
                        Email
                      </span>
                    )}
                    {bot.whatsappEnabled && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-zinc-800 text-zinc-500">
                        WhatsApp enabled
                      </span>
                    )}
                    {bot.aiConfig?.systemPrompt && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-blue-500/10 text-blue-500">
                        Custom prompt
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                  {bot.telegramToken && !bot.webhookSet && (
                    <button onClick={() => handleSetWebhook(bot)} title="Set webhook" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 text-xs font-medium transition-colors border border-orange-500/20">
                      <Webhook className="w-3.5 h-3.5" /> Set webhook
                    </button>
                  )}
                  <button onClick={() => openSettings(bot)} title="AI settings" className="p-2 rounded-lg text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Settings className="w-4 h-4" />
                  </button>
                  {bot.telegramToken && (
                    <button onClick={() => copyToken(bot.telegramToken as string, bot.id)} title="Copy token" className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                      {copiedId === bot.id ? <Check className="w-4 h-4 text-blue-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => handleToggle(bot)}
                    title={bot.isActive ? 'Deactivate bot' : 'Activate bot'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                      bot.isActive ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      bot.isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <button onClick={() => handleDelete(bot)} title="Delete" className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Webhook CTA banner */}
              {bot.telegramToken && !bot.webhookSet && (
                <div className="mt-4 flex items-center justify-between px-4 py-3 rounded-xl bg-orange-500/8 border border-orange-500/15">
                  <div className="flex items-center gap-2">
                    <Webhook className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-400/80 font-light">
                      Webhook not set — this bot won't receive Telegram messages until it's configured.
                    </p>
                  </div>
                  <button onClick={() => handleSetWebhook(bot)} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 font-medium shrink-0 ml-3 transition-colors">
                    Fix now <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function BotsPageFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
    </div>
  );
}

export default function BotsPage() {
  return (
    <Suspense fallback={<BotsPageFallback />}>
      <BotsPageContent />
    </Suspense>
  );
}
