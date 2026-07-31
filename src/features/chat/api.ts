import { apiRequest } from '../api-client'

export type AppChatType = 'direct' | 'group'

export type AppChatUser = {
  uid: string
  email: string
  displayName: string | null
  role: 'standard' | 'manager' | 'sales_rep' | 'shop_worker' | 'admin'
  isAdmin: boolean
  isManager: boolean
  isSalesRep: boolean
  isShopWorker: boolean
  isOfficeWorker: boolean
  hasWebAccess: boolean
  hasAppAccess: boolean
}

export type AppChatAttachmentKind = 'image' | 'voice'

export type AppChatAttachment = {
  kind: AppChatAttachmentKind
  mimeType: string | null
  fileName: string | null
  sizeBytes: number | null
  dataUrl: string | null
  deletedAt: string | null
  deletedByUid: string | null
  deletedByEmail: string | null
}

export type AppChatMessage = {
  id: string
  chatId: string
  text: string | null
  messageType: 'text' | 'image' | 'voice' | 'mixed' | 'deleted'
  attachment: AppChatAttachment | null
  createdAt: string | null
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
  updatedAt: string | null
  updatedByUid: string | null
  updatedByEmail: string | null
  updatedByName: string | null
  deletedAt: string | null
  deletedByUid: string | null
  deletedByEmail: string | null
}

export type AppChatThread = {
  id: string
  type: AppChatType
  name: string | null
  memberUids: string[]
  memberProfiles: AppChatUser[]
  createdAt: string | null
  updatedAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageType: AppChatMessage['messageType']
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
  pinned: boolean
}

export function fetchChatUsers() {
  return apiRequest<{ users: AppChatUser[] }>('/api/chat/users')
}

export function fetchChatThreads(type: AppChatType | 'all' = 'all') {
  const path = type === 'all'
    ? '/api/chat/threads'
    : `/api/chat/threads?type=${encodeURIComponent(type)}`

  return apiRequest<{ threads: AppChatThread[] }>(path)
}

export function createDirectChat(targetUid: string) {
  return apiRequest<{ thread: AppChatThread; created: boolean }>('/api/chat/threads/direct', {
    method: 'POST',
    body: JSON.stringify({
      targetUid,
    }),
  })
}

export function createChatGroup(input: {
  name: string
  memberUids: string[]
}) {
  return apiRequest<{ thread: AppChatThread }>('/api/chat/groups', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateChatGroup(
  threadId: string,
  input: {
    name?: string
    memberUids?: string[]
  },
) {
  return apiRequest<{ thread: AppChatThread }>(`/api/chat/groups/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function updateChatThreadPreferences(threadId: string, input: { pinned: boolean }) {
  return apiRequest<{ thread: AppChatThread }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/preferences`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
}

export function deleteChatThread(threadId: string) {
  return apiRequest<{ ok: boolean; threadId: string }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function fetchChatMessages(
  threadId: string,
  options: {
    limit?: number
    offset?: number
  } = {},
) {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 120))
  params.set('offset', String(options.offset ?? 0))

  return apiRequest<{
    thread: AppChatThread
    messages: AppChatMessage[]
    total: number
    offset: number
    limit: number
    hasMore: boolean
  }>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`)
}

export function sendChatMessage(
  threadId: string,
  input: {
    text?: string
    attachment?: {
      kind: AppChatAttachmentKind
      dataUrl?: string
      dataBase64?: string
      mimeType?: string
      fileName?: string
    }
  },
) {
  return apiRequest<{ message: AppChatMessage }>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteChatMessage(messageId: string) {
  return apiRequest<{ ok: boolean; messageId: string }>(`/api/chat/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  })
}
