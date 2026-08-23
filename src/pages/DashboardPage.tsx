import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../features/api-client'
import {
  fetchDashboardBootstrap,
  type DashboardOrder,
} from '../features/dashboard/api'
import {
  DashboardMetricCard,
  type DashboardMetricCardData,
} from '../features/dashboard/DashboardMetricCard'
import { buildDashboardOrderGroups } from '../features/dashboard/orderGroups'
import { postOrdersRefresh } from '../features/orders/api'
import { formatDateTime, formatDisplayDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type DrilldownKey =
  | 'lateOrders'
  | 'dueSoonOrders'
  | 'dueInTwoWeeksOrders'
  | 'readyOrders'
  | 'activeOrders'
  | 'missingDueDateOrders'
  | 'missingCustomerSignedBolOrders'

const drilldownTitles: Record<DrilldownKey, string> = {
  lateOrders: 'Late Orders',
  dueSoonOrders: 'Due In Next 7 Days',
  dueInTwoWeeksOrders: 'Due In Days 8 to 14',
  readyOrders: 'Ready Orders',
  activeOrders: 'Active Orders',
  missingDueDateOrders: 'Missing Due Date',
  missingCustomerSignedBolOrders: 'Shipped Orders Missing Customer Signed BOLs',
}

function dueLabel(order: DashboardOrder) {
  if (order.isDone) {
    return 'Shipped'
  }

  if (order.isProductionStarted === false) {
    return 'Not in production'
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

  if (order.isProductionStarted === false) {
    return 'default'
  }

  if (order.isLate) {
    return 'error'
  }

  if (typeof order.daysUntilDue === 'number' && order.daysUntilDue <= 7) {
    return 'warning'
  }

  return 'default'
}

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeDrilldown, setActiveDrilldown] = useState<DrilldownKey | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshWarningMessage, setRefreshWarningMessage] = useState<string | null>(null)
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

  const snapshot = bootstrapQuery.data?.mondaySnapshot ?? null
  const zendeskSnapshot = bootstrapQuery.data?.zendeskSnapshot ?? null
  const isLoading = bootstrapQuery.isLoading
  const errorMessage = bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : null

  const handleRefresh = useCallback(() => {
    void (async () => {
      setIsRefreshing(true)
      setRefreshMessage(null)
      setRefreshWarningMessage(null)

      let ordersRefreshWarning: string | null = null

      try {
        await postOrdersRefresh()

        await queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.ordersOverview,
        })
      } catch (ordersRefreshError) {
        const warningMessage = ordersRefreshError instanceof Error
          ? ordersRefreshError.message
          : 'Orders sync failed. Dashboard will refresh from current merged records.'

        ordersRefreshWarning = warningMessage
      }

      try {
        await queryClient.fetchQuery({
          queryKey: QUERY_KEYS.dashboardBootstrap,
          queryFn: () => fetchDashboardBootstrap({ refresh: true }),
          staleTime: 0,
        })

        if (ordersRefreshWarning) {
          setRefreshWarningMessage(ordersRefreshWarning)
        } else {
          setRefreshMessage('Dashboard refreshed successfully.')
        }
      } catch (dashboardRefreshError) {
        const dashboardMessage = dashboardRefreshError instanceof Error
          ? dashboardRefreshError.message
          : 'Could not refresh dashboard right now.'

        setRefreshWarningMessage(
          ordersRefreshWarning
            ? `${dashboardMessage} Orders sync warning: ${ordersRefreshWarning}`
            : dashboardMessage,
        )
      } finally {
        setIsRefreshing(false)
      }
    })()
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
      const query = new URLSearchParams({ orderId })
      const response = await apiFetch(`/api/dashboard/monday/shop-drawing/download?${query.toString()}`)
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
  }, [clearShopDrawingPreviewObjectUrl])

  const orderGroups = useMemo(
    () => buildDashboardOrderGroups(snapshot?.orders ?? []),
    [snapshot],
  )
  const missingCustomerSignedBolOrders = useMemo(
    () => (snapshot?.orders ?? []).filter((order) => order.customerSignedBolMissing === true),
    [snapshot],
  )

  const summaryCards = useMemo<DashboardMetricCardData<DrilldownKey>[]>(() => {
    if (!snapshot) {
      return []
    }

    return [
      {
        key: 'lateOrders',
        label: 'Late Orders',
        value: orderGroups.lateOrders.length,
        helper: 'Past due · action required',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#c62828',
      },
      {
        key: 'dueSoonOrders',
        label: 'Due This Week',
        value: orderGroups.dueThisWeekOrders.length,
        helper: 'Due today through day 7',
        icon: <ScheduleRoundedIcon />,
        color: '#ef6c00',
      },
      {
        key: 'dueInTwoWeeksOrders',
        label: 'Due in 2 Weeks',
        value: orderGroups.dueInTwoWeeksOrders.length,
        helper: 'Due in 8 to 14 days',
        icon: <TaskAltRoundedIcon />,
        color: '#00897b',
      },
      {
        key: 'readyOrders',
        label: 'Ready Orders',
        value: orderGroups.readyOrders.length,
        helper: 'Production complete · ready to ship',
        icon: <CheckCircleRoundedIcon />,
        color: '#2e7d32',
      },
      {
        key: 'activeOrders',
        label: 'In Progress',
        value: orderGroups.inProgressOrders.length,
        helper: 'Active production · excludes ready',
        icon: <AccessTimeRoundedIcon />,
        color: '#1565c0',
      },
      {
        key: 'missingDueDateOrders',
        label: 'Missing Due Date',
        value: orderGroups.missingDueDateOrders.length,
        helper: 'Schedule required',
        icon: <FactCheckRoundedIcon />,
        color: '#6a1b9a',
      },
      {
        key: 'missingCustomerSignedBolOrders',
        label: 'Shipped Missing Customer BOLs',
        value: missingCustomerSignedBolOrders.length,
        helper: 'Shipped orders needing upload',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#ad1457',
      },
    ]
  }, [missingCustomerSignedBolOrders, orderGroups, snapshot])

  const zendeskSummaryCards = useMemo<DashboardMetricCardData[]>(() => {
    if (!zendeskSnapshot) {
      return []
    }

    return [
      {
        key: 'newTickets',
        label: 'New',
        value: zendeskSnapshot.metrics.newTickets,
        helper: 'Awaiting first review',
        icon: <MarkEmailUnreadRoundedIcon />,
        color: '#1e88e5',
      },
      {
        key: 'inProgressTickets',
        label: 'In Progress',
        value: zendeskSnapshot.metrics.inProgressTickets,
        helper: 'Actively being handled',
        icon: <EngineeringRoundedIcon />,
        color: '#5e35b1',
      },
      {
        key: 'openTickets',
        label: 'Open',
        value: zendeskSnapshot.metrics.openTickets,
        helper: 'Requires follow-up',
        icon: <AccessTimeRoundedIcon />,
        color: '#fb8c00',
      },
      {
        key: 'pendingTickets',
        label: 'Pending',
        value: zendeskSnapshot.metrics.pendingTickets,
        helper: 'Waiting for a response',
        icon: <PendingActionsRoundedIcon />,
        color: '#8d6e63',
      },
      {
        key: 'solvedTickets',
        label: 'Solved',
        value: zendeskSnapshot.metrics.solvedTickets,
        helper: 'Completed requests',
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
      return orderGroups.dueInTwoWeeksOrders
    }

    if (activeDrilldown === 'readyOrders') {
      return orderGroups.readyOrders
    }

    if (activeDrilldown === 'dueSoonOrders') {
      return orderGroups.dueThisWeekOrders
    }

    if (activeDrilldown === 'activeOrders') {
      return orderGroups.inProgressOrders
    }

    if (activeDrilldown === 'missingDueDateOrders') {
      return orderGroups.missingDueDateOrders
    }

    if (activeDrilldown === 'missingCustomerSignedBolOrders') {
      return missingCustomerSignedBolOrders
    }

    return orderGroups.lateOrders
  }, [activeDrilldown, missingCustomerSignedBolOrders, orderGroups, snapshot])

  const handleViewOrder = useCallback((order: DashboardOrder) => {
    const orderId = String(order.mondayItemId ?? order.id ?? '').trim()

    if (!orderId) {
      return
    }

    const query = new URLSearchParams({ orderId })

    if (activeDrilldown === 'missingCustomerSignedBolOrders') {
      query.set('tab', 'shipping')
    }

    navigate(`/orders?${query.toString()}`)
  }, [activeDrilldown, navigate])

  const handleOpenTicketQueue = useCallback((key: string) => {
    const statusByMetric: Record<string, string> = {
      newTickets: 'new',
      inProgressTickets: 'in_progress',
      openTickets: 'open',
      pendingTickets: 'pending',
      solvedTickets: 'solved',
    }
    const status = statusByMetric[key]
    navigate(status ? `/support?status=${status}` : '/support')
  }, [navigate])

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
            Operations Dashboard
          </Typography>
          {snapshot ? (
            <Typography color="text.secondary">
              Production, shipping, and service performance · Updated {formatDateTime(snapshot.generatedAt)}
            </Typography>
          ) : (
            <Typography color="text.secondary">Production, shipping, and service performance</Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1.25}>
          <Button
            variant="contained"
            onClick={handleRefresh}
            startIcon={<RefreshRoundedIcon />}
            disabled={isRefreshing || bootstrapQuery.isFetching}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>

      {errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : null}

      {refreshMessage ? (
        <Alert
          severity="success"
          onClose={() => {
            setRefreshMessage(null)
          }}
        >
          {refreshMessage}
        </Alert>
      ) : null}

      {refreshWarningMessage ? (
        <Alert
          severity="warning"
          onClose={() => {
            setRefreshWarningMessage(null)
          }}
        >
          {refreshWarningMessage}
        </Alert>
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
          <Box component="section">
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1}
              >
                <Typography variant="h6" fontWeight={700}>
                  Production Overview
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
                Live workload from {snapshot.board.name}. Ready orders are excluded from upcoming work.
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(7, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                {summaryCards.map(({ key, ...card }) => (
                  <DashboardMetricCard
                    key={key}
                    {...card}
                    onClick={() => setActiveDrilldown(key)}
                  />
                ))}
              </Box>
            </Stack>
          </Box>

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
                        <TableCell align="right">View</TableCell>
                        <TableCell align="right">Monday</TableCell>
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
                        const paidInFull = typeof order.paidInFull === 'boolean'
                          ? order.paidInFull
                          : null
                        const managerReadyPercent = typeof order.managerReadyPercent === 'number'
                          ? Math.max(0, Math.min(100, Math.round(order.managerReadyPercent)))
                          : null
                        const displayProgressPercent = activeDrilldown === 'readyOrders'
                          ? (managerReadyPercent ?? order.progressPercent)
                          : order.progressPercent

                        return (
                        <TableRow key={order.id} hover>
                          <TableCell>
                            <Typography fontWeight={600}>{order.name}</Typography>
                          </TableCell>
                          <TableCell>{order.groupTitle}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={order.rowStatus || order.statusLabel || 'Unspecified'}
                            />
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
                            {typeof displayProgressPercent === 'number' ? (
                              <Button
                                size="small"
                                variant="text"
                                sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}
                                onClick={() => handleViewOrder(order)}
                              >
                                {`${displayProgressPercent}%`}
                              </Button>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            {paidInFull === null ? (
                              '—'
                            ) : (
                              <Chip
                                size="small"
                                label={paidInFull ? 'Yes' : 'No'}
                                color={paidInFull ? 'success' : 'warning'}
                                variant="outlined"
                              />
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
                            <Button
                              size="small"
                              onClick={() => handleViewOrder(order)}
                              endIcon={<VisibilityRoundedIcon sx={{ fontSize: 16 }} />}
                            >
                              Open
                            </Button>
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
        <Box component="section">
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              gap={1}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Support Overview
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Live service workload from Zendesk
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
              {zendeskSummaryCards.map(({ key, ...card }) => (
                <DashboardMetricCard
                  key={key}
                  {...card}
                  onClick={() => handleOpenTicketQueue(key)}
                />
              ))}
            </Box>
          </Stack>
        </Box>
      ) : null}
    </Stack>
  )
}
