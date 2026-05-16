export interface ChatRequest {
  workspaceId: string
  conversationId: string
  message: string
  telegramChatId: string
}

export interface ChatResponse {
  reply: string
  confidence: number
  shouldEscalate: boolean
  escalationReason?: string
  sources?: string[]
}

export interface IngestRequest {
  workspaceId: string
  fileId: string
  storageKey: string
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'URL'
  url?: string
}
