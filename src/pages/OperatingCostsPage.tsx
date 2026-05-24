import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  fetchQuickBooksOverview,
  type QuickBooksBankAccountTransaction,
  type QuickBooksDetailRow,
} from '../features/quickbooks/api'
import { splitQuickBooksProjectLabel } from '../features/quickbooks/utils'
import { formatCurrency, formatDisplayDate, formatInteger } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type FilterMode = 'month' | 'range'
type DrilldownType = 'noProject' | 'general' | 'payroll'

type PeriodRange = {
  label: string
  startMs: number | null
  endMs: number | null
}

type PurchaseOrderBuckets = {
  withProject: QuickBooksDetailRow[]
  withoutProject: QuickBooksDetailRow[]
  general: QuickBooksDetailRow[]
  payroll: QuickBooksDetailRow[]
  customerStock: QuickBooksDetailRow[]
}

const generalProjectTokens = [
  'general',
  'general expense',
]

const payrollProjectTokens = [
  'payroll',
]

const customerStockTokens = [
  'customer stock',
  'customer-stock',
  'customerstock',
]

function normalizeMatcherValue(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchesAnyToken(value: string | null | undefined, tokens: string[]) {
  const normalized = normalizeMatcherValue(value)

  if (!normalized) {
    return false
  }

  return tokens.some((token) => {
    const normalizedToken = normalizeMatcherValue(token)

    if (!normalizedToken) {
      return false
    }

    return normalized === normalizedToken || normalized.includes(normalizedToken)
  })
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getCurrentMonthValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')

  return `${year}-${month}`
}

function getDefaultFromDateValue() {
  const now = new Date()

  return formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1))
}

function getDefaultToDateValue() {
  const now = new Date()

  return formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0))
}

function parseDateOnlyToStartMs(value: string) {
  const normalized = String(value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  return Date.UTC(year, month - 1, day, 0, 0, 0, 0)
}

function parseDateOnlyToEndMs(value: string) {
  const normalized = String(value ?? '').trim()
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  return Date.UTC(year, month - 1, day, 23, 59, 59, 999)
}

function parseTransactionDateToMs(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return parseDateOnlyToStartMs(normalized)
  }

  const parsedMs = Date.parse(normalized)

  if (!Number.isFinite(parsedMs)) {
    return null
  }

  return parsedMs
}

function resolvePeriodRange({
  filterMode,
  monthValue,
  fromDate,
  toDate,
}: {
  filterMode: FilterMode
  monthValue: string
  fromDate: string
  toDate: string
}): PeriodRange {
  if (filterMode === 'month') {
    const match = String(monthValue ?? '').trim().match(/^(\d{4})-(\d{2})$/)

    if (!match) {
      return {
        label: 'All dates',
        startMs: null,
        endMs: null,
      }
    }

    const year = Number(match[1])
    const month = Number(match[2])
    const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0)
    const endMs = Date.UTC(year, month, 0, 23, 59, 59, 999)
    const label = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(startMs))

    return {
      label,
      startMs,
      endMs,
    }
  }

  const startMs = parseDateOnlyToStartMs(fromDate)
  const endMs = parseDateOnlyToEndMs(toDate)

  if (startMs === null && endMs === null) {
    return {
      label: 'All dates',
      startMs: null,
      endMs: null,
    }
  }

  const fromLabel = fromDate || 'Any start'
  const toLabel = toDate || 'Any end'

  return {
    label: `${fromLabel} to ${toLabel}`,
    startMs,
    endMs,
  }
}

function isDateInPeriod(value: string | null | undefined, period: PeriodRange) {
  const dateMs = parseTransactionDateToMs(value)

  if (dateMs === null) {
    return false
  }

  if (period.startMs !== null && dateMs < period.startMs) {
    return false
  }

  if (period.endMs !== null && dateMs > period.endMs) {
    return false
  }

  return true
}

function sumDetailRowsAmount(rows: QuickBooksDetailRow[]) {
  return Number(rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0).toFixed(2))
}

function sumBankOutflow(rows: QuickBooksBankAccountTransaction[]) {
  return Number(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2))
}

function buildSearchTextForPurchaseOrderLine(row: QuickBooksDetailRow) {
  return [
    row.docNumber,
    row.id,
    row.projectId,
    row.projectName,
    row.lineDescription,
    row.reason,
    row.txnDate,
  ]
    .map((value) => normalizeMatcherValue(value))
    .join(' ')
}

function filterPurchaseOrderRows(rows: QuickBooksDetailRow[], searchText: string) {
  const normalizedSearchText = normalizeMatcherValue(searchText)

  if (!normalizedSearchText) {
    return rows
  }

  return rows.filter((row) => buildSearchTextForPurchaseOrderLine(row).includes(normalizedSearchText))
}

function PurchaseOrderLinesTable({
  rows,
  searchText,
  onSearchChange,
  emptyMessage,
}: {
  rows: QuickBooksDetailRow[]
  searchText: string
  onSearchChange: (value: string) => void
  emptyMessage: string
}) {
  const filteredRows = useMemo(
    () => filterPurchaseOrderRows(rows, searchText),
    [rows, searchText],
  )

  return (
    <Stack spacing={1.2}>
      <TextField
        size="small"
        label="Search"
        placeholder="Document, description, project, reason"
        value={searchText}
        onChange={(event) => {
          onSearchChange(event.target.value)
        }}
      />

      <TableContainer sx={{ maxHeight: 460, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Document</TableCell>
              <TableCell>Line #</TableCell>
              <TableCell>Project</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">{emptyMessage}</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row, index) => {
                const splitProjectLabel = splitQuickBooksProjectLabel(
                  row.projectName || '',
                  row.projectId || '-',
                )

                return (
                  <TableRow key={`${row.id || 'no-id'}-${row.docNumber || 'no-doc'}-${row.lineNumber || 'no-line'}-${index}`} hover>
                    <TableCell>{formatDisplayDate(row.txnDate, { emptyLabel: '-', dateOnly: true })}</TableCell>
                    <TableCell>{row.docNumber || row.id || '-'}</TableCell>
                    <TableCell>{row.lineNumber ?? '-'}</TableCell>
                    <TableCell>
                      {row.projectId
                        ? (
                          <Stack spacing={0.25}>
                            <Typography variant="body2" fontWeight={600}>{splitProjectLabel.projectNumber}</Typography>
                            <Typography variant="caption" color="text.secondary">{row.projectName || row.projectId}</Typography>
                          </Stack>
                        )
                        : '-'}
                    </TableCell>
                    <TableCell>{row.lineDescription || '-'}</TableCell>
                    <TableCell align="right">{formatCurrency(row.totalAmount, 2)}</TableCell>
                    <TableCell>{row.reason || '-'}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}

export default function OperatingCostsPage() {
  const queryClient = useQueryClient()
  const [filterMode, setFilterMode] = useState<FilterMode>('month')
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthValue())
  const [fromDate, setFromDate] = useState(getDefaultFromDateValue())
  const [toDate, setToDate] = useState(getDefaultToDateValue())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [drilldownType, setDrilldownType] = useState<DrilldownType | null>(null)
  const [drilldownSearchText, setDrilldownSearchText] = useState('')
  const [customerStockSearchText, setCustomerStockSearchText] = useState('')

  const quickBooksOverviewQuery = useQuery({
    queryKey: QUERY_KEYS.quickbooksOverviewFull,
    queryFn: () => fetchQuickBooksOverview({ full: true }),
    staleTime: 30 * 1000,
  })

  const period = useMemo(() => resolvePeriodRange({
    filterMode,
    monthValue: selectedMonth,
    fromDate,
    toDate,
  }), [filterMode, selectedMonth, fromDate, toDate])

  const periodBills = useMemo(
    () => (quickBooksOverviewQuery.data?.details.bills ?? [])
      .filter((row) => isDateInPeriod(row.txnDate, period)),
    [quickBooksOverviewQuery.data?.details.bills, period],
  )

  const periodBankOutflows = useMemo(
    () => (quickBooksOverviewQuery.data?.bankAccountTransactions ?? [])
      .filter((row) => row.direction === 'out')
      .filter((row) => isDateInPeriod(row.txnDate, period)),
    [quickBooksOverviewQuery.data?.bankAccountTransactions, period],
  )

  const purchaseOrderBuckets = useMemo<PurchaseOrderBuckets>(() => {
    const nextBuckets: PurchaseOrderBuckets = {
      withProject: [],
      withoutProject: [],
      general: [],
      payroll: [],
      customerStock: [],
    }

    for (const row of periodBills) {
      const splitProjectLabel = splitQuickBooksProjectLabel(
        row.projectName || '',
        row.projectId || '-',
      )
      const rowTextFields = [
        row.projectName,
        row.projectId,
        splitProjectLabel.projectNumber,
        row.lineDescription,
        row.reason,
        row.docNumber,
      ]
      const isCustomerStock = rowTextFields.some((value) => matchesAnyToken(value, customerStockTokens))
      const isGeneral = rowTextFields.some((value) => matchesAnyToken(value, generalProjectTokens)) || isCustomerStock
      const isPayroll = rowTextFields.some((value) => matchesAnyToken(value, payrollProjectTokens))

      if (isPayroll) {
        nextBuckets.payroll.push(row)
        continue
      }

      if (isGeneral) {
        nextBuckets.general.push(row)

        if (isCustomerStock) {
          nextBuckets.customerStock.push(row)
        }

        continue
      }

      if (row.projectId) {
        nextBuckets.withProject.push(row)
        continue
      }

      nextBuckets.withoutProject.push(row)
    }

    return nextBuckets
  }, [periodBills])

  const businessSpentAmount = sumDetailRowsAmount(periodBills)
  const bankOutflowAmount = sumBankOutflow(periodBankOutflows)
  const operatingCostAmount = sumDetailRowsAmount(periodBills)
  const withProjectAmount = sumDetailRowsAmount(purchaseOrderBuckets.withProject)
  const withoutProjectAmount = sumDetailRowsAmount(purchaseOrderBuckets.withoutProject)
  const generalAmount = sumDetailRowsAmount(purchaseOrderBuckets.general)
  const payrollAmount = sumDetailRowsAmount(purchaseOrderBuckets.payroll)
  const customerStockAmount = sumDetailRowsAmount(purchaseOrderBuckets.customerStock)

  const drilldownRows = useMemo(() => {
    if (drilldownType === 'general') {
      return purchaseOrderBuckets.general
    }

    if (drilldownType === 'payroll') {
      return purchaseOrderBuckets.payroll
    }

    return purchaseOrderBuckets.withoutProject
  }, [drilldownType, purchaseOrderBuckets.general, purchaseOrderBuckets.payroll, purchaseOrderBuckets.withoutProject])

  const drilldownTitle = drilldownType === 'general'
    ? 'General Cost Lines'
    : drilldownType === 'payroll'
      ? 'Payroll Cost Lines'
      : 'Cost Lines Without Project'

  const queryErrorMessage = quickBooksOverviewQuery.error instanceof Error
    ? quickBooksOverviewQuery.error.message
    : null

  const handleRefresh = () => {
    setIsRefreshing(true)

    void fetchQuickBooksOverview({ refresh: true, full: true })
      .then((payload) => {
        queryClient.setQueryData(QUERY_KEYS.quickbooksOverviewFull, payload)
      })
      .finally(() => {
        setIsRefreshing(false)
      })
  }

  return (
    <Stack spacing={2.2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.4 } }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h5" fontWeight={800}>Operating Cost Control</Typography>
              <Typography color="text.secondary">
                QuickBooks-backed monthly or date-range visibility for company spend, bank outflow, and project assignment gaps.
              </Typography>
            </Box>

            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={handleRefresh}
              disabled={isRefreshing || quickBooksOverviewQuery.isLoading}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh from QuickBooks'}
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={filterMode}
              onChange={(_event, value: FilterMode | null) => {
                if (!value) {
                  return
                }

                setFilterMode(value)
              }}
            >
              <ToggleButton value="month">By month</ToggleButton>
              <ToggleButton value="range">Custom range</ToggleButton>
            </ToggleButtonGroup>

            {filterMode === 'month' ? (
              <TextField
                size="small"
                type="month"
                label="Month"
                value={selectedMonth}
                onChange={(event) => {
                  setSelectedMonth(event.target.value)
                }}
                sx={{ width: { xs: '100%', sm: 220 } }}
                InputLabelProps={{ shrink: true }}
              />
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  type="date"
                  label="From"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value)
                  }}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: { xs: '100%', sm: 170 } }}
                />

                <TextField
                  size="small"
                  type="date"
                  label="To"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value)
                  }}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: { xs: '100%', sm: 170 } }}
                />
              </Stack>
            )}

            <Chip size="small" color="primary" variant="outlined" label={`Period: ${period.label}`} />
          </Stack>
        </Stack>
      </Paper>

      {queryErrorMessage ? (
        <Alert severity="error">{queryErrorMessage}</Alert>
      ) : null}

      {quickBooksOverviewQuery.isLoading ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">Loading QuickBooks operating cost data...</Typography>
        </Paper>
      ) : (
        <>
          <Alert severity="info">
            Box definitions: Business spent uses Bills, Money out of bank uses bank transactions marked as outflow, and Business cost uses classified Bill rows.
          </Alert>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AttachMoneyRoundedIcon color="primary" />
                <Typography variant="h6" fontWeight={700}>Company Cost Snapshot</Typography>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <Paper variant="outlined" sx={{ p: 1.2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">Business spent</Typography>
                  <Typography variant="h5" fontWeight={800}>{formatCurrency(businessSpentAmount, 2)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Bills in selected period: {formatInteger(periodBills.length)}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">Money out of bank</Typography>
                  <Typography variant="h5" fontWeight={800}>{formatCurrency(bankOutflowAmount, 2)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Outflow transactions: {formatInteger(periodBankOutflows.length)}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.2, flex: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary">Business cost</Typography>
                  <Typography variant="h5" fontWeight={800}>{formatCurrency(operatingCostAmount, 2)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Bill rows: {formatInteger(periodBills.length)}
                  </Typography>
                </Paper>
              </Stack>
            </Stack>
          </Paper>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25}>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, flex: 2, cursor: 'pointer' }}
              onClick={() => {
                setDrilldownType('noProject')
                setDrilldownSearchText('')
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CategoryRoundedIcon color="primary" />
                  <Typography variant="h6" fontWeight={700}>Project Assignment Spend</Typography>
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">Spend with project</Typography>
                    <Typography variant="h5" fontWeight={800}>{formatCurrency(withProjectAmount, 2)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatInteger(purchaseOrderBuckets.withProject.length)} lines
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1, flex: 1, borderColor: 'warning.light' }}>
                    <Typography variant="subtitle2" color="text.secondary">Spend without project</Typography>
                    <Typography variant="h5" fontWeight={800} color="warning.main">{formatCurrency(withoutProjectAmount, 2)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatInteger(purchaseOrderBuckets.withoutProject.length)} lines. Click to inspect.
                    </Typography>
                  </Paper>
                </Stack>
              </Stack>
            </Paper>

            <Paper
              variant="outlined"
              sx={{ p: 1.5, flex: 1, cursor: 'pointer' }}
              onClick={() => {
                setDrilldownType('general')
                setDrilldownSearchText('')
              }}
            >
              <Stack spacing={0.8}>
                <Typography variant="subtitle1" fontWeight={700}>General Project</Typography>
                <Typography variant="h5" fontWeight={800}>{formatCurrency(generalAmount, 2)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatInteger(purchaseOrderBuckets.general.length)} lines, excluded from regular project spend.
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Customer stock included: ${formatCurrency(customerStockAmount, 2)}`}
                />
              </Stack>
            </Paper>

            <Paper
              variant="outlined"
              sx={{ p: 1.5, flex: 1, cursor: 'pointer' }}
              onClick={() => {
                setDrilldownType('payroll')
                setDrilldownSearchText('')
              }}
            >
              <Stack spacing={0.8}>
                <Typography variant="subtitle1" fontWeight={700}>Payroll Project</Typography>
                <Typography variant="h5" fontWeight={800}>{formatCurrency(payrollAmount, 2)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatInteger(purchaseOrderBuckets.payroll.length)} lines, excluded from regular project spend.
                </Typography>
              </Stack>
            </Paper>
          </Stack>

          <Paper variant="outlined" sx={{ p: 1.6 }}>
            <Stack spacing={1.2}>
              <Typography variant="h6" fontWeight={700}>Customer Stock Cost Lines (treated as General)</Typography>
              <Typography color="text.secondary">
                Lines matching "Customer Stock" are grouped under General and shown here for direct review.
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                <Chip size="small" variant="outlined" label={`Lines: ${formatInteger(purchaseOrderBuckets.customerStock.length)}`} />
                <Chip size="small" variant="outlined" label={`Amount: ${formatCurrency(customerStockAmount, 2)}`} />
              </Stack>

              <PurchaseOrderLinesTable
                rows={purchaseOrderBuckets.customerStock}
                searchText={customerStockSearchText}
                onSearchChange={setCustomerStockSearchText}
                emptyMessage="No customer stock lines found for this period."
              />
            </Stack>
          </Paper>
        </>
      )}

      <Dialog
        open={Boolean(drilldownType)}
        onClose={() => {
          setDrilldownType(null)
          setDrilldownSearchText('')
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>{drilldownTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Chip size="small" variant="outlined" label={`Lines: ${formatInteger(drilldownRows.length)}`} />
              <Chip size="small" variant="outlined" label={`Amount: ${formatCurrency(sumDetailRowsAmount(drilldownRows), 2)}`} />
            </Stack>

            <Divider />

            <PurchaseOrderLinesTable
              rows={drilldownRows}
              searchText={drilldownSearchText}
              onSearchChange={setDrilldownSearchText}
              emptyMessage="No lines found for this view."
            />
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}