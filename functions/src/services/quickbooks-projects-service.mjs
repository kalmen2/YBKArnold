// QuickBooks "Projects + financials" service.
// Encapsulates the OAuth token exchange, the SQL-style API queries used to
// pull customers/invoices/payments/POs, and the per-project rollup that the
// orders refresh consumes.

const quickBooksTokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const quickBooksApiBaseUrlDefault = 'https://quickbooks.api.intuit.com'
const quickBooksTokenDocId = 'primary'
const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
const quickBooksQueryPageSize = 500
const quickBooksMaxQueryPages = 8

function normalizeText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function toMoney(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function toIsoOrNull(value) {
  return normalizeText(value, 80) || null
}

function toTimestampMs(value) {
  const ts = Date.parse(normalizeText(value, 80))
  return Number.isFinite(ts) ? ts : null
}

function isExpiredAt(isoTimestamp, skewMs = 0) {
  const ts = toTimestampMs(isoTimestamp)
  if (!Number.isFinite(ts)) {
    return true
  }
  return Date.now() >= ts - skewMs
}

function extractRefValue(refValue) {
  if (typeof refValue === 'string') {
    return normalizeText(refValue, 160)
  }
  if (!refValue || typeof refValue !== 'object') {
    return ''
  }
  return normalizeText(refValue.value, 160) || normalizeText(refValue.id, 160) || ''
}

function collectCustomerRefsDeep(input, refsSet, depth = 0) {
  if (depth > 6 || !input) {
    return
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectCustomerRefsDeep(item, refsSet, depth + 1))
    return
  }
  if (typeof input !== 'object') {
    return
  }
  Object.entries(input).forEach(([key, value]) => {
    if (key === 'CustomerRef') {
      const ref = extractRefValue(value)
      if (ref) {
        refsSet.add(ref)
      }
    }
    if (value && typeof value === 'object') {
      collectCustomerRefsDeep(value, refsSet, depth + 1)
    }
  })
}

function extractProjectRefsFromTxn(transaction) {
  const refs = new Set()
  collectCustomerRefsDeep(transaction, refs)
  return [...refs]
}

function resolveTxnProjectRefs(txn, projectIdsSet) {
  if (!(projectIdsSet instanceof Set) || projectIdsSet.size === 0) {
    return []
  }

  const refs = extractProjectRefsFromTxn(txn)
    .map((value) => normalizeText(value, 160))
    .filter(Boolean)
  const matched = new Set()

  refs.forEach((ref) => {
    if (projectIdsSet.has(ref)) {
      matched.add(ref)
    }
  })

  return [...matched]
}

function normalizeDocNumber(txn) {
  return (
    normalizeText(txn?.DocNumber, 160)
    || normalizeText(txn?.PaymentRefNum, 160)
    || normalizeText(txn?.Id, 160)
    || null
  )
}

function splitQuickBooksProjectLabel(projectName, fallbackProjectId) {
  const normalizedName = normalizeText(projectName, 260)

  if (!normalizedName) {
    return {
      projectNumber: normalizeText(fallbackProjectId, 160) || '',
    }
  }

  const hasColonSeparator = normalizedName.includes(':')
  const hasHyphenSeparator = normalizedName.includes(' - ')
  const segments = hasColonSeparator
    ? normalizedName.split(':').map((segment) => segment.trim()).filter(Boolean)
    : hasHyphenSeparator
      ? normalizedName.split(' - ').map((segment) => segment.trim()).filter(Boolean)
      : [normalizedName]

  if (segments.length <= 1) {
    return {
      projectNumber: segments[0] || normalizeText(fallbackProjectId, 160) || '',
    }
  }

  return {
    projectNumber: segments[segments.length - 1] || normalizeText(fallbackProjectId, 160) || '',
  }
}

function resolveOrderNumberFromProject(project) {
  const baseProjectNumber = splitQuickBooksProjectLabel(
    project?.projectName,
    project?.projectId,
  ).projectNumber
  const normalizedBase = normalizeText(baseProjectNumber, 120)

  // Prefer longest numeric token (>=4 digits) to avoid picking incidental
  // short numbers from labels (for example "... 69 ... 251101").
  const digitMatches = normalizedBase.match(/\d{4,}/g)
  if (Array.isArray(digitMatches) && digitMatches.length > 0) {
    const best = digitMatches.sort((left, right) => right.length - left.length)[0]
    if (best) {
      return normalizeText(best, 120)
    }
  }

  if (normalizedBase) {
    return normalizedBase
  }

  return normalizeText(project?.projectId, 120) || null
}

async function exchangeRefreshToken({ clientId, clientSecret, refreshToken }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams()
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', normalizeText(refreshToken, 8000))

  const response = await fetch(quickBooksTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = normalizeText(payload?.error_description || payload?.error || '', 700)
      || `status ${response.status}`
    throw new Error(`QuickBooks token refresh failed: ${message}`)
  }

  const accessToken = normalizeText(payload?.access_token, 8000)
  const nextRefreshToken = normalizeText(payload?.refresh_token, 8000)

  if (!accessToken || !nextRefreshToken) {
    throw new Error('QuickBooks token refresh response is missing access/refresh token.')
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    accessTokenExpiresAt: Number.isFinite(Number(payload?.expires_in))
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null,
  }
}

async function runQuery({ apiBaseUrl, realmId, accessToken, query }) {
  const endpoint =
    `${normalizeText(apiBaseUrl, 400).replace(/\/$/, '')}/v3/company/${encodeURIComponent(realmId)}`
    + `/query?minorversion=75&query=${encodeURIComponent(query)}`

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })

  const text = await response.text().catch(() => '')
  let payload = {}
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = {} }
  }

  if (!response.ok) {
    const message = normalizeText(
      payload?.Fault?.Error?.[0]?.Detail
      || payload?.Fault?.Error?.[0]?.Message
      || payload?.error_description
      || payload?.error
      || `QuickBooks query failed with status ${response.status}`,
      700,
    )
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  return payload
}

async function paginateQuery(queryFn, entityName) {
  const rows = []
  let startPosition = 1
  let page = 0
  let truncated = false

  while (page < quickBooksMaxQueryPages) {
    const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${quickBooksQueryPageSize}`
    const payload = await queryFn(query)
    const batchRows = Array.isArray(payload?.QueryResponse?.[entityName])
      ? payload.QueryResponse[entityName]
      : []

    rows.push(...batchRows)
    page += 1

    if (batchRows.length < quickBooksQueryPageSize) {
      break
    }

    startPosition += quickBooksQueryPageSize

    if (page >= quickBooksMaxQueryPages) {
      truncated = true
    }
  }

  return { rows, truncated }
}

export function createQuickBooksProjectsService({ getCollections }) {
  async function resolveConnection() {
    const clientId = normalizeText(process.env.QUICKBOOKS_CLIENT_ID, 300)
    const clientSecret = normalizeText(process.env.QUICKBOOKS_CLIENT_SECRET, 300)
    const apiBaseUrl =
      normalizeText(process.env.QUICKBOOKS_API_BASE_URL, 400) || quickBooksApiBaseUrlDefault

    if (!clientId || !clientSecret) {
      throw new Error('QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.')
    }

    const { database } = await getCollections()
    const tokensCollection = database.collection('quickbooks_oauth_tokens')
    let tokenDoc = await tokensCollection.findOne({ id: quickBooksTokenDocId })

    if (!tokenDoc) {
      throw new Error('QuickBooks is not connected yet. Connect QuickBooks first.')
    }

    const accessToken = normalizeText(tokenDoc?.accessToken, 8000)
    const shouldRefresh =
      !accessToken
      || isExpiredAt(tokenDoc?.accessTokenExpiresAt, quickBooksAccessTokenRefreshSkewMs)

    if (shouldRefresh) {
      const refreshed = await exchangeRefreshToken({
        clientId,
        clientSecret,
        refreshToken: tokenDoc?.refreshToken,
      })
      const now = new Date().toISOString()

      await tokensCollection.updateOne(
        { id: quickBooksTokenDocId },
        {
          $set: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            updatedAt: now,
            lastRefreshAt: now,
          },
        },
        { upsert: true },
      )

      tokenDoc = { ...tokenDoc, ...refreshed }
    }

    const realmId = normalizeText(tokenDoc?.realmId, 200)
    if (!realmId) {
      throw new Error('QuickBooks token is missing realmId.')
    }

    return {
      apiBaseUrl,
      realmId,
      accessToken: normalizeText(tokenDoc?.accessToken, 8000),
    }
  }

  async function fetchProjectsFinancials() {
    const warnings = []
    let connection = await resolveConnection()

    const queryFn = async (query) => {
      try {
        return await runQuery({ ...connection, query })
      } catch (error) {
        if (Number(error?.status) === 401) {
          connection = await resolveConnection()
          return runQuery({ ...connection, query })
        }
        throw error
      }
    }

    const [customersResult, billsResult, invoicesResult, paymentsResult, purchaseOrdersResult] = await Promise.all([
      paginateQuery(queryFn, 'Customer'),
      paginateQuery(queryFn, 'Bill'),
      paginateQuery(queryFn, 'Invoice'),
      paginateQuery(queryFn, 'Payment'),
      paginateQuery(queryFn, 'PurchaseOrder'),
    ])

    const projectsById = new Map()

    customersResult.rows.forEach((customer) => {
      if (customer?.Job !== true) {
        return
      }
      const projectId = normalizeText(customer?.Id, 160)
      if (!projectId) {
        return
      }
      const displayName = normalizeText(customer?.DisplayName, 260)
      const projectName =
        normalizeText(customer?.FullyQualifiedName, 260) || displayName || projectId
      const orderNumber = resolveOrderNumberFromProject({ projectId, projectName, displayName })

      projectsById.set(projectId, {
        projectId,
        projectName,
        orderNumber,
        poAmount: 0,
        billAmount: 0,
        billBalanceAmount: 0,
        hasBillBalance: false,
        invoiceAmount: 0,
        paymentAmount: 0,
        invoiceBalanceAmount: 0,
        hasInvoiceBalance: false,
        invoiceNumber: null,
        latestInvoiceDate: null,
      })
    })

    const projectIdsSet = new Set(projectsById.keys())

    const apply = ({ rows, key, type }) => {
      rows.forEach((txn) => {
        const refs = resolveTxnProjectRefs(txn, projectIdsSet)
        if (refs.length !== 1) {
          return
        }
        const project = projectsById.get(refs[0])
        if (!project) {
          return
        }

        const amount = toMoney(txn?.TotalAmt)
        if (Number.isFinite(Number(amount))) {
          project[key] = Number((Number(project[key]) + Number(amount)).toFixed(2))
        }

        if (type === 'bill') {
          const balance = toMoney(txn?.Balance)
          if (Number.isFinite(Number(balance))) {
            project.billBalanceAmount = Number(
              (Number(project.billBalanceAmount) + Number(balance)).toFixed(2),
            )
            project.hasBillBalance = true
          }
        }

        if (type === 'invoice') {
          const balance = toMoney(txn?.Balance)
          if (Number.isFinite(Number(balance))) {
            project.invoiceBalanceAmount = Number(
              (Number(project.invoiceBalanceAmount) + Number(balance)).toFixed(2),
            )
            project.hasInvoiceBalance = true
          }

          const invoiceDate = toIsoOrNull(txn?.TxnDate)
          const docNumber = normalizeDocNumber(txn)
          const currentMs = toTimestampMs(project.latestInvoiceDate)
          const nextMs = toTimestampMs(invoiceDate)
          const replace =
            Number.isFinite(nextMs)
            && (!Number.isFinite(currentMs) || nextMs > currentMs)

          if (replace || (!project.invoiceNumber && docNumber)) {
            project.latestInvoiceDate = invoiceDate
            project.invoiceNumber = docNumber
          }
        }
      })
    }

    apply({ rows: purchaseOrdersResult.rows, key: 'poAmount', type: 'po' })
    apply({ rows: billsResult.rows, key: 'billAmount', type: 'bill' })
    apply({ rows: invoicesResult.rows, key: 'invoiceAmount', type: 'invoice' })
    apply({ rows: paymentsResult.rows, key: 'paymentAmount', type: 'payment' })

    const projects = [...projectsById.values()].map((project) => {
      const amountOwed = project.hasInvoiceBalance
        ? Number(project.invoiceBalanceAmount.toFixed(2))
        : Number((project.invoiceAmount - project.paymentAmount).toFixed(2))
      const hasFinancialActivity =
        Math.abs(Number(project.billAmount)) > 0.0001
        || Math.abs(Number(project.poAmount)) > 0.0001
        || Math.abs(Number(project.invoiceAmount)) > 0.0001
        || Math.abs(Number(project.paymentAmount)) > 0.0001
      const paidInFull = hasFinancialActivity ? amountOwed <= 0.004 : null

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        orderNumber: project.orderNumber,
        amountOwed,
        billAmount: Number(project.billAmount.toFixed(2)),
        billBalanceAmount: project.hasBillBalance
          ? Number(project.billBalanceAmount.toFixed(2))
          : null,
        invoiceAmount: Number(project.invoiceAmount.toFixed(2)),
        invoiceNumber: project.invoiceNumber,
        paidInFull,
        paymentAmount: Number(project.paymentAmount.toFixed(2)),
        purchaseOrderAmount: Number(project.poAmount.toFixed(2)),
      }
    })

    if (
      customersResult.truncated
      || billsResult.truncated
      || invoicesResult.truncated
      || paymentsResult.truncated
      || purchaseOrdersResult.truncated
    ) {
      warnings.push('One or more QuickBooks queries were truncated. Results may be partial.')
    }

    return {
      generatedAt: new Date().toISOString(),
      warnings,
      projects,
    }
  }

  return { fetchProjectsFinancials }
}
