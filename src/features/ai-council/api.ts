import { apiRequest } from '../api-client'

export type AiCouncilMember = 'chatgpt' | 'claude' | 'moderator'
export type AiCouncilAiMember = Exclude<AiCouncilMember, 'moderator'>
export type AiCouncilChatType = 'council' | 'direct'

export type AiCouncilChat = {
  id: string
  title: string
  chatType: AiCouncilChatType
  targetMember: AiCouncilAiMember | null
  pinned: boolean
  status: 'active' | 'finished' | string
  outcome?: string | null
  outcomeReason?: string | null
  outcomeByMember?: AiCouncilAiMember | null
  outcomeAt?: string | null
  createdAt: string | null
  updatedAt: string | null
  finishedAt: string | null
  processingMember?: string | null
}

export type AiCouncilMessage = {
  id: string
  chatId: string
  sender: string
  text: string
  type: string
  provider?: 'openai' | 'anthropic' | null
  member?: string | null
  createdAt: string | null
}

export type AiCouncilRule = {
  member: AiCouncilMember
  label: string
  role: string
  provider?: 'openai' | 'anthropic' | string
  model: string
  instructions: string
  maxDiscussionRounds?: number
  tags?: Record<string, string>
  runtimeInstructions?: Record<string, string>
  turnInstructions?: Record<string, string>
  createdAt?: string | null
  updatedAt?: string | null
}

export type AiCouncilStatus = {
  googleDrive: {
    googleClientConfigured: boolean
    tokenEncryptionConfigured: boolean
    driveScopeConfigured: boolean
    connected: boolean
    connectedEmail: string | null
    grantedDriveScope: boolean
    brainReadable: boolean
    brainFilesRead: number
    brainReadError: string | null
    configuredRedirectUri: string | null
    brainFolderId: string
    requiredDriveScope: string
  }
}

export function fetchAiCouncilStatus() {
  return apiRequest<AiCouncilStatus>('/api/ai-council/status')
}

export function fetchAiCouncilRules() {
  return apiRequest<{ rules: Record<AiCouncilMember, AiCouncilRule> }>('/api/ai-council/rules')
}

export function saveAiCouncilRule(
  member: AiCouncilMember,
  payload: {
    instructions: string
    tags?: Record<string, string>
    runtimeInstructions?: Record<string, string>
    turnInstructions?: Record<string, string>
  },
) {
  return apiRequest<{ rule: AiCouncilRule, rules: Record<AiCouncilMember, AiCouncilRule> }>(
    `/api/ai-council/rules/${member}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export function fetchAiCouncilChats(options: {
  chatType?: AiCouncilChatType
  targetMember?: AiCouncilAiMember | null
  includeAll?: boolean
} = {}) {
  const params = new URLSearchParams()

  if (options.includeAll) {
    params.set('chatType', 'all')
  } else {
    params.set('chatType', options.chatType ?? 'council')
  }

  if (options.targetMember) {
    params.set('targetMember', options.targetMember)
  }

  const query = params.toString()
  const path = query ? `/api/ai-council/chats?${query}` : '/api/ai-council/chats'

  return apiRequest<{ chats: AiCouncilChat[] }>(path)
}

export function createAiCouncilChat(options: {
  chatType?: AiCouncilChatType
  targetMember?: AiCouncilAiMember | null
} = {}) {
  return apiRequest<{ chat: AiCouncilChat }>('/api/ai-council/chats', {
    method: 'POST',
    body: JSON.stringify({
      chatType: options.chatType ?? 'council',
      targetMember: options.targetMember ?? null,
    }),
  })
}

export function updateAiCouncilChat(chatId: string, updates: { pinned?: boolean; status?: 'active' | 'finished' }) {
  return apiRequest<{ chat: AiCouncilChat }>(`/api/ai-council/chats/${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export function deleteAiCouncilChat(chatId: string) {
  return apiRequest<{ ok: boolean }>(`/api/ai-council/chats/${chatId}`, {
    method: 'DELETE',
  })
}

export function fetchAiCouncilMessages(chatId: string) {
  return apiRequest<{ chat: AiCouncilChat; messages: AiCouncilMessage[] }>(
    `/api/ai-council/chats/${chatId}/messages`,
  )
}

export function sendAiCouncilMessage(chatId: string, text: string) {
  return apiRequest<{ chat: AiCouncilChat; messages: AiCouncilMessage[] }>(
    `/api/ai-council/chats/${chatId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
    { timeoutMs: 120000 },
  )
}

export function runAiCouncilTurn(
  chatId: string,
  member: AiCouncilAiMember,
  options: {
    phase?: 'discussion' | 'final' | 'mention' | 'research'
    round?: number
    agreed?: boolean
    research?: boolean
    direct?: boolean
  } = {},
) {
  return apiRequest<{
    chat: AiCouncilChat
    messages: AiCouncilMessage[]
    writtenMessages?: AiCouncilMessage[]
    skipped?: boolean
    agreed?: boolean
    aiIssue?: boolean
    error?: string
    failedMember?: AiCouncilAiMember
    driveFilesRead?: number
    outcome?: string
    outcomeReason?: string | null
    outcomeByMember?: AiCouncilAiMember | null
    objectionReason?: string | null
    loopDetectedReason?: string | null
    noteToKal?: string | null
  }>(
    `/api/ai-council/chats/${chatId}/turns/${member}`,
    {
      method: 'POST',
      body: JSON.stringify(options),
    },
    { timeoutMs: 240000 },
  )
}

export function runAiCouncilSequence(chatId: string, text: string) {
  return apiRequest<{
    chat: AiCouncilChat
    messages: AiCouncilMessage[]
    writtenMessages?: AiCouncilMessage[]
    skipped?: boolean
    agreed?: boolean
    aiIssue?: boolean
    error?: string
    failedMember?: AiCouncilAiMember
    outcome?: string
    outcomeReason?: string | null
    outcomeByMember?: AiCouncilAiMember | null
    objectionReason?: string | null
    loopDetectedReason?: string | null
    noteToKal?: string | null
  }>(
    `/api/ai-council/chats/${chatId}/run`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
    { timeoutMs: 300000 },
  )
}

export function postAiCouncilModeratorNote(chatId: string, text: string) {
  return apiRequest<{ chat: AiCouncilChat; messages: AiCouncilMessage[] }>(
    `/api/ai-council/chats/${chatId}/moderator`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
  )
}

export function postAiCouncilResearchNote(chatId: string, text: string) {
  return apiRequest<{ chat: AiCouncilChat; messages: AiCouncilMessage[] }>(
    `/api/ai-council/chats/${chatId}/research-note`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
  )
}
