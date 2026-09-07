// Shared formatting and labelling for the worker chat. Kept apart from the
// components so the sidebar, the header and the details panel all describe a
// thread the same way.
import type { AppChatMessage, AppChatPresenceStatus, AppChatThread, AppChatUser } from './api'

export const CHAT_MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

export function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

export function resolveUserLabel(user: Pick<AppChatUser, 'displayName' | 'email'> | null | undefined) {
  if (!user) {
    return 'Teammate'
  }

  return String(user.displayName ?? '').trim() || user.email
}

export function resolveInitials(value: string | null | undefined) {
  const words = String(value ?? '')
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) {
    return '?'
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

// Stable per-person tint so the same teammate always reads the same colour in
// the list, the header and the message rows.
const avatarPalette = [
  '#1f6feb',
  '#1ba89a',
  '#7c5cff',
  '#e2683c',
  '#c2417f',
  '#0f8f6f',
  '#3f6ad8',
  '#a2650f',
]

export function avatarColorFromKey(key: string | null | undefined) {
  const normalized = String(key ?? '').trim().toLowerCase()

  if (!normalized) {
    return avatarPalette[0]
  }

  let hash = 0

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 100_000
  }

  return avatarPalette[hash % avatarPalette.length]
}

export function formatChatTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ''))

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function formatChatListTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ''))

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  const moment = new Date(timestamp)
  const now = new Date()
  const isSameDay = moment.toDateString() === now.toDateString()

  if (isSameDay) {
    return formatChatTime(value)
  }

  const dayMillis = 24 * 60 * 60 * 1000

  if (now.getTime() - timestamp < 7 * dayMillis) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(moment)
  }

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(moment)
}

export function formatChatDayLabel(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ''))

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  const moment = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  if (moment.toDateString() === today.toDateString()) {
    return 'Today'
  }

  if (moment.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(moment)
}

export function formatLastSeen(user: AppChatUser | null | undefined) {
  if (!user) {
    return ''
  }

  if (user.onlineStatus === 'available') {
    return 'Online now'
  }

  if (user.onlineStatus === 'do_not_disturb') {
    return 'Do not disturb'
  }

  const timestamp = Date.parse(String(user.lastSeenAt ?? ''))

  if (!Number.isFinite(timestamp)) {
    return 'Offline'
  }

  const minutes = Math.round((Date.now() - timestamp) / 60_000)

  if (minutes < 1) {
    return 'Last seen just now'
  }

  if (minutes < 60) {
    return `Last seen ${minutes}m ago`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 24) {
    return `Last seen ${hours}h ago`
  }

  return `Last seen ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))}`
}

export const chatPresenceLabels: Record<AppChatPresenceStatus, string> = {
  available: 'Available',
  do_not_disturb: 'Do not disturb',
  offline: 'Appear offline',
}

export function findThreadPeer(thread: AppChatThread | null, currentUid: string) {
  if (!thread || thread.type === 'group') {
    return null
  }

  return thread.memberProfiles.find((member) => member.uid !== currentUid)
    ?? thread.memberProfiles[0]
    ?? null
}

export function buildThreadTitle(thread: AppChatThread, currentUid: string) {
  if (thread.type === 'group') {
    return thread.name || 'Group chat'
  }

  const peer = findThreadPeer(thread, currentUid)

  return peer ? resolveUserLabel(peer) : 'Direct chat'
}

export function buildThreadSubtitle(thread: AppChatThread, currentUid: string) {
  if (thread.type === 'group') {
    return `${thread.memberUids.length} members`
  }

  const peer = findThreadPeer(thread, currentUid)

  return peer ? formatLastSeen(peer) : 'Direct thread'
}

export function buildMessagePreview(message: Pick<AppChatMessage, 'text' | 'messageType'> | null) {
  if (!message) {
    return ''
  }

  if (message.messageType === 'deleted') {
    return 'Message deleted'
  }

  const text = String(message.text ?? '').trim()

  if (text) {
    return text
  }

  if (message.messageType === 'image') {
    return 'Photo'
  }

  if (message.messageType === 'voice') {
    return 'Voice note'
  }

  if (message.messageType === 'file') {
    return 'File'
  }

  return ''
}

export function isMyMessage(message: AppChatMessage, currentUid: string, currentEmail: string) {
  return Boolean(
    (message.createdByUid && message.createdByUid === currentUid)
    || (message.createdByEmail && normalizeEmail(message.createdByEmail) === currentEmail),
  )
}

export function canDeleteMessage(
  message: AppChatMessage,
  currentUid: string,
  currentEmail: string,
  isAdmin: boolean,
) {
  if (isAdmin) {
    return true
  }

  return isMyMessage(message, currentUid, currentEmail)
}

export function formatAttachmentSize(sizeBytes: number | null | undefined) {
  const size = Number(sizeBytes)

  if (!Number.isFinite(size) || size <= 0) {
    return ''
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function extractMentionUids(markup: string) {
  return [...new Set(
    Array.from(String(markup ?? '').matchAll(/@\[[^\]]+\]\(([^)]+)\)/g))
      .map((entry) => String(entry[1] ?? '').trim())
      .filter(Boolean),
  )]
}

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result

      if (typeof result === 'string') {
        resolve(result)
        return
      }

      reject(new Error('Unable to read the selected file.'))
    }

    reader.onerror = () => {
      reject(new Error('Unable to read the selected file.'))
    }

    reader.readAsDataURL(file)
  })
}

// New messages carry a Storage url; older ones still carry an inline data url.
// Everything that renders an attachment goes through here so neither form
// needs special-casing at the call site.
export function resolveAttachmentSrc(
  attachment: { url?: string | null; dataUrl?: string | null } | null | undefined,
) {
  return String(attachment?.url ?? '').trim() || String(attachment?.dataUrl ?? '').trim() || ''
}
