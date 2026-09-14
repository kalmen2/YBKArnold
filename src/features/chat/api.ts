import type { AppAuthRole } from '../../auth/types'
import { apiRequest } from '../api-client'

export type AppChatType = 'direct' | 'group'

export type AppChatPresenceStatus = 'available' | 'do_not_disturb' | 'offline'

export type AppChatUser = {
  uid: string
  email: string
  onlineStatus: AppChatPresenceStatus
  lastSeenAt: string | null
  displayName: string | null
  imageUrl: string | null
  role: AppAuthRole
  isAdmin: boolean
  isManager: boolean
  isSalesRep: boolean
  isShopWorker: boolean
  isOfficeWorker: boolean
  hasWebAccess: boolean
  hasAppAccess: boolean
}

export type AppChatAttachmentKind = 'image' | 'voice' | 'file'

export type AppChatAttachment = {
  kind: AppChatAttachmentKind
  /** Storage URL for messages sent after attachments moved out of the database. */
  url: string | null
  storagePath: string | null
  mimeType: string | null
  fileName: string | null
  sizeBytes: number | null
  durationMillis: number | null
  dataUrl: string | null
  deletedAt: string | null
  deletedByUid: string | null
  deletedByEmail: string | null
}

export type AppChatMessageDeliveryStatus = 'sent' | 'delivered' | 'seen'

export type AppChatReaction = {
  emoji: string
  count: number
  reactedByMe: boolean
}

export type AppChatReplyTo = {
  messageId: string
  text: string | null
  messageType: AppChatMessage['messageType']
  createdByName: string | null
  createdByEmail: string | null
}

export type AppChatMessage = {
  id: string
  chatId: string
  text: string | null
  messageType: 'text' | 'image' | 'voice' | 'file' | 'mixed' | 'deleted'
  /** A task was added, taken, completed or removed. Rendered as a system line. */
  isTaskEvent?: boolean
  attachment: AppChatAttachment | null
  replyTo: AppChatReplyTo | null
  deliveryStatus: AppChatMessageDeliveryStatus
  reactions: AppChatReaction[]
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
  unreadCount: number
  activeCall: AppChatCall | null
}

export type AppChatCallMode = 'audio' | 'video'

export type AppChatCall = {
  roomName: string
  mode: AppChatCallMode
  startedAt: string | null
  startedByUid: string | null
  startedByName: string | null
  answeredAt: string | null
  callMessageId: string | null
  expiresAt: string
}

export function fetchChatUsers() {
  return apiRequest<{ users: AppChatUser[]; videoCallsEnabled?: boolean }>('/api/chat/users')
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

export function deleteChatThread(threadId: string, deleteForEveryone = false) {
  return apiRequest<{ ok: boolean; threadId: string; deletedForEveryone: boolean }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        deleteForEveryone,
      }),
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
    mentionUserUids?: string[]
    replyToMessageId?: string
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

export const CHAT_REACTION_EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'] as const

export function updateChatPresence(status: AppChatPresenceStatus) {
  return apiRequest<{ ok: boolean; status: AppChatPresenceStatus; updatedAt: string }>('/api/chat/presence', {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function setChatTyping(threadId: string, isTyping: boolean) {
  return apiRequest<{ ok: boolean; isTyping: boolean; updatedAt: string }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/typing`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isTyping }),
    },
  )
}

export function fetchChatActivity(threadId: string) {
  return apiRequest<{
    generatedAt: string
    typingUsers: { uid: string; displayName: string | null; email: string | null }[]
  }>(`/api/chat/threads/${encodeURIComponent(threadId)}/activity`)
}

export function toggleChatMessageReaction(messageId: string, emoji: string) {
  return apiRequest<{ message: AppChatMessage }>(
    `/api/chat/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      method: 'PATCH',
      body: JSON.stringify({ emoji }),
    },
  )
}

/** Starts the call, or joins the one already running in this thread. */
export function startChatCall(threadId: string, mode: AppChatCallMode) {
  return apiRequest<{
    call: AppChatCall
    created: boolean
    url: string
    token: string
  }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/call`,
    {
      method: 'POST',
      body: JSON.stringify({ mode }),
    },
  )
}

export function fetchChatCall(threadId: string) {
  return apiRequest<{ call: AppChatCall | null }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/call`,
  )
}

export function endChatCall(threadId: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/call`,
    { method: 'DELETE' },
  )
}

/** Tells the server we left, so the call clears once the room empties. */
export function leaveChatCall(threadId: string) {
  return apiRequest<{ ok: boolean; ended: boolean }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/call/leave`,
    { method: 'POST' },
  )
}

export type AppChatTask = {
  id: string
  chatId: string
  title: string
  isDone: boolean
  doneAt: string | null
  doneByUid: string | null
  doneByName: string | null
  claimedByUid: string | null
  claimedByName: string | null
  claimedAt: string | null
  createdAt: string
  createdByUid: string | null
  createdByName: string | null
}

export type AppChatTasksResponse = {
  tasks: AppChatTask[]
  /** Whether this viewer may delete tasks in this thread. Decided server-side. */
  canDelete: boolean
}

export function fetchChatTasks(threadId: string) {
  return apiRequest<AppChatTasksResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/tasks`,
  )
}

export function createChatTask(threadId: string, title: string) {
  return apiRequest<{ task: AppChatTask }>(
    `/api/chat/threads/${encodeURIComponent(threadId)}/tasks`,
    { method: 'POST', body: JSON.stringify({ title }) },
  )
}

export function updateChatTask(
  taskId: string,
  input: { isDone?: boolean; claimed?: boolean; title?: string },
) {
  return apiRequest<{ task: AppChatTask }>(
    `/api/chat/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

export function deleteChatTask(taskId: string) {
  return apiRequest<{ deletedTaskId: string }>(
    `/api/chat/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
}

export type ChatNotificationPreferences = {
  enabled: boolean
  mentions: boolean
  directMessages: boolean
  groupMessages: boolean
  taskEvents: boolean
  whenOnline: boolean
}

export function fetchChatNotificationPreferences() {
  return apiRequest<{ preferences: ChatNotificationPreferences; deliversTo: string | null }>(
    '/api/chat/notification-preferences',
  )
}

export function saveChatNotificationPreferences(preferences: ChatNotificationPreferences) {
  return apiRequest<{ preferences: ChatNotificationPreferences }>(
    '/api/chat/notification-preferences',
    { method: 'PUT', body: JSON.stringify({ preferences }) },
  )
}
