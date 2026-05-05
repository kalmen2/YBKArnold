import * as XLSX from 'xlsx'
import { Alert, Stack } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { OrdersOverviewOrder } from '../features/orders/api'
import { JobDetailsDialog, type JobDetailsMode } from './orders/JobDetailsDialog'
import {
  OrdersGrid,
  type OrdersQuickBooksDrilldownMetric,
} from './orders/OrdersGrid'
import { OrdersToolbar } from './orders/OrdersToolbar'
import { QuickBooksProjectDialog } from './orders/QuickBooksProjectDialog'
import {
  ShopDrawingPreview,
  type ShopDrawingPreviewHandle,
} from './orders/ShopDrawingPreview'
import { useOrdersOverview } from './orders/useOrdersOverview'

const FEEDBACK_TOAST_MS = 2000
const WARNING_TOAST_MS = 3000

export default function OrdersPage() {
  const overview = useOrdersOverview()

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [jobDialogMode, setJobDialogMode] = useState<JobDetailsMode | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogOrder, setQuickBooksDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogMetric, setQuickBooksDialogMetric] =
    useState<OrdersQuickBooksDrilldownMetric | null>(null)

  const shopDrawingHandle = useRef<ShopDrawingPreviewHandle | null>(null)
  const bindShopDrawing = useCallback((handle: ShopDrawingPreviewHandle) => {
    shopDrawingHandle.current = handle
  }, [])

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
        'Due Date': order.dueDate ?? '',
        'Order Date': order.orderDate ?? '',
        'Shipped': order.isShipped ? 'Yes' : 'No',
        'Shipped At': order.shippedAt ?? '',
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
        lastRefreshedAt={overview.lastRefreshedAt}
        isLoading={overview.isLoading || overview.isFetching || overview.isRefreshing}
        shopDrawingHandle={shopDrawingHandle}
        onOpenJobDialog={handleOpenJobDialog}
        onOpenQuickBooksDialog={handleOpenQuickBooksDialog}
        onCopyOrderNumber={handleCopyOrderNumber}
        onMissingMondayLink={handleMissingMondayLink}
      />

      <ShopDrawingPreview onError={setErrorMessage} bind={bindShopDrawing} />

      <JobDetailsDialog
        open={Boolean(jobDialogMode && selectedOrder)}
        mode={jobDialogMode}
        order={selectedOrder}
        onClose={handleCloseJobDialog}
      />

      <QuickBooksProjectDialog
        open={Boolean(quickBooksDialogOrder)}
        order={quickBooksDialogOrder}
        metric={quickBooksDialogMetric}
        onClose={handleCloseQuickBooksDialog}
      />
    </Stack>
  )
}
