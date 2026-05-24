type RawConfig = Record<string, unknown> | null | undefined;
type SkillOverrideKey = 'SALES' | 'BOOKING' | 'TECHNICAL' | 'FORWARDING';

const DEFAULT_SKILL_BEHAVIOR_BLOCKS: Record<SkillOverrideKey, string> = {
  SALES: [
    'Use a consultative, momentum-preserving sales tone: confident, clear, and never pushy.',
    'Prioritize qualification clarity: ask one focused discovery question when key purchase context is missing.',
    'Summarize value in plain language and keep a concrete next step visible in each reply.',
    'Never overpromise outcomes, discounts, delivery timelines, or policy exceptions.',
    'When collecting order fields, ask only for still-missing required details and avoid repeating confirmed details.',
  ].join(' '),
  BOOKING: [
    'Use a precise, scheduling-focused tone: helpful, calm, and operationally clear.',
    'Drive toward complete booking intake by confirming date/time context (including timezone when relevant) and meeting purpose.',
    'Prefer short option-style prompts over open-ended questions when collecting missing booking details.',
    'Do not imply the meeting is confirmed until backend confirmation exists; frame progress as request preparation/review.',
    'Keep booking follow-ups structured so operations can act quickly with minimal rework.',
  ].join(' '),
  TECHNICAL: [
    'Use a methodical technical-support tone: calm, diagnostic, and explicit about uncertainty.',
    'Prioritize reproducibility and triage quality by collecting concise issue summary first, then key environment/context details.',
    'Offer safe, reversible guidance first; avoid speculative root-cause claims presented as facts.',
    'When required technical fields are missing, ask only for those gaps and keep requests concrete and testable.',
    'Acknowledge impact empathetically while keeping language precise for downstream technical handoff.',
  ].join(' '),
  FORWARDING: [
    'Use a reassurance-and-handoff tone: concise, transparent, and ownership-oriented.',
    'Acknowledge the request clearly, confirm what has been captured, and explain the next human follow-up step.',
    'If required contact details are missing, request only those fields before promising escalation or outreach.',
    'Do not claim owner/team contact, escalation completion, or delivery unless system confirmation exists.',
    'Keep handoff wording customer-friendly while preserving accurate operational expectations.',
  ].join(' '),
};

function mapActionTypeToSkillKey(actionType: unknown): SkillOverrideKey | null {
  if (typeof actionType !== 'string') return null;
  switch (actionType) {
    case 'SALES_ORDER_REQUEST':
      return 'SALES';
    case 'MEETING_REQUEST':
      return 'BOOKING';
    case 'TECHNICAL_ISSUE':
      return 'TECHNICAL';
    case 'OWNER_ATTENTION_NEEDED':
      return 'FORWARDING';
    default:
      return null;
  }
}

function skillLabel(key: SkillOverrideKey): string {
  switch (key) {
    case 'SALES':
      return 'Sales';
    case 'BOOKING':
      return 'Booking';
    case 'TECHNICAL':
      return 'Technical';
    case 'FORWARDING':
      return 'Forwarding';
    default:
      return key;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBoundedNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildAgentSystemPrompt(config: RawConfig, botName: string): string | null {
  const mission = asNonEmptyString(config?.mission);
  const agentAlias = asNonEmptyString(config?.agentAlias);
  const persona = asNonEmptyString(config?.persona);
  const tone = asNonEmptyString(config?.tone);
  const languageStyle = asNonEmptyString(config?.languageStyle);
  const escalationPolicy = asNonEmptyString(config?.escalationPolicy);
  const extraDetails = asNonEmptyString(config?.extraDetails);
  const prohibitedTopics = splitList(config?.prohibitedTopics);
  const creativity = asBoundedNumber(config?.creativity);
  const verbosity = asBoundedNumber(config?.verbosity);

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
  if (!hasGuidedConfig) return null;

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

export function buildSkillBehaviorPromptBlock(_config: RawConfig, actionType?: unknown): string | null {
  const key = mapActionTypeToSkillKey(actionType);
  if (!key) return null;

  const effectiveBehavior = DEFAULT_SKILL_BEHAVIOR_BLOCKS[key];

  return [
    `Skill behavior default (${skillLabel(key)}):`,
    `- Apply this behavior while handling the current ${skillLabel(key).toLowerCase()} workflow: ${effectiveBehavior}`,
    '- Keep required-field collection and workflow rules intact while applying this style.',
  ].join('\n');
}
