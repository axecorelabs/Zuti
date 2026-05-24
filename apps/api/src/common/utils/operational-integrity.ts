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
  missingFields?: ForwardingMissingField[];
  blockedCapability?: string;
}

interface DeterministicFollowUpOptions {
  actionType?: string;
  missingFields?: string[];
  canClaimCompleted?: boolean;
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

const LOOKUP_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:looked up|checked|checked in|checked on)\s+(?:our\s+)?(?:system|records?)\b/gi,
  /\b(i\s+can\s+confirm|i\s+confirm|i\s+can\s+see)\b[^.!?\n]{0,160}\b(?:noted for review|logged for review|in our system|in the system)\b/gi,
  /\b(?:meeting\s+request\s+for\s+[^\s,;:.!?]+@[^\s,;:.!?]+\s+has\s+(?:also\s+)?been\s+(?:noted|logged))\b/gi,
];

const UNVERIFIED_LOGGED_CLAIM_PATTERNS: RegExp[] = [
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:logged|noted|submitted|queued|filed)\s+(?:it|this|your\s+request|the\s+request|your\s+meeting\s+request|the\s+meeting\s+request)?\s*(?:for\s+review)?\b/gi,
  /\b(?:your|the)\s+(?:request|meeting\s+request)\s+(?:is|has been|was)\s+(?:logged|noted|submitted|queued|filed)\s*(?:for\s+review)?\b/gi,
  /\b(i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:noted|captured)\s+your\s+request\s+for\s+(?:a\s+)?meeting\b/gi,
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

export function buildOperationalIntegrityPromptBlock(
  status: ForwardingTruthStatus = 'UNKNOWN',
  reason: ForwardingTruthReason = 'UNKNOWN',
  missingFields: ForwardingMissingField[] = [],
  blockedCapability?: string,
  actionTaskId?: string,
): string {
  const missingFieldText = missingFields.length > 0
    ? `- Missing data for forwarding: ${missingFields.join(', ')}.`
    : null;
  return [
    'Operational integrity rules:',
    `- Forwarding truth for this turn: ${describeForwardingStatus(status)}`,
    `- Forwarding reason for this turn: ${describeForwardingReason(reason)}`,
    actionTaskId ? `- Verified action task id for this turn: ${actionTaskId}.` : '- Verified action task id for this turn: none.',
    blockedCapability ? `- Blocked capability for this turn: ${blockedCapability}.` : null,
    missingFieldText,
    '- Never claim a booking, escalation, forwarding, or owner/team notification is completed unless the system confirms completion.',
    '- You may only state that a follow-up request was logged when forwarding truth for this turn is queued or duplicate.',
    '- Do not say the request was forwarded to the owner, sent to the team, or that the meeting was booked/scheduled unless that is explicitly confirmed.',
    '- If the user asked to book a meeting, but the system only logged an action task, say it was noted for review; do not say a meeting was scheduled or a booking exists.',
    '- If forwarding failed due to missing customer data, ask only for the missing fields before promising escalation.',
    '- If completion is not confirmed, use capability language such as "I can help prepare this as a request for review" or "I can help note this as a meeting request."',
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
  let sanitized = text;
  const forwardingStatus = options.forwardingStatus ?? 'UNKNOWN';
  const forwardingReason = options.forwardingReason ?? 'UNKNOWN';
  const actionTaskId = options.actionTaskId;
  const missingFields = options.missingFields ?? [];
  const blockedCapability = options.blockedCapability;
  const canConfirmForwardingRequest = options.canClaimCompleted
    ?? ((forwardingStatus === 'QUEUED' || forwardingStatus === 'DUPLICATE') && Boolean(actionTaskId));
  const hasFollowUpMissingFields = missingFields.length > 0;
  const isMissingContactIssue = forwardingReason === 'MISSING_CONTACT_INFO' || forwardingReason === 'MISSING_REQUIRED_FIELDS';
  const isCapabilityBlocked =
    forwardingReason === 'SKILL_NOT_ENABLED'
    || forwardingReason === 'CHANNEL_NOT_ALLOWED'
    || forwardingReason === 'EXECUTOR_DISABLED';

  const missingFieldPrompt = isMissingContactIssue && missingFields.length > 0
    ? `I can help log this for review once I have: ${missingFields.join(', ')}.`
    : isCapabilityBlocked
      ? `This request is outside my currently enabled workflows${blockedCapability ? ` (${blockedCapability})` : ''}. I can route you to a human for help.`
    : 'I can help log this for review for our team';

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

  for (const pattern of LOOKUP_CLAIM_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      canConfirmForwardingRequest
        ? 'I can only confirm requests created in this conversation context'
        : 'I cannot verify unrelated customer records from here without a confirmed booking/request reference',
    );
  }

  if (!canConfirmForwardingRequest) {
    for (const pattern of UNVERIFIED_LOGGED_CLAIM_PATTERNS) {
      sanitized = sanitized.replace(pattern, missingFieldPrompt);
    }
  }

  if (sanitized !== text && !/cannot confirm operational actions as completed/i.test(sanitized)) {
    sanitized = `${sanitized}\n\nI cannot confirm operational actions as completed until the system confirms them.`;
  }

  return sanitized;
}

function humanizeField(field: string): string {
  switch (field) {
    case 'customer_name':
      return 'full name';
    case 'customer_email':
      return 'valid email address';
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

export function buildDeterministicFollowUpMessage(
  options: DeterministicFollowUpOptions = {},
): string | null {
  const missingFields = (options.missingFields ?? []).filter((field) => field.trim().length > 0);
  if (missingFields.length === 0) return null;
  if (options.canClaimCompleted === true) return null;

  const subject = options.actionType === 'MEETING_REQUEST'
    ? 'meeting request'
    : options.actionType === 'TECHNICAL_ISSUE'
      ? 'technical issue request'
      : 'request';
  const needed = missingFields.map(humanizeField).join(', ');

  return `To continue with your ${subject}, please provide: ${needed}. I cannot submit this as completed until these details are confirmed.`;
}