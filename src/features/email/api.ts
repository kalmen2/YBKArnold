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

export type GoogleEmailContactSuggestion = {
  email: string
  displayName: string | null
  label: string
}

export type GoogleEmailContactSuggestionsResponse = {
  suggestions: GoogleEmailContactSuggestion[]
}

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

export type EmailReviewStatus = 'pending' | 'approved' | 'rejected'
export type EmailReviewStatusFilter = EmailReviewStatus | 'all'
export type EmailReviewDestinationType = 'account' | 'order' | 'quote' | 'none'

export type EmailIntakeCandidateDestination = {
  type: EmailReviewDestinationType
  id: string
  label: string
  reason: string | null
  confidence: number | null
}

export type EmailIntakeRoutingTarget = {
  type: EmailReviewDestinationType
  id: string
  label: string
  reason: string | null
  confidence: number | null
}

export type EmailIntakePostedTarget = EmailIntakeRoutingTarget & {
  posted: boolean
  chatCollection: string | null
  chatMessageId: string | null
}

export type EmailIntakeApprovalResult = {
  posted: boolean
  destinationType: EmailReviewDestinationType
  destinationId: string | null
  chatCollection: string | null
  chatMessageId: string | null
  postedTargets?: EmailIntakePostedTarget[]
}

export type EmailIntakeSuggestion = {
  id: string
  messageId: string | null
  provider: EmailProvider
  uid: string
  connectionId: string | null
  connectedEmail: string | null
  status: EmailReviewStatus
  isRead: boolean
  direction: 'inbound' | 'outbound'
  messageDate: string | null
  fromEmail: string | null
  toEmails: string[]
  ccEmails: string[]
  subject: string | null
  snippet: string | null
  bodyPreview?: string | null
  candidateDestinations: EmailIntakeCandidateDestination[]
  routingTargets?: EmailIntakeRoutingTarget[]
  destinationType: EmailReviewDestinationType
  destinationId: string | null
  destinationReason: string | null
  confidence: number | null
  summary: string | null
  chatDraft: string | null
  tags: string[]
  reviewNotes: string | null
  approvalResult: EmailIntakeApprovalResult | null
  reviewedAt: string | null
  reviewedByUid: string | null
  reviewedByEmail: string | null
  reviewedByName: string | null
  rejectedReason: string | null
  correctionCount: number
  updatedAt: string | null
  createdAt: string | null
}

export type EmailIntakeReviewSummaryResponse = {
  pending: number
  unreadPending: number
  approved: number
  rejected: number
}

export type EmailIntakeReviewListResponse = {
  suggestions: EmailIntakeSuggestion[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type EmailIntakeSyncDetail = {
  provider: EmailProvider | null
  uid: string | null
  skipped?: boolean
  failed?: boolean
  timedOut?: boolean
  reason?: string
  error?: string
  processingStoppedReason?: string
  bootstrapped?: boolean
  rebaselined?: boolean
  lookbackDaysApplied?: number
  messagesCaught?: number
  messagesPlannedForProcessing?: number
  messagesVisitedForProcessing?: number
  lookbackMessagesCollected?: number
  messagesSkippedNoDestination?: number
  messagesSkippedByPolicy?: number
  messagesIngested: number
  suggestionsCreated: number
}

export type EmailIntakeSyncResponse = {
  startedAt: string
  completedAt: string | null
  requestedByUid: string | null
  providerFilter: EmailProvider | null
  lookbackDaysRequested?: number
  maxMessagesPerConnection?: number
  maxRuntimeMs?: number | null
  perConnectionTimeoutMs?: number | null
  scannedConnections: number
  processedConnections?: number
  succeededConnections: number
  failedConnections: number
  skippedConnections: number
  truncated?: boolean
  truncationReason?: string | null
  messagesCaught?: number
  messagesIngested: number
  suggestionsCreated: number
  details: EmailIntakeSyncDetail[]
}

export type EmailIntakeSyncRunStatus = 'queued' | 'running' | 'completed' | 'failed'

export type EmailIntakeSyncRun = {
  id: string | null
  status: EmailIntakeSyncRunStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  requestedByUid: string | null
  providerFilter: EmailProvider | null
  lookbackDaysRequested: number
  maxMessagesPerConnection: number
  maxRuntimeMs: number | null
  perConnectionTimeoutMs: number | null
  scannedConnections: number
  processedConnections: number
  succeededConnections: number
  failedConnections: number
  skippedConnections: number
  truncated: boolean
  truncationReason: string | null
  messagesCaught: number
  messagesIngested: number
  suggestionsCreated: number
  logSequence: number
  details: EmailIntakeSyncDetail[]
}

export type EmailIntakeSyncRunLogLevel = 'info' | 'warn' | 'error'

export type EmailIntakeSyncRunLogEntry = {
  sequence: number
  level: EmailIntakeSyncRunLogLevel
  at: string
  message: string
  data: Record<string, unknown> | null
}

export type EmailIntakeSyncRunResponse = {
  run: EmailIntakeSyncRun
}

export type EmailIntakeSyncRunStepResponse = {
  run: EmailIntakeSyncRun
  logs: EmailIntakeSyncRunLogEntry[]
}

export type EmailIntakeSyncRunLogsResponse = {
  runId: string | null
  logSequence: number
  logs: EmailIntakeSyncRunLogEntry[]
}

export type RunEmailIntakeSyncInput = {
  provider?: EmailProvider
  includeAllConnections?: boolean
  maxConnections?: number
  lookbackDays?: number
  maxMessagesPerConnection?: number
}

export type UpdateEmailIntakeSuggestionInput = {
  destinationType?: EmailReviewDestinationType
  destinationId?: string
  summary?: string
  chatDraft?: string
  reviewNotes?: string
}

export type ResetEmailIntakeReviewInput = {
  scope?: 'actor' | 'all-connections'
}

export type ResetEmailIntakeReviewResponse = {
  ok: boolean
  scope: 'actor' | 'all-connections'
  resetAt: string
  deleted: {
    feedback: number
    suggestions: number
    messages: number
    syncStates: number
  }
}

export type ApproveEmailIntakeSuggestionInput = {
  destinationType?: EmailReviewDestinationType
  destinationId?: string
  summary?: string
  chatDraft?: string
  reviewNotes?: string
}

export type ApproveAllEmailIntakeSuggestionsInput = ApproveEmailIntakeSuggestionInput & {
  provider?: EmailProvider
  limit?: number
}

export type ApproveAllEmailIntakeSuggestionsResponse = {
  ok: boolean
  processed: number
  approved: number
  failed: number
  errors: Array<{ suggestionId: string | null, message: string }>
}

export type CorrectEmailIntakeSuggestionInput = {
  reason: string
  correctedDestinationType: EmailReviewDestinationType
  correctedDestinationId?: string
  correctedSummary?: string
  correctedChatDraft?: string
}

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

export function searchGoogleEmailContacts(query: string, limit = 12) {
  return apiRequest<GoogleEmailContactSuggestionsResponse>(
    withQuery('/api/admin/email/google/contacts/search', { q: query, limit }),
  )
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

export function fetchEmailIntakeReviewSummary() {
  return apiRequest<EmailIntakeReviewSummaryResponse>('/api/admin/email/review/summary')
}

export function fetchEmailIntakeSuggestions(
  input: {
    status?: EmailReviewStatusFilter
    provider?: EmailProvider | 'all'
    limit?: number
    offset?: number
  } = {},
) {
  const status = input.status ?? 'pending'
  const provider = input.provider ?? 'all'
  const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 40
  const offset = Number.isFinite(Number(input.offset)) ? Number(input.offset) : 0

  return apiRequest<EmailIntakeReviewListResponse>(
    withQuery('/api/admin/email/review', {
      status,
      provider: provider === 'all' ? null : provider,
      limit,
      offset,
    }),
  )
}

export function runEmailIntakeSync(input: RunEmailIntakeSyncInput = {}) {
  return apiRequest<EmailIntakeSyncResponse>('/api/admin/email/review/sync', {
    method: 'POST',
    body: JSON.stringify(input),
  }, {
    timeoutMs: 58 * 1000,
  })
}

export function startEmailIntakeSyncRun(input: RunEmailIntakeSyncInput = {}) {
  return apiRequest<EmailIntakeSyncRunStepResponse>('/api/admin/email/review/sync-runs/start', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchEmailIntakeSyncRun(runId: string) {
  return apiRequest<EmailIntakeSyncRunResponse>(`/api/admin/email/review/sync-runs/${encodeURIComponent(runId)}`)
}

export function stepEmailIntakeSyncRun(runId: string) {
  return apiRequest<EmailIntakeSyncRunStepResponse>(`/api/admin/email/review/sync-runs/${encodeURIComponent(runId)}/step`, {
    method: 'POST',
  }, {
    timeoutMs: 58 * 1000,
  })
}

export function fetchEmailIntakeSyncRunLogs(
  runId: string,
  input: { afterSequence?: number, limit?: number } = {},
) {
  const afterSequence = Number.isFinite(Number(input.afterSequence))
    ? Number(input.afterSequence)
    : 0
  const limit = Number.isFinite(Number(input.limit))
    ? Number(input.limit)
    : 120

  return apiRequest<EmailIntakeSyncRunLogsResponse>(
    withQuery(`/api/admin/email/review/sync-runs/${encodeURIComponent(runId)}/logs`, {
      afterSequence,
      limit,
    }),
  )
}

export function resetEmailIntakeReviewData(input: ResetEmailIntakeReviewInput = {}) {
  return apiRequest<ResetEmailIntakeReviewResponse>('/api/admin/email/review/reset', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function markEmailIntakeSuggestionRead(suggestionId: string) {
  return apiRequest<{ ok: boolean, suggestionId: string }>(`/api/admin/email/review/${encodeURIComponent(suggestionId)}/mark-read`, {
    method: 'POST',
  })
}

export function approveEmailIntakeSuggestion(
  suggestionId: string,
  input: ApproveEmailIntakeSuggestionInput = {},
) {
  return apiRequest<{ alreadyApproved: boolean, suggestion: EmailIntakeSuggestion }>(`/api/admin/email/review/${encodeURIComponent(suggestionId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateEmailIntakeSuggestion(
  suggestionId: string,
  input: UpdateEmailIntakeSuggestionInput = {},
) {
  return apiRequest<{ ok: boolean, suggestion: EmailIntakeSuggestion }>(`/api/admin/email/review/${encodeURIComponent(suggestionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function approveAllEmailIntakeSuggestions(input: ApproveAllEmailIntakeSuggestionsInput = {}) {
  return apiRequest<ApproveAllEmailIntakeSuggestionsResponse>('/api/admin/email/review/approve-all', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function rejectEmailIntakeSuggestion(suggestionId: string, reason: string) {
  return apiRequest<{ ok: boolean, suggestionId: string }>(`/api/admin/email/review/${encodeURIComponent(suggestionId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function correctEmailIntakeSuggestion(
  suggestionId: string,
  input: CorrectEmailIntakeSuggestionInput,
) {
  return apiRequest<{
    ok: boolean
    feedback: {
      id: string
      suggestionId: string
      type: string
      reason: string
      correctedDestinationType: EmailReviewDestinationType
      correctedDestinationId: string | null
      createdAt: string
    }
  }>(`/api/admin/email/review/${encodeURIComponent(suggestionId)}/correct`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
