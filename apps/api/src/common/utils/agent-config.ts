type RawConfig = Record<string, unknown> | null | undefined;

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
  const promptMode = asNonEmptyString(config?.promptMode)?.toLowerCase();
  const explicitPrompt = asNonEmptyString(config?.systemPrompt);
  const isOverrideMode = promptMode === 'override';
  const isGuidedMode = promptMode === 'guided';

  // Safeguard: if override is selected but empty, fall back to guided config.
  if (isOverrideMode && explicitPrompt) return explicitPrompt;
  if (explicitPrompt && !isGuidedMode) return explicitPrompt;

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
