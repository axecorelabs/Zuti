export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export type BillingPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE'
export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT'
export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'ESCALATED'
export type ConversationMode = 'AI' | 'HUMAN'
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM' | 'AGENT'
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
