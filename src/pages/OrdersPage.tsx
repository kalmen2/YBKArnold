import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
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
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchOrdersOverview,
  type OrdersOverviewOrder,
} from '../features/orders/api'
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

function formatProgress(value: number | null) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return `${Math.max(0, Math.min(100, Math.round(Number(value))))}%`
}

export default function OrdersPage() {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()

  const [includeShipped, setIncludeShipped] = useState(false)
  const [previewOrder, setPreviewOrder] = useState<OrdersOverviewOrder | null>(null)
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)

  const ordersQuery = useQuery({
    queryKey: QUERY_KEYS.ordersOverview(includeShipped),
    queryFn: () => fetchOrdersOverview({ includeShipped, refresh: false }),
    staleTime: 60 * 1000,
  })

  const clearPreviewObjectUrl = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPreviewObjectUrl()
    }
  }, [clearPreviewObjectUrl])

  const handleRefresh = useCallback(() => {
    setErrorMessage(null)

    void queryClient.fetchQuery({
      queryKey: QUERY_KEYS.ordersOverview(includeShipped),
      queryFn: () => fetchOrdersOverview({ includeShipped, refresh: true }),
      staleTime: 0,
    })
  }, [includeShipped, queryClient])

  const handleClosePreview = useCallback(() => {
    clearPreviewObjectUrl()
    setPreviewLoading(false)
    setPreviewSrc('')
    setPreviewOrder(null)
  }, [clearPreviewObjectUrl])

  const handleOpenPreview = useCallback(async (order: OrdersOverviewOrder) => {
    const orderId = String(order?.mondayItemId ?? '').trim()
    const cachedPreviewUrl = String(order?.shopDrawingCachedUrl ?? '').trim()
    const sourcePreviewUrl = String(order?.shopDrawingUrl ?? '').trim()

    if (!orderId || (!cachedPreviewUrl && !sourcePreviewUrl)) {
      setErrorMessage('No shop drawing is available for this order yet.')
      return
    }

    setErrorMessage(null)
    clearPreviewObjectUrl()
    setPreviewSrc('')
    setPreviewLoading(true)
    setPreviewOrder(order)

    if (cachedPreviewUrl) {
      setPreviewSrc(cachedPreviewUrl)
      setPreviewLoading(false)
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
      previewObjectUrlRef.current = objectUrl
      setPreviewSrc(objectUrl)
      setPreviewLoading(false)
    } catch (requestError) {
      setPreviewLoading(false)
      setPreviewOrder(null)
      setPreviewSrc('')
      setErrorMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load shop drawing preview.',
      )
    }
  }, [clearPreviewObjectUrl, getIdToken])

  const orders = useMemo(
    () => (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []),
    [ordersQuery.data?.orders],
  )

  const counts = ordersQuery.data?.counts ?? {
    total: 0,
    shipped: 0,
    visible: 0,
  }

  const isLoading = ordersQuery.isLoading
  const queryErrorMessage = ordersQuery.error instanceof Error ? ordersQuery.error.message : null

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Orders
          </Typography>
          <Typography color="text.secondary">
            Monday Order Track + Shipped board data synced into database.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Last sync: {formatDateTime(ordersQuery.data?.generatedAt)}
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <FormControlLabel
            control={(
              <Switch
                checked={includeShipped}
                onChange={(event) => {
                  setIncludeShipped(event.target.checked)
                }}
              />
            )}
            label="Show shipped orders"
          />
          <Button
            variant="contained"
            startIcon={<RefreshRoundedIcon />}
            onClick={handleRefresh}
            disabled={ordersQuery.isFetching}
          >
            {ordersQuery.isFetching ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`Visible: ${counts.visible}`} color="primary" variant="outlined" />
        <Chip label={`Shipped: ${counts.shipped}`} color="default" variant="outlined" />
        <Chip label={`Total: ${counts.total}`} color="default" variant="outlined" />
      </Stack>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {queryErrorMessage ? <Alert severity="error">{queryErrorMessage}</Alert> : null}

      <Paper variant="outlined">
        {isLoading ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading orders...</Typography>
          </Stack>
        ) : (
          <TableContainer sx={{ maxHeight: '70vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job Number</TableCell>
                  <TableCell>PO Amount</TableCell>
                  <TableCell>Ready %</TableCell>
                  <TableCell>Estimated Ready</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Shop Drawing</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No orders to show.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => {
                    const cachedOrSourceDrawing =
                      String(order.shopDrawingCachedUrl ?? '').trim()
                      || String(order.shopDrawingUrl ?? '').trim()
                    const rowStatus = order.isShipped ? 'Shipped' : String(order.statusLabel ?? '').trim() || 'Open'

                    return (
                      <TableRow key={order.id} hover>
                        <TableCell>
                          <Typography fontWeight={600}>{order.jobNumber || order.mondayItemId}</Typography>
                          {order.orderName ? (
                            <Typography variant="body2" color="text.secondary">
                              {order.orderName}
                            </Typography>
                          ) : null}
                          {order.mondayItemUrl ? (
                            <Button
                              size="small"
                              variant="text"
                              href={order.mondayItemUrl}
                              target="_blank"
                              rel="noreferrer"
                              startIcon={<OpenInNewRoundedIcon fontSize="small" />}
                              sx={{ mt: 0.5, minWidth: 0, px: 0 }}
                            >
                              Monday
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {Number.isFinite(order.poAmount)
                            ? formatCurrency(Number(order.poAmount), 2)
                            : '—'}
                        </TableCell>
                        <TableCell>{formatProgress(order.progressPercent)}</TableCell>
                        <TableCell>{order.estimatedReadyAt ? formatDate(order.estimatedReadyAt) : 'Blank'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={rowStatus}
                            color={order.isShipped ? 'success' : 'default'}
                            variant={order.isShipped ? 'filled' : 'outlined'}
                          />
                        </TableCell>
                        <TableCell>
                          {cachedOrSourceDrawing ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              onClick={() => {
                                void handleOpenPreview(order)
                              }}
                            >
                              Preview
                            </Button>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              None
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={Boolean(previewOrder)} onClose={handleClosePreview} fullWidth maxWidth="lg">
        <DialogTitle>
          {previewOrder
            ? `Shop Drawing - ${previewOrder.jobNumber || previewOrder.mondayItemId}`
            : 'Shop Drawing'}
        </DialogTitle>
        <DialogContent sx={{ p: 0, minHeight: 560 }}>
          {previewLoading ? (
            <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 6 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Loading preview...</Typography>
            </Stack>
          ) : previewSrc ? (
            <Box
              component="iframe"
              title="Shop drawing preview"
              src={previewSrc}
              sx={{ border: 0, width: '100%', height: '74vh', display: 'block' }}
            />
          ) : (
            <Alert severity="info" sx={{ m: 2 }}>
              No preview is available for this drawing.
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
