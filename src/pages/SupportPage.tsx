import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import DOMPurify from 'dompurify'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { generateAiSupportReply, fetchCommentSummaries } from '../features/ai/api'
import {
  fetchSupportAlertTickets,
  fetchSupportAlerts,
  replySupportTicket,
  fetchSupportTicketConversation,
  fetchSupportTickets,
  type SupportReplyStatus,
  type SupportTicketConversationSnapshot,
} from '../features/support/api'

type AlertBucketKey =
  | 'newOver24Hours'
  | 'openOver24Hours'
  | 'inProgressOver48Hours'
  | 'pendingOver48Hours'

type SupportReplyStatusOption = SupportReplyStatus | 'no_change'

function formatDateTime(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function formatSyncTimestamp(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function statusChipColor(status: string): 'default' | 'warning' | 'info' | 'success' {
  const normalized = String(status).trim().toLowerCase()

  if (normalized === 'new') {
    return 'info'
  }

  if (normalized === 'open' || normalized === 'pending') {
    return 'warning'
  }

  if (normalized === 'solved' || normalized === 'closed') {
    return 'success'
  }

  return 'default'
}

function normalizeCommentBody(body: string) {
  const rawBody = String(body ?? '')
  return rawBody
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeCommentText(plainBody: string, htmlBody: string | null | undefined) {
  const rawHtmlBody = String(htmlBody ?? '').trim()
  let decodedBody = String(plainBody ?? '')

  if (rawHtmlBody && typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    const parser = new window.DOMParser()
    const normalizedHtml = rawHtmlBody
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h[1-6]|blockquote)>/gi, '\n')
    const parsed = parser.parseFromString(normalizedHtml, 'text/html')

    decodedBody =
      parsed.body?.textContent
      ?? parsed.documentElement.textContent
      ?? String(plainBody ?? '')
  }

  const normalized = normalizeCommentBody(decodedBody)

  if (normalized) {
    return normalized
  }

  return normalizeCommentBody(String(plainBody ?? ''))
}

function sanitizeCommentHtml(htmlBody: string | null | undefined) {
  const rawHtmlBody = String(htmlBody ?? '').trim()

  if (!rawHtmlBody || typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return null
  }

  const sanitized = DOMPurify.sanitize(rawHtmlBody, {
    USE_PROFILES: {
      html: true,
    },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  })

  const sanitizedString = String(sanitized ?? '').trim()

  if (!sanitizedString) {
    return null
  }

  return sanitizedString
}

function buildCommentHtmlDocument(sanitizedHtmlBody: string) {
  const fallbackHtml = String(sanitizedHtmlBody ?? '').trim()

  if (!fallbackHtml || typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return ''
  }

  const parser = new window.DOMParser()
  const parsed = parser.parseFromString(fallbackHtml, 'text/html')

  parsed.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  const preparedHtml = String(parsed.body?.innerHTML ?? '').trim()

  if (!preparedHtml) {
    return ''
  }

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '<style>',
    'html,body{margin:0;padding:0;background:transparent;color:#1f2937;}',
    'body{font:400 0.96rem/1.55 "Segoe UI",Arial,sans-serif;overflow-wrap:anywhere;}',
    'img{max-width:100%;height:auto;}',
    'table{max-width:100%;}',
    '</style>',
    '</head>',
    '<body>',
    preparedHtml,
    '</body>',
    '</html>',
  ].join('')
}

function SupportCommentHtmlFrame({
  sanitizedHtmlBody,
}: {
  sanitizedHtmlBody: string
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeHeight, setIframeHeight] = useState(120)
  const sourceDocument = useMemo(
    () => buildCommentHtmlDocument(sanitizedHtmlBody),
    [sanitizedHtmlBody],
  )

  useEffect(() => {
    const iframe = iframeRef.current

    if (!iframe || !sourceDocument) {
      return
    }

    let rafId = 0
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    const imageListeners: Array<{ image: HTMLImageElement; listener: () => void }> = []

    const updateHeight = () => {
      const currentDocument = iframe.contentDocument

      if (!currentDocument) {
        return
      }

      const bodyHeight = Math.max(
        currentDocument.body?.scrollHeight ?? 0,
        currentDocument.body?.offsetHeight ?? 0,
      )
      const documentHeight = Math.max(
        currentDocument.documentElement?.scrollHeight ?? 0,
        currentDocument.documentElement?.offsetHeight ?? 0,
      )
      const nextHeight = Math.max(bodyHeight, documentHeight, 24)

      setIframeHeight(nextHeight)
    }

    const scheduleHeightUpdate = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateHeight)
    }

    const clearImageListeners = () => {
      imageListeners.forEach(({ image, listener }) => {
        image.removeEventListener('load', listener)
        image.removeEventListener('error', listener)
      })
      imageListeners.length = 0
    }

    const attachImageListeners = () => {
      clearImageListeners()

      const currentDocument = iframe.contentDocument

      if (!currentDocument) {
        return
      }

      currentDocument.querySelectorAll('img').forEach((image) => {
        const listener = () => {
          scheduleHeightUpdate()
        }

        image.addEventListener('load', listener)
        image.addEventListener('error', listener)
        imageListeners.push({ image, listener })
      })
    }

    const connectObservers = () => {
      const currentDocument = iframe.contentDocument

      if (!currentDocument || !currentDocument.body) {
        return
      }

      scheduleHeightUpdate()
      attachImageListeners()

      if (typeof window.ResizeObserver !== 'undefined') {
        resizeObserver = new window.ResizeObserver(() => {
          scheduleHeightUpdate()
        })

        resizeObserver.observe(currentDocument.body)
        resizeObserver.observe(currentDocument.documentElement)
      }

      mutationObserver = new MutationObserver(() => {
        attachImageListeners()
        scheduleHeightUpdate()
      })

      mutationObserver.observe(currentDocument.body, {
        subtree: true,
        childList: true,
        characterData: true,
      })
    }

    const handleIframeLoad = () => {
      connectObservers()
    }

    iframe.addEventListener('load', handleIframeLoad)

    if (iframe.contentDocument?.readyState === 'complete') {
      connectObservers()
    }

    const handleWindowResize = () => {
      scheduleHeightUpdate()
    }

    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      iframe.removeEventListener('load', handleIframeLoad)

      if (resizeObserver) {
        resizeObserver.disconnect()
      }

      if (mutationObserver) {
        mutationObserver.disconnect()
      }

      clearImageListeners()
      cancelAnimationFrame(rafId)
    }
  }, [sourceDocument])

  return (
    <Box
      component="iframe"
      ref={iframeRef}
      srcDoc={sourceDocument}
      title="Support message"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      referrerPolicy="no-referrer"
      sx={{
        width: '100%',
        border: 0,
        display: 'block',
        height: `${iframeHeight}px`,
        bgcolor: 'transparent',
      }}
    />
  )
}

function formatAttachmentSize(sizeBytes: number | null | undefined) {
  const sizeValue = Number(sizeBytes)

  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    return null
  }

  if (sizeValue >= 1024 * 1024) {
    return `${(sizeValue / (1024 * 1024)).toFixed(1)} MB`
  }

  if (sizeValue >= 1024) {
    return `${Math.round(sizeValue / 1024)} KB`
  }

  return `${sizeValue} B`
}

function buildPreviewParagraph(body: string, maxChars = 220) {
  const normalizedBody = normalizeCommentBody(body)

  if (!normalizedBody) {
    return 'No content'
  }

  const firstParagraph =
    normalizedBody.split(/\n\s*\n/).find((segment) => segment.trim()) ?? normalizedBody
  const collapsedParagraph = firstParagraph.replace(/\s+/g, ' ').trim()

  if (collapsedParagraph.length <= maxChars) {
    return collapsedParagraph
  }

  return `${collapsedParagraph.slice(0, maxChars).trimEnd()}...`
}

function getInitials(name: string): string {
  return String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getStatusAccentColor(status: string): string {
  const normalized = String(status).trim().toLowerCase()
  if (normalized === 'new') return '#1e88e5'
  if (normalized === 'open') return '#fb8c00'
  if (normalized === 'in_progress') return '#5e35b1'
  if (normalized === 'pending') return '#8d6e63'
  if (normalized === 'solved' || normalized === 'closed') return '#2e7d32'
  return '#90a4ae'
}

function formatReplyStatusLabel(status: SupportReplyStatus): string {
  if (status === 'in_progress') {
    return 'In Progress'
  }

  if (status === 'pending') {
    return 'Pending'
  }

  if (status === 'solved') {
    return 'Solved'
  }

  return 'Open'
}

export default function SupportPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [pendingSidebarTicketScrollId, setPendingSidebarTicketScrollId] = useState<number | null>(
    null,
  )
  const [pendingConversationJump, setPendingConversationJump] = useState<
    { ticketId: number; commentId: number } | null
  >(null)
  const [selectedAlertBucket, setSelectedAlertBucket] = useState<AlertBucketKey | null>(null)
  const [expandedTicketPreviewId, setExpandedTicketPreviewId] = useState<number | false>(false)
  const [replyBody, setReplyBody] = useState('')
  const [replyMode, setReplyMode] = useState<'public' | 'internal'>('public')
  const [replyStatus, setReplyStatus] = useState<SupportReplyStatusOption>('no_change')
  const [replySuccessMessage, setReplySuccessMessage] = useState<string | null>(null)
  const [replyErrorMessage, setReplyErrorMessage] = useState<string | null>(null)
  const [isGeneratingReply, setIsGeneratingReply] = useState(false)
  const [isAiGeneratedReply, setIsAiGeneratedReply] = useState(false)
  const lastDraftHintRef = useRef<string | null>(null)
  const conversationThreadScrollRef = useRef<HTMLDivElement | null>(null)
  const lastAutoScrolledConversationTicketIdRef = useRef<number | null>(null)

  const alertsQuery = useQuery({
    queryKey: ['support', 'alerts'],
    queryFn: () => fetchSupportAlerts({ refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  const alertTicketsQuery = useQuery({
    queryKey: ['support', 'alert-tickets', 100],
    queryFn: () => fetchSupportAlertTickets(100, { refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  const ticketsQuery = useQuery({
    queryKey: ['support', 'tickets', 100],
    queryFn: () => fetchSupportTickets(100, { refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  const conversationQuery = useQuery({
    queryKey: ['support', 'conversation', selectedTicketId],
    queryFn: () => fetchSupportTicketConversation(selectedTicketId!),
    enabled: selectedTicketId !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  // Fetches AI one-sentence summaries for each comment in the expanded ticket.
  // Results are cached in MongoDB so OpenAI is only called once per comment ever.
  const commentSummariesQuery = useQuery({
    queryKey: ['ai', 'comment-summaries', expandedTicketPreviewId || null],
    queryFn: () => fetchCommentSummaries(expandedTicketPreviewId as number),
    enabled: expandedTicketPreviewId !== false,
    staleTime: 4 * 60 * 60 * 1000,
    gcTime: 8 * 60 * 60 * 1000,
  })

  const commentSummaries: Record<number, string> = commentSummariesQuery.data?.summaries ?? {}

  const alertsSnapshot = alertsQuery.data ?? null
  const alertTicketsSnapshot = alertTicketsQuery.data ?? null
  const ticketsSnapshot = ticketsQuery.data ?? null
  const conversationSnapshot = conversationQuery.data ?? null

  const isLoadingPage =
    (alertsQuery.isLoading || ticketsQuery.isLoading) &&
    !alertsSnapshot && !ticketsSnapshot

  const isLoadingConversation = conversationQuery.isFetching && !conversationSnapshot

  const pageError =
    (alertsQuery.isError || ticketsQuery.isError) &&
    !alertsSnapshot && !ticketsSnapshot
      ? 'Failed to load Zendesk support data.'
      : null

  const conversationError = conversationQuery.isError
    ? (conversationQuery.error instanceof Error
        ? conversationQuery.error.message
        : 'Failed to load conversation.')
    : null

  const isFetchingAny =
    alertsQuery.isFetching ||
    ticketsQuery.isFetching ||
    alertTicketsQuery.isFetching

  const linkedZendeskUserId = Number(appUser?.linkedZendeskUserId)
  const canReplyAsLinkedZendeskUser =
    Boolean(appUser?.isApproved)
    && Number.isFinite(linkedZendeskUserId)
    && linkedZendeskUserId > 0
  const replyAuthorLabel =
    String(appUser?.linkedZendeskUserName ?? '').trim()
    || String(appUser?.displayName ?? '').trim()
    || appUser?.email
    || 'Linked Zendesk agent'
  const trimmedReplyBody = replyBody.trim()
  const replyCharacterLimit = 64000

  const replyMutation = useMutation({
    mutationFn: ({
      ticketId,
      body,
      isPublic,
      status,
    }: {
      ticketId: number
      body: string
      isPublic: boolean
      status?: SupportReplyStatus
    }) =>
      replySupportTicket(ticketId, {
        body,
        isPublic,
        status,
      }),
    onSuccess: async (payload, variables) => {
      if (payload.conversation) {
        queryClient.setQueryData(['support', 'conversation', variables.ticketId], payload.conversation)
      } else {
        await queryClient.invalidateQueries({
          queryKey: ['support', 'conversation', variables.ticketId],
        })
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['support', 'alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['support', 'alert-tickets'] }),
      ])

      setReplyBody('')
      const baseMessage = payload.reply.isPublic ? 'Public reply sent.' : 'Internal note added.'
      const nextMessage = variables.status
        ? `${baseMessage} Ticket set to ${formatReplyStatusLabel(variables.status)}.`
        : baseMessage

      setReplySuccessMessage(nextMessage)
      setReplyErrorMessage(null)
    },
    onError: (error) => {
      setReplySuccessMessage(null)
      setReplyErrorMessage(error instanceof Error ? error.message : 'Could not send reply.')
    },
  })

  async function handleRefresh() {
    await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['support', 'alerts'],
        queryFn: () => fetchSupportAlerts({ refresh: true }),
        staleTime: 0,
      }),
      queryClient.fetchQuery({
        queryKey: ['support', 'alert-tickets', 100],
        queryFn: () => fetchSupportAlertTickets(100, { refresh: true }),
        staleTime: 0,
      }),
      queryClient.fetchQuery({
        queryKey: ['support', 'tickets', 100],
        queryFn: () => fetchSupportTickets(100, { refresh: true }),
        staleTime: 0,
      }),
    ])
  }

  async function handleSubmitReply() {
    if (!conversationSnapshot) {
      setReplyErrorMessage('Select a ticket before sending a reply.')
      return
    }

    if (!canReplyAsLinkedZendeskUser) {
      setReplyErrorMessage('Your account is not linked to a Zendesk agent. Ask an admin to assign one.')
      return
    }

    if (!trimmedReplyBody) {
      setReplyErrorMessage('Enter a reply message.')
      return
    }

    if (trimmedReplyBody.length > replyCharacterLimit) {
      setReplyErrorMessage(`Reply exceeds ${replyCharacterLimit.toLocaleString()} characters.`)
      return
    }

    setReplyErrorMessage(null)
    setReplySuccessMessage(null)

    await replyMutation.mutateAsync({
      ticketId: conversationSnapshot.ticket.id,
      body: trimmedReplyBody,
      isPublic: replyMode === 'public',
      status: replyStatus === 'no_change' ? undefined : replyStatus,
    })
  }

  useEffect(() => {
    if (!pendingConversationJump || !conversationSnapshot) {
      return
    }

    if (conversationSnapshot.ticket.id !== pendingConversationJump.ticketId) {
      return
    }

    const hasTargetComment = conversationSnapshot.comments.some(
      (comment) => comment.id === pendingConversationJump.commentId,
    )

    if (!hasTargetComment) {
      const timer = setTimeout(() => setPendingConversationJump(null), 0)
      return () => clearTimeout(timer)
    }

    const frameId = requestAnimationFrame(() => {
      const targetElement = document.getElementById(
        `conversation-comment-${pendingConversationJump.commentId}`,
      )

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
      }

      setPendingConversationJump(null)
    })

    return () => cancelAnimationFrame(frameId)
  }, [conversationSnapshot, pendingConversationJump])

  useEffect(() => {
    if (!pendingSidebarTicketScrollId) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      const targetElement = document.getElementById(
        `sidebar-ticket-${pendingSidebarTicketScrollId}`,
      )

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
        setPendingSidebarTicketScrollId(null)
      }
    })

    return () => cancelAnimationFrame(frameId)
  }, [expandedTicketPreviewId, pendingSidebarTicketScrollId, ticketsSnapshot])

  useEffect(() => {
    const ticketId = conversationSnapshot?.ticket?.id ?? null

    if (!ticketId || pendingConversationJump) {
      return
    }

    if (lastAutoScrolledConversationTicketIdRef.current === ticketId) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      const container = conversationThreadScrollRef.current

      if (!container) {
        return
      }

      container.scrollTop = container.scrollHeight
      lastAutoScrolledConversationTicketIdRef.current = ticketId
    })

    return () => cancelAnimationFrame(frameId)
  }, [conversationSnapshot, pendingConversationJump])

  const alertCards = useMemo(() => {
    const alerts = alertsSnapshot?.alerts

    return [
      {
        key: 'newOver24Hours',
        label: 'New > 24h',
        value: alerts?.newOver24Hours ?? 0,
        color: '#1565c0',
      },
      {
        key: 'openOver24Hours',
        label: 'Open > 24h',
        value: alerts?.openOver24Hours ?? 0,
        color: '#ef6c00',
      },
      {
        key: 'inProgressOver48Hours',
        label: 'In Process > 48h',
        value: alerts?.inProgressOver48Hours ?? 0,
        color: '#6a1b9a',
      },
      {
        key: 'pendingOver48Hours',
        label: 'Pending > 48h',
        value: alerts?.pendingOver48Hours ?? 0,
        color: '#5d4037',
      },
    ]
  }, [alertsSnapshot])

  const alertBucketLabelMap: Record<AlertBucketKey, string> = {
    newOver24Hours: 'New > 24h',
    openOver24Hours: 'Open > 24h',
    inProgressOver48Hours: 'In Process > 48h',
    pendingOver48Hours: 'Pending > 48h',
  }

  const selectedAlertTicketIds = useMemo(() => {
    if (!selectedAlertBucket || !alertTicketsSnapshot) {
      return null
    }

    const bucketTickets = alertTicketsSnapshot.buckets[selectedAlertBucket] ?? []

    return new Set(
      bucketTickets
        .map((ticket) => Number(ticket?.id))
        .filter((ticketId) => Number.isFinite(ticketId) && ticketId > 0),
    )
  }, [alertTicketsSnapshot, selectedAlertBucket])

  const openTickets = useMemo(() => {
    const filteredTickets = (ticketsSnapshot?.tickets ?? []).filter(
      (ticket) => !['solved', 'closed'].includes(ticket.status),
    )

    return [...filteredTickets].sort((left, right) => {
      const leftUpdatedAt = new Date(left.updatedAt).getTime()
      const rightUpdatedAt = new Date(right.updatedAt).getTime()

      if (Number.isFinite(leftUpdatedAt) && Number.isFinite(rightUpdatedAt)) {
        return rightUpdatedAt - leftUpdatedAt
      }

      return right.id - left.id
    })
  }, [ticketsSnapshot])

  const sidebarTickets = useMemo(() => {
    if (!selectedAlertTicketIds) {
      return openTickets
    }

    return openTickets.filter((ticket) => selectedAlertTicketIds.has(ticket.id))
  }, [openTickets, selectedAlertTicketIds])

  const activeAlertFilterLabel = selectedAlertBucket
    ? alertBucketLabelMap[selectedAlertBucket]
    : null

  const helpdeskUrl =
    alertsSnapshot?.agentUrl ||
    ticketsSnapshot?.agentUrl ||
    null

  const lastSyncTimestamp = useMemo(() => {
    const timestamps = [
      alertsSnapshot?.generatedAt,
      ticketsSnapshot?.generatedAt,
      alertTicketsSnapshot?.generatedAt,
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)

    if (timestamps.length === 0) {
      return null
    }

    return timestamps.sort(
      (left, right) => new Date(right).getTime() - new Date(left).getTime(),
    )[0]
  }, [alertsSnapshot, ticketsSnapshot, alertTicketsSnapshot])

  function handleAlertCardClick(bucketKey: AlertBucketKey) {
    const isSameBucket = selectedAlertBucket === bucketKey

    if (isSameBucket) {
      setSelectedAlertBucket(null)
      return
    }

    setSelectedAlertBucket(bucketKey)
  }

  async function handleGenerateReply() {
    if (!selectedTicketId) {
      return
    }

    setIsGeneratingReply(true)
    setReplyErrorMessage(null)
    setReplySuccessMessage(null)

    try {
      const draftHint = replyBody.trim() || undefined
      lastDraftHintRef.current = draftHint ?? null
      const { reply } = await generateAiSupportReply(selectedTicketId, draftHint)
      setReplyBody(reply)
      setIsAiGeneratedReply(true)
    } catch (error) {
      setReplyErrorMessage(
        error instanceof Error ? error.message : 'AI could not generate a reply.',
      )
    } finally {
      setIsGeneratingReply(false)
    }
  }

  function handleTeachAi() {
    if (!conversationSnapshot || !replyBody.trim()) return
    const ticket = conversationSnapshot.ticket
    const userDraftLine = lastDraftHintRef.current
      ? `User wrote: "${lastDraftHintRef.current}"\n\n`
      : ''
    const prefillMessage =
      `Zendesk ticket #${ticket.id}: "${ticket.subject}" (from ${ticket.requesterName}).\n\n` +
      userDraftLine +
      `AI generated this reply:\n"${replyBody.trim()}"\n\n` +
      `This is not good because: `
    navigate('/admin/ai-config', { state: { category: 'support', prefillMessage } })
  }

  function selectTicket(ticketId: number) {
    setSelectedTicketId(ticketId)
    setReplyBody('')
    setIsAiGeneratedReply(false)
    lastDraftHintRef.current = null
    setReplyMode('public')
    setReplyStatus('no_change')
    setReplySuccessMessage(null)
    setReplyErrorMessage(null)
  }

  return (
    <Stack spacing={2.5}>
      {/* ── Page header ── */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        gap={1.5}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 42,
              height: 42,
              bgcolor: '#0078d4',
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SupportAgentRoundedIcon sx={{ color: 'white', fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              Support Tickets
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Zendesk &middot;{' '}
              {lastSyncTimestamp
                ? `Last synced ${formatSyncTimestamp(lastSyncTimestamp)}`
                : 'Sync pending'}
            </Typography>
          </Box>
        </Stack>

        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          flexWrap={{ xs: 'wrap', md: 'nowrap' }}
          useFlexGap
          sx={{
            maxWidth: '100%',
            overflowX: { xs: 'visible', md: 'auto' },
            '&::-webkit-scrollbar': { height: 6 },
          }}
        >
          {alertCards.map((card) => {
            const isSelected = selectedAlertBucket === card.key

            return (
              <Chip
                key={`header-alert-${card.key}`}
                size="small"
                clickable
                onClick={() => handleAlertCardClick(card.key as AlertBucketKey)}
                label={`${card.label}: ${card.value}`}
                variant={isSelected ? 'filled' : 'outlined'}
                sx={{
                  height: 24,
                  borderColor: isSelected ? card.color : `${card.color}88`,
                  bgcolor: isSelected ? card.color : 'transparent',
                  color: isSelected ? '#fff' : card.color,
                  '& .MuiChip-label': {
                    px: 1,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  },
                }}
              />
            )
          })}

          {helpdeskUrl ? (
            <Button
              variant="outlined"
              color="inherit"
              href={helpdeskUrl}
              target="_blank"
              rel="noreferrer"
              startIcon={<OpenInNewRoundedIcon />}
              size="small"
              sx={{ minHeight: 30, fontSize: '0.76rem', px: 1.25 }}
            >
              Open Helpdesk
            </Button>
          ) : null}
          <Button
            variant="contained"
            onClick={handleRefresh}
            startIcon={isFetchingAny ? <CircularProgress size={14} color="inherit" /> : <RefreshRoundedIcon />}
            disabled={isFetchingAny}
            size="small"
            sx={{
              bgcolor: '#0078d4',
              '&:hover': { bgcolor: '#106ebe' },
              minHeight: 30,
              minWidth: 92,
              fontSize: '0.76rem',
              px: 1.25,
            }}
          >
            {isFetchingAny ? 'Syncing…' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>

      {pageError ? <Alert severity="warning">{pageError}</Alert> : null}

      {isLoadingPage ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading support data…</Typography>
          </Stack>
        </Paper>
      ) : null}

      {/* ── Main two-column layout ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '380px minmax(0, 1fr)' },
          gap: 1.5,
          alignItems: 'start',
        }}
      >
        {/* ── Ticket sidebar (inbox style) ── */}
        <Paper
          variant="outlined"
          sx={{
            height: { xs: 596, md: 736, lg: 836 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            borderRadius: 1.5,
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: '#fafafa',
              flexShrink: 0,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>
                Inbox
              </Typography>
              <Chip
                label={sidebarTickets.length}
                size="small"
                sx={{ height: 18, fontSize: '0.68rem', fontWeight: 700 }}
              />
              {activeAlertFilterLabel ? (
                <Chip
                  label={activeAlertFilterLabel}
                  size="small"
                  color="warning"
                  variant="outlined"
                  onDelete={() => {
                    setSelectedAlertBucket(null)
                  }}
                />
              ) : null}
            </Stack>
          </Box>

          <Stack spacing={0} sx={{ flex: 1, overflowY: 'auto' }}>
            {sidebarTickets.map((ticket) => {
              const previewSnapshot: SupportTicketConversationSnapshot | null =
                expandedTicketPreviewId === ticket.id &&
                conversationQuery.data?.ticket.id === ticket.id
                  ? conversationQuery.data
                  : null
              const isPreviewLoading =
                conversationQuery.isFetching &&
                selectedTicketId === ticket.id &&
                !previewSnapshot
              const previewError =
                conversationQuery.isError && selectedTicketId === ticket.id
                  ? (conversationQuery.error instanceof Error
                      ? conversationQuery.error.message
                      : 'Failed to load preview.')
                  : null

              const isSelected = selectedTicketId === ticket.id
              const accentColor = getStatusAccentColor(ticket.status)

              return (
                <Accordion
                  key={`ticket-${ticket.id}`}
                  id={`sidebar-ticket-${ticket.id}`}
                  expanded={expandedTicketPreviewId === ticket.id}
                  onChange={(_event, expanded) => {
                    setExpandedTicketPreviewId(expanded ? ticket.id : false)
                    selectTicket(ticket.id)
                  }}
                  disableGutters
                  sx={{
                    boxShadow: 'none',
                    border: 'none',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '0 !important',
                    bgcolor: isSelected ? 'rgba(0,120,212,0.05)' : 'transparent',
                    '&::before': { display: 'none' },
                    '&.Mui-expanded': { margin: 0 },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />}
                    sx={{
                      minHeight: 0,
                      px: 0,
                      py: 0,
                      alignItems: 'flex-start',
                      '&.Mui-expanded': { minHeight: 0 },
                      '& .MuiAccordionSummary-content': { my: 0, minWidth: 0 },
                      '& .MuiAccordionSummary-content.Mui-expanded': { my: 0 },
                      '& .MuiAccordionSummary-expandIconWrapper': { mt: 1.5, mr: 1 },
                    }}
                  >
                    <Box
                      sx={{
                        borderLeft: `3px solid ${accentColor}`,
                        pl: 1.5,
                        pr: 0.5,
                        py: 1.25,
                        width: '100%',
                        minWidth: 0,
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.3 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} noWrap>
                          #{ticket.id}
                          {ticket.orderNumber ? ` · Order #${ticket.orderNumber}` : ''}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ whiteSpace: 'nowrap', ml: 1, flexShrink: 0 }}
                        >
                          {formatDateTime(ticket.updatedAt)}
                        </Typography>
                      </Stack>

                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.35 }}>
                        {ticket.requesterName}
                      </Typography>

                      <Typography
                        variant="body2"
                        fontWeight={isSelected ? 700 : 600}
                        color={isSelected ? '#0078d4' : 'text.primary'}
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          mb: 0.6,
                          lineHeight: 1.4,
                        }}
                      >
                        {ticket.subject || 'No subject'}
                      </Typography>

                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Chip
                          size="small"
                          label={ticket.statusLabel}
                          color={statusChipColor(ticket.status)}
                          variant="outlined"
                          sx={{ height: 18, fontSize: '0.68rem' }}
                        />
                        {ticket.assigneeName ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {ticket.assigneeName}
                          </Typography>
                        ) : null}
                      </Stack>
                    </Box>
                  </AccordionSummary>

                  <AccordionDetails sx={{ pt: 0, px: 1.25, pb: 1.25, bgcolor: 'rgba(0,0,0,0.015)' }}>
                    {isPreviewLoading ? (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
                        <CircularProgress size={13} />
                        <Typography variant="caption" color="text.secondary">
                          Loading messages…
                        </Typography>
                      </Stack>
                    ) : null}

                    {previewError ? (
                      <Typography variant="caption" color="error">
                        {previewError}
                      </Typography>
                    ) : null}

                    {previewSnapshot ? (
                      <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                        {[...previewSnapshot.comments]
                          .sort(
                            (left, right) =>
                              new Date(right.createdAt).getTime() -
                              new Date(left.createdAt).getTime(),
                          )
                          .map((comment) => {
                            const isCustomer =
                              comment.authorName === previewSnapshot.ticket.requesterName
                            const isInternal = !comment.public
                            const previewText = normalizeCommentText(comment.body, comment.htmlBody)

                            const borderColor = isInternal
                              ? '#f59e0b'
                              : isCustomer
                              ? '#0078d4'
                              : '#5e35b1'

                            return (
                              <Paper
                                key={comment.id}
                                variant="outlined"
                                onClick={() => {
                                  selectTicket(ticket.id)
                                  setPendingConversationJump({
                                    ticketId: ticket.id,
                                    commentId: comment.id,
                                  })
                                }}
                                sx={{
                                  px: 1.25,
                                  py: 0.85,
                                  cursor: 'pointer',
                                  overflow: 'hidden',
                                  borderLeft: `3px solid ${borderColor}`,
                                  transition: 'box-shadow 120ms ease',
                                  '&:hover': { boxShadow: 1 },
                                }}
                              >
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.2 }}>
                                  <Stack direction="row" spacing={0.5} alignItems="center">
                                    <Typography variant="caption" fontWeight={700} noWrap>
                                      {comment.authorName}
                                    </Typography>
                                    {isInternal ? (
                                      <LockOutlinedIcon sx={{ fontSize: 11, color: '#f59e0b' }} />
                                    ) : null}
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                                    {formatDateTime(comment.createdAt)}
                                  </Typography>
                                </Stack>
                                {commentSummariesQuery.isFetching && !commentSummaries[comment.id] ? (
                                  <Box sx={{ pt: 0.25 }}>
                                    <Skeleton animation="wave" height={14} sx={{ mb: 0.5 }} />
                                    <Skeleton animation="wave" height={14} width="72%" />
                                  </Box>
                                ) : (
                                  <Typography
                                    variant="body2"
                                    color="text.primary"
                                    sx={{
                                      display: '-webkit-box',
                                      WebkitLineClamp: 3,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                      lineHeight: 1.45,
                                    }}
                                  >
                                    {commentSummaries[comment.id] ?? buildPreviewParagraph(previewText, 120)}
                                  </Typography>
                                )}
                              </Paper>
                            )
                          })}

                        {previewSnapshot.comments.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            No messages yet.
                          </Typography>
                        ) : null}
                      </Stack>
                    ) : null}
                  </AccordionDetails>
                </Accordion>
              )
            })}

            {sidebarTickets.length === 0 && !isLoadingPage ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {activeAlertFilterLabel
                    ? `No tickets match ${activeAlertFilterLabel}.`
                    : 'No open tickets.'}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </Paper>

        <Stack spacing={1.5}>
          {/* ── Conversation panel (email thread) ── */}
          <Paper
          variant="outlined"
          sx={{
            height: { xs: 596, md: 736, lg: 836 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            borderRadius: 1.5,
          }}
          >
          {!selectedTicketId && !conversationSnapshot ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                p: 4,
              }}
            >
              <SupportAgentRoundedIcon sx={{ fontSize: 52, color: 'text.disabled' }} />
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Select a ticket from the sidebar to read the conversation
              </Typography>
            </Box>
          ) : null}

          {isLoadingConversation ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
              }}
            >
              <CircularProgress size={22} />
              <Typography color="text.secondary">Loading conversation…</Typography>
            </Box>
          ) : null}

          {conversationError ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="warning">{conversationError}</Alert>
            </Box>
          ) : null}

          {conversationSnapshot ? (
            <>
              {/* Email-style subject header */}
              <Box
                sx={{
                  px: 2.5,
                  py: 1.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: '#fafafa',
                  flexShrink: 0,
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  gap={1}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} variant="subtitle1" noWrap>
                      {conversationSnapshot.ticket.subject}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      flexWrap="wrap"
                      sx={{ mt: 0.4 }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        #{conversationSnapshot.ticket.id}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">&middot;</Typography>
                      <Typography variant="caption" color="text.secondary">
                        From: <strong>{conversationSnapshot.ticket.requesterName}</strong>
                      </Typography>
                      <Typography variant="caption" color="text.disabled">&middot;</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Assigned: <strong>{conversationSnapshot.ticket.assigneeName}</strong>
                      </Typography>
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
                    <Chip
                      size="small"
                      label={conversationSnapshot.ticket.statusLabel || conversationSnapshot.ticket.status}
                      color={statusChipColor(conversationSnapshot.ticket.status)}
                      variant="outlined"
                    />
                    {conversationSnapshot.ticket.url ? (
                      <Button
                        variant="outlined"
                        size="small"
                        color="inherit"
                        href={conversationSnapshot.ticket.url}
                        target="_blank"
                        rel="noreferrer"
                        startIcon={<OpenInNewRoundedIcon />}
                      >
                        Open Ticket
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>

              {/* Email thread */}
              <Stack
                spacing={1.5}
                ref={conversationThreadScrollRef}
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  scrollbarGutter: 'stable both-edges',
                  p: 1.75,
                  bgcolor: '#f3f2f1',
                }}
              >
                {conversationSnapshot.comments.map((comment) => {
                  const isCustomer =
                    comment.authorName === conversationSnapshot.ticket.requesterName
                  const isInternal = !comment.public
                  const cleanedBody = normalizeCommentText(comment.body, comment.htmlBody)
                  const sanitizedHtmlBody = sanitizeCommentHtml(comment.htmlBody)
                  const attachments = Array.isArray(comment.attachments) ? comment.attachments : []
                  const initials = getInitials(comment.authorName)

                  const avatarColor = isInternal ? '#b45309' : isCustomer ? '#0078d4' : '#5e35b1'
                  const headerBg = isInternal
                    ? 'rgba(245, 158, 11, 0.07)'
                    : isCustomer
                    ? 'rgba(0, 120, 212, 0.06)'
                    : '#fafafa'
                  const headerBorderColor = isInternal
                    ? 'rgba(245, 158, 11, 0.2)'
                    : isCustomer
                    ? 'rgba(0, 120, 212, 0.15)'
                    : 'rgba(0,0,0,0.08)'
                  const cardBorderColor = isInternal
                    ? 'rgba(245, 158, 11, 0.3)'
                    : isCustomer
                    ? 'rgba(0, 120, 212, 0.25)'
                    : 'rgba(0,0,0,0.1)'

                  return (
                    <Paper
                      key={comment.id}
                      id={`conversation-comment-${comment.id}`}
                      elevation={0}
                      sx={{
                        border: '1px solid',
                        borderColor: cardBorderColor,
                        borderRadius: 1.5,
                      }}
                    >
                      {/* Message header */}
                      <Box
                        sx={{
                          px: 2,
                          py: 1.25,
                          bgcolor: headerBg,
                          borderBottom: '1px solid',
                          borderColor: headerBorderColor,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.25,
                        }}
                      >
                        <Avatar
                          sx={{
                            width: 34,
                            height: 34,
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            bgcolor: avatarColor,
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Typography variant="body2" fontWeight={700} lineHeight={1.3}>
                              {comment.authorName}
                            </Typography>
                            {isInternal ? (
                              <Chip
                                size="small"
                                label="Internal Note"
                                icon={<LockOutlinedIcon />}
                                sx={{
                                  height: 17,
                                  fontSize: '0.64rem',
                                  bgcolor: 'rgba(245,158,11,0.12)',
                                  color: '#b45309',
                                  border: '1px solid rgba(245,158,11,0.3)',
                                  '& .MuiChip-icon': { fontSize: 11, color: '#b45309' },
                                }}
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {isInternal ? 'Internal Note' : isCustomer ? 'Customer' : 'Support Agent'}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {formatDateTime(comment.createdAt)}
                        </Typography>
                      </Box>

                      {/* Message body */}
                      <Box sx={{ px: 2.5, py: 2, bgcolor: 'white' }}>
                        {sanitizedHtmlBody ? (
                          <SupportCommentHtmlFrame sanitizedHtmlBody={sanitizedHtmlBody} />
                        ) : (
                          <Typography
                            variant="body1"
                            sx={{ whiteSpace: 'pre-line', lineHeight: 1.75, color: 'text.primary' }}
                          >
                            {cleanedBody || 'No readable text in this message.'}
                          </Typography>
                        )}

                        {attachments.length > 0 ? (
                          <Stack spacing={0.9} sx={{ mt: 1.6 }}>
                            <Typography variant="caption" color="text.secondary" fontWeight={700}>
                              Attachments
                            </Typography>

                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                              {attachments.map((attachment) => {
                                const isImage = String(attachment.contentType ?? '')
                                  .toLowerCase()
                                  .startsWith('image/')
                                const previewUrl = attachment.thumbnailUrl || (isImage ? attachment.url : null)
                                const fileSizeLabel = formatAttachmentSize(attachment.sizeBytes)

                                return (
                                  <Paper
                                    key={`${comment.id}-${attachment.id ?? attachment.url}`}
                                    component="a"
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    variant="outlined"
                                    sx={{
                                      width: { xs: '100%', sm: 190 },
                                      textDecoration: 'none',
                                      color: 'inherit',
                                      overflow: 'hidden',
                                      transition: 'box-shadow 120ms ease, border-color 120ms ease',
                                      '&:hover': {
                                        borderColor: 'primary.main',
                                        boxShadow: 1,
                                      },
                                    }}
                                  >
                                    {previewUrl ? (
                                      <Box
                                        component="img"
                                        src={previewUrl}
                                        alt={attachment.fileName}
                                        sx={{
                                          width: '100%',
                                          height: 96,
                                          objectFit: 'cover',
                                          display: 'block',
                                          bgcolor: '#f5f5f5',
                                        }}
                                      />
                                    ) : null}

                                    <Box sx={{ px: 1.1, py: 0.95 }}>
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          display: 'block',
                                          color: 'text.primary',
                                          fontWeight: 700,
                                          lineHeight: 1.35,
                                          wordBreak: 'break-word',
                                        }}
                                      >
                                        {attachment.fileName}
                                      </Typography>
                                      {fileSizeLabel ? (
                                        <Typography variant="caption" color="text.secondary">
                                          {fileSizeLabel}
                                        </Typography>
                                      ) : null}
                                    </Box>
                                  </Paper>
                                )
                              })}
                            </Stack>
                          </Stack>
                        ) : null}
                      </Box>
                    </Paper>
                  )
                })}

                {conversationSnapshot.comments.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No messages in this conversation.
                    </Typography>
                  </Box>
                ) : null}
              </Stack>

              <Box
                sx={{
                  p: 2,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  flexShrink: 0,
                }}
              >
                <Stack spacing={1.25}>
                  {replySuccessMessage ? <Alert severity="success">{replySuccessMessage}</Alert> : null}
                  {replyErrorMessage ? <Alert severity="warning">{replyErrorMessage}</Alert> : null}
                  {!canReplyAsLinkedZendeskUser ? (
                    <Alert severity="info">
                      Your account is not linked to a Zendesk agent yet. Ask an admin to assign one in Admin Users.
                    </Alert>
                  ) : null}

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    justifyContent="space-between"
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                    >
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={replyMode}
                        onChange={(_, value: 'public' | 'internal' | null) => {
                          if (!value) {
                            return
                          }
                          setReplyMode(value)
                        }}
                      >
                        <ToggleButton value="public">Public Reply</ToggleButton>
                        <ToggleButton value="internal">Internal Note</ToggleButton>
                      </ToggleButtonGroup>

                      <TextField
                        select
                        size="small"
                        label="Set Status"
                        value={replyStatus}
                        onChange={(event) => {
                          setReplyStatus(event.target.value as SupportReplyStatusOption)
                        }}
                        disabled={replyMutation.isPending || !canReplyAsLinkedZendeskUser}
                        sx={{ minWidth: { xs: '100%', sm: 190 } }}
                      >
                        <MenuItem value="no_change">Keep Current</MenuItem>
                        <MenuItem value="open">Open</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                        <MenuItem value="in_progress">In Progress</MenuItem>
                        <MenuItem value="solved">Solved</MenuItem>
                      </TextField>
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      Sending as {replyAuthorLabel}
                    </Typography>
                  </Stack>

                  <TextField
                    multiline
                    minRows={3}
                    maxRows={8}
                    placeholder={
                      replyMode === 'public'
                        ? 'Write a reply visible to the requester...'
                        : 'Write an internal note for your team...'
                    }
                    value={replyBody}
                    onChange={(event) => {
                      setReplyBody(event.target.value)
                      if (isAiGeneratedReply) setIsAiGeneratedReply(false)
                    }}
                    disabled={replyMutation.isPending || !canReplyAsLinkedZendeskUser}
                  />

                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Tooltip
                        title={
                          !conversationSnapshot
                            ? 'Select a ticket first'
                            : trimmedReplyBody
                            ? 'Improve my draft with AI'
                            : 'Generate AI reply draft'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => { void handleGenerateReply() }}
                            disabled={
                              !conversationSnapshot
                              || isGeneratingReply
                              || replyMutation.isPending
                            }
                            sx={{ color: '#7c3aed' }}
                          >
                            {isGeneratingReply
                              ? <CircularProgress size={16} sx={{ color: '#7c3aed' }} />
                              : <AutoAwesomeRoundedIcon sx={{ fontSize: 18 }} />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      {isAiGeneratedReply && trimmedReplyBody ? (
                        <Tooltip title="Tell AI what was wrong so it learns for next time">
                          <Button
                            size="small"
                            variant="text"
                            onClick={handleTeachAi}
                            sx={{ fontSize: '0.7rem', color: 'text.secondary', px: 0.75, py: 0, minWidth: 0 }}
                          >
                            Teach AI
                          </Button>
                        </Tooltip>
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {trimmedReplyBody.length.toLocaleString()} / {replyCharacterLimit.toLocaleString()}
                      </Typography>
                    </Stack>

                    <Button
                      variant="contained"
                      onClick={() => {
                        void handleSubmitReply()
                      }}
                      disabled={
                        replyMutation.isPending
                        || !canReplyAsLinkedZendeskUser
                        || !trimmedReplyBody
                        || trimmedReplyBody.length > replyCharacterLimit
                      }
                    >
                      {replyMutation.isPending
                        ? 'Sending...'
                        : replyMode === 'public'
                          ? 'Send Public Reply'
                          : 'Add Internal Note'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </>
          ) : null}
          </Paper>
        </Stack>
      </Box>
    </Stack>
  )
}
