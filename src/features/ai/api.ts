import { apiRequest } from '../api-client'

export type AiRuleCategory = 'support' | 'summaries' | 'general'
export type AiModelQuality = 'fast' | 'better' | 'deep'

export type AiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AiRulesPayload = {
  category: string
  content: string
}

export type AiChatResponse = {
  message: string
  rules: string
  proposedRules: string | null
  rulesUpdated: boolean
}

export function generateAiSupportReply(ticketId: number, draftHint?: string) {
  return apiRequest<{ reply: string }>('/api/ai/support/generate-reply', {
    method: 'POST',
    body: JSON.stringify({ ticketId, draftHint }),
  })
}

export function fetchAiRules(category: AiRuleCategory) {
  return apiRequest<AiRulesPayload>(`/api/ai/rules/${category}`)
}

export function saveAiRules(category: AiRuleCategory, content: string) {
  return apiRequest<AiRulesPayload>(`/api/ai/rules/${category}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function chatForAiRules(
  category: AiRuleCategory,
  messages: AiChatMessage[],
  modelQuality: AiModelQuality,
) {
  return apiRequest<AiChatResponse>('/api/ai/rules/chat', {
    method: 'POST',
    body: JSON.stringify({ category, messages, modelQuality }),
  })
}

export function fetchCommentSummaries(ticketId: number) {
  return apiRequest<{ summaries: Record<number, string> }>(
    `/api/ai/support/tickets/${ticketId}/comment-summaries`,
  )
}
