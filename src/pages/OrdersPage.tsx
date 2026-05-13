import * as XLSX from 'xlsx'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  postOrdersOrderNumberContactAdmin,
  postOrdersOrderNumberUpdate,
  type OrdersOverviewOrder,
} from '../features/orders/api'
import { QUERY_KEYS } from '../lib/queryKeys'
import { JobDetailsDialog, type JobDetailsMode } from './orders/JobDetailsDialog'
import {
  OrdersGrid,
  type OrdersQuickBooksDrilldownMetric,
  type OrdersViewMode,
} from './orders/OrdersGrid'
import { OrdersToolbar } from './orders/OrdersToolbar'
import { QuickBooksProjectDialog } from './orders/QuickBooksProjectDialog'
import {
  CutListPreview,
  type CutListPreviewHandle,
} from './orders/CutListPreview'
import {
  ShopDrawingPreview,
  type ShopDrawingPreviewHandle,
} from './orders/ShopDrawingPreview'
import { useOrdersOverview } from './orders/useOrdersOverview'

const FEEDBACK_TOAST_MS = 2000
const WARNING_TOAST_MS = 3000
const ORDER_NUMBER_CHANGE_LINKED_MESSAGE =
  'Sorry, this cannot be done because of its linked. If it needs to be done, contact admin.'

function isLinkedOrderNumberChangeMessage(message: string | null | undefined) {
  return String(message ?? '').trim() === ORDER_NUMBER_CHANGE_LINKED_MESSAGE
}

export default function OrdersPage() {
  const { appUser, getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const overview = useOrdersOverview()
  const canUseAdminView = appUser?.isAdmin === true
  const canEditMondayStages = appUser?.isAdmin === true || appUser?.isManager === true

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<OrdersViewMode>('standard')
  const [jobDialogMode, setJobDialogMode] = useState<JobDetailsMode | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogOrder, setQuickBooksDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogMetric, setQuickBooksDialogMetric] =
    useState<OrdersQuickBooksDrilldownMetric | null>(null)
  const [orderNumberEditOrder, setOrderNumberEditOrder] = useState<OrdersOverviewOrder | null>(null)
  const [orderNumberDraft, setOrderNumberDraft] = useState('')
  const [orderNumberEditError, setOrderNumberEditError] = useState<string | null>(null)
  const [isSavingOrderNumber, setIsSavingOrderNumber] = useState(false)
  const [canContactAdminForOrderNumber, setCanContactAdminForOrderNumber] = useState(false)
  const [isContactingAdminForOrderNumber, setIsContactingAdminForOrderNumber] = useState(false)

  const shopDrawingHandle = useRef<ShopDrawingPreviewHandle | null>(null)
  const cutListHandle = useRef<CutListPreviewHandle | null>(null)
  const bindShopDrawing = useCallback((handle: ShopDrawingPreviewHandle) => {
    shopDrawingHandle.current = handle
  }, [])
  const bindCutList = useCallback((handle: CutListPreviewHandle) => {
    cutListHandle.current = handle
  }, [])

  const handleOpenBolDocument = useCallback(async (order: OrdersOverviewOrder) => {
    const orderId = String(order?.mondayItemId ?? '').trim()

    if (!orderId) {
      setErrorMessage('No BOL is available for this order yet.')
      return
    }

    try {
      const idToken = await getIdToken()
      const query = new URLSearchParams({ orderId })
      const response = await fetch(
        `/api/dashboard/monday/bol/download?${query.toString()}`,
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
          : 'Could not open BOL document.'
        throw new Error(message)
      }

      const blob = await response.blob()

      if (!blob || blob.size <= 0) {
        throw new Error('Could not open BOL document.')
      }

      const objectUrl = URL.createObjectURL(blob)
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (requestError) {
      setErrorMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Could not open BOL document.',
      )
    }
  }, [getIdToken])

  // Auto-dismiss success toasts so they don't stick forever.
  useEffect(() => {
    if (!successMessage) {
      return
    }
    const timer = window.setTimeout(() => setSuccessMessage(null), FEEDBACK_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [successMessage])

  // Auto-dismiss error toasts (including refresh rate-limit errors).
  useEffect(() => {
    if (!errorMessage) {
      return
    }
    const timer = window.setTimeout(() => setErrorMessage(null), FEEDBACK_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [errorMessage])

  // Show refresh warnings as temporary alerts instead of sticky page state.
  useEffect(() => {
    if (overview.refreshWarnings.length === 0) {
      return
    }
    setWarningMessage(overview.refreshWarnings.join(' '))
  }, [overview.lastRefreshedAt, overview.refreshWarnings])

  useEffect(() => {
    if (!warningMessage) {
      return
    }
    const timer = window.setTimeout(() => setWarningMessage(null), WARNING_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [warningMessage])

  useEffect(() => {
    if (canUseAdminView || viewMode === 'standard') {
      return
    }
    setViewMode('standard')
  }, [canUseAdminView, viewMode])

  const handleRefresh = useCallback(async () => {
    setErrorMessage(null)
    try {
      await overview.refresh()
      setSuccessMessage('Orders refreshed from Monday and QuickBooks.')
    } catch (refreshError) {
      setErrorMessage(
        refreshError instanceof Error
          ? refreshError.message
          : 'Could not refresh orders right now.',
      )
    }
  }, [overview])

  const handleOpenJobDialog = useCallback((order: OrdersOverviewOrder, mode: JobDetailsMode) => {
    if (!order.hasMondayRecord) {
      setErrorMessage('This QuickBooks project is not linked to a Monday order yet.')
      return
    }
    setJobDialogMode(mode)
    setSelectedOrder(order)
  }, [])

  const handleCloseJobDialog = useCallback(() => {
    setJobDialogMode(null)
    setSelectedOrder(null)
  }, [])

  const handleCopyOrderNumber = useCallback(async (orderNumber: string) => {
    const normalized = String(orderNumber ?? '').trim()
    if (!normalized) {
      setErrorMessage('No order number available to copy.')
      return
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized)
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea')
        textarea.value = normalized
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
      setSuccessMessage(`Copied order number ${normalized}.`)
      setErrorMessage(null)
    } catch (copyError) {
      setErrorMessage(
        copyError instanceof Error ? copyError.message : 'Could not copy order number.',
      )
    }
  }, [])

  const handleMissingMondayLink = useCallback(() => {
    setErrorMessage('This QuickBooks project is not linked to a Monday order yet.')
  }, [])

  const handleOpenQuickBooksDialog = useCallback(
    (order: OrdersOverviewOrder, metric: OrdersQuickBooksDrilldownMetric) => {
      if (!order.hasQuickBooksRecord || !order.quickBooksProjectId) {
        setErrorMessage('This order is not linked to a QuickBooks project yet.')
        return
      }
      setQuickBooksDialogOrder(order)
      setQuickBooksDialogMetric(metric)
    },
    [],
  )

  const handleCloseQuickBooksDialog = useCallback(() => {
    setQuickBooksDialogOrder(null)
    setQuickBooksDialogMetric(null)
  }, [])

  const handleOpenOrderNumberEdit = useCallback((order: OrdersOverviewOrder) => {
    if (!order.hasMondayRecord || !String(order.mondayItemId ?? '').trim()) {
      setErrorMessage('Only Monday-linked orders can be edited here.')
      return
    }

    setOrderNumberEditOrder(order)
    setOrderNumberDraft(String(order.orderNumber ?? '').trim())
    setOrderNumberEditError(null)
    setCanContactAdminForOrderNumber(false)
  }, [])

  const handleCloseOrderNumberEdit = useCallback(() => {
    if (isSavingOrderNumber || isContactingAdminForOrderNumber) {
      return
    }

    setOrderNumberEditOrder(null)
    setOrderNumberDraft('')
    setOrderNumberEditError(null)
    setCanContactAdminForOrderNumber(false)
  }, [isContactingAdminForOrderNumber, isSavingOrderNumber])

  const handleSaveOrderNumberEdit = useCallback(async () => {
    const order = orderNumberEditOrder

    if (!order) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const requestedOrderNumber = String(orderNumberDraft ?? '').trim()
    const currentOrderNumber = String(order.orderNumber ?? '').trim()

    if (!mondayItemId) {
      setOrderNumberEditError('Monday item id is missing for this order.')
      return
    }

    if (!requestedOrderNumber) {
      setOrderNumberEditError('Order number is required.')
      return
    }

    setIsSavingOrderNumber(true)
    setOrderNumberEditError(null)
    setCanContactAdminForOrderNumber(false)

    try {
      const response = await postOrdersOrderNumberUpdate({
        mondayItemId,
        orderNumber: requestedOrderNumber,
        currentOrderNumber,
      })

      if (response.warning) {
        setWarningMessage(response.warning)
      }

      setSuccessMessage(
        `Order number updated: ${response.order.previousOrderNumber} -> ${response.order.orderNumber}`,
      )
      setOrderNumberEditOrder(null)
      setOrderNumberDraft('')
      setOrderNumberEditError(null)
      setCanContactAdminForOrderNumber(false)
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not update order number.'

      setOrderNumberEditError(message)
      setCanContactAdminForOrderNumber(isLinkedOrderNumberChangeMessage(message))
    } finally {
      setIsSavingOrderNumber(false)
    }
  }, [orderNumberDraft, orderNumberEditOrder, queryClient])

  const handleContactAdminForOrderNumber = useCallback(async () => {
    const order = orderNumberEditOrder

    if (!order) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const requestedOrderNumber = String(orderNumberDraft ?? '').trim()
    const currentOrderNumber = String(order.orderNumber ?? '').trim()

    if (!mondayItemId) {
      setOrderNumberEditError('Monday item id is missing for this order.')
      return
    }

    if (!requestedOrderNumber) {
      setOrderNumberEditError('Order number is required.')
      return
    }

    setIsContactingAdminForOrderNumber(true)

    try {
      await postOrdersOrderNumberContactAdmin({
        mondayItemId,
        requestedOrderNumber,
        currentOrderNumber,
      })

      setSuccessMessage('Admin was notified about this order number change request.')
      setCanContactAdminForOrderNumber(false)
      setOrderNumberEditError(null)
    } catch (error) {
      setOrderNumberEditError(
        error instanceof Error
          ? error.message
          : 'Could not notify admin right now.',
      )
    } finally {
      setIsContactingAdminForOrderNumber(false)
    }
  }, [orderNumberDraft, orderNumberEditOrder])

  const handleExport = useCallback(() => {
    const rows = overview.visibleOrders.map((order) => {
      const invoice = Number(order.invoiceAmount)
      const billed = Number(order.billedAmount)
      const labor = Number(order.totalLaborCost)
      const profit =
        Number.isFinite(invoice) && Number.isFinite(billed) && Number.isFinite(labor)
          ? Number((invoice - billed - labor).toFixed(2))
          : ''
      return {
        'Order #': order.orderNumber ?? '',
        'Order Name': order.orderName ?? '',
        'PO Number': order.poNumber ?? '',
        'Description': order.description ?? '',
        'Notes': order.notes ?? '',
        'Ship To': order.shipTo ?? '',
        'Ship Notes': order.shipNotes ?? '',
        'BOL': order.bol ?? '',
        'BOL URL': order.bolCachedUrl ?? order.bolUrl ?? '',
        'Monday Status': order.rowStatus ?? '',
        'Invoice #': order.invoiceNumber ?? '',
        'PO Amount': Number.isFinite(Number(order.poAmount)) ? Number(order.poAmount) : '',
        'Billed Amount': Number.isFinite(billed) ? billed : '',
        'Bills Left to Pay':
          order.billBalanceAmount !== null
          && order.billBalanceAmount !== undefined
          && Number.isFinite(Number(order.billBalanceAmount))
          ? Math.max(0, Number(Number(order.billBalanceAmount).toFixed(2)))
          : '',
        'PO Not Yet Billed': Number.isFinite(Number(order.poAmount)) && Number.isFinite(billed)
          ? Math.max(0, Number((Number(order.poAmount) - billed).toFixed(2)))
          : '',
        'Invoice Amount': Number.isFinite(invoice) ? invoice : '',
        'Amount Owed': Number.isFinite(Number(order.amountOwed)) ? Number(order.amountOwed) : '',
        'Total Hours': Number.isFinite(Number(order.totalHours)) ? Number(order.totalHours) : '',
        'Total Cost': Number.isFinite(labor) ? labor : '',
        'Total Profit': profit,
        'Paid In Full': order.paidInFull === true ? 'Yes' : order.paidInFull === false ? 'No' : '',
        'Order Date': order.orderDate ?? '',
        'Shipped': order.isShipped ? 'Yes' : 'No',
        'Shipped At': order.shippedAt ?? '',
        'Cut List URL': order.cutListCachedUrl ?? order.cutListUrl ?? '',
        'Source': order.source ?? '',
      }
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Orders')
    const date = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(book, `orders-export-${date}.xlsx`)
  }, [overview.visibleOrders])

  return (
    <Stack spacing={3}>
      <OrdersToolbar
        totalRows={overview.counts.visible}
        lastRefreshedAt={overview.lastRefreshedAt}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        canUseAdminView={canUseAdminView}
        includeShipped={overview.includeShipped}
        onIncludeShippedChange={overview.setIncludeShipped}
        searchText={overview.searchText}
        onSearchTextChange={overview.setSearchText}
        isRefreshing={overview.isRefreshing}
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
      {overview.queryError ? <Alert severity="error">{overview.queryError}</Alert> : null}
      {warningMessage ? <Alert severity="warning">{warningMessage}</Alert> : null}

      <OrdersGrid
        orders={overview.visibleOrders}
        viewMode={viewMode}
        canEditMondayStages={canEditMondayStages}
        lastRefreshedAt={overview.lastRefreshedAt}
        isLoading={overview.isLoading || overview.isFetching || overview.isRefreshing}
        shopDrawingHandle={shopDrawingHandle}
        cutListHandle={cutListHandle}
        onOpenBolDocument={handleOpenBolDocument}
        onOpenJobDialog={handleOpenJobDialog}
        onOpenQuickBooksDialog={handleOpenQuickBooksDialog}
        onRequestOrderNumberEdit={handleOpenOrderNumberEdit}
        onCopyOrderNumber={handleCopyOrderNumber}
        onMissingMondayLink={handleMissingMondayLink}
      />

      <Dialog
        open={Boolean(orderNumberEditOrder)}
        onClose={handleCloseOrderNumberEdit}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Edit Order Number</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <DialogContentText>
              This edit updates Monday data. If this order number is linked in timesheets or QuickBooks,
              only admin can complete the change.
            </DialogContentText>

            {orderNumberEditError ? (
              <Alert severity="error">{orderNumberEditError}</Alert>
            ) : null}

            <TextField
              autoFocus
              size="small"
              label="Order number"
              value={orderNumberDraft}
              onChange={(event) => setOrderNumberDraft(event.target.value)}
              disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseOrderNumberEdit}
            disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
          >
            Cancel
          </Button>
          {canContactAdminForOrderNumber ? (
            <Button
              color="warning"
              onClick={handleContactAdminForOrderNumber}
              disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
              startIcon={isContactingAdminForOrderNumber ? <CircularProgress size={14} /> : null}
            >
              Contact Admin
            </Button>
          ) : null}
          <Button
            variant="contained"
            onClick={handleSaveOrderNumberEdit}
            disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
            startIcon={isSavingOrderNumber ? <CircularProgress size={14} /> : null}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ShopDrawingPreview onError={setErrorMessage} bind={bindShopDrawing} />
      <CutListPreview onError={setErrorMessage} bind={bindCutList} />

      <JobDetailsDialog
        open={Boolean(jobDialogMode && selectedOrder)}
        mode={jobDialogMode}
        order={selectedOrder}
        onClose={handleCloseJobDialog}
      />

      <QuickBooksProjectDialog
        key={`${quickBooksDialogOrder?.id ?? 'none'}:${quickBooksDialogMetric ?? 'none'}`}
        open={Boolean(quickBooksDialogOrder)}
        order={quickBooksDialogOrder}
        metric={quickBooksDialogMetric}
        onClose={handleCloseQuickBooksDialog}
      />
    </Stack>
  )
}
