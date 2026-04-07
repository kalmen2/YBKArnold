import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchSupportAlertTickets,
  fetchSupportAlerts,
  fetchSupportTicketConversation,
  fetchSupportTickets,
  type SupportAlertTicketsSnapshot,
  type SupportAlertsSnapshot,
  type SupportTicketConversationSnapshot,
  type SupportTicketsSnapshot,
} from '../features/support/api'
import {
  fetchZendeskTicketSummary,
  type ZendeskTicketSummarySnapshot,
} from '../features/dashboard/api'

type AlertBucketKey =
  | 'newOver24Hours'
  | 'openOver24Hours'
  | 'inProgressOver48Hours'
  | 'pendingOver48Hours'

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

  if (!rawBody.trim()) {
    return ''
  }

  let decodedBody = rawBody

  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    const parser = new window.DOMParser()
    const parsed = parser.parseFromString(rawBody, 'text/html')
    decodedBody = parsed.documentElement.textContent ?? rawBody
  }

  return decodedBody
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

export default function SupportPage() {
  const [alertsSnapshot, setAlertsSnapshot] = useState<SupportAlertsSnapshot | null>(null)
  const [alertTicketsSnapshot, setAlertTicketsSnapshot] =
    useState<SupportAlertTicketsSnapshot | null>(null)
  const [zendeskSummarySnapshot, setZendeskSummarySnapshot] =
    useState<ZendeskTicketSummarySnapshot | null>(null)
  const [ticketsSnapshot, setTicketsSnapshot] = useState<SupportTicketsSnapshot | null>(null)
  const [conversationSnapshot, setConversationSnapshot] =
    useState<SupportTicketConversationSnapshot | null>(null)
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [pendingSidebarTicketScrollId, setPendingSidebarTicketScrollId] = useState<number | null>(
    null,
  )
  const [pendingConversationJump, setPendingConversationJump] = useState<
    { ticketId: number; commentId: number } | null
  >(null)
  const [selectedAlertBucket, setSelectedAlertBucket] = useState<AlertBucketKey | null>(null)
  const [expandedTicketPreviewId, setExpandedTicketPreviewId] = useState<number | false>(false)
  const [previewSnapshotsByTicketId, setPreviewSnapshotsByTicketId] = useState<
    Record<number, SupportTicketConversationSnapshot>
  >({})
  const [previewErrorsByTicketId, setPreviewErrorsByTicketId] = useState<
    Record<number, string>
  >({})

  const [isLoadingPage, setIsLoadingPage] = useState(true)
  const [isLoadingAlertTickets, setIsLoadingAlertTickets] = useState(false)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [loadingPreviewTicketId, setLoadingPreviewTicketId] = useState<number | null>(null)
  const [isMetricsPanelExpanded, setIsMetricsPanelExpanded] = useState(true)

  const [pageError, setPageError] = useState<string | null>(null)
  const [alertTicketError, setAlertTicketError] = useState<string | null>(null)
  const [conversationError, setConversationError] = useState<string | null>(null)

  const loadPage = useCallback(async (refreshRequested = false) => {
    setIsLoadingPage(true)
    setPageError(null)

    const [alertsResult, alertTicketsResult, ticketsResult, zendeskSummaryResult] = await Promise.allSettled([
      fetchSupportAlerts({ refresh: refreshRequested }),
      fetchSupportAlertTickets(100, { refresh: refreshRequested }),
      fetchSupportTickets(100, { refresh: refreshRequested }),
      fetchZendeskTicketSummary({ refresh: refreshRequested }),
    ])

    if (alertsResult.status === 'fulfilled') {
      setAlertsSnapshot(alertsResult.value)
    }

    if (alertTicketsResult.status === 'fulfilled') {
      setAlertTicketsSnapshot(alertTicketsResult.value)
      setAlertTicketError(null)
    }

    if (ticketsResult.status === 'fulfilled') {
      setTicketsSnapshot(ticketsResult.value)
    }

    if (zendeskSummaryResult.status === 'fulfilled') {
      setZendeskSummarySnapshot(zendeskSummaryResult.value)
    } else {
      setZendeskSummarySnapshot(null)
    }

    if (
      alertsResult.status === 'rejected' ||
      alertTicketsResult.status === 'rejected' ||
      ticketsResult.status === 'rejected' ||
      zendeskSummaryResult.status === 'rejected'
    ) {
      setPageError('Failed to load Zendesk support data.')
    }

    setIsLoadingPage(false)
  }, [])

  const loadAlertTickets = useCallback(async () => {
    setIsLoadingAlertTickets(true)
    setAlertTicketError(null)

    try {
      const snapshot = await fetchSupportAlertTickets(100)
      setAlertTicketsSnapshot(snapshot)
    } catch (error) {
      setAlertTicketError(
        error instanceof Error ? error.message : 'Failed to load alert ticket lists.',
      )
    } finally {
      setIsLoadingAlertTickets(false)
    }
  }, [])

  const loadConversation = useCallback(async (ticketId: number) => {
    setIsLoadingConversation(true)
    setConversationError(null)

    try {
      const snapshot = await fetchSupportTicketConversation(ticketId)
      setConversationSnapshot(snapshot)
      setPreviewSnapshotsByTicketId((prev) => ({
        ...prev,
        [ticketId]: snapshot,
      }))
    } catch (error) {
      setConversationSnapshot(null)
      setConversationError(error instanceof Error ? error.message : 'Failed to load conversation.')
    } finally {
      setIsLoadingConversation(false)
    }
  }, [])

  const loadTicketPreview = useCallback(async (ticketId: number) => {
    if (previewSnapshotsByTicketId[ticketId]) {
      return
    }

    setLoadingPreviewTicketId(ticketId)

    try {
      const snapshot = await fetchSupportTicketConversation(ticketId)
      setPreviewSnapshotsByTicketId((prev) => ({
        ...prev,
        [ticketId]: snapshot,
      }))
      setPreviewErrorsByTicketId((prev) => {
        const next = { ...prev }
        delete next[ticketId]
        return next
      })
    } catch (error) {
      setPreviewErrorsByTicketId((prev) => ({
        ...prev,
        [ticketId]:
          error instanceof Error ? error.message : 'Failed to load preview conversation.',
      }))
    } finally {
      setLoadingPreviewTicketId((current) => (current === ticketId ? null : current))
    }
  }, [previewSnapshotsByTicketId])

  useEffect(() => {
    void loadPage(false)
  }, [loadPage])

  useEffect(() => {
    if (!selectedTicketId) {
      setConversationSnapshot(null)
      setConversationError(null)
      return
    }

    void loadConversation(selectedTicketId)
  }, [loadConversation, selectedTicketId])

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
      setPendingConversationJump(null)
      return
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

  const ticketProgressCards = useMemo(() => {
    const metrics = zendeskSummarySnapshot?.metrics

    return [
      {
        key: 'newTickets',
        label: 'New',
        value: metrics?.newTickets ?? 0,
        helper: 'Brand new tickets',
        color: '#1e88e5',
      },
      {
        key: 'inProgressTickets',
        label: 'In Process',
        value: metrics?.inProgressTickets ?? 0,
        helper: 'Tickets in process',
        color: '#5e35b1',
      },
      {
        key: 'openTickets',
        label: 'Open',
        value: metrics?.openTickets ?? 0,
        helper: 'Tickets with status open',
        color: '#fb8c00',
      },
      {
        key: 'pendingTickets',
        label: 'Pending',
        value: metrics?.pendingTickets ?? 0,
        helper: 'Waiting for customer response',
        color: '#8d6e63',
      },
      {
        key: 'solvedTickets',
        label: 'Solved',
        value: metrics?.solvedTickets ?? 0,
        helper: 'Done',
        color: '#2e7d32',
      },
    ]
  }, [zendeskSummarySnapshot])

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

  const alertBucketTickets = useMemo(() => {
    if (!selectedAlertBucket || !alertTicketsSnapshot) {
      return []
    }

    return alertTicketsSnapshot.buckets[selectedAlertBucket] ?? []
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

  const helpdeskUrl =
    alertsSnapshot?.agentUrl ||
    ticketsSnapshot?.agentUrl ||
    zendeskSummarySnapshot?.agentUrl ||
    null

  const handleAlertCardClick = async (bucketKey: AlertBucketKey) => {
    const isSameBucket = selectedAlertBucket === bucketKey

    if (isSameBucket) {
      setSelectedAlertBucket(null)
      return
    }

    setSelectedAlertBucket(bucketKey)

    if (!alertTicketsSnapshot) {
      await loadAlertTickets()
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        gap={1.25}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Customer Support
          </Typography>
          <Typography color="text.secondary">
            Zendesk ticket operations, conversations, and aging alerts
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.25}>
          {helpdeskUrl ? (
            <Button
              variant="outlined"
              color="inherit"
              href={helpdeskUrl}
              target="_blank"
              rel="noreferrer"
              startIcon={<OpenInNewRoundedIcon />}
            >
              Open Helpdesk
            </Button>
          ) : null}

          <Button
            variant="contained"
            onClick={() => void loadPage(true)}
            startIcon={<RefreshRoundedIcon />}
            disabled={isLoadingPage}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {pageError ? <Alert severity="warning">{pageError}</Alert> : null}
      {alertTicketError ? <Alert severity="warning">{alertTicketError}</Alert> : null}

      {isLoadingPage && !alertsSnapshot && !ticketsSnapshot && !zendeskSummarySnapshot ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading support page...</Typography>
          </Stack>
        </Paper>
      ) : null}

      <Accordion
        disableGutters
        expanded={isMetricsPanelExpanded}
        onChange={(_event, expanded) => setIsMetricsPanelExpanded(expanded)}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 2.25 }}>
          <Stack spacing={0.35}>
            <Typography variant="subtitle1" fontWeight={700}>
              Tickets Progress & Aging Alerts
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Collapse this panel to give the ticket sidebar and conversation more room.
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, px: 2.25, pb: 2.25 }}>
          <Stack spacing={2}>
            <Stack spacing={1}>
              
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(5, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                {ticketProgressCards.map((card) => (
                  <Paper
                    key={card.key}
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderLeft: `4px solid ${card.color}`,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {card.label}
                    </Typography>
                    <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                      {card.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {card.helper}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Stack>

            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>
                Aging Alerts
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                {alertCards.map((card) => (
                  <Paper
                    key={card.key}
                    variant="outlined"
                    onClick={() => void handleAlertCardClick(card.key as AlertBucketKey)}
                    sx={{
                      p: 2,
                      borderLeft: `4px solid ${card.color}`,
                      cursor: 'pointer',
                      transition: 'transform 120ms ease, box-shadow 120ms ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: 2,
                      },
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {card.label}
                    </Typography>
                    <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                      {card.value}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Stack>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {selectedAlertBucket ? (
        <Paper variant="outlined" sx={{ p: 2.25 }}>
          <Stack spacing={1.25}>
            <Typography variant="h6" fontWeight={700}>
              {alertBucketLabelMap[selectedAlertBucket]} Tickets
            </Typography>

            {isLoadingAlertTickets && !alertTicketsSnapshot ? (
              <Stack direction="row" spacing={1.25} alignItems="center">
                <CircularProgress size={20} />
                <Typography color="text.secondary">Loading alert tickets...</Typography>
              </Stack>
            ) : null}

            <TableContainer sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Order #</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Assignee</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {alertBucketTickets.map((ticket) => (
                    <TableRow
                      key={`alert-${selectedAlertBucket}-${ticket.id}`}
                      hover
                      onClick={() => {
                        setSelectedTicketId(ticket.id)
                        setExpandedTicketPreviewId(ticket.id)
                        setPendingSidebarTicketScrollId(ticket.id)
                        void loadTicketPreview(ticket.id)
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>#{ticket.id}</TableCell>
                      <TableCell>{ticket.orderNumber || '—'}</TableCell>
                      <TableCell>{ticket.subject}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={ticket.statusLabel}
                          color={statusChipColor(ticket.status)}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{ticket.assigneeName}</TableCell>
                      <TableCell>{formatDateTime(ticket.updatedAt)}</TableCell>
                    </TableRow>
                  ))}

                  {alertBucketTickets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography color="text.secondary">
                          No tickets in this alert bucket.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(1, minmax(0, 1fr))',
            lg: '380px minmax(0, 1fr)',
          },
          gap: 1.25,
          alignItems: 'start',
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            height: { xs: 560, md: 700, lg: 780 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <Stack spacing={1} sx={{ minHeight: 0, height: '100%' }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Tickets
            </Typography>

            <Stack spacing={0.65} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
              {openTickets.map((ticket) => {
                const previewSnapshot =
                  previewSnapshotsByTicketId[ticket.id] ||
                  (conversationSnapshot?.ticket.id === ticket.id ? conversationSnapshot : null)
                const previewError = previewErrorsByTicketId[ticket.id]
                const isPreviewLoading = loadingPreviewTicketId === ticket.id

                return (
                  <Accordion
                    key={`ticket-${ticket.id}`}
                    id={`sidebar-ticket-${ticket.id}`}
                    expanded={expandedTicketPreviewId === ticket.id}
                    onChange={(_event, expanded) => {
                      setExpandedTicketPreviewId(expanded ? ticket.id : false)
                      setSelectedTicketId(ticket.id)

                      if (expanded) {
                        void loadTicketPreview(ticket.id)
                      }
                    }}
                    disableGutters
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      overflow: 'visible',
                      '&:not(.Mui-expanded)': {
                        minHeight: 130,
                      },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreRoundedIcon />}
                      sx={{
                        minHeight: 210,
                        px: 1.25,
                        py: 1.5,
                        alignItems: 'flex-start',
                        '&.Mui-expanded': {
                          minHeight: 210,
                        },
                        '& .MuiAccordionSummary-content': {
                          my: 0,
                          minWidth: 0,
                          alignItems: 'flex-start',
                        },
                        '& .MuiAccordionSummary-content.Mui-expanded': {
                          my: 0,
                        },
                        '& .MuiAccordionSummary-expandIconWrapper': {
                          mt: 0.25,
                        },
                      }}
                    >
                      <Stack spacing={0.9} sx={{ minWidth: 0, width: '100%' }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700} sx={{ flexShrink: 0 }}>
                            #{ticket.id}
                          </Typography>
                          {ticket.orderNumber ? (
                            <Typography variant="body2" fontWeight={700} color="text.secondary" noWrap>
                              Order {ticket.orderNumber}
                            </Typography>
                          ) : null}
                        </Stack>
                        <Typography
                          variant="body2"
                          color="text.primary"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          Subject: {ticket.subject || 'No subject'}
                        </Typography>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Chip
                            size="small"
                            label={ticket.statusLabel}
                            color={statusChipColor(ticket.status)}
                            variant="outlined"
                          />
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(ticket.updatedAt)}
                          </Typography>
                        </Stack>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0, px: 1.25, pb: 1.25 }}>
                      {isPreviewLoading ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <CircularProgress size={16} />
                          <Typography variant="body2" color="text.secondary">
                            Loading preview...
                          </Typography>
                        </Stack>
                      ) : null}

                      {previewError ? (
                        <Typography variant="body2" color="error">
                          {previewError}
                        </Typography>
                      ) : null}

                      {previewSnapshot ? (
                        <Stack spacing={0.6}>
                          {[...previewSnapshot.comments]
                            .sort(
                              (left, right) =>
                                new Date(left.createdAt).getTime() -
                                new Date(right.createdAt).getTime(),
                            )
                            .map((comment) => (
                            <Paper
                              key={comment.id}
                              variant="outlined"
                              onClick={() => {
                                setSelectedTicketId(ticket.id)
                                setPendingConversationJump({
                                  ticketId: ticket.id,
                                  commentId: comment.id,
                                })
                              }}
                              sx={{
                                p: 0.9,
                                height: 108,
                                cursor: 'pointer',
                                overflow: 'hidden',
                                transition: 'border-color 120ms ease, box-shadow 120ms ease',
                                '&:hover': {
                                  borderColor: 'primary.main',
                                  boxShadow: 1,
                                },
                              }}
                            >
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {comment.authorName} • {formatDateTime(comment.createdAt)}
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  mt: 0.35,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  whiteSpace: 'normal',
                                }}
                              >
                                {buildPreviewParagraph(comment.body)}
                              </Typography>
                            </Paper>
                            ))}

                          {previewSnapshot.comments.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                              No conversation comments yet.
                            </Typography>
                          ) : null}
                        </Stack>
                      ) : null}
                    </AccordionDetails>
                  </Accordion>
                )
              })}

              {openTickets.length === 0 ? (
                <Typography color="text.secondary">No open tickets.</Typography>
              ) : null}
            </Stack>
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            height: { xs: 560, md: 700, lg: 780 },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <Stack spacing={1.25} sx={{ minHeight: 0, height: '100%', overflow: 'hidden' }}>
            <Typography variant="h6" fontWeight={700}>
              Conversation
            </Typography>

              {!selectedTicketId ? (
                <Typography color="text.secondary">Select a ticket from the middle column.</Typography>
              ) : null}

              {isLoadingConversation ? (
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography color="text.secondary">Loading conversation...</Typography>
                </Stack>
              ) : null}

              {conversationError ? <Alert severity="warning">{conversationError}</Alert> : null}

              {conversationSnapshot ? (
                <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <Paper variant="outlined" sx={{ p: 1.25 }}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      justifyContent="space-between"
                      gap={1}
                    >
                      <Box>
                        <Typography fontWeight={700}>{conversationSnapshot.ticket.subject}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Ticket #{conversationSnapshot.ticket.id} • {conversationSnapshot.ticket.requesterName} → {conversationSnapshot.ticket.assigneeName}
                        </Typography>
                      </Box>

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
                  </Paper>

                  <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
                    {conversationSnapshot.comments.map((comment) => {
                      const cleanedBody = normalizeCommentBody(comment.body)

                      return (
                        <Paper
                          key={comment.id}
                          id={`conversation-comment-${comment.id}`}
                          variant="outlined"
                          sx={{ p: 1.25 }}
                        >
                          <Stack direction="row" justifyContent="space-between" gap={1}>
                            <Typography fontWeight={600}>{comment.authorName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDateTime(comment.createdAt)}
                            </Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-line', mt: 0.75 }}>
                            {cleanedBody || 'No content'}
                          </Typography>
                        </Paper>
                      )
                    })}

                    {conversationSnapshot.comments.length === 0 ? (
                      <Typography color="text.secondary">No conversation comments yet.</Typography>
                    ) : null}
                  </Stack>
                </Stack>
              ) : null}
          </Stack>
        </Paper>
      </Box>

    </Stack>
  )
}
