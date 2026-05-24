export type QuickBooksStatusResponse = {
  isConfigured: boolean
  connected: boolean
  realmId: string | null
  companyName?: string | null
  updatedAt?: string | null
  accessTokenExpiresAt?: string | null
  refreshTokenExpiresAt?: string | null
  needsReconnect?: boolean
}

export type QuickBooksCompanyInfo = {
  id: string | null
  companyName: string | null
  legalName: string | null
  email: string | null
  country: string | null
}

export type QuickBooksBankAccountSnapshot = {
  accountId: string | null
  accountName: string | null
  accountNumber: string | null
  endingIn: string | null
  currentBalance: number
  asOf: string
}

export type QuickBooksBankAccountTransaction = {
  type: 'journalEntry' | 'transfer' | 'deposit' | 'check'
  id: string | null
  docNumber: string | null
  txnDate: string | null
  amount: number
  direction: 'in' | 'out' | 'unknown'
  description: string | null
  counterpartyAccountName: string | null
}

export type QuickBooksTotals = {
  projectCount: number
  purchaseOrderCount: number
  purchaseOrderAmount: number
  purchaseOrderLineCount: number
  purchaseOrderLineAmount: number
  purchaseOrderLineWithoutProjectCount: number
  purchaseOrderLineWithoutProjectAmount: number
  billCount: number
  billAmount: number
  invoiceCount: number
  invoiceAmount: number
  paymentCount: number
  paymentAmount: number
  unlinkedTransactionCount: number
  unlinkedAmount: number
  outstandingAmount: number
  loanSummaryCount: number
  loanTotalAmount: number
  loanInvestedAmount: number
  loanTakenOutAmount: number
}

export type QuickBooksLoanDirection = 'in' | 'out' | 'unknown'

export type QuickBooksLoanDetailRow = {
  type: 'journalEntry' | 'transfer' | 'deposit' | 'check'
  id: string | null
  docNumber: string | null
  txnDate: string | null
  amount: number
  direction: QuickBooksLoanDirection
  investedAmount: number
  takenOutAmount: number
  accountId: string | null
  accountName: string | null
  accountNumber: string | null
  className: string | null
  description: string | null
  counterpartyAccountName: string | null
}

export type QuickBooksLoanSummary = {
  bucketId: string
  ownerKey: string | null
  label: string
  accountIds: string[]
  accountNumbers: string[]
  totalLoanAmount: number
  totalInvestedAmount: number
  totalTakenOutAmount: number
  movementCount: number
  details: QuickBooksLoanDetailRow[]
}

export type QuickBooksProjectSummary = {
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

export type QuickBooksUnlinkedTransaction = {
  type: 'purchaseOrder' | 'bill' | 'invoice' | 'payment'
  id: string | null
  docNumber: string | null
  txnDate: string | null
  totalAmount: number
  candidateProjectRefs: string[]
  reason: string
}

export type QuickBooksDetailRow = {
  type: 'purchaseOrderLine' | 'bill' | 'invoice' | 'payment'
  id: string | null
  docNumber: string | null
  txnDate: string | null
  totalAmount: number
  balanceAmount: number | null
  projectId: string | null
  projectName: string | null
  lineNumber: number | null
  lineDescription: string | null
  reason: string | null
  candidateProjectRefs: string[]
}

export type QuickBooksOverviewDetails = {
  purchaseOrderLines: QuickBooksDetailRow[]
  bills: QuickBooksDetailRow[]
  invoices: QuickBooksDetailRow[]
  payments: QuickBooksDetailRow[]
  unlinkedPurchaseOrderLines: QuickBooksDetailRow[]
}

export type QuickBooksHistoryMetaBucket = {
  total: number
  loaded: number
}

export type QuickBooksHistoryMeta = {
  pageSize: number
  bankAccountTransactions: QuickBooksHistoryMetaBucket
  details: {
    purchaseOrderLines: QuickBooksHistoryMetaBucket
    bills: QuickBooksHistoryMetaBucket
    invoices: QuickBooksHistoryMetaBucket
    payments: QuickBooksHistoryMetaBucket
    unlinkedPurchaseOrderLines: QuickBooksHistoryMetaBucket
  }
  outstandingInvoices: QuickBooksHistoryMetaBucket
}

export type QuickBooksHistoryType = 'bankAccountTransactions' | 'bills' | 'outstandingInvoices'

export type QuickBooksHistoryDirection = 'in' | 'out' | 'unknown'

export type QuickBooksHistoryResponse = {
  type: QuickBooksHistoryType
  offset: number
  limit: number
  total: number
  hasMore: boolean
  nextOffset: number
  filters?: {
    fromDate: string | null
    toDate: string | null
    direction: QuickBooksHistoryDirection | null
  }
  rows: Array<QuickBooksBankAccountTransaction | QuickBooksDetailRow>
}

export type QuickBooksOverviewResponse = {
  generatedAt: string
  realmId: string
  companyInfo: QuickBooksCompanyInfo | null
  bankAccountSnapshot: QuickBooksBankAccountSnapshot | null
  bankAccountTransactions: QuickBooksBankAccountTransaction[]
  totals: QuickBooksTotals
  projects: QuickBooksProjectSummary[]
  loanSummaries: QuickBooksLoanSummary[]
  unlinkedTransactions: QuickBooksUnlinkedTransaction[]
  details: QuickBooksOverviewDetails
  historyMeta?: QuickBooksHistoryMeta
  warnings: string[]
}

function withQuery(path: string, query: Record<string, string | number | null | undefined>) {
  const url = new URL(path, window.location.origin)

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    url.searchParams.set(key, String(value))
  })

  return `${url.pathname}${url.search}`
}

import { apiRequest } from '../api-client'

export function fetchQuickBooksStatus() {
  return apiRequest<QuickBooksStatusResponse>('/api/quickbooks/status')
}

export async function createQuickBooksAuthorizeUrl(redirectPath = '/quickbooks') {
  const payload = await apiRequest<{ authorizeUrl: string }>(
    withQuery('/api/quickbooks/oauth/start', { redirectPath }),
  )

  return payload.authorizeUrl
}

export function fetchQuickBooksOverview(options: { refresh?: boolean, full?: boolean } = {}) {
  return apiRequest<QuickBooksOverviewResponse>(
    withQuery('/api/quickbooks/overview', {
      refresh: options.refresh ? 1 : undefined,
      full: options.full ? 1 : undefined,
    }),
  )
}

export function fetchQuickBooksHistory(options: {
  type: QuickBooksHistoryType
  offset?: number
  limit?: number
  fromDate?: string
  toDate?: string
  direction?: QuickBooksHistoryDirection
}) {
  return apiRequest<QuickBooksHistoryResponse>(
    withQuery('/api/quickbooks/history', {
      type: options.type,
      offset: options.offset ?? 0,
      limit: options.limit,
      fromDate: options.fromDate,
      toDate: options.toDate,
      direction: options.direction,
    }),
  )
}
