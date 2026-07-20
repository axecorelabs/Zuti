export type ActionType =
  | 'MEETING_REQUEST'
  | 'CONSULTATION_REQUEST'
  | 'SALES_ORDER_REQUEST'
  | 'OWNER_ATTENTION_NEEDED'
  | 'TECHNICAL_ISSUE'
  | 'REGISTRATION_REQUEST';

export type CapabilityKey = 'BOOKING' | 'SALES' | 'TECHNICAL' | 'FORWARDING';

export type RuntimeChannel = 'WIDGET' | 'EMAIL' | 'TELEGRAM' | 'WHATSAPP';

export interface ActionCapabilityDefinition {
  actionType: ActionType;
  capabilityKey: CapabilityKey;
  requiredFields: string[];
  allowedChannels: RuntimeChannel[];
  executor: {
    kind: 'ACTION_TASK' | 'LOOKUP_ONLY';
    enabled: boolean;
  };
  claimRules: {
    requiresActionTaskIdToConfirm: boolean;
    forbidSystemLookupClaimWithoutLookupId: boolean;
  };
}

export interface ActionCapabilityRegistry {
  version: string;
  actions: Record<ActionType, ActionCapabilityDefinition>;
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
  | 'SYSTEM_ERROR'
  | 'CHANNEL_NOT_ALLOWED'
  | 'EXECUTOR_DISABLED';

export type ActionForwardingMissingField = string;

export type ActionClaimLevel =
  | 'REQUESTED'
  | 'QUEUED_INTERNAL'
  | 'SENT_TO_CHANNEL'
  | 'DELIVERED_TO_TEAM'
  | 'ACKNOWLEDGED_BY_AGENT'
  | 'COMPLETED';

export type ActionDeliveryStatus =
  | 'NOT_APPLICABLE'
  | 'NOT_SENT'
  | 'QUEUED_INTERNAL'
  | 'SENT_TO_CHANNEL'
  | 'DELIVERY_UNKNOWN'
  | 'DELIVERED_TO_TEAM';

export interface ActionOperationalTruth {
  intentDetected: boolean;
  capabilityRequired?: CapabilityKey;
  capabilityEnabled: boolean;
  actionAttempted: boolean;
  actionResult:
    | 'DISABLED'
    | 'NO_INTENT'
    | 'BLOCKED'
    | 'MISSING_FIELDS'
    | 'QUEUED_INTERNAL'
    | 'DUPLICATE'
    | 'FAILED'
    | 'UNKNOWN';
  actionTaskId?: string;
  deliveryStatus: ActionDeliveryStatus;
  missingFields: ActionForwardingMissingField[];
  evidenceIds: string[];
}

export interface ActionForwardingResult {
  status: ActionForwardingResultStatus;
  reason: ActionForwardingReason;
  actionType?: ActionType;
  capabilityKey?: CapabilityKey;
  actionTaskId?: string;
  lookupId?: string;
  canClaimCompleted: boolean;
  claimLevel: ActionClaimLevel;
  deliveryStatus: ActionDeliveryStatus;
  operationalTruth: ActionOperationalTruth;
  missingFields?: ActionForwardingMissingField[];
  blockedCapability?: string;
  registrationPaymentUrl?: string;
  /** Customer-facing notice for registration dedup / capacity outcomes (already registered, full). */
  registrationNotice?: string;
}

export type ContactChannel = 'TELEGRAM' | 'EMAIL' | 'WHATSAPP';

export interface ContactEndpointConfig {
  id: string;
  channel: ContactChannel;
  destination: string;
  isActive: boolean;
}

export interface ContactPolicyConfig {
  id: string;
  scope: 'ORGANIZATION' | 'BOT';
  isDefault: boolean;
  endpointId?: string | null;
  rules?: Record<string, unknown>;
}

export interface ResolveRouteInput {
  orgPolicies: ContactPolicyConfig[];
  botPolicies: ContactPolicyConfig[];
  endpoints: ContactEndpointConfig[];
  actionType: ActionType;
}

export interface ResolveRouteResult {
  endpoint: ContactEndpointConfig | null;
  policy: ContactPolicyConfig | null;
  reason: 'BOT_OVERRIDE' | 'ORG_DEFAULT' | 'NO_ROUTE';
}

export interface ActionClassifierResult {
  actionType: ActionType;
  confidence: number;
  summary: string;
  urgency?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  extractedFields?: Record<string, unknown>;
}

export interface AiActionClassifierResponse {
  action_type: ActionType | 'NONE';
  confidence: number;
  summary: string;
}
