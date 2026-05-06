import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import {
  fetchCrmQuotes,
  type CrmOpportunityStage,
  type CrmQuote,
} from '../features/crm/api'
import { resolveQuoteAgeDays } from '../features/crm/utils'
import {
  fetchDashboardBootstrap,
  type DashboardOrder,
} from '../features/dashboard/api'
import { formatDateTime, formatDisplayDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type DrilldownKey =
  | 'lateOrders'
  | 'dueSoonOrders'
  | 'dueInTwoWeeksOrders'
  | 'activeOrders'
  | 'missingDueDateOrders'

type SummaryCard<K extends string = string> = {
  key: K
  label: string
  value: number
  helper: string
  icon: ReactNode
  color: string
}

type PipelineStageSummary = {
  id: CrmOpportunityStage
  label: string
  color: string
}

const pipelineStages: PipelineStageSummary[] = [
  { id: 'concept', label: '1. Concept', color: '#0b5f93' },
  { id: 'proposal_submission', label: '2. Proposal Submitted', color: '#0a6c99' },
  { id: 'revision', label: '3. Revision', color: '#1d6ea5' },
  { id: 'waiting_response', label: '4. Waiting Response', color: '#3f6597' },
  { id: 'order_placement', label: '5. Order Placement', color: '#2f7b57' },
]

const drilldownTitles: Record<DrilldownKey, string> = {
  lateOrders: 'Late Orders',
  dueSoonOrders: 'Due In Next 7 Days',
  dueInTwoWeeksOrders: 'Due In Next 14 Days',
  activeOrders: 'Active Orders',
  missingDueDateOrders: 'Missing Due Date',
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function dueLabel(order: DashboardOrder) {
  if (order.isDone) {
    return 'Shipped'
  }

  if (typeof order.daysUntilDue !== 'number') {
    return 'No due date'
  }

  if (order.daysUntilDue < 0) {
    return `${Math.abs(order.daysUntilDue)}d late`
  }

  if (order.daysUntilDue === 0) {
    return 'Due today'
  }

  return `${order.daysUntilDue}d left`
}

function dueColor(order: DashboardOrder): 'error' | 'warning' | 'success' | 'default' {
  if (order.isDone) {
    return 'success'
  }

  if (order.isLate) {
    return 'error'
  }

  if (typeof order.daysUntilDue === 'number' && order.daysUntilDue <= 7) {
    return 'warning'
  }

  return 'default'
}

function resolveOpportunityStage(quote: CrmQuote): CrmOpportunityStage {
  const explicitStage = String(quote.opportunityStage || '').trim()

  if (pipelineStages.some((stage) => stage.id === explicitStage)) {
    return explicitStage as CrmOpportunityStage
  }

  if (quote.status === 'accepted') {
    return 'order_placement'
  }

  if (quote.status === 'sent') {
    return 'waiting_response'
  }

  return 'concept'
}

export default function DashboardPage() {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const [activeDrilldown, setActiveDrilldown] = useState<DrilldownKey | null>(null)
  const [shopDrawingPreviewOrder, setShopDrawingPreviewOrder] = useState<DashboardOrder | null>(null)
  const [shopDrawingPreviewSrc, setShopDrawingPreviewSrc] = useState('')
  const [isShopDrawingPreviewLoading, setIsShopDrawingPreviewLoading] = useState(false)
  const [shopDrawingErrorMessage, setShopDrawingErrorMessage] = useState<string | null>(null)
  const shopDrawingPreviewObjectUrlRef = useRef<string | null>(null)

  const bootstrapQuery = useQuery({
    queryKey: QUERY_KEYS.dashboardBootstrap,
    queryFn: () => fetchDashboardBootstrap({ refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  const opportunitiesQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesQuotes,
    queryFn: () => fetchCrmQuotes({ limit: 700, status: 'all' }),
    staleTime: 60 * 1000,
  })

  const snapshot = bootstrapQuery.data?.mondaySnapshot ?? null
  const zendeskSnapshot = bootstrapQuery.data?.zendeskSnapshot ?? null
  const isLoading = bootstrapQuery.isLoading
  const errorMessage = bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : null
  const opportunitiesErrorMessage = opportunitiesQuery.error instanceof Error
    ? opportunitiesQuery.error.message
    : null

  const opportunities = useMemo(
    () => Array.isArray(opportunitiesQuery.data?.quotes) ? opportunitiesQuery.data.quotes : [],
    [opportunitiesQuery.data?.quotes],
  )

  const activeOpportunities = useMemo(
    () => opportunities.filter((quote) => quote.status !== 'rejected' && quote.status !== 'cancelled'),
    [opportunities],
  )

  const opportunitiesByStage = useMemo(() => {
    const base: Record<CrmOpportunityStage, CrmQuote[]> = {
      concept: [],
      proposal_submission: [],
      revision: [],
      waiting_response: [],
      order_placement: [],
    }

    for (const quote of activeOpportunities) {
      const stage = resolveOpportunityStage(quote)
      base[stage].push(quote)
    }

    return base
  }, [activeOpportunities])

  const pipelineMetrics = useMemo(() => {
    const open = opportunitiesByStage.concept.length
      + opportunitiesByStage.proposal_submission.length
      + opportunitiesByStage.revision.length
      + opportunitiesByStage.waiting_response.length
    const converted = opportunitiesByStage.order_placement.length
    const convertedAfterThirty = opportunitiesByStage.order_placement
      .filter((quote) => resolveQuoteAgeDays(quote) > 30)
      .length
    const waitingThirty = opportunitiesByStage.waiting_response
      .filter((quote) => resolveQuoteAgeDays(quote) > 30)
      .length

    return {
      open,
      converted,
      convertedAfterThirty,
      waitingThirty,
    }
  }, [opportunitiesByStage])

  const handleRefresh = useCallback(() => {
    void queryClient.fetchQuery({
      queryKey: QUERY_KEYS.dashboardBootstrap,
      queryFn: () => fetchDashboardBootstrap({ refresh: true }),
      staleTime: 0,
    })
  }, [queryClient])

  const clearShopDrawingPreviewObjectUrl = useCallback(() => {
    if (shopDrawingPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(shopDrawingPreviewObjectUrlRef.current)
      shopDrawingPreviewObjectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearShopDrawingPreviewObjectUrl()
    }
  }, [clearShopDrawingPreviewObjectUrl])

  const handleCloseShopDrawingPreview = useCallback(() => {
    clearShopDrawingPreviewObjectUrl()
    setIsShopDrawingPreviewLoading(false)
    setShopDrawingPreviewSrc('')
    setShopDrawingPreviewOrder(null)
  }, [clearShopDrawingPreviewObjectUrl])

  const handleOpenShopDrawingPreview = useCallback(async (order: DashboardOrder) => {
    const orderId = String(order?.id ?? '').trim()
    const cachedPreviewUrl = String(order?.shopDrawingCachedUrl ?? '').trim()
    const sourcePreviewUrl = String(order?.shopDrawingUrl ?? '').trim()

    if (!orderId || (!cachedPreviewUrl && !sourcePreviewUrl)) {
      setShopDrawingErrorMessage('No shop drawing is available for this order yet.')
      return
    }

    setShopDrawingErrorMessage(null)
    clearShopDrawingPreviewObjectUrl()
    setShopDrawingPreviewSrc('')
    setIsShopDrawingPreviewLoading(true)
    setShopDrawingPreviewOrder(order)

    if (cachedPreviewUrl) {
      setShopDrawingPreviewSrc(cachedPreviewUrl)
      return
    }

    try {
      const idToken = await getIdToken()
      const query = new URLSearchParams({ orderId })
      const response = await fetch(
        `/api/dashboard/monday/shop-drawing/download?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
            'x-client-platform': 'web',
          },
        },
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const message = typeof payload?.error === 'string'
          ? payload.error
          : 'Could not load shop drawing preview.'
        throw new Error(message)
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      shopDrawingPreviewObjectUrlRef.current = objectUrl
      setShopDrawingPreviewSrc(objectUrl)
    } catch (requestError) {
      setIsShopDrawingPreviewLoading(false)
      setShopDrawingPreviewOrder(null)
      setShopDrawingPreviewSrc('')
      setShopDrawingErrorMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load shop drawing preview.',
      )
    }
  }, [clearShopDrawingPreviewObjectUrl, getIdToken])

  const dueInTwoWeeksOrders = useMemo(
    () => (snapshot?.orders ?? []).filter(
      (order) => !order.isDone
        && typeof order.daysUntilDue === 'number'
        && order.daysUntilDue >= 0
        && order.daysUntilDue <= 14,
    ),
    [snapshot],
  )

  const summaryCards = useMemo<SummaryCard<DrilldownKey>[]>(() => {
    if (!snapshot) {
      return []
    }

    return [
      {
        key: 'lateOrders',
        label: 'Late Orders',
        value: snapshot.metrics.lateOrders,
        helper: 'Needs immediate action',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#c62828',
      },
      {
        key: 'dueSoonOrders',
        label: 'Due This Week',
        value: snapshot.metrics.dueSoonOrders,
        helper: 'Upcoming within 7 days',
        icon: <ScheduleRoundedIcon />,
        color: '#ef6c00',
      },
      {
        key: 'dueInTwoWeeksOrders',
        label: 'Due In 2 Weeks',
        value: dueInTwoWeeksOrders.length,
        helper: 'Upcoming within 14 days',
        icon: <TaskAltRoundedIcon />,
        color: '#00897b',
      },
      {
        key: 'activeOrders',
        label: 'In Progress',
        value: snapshot.metrics.activeOrders,
        helper: 'Open production workload',
        icon: <AccessTimeRoundedIcon />,
        color: '#1565c0',
      },
      {
        key: 'missingDueDateOrders',
        label: 'Missing Due Date',
        value: snapshot.metrics.missingDueDateOrders,
        helper: 'Cannot forecast lateness yet',
        icon: <FactCheckRoundedIcon />,
        color: '#6a1b9a',
      },
    ]
  }, [snapshot, dueInTwoWeeksOrders])

  const zendeskSummaryCards = useMemo<SummaryCard[]>(() => {
    if (!zendeskSnapshot) {
      return []
    }

    return [
      {
        key: 'newTickets',
        label: 'New',
        value: zendeskSnapshot.metrics.newTickets,
        helper: 'Brand new tickets',
        icon: <MarkEmailUnreadRoundedIcon />,
        color: '#1e88e5',
      },
      {
        key: 'inProgressTickets',
        label: 'In Process',
        value: zendeskSnapshot.metrics.inProgressTickets,
        helper: 'Tickets with status In Progress',
        icon: <EngineeringRoundedIcon />,
        color: '#5e35b1',
      },
      {
        key: 'openTickets',
        label: 'Open',
        value: zendeskSnapshot.metrics.openTickets,
        helper: 'Tickets with status open',
        icon: <AccessTimeRoundedIcon />,
        color: '#fb8c00',
      },
      {
        key: 'pendingTickets',
        label: 'Pending',
        value: zendeskSnapshot.metrics.pendingTickets,
        helper: 'Waiting for customer response',
        icon: <PendingActionsRoundedIcon />,
        color: '#8d6e63',
      },
      {
        key: 'solvedTickets',
        label: 'Solved',
        value: zendeskSnapshot.metrics.solvedTickets,
        helper: 'Done',
        icon: <TaskAltRoundedIcon />,
        color: '#2e7d32',
      },
    ]
  }, [zendeskSnapshot])

  const drilldownOrders = useMemo(() => {
    if (!activeDrilldown || !snapshot) {
      return []
    }

    if (activeDrilldown === 'dueInTwoWeeksOrders') {
      return dueInTwoWeeksOrders
    }

    return snapshot.details[activeDrilldown]
  }, [activeDrilldown, dueInTwoWeeksOrders, snapshot])

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Order Dashboard
          </Typography>
          {snapshot ? (
            <Typography color="text.secondary">
              {snapshot.board.name} • Last sync {formatDateTime(snapshot.generatedAt)}
            </Typography>
          ) : (
            <Typography color="text.secondary">Live monday.com board intelligence</Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1.25}>
          <Button
            variant="contained"
            onClick={handleRefresh}
            startIcon={<RefreshRoundedIcon />}
            disabled={bootstrapQuery.isFetching}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : null}

      {shopDrawingErrorMessage ? (
        <Alert
          severity="warning"
          onClose={() => {
            setShopDrawingErrorMessage(null)
          }}
        >
          {shopDrawingErrorMessage}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
            gap={1}
          >
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Sales Pipeline Snapshot
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Overall opportunity health across all stages.
              </Typography>
            </Box>
          </Stack>

          {opportunitiesQuery.isLoading ? (
            <Stack direction="row" spacing={1.25} alignItems="center">
              <CircularProgress size={18} />
              <Typography color="text.secondary">Loading pipeline data...</Typography>
            </Stack>
          ) : opportunitiesErrorMessage ? (
            <Alert severity="warning">{opportunitiesErrorMessage}</Alert>
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: 1,
                }}
              >
                <Paper variant="outlined" sx={{ p: 1.25, borderLeft: '4px solid #0f4c81' }}>
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">Open Opportunities</Typography>
                      <Typography variant="h5" fontWeight={800}>{pipelineMetrics.open}</Typography>
                    </Box>
                    <WorkspacesRoundedIcon sx={{ color: '#0f4c81' }} />
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.25, borderLeft: '4px solid #166534' }}>
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">Converted</Typography>
                      <Typography variant="h5" fontWeight={800}>{pipelineMetrics.converted}</Typography>
                    </Box>
                    <AssignmentTurnedInRoundedIcon sx={{ color: '#166534' }} />
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.25, borderLeft: '4px solid #14532d' }}>
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">30+ Day Converted</Typography>
                      <Typography variant="h5" fontWeight={800}>{pipelineMetrics.convertedAfterThirty}</Typography>
                    </Box>
                    <TaskAltRoundedIcon sx={{ color: '#14532d' }} />
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.25, borderLeft: '4px solid #b45309' }}>
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">Waiting 30+ Days</Typography>
                      <Typography variant="h5" fontWeight={800}>{pipelineMetrics.waitingThirty}</Typography>
                    </Box>
                    <ScheduleRoundedIcon sx={{ color: '#b45309' }} />
                  </Stack>
                </Paper>
              </Box>
            </>
          )}
        </Stack>
      </Paper>

      {isLoading ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading dashboard data...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {snapshot ? (
        <>
          <Paper variant="outlined" sx={{ p: 2.25 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1}
              >
                <Typography variant="h6" fontWeight={700}>
                  Order Progress
                </Typography>

                {snapshot.board.url ? (
                  <Button
                    variant="outlined"
                    color="inherit"
                    href={snapshot.board.url}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<OpenInNewRoundedIcon />}
                  >
                    Open Board
                  </Button>
                ) : null}
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Orders from Monday board: {snapshot.board.name}
              </Typography>

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
                {summaryCards.map((card) => (
                  <Paper
                    key={card.key}
                    variant="outlined"
                    onClick={() => setActiveDrilldown(card.key as DrilldownKey)}
                    sx={{
                      p: 2,
                      borderLeft: `4px solid ${card.color}`,
                      cursor: 'pointer',
                      transition: 'transform 120ms ease, box-shadow 120ms ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: 3,
                      },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {card.label}
                        </Typography>
                        <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                          {card.value}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {card.helper}
                        </Typography>
                      </Box>
                      <Box sx={{ color: card.color }}>{card.icon}</Box>
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Stack>
          </Paper>

          <Dialog
            open={Boolean(activeDrilldown)}
            onClose={() => setActiveDrilldown(null)}
            maxWidth="lg"
            fullWidth
          >
            <DialogTitle>{activeDrilldown ? drilldownTitles[activeDrilldown] : 'Details'}</DialogTitle>
            <DialogContent>
              {drilldownOrders.length === 0 ? (
                <Typography color="text.secondary">No orders in this section.</Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Order</TableCell>
                        <TableCell>Group</TableCell>
                        <TableCell>Workflow</TableCell>
                        <TableCell>Lead-Time Due</TableCell>
                        <TableCell>Progress</TableCell>
                        <TableCell>Paid</TableCell>
                        <TableCell align="right">Shop Drawing</TableCell>
                        <TableCell align="right">Link</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {drilldownOrders.map((order) => {
                        const hasShopDrawing = Boolean(
                          String(order.shopDrawingCachedUrl ?? '').trim()
                          || String(order.shopDrawingUrl ?? '').trim(),
                        )
                        const isCurrentPreviewLoading = Boolean(
                          isShopDrawingPreviewLoading
                          && shopDrawingPreviewOrder?.id === order.id,
                        )
                        const invoiceNumber = String(order.invoiceNumber ?? '').trim()
                        const hasInvoice = Boolean(invoiceNumber)
                        const paidInFull = order.paidInFull === true
                        const notPaidInFull = order.paidInFull === false
                        const amountOwed = Number.isFinite(order.amountOwed)
                          ? Number(order.amountOwed)
                          : null
                        const hasPositiveBalance = amountOwed !== null && amountOwed > 0
                        const shouldShowNotPaidInFull = hasInvoice && (notPaidInFull || hasPositiveBalance)
                        const shouldShowPaid = hasInvoice && !shouldShowNotPaidInFull && paidInFull

                        return (
                        <TableRow key={order.id} hover>
                          <TableCell>
                            <Typography fontWeight={600}>{order.name}</Typography>
                          </TableCell>
                          <TableCell>{order.groupTitle}</TableCell>
                          <TableCell>
                            <Chip size="small" label={order.statusLabel || 'Unspecified'} />
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.2}>
                              <Typography variant="body2">
                                {formatDisplayDate(order.effectiveDueDate)}
                              </Typography>
                              <Chip
                                size="small"
                                label={dueLabel(order)}
                                color={dueColor(order)}
                                variant="outlined"
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {typeof order.progressPercent === 'number' ? `${order.progressPercent}%` : '—'}
                          </TableCell>
                          <TableCell>
                            {!hasInvoice ? (
                              <Typography variant="body2" color="text.secondary">
                                No invoice
                              </Typography>
                            ) : shouldShowNotPaidInFull ? (
                              <Stack spacing={0.2}>
                                <Typography variant="body2" color="warning.dark" fontWeight={700}>
                                  Not paid in full
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Owed: {hasPositiveBalance ? formatUsd(amountOwed as number) : 'Unknown'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Invoice: {invoiceNumber}
                                </Typography>
                              </Stack>
                            ) : shouldShowPaid ? (
                              <Stack spacing={0.2}>
                                <Typography variant="body2" color="success.main" fontWeight={700}>
                                  Paid
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Invoice: {invoiceNumber}
                                </Typography>
                              </Stack>
                            ) : (
                              <Stack spacing={0.2}>
                                <Typography variant="body2" color="text.secondary" fontWeight={600}>
                                  Invoice status unknown
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Invoice: {invoiceNumber}
                                </Typography>
                                {amountOwed !== null ? (
                                  <Typography variant="caption" color="text.secondary">
                                    Owed: {formatUsd(amountOwed)}
                                  </Typography>
                                ) : null}
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {hasShopDrawing ? (
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={
                                  isCurrentPreviewLoading
                                    ? <CircularProgress size={12} color="inherit" />
                                    : <VisibilityRoundedIcon sx={{ fontSize: 16 }} />
                                }
                                onClick={() => {
                                  void handleOpenShopDrawingPreview(order)
                                }}
                                disabled={isCurrentPreviewLoading}
                              >
                                {isCurrentPreviewLoading ? 'Loading...' : 'Preview'}
                              </Button>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                Not available
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {order.itemUrl ? (
                              <Button
                                size="small"
                                href={order.itemUrl}
                                target="_blank"
                                rel="noreferrer"
                                endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 16 }} />}
                              >
                                Open
                              </Button>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                No link
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(shopDrawingPreviewOrder)}
            onClose={handleCloseShopDrawingPreview}
            fullWidth
            maxWidth="lg"
          >
            <DialogTitle>
              {shopDrawingPreviewOrder
                ? `Shop Drawing Preview - ${shopDrawingPreviewOrder.name}`
                : 'Shop Drawing Preview'}
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
              {isShopDrawingPreviewLoading && !shopDrawingPreviewSrc ? (
                <Stack
                  spacing={1}
                  alignItems="center"
                  justifyContent="center"
                  sx={{
                    height: { xs: '56vh', md: '64vh' },
                    p: 2,
                  }}
                >
                  <CircularProgress size={28} />
                  <Typography variant="body2" color="text.secondary">
                    Loading preview...
                  </Typography>
                </Stack>
              ) : shopDrawingPreviewSrc ? (
                <Box sx={{ height: { xs: '72vh', md: '80vh' }, position: 'relative' }}>
                  {isShopDrawingPreviewLoading ? (
                    <Stack
                      spacing={1}
                      alignItems="center"
                      justifyContent="center"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        bgcolor: 'rgba(255, 255, 255, 0.85)',
                        zIndex: 1,
                      }}
                    >
                      <CircularProgress size={28} />
                      <Typography variant="body2" color="text.secondary">
                        Loading preview...
                      </Typography>
                    </Stack>
                  ) : null}
                  <iframe
                    key={shopDrawingPreviewSrc}
                    src={shopDrawingPreviewSrc}
                    title="Shop Drawing Preview"
                    onLoad={() => {
                      setIsShopDrawingPreviewLoading(false)
                    }}
                    onError={() => {
                      setIsShopDrawingPreviewLoading(false)
                      setShopDrawingErrorMessage('Could not load shop drawing preview.')
                    }}
                    style={{ width: '100%', height: '100%', border: 0 }}
                  />
                </Box>
              ) : (
                <Stack sx={{ p: 2 }}>
                  <Typography color="text.secondary">No preview is available.</Typography>
                </Stack>
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {zendeskSnapshot ? (
        <Paper variant="outlined" sx={{ p: 2.25 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              gap={1}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Tickets Progress
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Tickets from Zendesk helpdesk
                </Typography>
              </Box>

              {zendeskSnapshot.agentUrl ? (
                <Button
                  variant="outlined"
                  color="inherit"
                  href={zendeskSnapshot.agentUrl}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={<OpenInNewRoundedIcon />}
                >
                  Open Helpdesk
                </Button>
              ) : null}
            </Stack>

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
              {zendeskSummaryCards.map((card) => (
                <Paper
                  key={card.key}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderLeft: `4px solid ${card.color}`,
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {card.label}
                      </Typography>
                      <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                        {card.value}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {card.helper}
                      </Typography>
                    </Box>
                    <Box sx={{ color: card.color }}>{card.icon}</Box>
                  </Stack>
                </Paper>
              ))}
            </Box>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}