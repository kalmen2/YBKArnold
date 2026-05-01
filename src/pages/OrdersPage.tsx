import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
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
  fetchOrdersJobDetails,
  fetchOrdersOverview,
  type OrdersJobDetailsResponse,
  type OrdersOverviewOrder,
} from '../features/orders/api'
import {
  fetchQuickBooksOverview,
  type QuickBooksDetailRow,
  type QuickBooksProjectSummary,
} from '../features/quickbooks/api'
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

function formatProgress(value: number | null) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return `${Math.max(0, Math.min(100, Math.round(Number(value))))}%`
}

function normalizeLookupValue(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function extractLookupDigits(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D+/g, '').trim()

  return digits || null
}

type QuickBooksProjectLookups = {
  byNormalized: Map<string, QuickBooksProjectSummary>
  byDigits: Map<string, QuickBooksProjectSummary>
}

function buildQuickBooksProjectLookups(projects: QuickBooksProjectSummary[]): QuickBooksProjectLookups {
  const byNormalized = new Map<string, QuickBooksProjectSummary>()
  const byDigits = new Map<string, QuickBooksProjectSummary>()

  projects.forEach((project) => {
    const projectName = String(project?.projectName ?? '').trim()
    const normalizedProjectName = normalizeLookupValue(projectName)

    if (normalizedProjectName && !byNormalized.has(normalizedProjectName)) {
      byNormalized.set(normalizedProjectName, project)
    }

    const projectId = String(project?.projectId ?? '').trim()
    const normalizedProjectId = normalizeLookupValue(projectId)

    if (normalizedProjectId && !byNormalized.has(normalizedProjectId)) {
      byNormalized.set(normalizedProjectId, project)
    }

    const nameDigits = extractLookupDigits(projectName)

    if (nameDigits && !byDigits.has(nameDigits)) {
      byDigits.set(nameDigits, project)
    }

    const idDigits = extractLookupDigits(projectId)

    if (idDigits && !byDigits.has(idDigits)) {
      byDigits.set(idDigits, project)
    }
  })

  return {
    byNormalized,
    byDigits,
  }
}

function resolveQuickBooksProjectForOrder(order: OrdersOverviewOrder, lookups: QuickBooksProjectLookups) {
  const normalizedCandidates = [
    normalizeLookupValue(order.jobNumber),
    normalizeLookupValue(order.orderName),
    normalizeLookupValue(order.mondayItemId),
  ].filter(Boolean)

  for (const candidate of normalizedCandidates) {
    const project = lookups.byNormalized.get(candidate)

    if (project) {
      return project
    }
  }

  const digitCandidates = [
    extractLookupDigits(order.jobNumber),
    extractLookupDigits(order.orderName),
    extractLookupDigits(order.mondayItemId),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of digitCandidates) {
    const project = lookups.byDigits.get(candidate)

    if (project) {
      return project
    }
  }

  return null
}

type OrdersDialogMode = 'details' | 'history'

type EnrichedOrder = OrdersOverviewOrder & {
  resolvedInvoiceAmount: number | null
  resolvedOwedAmount: number | null
  invoiceDisplaySource: 'invoice' | 'estimate' | 'none'
  hasQuickBooksMatch: boolean
}

function normalizeInvoiceKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function buildInvoiceTotalsByDocNumber(invoiceRows: QuickBooksDetailRow[]) {
  const totalsByDoc = new Map<string, { totalAmount: number; balanceAmount: number | null }>()

  invoiceRows.forEach((row) => {
    const key = normalizeInvoiceKey(row.docNumber)

    if (!key) {
      return
    }

    const existing = totalsByDoc.get(key) ?? {
      totalAmount: 0,
      balanceAmount: null,
    }

    existing.totalAmount += Number(row.totalAmount ?? 0)

    if (Number.isFinite(Number(row.balanceAmount))) {
      existing.balanceAmount = Number(row.balanceAmount)
    }

    totalsByDoc.set(key, {
      totalAmount: Number(existing.totalAmount.toFixed(2)),
      balanceAmount: Number.isFinite(Number(existing.balanceAmount))
        ? Number(Number(existing.balanceAmount).toFixed(2))
        : null,
    })
  })

  return totalsByDoc
}

export default function OrdersPage() {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()

  const [includeShipped, setIncludeShipped] = useState(false)
  const [previewOrder, setPreviewOrder] = useState<OrdersOverviewOrder | null>(null)
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [quickBooksRefreshWarning, setQuickBooksRefreshWarning] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [jobDialogMode, setJobDialogMode] = useState<OrdersDialogMode | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<EnrichedOrder | null>(null)
  const [jobDetails, setJobDetails] = useState<OrdersJobDetailsResponse | null>(null)
  const [jobDetailsLoading, setJobDetailsLoading] = useState(false)
  const [jobDetailsError, setJobDetailsError] = useState<string | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)

  const ordersQuery = useQuery({
    queryKey: QUERY_KEYS.ordersOverview(includeShipped),
    queryFn: () => fetchOrdersOverview({ includeShipped, refresh: false }),
    staleTime: 60 * 1000,
  })

  const quickBooksQuery = useQuery({
    queryKey: QUERY_KEYS.quickbooksOverview,
    queryFn: () => fetchQuickBooksOverview({ refresh: false }),
    staleTime: 60 * 1000,
    retry: 1,
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
    setQuickBooksRefreshWarning(null)
    void (async () => {
      const ordersRefresh = await Promise.allSettled([
        queryClient.fetchQuery({
          queryKey: QUERY_KEYS.ordersOverview(includeShipped),
          queryFn: () => fetchOrdersOverview({ includeShipped, refresh: true }),
          staleTime: 0,
        }),
      ])

      if (ordersRefresh[0]?.status === 'rejected') {
        setErrorMessage(
          ordersRefresh[0].reason instanceof Error
            ? ordersRefresh[0].reason.message
            : 'Could not refresh orders right now.',
        )
      }

      // Revalidate QuickBooks in the background without blocking Orders refresh UX.
      void queryClient
        .fetchQuery({
          queryKey: QUERY_KEYS.quickbooksOverview,
          queryFn: () => fetchQuickBooksOverview({ refresh: false }),
          staleTime: 0,
        })
        .catch(() => {
          setQuickBooksRefreshWarning('Orders refreshed, but QuickBooks values could not be refreshed.')
        })
    })()
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

  const handleCloseJobDialog = useCallback(() => {
    setJobDialogMode(null)
    setSelectedOrder(null)
    setJobDetails(null)
    setJobDetailsError(null)
    setJobDetailsLoading(false)
  }, [])

  const handleOpenJobDialog = useCallback(async (order: EnrichedOrder, mode: OrdersDialogMode) => {
    setJobDialogMode(mode)
    setSelectedOrder(order)
    setJobDetails(null)
    setJobDetailsError(null)
    setJobDetailsLoading(true)

    try {
      const payload = await fetchOrdersJobDetails({
        mondayItemId: order.mondayItemId,
        jobNumber: order.jobNumber,
        orderName: order.orderName,
      })

      setJobDetails(payload)
    } catch (requestError) {
      setJobDetailsError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load job details.',
      )
    } finally {
      setJobDetailsLoading(false)
    }
  }, [])

  const handleCopyOrderNumber = useCallback(async (orderNumber: string) => {
    const normalizedOrderNumber = String(orderNumber ?? '').trim()

    if (!normalizedOrderNumber) {
      setErrorMessage('No order number available to copy.')
      return
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedOrderNumber)
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea')
        textarea.value = normalizedOrderNumber
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } else {
        throw new Error('Clipboard is not supported in this browser.')
      }

      setSuccessMessage(`Copied order number ${normalizedOrderNumber}.`)
      setErrorMessage(null)
    } catch (copyError) {
      setErrorMessage(
        copyError instanceof Error
          ? copyError.message
          : 'Could not copy order number.',
      )
    }
  }, [])

  const orders = useMemo(
    () => (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []),
    [ordersQuery.data?.orders],
  )

  const quickBooksProjects = useMemo(
    () => (Array.isArray(quickBooksQuery.data?.projects) ? quickBooksQuery.data.projects : []),
    [quickBooksQuery.data?.projects],
  )

  const quickBooksProjectLookups = useMemo(
    () => buildQuickBooksProjectLookups(quickBooksProjects),
    [quickBooksProjects],
  )

  const invoiceTotalsByDocNumber = useMemo(
    () => buildInvoiceTotalsByDocNumber(quickBooksQuery.data?.details.invoices ?? []),
    [quickBooksQuery.data?.details.invoices],
  )

  const enrichedOrders = useMemo<EnrichedOrder[]>(() => {
    return orders.map((order) => {
      const matchedQuickBooksProject = resolveQuickBooksProjectForOrder(order, quickBooksProjectLookups)
      const invoiceKey = normalizeInvoiceKey(order.invoiceNumber)
      const invoiceTotals = invoiceKey ? invoiceTotalsByDocNumber.get(invoiceKey) ?? null : null
      const hasInvoiceNumber = Boolean(String(order.invoiceNumber ?? '').trim())
      const estimateAmount = Number.isFinite(Number(order.poAmount))
        ? Number(order.poAmount)
        : null
      const invoiceAmount = Number.isFinite(Number(invoiceTotals?.totalAmount))
        ? Number(invoiceTotals?.totalAmount)
        : Number.isFinite(Number(matchedQuickBooksProject?.invoiceAmount))
          ? Number(matchedQuickBooksProject?.invoiceAmount)
          : null
      const shouldUseEstimateFallback = !hasInvoiceNumber && Number.isFinite(Number(estimateAmount))
      const resolvedInvoiceAmount = Number.isFinite(Number(invoiceAmount))
        ? Number(invoiceAmount)
        : shouldUseEstimateFallback
          ? Number(estimateAmount)
          : null
      const invoiceDisplaySource: EnrichedOrder['invoiceDisplaySource'] = Number.isFinite(Number(invoiceAmount))
        ? 'invoice'
        : shouldUseEstimateFallback
          ? 'estimate'
          : 'none'
      const resolvedOwedAmount = invoiceDisplaySource === 'invoice' && Number.isFinite(Number(invoiceTotals?.balanceAmount))
        ? Number(invoiceTotals?.balanceAmount)
        : invoiceDisplaySource === 'invoice' && Number.isFinite(Number(matchedQuickBooksProject?.outstandingAmount))
          ? Number(matchedQuickBooksProject?.outstandingAmount)
          : null

      return {
        ...order,
        resolvedInvoiceAmount,
        resolvedOwedAmount,
        invoiceDisplaySource,
        hasQuickBooksMatch: Boolean(matchedQuickBooksProject || invoiceTotals),
      }
    })
  }, [invoiceTotalsByDocNumber, orders, quickBooksProjectLookups])

  const counts = ordersQuery.data?.counts ?? {
    total: 0,
    shipped: 0,
    visible: 0,
  }

  const isLoading = ordersQuery.isLoading
  const isRefreshing = ordersQuery.isFetching
  const queryErrorMessage = ordersQuery.error instanceof Error ? ordersQuery.error.message : null
  const quickBooksErrorMessage = quickBooksQuery.error instanceof Error
    ? quickBooksQuery.error.message
    : null
  const selectedOrderLabel = selectedOrder?.jobNumber || selectedOrder?.mondayItemId || 'Job'
  const managerHistoryRows = Array.isArray(jobDetails?.managerHistory)
    ? jobDetails.managerHistory
    : []

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
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`Visible: ${counts.visible}`} color="primary" variant="outlined" />
        <Chip label={`Shipped: ${counts.shipped}`} color="default" variant="outlined" />
        <Chip label={`Total: ${counts.total}`} color="default" variant="outlined" />
      </Stack>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
      {queryErrorMessage ? <Alert severity="error">{queryErrorMessage}</Alert> : null}
      {quickBooksRefreshWarning ? <Alert severity="warning">{quickBooksRefreshWarning}</Alert> : null}
      {quickBooksErrorMessage ? (
        <Alert severity="warning">
          QuickBooks data is currently unavailable. PO and invoice totals may appear blank.
        </Alert>
      ) : null}

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
                  <TableCell>Invoice #</TableCell>
                  <TableCell>Invoice / Estimate $</TableCell>
                  <TableCell>Owed $ (QuickBooks)</TableCell>
                  <TableCell>Monday Status</TableCell>
                  <TableCell>Manager Status</TableCell>
                  <TableCell>Estimated Ready</TableCell>
                  <TableCell>Shop Drawing</TableCell>
                  <TableCell>Monday Link</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {enrichedOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No orders to show.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  enrichedOrders.map((order) => {
                    const cachedOrSourceDrawing =
                      String(order.shopDrawingCachedUrl ?? '').trim()
                      || String(order.shopDrawingUrl ?? '').trim()
                    const rowStatus = order.isShipped
                      ? 'Shipped'
                      : String(order.mondayStatusLabel ?? order.statusLabel ?? '').trim() || 'Open'
                    const hasManagerStatus = Number.isFinite(order.managerReadyPercent)

                    return (
                      <TableRow key={order.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: 'fit-content' }}>
                            <Button
                              size="small"
                              variant="text"
                              sx={{
                                minWidth: 0,
                                p: 0,
                                textTransform: 'none',
                                fontWeight: 700,
                                color: order.hasQuickBooksMatch ? 'success.main' : 'error.main',
                              }}
                              onClick={() => {
                                void handleOpenJobDialog(order, 'details')
                              }}
                            >
                              {order.jobNumber || order.mondayItemId}
                            </Button>
                            <IconButton
                              size="small"
                              aria-label="Copy order number"
                              title="Copy order number"
                              onClick={() => {
                                void handleCopyOrderNumber(order.jobNumber || order.mondayItemId)
                              }}
                            >
                              <ContentCopyRoundedIcon fontSize="inherit" />
                            </IconButton>
                          </Stack>
                          {order.orderName ? (
                            <Typography variant="body2" color="text.secondary">
                              {order.orderName}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>{order.invoiceNumber || '—'}</TableCell>
                        <TableCell>
                          {Number.isFinite(order.resolvedInvoiceAmount) ? (
                            order.invoiceDisplaySource === 'estimate' ? (
                              <Typography variant="body2" sx={{ color: 'warning.dark', fontWeight: 700 }}>
                                Estimate: {formatCurrency(Number(order.resolvedInvoiceAmount), 2)}
                              </Typography>
                            ) : (
                              formatCurrency(Number(order.resolvedInvoiceAmount), 2)
                            )
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          {Number.isFinite(order.resolvedOwedAmount)
                            ? formatCurrency(Number(order.resolvedOwedAmount), 2)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={rowStatus}
                            color={order.isShipped ? 'success' : 'default'}
                            variant={order.isShipped ? 'filled' : 'outlined'}
                          />
                        </TableCell>
                        <TableCell>
                          {hasManagerStatus ? (
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<HistoryRoundedIcon fontSize="small" />}
                              sx={{ minWidth: 0, px: 0, textTransform: 'none' }}
                              onClick={() => {
                                void handleOpenJobDialog(order, 'history')
                              }}
                            >
                              {formatProgress(order.managerReadyPercent)}
                            </Button>
                          ) : (
                            <Typography variant="body2" color="text.secondary">—</Typography>
                          )}
                          {order.managerReadyDate ? (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {formatDate(order.managerReadyDate)}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>{order.estimatedReadyAt ? formatDate(order.estimatedReadyAt) : 'Blank'}</TableCell>
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
                        <TableCell>
                          {order.mondayItemUrl ? (
                            <Button
                              size="small"
                              variant="outlined"
                              href={order.mondayItemUrl}
                              target="_blank"
                              rel="noreferrer"
                              startIcon={<OpenInNewRoundedIcon fontSize="small" />}
                            >
                              Monday
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

      <Dialog
        open={Boolean(jobDialogMode && selectedOrder)}
        onClose={handleCloseJobDialog}
        fullWidth
        maxWidth={jobDialogMode === 'details' ? 'xl' : 'md'}
      >
        <DialogTitle>
          {jobDialogMode === 'history'
            ? `Manager Status History - ${selectedOrderLabel}`
            : `Order Details - ${selectedOrderLabel}`}
        </DialogTitle>
        <DialogContent>
          {jobDetailsLoading ? (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Loading details...</Typography>
            </Stack>
          ) : jobDetailsError ? (
            <Alert severity="error">{jobDetailsError}</Alert>
          ) : !jobDetails ? (
            <Alert severity="info">No details available.</Alert>
          ) : jobDialogMode === 'history' ? (
            managerHistoryRows.length === 0 ? (
              <Alert severity="info">No manager status history found for this job yet.</Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ mt: 0.5, maxHeight: '60vh' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Ready %</TableCell>
                      <TableCell>Updated</TableCell>
                      <TableCell>Job Name</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {managerHistoryRows.map((row) => (
                      <TableRow key={`${row.id || 'history'}-${row.date || 'na'}-${row.updatedAt || 'na'}`} hover>
                        <TableCell>{row.date ? formatDate(row.date) : '—'}</TableCell>
                        <TableCell>{formatProgress(row.readyPercent)}</TableCell>
                        <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                        <TableCell>{row.jobName || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          ) : (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={`Total hours: ${jobDetails.summary.totalHours.toFixed(2)}`}
                  color="primary"
                  variant="outlined"
                />
                <Chip label={`Workers: ${jobDetails.summary.workerCount}`} variant="outlined" />
                <Chip label={`Entries: ${jobDetails.summary.entryCount}`} variant="outlined" />
                <Chip
                  label={`Labor: ${formatCurrency(jobDetails.summary.totalLaborCost, 2)}`}
                  variant="outlined"
                />
              </Stack>

              {jobDetails.workers.length === 0 ? (
                <Alert severity="info">No worker activity found for this job yet.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Worker</TableCell>
                        <TableCell>Regular Hours</TableCell>
                        <TableCell>Overtime Hours</TableCell>
                        <TableCell>Total Hours</TableCell>
                        <TableCell>Labor Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {jobDetails.workers.map((worker) => (
                        <TableRow key={worker.workerId} hover>
                          <TableCell>{worker.workerName}</TableCell>
                          <TableCell>{worker.totalRegularHours.toFixed(2)}</TableCell>
                          <TableCell>{worker.totalOvertimeHours.toFixed(2)}</TableCell>
                          <TableCell>{worker.totalHours.toFixed(2)}</TableCell>
                          <TableCell>{formatCurrency(worker.totalLaborCost, 2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '56vh' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Regular</TableCell>
                      <TableCell>OT</TableCell>
                      <TableCell>Total</TableCell>
                      <TableCell>Rate</TableCell>
                      <TableCell>Labor Cost</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {jobDetails.entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} align="center">
                          <Typography color="text.secondary" sx={{ py: 2 }}>
                            No timesheet entries found for this job.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      jobDetails.entries.map((entry) => (
                        <TableRow key={entry.id} hover>
                          <TableCell>{formatDate(entry.date)}</TableCell>
                          <TableCell>{entry.workerName}</TableCell>
                          <TableCell>{entry.stageName || '—'}</TableCell>
                          <TableCell>{entry.regularHours.toFixed(2)}</TableCell>
                          <TableCell>{entry.overtimeHours.toFixed(2)}</TableCell>
                          <TableCell>{entry.totalHours.toFixed(2)}</TableCell>
                          <TableCell>{formatCurrency(entry.rate, 2)}</TableCell>
                          <TableCell>{formatCurrency(entry.laborCost, 2)}</TableCell>
                          <TableCell>{entry.notes || '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseJobDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
