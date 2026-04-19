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
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchSupportAlertTickets,
  fetchSupportAlerts,
  fetchSupportTicketConversation,
  fetchSupportTickets,
  type SupportTicketConversationSnapshot,
} from '../features/support/api'
import {
  fetchZendeskTicketSummary,
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
  const queryClient = useQueryClient()

  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [pendingSidebarTicketScrollId, setPendingSidebarTicketScrollId] = useState<number | null>(
    null,
  )
  const [pendingConversationJump, setPendingConversationJump] = useState<
    { ticketId: number; commentId: number } | null
  >(null)
  const [selectedAlertBucket, setSelectedAlertBucket] = useState<AlertBucketKey | null>(null)
  const [expandedTicketPreviewId, setExpandedTicketPreviewId] = useState<number | false>(false)
  const [isMetricsPanelExpanded, setIsMetricsPanelExpanded] = useState(true)

  // ---------------------------------------------------------------------------
  // Data queries — all 4 page queries share staleTime: 3 min (matches backend cache)
  // zendeskQuery uses the shared ['dashboard', 'zendesk'] key so navigating
  // Dashboard → Support never fires a duplicate Zendesk request.
  // ---------------------------------------------------------------------------
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

  const zendeskQuery = useQuery({
    queryKey: ['dashboard', 'zendesk'],
    queryFn: () => fetchZendeskTicketSummary({ refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  // Conversation for the selected ticket — cached 15 min so re-selecting a ticket
  // is instant (no network call). gcTime keeps prior conversations alive in memory.
  const conversationQuery = useQuery({
    queryKey: ['support', 'conversation', selectedTicketId],
    queryFn: () => fetchSupportTicketConversation(selectedTicketId!),
    enabled: selectedTicketId !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  // Derived values from queries
  const alertsSnapshot = alertsQuery.data ?? null
  const alertTicketsSnapshot = alertTicketsQuery.data ?? null
  const ticketsSnapshot = ticketsQuery.data ?? null
  const zendeskSummarySnapshot = zendeskQuery.data ?? null
  const conversationSnapshot = conversationQuery.data ?? null

  const isLoadingPage =
    (alertsQuery.isLoading || ticketsQuery.isLoading || zendeskQuery.isLoading) &&
    !alertsSnapshot && !ticketsSnapshot && !zendeskSummarySnapshot

  const isLoadingConversation = conversationQuery.isFetching && !conversationSnapshot

  const pageError =
    (alertsQuery.isError || ticketsQuery.isError || zendeskQuery.isError) &&
    !alertsSnapshot && !ticketsSnapshot && !zendeskSummarySnapshot
      ? 'Failed to load Zendesk support data.'
      : null

  const conversationError = conversationQuery.isError
    ? (conversationQuery.error instanceof Error
        ? conversationQuery.error.message
        : 'Failed to load conversation.')
    : null

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ['support'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'zendesk'] })
  }

  // Scroll to a specific comment once the conversation loads
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

  // Scroll the sidebar ticket row into view after selecting from an alert table
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

  const lastSyncTimestamp = useMemo(() => {
    const timestamps = [
      alertsSnapshot?.generatedAt,
      ticketsSnapshot?.generatedAt,
      zendeskSummarySnapshot?.generatedAt,
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
  }, [alertsSnapshot, ticketsSnapshot, zendeskSummarySnapshot, alertTicketsSnapshot])

  function handleAlertCardClick(bucketKey: AlertBucketKey) {
    const isSameBucket = selectedAlertBucket === bucketKey

    if (isSameBucket) {
      setSelectedAlertBucket(null)
      return
    }

    setSelectedAlertBucket(bucketKey)
    // alertTicketsQuery is always fetched on mount; no manual load needed
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


        </Box>
      </Stack>

      {pageError ? <Alert severity="warning">{pageError}</Alert> : null}

      {isLoadingPage ? (
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
              {lastSyncTimestamp
                ? `Last sync ${formatSyncTimestamp(lastSyncTimestamp)}`
                : 'Last sync unavailable'}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, px: 2.25, pb: 2.25 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              justifyContent="flex-end"
              alignItems={{ xs: 'stretch', sm: 'center' }}
            >
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
                onClick={handleRefresh}
                startIcon={<RefreshRoundedIcon />}
                disabled={alertsQuery.isFetching || ticketsQuery.isFetching || zendeskQuery.isFetching}
              >
                Refresh
              </Button>
            </Stack>

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
                    onClick={() => handleAlertCardClick(card.key as AlertBucketKey)}
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

            {alertTicketsQuery.isLoading ? (
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
                // Preview data comes from the conversation query cache.
                // React Query caches each ticket's conversation for 15 min,
                // so switching between tickets is instant after the first load.
                const previewSnapshot: SupportTicketConversationSnapshot | null =
                  expandedTicketPreviewId === ticket.id && conversationQuery.data?.ticket.id === ticket.id
                    ? conversationQuery.data
                    : null
                const isPreviewLoading =
                  conversationQuery.isFetching && selectedTicketId === ticket.id && !previewSnapshot
                const previewError =
                  conversationQuery.isError && selectedTicketId === ticket.id
                    ? (conversationQuery.error instanceof Error
                        ? conversationQuery.error.message
                        : 'Failed to load preview conversation.')
                    : null

                return (
                  <Accordion
                    key={`ticket-${ticket.id}`}
                    id={`sidebar-ticket-${ticket.id}`}
                    expanded={expandedTicketPreviewId === ticket.id}
                    onChange={(_event, expanded) => {
                      setExpandedTicketPreviewId(expanded ? ticket.id : false)
                      setSelectedTicketId(ticket.id)
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
