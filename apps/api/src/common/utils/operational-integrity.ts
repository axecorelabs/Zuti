export type ForwardingTruthStatus = 'DISABLED' | 'NO_INTENT' | 'DUPLICATE' | 'QUEUED' | 'FAILED' | 'UNKNOWN';
export type ForwardingTruthReason =
  | 'FORWARDING_DISABLED'
  | 'NO_ACTIONABLE_INTENT'
  | 'SKILL_NOT_ENABLED'
  | 'MISSING_CONTACT_INFO'
  | 'MISSING_REQUIRED_FIELDS'
  | 'DUPLICATE_ACTION'
  | 'QUEUED_ACTION'
  | 'SYSTEM_ERROR'
  | 'UNKNOWN';
export type ForwardingMissingField = string;

interface OperationalClaimGuardOptions {
  forwardingStatus?: ForwardingTruthStatus;
  forwardingReason?: ForwardingTruthReason;
  missingFields?: ForwardingMissingField[];
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
  /\b(?:your|the)\s+meeting\s+request\s+(?:is|has been)\s+(?:created|queued|sent|forwarded)\b/gi,
  /\b(?:the\s+)?owner\s+(?:has been|has|was|is)\s+(?:notified|updated|alerted)\b/gi,
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
): string {
  const missingFieldText = missingFields.length > 0
    ? `- Missing data for forwarding: ${missingFields.join(', ')}.`
    : null;
  return [
    'Operational integrity rules:',
    `- Forwarding truth for this turn: ${describeForwardingStatus(status)}`,
    `- Forwarding reason for this turn: ${describeForwardingReason(reason)}`,
    blockedCapability ? `- Blocked capability for this turn: ${blockedCapability}.` : null,
    missingFieldText,
    '- Never claim a booking, escalation, forwarding, or owner/team notification is completed unless the system confirms completion.',
    '- You may only state that a follow-up request was logged when forwarding truth for this turn is queued or duplicate.',
    '- Do not say the request was forwarded to the owner, sent to the team, or that the meeting was booked/scheduled unless that is explicitly confirmed.',
    '- If the user asked to book a meeting, but the system only logged an action task, say it was noted for review; do not say a meeting was scheduled or a booking exists.',
    '- If forwarding failed due to missing customer data, ask only for the missing fields before promising escalation.',
    '- If completion is not confirmed, use capability language such as "I can help log this for review" or "I can help note this as a meeting request."',
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
  const missingFields = options.missingFields ?? [];
  const blockedCapability = options.blockedCapability;
  const canConfirmForwardingRequest = forwardingStatus === 'QUEUED' || forwardingStatus === 'DUPLICATE';
  const isMissingContactIssue = forwardingReason === 'MISSING_CONTACT_INFO' || forwardingReason === 'MISSING_REQUIRED_FIELDS';
  const isSkillDisabled = forwardingReason === 'SKILL_NOT_ENABLED';

  const missingFieldPrompt = isMissingContactIssue && missingFields.length > 0
    ? `I can help log this for review once I have: ${missingFields.join(', ')}.`
    : isSkillDisabled
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

  if (sanitized !== text && !/cannot confirm operational actions as completed/i.test(sanitized)) {
    sanitized = `${sanitized}\n\nI cannot confirm operational actions as completed until the system confirms them.`;
  }

  return sanitized;
}