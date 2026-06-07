import { apiRequest } from '../api-client'

export type EmailProvider = 'google' | 'microsoft'

export type EmailSendAsAlias = {
  sendAsEmail: string
  displayName: string | null
  replyToAddress: string | null
  isPrimary: boolean
  isDefault: boolean
  treatAsAlias: boolean
  verificationStatus: string | null
  isVerified: boolean
}

export type EmailConnectionStatusResponse = {
  isConfigured: boolean
  oauthConfigHasRequiredScopes?: boolean
  oauthConfigMissingScopes?: string[]
  connected: boolean
  provider?: string
  connectedEmail?: string | null
  connectedDisplayName?: string | null
  scope?: string | null
  grantedHasRequiredScopes?: boolean
  grantedMissingScopes?: string[]
  sendAsAliases?: EmailSendAsAlias[]
  sendAsSyncedAt?: string | null
  sendAsSyncError?: string | null
  connectedAt?: string | null
  updatedAt?: string | null
  accessTokenExpiresAt?: string | null
}

export type GoogleEmailConnectionStatusResponse = EmailConnectionStatusResponse
export type MicrosoftEmailConnectionStatusResponse = EmailConnectionStatusResponse

export type GoogleSendAsAlias = EmailSendAsAlias
export type MicrosoftSendAsAlias = EmailSendAsAlias

export type EmailAuthorizeResponse = {
  authorizeUrl: string
}

export type GoogleEmailAuthorizeResponse = EmailAuthorizeResponse
export type MicrosoftEmailAuthorizeResponse = EmailAuthorizeResponse

export type SendEmailInput = {
  fromEmail?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
}

export type SendGoogleEmailInput = SendEmailInput
export type SendMicrosoftEmailInput = SendEmailInput

export type SendEmailResponse = {
  ok: boolean
  provider: string
  connectedEmail: string
  fromEmail: string
  messageId: string | null
  threadId: string | null
  sentAt: string
}

export type SendGoogleEmailResponse = SendEmailResponse
export type SendMicrosoftEmailResponse = SendEmailResponse

function withQuery(path: string, query: Record<string, string | number | null | undefined>) {
  const url = new URL(path, window.location.origin)

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    url.searchParams.set(key, String(value))
  })

  return `${url.pathname}${url.search}`
}

export function fetchGoogleEmailConnectionStatus() {
  return apiRequest<GoogleEmailConnectionStatusResponse>('/api/admin/email/google/status')
}

export function fetchMicrosoftEmailConnectionStatus() {
  return apiRequest<MicrosoftEmailConnectionStatusResponse>('/api/admin/email/microsoft/status')
}

export async function createGoogleAuthorizeUrl(redirectPath = '/admin/settings?tab=email') {
  const payload = await apiRequest<EmailAuthorizeResponse>(
    withQuery('/api/admin/email/google/oauth/start', { redirectPath }),
  )

  return payload.authorizeUrl
}

export async function createMicrosoftAuthorizeUrl(redirectPath = '/admin/settings?tab=email') {
  const payload = await apiRequest<EmailAuthorizeResponse>(
    withQuery('/api/admin/email/microsoft/oauth/start', { redirectPath }),
  )

  return payload.authorizeUrl
}

export function disconnectGoogleEmailConnection() {
  return apiRequest<{ ok: boolean, disconnected: boolean }>('/api/admin/email/google/disconnect', {
    method: 'POST',
  })
}

export function disconnectMicrosoftEmailConnection() {
  return apiRequest<{ ok: boolean, disconnected: boolean }>('/api/admin/email/microsoft/disconnect', {
    method: 'POST',
  })
}

export function sendGoogleEmail(input: SendGoogleEmailInput) {
  return apiRequest<SendGoogleEmailResponse>('/api/admin/email/google/send', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function sendMicrosoftEmail(input: SendMicrosoftEmailInput) {
  return apiRequest<SendMicrosoftEmailResponse>('/api/admin/email/microsoft/send', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
