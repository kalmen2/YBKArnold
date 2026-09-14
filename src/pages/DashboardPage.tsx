import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import PriceCheckRoundedIcon from '@mui/icons-material/PriceCheckRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
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
import { useAuth } from '../auth/useAuth'
import { apiFetch } from '../features/api-client'
import {
  fetchDashboardBootstrap,
  fetchSalesTrend,
  type DashboardOrder,
} from '../features/dashboard/api'
import { BerryMiniCard, BerryStatCard, type DashboardCardData } from '../features/dashboard/BerryStatCard'
import { SalesTrendCard } from '../features/dashboard/SalesTrendCard'
import { buildDashboardOrderGroups } from '../features/dashboard/orderGroups'
import { fetchOrdersOverview, postOrdersRefresh } from '../features/orders/api'
import { formatDateTime, formatDisplayDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type DrilldownKey =
  | 'lateOrders'
  | 'dueSoonOrders'
  | 'dueInTwoWeeksOrders'
  | 'readyOrders'
  | 'missingDueDateOrders'
  | 'missingCustomerSignedBolOrders'
  | 'missingQuickBooksProjectOrders'
  | 'missingOrderValueOrders'
  | 'missingOrderDateOrders'
  | 'onMondayNotOnSiteOrders'

const drilldownTitles: Record<DrilldownKey, string> = {
  lateOrders: 'Late Orders',
  dueSoonOrders: 'Due In Next 7 Days',
  dueInTwoWeeksOrders: 'Due In Days 8 to 14',
  readyOrders: 'Ready Orders',
  missingDueDateOrders: 'Missing Due Date',
  missingCustomerSignedBolOrders: 'Shipped Orders Missing Customer Signed BOLs',
  missingQuickBooksProjectOrders: 'Orders With No QuickBooks Project',
  missingOrderValueOrders: 'Orders With No Order Value',
  missingOrderDateOrders: 'Orders With No Real Order Date',
  onMondayNotOnSiteOrders: 'On Monday, Never Reached The Website',
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
  const { appUser } = useAuth()
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
        // The sales chart reads a separate server-side aggregate. It renders
        // its own error state, so a failure here must not fail the refresh.
        await queryClient
          .fetchQuery({
            queryKey: QUERY_KEYS.dashboardSalesTrend,
            queryFn: () => fetchSalesTrend({ refresh: true }),
            staleTime: 0,
          })
          .catch(() => undefined)

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

  // The previous owner's imported orders are history, not production work.
  // Grouping them made 2021 jobs show up as late orders.
  const orderGroups = useMemo(
    () => buildDashboardOrderGroups(
      (snapshot?.orders ?? []).filter((order) => order.isPriorOwner !== true),
    ),
    [snapshot],
  )
  const missingCustomerSignedBolOrders = useMemo(
    () => (snapshot?.orders ?? []).filter((order) => order.customerSignedBolMissing === true),
    [snapshot],
  )
  const missingQuickBooksProjectOrders = useMemo(
    () => (snapshot?.orders ?? []).filter((order) => order.missingQuickBooksProject === true),
    [snapshot],
  )
  const missingOrderValueOrders = useMemo(
    () => (snapshot?.orders ?? []).filter((order) => order.missingOrderValue === true),
    [snapshot],
  )
  const missingOrderDateOrders = useMemo(
    () => (snapshot?.orders ?? []).filter((order) => order.missingOrderDate === true),
    [snapshot],
  )
  // These never became website orders, so they only exist in the refresh
  // summary — there is no row in snapshot.orders to filter for.
  const onMondayNotOnSiteOrders = useMemo(
    () => snapshot?.details?.onMondayNotOnSiteOrders ?? [],
    [snapshot],
  )

  // Top row is the production picture only, in Berry's four solid colour
  // blocks. Anything that means "a record needs fixing" drops to the small
  // cards below the sales chart instead of competing with it.
  // Built whether or not the snapshot has arrived. Without a snapshot every
  // value is null, the cards render at full size with a skeleton in place of
  // the number, and the page below them never has to move.
  const summaryCards = useMemo<(DashboardCardData<DrilldownKey> & { bgcolor: string })[]>(() => {
    return [
      {
        key: 'lateOrders',
        label: 'Late Orders',
        value: snapshot ? orderGroups.lateOrders.length : null,
        helper: 'Past due · action required',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#c62828',
        bgcolor: 'error.main',
      },
      {
        key: 'dueSoonOrders',
        label: 'Due This Week',
        value: snapshot ? orderGroups.dueThisWeekOrders.length : null,
        helper: 'Due today through day 7',
        icon: <ScheduleRoundedIcon />,
        color: '#ef6c00',
        bgcolor: 'primary.dark',
      },
      {
        key: 'dueInTwoWeeksOrders',
        label: 'Due in 2 Weeks',
        value: snapshot ? orderGroups.dueInTwoWeeksOrders.length : null,
        helper: 'Due in 8 to 14 days',
        icon: <TaskAltRoundedIcon />,
        color: '#00897b',
        bgcolor: 'secondary.main',
      },
      {
        key: 'readyOrders',
        label: 'Ready Orders',
        value: snapshot ? orderGroups.readyOrders.length : null,
        helper: 'Production complete · ready to ship',
        icon: <CheckCircleRoundedIcon />,
        color: '#2e7d32',
        bgcolor: 'success.dark',
      },
    ]
  }, [orderGroups, snapshot])

  const attentionCards = useMemo<DashboardCardData<DrilldownKey>[]>(() => {
    return [
      {
        key: 'missingDueDateOrders',
        label: 'Missing Due Date',
        value: snapshot ? orderGroups.missingDueDateOrders.length : null,
        helper: 'Schedule required',
        icon: <FactCheckRoundedIcon />,
        color: '#6a1b9a',
      },
      {
        key: 'missingCustomerSignedBolOrders',
        label: 'Shipped Missing Customer BOLs',
        value: snapshot ? missingCustomerSignedBolOrders.length : null,
        helper: 'Shipped orders needing upload',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#ad1457',
      },
      {
        key: 'missingQuickBooksProjectOrders',
        label: 'No QuickBooks Project',
        value: snapshot ? missingQuickBooksProjectOrders.length : null,
        helper: 'Nothing to bill the work against',
        icon: <ReceiptLongRoundedIcon />,
        color: '#00695c',
      },
      {
        key: 'missingOrderValueOrders',
        label: 'No Order Value',
        value: snapshot ? missingOrderValueOrders.length : null,
        helper: 'Counts as $0 in sales',
        icon: <PriceCheckRoundedIcon />,
        color: '#b8860b',
      },
      {
        key: 'missingOrderDateOrders',
        label: 'No Real Order Date',
        value: snapshot ? missingOrderDateOrders.length : null,
        helper: 'Blank, or a date guessed from the number',
        icon: <EventBusyRoundedIcon />,
        color: '#5e35b1',
      },
      {
        key: 'onMondayNotOnSiteOrders',
        label: 'On Monday, Not On Site',
        value: snapshot ? onMondayNotOnSiteOrders.length : null,
        helper: 'Would be lost if Monday is switched off',
        icon: <CloudOffRoundedIcon />,
        color: '#d84315',
      },
    ]
  }, [
    missingCustomerSignedBolOrders,
    missingOrderDateOrders,
    missingOrderValueOrders,
    onMondayNotOnSiteOrders,
    missingQuickBooksProjectOrders,
    orderGroups,
    snapshot,
  ])


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

    if (activeDrilldown === 'missingDueDateOrders') {
      return orderGroups.missingDueDateOrders
    }

    if (activeDrilldown === 'missingCustomerSignedBolOrders') {
      return missingCustomerSignedBolOrders
    }

    if (activeDrilldown === 'missingQuickBooksProjectOrders') {
      return missingQuickBooksProjectOrders
    }

    if (activeDrilldown === 'missingOrderValueOrders') {
      return missingOrderValueOrders
    }

    if (activeDrilldown === 'missingOrderDateOrders') {
      return missingOrderDateOrders
    }

    if (activeDrilldown === 'onMondayNotOnSiteOrders') {
      return onMondayNotOnSiteOrders
    }

    return orderGroups.lateOrders
  }, [
    activeDrilldown,
    missingCustomerSignedBolOrders,
    missingOrderDateOrders,
    missingOrderValueOrders,
    missingQuickBooksProjectOrders,
    onMondayNotOnSiteOrders,
    orderGroups,
    snapshot,
  ])

  // Every row in a drilldown has an Open button that navigates to the Orders
  // page, and that page cannot paint until the orders list has loaded. Fetching
  // it while the user is still reading the table turns that wait into no wait.
  useEffect(() => {
    if (!activeDrilldown) {
      return
    }

    void queryClient.prefetchQuery({
      queryKey: QUERY_KEYS.ordersOverview,
      queryFn: fetchOrdersOverview,
      staleTime: 60 * 1000,
    })
  }, [activeDrilldown, queryClient])

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


  return (
    // Berry centres its dashboard at the lg breakpoint (1200px) rather than
    // filling the screen. On a wide monitor that stops four cards stretching
    // into strips and keeps the numbers readable. Applied here rather than in
    // the layout: the Orders grid and Chat genuinely need the full width.
    <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 1200, mx: 'auto' }}>
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

      <Box
        component="section"
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(1, minmax(0, 1fr))',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 2.5,
        }}
      >
        {summaryCards.map((card) => (
          <BerryStatCard
            key={card.key}
            value={card.value}
            title={card.label}
            caption={card.helper}
            icon={card.icon}
            bgcolor={card.bgcolor}
            onClick={() => setActiveDrilldown(card.key)}
          />
        ))}
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

      {appUser?.canViewOrderValue ? <SalesTrendCard /> : null}

      <Box
        component="section"
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(1, minmax(0, 1fr))',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            lg: 'repeat(6, minmax(0, 1fr))',
          },
          gap: 2.5,
        }}
      >
        {attentionCards.map((card) => (
          <BerryMiniCard
            key={card.key}
            value={card.value}
            title={card.label}
            icon={card.icon}
            accent={card.color}
            onClick={() => setActiveDrilldown(card.key)}
          />
        ))}
      </Box>
    </Stack>
  )
}
