type ForwardingLike = {
  status?: string;
  reason?: string;
  actionType?: string;
  actionTaskId?: string;
  missingFields?: string[];
  claimLevel?: string;
  deliveryStatus?: string;
  canClaimCompleted?: boolean;
};

type ConversationLike = {
  id: string;
  status?: string | null;
  mode?: string | null;
  channel?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  widgetVisitorEmail?: string | null;
  customerUsername?: string | null;
  metadata?: unknown;
};

type MessageLike = {
  role: string;
  content: string;
};

export type AiConversationState =
  | 'ANSWERING'
  | 'COLLECTING_DETAILS'
  | 'ACTION_LOGGED'
  | 'WAITING_FOR_HUMAN'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLARIFYING';

export interface CompactAiContext {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerContext: string | null;
  statePrompt: string;
  responseStylePrompt: string;
  state: AiConversationState;
  memory: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeMessageContent(content: string, maxChars = 900): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trim()}...`;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

function latestCollectingContract(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const contracts = asObject(metadata.actionContracts);
  let best: { contract: Record<string, unknown>; updatedAt: number } | null = null;

  for (const value of Object.values(contracts)) {
    const contract = asObject(value);
    if (contract.status !== 'COLLECTING' && contract.status !== 'READY') continue;
    const updatedAt = typeof contract.updatedAt === 'string' ? Date.parse(contract.updatedAt) : 0;
    if (!best || updatedAt > best.updatedAt) {
      best = { contract, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 };
    }
  }

  return best?.contract ?? null;
}

export function inferAiConversationState(
  conversation: ConversationLike,
  forwarding: ForwardingLike,
): AiConversationState {
  const metadata = asObject(conversation.metadata);
  if (conversation.status === 'RESOLVED') return 'RESOLVED';
  if (conversation.mode === 'HUMAN' || conversation.status === 'ESCALATED') return 'WAITING_FOR_HUMAN';
  if (conversation.status === 'PENDING' && metadata.awaitingCsat === true) return 'RESOLVED';

  const missingFields = forwarding.missingFields ?? [];
  if (missingFields.length > 0 || latestCollectingContract(metadata)) return 'COLLECTING_DETAILS';
  if (forwarding.status === 'QUEUED' || forwarding.status === 'DUPLICATE' || forwarding.actionTaskId) {
    return 'ACTION_LOGGED';
  }
  if (forwarding.reason === 'MISSING_REQUIRED_FIELDS' || forwarding.reason === 'MISSING_CONTACT_INFO') {
    return 'COLLECTING_DETAILS';
  }
  return 'ANSWERING';
}

function buildMemory(conversation: ConversationLike, forwarding: ForwardingLike): Record<string, unknown> {
  const metadata = asObject(conversation.metadata);
  const contract = latestCollectingContract(metadata);
  const collected = asObject(contract?.collected);
  const missingFields = Array.isArray(contract?.missingFields)
    ? contract.missingFields.filter((field): field is string => typeof field === 'string' && field.length > 0)
    : forwarding.missingFields ?? [];

  return {
    customerName: conversation.customerName ?? collected.customer_name ?? null,
    customerEmail: conversation.customerEmail ?? conversation.widgetVisitorEmail ?? collected.customer_email ?? null,
    customerUsername: conversation.customerUsername ?? null,
    channel: conversation.channel ?? null,
    activeActionType: forwarding.actionType ?? null,
    actionTaskId: forwarding.actionTaskId ?? null,
    claimLevel: forwarding.claimLevel ?? null,
    deliveryStatus: forwarding.deliveryStatus ?? null,
    missingFields,
    collectedFields: collected,
    previousAiState: typeof metadata.aiConversationState === 'string' ? metadata.aiConversationState : null,
  };
}

function formatMemory(memory: Record<string, unknown>): string {
  const parts = [
    typeof memory.customerName === 'string' ? `customer name: ${memory.customerName}` : null,
    typeof memory.customerEmail === 'string' ? `customer email: ${memory.customerEmail}` : null,
    typeof memory.customerUsername === 'string' ? `customer username: ${memory.customerUsername}` : null,
    typeof memory.activeActionType === 'string' ? `active workflow: ${memory.activeActionType}` : null,
    typeof memory.actionTaskId === 'string' ? `action task id: ${memory.actionTaskId}` : null,
    Array.isArray(memory.missingFields) && memory.missingFields.length > 0
      ? `missing fields: ${memory.missingFields.join(', ')}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : 'no stable customer memory yet';
}

export function buildConversationStatePromptBlock(state: AiConversationState, memory: Record<string, unknown>): string {
  return [
    'Conversation state:',
    `- Current state: ${state}.`,
    `- Compact memory: ${formatMemory(memory)}.`,
    '- Stay consistent with this state. Do not restart the workflow if details are already collected.',
    '- If collecting details, ask only for missing required fields and avoid re-asking for confirmed fields.',
    '- If an action is logged, do not imply delivery, acknowledgement, or completion unless operational truth confirms it.',
  ].join('\n');
}

export function buildResponseStylePromptBlock(): string {
  return [
    'Response style rules:',
    '- Keep customer replies concise by default: 1-3 short paragraphs, usually under 90 words.',
    '- Answer the customer directly first, then add the minimum needed context.',
    '- Ask at most one clarifying question unless multiple fields are explicitly required for an active workflow.',
    '- Use simple, natural wording. Avoid long disclaimers, repeated apologies, and bloated summaries.',
    '- Expand only when the user asks for detail, the topic is complex, or safety/accuracy requires it.',
  ].join('\n');
}

export function compactHistory(
  messages: MessageLike[],
  options: { maxTokens?: number; maxTurns?: number; maxCharsPerMessage?: number } = {},
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const maxTokens = options.maxTokens ?? 1600;
  const maxTurns = options.maxTurns ?? 12;
  const maxCharsPerMessage = options.maxCharsPerMessage ?? 900;

  const newestFirst = messages.slice(0, maxTurns);
  const compacted: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let tokenCount = 0;

  for (const message of newestFirst) {
    const content = normalizeMessageContent(message.content, maxCharsPerMessage);
    const role = message.role === 'USER' ? 'user' : 'assistant';
    const estimated = estimateTokens({ role, content });
    if (tokenCount + estimated > maxTokens) break;
    tokenCount += estimated;
    compacted.unshift({ role, content });
  }

  return compacted;
}

export function buildCompactAiContext(input: {
  conversation: ConversationLike;
  priorMessages: MessageLike[];
  forwarding: ForwardingLike;
  previousCustomerContext?: string | null;
}): CompactAiContext {
  const state = inferAiConversationState(input.conversation, input.forwarding);
  const memory = buildMemory(input.conversation, input.forwarding);
  const history = compactHistory(input.priorMessages);
  const statePrompt = buildConversationStatePromptBlock(state, memory);
  const responseStylePrompt = buildResponseStylePromptBlock();

  const memoryLine = `Current customer memory: ${formatMemory(memory)}.`;
  const customerContext = [memoryLine, input.previousCustomerContext].filter(Boolean).join('\n') || null;

  return {
    history,
    customerContext,
    statePrompt,
    responseStylePrompt,
    state,
    memory,
  };
}

export function buildConversationMetadataPatch(
  existingMetadata: unknown,
  context: Pick<CompactAiContext, 'state' | 'memory'>,
): Record<string, unknown> {
  const metadata = asObject(existingMetadata);
  return {
    ...metadata,
    aiConversationState: context.state,
    customerMemory: {
      ...(asObject(metadata.customerMemory)),
      ...context.memory,
      updatedAt: new Date().toISOString(),
    },
  };
}
