import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RuleRoundedIcon from '@mui/icons-material/RuleRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import DOMPurify from 'dompurify'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  approveAllEmailIntakeSuggestions,
  approveEmailIntakeSuggestion,
  fetchEmailIntakeReviewSummary,
  fetchEmailIntakeSuggestions,
  fetchEmailIntakeSyncRunLogs,
  markEmailIntakeSuggestionRead,
  rejectEmailIntakeSuggestion,
  resetEmailIntakeReviewData,
  startEmailIntakeSyncRun,
  stepEmailIntakeSyncRun,
  type EmailIntakeReviewLane,
  type EmailIntakeSuggestion,
  type EmailIntakeSyncRun,
  type EmailIntakeSyncRunLogEntry,
  type EmailProvider,
  type EmailReviewDestinationType,
  type EmailReviewStatus,
  type EmailReviewStatusFilter,
  updateEmailIntakeSuggestion,
} from '../features/email/api'
import { formatDateTime, formatOptional } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type ProviderFilter = EmailProvider | 'all'
type ReviewDialogTab = 'overview' | 'review' | 'email'

type SuggestionDraft = {
  destinationType: EmailReviewDestinationType
  destinationId: string
  summary: string
  chatDraft: string
  reviewNotes: string
  rejectReason: string
}

const suggestionPageLimit = 40
const reviewSureMatchConfidenceThreshold = 0.8

const laneOrder: EmailIntakeReviewLane[] = ['green', 'yellow', 'red']

const laneMeta: Record<EmailIntakeReviewLane, {
  label: string
  description: string
  chipColor: 'success' | 'warning' | 'error'
  backgroundColor: string
  borderColor: string
}> = {
  green: {
    label: 'Green',
    description: 'Sure match found with high confidence.',
    chipColor: 'success',
    backgroundColor: '#edf7ed',
    borderColor: '#a5d6a7',
  },
  yellow: {
    label: 'Yellow',
    description: 'Possible or semi match. Needs review.',
    chipColor: 'warning',
    backgroundColor: '#fff8e1',
    borderColor: '#ffe082',
  },
  red: {
    label: 'Red',
    description: 'No valid match found.',
    chipColor: 'error',
    backgroundColor: '#ffebee',
    borderColor: '#ef9a9a',
  },
}

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function resolveBrowserTimeZone() {
  try {
    return String(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '').trim()
  } catch {
    return ''
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  const statusCode = Number(
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : Number.NaN,
  )
  const message = error instanceof Error ? error.message : fallback

  if (
    statusCode === 502
    || /<!doctype html>|error 502|bad gateway|temporary error/i.test(message)
  ) {
    return 'Mailbox sync timed out at the gateway (502). Please run Sync again; partial work may already be saved.'
  }

  return message
}

function resolveStatusChipColor(
  status: EmailReviewStatus,
): 'default' | 'warning' | 'success' | 'error' {
  if (status === 'approved') {
    return 'success'
  }

  if (status === 'rejected') {
    return 'error'
  }

  return 'warning'
}

function resolveDirectionChipColor(
  direction: 'inbound' | 'outbound',
): 'default' | 'primary' | 'secondary' {
  return direction === 'outbound' ? 'secondary' : 'primary'
}

function formatConfidence(confidence: number | null | undefined) {
  if (!Number.isFinite(confidence)) {
    return 'n/a'
  }

  return `${Math.round(Number(confidence) * 100)}%`
}

function formatStatusLabel(status: EmailReviewStatus) {
  if (status === 'approved') {
    return 'Approved'
  }

  if (status === 'rejected') {
    return 'Rejected'
  }

  return 'Pending'
}

function formatDestinationTypeLabel(type: EmailReviewDestinationType) {
  if (type === 'quote') {
    return 'Quote'
  }

  if (type === 'order') {
    return 'Order'
  }

  if (type === 'account') {
    return 'Account'
  }

  return 'None'
}

function formatCandidateReference(
  candidate: { id: string, label: string } | null | undefined,
  fallbackLabel: string,
) {
  if (!candidate?.id && !candidate?.label) {
    return fallbackLabel
  }

  const id = String(candidate?.id ?? '').trim()
  const label = String(candidate?.label ?? '').trim()

  if (label && id && label.toLowerCase() !== id.toLowerCase()) {
    return `${label} (${id})`
  }

  return label || id || fallbackLabel
}

function resolveSuggestionRoutingTargets(suggestion: EmailIntakeSuggestion | null | undefined) {
  const explicitTargets = Array.isArray(suggestion?.routingTargets)
    ? suggestion.routingTargets
      .map((target) => {
        const type = String(target?.type ?? '').trim().toLowerCase()
        const id = String(target?.id ?? '').trim()

        if (!id || (type !== 'account' && type !== 'order' && type !== 'quote')) {
          return null
        }

        return {
          type,
          id,
          label: String(target?.label ?? '').trim() || id,
        }
      })
      .filter((target): target is { type: string, id: string, label: string } => Boolean(target))
    : []

  if (explicitTargets.length > 0) {
    return explicitTargets
  }

  const destinationType = String(suggestion?.destinationType ?? '').trim().toLowerCase()
  const destinationId = String(suggestion?.destinationId ?? '').trim()

  if (!destinationId || (destinationType !== 'account' && destinationType !== 'order' && destinationType !== 'quote')) {
    return []
  }

  const destinationCandidate = (Array.isArray(suggestion?.candidateDestinations)
    ? suggestion.candidateDestinations
    : []).find((candidate) => (
    candidate.type === destinationType
    && candidate.id === destinationId
  ))

  return [{
    type: destinationType,
    id: destinationId,
    label: String(destinationCandidate?.label ?? destinationId).trim() || destinationId,
  }]
}

function formatRoutingTargetsLabel(targets: Array<{ type: string, label: string, id: string }>) {
  if (targets.length === 0) {
    return 'None'
  }

  return targets
    .map((target) => `${formatDestinationTypeLabel(target.type as EmailReviewDestinationType)}: ${formatCandidateReference({ id: target.id, label: target.label }, target.id)}`)
    .join(' + ')
}

function buildSuggestionDraft(suggestion: EmailIntakeSuggestion): SuggestionDraft {
  return {
    destinationType: suggestion.destinationType ?? 'none',
    destinationId: suggestion.destinationId ?? '',
    summary: suggestion.summary ?? '',
    chatDraft: suggestion.chatDraft ?? suggestion.summary ?? '',
    reviewNotes: suggestion.reviewNotes ?? '',
    rejectReason: '',
  }
}

function trimToOptional(value: string) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : undefined
}

function resolveSuggestionSortTimestamp(suggestion: EmailIntakeSuggestion) {
  const candidates = [
    suggestion.messageDate,
    suggestion.createdAt,
    suggestion.updatedAt,
  ]

  for (const candidate of candidates) {
    const parsedMs = Date.parse(String(candidate ?? ''))

    if (Number.isFinite(parsedMs)) {
      return parsedMs
    }
  }

  return 0
}

function resolveSuggestionLane(suggestion: EmailIntakeSuggestion): EmailIntakeReviewLane {
  const explicitLane = String(suggestion.lane ?? '').trim().toLowerCase()

  if (explicitLane === 'green' || explicitLane === 'yellow' || explicitLane === 'red') {
    return explicitLane as EmailIntakeReviewLane
  }

  const destinationType = String(suggestion.destinationType ?? '').trim().toLowerCase()
  const destinationId = String(suggestion.destinationId ?? '').trim()
  const hasDestinationMatch = (
    destinationType === 'account'
    || destinationType === 'order'
    || destinationType === 'quote'
  ) && Boolean(destinationId)

  if (!hasDestinationMatch) {
    return 'red'
  }

  const confidence = Number(suggestion.confidence)
  const hasConfidence = Number.isFinite(confidence)

  if (
    hasConfidence
    && confidence >= reviewSureMatchConfidenceThreshold
    && !suggestion.usedFallback
  ) {
    return 'green'
  }

  return 'yellow'
}

export default function AdminEmailReviewPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<EmailReviewStatusFilter>('pending')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  const [syncDate, setSyncDate] = useState(todayIsoDate())
  const [offset, setOffset] = useState(0)
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null)
  const [reviewDialogTab, setReviewDialogTab] = useState<ReviewDialogTab>('overview')
  const [showConversationBody, setShowConversationBody] = useState(false)
  const [draftBySuggestionId, setDraftBySuggestionId] = useState<Record<string, SuggestionDraft>>({})
  const [processingActionKeys, setProcessingActionKeys] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [activeSyncRun, setActiveSyncRun] = useState<EmailIntakeSyncRun | null>(null)
  const [syncRunLogs, setSyncRunLogs] = useState<EmailIntakeSyncRunLogEntry[]>([])
  const [isSyncLogsDialogOpen, setIsSyncLogsDialogOpen] = useState(false)
  const reviewTimeZone = useMemo(() => {
    const browserTimeZone = resolveBrowserTimeZone()

    if (browserTimeZone) {
      return browserTimeZone
    }

    const configuredTimeZone = String(appUser?.accessTimeZone ?? '').trim()

    return configuredTimeZone || 'UTC'
  }, [appUser?.accessTimeZone])

  useEffect(() => {
    setOffset(0)
  }, [providerFilter, statusFilter, syncDate, reviewTimeZone])

  const reviewSummaryQuery = useQuery({
    queryKey: [...QUERY_KEYS.adminEmailReviewSummary, statusFilter, providerFilter, syncDate, reviewTimeZone],
    queryFn: () => fetchEmailIntakeReviewSummary({
      status: statusFilter,
      provider: providerFilter,
      messageDate: syncDate,
      timeZone: reviewTimeZone,
    }),
    staleTime: 20 * 1000,
    enabled: appUser?.isAdmin === true,
  })

  const reviewListQuery = useQuery({
    queryKey: [
      ...QUERY_KEYS.adminEmailReviewList(
        statusFilter,
        providerFilter,
        suggestionPageLimit,
        offset,
      ),
      syncDate,
      reviewTimeZone,
    ],
    queryFn: () => fetchEmailIntakeSuggestions({
      status: statusFilter,
      provider: providerFilter,
      messageDate: syncDate,
      timeZone: reviewTimeZone,
      limit: suggestionPageLimit,
      offset,
    }),
    staleTime: 20 * 1000,
    enabled: appUser?.isAdmin === true,
  })

  const listPayload = reviewListQuery.data
  const suggestions = listPayload?.suggestions ?? []
  const totalSuggestions = Number(listPayload?.total ?? 0)
  const hasMore = Boolean(listPayload?.hasMore)

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((left, right) => {
      const byTimestamp = resolveSuggestionSortTimestamp(right) - resolveSuggestionSortTimestamp(left)

      if (byTimestamp !== 0) {
        return byTimestamp
      }

      return String(right.id ?? '').localeCompare(String(left.id ?? ''))
    })
  }, [suggestions])

  const suggestionsByLane = useMemo(() => {
    const grouped: Record<EmailIntakeReviewLane, EmailIntakeSuggestion[]> = {
      green: [],
      yellow: [],
      red: [],
    }

    sortedSuggestions.forEach((suggestion) => {
      grouped[resolveSuggestionLane(suggestion)].push(suggestion)
    })

    return grouped
  }, [sortedSuggestions])

  useEffect(() => {
    if (!selectedSuggestionId) {
      return
    }

    const selectedStillExists = sortedSuggestions.some((suggestion) => suggestion.id === selectedSuggestionId)

    if (!selectedStillExists) {
      setSelectedSuggestionId(null)
      setReviewDialogTab('overview')
    }
  }, [selectedSuggestionId, sortedSuggestions])

  useEffect(() => {
    setShowConversationBody(false)
  }, [selectedSuggestionId])

  const selectedSuggestion = selectedSuggestionId
    ? sortedSuggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null
    : null
  const selectedDraft = selectedSuggestion
    ? (draftBySuggestionId[selectedSuggestion.id] ?? buildSuggestionDraft(selectedSuggestion))
    : null

  const selectedDestinationCandidate = selectedSuggestion?.candidateDestinations.find((candidate) => (
    candidate.type === selectedSuggestion.destinationType
    && candidate.id === selectedSuggestion.destinationId
  ))
  const selectedDestinationLabel = selectedSuggestion
    ? formatCandidateReference(
      selectedDestinationCandidate
        ? {
          id: selectedDestinationCandidate.id,
          label: selectedDestinationCandidate.label,
        }
        : selectedSuggestion.destinationId
          ? {
            id: selectedSuggestion.destinationId,
            label: selectedSuggestion.destinationId,
          }
          : null,
      'None',
    )
    : 'None'
  const selectedRoutingTargets = resolveSuggestionRoutingTargets(selectedSuggestion)
  const selectedAdditionalRoutingTargets = selectedRoutingTargets.filter((target) => !(
    String(target.type).toLowerCase() === String(selectedSuggestion?.destinationType ?? '').toLowerCase()
    && String(target.id) === String(selectedSuggestion?.destinationId ?? '')
  ))

  const selectedSanitizedEmailHtml = useMemo(() => {
    const rawHtml = String(selectedSuggestion?.bodyHtml ?? '').trim()

    if (!rawHtml) {
      return null
    }

    const sanitizedBodyHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    })

    if (!sanitizedBodyHtml) {
      return null
    }

    return [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<style>body{margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1a1a;} img{max-width:100%;height:auto;} table{max-width:100%;}</style>',
      '</head>',
      '<body>',
      sanitizedBodyHtml,
      '</body>',
      '</html>',
    ].join('')
  }, [selectedSuggestion?.bodyHtml])

  const selectedConversationBodyText = String(selectedSuggestion?.conversationBodyText ?? '').trim()
  const selectedConversationMessageCount = Number(selectedSuggestion?.conversationMessageCount ?? 0)
  const canShowConversationBody = selectedConversationMessageCount > 1 && selectedConversationBodyText.length > 0
  const selectedEmailBodyMode = showConversationBody && canShowConversationBody
    ? 'conversation'
    : 'single'

  const selectedPlainEmailBody = selectedEmailBodyMode === 'conversation'
    ? selectedConversationBodyText
    : (
      selectedSuggestion?.bodyText
      || selectedSuggestion?.bodyPreview
      || selectedSuggestion?.snippet
      || 'No email text available.'
    )

  const invalidateReviewQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminEmailReviewSummary })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'email', 'review'] })
  }, [queryClient])

  const makeActionKey = useCallback((action: string, suggestionId: string) => {
    return `${action}:${suggestionId}`
  }, [])

  const isActionProcessing = useCallback((action: string, suggestionId: string) => {
    return processingActionKeys.includes(makeActionKey(action, suggestionId))
  }, [makeActionKey, processingActionKeys])

  const setActionProcessing = useCallback((
    action: string,
    suggestionId: string,
    isProcessing: boolean,
  ) => {
    const actionKey = makeActionKey(action, suggestionId)

    setProcessingActionKeys((current) => {
      if (isProcessing) {
        return current.includes(actionKey)
          ? current
          : [...current, actionKey]
      }

      return current.filter((entry) => entry !== actionKey)
    })
  }, [makeActionKey])

  const appendSyncLogs = useCallback((logs: EmailIntakeSyncRunLogEntry[] | null | undefined) => {
    if (!Array.isArray(logs) || logs.length === 0) {
      return
    }

    setSyncRunLogs((current) => {
      const mergedBySequence = new Map<number, EmailIntakeSyncRunLogEntry>()

      current.forEach((entry) => {
        mergedBySequence.set(Number(entry.sequence), entry)
      })

      logs.forEach((entry) => {
        const sequence = Number(entry?.sequence)

        if (!Number.isFinite(sequence)) {
          return
        }

        mergedBySequence.set(sequence, entry)
      })

      return [...mergedBySequence.values()]
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))
        .slice(-600)
    })
  }, [])

  const latestSyncRunLogSequence = syncRunLogs.length > 0
    ? Number(syncRunLogs[syncRunLogs.length - 1]?.sequence ?? 0)
    : 0

  const syncMutation = useMutation({
    mutationFn: async () => {
      const startPayload = await startEmailIntakeSyncRun({
        provider: providerFilter === 'all' ? undefined : providerFilter,
        includeAllConnections: true,
        maxConnections: 120,
        maxMessagesPerConnection: 400,
        syncDate,
        timeZone: reviewTimeZone,
      })
      const startedRun = startPayload?.run ?? null
      const runId = String(startedRun?.id ?? '').trim()

      setActiveSyncRun(startedRun)
      appendSyncLogs(startPayload?.logs)

      if (!runId) {
        throw new Error('Mailbox sync could not start.')
      }

      let currentRun = startedRun
      let stepCount = 0

      while (currentRun && (currentRun.status === 'queued' || currentRun.status === 'running')) {
        stepCount += 1

        if (stepCount > 600) {
          throw new Error('Mailbox sync step limit exceeded. Please run Sync again.')
        }

        const stepPayload = await stepEmailIntakeSyncRun(runId)

        currentRun = stepPayload?.run ?? currentRun
        setActiveSyncRun(currentRun)
        appendSyncLogs(stepPayload?.logs)
      }

      return currentRun
    },
    onMutate: () => {
      setErrorMessage(null)
      setSuccessMessage(null)
      setActiveSyncRun(null)
      setSyncRunLogs([])
      setIsSyncLogsDialogOpen(true)
    },
    onSuccess: (summary) => {
      const details = Array.isArray(summary?.details) ? summary.details : []
      const messagesCaught = Number(
        summary?.messagesCaught
        ?? details.reduce((sum, detail) => sum + Number(detail?.messagesCaught ?? detail?.lookbackMessagesCollected ?? 0), 0),
      )
      const timedOutConnections = details.filter((detail) => Boolean(detail?.timedOut)).length
      const processedConnections = Number(summary?.processedConnections ?? summary?.scannedConnections ?? 0)
      const syncDateLabel = summary?.syncDateRequested || syncDate
      const truncationHint = summary?.truncated
        ? ` ${String(summary?.truncationReason ?? 'Sync returned partial results due to runtime budget.')}`
        : ''
      const timeoutHint = timedOutConnections > 0
        ? ` ${timedOutConnections} mailbox(es) timed out before finishing, and partial progress was saved.`
        : ''

      setErrorMessage(null)
      setSuccessMessage(
        `Mailbox sync finished for ${syncDateLabel}. Connections scanned: ${summary.scannedConnections}. Connections processed: ${processedConnections}. Emails caught: ${messagesCaught}. Messages ingested: ${summary.messagesIngested}. Suggestions created: ${summary.suggestionsCreated}.${timeoutHint}${truncationHint}`,
      )
      invalidateReviewQueries()
    },
    onError: async (error) => {
      const runId = String(activeSyncRun?.id ?? '').trim()

      if (runId) {
        try {
          const logPayload = await fetchEmailIntakeSyncRunLogs(runId, {
            afterSequence: latestSyncRunLogSequence,
            limit: 300,
          })

          appendSyncLogs(logPayload?.logs)
        } catch {
          // Ignore log refresh errors after primary failure.
        }
      }

      setErrorMessage(`${toErrorMessage(error, 'Manual mailbox sync failed.')} Use See Logs for details.`)
      setSuccessMessage(null)
      invalidateReviewQueries()
    },
  })

  const syncButtonLabel = useMemo(() => {
    if (!syncMutation.isPending) {
      return 'Sync Selected Day'
    }

    const scannedConnections = Number(activeSyncRun?.scannedConnections ?? 0)
    const processedConnections = Number(activeSyncRun?.processedConnections ?? 0)

    if (scannedConnections <= 0) {
      return 'Syncing...'
    }

    return `Sync ${Math.min(processedConnections, scannedConnections)} of ${scannedConnections}`
  }, [activeSyncRun?.processedConnections, activeSyncRun?.scannedConnections, syncMutation.isPending])

  const approveAllMutation = useMutation({
    mutationFn: () => approveAllEmailIntakeSuggestions({
      provider: providerFilter === 'all' ? undefined : providerFilter,
      limit: 120,
    }),
    onSuccess: (payload) => {
      setErrorMessage(null)
      setSuccessMessage(
        `Approve-all completed. Processed: ${payload.processed}. Approved: ${payload.approved}. Failed: ${payload.failed}.`,
      )
      invalidateReviewQueries()
    },
    onError: (error) => {
      setErrorMessage(toErrorMessage(error, 'Approve-all failed.'))
      setSuccessMessage(null)
    },
  })

  const resetQueueMutation = useMutation({
    mutationFn: () => resetEmailIntakeReviewData({
      scope: 'all-connections',
    }),
    onSuccess: (payload) => {
      setErrorMessage(null)
      setSuccessMessage(
        `Review queue reset completed. Deleted: suggestions ${payload.deleted.suggestions}, messages ${payload.deleted.messages}, feedback ${payload.deleted.feedback}, sync states ${payload.deleted.syncStates}.`,
      )
      setSelectedSuggestionId(null)
      setDraftBySuggestionId({})
      invalidateReviewQueries()
    },
    onError: (error) => {
      setErrorMessage(toErrorMessage(error, 'Queue reset failed.'))
      setSuccessMessage(null)
    },
  })

  const handleOpenSyncLogs = useCallback(async () => {
    const runId = String(activeSyncRun?.id ?? '').trim()

    if (runId) {
      try {
        const logPayload = await fetchEmailIntakeSyncRunLogs(runId, {
          afterSequence: latestSyncRunLogSequence,
          limit: 300,
        })

        appendSyncLogs(logPayload?.logs)
      } catch {
        // Keep showing existing logs if refresh fails.
      }
    }

    setIsSyncLogsDialogOpen(true)
  }, [activeSyncRun?.id, appendSyncLogs, latestSyncRunLogSequence])

  useEffect(() => {
    if (!isSyncLogsDialogOpen || !syncMutation.isPending) {
      return
    }

    const runId = String(activeSyncRun?.id ?? '').trim()

    if (!runId) {
      return
    }

    let disposed = false
    let inFlight = false

    const refreshLogs = async () => {
      if (disposed || inFlight) {
        return
      }

      inFlight = true

      try {
        const payload = await fetchEmailIntakeSyncRunLogs(runId, {
          afterSequence: latestSyncRunLogSequence,
          limit: 200,
        })

        if (!disposed) {
          appendSyncLogs(payload?.logs)
        }
      } catch {
        // Ignore transient polling failures while sync is active.
      } finally {
        inFlight = false
      }
    }

    void refreshLogs()

    const intervalId = window.setInterval(() => {
      void refreshLogs()
    }, 1500)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
    }
  }, [
    activeSyncRun?.id,
    appendSyncLogs,
    isSyncLogsDialogOpen,
    latestSyncRunLogSequence,
    syncMutation.isPending,
  ])

  const resolveDraft = useCallback((suggestion: EmailIntakeSuggestion) => {
    return draftBySuggestionId[suggestion.id] ?? buildSuggestionDraft(suggestion)
  }, [draftBySuggestionId])

  const updateDraft = useCallback((suggestionId: string, patch: Partial<SuggestionDraft>) => {
    setDraftBySuggestionId((current) => ({
      ...current,
      [suggestionId]: {
        ...(current[suggestionId] ?? {
          destinationType: 'none',
          destinationId: '',
          summary: '',
          chatDraft: '',
          reviewNotes: '',
          rejectReason: '',
        }),
        ...patch,
      },
    }))
  }, [])

  const handleApprove = useCallback(async (suggestion: EmailIntakeSuggestion) => {
    const suggestionId = suggestion.id
    const draft = resolveDraft(suggestion)

    if (draft.destinationType !== 'none' && !trimToOptional(draft.destinationId)) {
      setErrorMessage('Destination ID is required when destination type is account, order, or quote.')
      setSuccessMessage(null)
      return
    }

    setActionProcessing('approve', suggestionId, true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await approveEmailIntakeSuggestion(suggestionId, {
        destinationType: draft.destinationType,
        destinationId: trimToOptional(draft.destinationId),
        summary: trimToOptional(draft.summary),
        chatDraft: trimToOptional(draft.chatDraft),
        reviewNotes: trimToOptional(draft.reviewNotes),
      })

      setSuccessMessage(`Approved suggestion for "${formatOptional(suggestion.subject)}".`)
      invalidateReviewQueries()
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Could not approve suggestion.'))
    } finally {
      setActionProcessing('approve', suggestionId, false)
    }
  }, [invalidateReviewQueries, resolveDraft, setActionProcessing])

  const handleSaveEdit = useCallback(async (suggestion: EmailIntakeSuggestion) => {
    const suggestionId = suggestion.id
    const draft = resolveDraft(suggestion)

    if (draft.destinationType !== 'none' && !trimToOptional(draft.destinationId)) {
      setErrorMessage('Destination ID is required when destination type is account, order, or quote.')
      setSuccessMessage(null)
      return
    }

    setActionProcessing('save-edit', suggestionId, true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const payload = await updateEmailIntakeSuggestion(suggestionId, {
        destinationType: draft.destinationType,
        destinationId: trimToOptional(draft.destinationId),
        summary: trimToOptional(draft.summary),
        chatDraft: trimToOptional(draft.chatDraft),
        reviewNotes: trimToOptional(draft.reviewNotes),
      })

      if (payload?.suggestion?.id) {
        setDraftBySuggestionId((current) => ({
          ...current,
          [payload.suggestion.id]: buildSuggestionDraft(payload.suggestion),
        }))
      }

      setSuccessMessage(`Saved edits for "${formatOptional(suggestion.subject)}".`)
      invalidateReviewQueries()
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Could not save edits.'))
    } finally {
      setActionProcessing('save-edit', suggestionId, false)
    }
  }, [invalidateReviewQueries, resolveDraft, setActionProcessing])

  const handleReject = useCallback(async (suggestion: EmailIntakeSuggestion) => {
    const suggestionId = suggestion.id
    const draft = resolveDraft(suggestion)
    const enteredReason = trimToOptional(draft.rejectReason)
      || trimToOptional(window.prompt('Reason for rejection:') ?? '')

    if (!enteredReason) {
      setErrorMessage('A rejection reason is required.')
      setSuccessMessage(null)
      return
    }

    setActionProcessing('reject', suggestionId, true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await rejectEmailIntakeSuggestion(suggestionId, enteredReason)
      setSuccessMessage(`Rejected suggestion for "${formatOptional(suggestion.subject)}".`)
      invalidateReviewQueries()
      updateDraft(suggestionId, {
        rejectReason: '',
      })
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Could not reject suggestion.'))
    } finally {
      setActionProcessing('reject', suggestionId, false)
    }
  }, [invalidateReviewQueries, resolveDraft, setActionProcessing, updateDraft])

  const handleOpenSuggestion = useCallback((suggestion: EmailIntakeSuggestion) => {
    setSelectedSuggestionId(suggestion.id)
    setReviewDialogTab('overview')

    if (suggestion.isRead) {
      return
    }

    void markEmailIntakeSuggestionRead(suggestion.id)
      .then(() => {
        invalidateReviewQueries()
      })
      .catch(() => {
        // Opening the card should not fail if mark-read fails.
      })
  }, [invalidateReviewQueries])

  const pendingSummary = reviewSummaryQuery.data
  const pageStart = totalSuggestions === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + suggestions.length, totalSuggestions)
  const canOpenSyncLogs = Boolean(activeSyncRun?.id) || syncRunLogs.length > 0

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Stack direction="row" spacing={1.2} alignItems="center">
              <AlternateEmailRoundedIcon color="primary" />
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Email Review
                </Typography>
                <Typography color="text.secondary">
                  Sync one day at a time and triage every email into Green, Yellow, or Red.
                </Typography>
              </Box>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
              <TextField
                size="small"
                type="date"
                label="Sync Date"
                InputLabelProps={{ shrink: true }}
                value={syncDate}
                onChange={(event) => {
                  const nextValue = String(event.target.value ?? '').trim()
                  setSyncDate(nextValue || todayIsoDate())
                }}
                helperText={`Date uses ${reviewTimeZone}`}
                sx={{ minWidth: 168 }}
              />

              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshRoundedIcon />}
                disabled={syncMutation.isPending}
                onClick={() => {
                  void syncMutation.mutateAsync()
                }}
              >
                {syncButtonLabel}
              </Button>

              <Button
                variant="outlined"
                size="small"
                startIcon={<SubjectRoundedIcon />}
                disabled={!canOpenSyncLogs}
                onClick={() => {
                  void handleOpenSyncLogs()
                }}
              >
                {syncMutation.isPending ? 'Logs' : 'See Logs'}
              </Button>

              <Button
                variant="outlined"
                color="error"
                size="small"
                disabled={resetQueueMutation.isPending}
                onClick={() => {
                  if (!window.confirm('Delete all email review records for every connected mailbox?')) {
                    return
                  }

                  void resetQueueMutation.mutateAsync()
                }}
              >
                {resetQueueMutation.isPending ? 'Resetting...' : 'Reset Queue'}
              </Button>

              <Button
                variant="contained"
                size="small"
                startIcon={<TaskAltRoundedIcon />}
                disabled={approveAllMutation.isPending || statusFilter !== 'pending'}
                onClick={() => {
                  if (!window.confirm('Approve all pending suggestions in the current filter?')) {
                    return
                  }

                  void approveAllMutation.mutateAsync()
                }}
              >
                {approveAllMutation.isPending ? 'Approving...' : 'Approve Visible Pending'}
              </Button>
            </Stack>
          </Stack>

          <StatusAlerts errorMessage={errorMessage} successMessage={successMessage} />

          <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              variant="outlined"
              label={`Pending: ${pendingSummary?.pending ?? 0}`}
              color="warning"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Unread pending: ${pendingSummary?.unreadPending ?? 0}`}
              color="info"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Approved: ${pendingSummary?.approved ?? 0}`}
              color="success"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Rejected: ${pendingSummary?.rejected ?? 0}`}
              color="error"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Green: ${pendingSummary?.green ?? suggestionsByLane.green.length}`}
              color="success"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Yellow: ${pendingSummary?.yellow ?? suggestionsByLane.yellow.length}`}
              color="warning"
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Red: ${pendingSummary?.red ?? suggestionsByLane.red.length}`}
              color="error"
            />
            {syncMutation.isPending || activeSyncRun ? (
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={`Sync progress: ${Number(activeSyncRun?.processedConnections ?? 0)}/${Number(activeSyncRun?.scannedConnections ?? 0)}`}
              />
            ) : null}
          </Stack>

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.2}
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="email-review-status-label">Status</InputLabel>
              <Select
                labelId="email-review-status-label"
                value={statusFilter}
                label="Status"
                onChange={(event) => {
                  setStatusFilter(event.target.value as EmailReviewStatusFilter)
                }}
              >
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
                <MenuItem value="all">All</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="email-review-provider-label">Provider</InputLabel>
              <Select
                labelId="email-review-provider-label"
                value={providerFilter}
                label="Provider"
                onChange={(event) => {
                  setProviderFilter(event.target.value as ProviderFilter)
                }}
              >
                <MenuItem value="all">All providers</MenuItem>
                <MenuItem value="google">Google</MenuItem>
                <MenuItem value="microsoft">Microsoft</MenuItem>
              </Select>
            </FormControl>

            <Chip
              size="small"
              variant="outlined"
              label={totalSuggestions > 0
                ? `Showing ${pageStart}-${pageEnd} of ${totalSuggestions} emails`
                : 'No emails'}
            />

            <Stack direction="row" spacing={0.8} sx={{ ml: { md: 'auto' } }}>
              <Button
                variant="outlined"
                size="small"
                disabled={offset <= 0 || reviewListQuery.isFetching}
                onClick={() => {
                  setOffset((current) => Math.max(0, current - suggestionPageLimit))
                }}
              >
                Previous
              </Button>

              <Button
                variant="outlined"
                size="small"
                disabled={!hasMore || reviewListQuery.isFetching}
                onClick={() => {
                  setOffset((current) => current + suggestionPageLimit)
                }}
              >
                Next
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Paper>

      <LoadingPanel
        loading={reviewListQuery.isLoading}
        message="Loading email review queue..."
        contained
      />

      {!reviewListQuery.isLoading && sortedSuggestions.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography color="text.secondary">
            No email suggestions were found for this filter and date.
          </Typography>
        </Paper>
      ) : null}

      {!reviewListQuery.isLoading ? (
        <>
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: {
                xs: '1fr',
                xl: 'repeat(3, minmax(0, 1fr))',
              },
            }}
          >
            {laneOrder.map((laneKey) => {
              const laneSuggestions = suggestionsByLane[laneKey]
              const laneInfo = laneMeta[laneKey]

              return (
                <Paper
                  key={laneKey}
                  variant="outlined"
                  sx={{
                    p: 1.2,
                    bgcolor: laneInfo.backgroundColor,
                    borderColor: laneInfo.borderColor,
                    minHeight: 260,
                  }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle1" fontWeight={700}>
                        {laneInfo.label}
                      </Typography>
                      <Chip
                        size="small"
                        color={laneInfo.chipColor}
                        variant="outlined"
                        label={laneSuggestions.length}
                      />
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      {laneInfo.description}
                    </Typography>

                    {laneSuggestions.length === 0 ? (
                      <Paper variant="outlined" sx={{ p: 1.1, bgcolor: 'rgba(255,255,255,0.7)' }}>
                        <Typography variant="body2" color="text.secondary">
                          No emails in this lane.
                        </Typography>
                      </Paper>
                    ) : null}

                    <Stack spacing={0.9}>
                      {laneSuggestions.map((suggestion) => {
                        const destinationCandidate = suggestion.candidateDestinations.find((candidate) => (
                          candidate.type === suggestion.destinationType
                          && candidate.id === suggestion.destinationId
                        ))
                        const suggestionDestinationLabel = formatCandidateReference(
                          destinationCandidate
                            ? {
                              id: destinationCandidate.id,
                              label: destinationCandidate.label,
                            }
                            : suggestion.destinationId
                              ? {
                                id: suggestion.destinationId,
                                label: suggestion.destinationId,
                              }
                              : null,
                          'None',
                        )

                        return (
                          <Paper
                            key={suggestion.id}
                            variant="outlined"
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              handleOpenSuggestion(suggestion)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') {
                                return
                              }

                              event.preventDefault()
                              handleOpenSuggestion(suggestion)
                            }}
                            sx={{
                              p: 1.2,
                              borderRadius: 1.5,
                              cursor: 'pointer',
                              bgcolor: 'rgba(255,255,255,0.9)',
                              borderColor: selectedSuggestion?.id === suggestion.id
                                ? 'primary.main'
                                : 'divider',
                              transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                borderColor: 'primary.main',
                                boxShadow: 2,
                              },
                              '&:focus-visible': {
                                outline: '2px solid',
                                outlineColor: 'primary.main',
                                outlineOffset: '2px',
                              },
                            }}
                          >
                            <Stack spacing={0.8}>
                              <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap>
                                <Chip
                                  size="small"
                                  label={formatStatusLabel(suggestion.status)}
                                  color={resolveStatusChipColor(suggestion.status)}
                                  variant="outlined"
                                />
                                <Chip
                                  size="small"
                                  label={suggestion.provider === 'google' ? 'Google' : 'Microsoft'}
                                  variant="outlined"
                                />
                                {!suggestion.isRead ? (
                                  <Chip
                                    size="small"
                                    label="Unread"
                                    color="info"
                                    variant="outlined"
                                  />
                                ) : null}
                              </Stack>

                              <Typography
                                variant="subtitle2"
                                fontWeight={700}
                                sx={{
                                  lineHeight: 1.35,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {formatOptional(suggestion.summary || suggestion.snippet || 'No AI summary available.')}
                              </Typography>

                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {`Subject: ${formatOptional(suggestion.subject)}`}
                              </Typography>

                              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                {`${formatDestinationTypeLabel(suggestion.destinationType)}: ${suggestionDestinationLabel}`}
                              </Typography>

                              <Typography variant="caption" color="text.secondary">
                                {`${formatDateTime(suggestion.messageDate)} · Confidence ${formatConfidence(suggestion.confidence)}`}
                              </Typography>
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Box>

          <Dialog
            open={Boolean(selectedSuggestion)}
            onClose={() => {
              setSelectedSuggestionId(null)
            }}
            fullWidth
            maxWidth="lg"
          >
            <DialogTitle sx={{ pb: 1.25 }}>
              <Stack spacing={0.6}>
                <Typography variant="h6" fontWeight={700}>
                  {formatOptional(selectedSuggestion?.summary || selectedSuggestion?.snippet || 'No AI summary available.')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`Subject: ${formatOptional(selectedSuggestion?.subject)}`}
                </Typography>
              </Stack>
            </DialogTitle>

            <DialogContent dividers>
              <Tabs
                value={reviewDialogTab}
                onChange={(_, value: ReviewDialogTab) => {
                  setReviewDialogTab(value)
                }}
                sx={{ mb: 1.5 }}
              >
                <Tab label="Overview" value="overview" />
                <Tab label="Review" value="review" />
                <Tab label="Email" value="email" />
              </Tabs>

              {reviewDialogTab === 'overview' ? (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={selectedSuggestion ? laneMeta[resolveSuggestionLane(selectedSuggestion)].label : 'Lane'}
                      color={selectedSuggestion ? laneMeta[resolveSuggestionLane(selectedSuggestion)].chipColor : 'default'}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={selectedSuggestion?.provider === 'google' ? 'Google' : 'Microsoft'}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={selectedSuggestion?.direction === 'outbound' ? 'Outbound' : 'Inbound'}
                      color={resolveDirectionChipColor(selectedSuggestion?.direction ?? 'inbound')}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      label={`Confidence ${formatConfidence(selectedSuggestion?.confidence)}`}
                      variant="outlined"
                    />
                  </Stack>

                  <Typography variant="body2" fontWeight={600}>
                    {`${formatDestinationTypeLabel(selectedSuggestion?.destinationType ?? 'none')}: ${selectedDestinationLabel}`}
                  </Typography>

                  {selectedAdditionalRoutingTargets.length > 0 ? (
                    <Typography variant="body2" color="text.secondary" fontWeight={600}>
                      {`Also routes to ${formatRoutingTargetsLabel(selectedAdditionalRoutingTargets)}`}
                    </Typography>
                  ) : null}

                  {selectedSuggestion?.destinationReason ? (
                    <Typography variant="body2" color="text.secondary">
                      {selectedSuggestion.destinationReason}
                    </Typography>
                  ) : null}

                  <Typography variant="body2" color="text.secondary">
                    {selectedSuggestion?.fromEmail ? `From: ${selectedSuggestion.fromEmail}` : 'From: Unknown sender'}
                  </Typography>

                  <Typography variant="body2" color="text.secondary">
                    To: {selectedSuggestion?.toEmails.length ? selectedSuggestion.toEmails.join(', ') : '-'}
                  </Typography>

                  {selectedSuggestion?.ccEmails.length ? (
                    <Typography variant="body2" color="text.secondary">
                      CC: {selectedSuggestion.ccEmails.join(', ')}
                    </Typography>
                  ) : null}

                  {selectedSuggestion?.attachmentNames?.length ? (
                    <Typography variant="body2" color="text.secondary">
                      Attachments: {selectedSuggestion.attachmentNames.join(', ')}
                    </Typography>
                  ) : null}

                  <Typography variant="caption" color="text.secondary">
                    Message Date: {formatDateTime(selectedSuggestion?.messageDate)}
                  </Typography>

                  {Number(selectedSuggestion?.conversationMessageCount ?? 0) > 1 ? (
                    <Typography variant="caption" color="text.secondary">
                      Conversation messages: {Number(selectedSuggestion?.conversationMessageCount ?? 0)}
                    </Typography>
                  ) : null}
                </Stack>
              ) : null}

              {reviewDialogTab === 'review' && selectedSuggestion && selectedDraft ? (
                <Stack spacing={1.2}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel id={`destination-type-${selectedSuggestion.id}`}>Destination Type</InputLabel>
                      <Select
                        labelId={`destination-type-${selectedSuggestion.id}`}
                        value={selectedDraft.destinationType}
                        label="Destination Type"
                        onChange={(event) => {
                          updateDraft(selectedSuggestion.id, {
                            destinationType: event.target.value as EmailReviewDestinationType,
                          })
                        }}
                      >
                        <MenuItem value="none">None</MenuItem>
                        <MenuItem value="account">Account</MenuItem>
                        <MenuItem value="order">Order</MenuItem>
                        <MenuItem value="quote">Quote</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      size="small"
                      label="Destination ID"
                      value={selectedDraft.destinationId}
                      onChange={(event) => {
                        updateDraft(selectedSuggestion.id, { destinationId: event.target.value })
                      }}
                      fullWidth
                    />
                  </Stack>

                  <TextField
                    label="Summary"
                    value={selectedDraft.summary}
                    onChange={(event) => {
                      updateDraft(selectedSuggestion.id, { summary: event.target.value })
                    }}
                    multiline
                    minRows={2}
                    fullWidth
                  />

                  <TextField
                    label="Chat Draft"
                    value={selectedDraft.chatDraft}
                    onChange={(event) => {
                      updateDraft(selectedSuggestion.id, { chatDraft: event.target.value })
                    }}
                    multiline
                    minRows={3}
                    fullWidth
                  />

                  <TextField
                    size="small"
                    label="Review Notes"
                    value={selectedDraft.reviewNotes}
                    onChange={(event) => {
                      updateDraft(selectedSuggestion.id, { reviewNotes: event.target.value })
                    }}
                    fullWidth
                  />

                  <TextField
                    size="small"
                    label="Reject Reason"
                    value={selectedDraft.rejectReason}
                    onChange={(event) => {
                      updateDraft(selectedSuggestion.id, { rejectReason: event.target.value })
                    }}
                    fullWidth
                  />
                </Stack>
              ) : null}

              {reviewDialogTab === 'email' ? (
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    {selectedEmailBodyMode === 'conversation'
                      ? `Showing full conversation thread (${selectedConversationMessageCount} messages).`
                      : selectedSanitizedEmailHtml
                        ? 'Showing sanitized HTML email rendering.'
                        : 'Showing plain text email body.'}
                  </Typography>

                  {canShowConversationBody ? (
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={showConversationBody}
                          onChange={(_, checked) => {
                            setShowConversationBody(checked)
                          }}
                        />
                      )}
                      label={`Show full conversation (${selectedConversationMessageCount} messages)`}
                      sx={{ mt: -0.4 }}
                    />
                  ) : null}

                  {selectedEmailBodyMode === 'single' && selectedSanitizedEmailHtml ? (
                    <Box
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        bgcolor: 'common.white',
                      }}
                    >
                      <iframe
                        title="Email body"
                        srcDoc={selectedSanitizedEmailHtml}
                        sandbox=""
                        style={{
                          width: '100%',
                          minHeight: '460px',
                          border: 'none',
                          display: 'block',
                        }}
                      />
                    </Box>
                  ) : (
                    <Typography
                      variant="body2"
                      component="pre"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        m: 0,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      }}
                    >
                      {String(selectedPlainEmailBody)}
                    </Typography>
                  )}
                </Stack>
              ) : null}
            </DialogContent>

            <DialogActions>
              <Button
                onClick={() => {
                  setSelectedSuggestionId(null)
                }}
              >
                Close
              </Button>

              {selectedSuggestion ? (
                <Button
                  variant="outlined"
                  startIcon={<SaveRoundedIcon fontSize="small" />}
                  disabled={isActionProcessing('save-edit', selectedSuggestion.id)}
                  onClick={() => {
                    void handleSaveEdit(selectedSuggestion)
                  }}
                >
                  {isActionProcessing('save-edit', selectedSuggestion.id) ? 'Saving...' : 'Save Edit'}
                </Button>
              ) : null}

              {selectedSuggestion ? (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<RuleRoundedIcon fontSize="small" />}
                  disabled={isActionProcessing('reject', selectedSuggestion.id)}
                  onClick={() => {
                    void handleReject(selectedSuggestion)
                  }}
                >
                  {isActionProcessing('reject', selectedSuggestion.id) ? 'Rejecting...' : 'Reject'}
                </Button>
              ) : null}

              {selectedSuggestion ? (
                <Button
                  variant="contained"
                  startIcon={<CheckCircleOutlineRoundedIcon fontSize="small" />}
                  disabled={isActionProcessing('approve', selectedSuggestion.id)}
                  onClick={() => {
                    void handleApprove(selectedSuggestion)
                  }}
                >
                  {isActionProcessing('approve', selectedSuggestion.id) ? 'Approving...' : 'Approve'}
                </Button>
              ) : null}
            </DialogActions>
          </Dialog>

          <Dialog
            open={isSyncLogsDialogOpen}
            onClose={() => {
              setIsSyncLogsDialogOpen(false)
            }}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle sx={{ pb: 1 }}>
              Sync Logs
            </DialogTitle>

            <DialogContent dividers>
              <Stack spacing={1.1}>
                <Typography variant="body2" color="text.secondary">
                  {activeSyncRun
                    ? `Run ${formatOptional(activeSyncRun.id)} · Status ${formatOptional(activeSyncRun.status)} · Date ${formatOptional(activeSyncRun.syncDateRequested || syncDate)} · Progress ${Number(activeSyncRun.processedConnections ?? 0)}/${Number(activeSyncRun.scannedConnections ?? 0)} · Emails caught ${Number(activeSyncRun.messagesCaught ?? 0)}`
                    : 'No active sync run. Showing latest captured logs.'}
                </Typography>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.2,
                    maxHeight: 420,
                    overflowY: 'auto',
                    bgcolor: 'grey.50',
                  }}
                >
                  {syncRunLogs.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No sync logs yet.
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      {syncRunLogs.map((log) => (
                        <Box key={log.sequence}>
                          <Typography variant="caption" color="text.secondary">
                            {`${formatDateTime(log.at)} · ${String(log.level ?? 'info').toUpperCase()} · #${Number(log.sequence ?? 0)}`}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {String(log.message ?? '')}
                          </Typography>
                          {log.data ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {JSON.stringify(log.data)}
                            </Typography>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Stack>
            </DialogContent>

            <DialogActions>
              <Button
                onClick={() => {
                  setIsSyncLogsDialogOpen(false)
                }}
              >
                Close
              </Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
    </Stack>
  )
}
