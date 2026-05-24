import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RequestQuoteRoundedIcon from '@mui/icons-material/RequestQuoteRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { DataGrid, GridToolbar, type GridColDef } from '@mui/x-data-grid'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatCurrency, formatDateTime, formatInteger } from '../lib/formatters'
import {
  createQuickBooksAuthorizeUrl,
  fetchQuickBooksHistory,
  type QuickBooksLoanDetailRow,
  type QuickBooksLoanSummary,
  fetchQuickBooksOverview,
  fetchQuickBooksStatus,
  type QuickBooksBankAccountTransaction,
  type QuickBooksDetailRow,
  type QuickBooksHistoryDirection,
  type QuickBooksHistoryType,
  type QuickBooksOverviewResponse,
  type QuickBooksProjectSummary,
  type QuickBooksUnlinkedTransaction,
} from '../features/quickbooks/api'
import { splitQuickBooksProjectLabel } from '../features/quickbooks/utils'

type QuickBooksDrilldownKey =
  | 'bankAccount'
  | 'projects'
  | 'loanSummary'
  | 'purchaseOrders'
  | 'purchaseOrderLines'
  | 'unlinkedPurchaseOrderLines'
  | 'bills'
  | 'invoices'
  | 'payments'
  | 'unlinkedTransactions'
  | 'outstandingProjects'

type ProjectMetricType = 'purchaseOrders' | 'bills' | 'invoices' | 'payments'

type QuickBooksSummaryCard = {
  id: string
  key: QuickBooksDrilldownKey
  title: string
  value: string
  helper: string
  color: string
  icon: ReactNode
  loanBucketId?: string
}

type QuickBooksSummaryCardGroup = {
  id: string
  title: string
  description: string
  cards: QuickBooksSummaryCard[]
}

type OAuthNotice = {
  severity: 'success' | 'error' | 'info'
  message: string
}

type PurchaseOrderRecord = {
  key: string
  id: string | null
  docNumber: string | null
  txnDate: string | null
  totalAmount: number
  lineCount: number
  linkedLineCount: number
  unlinkedLineCount: number
  unlinkedAmount: number
  projectIds: string[]
  projectNameById: Record<string, string>
  projectAmountById: Record<string, number>
}

type ProjectRollup = {
  projectId: string
  projectName: string
  active: boolean
  transactionCount: number
  purchaseOrderCount: number
  purchaseOrderAmount: number
  billCount: number
  billAmount: number
  invoiceCount: number
  invoiceAmount: number
  paymentCount: number
  paymentAmount: number
  outstandingAmount: number
}

type ProjectMetricDrilldown = {
  projectId: string
  projectName: string
  metricType: ProjectMetricType
}

type BankHistoryGridRow = QuickBooksBankAccountTransaction & {
  id: string
}

type DetailHistoryGridRow = QuickBooksDetailRow & {
  id: string
  candidateRefsText: string
}

type QuickBooksHistoryRequestFilters = {
  fromDate?: string
  toDate?: string
  direction?: QuickBooksHistoryDirection
}

type QuickBooksHistoryFilterState = {
  fromDate: string
  toDate: string
  direction: 'all' | QuickBooksHistoryDirection
}

const defaultQuickBooksHistoryFilterState: QuickBooksHistoryFilterState = {
  fromDate: '',
  toDate: '',
  direction: 'all',
}

const quickBooksHistoryBatchSize = 30

const quickBooksHistoryTypeByDrilldown: Partial<Record<QuickBooksDrilldownKey, QuickBooksHistoryType>> = {
  bankAccount: 'bankAccountTransactions',
  bills: 'bills',
  outstandingProjects: 'outstandingInvoices',
}

function getQuickBooksHistoryPreviewRows(overview: QuickBooksOverviewResponse, type: QuickBooksHistoryType) {
  if (type === 'bankAccountTransactions') {
    return overview.bankAccountTransactions
  }

  if (type === 'bills') {
    return overview.details.bills
  }

  // Outstanding invoices are pulled from a dedicated history endpoint filter.
  return []
}

function getQuickBooksHistoryPreviewTotal(overview: QuickBooksOverviewResponse, type: QuickBooksHistoryType) {
  if (type === 'bankAccountTransactions') {
    return overview.historyMeta?.bankAccountTransactions.total ?? overview.bankAccountTransactions.length
  }

  if (type === 'bills') {
    return overview.historyMeta?.details.bills.total ?? overview.details.bills.length
  }

  return overview.historyMeta?.outstandingInvoices.total ?? 0
}

const quickBooksDrilldownTitles: Record<QuickBooksDrilldownKey, string> = {
  bankAccount: 'Bank Account',
  projects: 'Projects',
  loanSummary: 'Loan Summary',
  purchaseOrders: 'Purchase Orders',
  purchaseOrderLines: 'Purchase-Order Lines',
  unlinkedPurchaseOrderLines: 'PO Lines Missing Project',
  bills: 'Bills',
  invoices: 'Invoices',
  payments: 'Payments',
  unlinkedTransactions: 'Unlinked Transactions',
  outstandingProjects: 'Outstanding Balance History',
}

const projectMetricTitleByType: Record<ProjectMetricType, string> = {
  purchaseOrders: 'Purchase Orders',
  bills: 'Bills',
  invoices: 'Invoices',
  payments: 'Payments',
}

const nonOrderQuickBooksProjectMatchers = [
  'company purchase',
  'general expense',
  'payroll',
  'repair',
]

const excludedQuickBooksLoanLabelMatchers = [
  'employee short term loans',
]

function normalizeQuickBooksProjectMatcher(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isExcludedQuickBooksLoanLabel(value: string | null | undefined) {
  const normalized = normalizeQuickBooksProjectMatcher(value)

  if (!normalized) {
    return false
  }

  return excludedQuickBooksLoanLabelMatchers.some((matcher) => normalized.includes(matcher))
}

function isQuickBooksNonOrderProject(project: QuickBooksProjectSummary) {
  const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId)
  const normalizedCandidates = [
    normalizeQuickBooksProjectMatcher(project.projectName),
    normalizeQuickBooksProjectMatcher(splitLabel.projectNumber),
  ].filter((candidate) => candidate.length > 0)

  return normalizedCandidates.some((candidate) => (
    nonOrderQuickBooksProjectMatchers.some((matcher) => candidate === matcher || candidate.includes(matcher))
  ))
}

function formatDate(value: string | null) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}


function formatCandidateRefs(refs: string[]) {
  if (!refs.length) {
    return '-'
  }

  return refs.join(', ')
}

function toErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function quickBooksDetailTypeLabel(value: QuickBooksDetailRow['type']) {
  if (value === 'purchaseOrderLine') {
    return 'PO Line'
  }

  if (value === 'bill') {
    return 'Bill'
  }

  if (value === 'invoice') {
    return 'Invoice'
  }

  return 'Payment'
}

function quickBooksTxnTypeLabel(value: QuickBooksUnlinkedTransaction['type']) {
  if (value === 'purchaseOrder') {
    return 'Purchase Order'
  }

  if (value === 'bill') {
    return 'Bill'
  }

  if (value === 'invoice') {
    return 'Invoice'
  }

  return 'Payment'
}

function quickBooksLoanTxnTypeLabel(value: QuickBooksLoanDetailRow['type']) {
  if (value === 'journalEntry') {
    return 'Journal Entry'
  }

  if (value === 'transfer') {
    return 'Transfer'
  }

  if (value === 'deposit') {
    return 'Deposit'
  }

  return 'Check'
}

function quickBooksLoanDirectionLabel(value: QuickBooksLoanDetailRow['direction']) {
  if (value === 'in') {
    return 'Invested In'
  }

  if (value === 'out') {
    return 'Taken Out'
  }

  return 'Unclassified'
}

function quickBooksBankDirectionLabel(value: QuickBooksBankAccountTransaction['direction']) {
  if (value === 'in') {
    return 'Money In'
  }

  if (value === 'out') {
    return 'Money Out'
  }

  return 'Unclassified'
}

function quickBooksBankTxnTypeLabel(value: QuickBooksBankAccountTransaction['type']) {
  return quickBooksLoanTxnTypeLabel(value)
}

function purchaseOrderKeyFromDetailRow(row: QuickBooksDetailRow) {
  const idPart = row.id || 'no-id'
  const docPart = row.docNumber || 'no-doc'
  const datePart = row.txnDate || 'no-date'

  return `${idPart}|${docPart}|${datePart}`
}

function buildPurchaseOrderRecords(rows: QuickBooksDetailRow[]) {
  const recordsByKey = new Map<string, {
    key: string
    id: string | null
    docNumber: string | null
    txnDate: string | null
    totalAmount: number
    lineCount: number
    linkedLineCount: number
    unlinkedLineCount: number
    unlinkedAmount: number
    projectNameById: Map<string, string>
    projectAmountById: Map<string, number>
  }>()

  rows.forEach((row) => {
    const key = purchaseOrderKeyFromDetailRow(row)

    if (!recordsByKey.has(key)) {
      recordsByKey.set(key, {
        key,
        id: row.id,
        docNumber: row.docNumber,
        txnDate: row.txnDate,
        totalAmount: 0,
        lineCount: 0,
        linkedLineCount: 0,
        unlinkedLineCount: 0,
        unlinkedAmount: 0,
        projectNameById: new Map<string, string>(),
        projectAmountById: new Map<string, number>(),
      })
    }

    const record = recordsByKey.get(key)

    if (!record) {
      return
    }

    record.totalAmount = roundMoney(record.totalAmount + row.totalAmount)
    record.lineCount += 1

    if (!row.projectId) {
      record.unlinkedLineCount += 1
      record.unlinkedAmount = roundMoney(record.unlinkedAmount + row.totalAmount)
      return
    }

    record.linkedLineCount += 1

    if (row.projectName) {
      record.projectNameById.set(row.projectId, row.projectName)
    }

    const currentAmount = record.projectAmountById.get(row.projectId) ?? 0
    record.projectAmountById.set(row.projectId, roundMoney(currentAmount + row.totalAmount))
  })

  return [...recordsByKey.values()]
    .map((record): PurchaseOrderRecord => {
      const projectNameByIdObject: Record<string, string> = {}
      const projectAmountByIdObject: Record<string, number> = {}

      record.projectNameById.forEach((name, projectId) => {
        projectNameByIdObject[projectId] = name
      })

      record.projectAmountById.forEach((amount, projectId) => {
        projectAmountByIdObject[projectId] = amount
      })

      return {
        key: record.key,
        id: record.id,
        docNumber: record.docNumber,
        txnDate: record.txnDate,
        totalAmount: record.totalAmount,
        lineCount: record.lineCount,
        linkedLineCount: record.linkedLineCount,
        unlinkedLineCount: record.unlinkedLineCount,
        unlinkedAmount: record.unlinkedAmount,
        projectIds: Object.keys(projectAmountByIdObject),
        projectNameById: projectNameByIdObject,
        projectAmountById: projectAmountByIdObject,
      }
    })
    .sort((left, right) => {
      const leftDate = Date.parse(left.txnDate || '')
      const rightDate = Date.parse(right.txnDate || '')

      if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
        return rightDate - leftDate
      }

      const leftDoc = left.docNumber || left.id || ''
      const rightDoc = right.docNumber || right.id || ''

      return leftDoc.localeCompare(rightDoc)
    })
}

function buildProjectRollups({
  projects,
  purchaseOrders,
  bills,
  invoices,
  payments,
}: {
  projects: QuickBooksProjectSummary[]
  purchaseOrders: PurchaseOrderRecord[]
  bills: QuickBooksDetailRow[]
  invoices: QuickBooksDetailRow[]
  payments: QuickBooksDetailRow[]
}) {
  const rollupsByProjectId = new Map<string, ProjectRollup>()

  projects.forEach((project) => {
    rollupsByProjectId.set(project.projectId, {
      projectId: project.projectId,
      projectName: project.projectName,
      active: project.active,
      transactionCount: 0,
      purchaseOrderCount: 0,
      purchaseOrderAmount: 0,
      billCount: 0,
      billAmount: 0,
      invoiceCount: 0,
      invoiceAmount: 0,
      paymentCount: 0,
      paymentAmount: 0,
      outstandingAmount: 0,
    })
  })

  const ensureRollup = (projectId: string, projectName: string | null) => {
    const existing = rollupsByProjectId.get(projectId)

    if (existing) {
      return existing
    }

    const next: ProjectRollup = {
      projectId,
      projectName: projectName || projectId,
      active: true,
      transactionCount: 0,
      purchaseOrderCount: 0,
      purchaseOrderAmount: 0,
      billCount: 0,
      billAmount: 0,
      invoiceCount: 0,
      invoiceAmount: 0,
      paymentCount: 0,
      paymentAmount: 0,
      outstandingAmount: 0,
    }

    rollupsByProjectId.set(projectId, next)

    return next
  }

  purchaseOrders.forEach((purchaseOrder) => {
    Object.entries(purchaseOrder.projectAmountById).forEach(([projectId, amount]) => {
      const rollup = ensureRollup(projectId, purchaseOrder.projectNameById[projectId] ?? null)
      rollup.purchaseOrderCount += 1
      rollup.purchaseOrderAmount = roundMoney(rollup.purchaseOrderAmount + amount)
    })
  })

  bills.forEach((bill) => {
    if (!bill.projectId) {
      return
    }

    const rollup = ensureRollup(bill.projectId, bill.projectName)
    rollup.billCount += 1
    rollup.billAmount = roundMoney(rollup.billAmount + bill.totalAmount)
  })

  invoices.forEach((invoice) => {
    if (!invoice.projectId) {
      return
    }

    const rollup = ensureRollup(invoice.projectId, invoice.projectName)
    rollup.invoiceCount += 1
    rollup.invoiceAmount = roundMoney(rollup.invoiceAmount + invoice.totalAmount)
  })

  payments.forEach((payment) => {
    if (!payment.projectId) {
      return
    }

    const rollup = ensureRollup(payment.projectId, payment.projectName)
    rollup.paymentCount += 1
    rollup.paymentAmount = roundMoney(rollup.paymentAmount + payment.totalAmount)
  })

  rollupsByProjectId.forEach((rollup) => {
    rollup.transactionCount =
      rollup.purchaseOrderCount
      + rollup.billCount
      + rollup.invoiceCount
      + rollup.paymentCount
    rollup.outstandingAmount = roundMoney(rollup.invoiceAmount - rollup.paymentAmount)
  })

  return rollupsByProjectId
}

function ProjectSummaryTable({
  rows,
  projectRollupsById,
  onMetricClick,
}: {
  rows: QuickBooksProjectSummary[]
  projectRollupsById: Map<string, ProjectRollup>
  onMetricClick?: (input: {
    projectId: string
    projectName: string
    metricType: ProjectMetricType
  }) => void
}) {
  const [searchText, setSearchText] = useState('')

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchText.trim().toLowerCase()

    if (!normalizedQuery) {
      return rows
    }

    return rows.filter((row) => {
      const rollup = projectRollupsById.get(row.projectId)
      const projectName = rollup?.projectName || row.projectName
      const splitLabel = splitQuickBooksProjectLabel(projectName, row.projectId)
      const projectNumber = String(splitLabel.projectNumber || '').toLowerCase()

      return projectNumber.includes(normalizedQuery)
    })
  }, [projectRollupsById, rows, searchText])

  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No projects to show.
      </Typography>
    )
  }

  const renderMetricCell = (
    input: {
      metricType: ProjectMetricType
      count: number
      amount: number
      projectId: string
      projectName: string
    },
  ) => {
    const { metricType, count, amount, projectId, projectName } = input

    return (
      <Stack spacing={0.3} alignItems="flex-end">
        <Button
          size="small"
          variant="text"
          onClick={() => {
            onMetricClick?.({
              projectId,
              projectName,
              metricType,
            })
          }}
          disabled={!onMetricClick || count === 0}
          sx={{
            minWidth: 0,
            px: 0.4,
            py: 0,
            lineHeight: 1.2,
            fontWeight: 700,
          }}
        >
          {formatInteger(count)}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {formatCurrency(amount)}
        </Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={1.25}>
      <TextField
        size="small"
        label="Search Projects"
        placeholder="Search project number"
        value={searchText}
        onChange={(event) => {
          setSearchText(event.target.value)
        }}
      />

      {filteredRows.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No projects match your search.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 600 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Customer</TableCell>
                <TableCell>Project #</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Transactions</TableCell>
                <TableCell align="right">PO</TableCell>
                <TableCell align="right">Bills</TableCell>
                <TableCell align="right">Invoices</TableCell>
                <TableCell align="right">Payments</TableCell>
                <TableCell align="right">Outstanding</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.map((row) => {
                const rollup = projectRollupsById.get(row.projectId)
                const projectName = rollup?.projectName || row.projectName
                const transactionCount = rollup?.transactionCount ?? row.transactionCount
                const purchaseOrderCount = rollup?.purchaseOrderCount ?? row.purchaseOrderCount
                const purchaseOrderAmount = rollup?.purchaseOrderAmount ?? row.purchaseOrderAmount
                const billCount = rollup?.billCount ?? row.billCount
                const billAmount = rollup?.billAmount ?? row.billAmount
                const invoiceCount = rollup?.invoiceCount ?? row.invoiceCount
                const invoiceAmount = rollup?.invoiceAmount ?? row.invoiceAmount
                const paymentCount = rollup?.paymentCount ?? row.paymentCount
                const paymentAmount = rollup?.paymentAmount ?? row.paymentAmount
                const outstandingAmount = rollup?.outstandingAmount ?? row.outstandingAmount
                const splitLabel = splitQuickBooksProjectLabel(projectName, row.projectId)

                return (
                  <TableRow key={row.projectId} hover>
                    <TableCell sx={{ maxWidth: 260, wordBreak: 'break-word' }}>
                      <Typography variant="body2" fontWeight={600}>
                        {splitLabel.customerName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={0.3}>
                        <Typography variant="body2" fontWeight={600}>
                          {splitLabel.projectNumber}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.projectId}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.active ? 'Active' : 'Inactive'}
                        color={row.active ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{formatInteger(transactionCount)}</TableCell>
                    <TableCell align="right">
                      {renderMetricCell({
                        metricType: 'purchaseOrders',
                        count: purchaseOrderCount,
                        amount: purchaseOrderAmount,
                        projectId: row.projectId,
                        projectName,
                      })}
                    </TableCell>
                    <TableCell align="right">
                      {renderMetricCell({
                        metricType: 'bills',
                        count: billCount,
                        amount: billAmount,
                        projectId: row.projectId,
                        projectName,
                      })}
                    </TableCell>
                    <TableCell align="right">
                      {renderMetricCell({
                        metricType: 'invoices',
                        count: invoiceCount,
                        amount: invoiceAmount,
                        projectId: row.projectId,
                        projectName,
                      })}
                    </TableCell>
                    <TableCell align="right">
                      {renderMetricCell({
                        metricType: 'payments',
                        count: paymentCount,
                        amount: paymentAmount,
                        projectId: row.projectId,
                        projectName,
                      })}
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={outstandingAmount > 0 ? 'warning.main' : 'text.primary'}
                      >
                        {formatCurrency(outstandingAmount)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}

function DetailRowsTable({
  rows,
  includeTypeColumn = false,
  hideProjectColumn = false,
}: {
  rows: QuickBooksDetailRow[]
  includeTypeColumn?: boolean
  hideProjectColumn?: boolean
}) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No transactions to show.
      </Typography>
    )
  }

  const showLineColumns = rows.some((row) => row.lineNumber !== null || Boolean(row.lineDescription))

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {includeTypeColumn ? <TableCell>Type</TableCell> : null}
            <TableCell>Document</TableCell>
            <TableCell>Date</TableCell>
            {showLineColumns ? <TableCell align="right">Line</TableCell> : null}
            {showLineColumns ? <TableCell>Description</TableCell> : null}
            {!hideProjectColumn ? <TableCell>Project</TableCell> : null}
            <TableCell>Candidate Refs</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Reason</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={`${row.type}:${row.id ?? 'none'}:${row.docNumber ?? 'none'}:${row.lineNumber ?? 0}:${index}`}
              hover
            >
              {includeTypeColumn ? <TableCell>{quickBooksDetailTypeLabel(row.type)}</TableCell> : null}
              <TableCell>
                <Stack spacing={0.3}>
                  <Typography variant="body2" fontWeight={600}>
                    {row.docNumber || '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.id || '-'}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>{formatDate(row.txnDate)}</TableCell>
              {showLineColumns ? <TableCell align="right">{row.lineNumber ?? '-'}</TableCell> : null}
              {showLineColumns ? (
                <TableCell sx={{ maxWidth: 280, wordBreak: 'break-word' }}>
                  {row.lineDescription || '-'}
                </TableCell>
              ) : null}
              {!hideProjectColumn ? (
                <TableCell>
                  <Stack spacing={0.3}>
                    <Typography variant="body2">{row.projectName || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.projectId || '-'}
                    </Typography>
                  </Stack>
                </TableCell>
              ) : null}
              <TableCell sx={{ maxWidth: 220, wordBreak: 'break-word' }}>
                <Typography variant="body2">{formatCandidateRefs(row.candidateProjectRefs)}</Typography>
              </TableCell>
              <TableCell align="right">{formatCurrency(row.totalAmount)}</TableCell>
              <TableCell sx={{ maxWidth: 320, wordBreak: 'break-word' }}>{row.reason || '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function PurchaseOrdersTable({
  rows,
  selectedProjectId = null,
}: {
  rows: PurchaseOrderRecord[]
  selectedProjectId?: string | null
}) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No purchase orders to show.
      </Typography>
    )
  }

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Purchase Order</TableCell>
            <TableCell>Date</TableCell>
            <TableCell align="right">Lines</TableCell>
            <TableCell>Projects</TableCell>
            <TableCell align="right">
              {selectedProjectId ? 'Project Amount' : 'PO Amount'}
            </TableCell>
            <TableCell align="right">Unlinked</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const amount = selectedProjectId
              ? row.projectAmountById[selectedProjectId] ?? 0
              : row.totalAmount

            return (
              <TableRow key={row.key} hover>
                <TableCell>
                  <Stack spacing={0.3}>
                    <Typography variant="body2" fontWeight={600}>
                      {row.docNumber || '-'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.id || '-'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>{formatDate(row.txnDate)}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2">{formatInteger(row.lineCount)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    linked {formatInteger(row.linkedLineCount)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 300, wordBreak: 'break-word' }}>
                  {row.projectIds.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No linked project
                    </Typography>
                  ) : (
                    <Stack spacing={0.25}>
                      {row.projectIds.slice(0, 2).map((projectId) => (
                        <Typography key={`${row.key}:${projectId}`} variant="body2">
                          {row.projectNameById[projectId] || projectId}
                        </Typography>
                      ))}
                      {row.projectIds.length > 2 ? (
                        <Typography variant="caption" color="text.secondary">
                          +{row.projectIds.length - 2} more
                        </Typography>
                      ) : null}
                    </Stack>
                  )}
                </TableCell>
                <TableCell align="right">{formatCurrency(amount)}</TableCell>
                <TableCell align="right">
                  {row.unlinkedLineCount > 0 ? (
                    <Stack spacing={0.25} alignItems="flex-end">
                      <Typography variant="body2">{formatInteger(row.unlinkedLineCount)} lines</Typography>
                      <Typography variant="caption" color="warning.main">
                        {formatCurrency(row.unlinkedAmount)}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      0
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function UnlinkedTransactionsTable({ rows }: { rows: QuickBooksUnlinkedTransaction[] }) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        No unlinked transactions.
      </Typography>
    )
  }

  return (
    <TableContainer sx={{ maxHeight: 600 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Type</TableCell>
            <TableCell>Document</TableCell>
            <TableCell>Date</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>Candidate Refs</TableCell>
            <TableCell>Reason</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={`${row.type}:${row.id ?? 'none'}:${row.docNumber ?? 'none'}:${index}`}
              hover
            >
              <TableCell>{quickBooksTxnTypeLabel(row.type)}</TableCell>
              <TableCell>
                <Stack spacing={0.3}>
                  <Typography variant="body2" fontWeight={600}>
                    {row.docNumber || '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.id || '-'}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>{formatDate(row.txnDate)}</TableCell>
              <TableCell align="right">{formatCurrency(row.totalAmount)}</TableCell>
              <TableCell sx={{ maxWidth: 220, wordBreak: 'break-word' }}>
                <Typography variant="body2">{formatCandidateRefs(row.candidateProjectRefs)}</Typography>
              </TableCell>
              <TableCell sx={{ maxWidth: 320, wordBreak: 'break-word' }}>{row.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function LoanSummaryDetailsTable({ bucket }: { bucket: QuickBooksLoanSummary }) {
  if (bucket.details.length === 0) {
    return (
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`Loan Balance ${formatCurrency(bucket.totalLoanAmount)}`} variant="outlined" />
          <Chip label={`Invested In ${formatCurrency(bucket.totalInvestedAmount)}`} variant="outlined" />
          <Chip label={`Taken Out ${formatCurrency(bucket.totalTakenOutAmount)}`} variant="outlined" />
        </Stack>
        <Typography color="text.secondary" sx={{ py: 1 }}>
          No loan movements found for this account yet.
        </Typography>
      </Stack>
    )
  }

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`Loan Balance ${formatCurrency(bucket.totalLoanAmount)}`} color="primary" variant="outlined" />
        <Chip label={`Invested In ${formatCurrency(bucket.totalInvestedAmount)}`} variant="outlined" />
        <Chip label={`Taken Out ${formatCurrency(bucket.totalTakenOutAmount)}`} variant="outlined" />
        <Chip label={`Movements ${formatInteger(bucket.movementCount)}`} variant="outlined" />
      </Stack>

      <TableContainer sx={{ maxHeight: 600 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Document</TableCell>
              <TableCell>Loan Account</TableCell>
              <TableCell>Direction</TableCell>
              <TableCell align="right">Invested In</TableCell>
              <TableCell align="right">Taken Out</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bucket.details.map((row, index) => (
              <TableRow
                key={`${row.type}:${row.id ?? 'none'}:${row.docNumber ?? 'none'}:${row.txnDate ?? 'none'}:${index}`}
                hover
              >
                <TableCell>{formatDate(row.txnDate)}</TableCell>
                <TableCell>{quickBooksLoanTxnTypeLabel(row.type)}</TableCell>
                <TableCell>
                  <Stack spacing={0.25}>
                    <Typography variant="body2" fontWeight={600}>
                      {row.docNumber || '-'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.id || '-'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">{row.accountName || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.accountNumber || row.accountId || '-'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={quickBooksLoanDirectionLabel(row.direction)}
                    color={row.direction === 'in' ? 'success' : row.direction === 'out' ? 'warning' : 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">{row.investedAmount > 0 ? formatCurrency(row.investedAmount) : '-'}</TableCell>
                <TableCell align="right">{row.takenOutAmount > 0 ? formatCurrency(row.takenOutAmount) : '-'}</TableCell>
                <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                <TableCell sx={{ maxWidth: 320, wordBreak: 'break-word' }}>
                  <Stack spacing={0.2}>
                    {row.className ? (
                      <Typography variant="caption" color="text.secondary">
                        Class: {row.className}
                      </Typography>
                    ) : null}
                    {row.counterpartyAccountName ? (
                      <Typography variant="caption" color="text.secondary">
                        Counterparty: {row.counterpartyAccountName}
                      </Typography>
                    ) : null}
                    <Typography variant="body2">{row.description || '-'}</Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}

export default function QuickBooksPage() {
  const queryClient = useQueryClient()

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [oauthNotice, setOauthNotice] = useState<OAuthNotice | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<QuickBooksDrilldownKey | null>(null)
  const [activeLoanBucketId, setActiveLoanBucketId] = useState<string | null>(null)
  const [projectMetricDrilldown, setProjectMetricDrilldown] = useState<ProjectMetricDrilldown | null>(null)
  const [activeHistoryType, setActiveHistoryType] = useState<QuickBooksHistoryType | null>(null)
  const [historyRows, setHistoryRows] = useState<Array<QuickBooksDetailRow | QuickBooksBankAccountTransaction>>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyNextOffset, setHistoryNextOffset] = useState(0)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyFilters, setHistoryFilters] = useState<QuickBooksHistoryFilterState>(
    defaultQuickBooksHistoryFilterState,
  )

  const handleCloseDrilldown = useCallback(() => {
    setActiveDrilldown(null)
    setHistoryFilters(defaultQuickBooksHistoryFilterState)
  }, [])

  // ---------------------------------------------------------------------------
  // Status & overview queries
  // Overview is only enabled when QB is configured + connected.
  // staleTime: 4 min frontend < 5 min backend TTL — always has room in backend cache.
  // ---------------------------------------------------------------------------
  const statusQuery = useQuery({
    queryKey: ['quickbooks', 'status'],
    queryFn: () => fetchQuickBooksStatus(),
    staleTime: 5 * 60 * 1000,
  })

  const overviewQuery = useQuery({
    queryKey: ['quickbooks', 'overview'],
    queryFn: () => fetchQuickBooksOverview({ refresh: false }),
    enabled: Boolean(statusQuery.data?.isConfigured && statusQuery.data?.connected),
    staleTime: 4 * 60 * 1000,
  })

  // Derived values
  const status = statusQuery.data ?? null
  const overview = overviewQuery.data ?? null
  const isLoading =
    statusQuery.isLoading ||
    (Boolean(statusQuery.data?.isConfigured && statusQuery.data?.connected) && overviewQuery.isLoading)

  const purchaseOrderRecords = useMemo(
    () => buildPurchaseOrderRecords(overview?.details.purchaseOrderLines ?? []),
    [overview?.details.purchaseOrderLines],
  )

  const projectRollupsById = useMemo(
    () => buildProjectRollups({
      projects: overview?.projects ?? [],
      purchaseOrders: purchaseOrderRecords,
      bills: overview?.details.bills ?? [],
      invoices: overview?.details.invoices ?? [],
      payments: overview?.details.payments ?? [],
    }),
    [
      overview?.projects,
      overview?.details.bills,
      overview?.details.invoices,
      overview?.details.payments,
      purchaseOrderRecords,
    ],
  )

  const outstandingProjects = useMemo(
    () => (overview?.projects ?? [])
      .filter((project) => {
        const rollup = projectRollupsById.get(project.projectId)
        const outstanding = rollup?.outstandingAmount ?? project.outstandingAmount

        return Math.abs(outstanding) > 0.004
      })
      .sort((left, right) => {
        const leftOutstanding = projectRollupsById.get(left.projectId)?.outstandingAmount ?? left.outstandingAmount
        const rightOutstanding = projectRollupsById.get(right.projectId)?.outstandingAmount ?? right.outstandingAmount

        return rightOutstanding - leftOutstanding
      }),
    [overview?.projects, projectRollupsById],
  )

  const nonOrderProjects = useMemo(
    () => (overview?.projects ?? [])
      .filter((project) => isQuickBooksNonOrderProject(project))
      .sort((left, right) => left.projectName.localeCompare(right.projectName)),
    [overview?.projects],
  )

  const nonOrderProjectTotals = useMemo(
    () => nonOrderProjects.reduce(
      (totals, project) => {
        const rollup = projectRollupsById.get(project.projectId)

        totals.projectCount += 1
        totals.transactionCount += rollup?.transactionCount ?? project.transactionCount
        totals.purchaseOrderAmount = roundMoney(
          totals.purchaseOrderAmount + (rollup?.purchaseOrderAmount ?? project.purchaseOrderAmount),
        )
        totals.billAmount = roundMoney(
          totals.billAmount + (rollup?.billAmount ?? project.billAmount),
        )
        totals.invoiceAmount = roundMoney(
          totals.invoiceAmount + (rollup?.invoiceAmount ?? project.invoiceAmount),
        )
        totals.paymentAmount = roundMoney(
          totals.paymentAmount + (rollup?.paymentAmount ?? project.paymentAmount),
        )
        totals.outstandingAmount = roundMoney(
          totals.outstandingAmount + (rollup?.outstandingAmount ?? project.outstandingAmount),
        )

        return totals
      },
      {
        projectCount: 0,
        transactionCount: 0,
        purchaseOrderAmount: 0,
        billAmount: 0,
        invoiceAmount: 0,
        paymentAmount: 0,
        outstandingAmount: 0,
      },
    ),
    [nonOrderProjects, projectRollupsById],
  )

  const activeLoanSummary = useMemo(() => {
    if (!overview || !activeLoanBucketId) {
      return null
    }

    return overview.loanSummaries.find((loanSummary) => loanSummary.bucketId === activeLoanBucketId) ?? null
  }, [activeLoanBucketId, overview])

  const activeHistoryRequestFilters = useMemo<QuickBooksHistoryRequestFilters>(() => {
    const isBankHistory = activeHistoryType === 'bankAccountTransactions'

    return {
      fromDate: historyFilters.fromDate || undefined,
      toDate: historyFilters.toDate || undefined,
      direction: isBankHistory && historyFilters.direction !== 'all'
        ? historyFilters.direction
        : undefined,
    }
  }, [activeHistoryType, historyFilters.direction, historyFilters.fromDate, historyFilters.toDate])

  const hasActiveHistoryFilters = Boolean(
    activeHistoryRequestFilters.fromDate
    || activeHistoryRequestFilters.toDate
    || activeHistoryRequestFilters.direction,
  )

  const historyHasMore = historyNextOffset < historyTotal

  const loadQuickBooksHistoryChunk = useCallback(async (
    type: QuickBooksHistoryType,
    options: { reset?: boolean, offset?: number, filters?: QuickBooksHistoryRequestFilters } = {},
  ) => {
    const shouldReset = options.reset ?? false
    const requestOffset = shouldReset ? 0 : Math.max(0, options.offset ?? 0)

    setHistoryError(null)

    if (shouldReset) {
      setIsHistoryLoading(true)
    } else {
      setIsHistoryLoadingMore(true)
    }

    try {
      const response = await fetchQuickBooksHistory({
        type,
        offset: requestOffset,
        limit: quickBooksHistoryBatchSize,
        fromDate: options.filters?.fromDate,
        toDate: options.filters?.toDate,
        direction: options.filters?.direction,
      })

      const nextRows = response.rows as Array<QuickBooksDetailRow | QuickBooksBankAccountTransaction>

      setHistoryRows((previousRows) => shouldReset ? nextRows : [...previousRows, ...nextRows])
      setHistoryTotal(response.total)
      setHistoryNextOffset(response.nextOffset)
    } catch (error) {
      setHistoryError(toErrorMessage(error, 'Failed to load QuickBooks history.'))
    } finally {
      setIsHistoryLoading(false)
      setIsHistoryLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (!activeDrilldown || !overview) {
      setActiveHistoryType(null)
      setHistoryRows([])
      setHistoryTotal(0)
      setHistoryNextOffset(0)
      setHistoryError(null)
      setIsHistoryLoading(false)
      setIsHistoryLoadingMore(false)
      return
    }

    const mappedHistoryType = quickBooksHistoryTypeByDrilldown[activeDrilldown] ?? null

    if (!mappedHistoryType) {
      setActiveHistoryType(null)
      setHistoryRows([])
      setHistoryTotal(0)
      setHistoryNextOffset(0)
      setHistoryError(null)
      setIsHistoryLoading(false)
      setIsHistoryLoadingMore(false)
      return
    }

    const requestFilters: QuickBooksHistoryRequestFilters = {
      fromDate: historyFilters.fromDate || undefined,
      toDate: historyFilters.toDate || undefined,
      direction:
        mappedHistoryType === 'bankAccountTransactions' && historyFilters.direction !== 'all'
          ? historyFilters.direction
          : undefined,
    }
    const hasServerFilters = Boolean(
      requestFilters.fromDate || requestFilters.toDate || requestFilters.direction,
    )

    const previewRows = getQuickBooksHistoryPreviewRows(overview, mappedHistoryType)
    const previewTotal = getQuickBooksHistoryPreviewTotal(overview, mappedHistoryType)

    setActiveHistoryType(mappedHistoryType)
    setHistoryError(null)
    setIsHistoryLoading(false)
    setIsHistoryLoadingMore(false)

    if (hasServerFilters) {
      setHistoryRows([])
      setHistoryTotal(0)
      setHistoryNextOffset(0)

      void loadQuickBooksHistoryChunk(mappedHistoryType, {
        reset: true,
        filters: requestFilters,
      })
      return
    }

    setHistoryRows(previewRows)
    setHistoryTotal(previewTotal)
    setHistoryNextOffset(previewRows.length)

    const shouldForceFetchFirstChunk = mappedHistoryType === 'outstandingInvoices'
    const shouldFetchBecausePreviewIsEmpty = previewRows.length === 0 && previewTotal > 0

    if (shouldForceFetchFirstChunk || shouldFetchBecausePreviewIsEmpty) {
      void loadQuickBooksHistoryChunk(mappedHistoryType, {
        reset: true,
        filters: requestFilters,
      })
    }
  }, [
    activeDrilldown,
    historyFilters.direction,
    historyFilters.fromDate,
    historyFilters.toDate,
    loadQuickBooksHistoryChunk,
    overview,
  ])

  const summaryCards = useMemo<QuickBooksSummaryCard[]>(() => {
    const totals = overview?.totals
    const loanCards = (overview?.loanSummaries ?? [])
      .filter((loanSummary) => !isExcludedQuickBooksLoanLabel(loanSummary.label))
      .map((loanSummary) => ({
        id: `loan-summary:${loanSummary.bucketId}`,
        key: 'loanSummary' as const,
        loanBucketId: loanSummary.bucketId,
        title: loanSummary.label,
        value: formatCurrency(loanSummary.totalLoanAmount),
        helper: `In ${formatCurrency(loanSummary.totalInvestedAmount)} • Out ${formatCurrency(loanSummary.totalTakenOutAmount)}`,
        color: '#00695c',
        icon: <AccountBalanceRoundedIcon />,
      }))

    const standardCards: QuickBooksSummaryCard[] = [
      {
        id: 'bankAccount',
        key: 'bankAccount',
        title: 'Bank Balance',
        value: overview?.bankAccountSnapshot
          ? formatCurrency(overview.bankAccountSnapshot.currentBalance)
          : '--',
        helper: overview?.bankAccountSnapshot
          ? `${overview.bankAccountSnapshot.accountName || 'Chase'} ending in ${overview.bankAccountSnapshot.endingIn || '2951'}`
          : 'Chase bank account ending in 2951 not found in chart of accounts',
        color: '#0d47a1',
        icon: <AccountBalanceRoundedIcon />,
      },
      {
        id: 'amountWeOwe',
        key: 'bills',
        title: 'Amount We Owe',
        value: formatCurrency(totals?.billAmount ?? 0),
        helper: `${formatInteger(totals?.billCount ?? 0)} unpaid vendor bills`,
        color: '#6a1b9a',
        icon: <RequestQuoteRoundedIcon />,
      },
      {
        id: 'projects',
        key: 'projects',
        title: 'Projects',
        value: formatInteger(totals?.projectCount ?? 0),
        helper: 'QuickBooks projects only (Job=true)',
        color: '#1565c0',
        icon: <AccountTreeRoundedIcon />,
      },
      {
        id: 'purchaseOrders',
        key: 'purchaseOrders',
        title: 'Purchase Orders',
        value: formatInteger(totals?.purchaseOrderCount ?? 0),
        helper: formatCurrency(totals?.purchaseOrderAmount ?? 0),
        color: '#5d4037',
        icon: <AssignmentRoundedIcon />,
      },
      {
        id: 'purchaseOrderLines',
        key: 'purchaseOrderLines',
        title: 'PO Lines',
        value: formatInteger(totals?.purchaseOrderLineCount ?? 0),
        helper: `${formatCurrency(totals?.purchaseOrderLineAmount ?? 0)} line-level value`,
        color: '#6d4c41',
        icon: <AssignmentRoundedIcon />,
      },
      {
        id: 'unlinkedPurchaseOrderLines',
        key: 'unlinkedPurchaseOrderLines',
        title: 'PO Lines Missing Project',
        value: formatInteger(totals?.purchaseOrderLineWithoutProjectCount ?? 0),
        helper: `${formatCurrency(totals?.purchaseOrderLineWithoutProjectAmount ?? 0)} needs project mapping`,
        color: '#d84315',
        icon: <LinkOffRoundedIcon />,
      },
      {
        id: 'invoices',
        key: 'invoices',
        title: 'Invoices',
        value: formatInteger(totals?.invoiceCount ?? 0),
        helper: formatCurrency(totals?.invoiceAmount ?? 0),
        color: '#00897b',
        icon: <RequestQuoteRoundedIcon />,
      },
      {
        id: 'payments',
        key: 'payments',
        title: 'Payments',
        value: formatInteger(totals?.paymentCount ?? 0),
        helper: formatCurrency(totals?.paymentAmount ?? 0),
        color: '#4527a0',
        icon: <PaymentsRoundedIcon />,
      },
      {
        id: 'unlinkedTransactions',
        key: 'unlinkedTransactions',
        title: 'Other Unlinked Txns',
        value: formatInteger(totals?.unlinkedTransactionCount ?? 0),
        helper: `${formatCurrency(totals?.unlinkedAmount ?? 0)} with missing or invalid project refs`,
        color: '#ef6c00',
        icon: <WarningAmberRoundedIcon />,
      },
      {
        id: 'outstandingProjects',
        key: 'outstandingProjects',
        title: 'Outstanding Balance',
        value: formatCurrency(totals?.outstandingAmount ?? 0),
        helper: `${formatInteger(outstandingProjects.length)} projects with non-zero outstanding`,
        color: '#ad1457',
        icon: <LinkRoundedIcon />,
      },
    ]

    return [
      ...loanCards,
      ...standardCards,
    ]
  }, [overview, outstandingProjects.length])

  const summaryCardGroups = useMemo<QuickBooksSummaryCardGroup[]>(() => {
    const cardById = new Map(summaryCards.map((card) => [card.id, card]))
    const loanCards = summaryCards.filter((card) => card.key === 'loanSummary')
    const pickCards = (cardIds: string[]) => cardIds
      .map((cardId) => cardById.get(cardId))
      .filter((card): card is QuickBooksSummaryCard => Boolean(card))

    return [
      {
        id: 'loans',
        title: 'Loans',
        description: 'Loan balances and owner money movement.',
        cards: loanCards,
      },
      {
        id: 'cash-position',
        title: 'Cash Position',
        description: 'How much we have in bank, owe in bills, and are still owed.',
        cards: pickCards(['bankAccount', 'amountWeOwe', 'outstandingProjects']),
      },
      {
        id: 'purchase-orders',
        title: 'Purchase Orders',
        description: 'Everything tied to purchase orders and line mappings.',
        cards: pickCards(['purchaseOrders', 'purchaseOrderLines', 'unlinkedPurchaseOrderLines']),
      },
      {
        id: 'projects-billing',
        title: 'Projects & Invoicing',
        description: 'Project counts, invoices, payments, and unlinked transactions.',
        cards: pickCards(['projects', 'invoices', 'payments', 'unlinkedTransactions']),
      },
    ].filter((group) => group.cards.length > 0)
  }, [summaryCards])

  // Force-refresh bypasses the 5-min backend cache by sending refresh=true,
  // then seeds the React Query cache so the next navigation is instant.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setErrorMessage(null)

    try {
      const freshOverview = await fetchQuickBooksOverview({ refresh: true })
      queryClient.setQueryData(['quickbooks', 'overview'], freshOverview)
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Failed to refresh QuickBooks data.'))
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient])

  const handleConnect = useCallback(async () => {
    setErrorMessage(null)
    setOauthNotice(null)
    setIsConnecting(true)

    try {
      const authorizeUrl = await createQuickBooksAuthorizeUrl('/quickbooks')
      window.location.assign(authorizeUrl)
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Failed to start QuickBooks connection flow.'))
    } finally {
      setIsConnecting(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qbStatus = params.get('qb')
    const qbMessage = params.get('qbMessage')

    if (!qbStatus && !qbMessage) {
      return
    }

    const normalizedStatus = String(qbStatus ?? '').trim().toLowerCase()
    const severity: OAuthNotice['severity'] = normalizedStatus === 'connected'
      ? 'success'
      : normalizedStatus === 'error'
        ? 'error'
        : 'info'
    const message = qbMessage?.trim()
      || (normalizedStatus === 'connected'
        ? 'QuickBooks connected successfully.'
        : normalizedStatus === 'error'
          ? 'QuickBooks connection failed.'
          : 'QuickBooks connection updated.')

    setOauthNotice({
      severity,
      message,
    })

    params.delete('qb')
    params.delete('qbMessage')

    const nextQuery = params.toString()
    const nextLocation = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`

    window.history.replaceState({}, '', nextLocation)
  }, [])

  const projectMetricRows = useMemo(() => {
    if (!projectMetricDrilldown || !overview) {
      return []
    }

    if (projectMetricDrilldown.metricType === 'bills') {
      return overview.details.bills.filter((row) => row.projectId === projectMetricDrilldown.projectId)
    }

    if (projectMetricDrilldown.metricType === 'invoices') {
      return overview.details.invoices.filter((row) => row.projectId === projectMetricDrilldown.projectId)
    }

    if (projectMetricDrilldown.metricType === 'payments') {
      return overview.details.payments.filter((row) => row.projectId === projectMetricDrilldown.projectId)
    }

    return []
  }, [overview, projectMetricDrilldown])

  const bankHistoryGridRows = useMemo<BankHistoryGridRow[]>(() => {
    if (activeHistoryType !== 'bankAccountTransactions') {
      return []
    }

    return historyRows.map((row, index) => {
      const typedRow = row as QuickBooksBankAccountTransaction

      return {
        ...typedRow,
        id: `${typedRow.type}:${typedRow.id ?? 'none'}:${typedRow.docNumber ?? 'none'}:${typedRow.txnDate ?? 'none'}:${index}`,
      }
    })
  }, [activeHistoryType, historyRows])

  const detailHistoryGridRows = useMemo<DetailHistoryGridRow[]>(() => {
    if (activeHistoryType !== 'bills' && activeHistoryType !== 'outstandingInvoices') {
      return []
    }

    return historyRows.map((row, index) => {
      const typedRow = row as QuickBooksDetailRow

      return {
        ...typedRow,
        id: `${typedRow.type}:${typedRow.id ?? 'none'}:${typedRow.docNumber ?? 'none'}:${typedRow.lineNumber ?? 0}:${index}`,
        candidateRefsText: formatCandidateRefs(typedRow.candidateProjectRefs),
      }
    })
  }, [activeHistoryType, historyRows])

  const bankHistoryColumns = useMemo<GridColDef<BankHistoryGridRow>[]>(() => [
    {
      field: 'txnDate',
      headerName: 'Date',
      minWidth: 130,
      flex: 0.8,
      renderCell: (params) => formatDate(params.row.txnDate),
    },
    {
      field: 'type',
      headerName: 'Type',
      minWidth: 130,
      flex: 0.9,
      renderCell: (params) => quickBooksBankTxnTypeLabel(params.row.type),
    },
    {
      field: 'docNumber',
      headerName: 'Document',
      minWidth: 170,
      flex: 1,
      renderCell: (params) => (
        <Stack spacing={0.15} sx={{ py: 0.5 }}>
          <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
            {params.row.docNumber || '-'}
          </Typography>
          <Typography variant="caption" color="text.secondary" lineHeight={1.2}>
            {params.row.id || '-'}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'direction',
      headerName: 'Direction',
      minWidth: 140,
      flex: 0.9,
      renderCell: (params) => quickBooksBankDirectionLabel(params.row.direction),
    },
    {
      field: 'amount',
      headerName: 'Amount',
      minWidth: 140,
      flex: 0.9,
      type: 'number',
      renderCell: (params) => formatCurrency(Number(params.row.amount || 0)),
    },
    {
      field: 'counterpartyAccountName',
      headerName: 'Counterparty',
      minWidth: 180,
      flex: 1.1,
      renderCell: (params) => params.row.counterpartyAccountName || '-',
    },
    {
      field: 'description',
      headerName: 'Description',
      minWidth: 220,
      flex: 1.3,
      renderCell: (params) => params.row.description || '-',
    },
  ], [])

  const detailHistoryColumns = useMemo<GridColDef<DetailHistoryGridRow>[]>(() => [
    {
      field: 'docNumber',
      headerName: 'Document',
      minWidth: 170,
      flex: 1,
      renderCell: (params) => (
        <Stack spacing={0.15} sx={{ py: 0.5 }}>
          <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
            {params.row.docNumber || '-'}
          </Typography>
          <Typography variant="caption" color="text.secondary" lineHeight={1.2}>
            {params.row.id || '-'}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'txnDate',
      headerName: 'Date',
      minWidth: 130,
      flex: 0.8,
      renderCell: (params) => formatDate(params.row.txnDate),
    },
    {
      field: 'projectName',
      headerName: 'Project',
      minWidth: 180,
      flex: 1,
      renderCell: (params) => {
        if (!params.row.projectName && !params.row.projectId) {
          return '-'
        }

        return (
          <Stack spacing={0.15} sx={{ py: 0.5 }}>
            <Typography variant="body2" lineHeight={1.2}>
              {params.row.projectName || '-'}
            </Typography>
            <Typography variant="caption" color="text.secondary" lineHeight={1.2}>
              {params.row.projectId || '-'}
            </Typography>
          </Stack>
        )
      },
    },
    {
      field: 'candidateRefsText',
      headerName: 'Candidate Refs',
      minWidth: 180,
      flex: 1,
    },
    {
      field: 'totalAmount',
      headerName: 'Amount',
      minWidth: 130,
      flex: 0.8,
      type: 'number',
      renderCell: (params) => formatCurrency(Number(params.row.totalAmount || 0)),
    },
    {
      field: 'balanceAmount',
      headerName: 'Balance',
      minWidth: 130,
      flex: 0.8,
      type: 'number',
      renderCell: (params) => {
        if (params.row.balanceAmount === null || params.row.balanceAmount === undefined) {
          return '-'
        }

        return formatCurrency(params.row.balanceAmount)
      },
    },
    {
      field: 'reason',
      headerName: 'Reason',
      minWidth: 220,
      flex: 1.4,
      renderCell: (params) => params.row.reason || '-',
    },
  ], [])

  const renderHistoryGrid = ({
    rows,
    columns,
    emptyMessage,
  }: {
    rows: BankHistoryGridRow[] | DetailHistoryGridRow[]
    columns: GridColDef[]
    emptyMessage: string
  }) => {
    const rowCount = rows.length
    const showDirectionFilter = activeHistoryType === 'bankAccountTransactions'

    return (
      <Stack spacing={1.1}>
        {historyError ? <Alert severity="error">{historyError}</Alert> : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            label="From"
            type="date"
            value={historyFilters.fromDate}
            onChange={(event) => {
              setHistoryFilters((previous) => ({
                ...previous,
                fromDate: event.target.value,
              }))
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={historyFilters.toDate}
            onChange={(event) => {
              setHistoryFilters((previous) => ({
                ...previous,
                toDate: event.target.value,
              }))
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          {showDirectionFilter ? (
            <TextField
              select
              size="small"
              label="Direction"
              value={historyFilters.direction}
              onChange={(event) => {
                setHistoryFilters((previous) => ({
                  ...previous,
                  direction: event.target.value as QuickBooksHistoryFilterState['direction'],
                }))
              }}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="in">Money In</MenuItem>
              <MenuItem value="out">Money Out</MenuItem>
              <MenuItem value="unknown">Unclassified</MenuItem>
            </TextField>
          ) : null}

          <Button
            variant="text"
            onClick={() => {
              setHistoryFilters(defaultQuickBooksHistoryFilterState)
            }}
            disabled={!hasActiveHistoryFilters || isHistoryLoading || isHistoryLoadingMore}
          >
            Clear filters
          </Button>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Showing {formatInteger(rowCount)} of {formatInteger(historyTotal)} rows.
        </Typography>

        {rowCount === 0 && !isHistoryLoading ? (
          <Typography color="text.secondary" sx={{ py: 1.5 }}>
            {emptyMessage}
          </Typography>
        ) : (
          <Box sx={{ height: 520, width: '100%' }}>
            <DataGrid
              rows={rows}
              columns={columns}
              loading={isHistoryLoading}
              disableRowSelectionOnClick
              hideFooter
              initialState={{
                sorting: {
                  sortModel: [{ field: 'txnDate', sort: 'desc' }],
                },
              }}
              slots={{ toolbar: GridToolbar }}
            />
          </Box>
        )}

        {historyHasMore && activeHistoryType ? (
          <Box>
            <Button
              variant="outlined"
              onClick={() => {
                void loadQuickBooksHistoryChunk(activeHistoryType, {
                  offset: historyNextOffset,
                  filters: activeHistoryRequestFilters,
                })
              }}
              disabled={isHistoryLoading || isHistoryLoadingMore}
            >
              {isHistoryLoadingMore ? 'Loading...' : `Load more ${quickBooksHistoryBatchSize}`}
            </Button>
          </Box>
        ) : null}
      </Stack>
    )
  }

  const renderDialogBody = () => {
    if (!overview || !activeDrilldown) {
      return <Typography color="text.secondary">No details to show.</Typography>
    }

    if (activeDrilldown === 'bankAccount') {
      if (!overview.bankAccountSnapshot) {
        return <Typography color="text.secondary">Chase bank account ending in 2951 was not found in chart of accounts.</Typography>
      }

      return (
        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            <Typography variant="h6" fontWeight={700}>
              {overview.bankAccountSnapshot.accountName || 'Chase'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Account ending in {overview.bankAccountSnapshot.endingIn || '2951'}
            </Typography>
            <Typography variant="h4" fontWeight={800}>
              {formatCurrency(overview.bankAccountSnapshot.currentBalance)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Snapshot time {formatDateTime(overview.bankAccountSnapshot.asOf)}
            </Typography>
          </Stack>

          {renderHistoryGrid({
            rows: bankHistoryGridRows,
            columns: bankHistoryColumns,
            emptyMessage: 'No bank transaction history is available for this account yet.',
          })}
        </Stack>
      )
    }

    if (activeDrilldown === 'loanSummary') {
      if (!activeLoanSummary) {
        return <Typography color="text.secondary">No loan details to show.</Typography>
      }

      return <LoanSummaryDetailsTable bucket={activeLoanSummary} />
    }

    if (activeDrilldown === 'projects') {
      return (
        <ProjectSummaryTable
          rows={overview.projects}
          projectRollupsById={projectRollupsById}
          onMetricClick={(input) => {
            setProjectMetricDrilldown(input)
          }}
        />
      )
    }

    if (activeDrilldown === 'outstandingProjects') {
      return (
        <Stack spacing={1.25}>
          <Typography variant="body2" color="text.secondary">
            Open receivables history (invoices with remaining balance).
          </Typography>
          {renderHistoryGrid({
            rows: detailHistoryGridRows,
            columns: detailHistoryColumns,
            emptyMessage: 'No outstanding invoice history to show.',
          })}
        </Stack>
      )
    }

    if (activeDrilldown === 'purchaseOrders') {
      return <PurchaseOrdersTable rows={purchaseOrderRecords} />
    }

    if (activeDrilldown === 'purchaseOrderLines') {
      return <DetailRowsTable rows={overview.details.purchaseOrderLines} />
    }

    if (activeDrilldown === 'unlinkedPurchaseOrderLines') {
      return <DetailRowsTable rows={overview.details.unlinkedPurchaseOrderLines} />
    }

    if (activeDrilldown === 'bills') {
      return (
        <Stack spacing={1.25}>
          <Typography variant="body2" color="text.secondary">
            Payables history for vendor bills.
          </Typography>
          {renderHistoryGrid({
            rows: detailHistoryGridRows,
            columns: detailHistoryColumns,
            emptyMessage: 'No bill history to show.',
          })}
        </Stack>
      )
    }

    if (activeDrilldown === 'invoices') {
      return <DetailRowsTable rows={overview.details.invoices} />
    }

    if (activeDrilldown === 'payments') {
      return <DetailRowsTable rows={overview.details.payments} />
    }

    return <UnlinkedTransactionsTable rows={overview.unlinkedTransactions} />
  }

  const projectMetricRollup = projectMetricDrilldown
    ? projectRollupsById.get(projectMetricDrilldown.projectId)
    : null

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', lg: 'center' }}
        gap={1.5}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            QuickBooks Project Insights
          </Typography>
          {overview ? (
            <Typography color="text.secondary">
              {overview.companyInfo?.companyName || status?.companyName || 'QuickBooks Company'}
              {' '}
              • Last sync {formatDateTime(overview.generatedAt)}
            </Typography>
          ) : (
            <Typography color="text.secondary">
              Project-centric view of purchase orders, bills, invoices, and payments.
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1.25}>
          <Button
            variant={status?.connected ? 'outlined' : 'contained'}
            onClick={() => void handleConnect()}
            disabled={isConnecting || !status?.isConfigured}
            startIcon={<LinkRoundedIcon />}
          >
            {isConnecting
              ? 'Opening...'
              : status?.connected
                ? 'Reconnect QuickBooks'
                : 'Connect QuickBooks'}
          </Button>

          <Button
            variant="contained"
            onClick={() => void handleRefresh()}
            startIcon={<RefreshRoundedIcon />}
            disabled={isLoading || isRefreshing || !status?.connected}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>

      {oauthNotice ? <Alert severity={oauthNotice.severity}>{oauthNotice.message}</Alert> : null}

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

      {status && !status.isConfigured ? (
        <Alert severity="error">
          QuickBooks is not configured on the backend. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET,
          then refresh.
        </Alert>
      ) : null}

      {status?.connected && status.needsReconnect ? (
        <Alert severity="warning">
          QuickBooks refresh token is expired or close to expiry. Reconnect QuickBooks to continue syncing.
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={status?.connected ? 'Connected' : 'Not connected'}
              color={status?.connected ? 'success' : 'default'}
              variant={status?.connected ? 'filled' : 'outlined'}
            />
            {status?.realmId ? (
              <Typography variant="body2" color="text.secondary">
                Realm {status.realmId}
              </Typography>
            ) : null}
            {status?.updatedAt ? (
              <Typography variant="body2" color="text.secondary">
                Updated {formatDateTime(status.updatedAt)}
              </Typography>
            ) : null}
          </Stack>

          {status?.connected && !overview && !isLoading ? (
            <Typography color="text.secondary">
              QuickBooks is connected. Click Refresh to pull the latest project and transaction data.
            </Typography>
          ) : null}

          {!status?.connected ? (
            <Typography color="text.secondary">
              Connect QuickBooks to start matching transactions against projects and identify unlinked items.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      {isLoading && !overview ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading QuickBooks analytics...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {overview ? (
        <>
          {overview.warnings.length > 0 ? (
            <Alert severity="warning">
              <Stack spacing={0.35}>
                {overview.warnings.map((warning) => (
                  <Typography key={warning} variant="body2">
                    {warning}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          ) : null}

          <Paper variant="outlined" sx={{ p: 2.25 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={700}>
                Transaction Summary
              </Typography>

              <Stack spacing={1.75}>
                {summaryCardGroups.map((group) => (
                  <Paper key={group.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1.25}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {group.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {group.description}
                        </Typography>
                      </Box>

                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: 'repeat(1, minmax(0, 1fr))',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            xl: 'repeat(3, minmax(0, 1fr))',
                          },
                          gap: 1.5,
                        }}
                      >
                        {group.cards.map((card) => (
                          <Paper
                            key={card.id}
                            variant="outlined"
                            onClick={() => {
                              setActiveDrilldown(card.key)
                              setActiveLoanBucketId(card.key === 'loanSummary' ? card.loanBucketId ?? null : null)
                              setHistoryFilters(defaultQuickBooksHistoryFilterState)
                            }}
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
                                  {card.title}
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
                ))}
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Click any summary box to open full details.
              </Typography>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.25 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={700}>
                Non-Order Projects
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Company Purchase, General Expense, Payroll, and Repair are tracked here and excluded from Orders.
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`Projects ${formatInteger(nonOrderProjectTotals.projectCount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Txns ${formatInteger(nonOrderProjectTotals.transactionCount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`PO ${formatCurrency(nonOrderProjectTotals.purchaseOrderAmount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Bills ${formatCurrency(nonOrderProjectTotals.billAmount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Invoices ${formatCurrency(nonOrderProjectTotals.invoiceAmount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Payments ${formatCurrency(nonOrderProjectTotals.paymentAmount)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Outstanding ${formatCurrency(nonOrderProjectTotals.outstandingAmount)}`}
                  color={nonOrderProjectTotals.outstandingAmount > 0 ? 'warning' : 'default'}
                  variant="outlined"
                />
              </Stack>

              {nonOrderProjects.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 1 }}>
                  No non-order projects were found in this sync.
                </Typography>
              ) : (
                <TableContainer sx={{ maxHeight: 380 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Customer</TableCell>
                        <TableCell>Project #</TableCell>
                        <TableCell align="right">Txns</TableCell>
                        <TableCell align="right">PO</TableCell>
                        <TableCell align="right">Bills</TableCell>
                        <TableCell align="right">Invoices</TableCell>
                        <TableCell align="right">Payments</TableCell>
                        <TableCell align="right">Outstanding</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {nonOrderProjects.map((project) => {
                        const rollup = projectRollupsById.get(project.projectId)
                        const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId)
                        const outstandingAmount = rollup?.outstandingAmount ?? project.outstandingAmount

                        return (
                          <TableRow key={project.projectId} hover>
                            <TableCell sx={{ maxWidth: 260, wordBreak: 'break-word' }}>
                              <Typography variant="body2" fontWeight={600}>
                                {splitLabel.customerName}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Stack spacing={0.3}>
                                <Typography variant="body2" fontWeight={600}>
                                  {splitLabel.projectNumber}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {project.projectId}
                                </Typography>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              {formatInteger(rollup?.transactionCount ?? project.transactionCount)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(rollup?.purchaseOrderAmount ?? project.purchaseOrderAmount)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(rollup?.billAmount ?? project.billAmount)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(rollup?.invoiceAmount ?? project.invoiceAmount)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(rollup?.paymentAmount ?? project.paymentAmount)}
                            </TableCell>
                            <TableCell align="right">
                              <Typography
                                variant="body2"
                                fontWeight={700}
                                color={outstandingAmount > 0 ? 'warning.main' : 'text.primary'}
                              >
                                {formatCurrency(outstandingAmount)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Stack>
          </Paper>
        </>
      ) : null}

      <Dialog
        open={Boolean(activeDrilldown)}
        onClose={handleCloseDrilldown}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          {activeDrilldown ? quickBooksDrilldownTitles[activeDrilldown] : 'Details'}
        </DialogTitle>
        <DialogContent>{renderDialogBody()}</DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(projectMetricDrilldown)}
        onClose={() => setProjectMetricDrilldown(null)}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          {projectMetricDrilldown
            ? `${projectMetricDrilldown.projectName} • ${projectMetricTitleByType[projectMetricDrilldown.metricType]}`
            : 'Project Details'}
        </DialogTitle>
        <DialogContent>
          {projectMetricDrilldown ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`PO ${formatInteger(projectMetricRollup?.purchaseOrderCount ?? 0)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Bills ${formatInteger(projectMetricRollup?.billCount ?? 0)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Invoices ${formatInteger(projectMetricRollup?.invoiceCount ?? 0)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Payments ${formatInteger(projectMetricRollup?.paymentCount ?? 0)}`}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Outstanding ${formatCurrency(projectMetricRollup?.outstandingAmount ?? 0)}`}
                  color={(projectMetricRollup?.outstandingAmount ?? 0) > 0 ? 'warning' : 'default'}
                  variant="outlined"
                />
              </Stack>

              {projectMetricDrilldown.metricType === 'purchaseOrders' ? (
                <PurchaseOrdersTable
                  rows={purchaseOrderRecords.filter(
                    (purchaseOrder) => purchaseOrder.projectIds.includes(projectMetricDrilldown.projectId),
                  )}
                  selectedProjectId={projectMetricDrilldown.projectId}
                />
              ) : (
                <DetailRowsTable rows={projectMetricRows} hideProjectColumn />
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">No details to show.</Typography>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
