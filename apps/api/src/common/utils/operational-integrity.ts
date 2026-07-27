export type ForwardingTruthStatus = 'DISABLED' | 'NO_INTENT' | 'DUPLICATE' | 'QUEUED' | 'FAILED' | 'UNKNOWN';
export type ForwardingTruthReason =
  | 'FORWARDING_DISABLED'
  | 'NO_ACTIONABLE_INTENT'
  | 'SKILL_NOT_ENABLED'
  | 'MISSING_CONTACT_INFO'
  | 'MISSING_REQUIRED_FIELDS'
  | 'DUPLICATE_ACTION'
  | 'QUEUED_ACTION'
  | 'CHANNEL_NOT_ALLOWED'
  | 'EXECUTOR_DISABLED'
  | 'SYSTEM_ERROR'
  | 'UNKNOWN';
export type ForwardingMissingField = string;

interface OperationalClaimGuardOptions {
  forwardingStatus?: ForwardingTruthStatus;
  forwardingReason?: ForwardingTruthReason;
  actionTaskId?: string;
  canClaimCompleted?: boolean;
  claimLevel?: string;
  deliveryStatus?: string;
  missingFields?: ForwardingMissingField[];
  blockedCapability?: string;
  actionType?: string;
}

interface DeterministicFollowUpOptions {
  actionType?: string;
  missingFields?: string[];
  canClaimCompleted?: boolean;
  forwardingReason?: string;
  blockedCapability?: string;
}

interface TruthAwareTemplateOptions {
  forwardingStatus?: ForwardingTruthStatus;
  forwardingReason?: ForwardingTruthReason;
  canClaimCompleted?: boolean;
  claimLevel?: string;
  deliveryStatus?: string;
  actionType?: string;
  missingFields?: string[];
  blockedCapability?: string;
}

const ESCALATION_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:escalated|forwarded|notified)\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:sent|passed)\s+(?:this\s+)?(?:to\s+)?(?:our\s+)?(?:team|owner|manager)\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:forwarded|sent|passed)\s+(?:it|this|your request)\s+(?:to\s+)?(?:the\s+)?owner\b/gi,
  /\b(?:your|the)\s+(?:request|meeting request)\s+(?:has been|was)\s+(?:forwarded|sent|passed)\s+(?:to\s+)?(?:the\s+)?owner\b/gi,
  /\b(?:this|it)\s+(?:has been|is)\s+(?:escalated|forwarded)\b/gi,
];

const BOOKING_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:booked|scheduled|arranged|confirmed)\s+(?:a\s+)?(?:meeting|call|appointment)\b/gi,
  /\b(?:your|the)\s+(?:meeting|call|appointment)\s+(?:is|has been)\s+(?:booked|scheduled|confirmed)\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:created|set up|made)\s+(?:a\s+)?meeting\s+request\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:logged|noted|submitted)\s+(?:your\s+|the\s+)?meeting\s+request\b/gi,
  /\b(?:your|the)\s+meeting\s+request\s+(?:is|has been)\s+(?:logged|noted|submitted)\b/gi,
  /\b(?:your|the)\s+meeting\s+request\s+(?:is|has been)\s+(?:created|queued|sent|forwarded)\b/gi,
  /\b(?:the\s+)?owner\s+(?:has been|has|was|is)\s+(?:notified|updated|alerted)\b/gi,
];

const ISSUE_LOG_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:now\s+|already\s+)?(?:logged|reported|filed|created)\s+(?:this\s+)?(?:issue|ticket|incident)\b/gi,
  /\b(?:this|the)\s+(?:issue|ticket|incident)\s+(?:has been|was)\s+(?:logged|reported|filed|created)\b/gi,
  /\b(?:our\s+)?(?:technical|support)\s+team\s+(?:is|has been)\s+(?:notified|alerted)\b/gi,
];

const ORDER_LOG_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:now\s+|already\s+)?(?:logged|reported|filed|created|submitted)\s+(?:this\s+)?(?:order|order request|purchase request|consultation request|lead request)\b/gi,
  /\b(?:this|the)\s+(?:order|order request|purchase request|consultation request|lead request)\s+(?:has been|was)\s+(?:logged|reported|filed|created|submitted)\b/gi,
  /\b(?:your|the)\s+(?:order|order request|purchase request|consultation request|lead request)\s+(?:is|has been)\s+(?:queued|sent|forwarded|logged|submitted)\b/gi,
];

const LOOKUP_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:looked up|checked|checked in|checked on)\s+(?:our\s+)?(?:system|records?)\b/gi,
  /\b(i\s+can\s+confirm|i\s+confirm|i\s+can\s+see)\b[^.!?\n]{0,160}\b(?:noted for review|logged for review|in our system|in the system)\b/gi,
  /\b(?:meeting\s+request\s+for\s+[^\s,;:.!?]+@[^\s,;:.!?]+\s+has\s+(?:also\s+)?been\s+(?:noted|logged))\b/gi,
];

const UNVERIFIED_LOGGED_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:logged|noted|submitted|queued|filed)\s+(?:it|this|your\s+request|the\s+request|your\s+meeting\s+request|the\s+meeting\s+request)?\s*(?:for\s+review)?\b/gi,
  /\b(?:your|the)\s+(?:request|meeting\s+request)\s+(?:is|has been|was)\s+(?:logged|noted|submitted|queued|filed)\s*(?:for\s+review)?\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:noted|captured)\s+your\s+request\s+for\s+(?:a\s+)?meeting\b/gi,
  /\b(?:i\s+am\s+now|i\s+will\s+now|i\s+just)\s+(?:log(?:ging)?|submitting|queuing|noting)\b/gi,
  /\b(?:request|ticket|order|booking)\s+(?:is|has been|was)\s+(?:created|raised|sent through|passed on)\b/gi,
  /\b(?:it'?s|it is)\s+(?:already\s+)?(?:in\s+the\s+queue|queued\s+for\s+the\s+team)\b/gi,
];

const DOWNSTREAM_DELIVERY_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:our\s+)?(?:sales\s+team|team|owner|agent)\s+(?:will|should)\s+(?:reach\s+out|contact\s+you|follow\s+up)\s+(?:soon|shortly)?\b/gi,
  /\bplease\s+expect\s+(?:our\s+)?(?:team|sales\s+team|owner|agent)\s+to\s+(?:reach\s+out|contact\s+you|follow\s+up)\b/gi,
  /\b(?:the\s+)?team\s+(?:has\s+received|received|was\s+notified|has\s+been\s+notified)\b/gi,
  /\b(?:owner|manager|sales\s+team)\s+(?:has\s+been\s+notified|is\s+aware)\b/gi,
];

const AMBIGUOUS_CAPABILITY_CLAIM_PATTERNS: RegExp[] = [
  /\bi\s+can\s+help\s+(?:log|note|submit|queue|file|process|handle)\s+(?:this|that|your\s+request|the\s+request)(?:\s+for\s+review)?\b/gi,
  /\bi\s+can\s+(?:log|note|submit|queue|file|process|handle)\s+(?:this|that|your\s+request|the\s+request)(?:\s+right\s+now)?\b/gi,
  /\bi\s+can\s+help\s+(?:pass|forward)\s+(?:this|that|your\s+request|the\s+request)\s+to\s+(?:our\s+)?(?:team|sales\s+team|owner)\b/gi,
  /\bi\s+have\s+processed\s+(?:this|that|your\s+request|the\s+request)\b/gi,
  /\bi\s+have\s+taken\s+the\s+action\b/gi,
];

function describeForwardingStatus(status: ForwardingTruthStatus): string {
  switch (status) {
    case 'QUEUED':
      return 'A follow-up request was logged for review on this turn.';
    case 'DUPLICATE':
      return 'A similar follow-up request is already logged for this turn/conversation context.';
    case 'DISABLED':
      return 'Forwarding is disabled for this bot.';
    case 'NO_INTENT':
      return 'No actionable forwarding intent was detected from this turn.';
    case 'FAILED':
      return 'Forwarding confirmation failed for this turn.';
    default:
      return 'Forwarding status is unknown for this turn.';
  }
}

function describeForwardingReason(reason: ForwardingTruthReason): string {
  switch (reason) {
    case 'SKILL_NOT_ENABLED':
      return 'The required skill/capability is not enabled for this bot.';
    case 'MISSING_CONTACT_INFO':
      return 'Missing required customer contact information for forwarding.';
    case 'MISSING_REQUIRED_FIELDS':
      return 'Missing required fields for the active skill workflow.';
    case 'NO_ACTIONABLE_INTENT':
      return 'No forwarding-worthy intent was detected.';
    case 'FORWARDING_DISABLED':
      return 'Forwarding is disabled in bot settings.';
    case 'DUPLICATE_ACTION':
      return 'A duplicate forwarding request already exists.';
    case 'QUEUED_ACTION':
      return 'A follow-up request was logged successfully.';
    case 'CHANNEL_NOT_ALLOWED':
      return 'This channel is not allowed for the requested action.';
    case 'EXECUTOR_DISABLED':
      return 'This action executor is currently disabled.';
    case 'SYSTEM_ERROR':
      return 'Forwarding failed due to a system/runtime issue.';
    default:
      return 'Forwarding reason is unknown.';
  }
}

// Capability-block reasons come from the LEGACY keyword/AI classifier. In agentic mode capability is
// expressed by which tools are enabled (a disabled action is simply not in the toolset), so this
// verdict must NOT leak into the prompt — otherwise the model refuses a request an enabled tool can
// actually handle (e.g. "buy a ticket" → routes to a disabled Sales workflow instead of registration).
const CAPABILITY_BLOCK_REASONS = new Set(['SKILL_NOT_ENABLED', 'FORWARDING_DISABLED', 'CHANNEL_NOT_ALLOWED', 'EXECUTOR_DISABLED']);

export function buildOperationalIntegrityPromptBlock(
  status: ForwardingTruthStatus = 'UNKNOWN',
  reason: ForwardingTruthReason = 'UNKNOWN',
  missingFields: ForwardingMissingField[] = [],
  blockedCapability?: string,
  actionTaskId?: string,
  claimLevel?: string,
  deliveryStatus?: string,
  agentic = false,
): string {
  // In agentic mode, neutralize the legacy classifier's capability-block verdict (see above).
  const effectiveReason = agentic && CAPABILITY_BLOCK_REASONS.has(reason as string) ? ('UNKNOWN' as ForwardingTruthReason) : reason;
  const effectiveBlocked = agentic ? undefined : blockedCapability;
  const missingFieldText = missingFields.length > 0
    ? `- Missing data for forwarding: ${missingFields.join(', ')}.`
    : null;
  return [
    'Operational integrity rules:',
    `- Forwarding truth for this turn: ${describeForwardingStatus(status)}`,
    `- Forwarding reason for this turn: ${describeForwardingReason(effectiveReason)}`,
    claimLevel ? `- Claim level for this turn: ${claimLevel}.` : null,
    deliveryStatus ? `- Delivery status for this turn: ${deliveryStatus}.` : null,
    actionTaskId ? `- Verified action task id for this turn: ${actionTaskId}.` : '- Verified action task id for this turn: none.',
    effectiveBlocked ? `- Blocked capability for this turn: ${effectiveBlocked}.` : null,
    missingFieldText,
    '- Never claim a booking, escalation, forwarding, or owner/team notification is completed unless the system confirms completion.',
    '- You may only state that a follow-up request was logged when forwarding truth for this turn is queued or duplicate.',
    '- Do not say the request was forwarded to the owner, sent to the team, or that the meeting was booked/scheduled unless that is explicitly confirmed.',
    '- If the user asked to book a meeting, but the system only logged an action task, say it was noted for review; do not say a meeting was scheduled or a booking exists.',
    '- If forwarding failed due to missing customer data, ask only for the missing fields before promising escalation.',
    '- If completion is not confirmed, use capability language such as "I can help prepare this as a request for review" or "I can help note this for review."',
    '- Never auto-correct or normalize customer-provided identifiers (emails, phone numbers, names, dates). If a value looks invalid or incomplete, ask the user to confirm or correct it.',
    '- Never append or infer missing email/domain/date parts that the user did not provide.',
    '- Do not claim you checked or verified arbitrary customer records/emails in the system unless that lookup was explicitly confirmed by backend data for this turn.',
    '- Be explicit about uncertainty and next steps; do not imply actions already happened when they have not.',
  ].join('\n');
}

export function sanitizeOperationalClaims(
  text: string,
  options: OperationalClaimGuardOptions = {},
): string {
  // Registration requests are self-service: the entry is created directly in-system by this
  // turn, and the AI has full, accurate product/registration state via the grounding block.
  // The escalation/booking/lead claim patterns below are tuned for actions that only get
  // logged for a human to review later — applying them here mangles a truthful "you're
  // registered" confirmation into nonsensical escalation-flavored fragments.
  if (options.actionType === 'REGISTRATION_REQUEST') return text;

  let sanitized = text;
  const forwardingStatus = options.forwardingStatus ?? 'UNKNOWN';
  const forwardingReason = options.forwardingReason ?? 'UNKNOWN';
  const actionTaskId = options.actionTaskId;
  const missingFields = options.missingFields ?? [];
  const blockedCapability = options.blockedCapability;
  const canConfirmForwardingRequest = options.canClaimCompleted
    ?? ((forwardingStatus === 'QUEUED' || forwardingStatus === 'DUPLICATE') && Boolean(actionTaskId));
  const deliveryStatus = (options.deliveryStatus ?? '').toUpperCase();
  const hasTeamDeliveryConfirmation = deliveryStatus === 'DELIVERED_TO_TEAM';
  const hasFollowUpMissingFields = missingFields.length > 0;
  const isMissingContactIssue = forwardingReason === 'MISSING_CONTACT_INFO' || forwardingReason === 'MISSING_REQUIRED_FIELDS';
  const isCapabilityBlocked =
    forwardingReason === 'FORWARDING_DISABLED'
    ||
    forwardingReason === 'SKILL_NOT_ENABLED'
    || forwardingReason === 'CHANNEL_NOT_ALLOWED'
    || forwardingReason === 'EXECUTOR_DISABLED';

  const capabilityBlockedPrompt = forwardingReason === 'FORWARDING_DISABLED'
    ? 'This bot cannot submit operational follow-up requests because forwarding is currently disabled. I can route you to a human teammate instead.'
    : `This request is outside my currently enabled workflows${blockedCapability ? ` (${blockedCapability})` : ''}. I can route you to a human for help.`;

  const missingFieldPrompt = isMissingContactIssue && missingFields.length > 0
    ? `I can help log this for review once I have: ${missingFields.join(', ')}.`
    : isCapabilityBlocked
      ? capabilityBlockedPrompt
    : 'I can help log this for review for our team.';

  for (const pattern of ESCALATION_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      canConfirmForwardingRequest
        ? 'I have logged this for review for our team'
        : missingFieldPrompt,
    );
  }

  for (const pattern of BOOKING_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(pattern, 'I can help note this for review');
  }

  for (const pattern of ISSUE_LOG_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      canConfirmForwardingRequest
        ? hasFollowUpMissingFields
          ? `I have logged this for review for our technical team. To follow up with you, please share: ${missingFields.join(', ')}.`
          : 'I have logged this for review for our technical team'
        : missingFieldPrompt,
    );
  }

  for (const pattern of ORDER_LOG_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      canConfirmForwardingRequest
        ? hasFollowUpMissingFields
          ? `I have logged this for review for our sales team. To follow up with you, please share: ${missingFields.join(', ')}.`
          : 'I have logged this for review for our sales team'
        : missingFieldPrompt,
    );
  }

  for (const pattern of LOOKUP_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      canConfirmForwardingRequest
        ? 'I can only confirm requests created in this conversation context'
        : 'I cannot verify unrelated customer records from here without a confirmed booking/request reference',
    );
  }

  if (isCapabilityBlocked) {
    for (const pattern of AMBIGUOUS_CAPABILITY_CLAIM_PATTERNS) {
      sanitized = sanitized.replace(pattern, missingFieldPrompt);
    }
  }

  if (!canConfirmForwardingRequest) {
    for (const pattern of UNVERIFIED_LOGGED_CLAIM_PATTERNS) {
      sanitized = sanitized.replace(pattern, missingFieldPrompt);
    }
  }

  for (const pattern of DOWNSTREAM_DELIVERY_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      hasTeamDeliveryConfirmation
        ? 'our team has been notified and will follow up.'
        : canConfirmForwardingRequest
          ? 'I have logged an internal request for review in this conversation context, but I cannot confirm downstream delivery yet.'
          : 'I can help prepare this as a request for review once required details are confirmed.',
    );
  }

  // Normalize whitespace and reduce duplicate sentence artifacts from overlapping replacements.
  sanitized = sanitized
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([.!?])(\S)/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const dedupedSentences: string[] = [];
  const seenSentences = new Set<string>();
  for (const sentence of sanitized.split(/(?<=[.!?])\s+/)) {
    const normalizedSentence = sentence.trim();
    if (!normalizedSentence) continue;
    const key = normalizedSentence.toLowerCase();
    if (seenSentences.has(key)) continue;
    seenSentences.add(key);
    dedupedSentences.push(normalizedSentence);
  }
  if (dedupedSentences.length > 0) {
    sanitized = dedupedSentences.join(' ').trim();
  }

  return sanitized;
}

function humanizeField(field: string): string {
  switch (field) {
    case 'customer_name':
      return 'full name';
    case 'customer_email':
      return 'valid email address';
    case 'customer_phone':
      return 'phone number';
    case 'company_name':
      return 'company name';
    case 'consultation_purpose':
      return 'consultation purpose';
    case 'preferred_datetime':
      return 'preferred date and time';
    case 'booking_reason':
      return 'meeting subject/reason';
    case 'issue_summary':
      return 'issue summary';
    case 'product':
      return 'product/service requested';
    default:
      return field.replace(/_/g, ' ');
  }
}

function describeActionLabel(actionType?: string): string {
  if (actionType === 'MEETING_REQUEST') return 'booking requests';
  if (actionType === 'CONSULTATION_REQUEST') return 'consultation requests';
  if (actionType === 'SALES_ORDER_REQUEST') return 'sales order requests';
  if (actionType === 'TECHNICAL_ISSUE') return 'technical issue requests';
  if (actionType === 'OWNER_ATTENTION_NEEDED') return 'owner escalation requests';
  return 'this request type';
}

function describeCapabilityLabel(capability?: string): string {
  if (!capability) return 'the required workflow';
  if (capability === 'SALES') return 'the Sales workflow';
  if (capability === 'BOOKING') return 'the Booking workflow';
  if (capability === 'TECHNICAL') return 'the Technical workflow';
  if (capability === 'FORWARDING') return 'the Forwarding workflow';
  if (capability === 'SUPPORT_OR_TECHNICAL') return 'the Support or Technical workflow';
  return `${capability} workflow`;
}

export function buildDeterministicFollowUpMessage(
  options: DeterministicFollowUpOptions = {},
): string | null {
  const isBlockedCapability =
    options.forwardingReason === 'FORWARDING_DISABLED'
    ||
    options.forwardingReason === 'SKILL_NOT_ENABLED'
    || options.forwardingReason === 'CHANNEL_NOT_ALLOWED'
    || options.forwardingReason === 'EXECUTOR_DISABLED';

  if (isBlockedCapability) {
    if (options.forwardingReason === 'FORWARDING_DISABLED') {
      return 'This bot cannot submit operational follow-up requests because forwarding is currently disabled. I can route you to a human teammate instead.';
    }
    const actionLabel = describeActionLabel(options.actionType);
    const capabilityLabel = describeCapabilityLabel(options.blockedCapability);
    return `I cannot complete ${actionLabel} from this bot because ${capabilityLabel} is not enabled here. I can route you to a human teammate for help.`;
  }

  const missingFields = (options.missingFields ?? []).filter((field) => field.trim().length > 0);
  if (missingFields.length === 0) return null;
  if (options.canClaimCompleted === true) return null;

  const subject = options.actionType === 'MEETING_REQUEST'
    ? 'meeting request'
    : options.actionType === 'CONSULTATION_REQUEST'
      ? 'consultation request'
    : options.actionType === 'SALES_ORDER_REQUEST'
      ? 'order request'
    : options.actionType === 'TECHNICAL_ISSUE'
      ? 'technical issue request'
    : options.actionType === 'REGISTRATION_REQUEST'
      ? 'event registration'
      : 'request';
  const needed = missingFields.map(humanizeField).join(', ');

  if (options.actionType === 'TECHNICAL_ISSUE') {
    const needsEmail = missingFields.includes('customer_email');
    const needsIssueSummary = missingFields.includes('issue_summary');
    const issueDetailPrompt = needsIssueSummary || !missingFields.includes('issue_details')
      ? 'a short description of the issue'
      : null;
    const technicalParts = [
      needsEmail ? 'valid email address' : null,
      issueDetailPrompt,
      ...missingFields
        .filter((field) => field !== 'customer_email' && field !== 'issue_summary' && field !== 'issue_details')
        .map(humanizeField),
    ].filter((part): part is string => Boolean(part));

    return `To continue with your ${subject}, please provide: ${technicalParts.join(', ')}. I cannot submit this as completed until these details are confirmed.`;
  }

  return `To continue with your ${subject}, please provide: ${needed}. I cannot submit this as completed until these details are confirmed.`;
}

export function buildTruthAwareResponseTemplate(
  options: TruthAwareTemplateOptions = {},
): string | null {
  const reason = options.forwardingReason;
  const status = options.forwardingStatus;
  const claimLevel = (options.claimLevel ?? '').toUpperCase();
  const deliveryStatus = (options.deliveryStatus ?? '').toUpperCase();

  const deterministic = buildDeterministicFollowUpMessage({
    actionType: options.actionType,
    missingFields: options.missingFields,
    canClaimCompleted: options.canClaimCompleted,
    forwardingReason: options.forwardingReason,
    blockedCapability: options.blockedCapability,
  });
  if (deterministic) return deterministic;

  if (reason === 'SYSTEM_ERROR' || status === 'FAILED') {
    return 'I could not verify or complete that action on this turn due to a system issue. I can help you retry now, or route this to a human teammate.';
  }

  if (status === 'UNKNOWN') {
    return 'I could not verify the operational status for that request on this turn. Please restate what you want to do, and I will guide the next step clearly.';
  }

  if (status === 'QUEUED' || status === 'DUPLICATE' || claimLevel === 'QUEUED_INTERNAL') {
    if (deliveryStatus === 'DELIVERED_TO_TEAM') {
      return 'I can confirm this request has been delivered to our team for follow-up.';
    }
    if (deliveryStatus === 'SENT_TO_CHANNEL' || claimLevel === 'SENT_TO_CHANNEL') {
      return 'I can confirm this request was sent to the configured team channel. I cannot confirm a human has received or acknowledged it yet.';
    }
    // Registration requests are self-service: the entry is created in-system and the AI
    // has full product context from the registration grounding block. Let the AI generate
    // the confirmation directly rather than replacing it with a generic internal-request message.
    if (options.actionType === 'REGISTRATION_REQUEST') {
      return null;
    }
    if (options.canClaimCompleted) {
      return 'I have logged an internal request for review in this conversation. I cannot confirm downstream team delivery yet.';
    }
    return 'I can help prepare this as a request for review once the remaining required details are confirmed.';
  }

  if (status === 'DISABLED' || reason === 'FORWARDING_DISABLED') {
    return 'This action workflow is currently disabled on this bot. I can route you to a human teammate instead.';
  }

  return null;
}
