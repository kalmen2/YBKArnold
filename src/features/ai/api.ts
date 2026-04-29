import { apiRequest } from '../api-client'

export type AiRuleCategory = 'support' | 'orders' | 'crm' | 'general'

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
  rulesUpdated: boolean
}

export function generateAiSupportReply(ticketId: number) {
  return apiRequest<{ reply: string }>('/api/ai/support/generate-reply', {
    method: 'POST',
    body: JSON.stringify({ ticketId }),
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

export function chatForAiRules(category: AiRuleCategory, messages: AiChatMessage[]) {
  return apiRequest<AiChatResponse>('/api/ai/rules/chat', {
    method: 'POST',
    body: JSON.stringify({ category, messages }),
  })
}
