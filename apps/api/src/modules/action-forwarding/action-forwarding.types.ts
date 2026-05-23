export type ActionType =
  | 'MEETING_REQUEST'
  | 'SALES_ORDER_REQUEST'
  | 'OWNER_ATTENTION_NEEDED'
  | 'TECHNICAL_ISSUE';

export type ContactChannel = 'TELEGRAM' | 'EMAIL';

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
