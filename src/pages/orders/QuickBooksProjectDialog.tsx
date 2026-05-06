import {
  Alert,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
  Button,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { OrdersOverviewOrder } from '../../features/orders/api'
import {
  fetchQuickBooksOverview,
  type QuickBooksDetailRow,
  type QuickBooksOverviewResponse,
} from '../../features/quickbooks/api'
import { formatCurrency, formatDate } from '../../lib/formatters'
import type { OrdersQuickBooksDrilldownMetric } from './OrdersGrid'
import { resolveOrderProjectIds } from './utils'

type QuickBooksProjectDialogTab = 'purchaseOrders' | 'bills' | 'invoices' | 'payments'

type QuickBooksProjectDialogProps = {
  open: boolean
  order: OrdersOverviewOrder | null
  metric: OrdersQuickBooksDrilldownMetric | null
  onClose: () => void
}

function tabFromMetric(metric: OrdersQuickBooksDrilldownMetric | null): QuickBooksProjectDialogTab {
  if (metric === 'purchaseOrders') {
    return 'purchaseOrders'
  }
  if (metric === 'bills') {
    return 'bills'
  }
  return 'invoices'
}

function resolveOrderProjectNames(order: OrdersOverviewOrder | null) {
  if (!order) {
    return []
  }

  const names = Array.isArray(order.quickBooksProjectNames)
    ? order.quickBooksProjectNames.map((value) => String(value ?? '').trim()).filter(Boolean)
    : []
  const fallbackName = String(order.quickBooksProjectName ?? '').trim()
  return [...new Set(fallbackName ? [fallbackName, ...names] : names)]
}

function rowsForProject(
  rows: QuickBooksDetailRow[] | undefined,
  projectIds: string[],
): QuickBooksDetailRow[] {
  const projectIdSet = new Set(projectIds.map((value) => String(value ?? '').trim()).filter(Boolean))

  if (projectIdSet.size === 0) {
    return []
  }

  return (Array.isArray(rows) ? rows : []).filter((row) => projectIdSet.has(String(row.projectId ?? '').trim()))
}

function sumAmounts(rows: QuickBooksDetailRow[]) {
  let totalAmount = 0
  let balanceAmount = 0

  rows.forEach((row) => {
    const total = Number(row.totalAmount)
    if (Number.isFinite(total)) {
      totalAmount += total
    }
    const balance = Number(row.balanceAmount)
    if (Number.isFinite(balance)) {
      balanceAmount += balance
    }
  })

  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    balanceAmount: Number(balanceAmount.toFixed(2)),
  }
}

function DetailRowsTable({ rows }: { rows: QuickBooksDetailRow[] }) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No transactions found for this project in this category.
      </Typography>
    )
  }

  const hasBalance = rows.some((row) => Number.isFinite(Number(row.balanceAmount)))
  const hasLineDetails = rows.some((row) => row.lineNumber !== null || Boolean(row.lineDescription))

  return (
    <TableContainer sx={{ maxHeight: '58vh' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Document</TableCell>
            <TableCell>Date</TableCell>
            {hasLineDetails ? <TableCell align="right">Line</TableCell> : null}
            {hasLineDetails ? <TableCell>Description</TableCell> : null}
            <TableCell align="right">Amount</TableCell>
            {hasBalance ? <TableCell align="right">Balance</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={`${row.type}:${row.id ?? 'none'}:${row.docNumber ?? 'none'}:${row.lineNumber ?? 0}:${index}`}
              hover
            >
              <TableCell>
                <Stack spacing={0.2}>
                  <Typography variant="body2" fontWeight={700}>
                    {row.docNumber || '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.id || '-'}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>{formatDate(row.txnDate)}</TableCell>
              {hasLineDetails ? <TableCell align="right">{row.lineNumber ?? '-'}</TableCell> : null}
              {hasLineDetails ? (
                <TableCell sx={{ maxWidth: 300, wordBreak: 'break-word' }}>
                  {row.lineDescription || '-'}
                </TableCell>
              ) : null}
              <TableCell align="right">{formatCurrency(Number(row.totalAmount), 2)}</TableCell>
              {hasBalance ? (
                <TableCell align="right">
                  {Number.isFinite(Number(row.balanceAmount))
                    ? formatCurrency(Number(row.balanceAmount), 2)
                    : '—'}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export function QuickBooksProjectDialog({
  open,
  order,
  metric,
  onClose,
}: QuickBooksProjectDialogProps) {
  const projectIds = useMemo(() => resolveOrderProjectIds(order), [order])
  const projectNames = useMemo(() => resolveOrderProjectNames(order), [order])
  const [activeTab, setActiveTab] = useState<QuickBooksProjectDialogTab>(tabFromMetric(metric))

  const overviewQuery = useQuery<QuickBooksOverviewResponse>({
    queryKey: ['quickbooks', 'overview'],
    queryFn: () => fetchQuickBooksOverview({ refresh: false }),
    enabled: open && projectIds.length > 0,
    staleTime: 60 * 1000,
  })

  const projectRows = useMemo(() => {
    if (!overviewQuery.data || projectIds.length === 0) {
      return {
        purchaseOrders: [] as QuickBooksDetailRow[],
        bills: [] as QuickBooksDetailRow[],
        invoices: [] as QuickBooksDetailRow[],
        payments: [] as QuickBooksDetailRow[],
      }
    }

    return {
      purchaseOrders: rowsForProject(overviewQuery.data.details.purchaseOrderLines, projectIds),
      bills: rowsForProject(overviewQuery.data.details.bills, projectIds),
      invoices: rowsForProject(overviewQuery.data.details.invoices, projectIds),
      payments: rowsForProject(overviewQuery.data.details.payments, projectIds),
    }
  }, [overviewQuery.data, projectIds])

  const billSummary = useMemo(() => sumAmounts(projectRows.bills), [projectRows.bills])
  const invoiceSummary = useMemo(() => sumAmounts(projectRows.invoices), [projectRows.invoices])

  const activeRows =
    activeTab === 'purchaseOrders'
      ? projectRows.purchaseOrders
      : activeTab === 'bills'
        ? projectRows.bills
        : activeTab === 'invoices'
          ? projectRows.invoices
          : projectRows.payments

  const errorMessage = overviewQuery.error instanceof Error ? overviewQuery.error.message : null
  const label = order?.orderNumber || order?.jobNumber || 'Order'
  const projectLabel = projectNames.length > 0
    ? projectNames.length <= 2
      ? projectNames.join(' + ')
      : `${projectNames.slice(0, 2).join(' + ')} +${projectNames.length - 2} more`
    : projectIds.join(', ')

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>
        {`QuickBooks Breakdown - ${label}`}
      </DialogTitle>
      <DialogContent>
        {projectIds.length === 0 ? (
          <Alert severity="warning">This row is not linked to a QuickBooks project yet.</Alert>
        ) : overviewQuery.isLoading ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading QuickBooks details...</Typography>
          </Stack>
        ) : errorMessage ? (
          <Alert severity="error">{errorMessage}</Alert>
        ) : !overviewQuery.data ? (
          <Alert severity="info">No QuickBooks data found.</Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                label={`Projects (${projectIds.length}): ${projectLabel}`}
                variant="outlined"
              />
              <Chip
                label={`Bills left to pay: ${formatCurrency(billSummary.balanceAmount, 2)}`}
                color={billSummary.balanceAmount > 0 ? 'warning' : 'success'}
                variant="outlined"
              />
              <Chip
                label={`Invoice open balance: ${formatCurrency(invoiceSummary.balanceAmount, 2)}`}
                color={invoiceSummary.balanceAmount > 0 ? 'warning' : 'default'}
                variant="outlined"
              />
            </Stack>

            <Tabs
              value={activeTab}
              onChange={(_event, nextValue: QuickBooksProjectDialogTab) => setActiveTab(nextValue)}
              variant="scrollable"
            >
              <Tab label={`PO lines (${projectRows.purchaseOrders.length})`} value="purchaseOrders" />
              <Tab label={`Bills (${projectRows.bills.length})`} value="bills" />
              <Tab label={`Invoices (${projectRows.invoices.length})`} value="invoices" />
              <Tab label={`Payments (${projectRows.payments.length})`} value="payments" />
            </Tabs>

            <DetailRowsTable rows={activeRows} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
