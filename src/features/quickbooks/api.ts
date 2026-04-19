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

export type QuickBooksOverviewResponse = {
  generatedAt: string
  realmId: string
  companyInfo: QuickBooksCompanyInfo | null
  totals: QuickBooksTotals
  projects: QuickBooksProjectSummary[]
  unlinkedTransactions: QuickBooksUnlinkedTransaction[]
  details: QuickBooksOverviewDetails
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

async function requestWithAuth<T>(path: string, idToken: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'x-client-platform': 'web',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Request failed.')
  }

  return payload as T
}

export function fetchQuickBooksStatus(idToken: string) {
  return requestWithAuth<QuickBooksStatusResponse>('/api/quickbooks/status', idToken)
}

export async function createQuickBooksAuthorizeUrl(idToken: string, redirectPath = '/quickbooks') {
  const payload = await requestWithAuth<{ authorizeUrl: string }>(
    withQuery('/api/quickbooks/oauth/start', { redirectPath }),
    idToken,
  )

  return payload.authorizeUrl
}

export function fetchQuickBooksOverview(idToken: string, options: { refresh?: boolean } = {}) {
  return requestWithAuth<QuickBooksOverviewResponse>(
    withQuery('/api/quickbooks/overview', {
      refresh: options.refresh ? 1 : undefined,
    }),
    idToken,
  )
}
