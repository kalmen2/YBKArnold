import { AppError } from '../utils/app-error.mjs'
import { createTtlCache } from '../utils/ttl-cache.mjs'
import { nowIso } from '../utils/value-utils.mjs'

const quickBooksAuthorizeUrl = 'https://appcenter.intuit.com/connect/oauth2'
const quickBooksTokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const quickBooksApiBaseUrlDefault = 'https://quickbooks.api.intuit.com'
const quickBooksScopesDefault = 'com.intuit.quickbooks.accounting'
const quickBooksTokenDocId = 'primary'
const quickBooksOauthStateTtlMs = 10 * 60 * 1000
const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
const quickBooksQueryPageSize = 500
const quickBooksMaxQueryPages = 8
const quickBooksMaxUnlinkedTransactions = 500
const quickBooksMaxDetailRowsPerType = 1200
const quickBooksMaxLoanBuckets = 40
const quickBooksMaxLoanDetailRowsPerBucket = 1200

const quickBooksKnownLoanOwners = [
  {
    key: 'ben_tyberg',
    label: 'Loan from Ben Tyberg',
    matchers: ['ben tyberg', 'b tyberg', 'ben t'],
    accountNumberAliases: [],
  },
  {
    key: 'israel_kamionka',
    label: 'Loan from Israel Kamionka',
    matchers: ['israel kamionka', 'israel.kamionka', 'kamionka', 'israel 0050'],
    accountNumberAliases: ['0050'],
  },
  {
    key: 'yb_coit',
    label: 'Loan from YB Coit',
    matchers: ['yb coit', 'coit', 'ybcoit'],
    accountNumberAliases: [],
  },
]

// The overview fires 5–40 live QB API calls (5 entity types × up to 8 pages
// each). Caching for 5 minutes means repeat navigations hit memory instead
// of QuickBooks. forceRefresh=1 bypasses the read but still seeds the cache.
const _qbCache = createTtlCache()
const qbCacheGet = (key) => _qbCache.get(key)
const qbCacheSet = (key, value, ttlMs) => _qbCache.set(key, value, ttlMs)

const QB_OVERVIEW_CACHE_KEY = 'qb:overview'
const QB_OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

const txnTypeConfigByKey = {
  purchaseOrder: {
    entityName: 'PurchaseOrder',
    countField: 'purchaseOrderCount',
    amountField: 'purchaseOrderAmount',
    label: 'Purchase order',
  },
  bill: {
    entityName: 'Bill',
    countField: 'billCount',
    amountField: 'billAmount',
    label: 'Bill',
  },
  invoice: {
    entityName: 'Invoice',
    countField: 'invoiceCount',
    amountField: 'invoiceAmount',
    label: 'Invoice',
  },
  payment: {
    entityName: 'Payment',
    countField: 'paymentCount',
    amountField: 'paymentAmount',
    label: 'Payment',
  },
}

let quickBooksIndexesPromise

function normalizeText(value, maxLength = 400) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normalizeLookupToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeAccountNumberToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function normalizeMoney(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Number(parsed.toFixed(2))
}

function normalizeScopes(rawScopes) {
  const scopeSource = normalizeText(rawScopes, 1000)

  if (!scopeSource) {
    return quickBooksScopesDefault
  }

  const normalizedScopes = scopeSource
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  return normalizedScopes.length > 0
    ? normalizedScopes.join(' ')
    : quickBooksScopesDefault
}

function normalizeQuickBooksApiBaseUrl(value) {
  const normalized = normalizeText(value, 400)

  if (!normalized) {
    return quickBooksApiBaseUrlDefault
  }

  return normalized.replace(/\/$/, '')
}

function sanitizeRedirectPath(value) {
  const trimmed = normalizeText(value, 180)

  if (!trimmed.startsWith('/')) {
    return '/quickbooks'
  }

  if (trimmed.startsWith('//')) {
    return '/quickbooks'
  }

  return trimmed
}

function resolveQuickBooksRedirectUri(req) {
  const configuredRedirectUri = normalizeText(process.env.QUICKBOOKS_REDIRECT_URI, 1000)

  if (configuredRedirectUri) {
    return configuredRedirectUri
  }

  const forwardedProto = normalizeText(req.headers?.['x-forwarded-proto'], 80).split(',')[0]
  const forwardedHost = normalizeText(req.headers?.['x-forwarded-host'], 300).split(',')[0]
  const host = forwardedHost || normalizeText(req.get('host'), 300)

  if (!host) {
    throw new AppError('Unable to resolve QuickBooks redirect URI host.', 500)
  }

  const protocol = forwardedProto || normalizeText(req.protocol, 20) || 'https'

  return `${protocol}://${host}/api/quickbooks/oauth/callback`
}

function getQuickBooksConfig(req) {
  const clientId = normalizeText(process.env.QUICKBOOKS_CLIENT_ID, 300)
  const clientSecret = normalizeText(process.env.QUICKBOOKS_CLIENT_SECRET, 300)
  const configuredApiBaseUrl = normalizeText(process.env.QUICKBOOKS_API_BASE_URL, 400)

  if (!clientId || !clientSecret) {
    throw new AppError(
      'QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
      500,
    )
  }

  return {
    clientId,
    clientSecret,
    redirectUri: resolveQuickBooksRedirectUri(req),
    scopes: normalizeScopes(process.env.QUICKBOOKS_SCOPES),
    apiBaseUrl: normalizeQuickBooksApiBaseUrl(configuredApiBaseUrl || quickBooksApiBaseUrlDefault),
  }
}

function isExpiredAt(isoTimestamp, skewMs = 0) {
  const timestampMs = Date.parse(normalizeText(isoTimestamp, 80))

  if (!Number.isFinite(timestampMs)) {
    return true
  }

  return Date.now() >= timestampMs - skewMs
}

function isStaleState(createdAtIso) {
  const createdAtMs = Date.parse(normalizeText(createdAtIso, 80))

  if (!Number.isFinite(createdAtMs)) {
    return true
  }

  return Date.now() - createdAtMs > quickBooksOauthStateTtlMs
}

function toIsoTimeFromNow(secondsFromNow) {
  const seconds = Number(secondsFromNow)

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return new Date(Date.now() + seconds * 1000).toISOString()
}

function mapQuickBooksTokenPayload(payload, existingTokenDoc) {
  const accessToken = normalizeText(payload?.access_token, 8000)
  const refreshToken = normalizeText(payload?.refresh_token, 8000)

  if (!accessToken || !refreshToken) {
    throw new AppError('QuickBooks token response is missing required token fields.', 502)
  }

  return {
    accessToken,
    refreshToken,
    tokenType: normalizeText(payload?.token_type, 40) || 'bearer',
    accessTokenExpiresAt: toIsoTimeFromNow(payload?.expires_in),
    refreshTokenExpiresAt:
      toIsoTimeFromNow(payload?.x_refresh_token_expires_in)
      ?? existingTokenDoc?.refreshTokenExpiresAt
      ?? null,
  }
}

function resolveQuickBooksErrorMessage(payload, fallbackMessage) {
  const faultError = payload?.Fault?.Error?.[0]
  const faultMessage = normalizeText(faultError?.Detail || faultError?.Message, 700)

  if (faultMessage) {
    return faultMessage
  }

  return normalizeText(payload?.error_description || payload?.error, 700) || fallbackMessage
}

function extractQuickBooksRefValue(refValue) {
  if (typeof refValue === 'string') {
    return normalizeText(refValue, 160)
  }

  if (!refValue || typeof refValue !== 'object') {
    return ''
  }

  return (
    normalizeText(refValue.value, 160)
    || normalizeText(refValue.id, 160)
    || ''
  )
}

function extractQuickBooksRefName(refValue) {
  if (!refValue || typeof refValue !== 'object') {
    return null
  }

  return normalizeText(refValue.name, 260) || null
}

function includesAnyMatcher(normalizedValue, matchers) {
  if (!normalizedValue || !Array.isArray(matchers) || matchers.length === 0) {
    return false
  }

  return matchers.some((matcher) => normalizedValue.includes(normalizeLookupToken(matcher)))
}

function resolveQuickBooksLoanOwnerKey(value) {
  const normalizedValue = normalizeLookupToken(value)

  if (!normalizedValue) {
    return null
  }

  const matchedOwner = quickBooksKnownLoanOwners.find((owner) =>
    includesAnyMatcher(normalizedValue, owner.matchers),
  )

  return matchedOwner?.key ?? null
}

function resolveQuickBooksLoanOwnerKeyFromAccountNumber(value) {
  const normalizedAccountNumber = normalizeAccountNumberToken(value)

  if (!normalizedAccountNumber) {
    return null
  }

  const matchedOwner = quickBooksKnownLoanOwners.find((owner) =>
    Array.isArray(owner.accountNumberAliases)
    && owner.accountNumberAliases.some(
      (alias) => normalizeAccountNumberToken(alias) === normalizedAccountNumber,
    ),
  )

  return matchedOwner?.key ?? null
}

function getQuickBooksAccountDisplayName(accountRow) {
  return (
    normalizeText(accountRow?.FullyQualifiedName, 260)
    || normalizeText(accountRow?.Name, 260)
    || normalizeText(accountRow?.Id, 160)
    || 'Unknown account'
  )
}

function getQuickBooksAccountNumber(accountRow) {
  return normalizeText(accountRow?.AcctNum, 120) || null
}

function isQuickBooksLoanAccount(accountRow) {
  const displayName = getQuickBooksAccountDisplayName(accountRow)
  const accountNumber = getQuickBooksAccountNumber(accountRow)
  const normalizedDisplayName = normalizeLookupToken(displayName)
  const accountType = normalizeLookupToken(accountRow?.AccountType)
  const accountSubType = normalizeLookupToken(accountRow?.AccountSubType)

  if (normalizedDisplayName.includes('loan')) {
    return true
  }

  if (includesAnyMatcher(normalizedDisplayName, quickBooksKnownLoanOwners.flatMap((owner) => owner.matchers))) {
    return true
  }

  if (resolveQuickBooksLoanOwnerKeyFromAccountNumber(accountNumber)) {
    return true
  }

  return accountType.includes('liability') && accountSubType.includes('loan')
}

function resolveLoanMovementDirectionFromPostingType({ postingType, accountType }) {
  const normalizedPostingType = normalizeLookupToken(postingType)
  const normalizedAccountType = normalizeLookupToken(accountType)
  const isLiabilityAccount = normalizedAccountType.includes('liability')

  if (normalizedPostingType === 'credit') {
    return isLiabilityAccount ? 'in' : 'out'
  }

  if (normalizedPostingType === 'debit') {
    return isLiabilityAccount ? 'out' : 'in'
  }

  return null
}

function normalizeLoanOutstandingAmount(accountRow) {
  const currentBalance = normalizeMoney(accountRow?.CurrentBalance)

  if (!Number.isFinite(currentBalance)) {
    return 0
  }

  return Math.abs(currentBalance)
}

function createLoanBucket({
  bucketId,
  ownerKey = null,
  label,
}) {
  return {
    bucketId,
    ownerKey,
    label,
    accountIds: [],
    accountNumbers: [],
    totalLoanAmount: 0,
    totalInvestedAmount: 0,
    totalTakenOutAmount: 0,
    movementOutstandingAmount: 0,
    movementCount: 0,
    details: [],
  }
}

function collectCustomerRefsDeep(input, refsSet, depth = 0) {
  if (depth > 6 || !input) {
    return
  }

  if (Array.isArray(input)) {
    input.forEach((item) => {
      collectCustomerRefsDeep(item, refsSet, depth + 1)
    })

    return
  }

  if (typeof input !== 'object') {
    return
  }

  Object.entries(input).forEach(([key, value]) => {
    if (key === 'CustomerRef') {
      const refValue = extractQuickBooksRefValue(value)

      if (refValue) {
        refsSet.add(refValue)
      }
    }

    if (value && typeof value === 'object') {
      collectCustomerRefsDeep(value, refsSet, depth + 1)
    }
  })
}

function resolveQuickBooksLineDetailObject(line) {
  if (!line || typeof line !== 'object') {
    return null
  }

  const detailKeys = [
    'JournalEntryLineDetail',
    'DepositLineDetail',
    'AccountBasedExpenseLineDetail',
    'ItemBasedExpenseLineDetail',
    'AccountBasedExpenseLineDetail',
    'ItemBasedExpenseLineDetail',
    'SalesItemLineDetail',
    'ItemLineDetail',
    'AccountBasedExpenseLineDetail',
  ]

  for (const key of detailKeys) {
    const detailValue = line[key]

    if (detailValue && typeof detailValue === 'object') {
      return detailValue
    }
  }

  return null
}

function extractQuickBooksLineAccountRef(line) {
  const detail = resolveQuickBooksLineDetailObject(line)

  return (
    extractQuickBooksRefValue(detail?.AccountRef)
    || extractQuickBooksRefValue(line?.AccountRef)
    || ''
  )
}

function extractQuickBooksLineClassName(line) {
  const detail = resolveQuickBooksLineDetailObject(line)

  return (
    extractQuickBooksRefName(detail?.ClassRef)
    || extractQuickBooksRefName(line?.ClassRef)
    || null
  )
}

function extractQuickBooksLinePostingType(line) {
  const detail = resolveQuickBooksLineDetailObject(line)

  return (
    normalizeText(detail?.PostingType, 40)
    || normalizeText(line?.PostingType, 40)
    || null
  )
}

function extractProjectRefsFromQuickBooksTxn(transaction) {
  const refsSet = new Set()
  collectCustomerRefsDeep(transaction, refsSet)
  return [...refsSet]
}

function normalizeQuickBooksDocNumber(txn) {
  return (
    normalizeText(txn?.DocNumber, 160)
    || normalizeText(txn?.PaymentRefNum, 160)
    || normalizeText(txn?.Id, 160)
    || null
  )
}

function normalizeQuickBooksLineDescription(line) {
  return (
    normalizeText(line?.Description, 280)
    || normalizeText(line?.DetailType, 120)
    || null
  )
}

function isQuickBooksProjectCustomer(customer) {
  return customer?.Job === true
}

function toQuickBooksDetailRow({
  type,
  id,
  docNumber,
  txnDate,
  totalAmount,
  balanceAmount = null,
  projectId = null,
  projectName = null,
  lineNumber = null,
  lineDescription = null,
  reason = null,
  candidateProjectRefs = [],
}) {
  return {
    type,
    id: normalizeText(id, 160) || null,
    docNumber: normalizeText(docNumber, 160) || null,
    txnDate: normalizeText(txnDate, 40) || null,
    totalAmount: normalizeMoney(totalAmount),
    balanceAmount: Number.isFinite(Number(balanceAmount)) ? normalizeMoney(balanceAmount) : null,
    projectId: normalizeText(projectId, 160) || null,
    projectName: normalizeText(projectName, 260) || null,
    lineNumber: Number.isFinite(Number(lineNumber)) ? Number(lineNumber) : null,
    lineDescription: normalizeText(lineDescription, 280) || null,
    reason: normalizeText(reason, 400) || null,
    candidateProjectRefs: Array.isArray(candidateProjectRefs)
      ? candidateProjectRefs.map((value) => normalizeText(value, 160)).filter(Boolean)
      : [],
  }
}

function createEmptyProjectSummary(projectId, projectName, active) {
  return {
    projectId,
    projectName,
    active,
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
}

function applyTransactionToProject(projectRow, txnTypeKey, amount) {
  const typeConfig = txnTypeConfigByKey[txnTypeKey]

  if (!typeConfig) {
    return
  }

  projectRow.transactionCount += 1
  projectRow[typeConfig.countField] += 1
  projectRow[typeConfig.amountField] = normalizeMoney(projectRow[typeConfig.amountField] + amount)
}

async function exchangeQuickBooksToken({
  clientId,
  clientSecret,
  grantType,
  code,
  redirectUri,
  refreshToken,
}) {
  const encodedAuthToken = Buffer
    .from(`${clientId}:${clientSecret}`)
    .toString('base64')
  const formData = new URLSearchParams()

  formData.set('grant_type', grantType)

  if (grantType === 'authorization_code') {
    formData.set('code', normalizeText(code, 1200))
    formData.set('redirect_uri', normalizeText(redirectUri, 1000))
  } else {
    formData.set('refresh_token', normalizeText(refreshToken, 8000))
  }

  const response = await fetch(quickBooksTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodedAuthToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new AppError(
      `QuickBooks token request failed: ${resolveQuickBooksErrorMessage(payload, `status ${response.status}`)}`,
      502,
    )
  }

  return payload
}

async function quickBooksQuery({ apiBaseUrl, realmId, accessToken, query }) {
  const endpoint = `${normalizeQuickBooksApiBaseUrl(apiBaseUrl)}/v3/company/${encodeURIComponent(realmId)}/query?minorversion=75&query=${encodeURIComponent(query)}`
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const responseText = await response.text().catch(() => '')
  let payload = {}

  if (responseText) {
    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = {}
    }
  }

  if (response.status === 401) {
    throw new AppError('QuickBooks access token is no longer valid.', 401)
  }

  if (!response.ok) {
    const bodySummary = normalizeText(String(responseText || '').replace(/\s+/g, ' '), 300)
    const fallbackMessage = bodySummary
      ? `status ${response.status} (${bodySummary})`
      : `status ${response.status}`

    throw new AppError(
      `QuickBooks query failed: ${resolveQuickBooksErrorMessage(payload, fallbackMessage)}`,
      response.status,
    )
  }

  return payload
}

async function queryAllQuickBooksRows(queryFn, entityName) {
  const allRows = []
  let startPosition = 1
  let page = 0
  let truncated = false

  while (page < quickBooksMaxQueryPages) {
    const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${quickBooksQueryPageSize}`
    const payload = await queryFn(query)
    const batchRows = Array.isArray(payload?.QueryResponse?.[entityName])
      ? payload.QueryResponse[entityName]
      : []

    allRows.push(...batchRows)
    page += 1

    if (batchRows.length < quickBooksQueryPageSize) {
      break
    }

    startPosition += quickBooksQueryPageSize

    if (page >= quickBooksMaxQueryPages) {
      truncated = true
    }
  }

  return {
    rows: allRows,
    truncated,
  }
}

function toQuickBooksCallbackHtml({ redirectPath, status, message }) {
  const normalizedPath = sanitizeRedirectPath(redirectPath)
  const separator = normalizedPath.includes('?') ? '&' : '?'
  const appBaseUrl = normalizeText(process.env.QUICKBOOKS_APP_BASE_URL, 400).replace(/\/$/, '')
  const redirectLocation = `${appBaseUrl}${normalizedPath}${separator}qb=${encodeURIComponent(status)}&qbMessage=${encodeURIComponent(message)}`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QuickBooks Connection</title>
    <meta http-equiv="refresh" content="0;url=${redirectLocation}" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #0f172a; }
      .box { max-width: 560px; margin: 0 auto; border: 1px solid #dbe3ef; border-radius: 12px; padding: 16px; }
      .title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
      .message { color: #334155; margin-bottom: 12px; }
      a { color: #2563eb; text-decoration: none; }
    </style>
    <script>
      window.location.replace(${JSON.stringify(redirectLocation)})
    </script>
  </head>
  <body>
    <div class="box">
      <div class="title">QuickBooks Connection</div>
      <div class="message">${message}</div>
      <a href="${redirectLocation}">Continue</a>
    </div>
  </body>
</html>`
}

export function registerQuickBooksRoutes(app, deps) {
  const {
    getCollections,
    randomUUID,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
  } = deps

  async function getQuickBooksCollections() {
    const { database } = await getCollections()
    const quickBooksTokensCollection = database.collection('quickbooks_oauth_tokens')
    const quickBooksStatesCollection = database.collection('quickbooks_oauth_states')

    if (!quickBooksIndexesPromise) {
      quickBooksIndexesPromise = Promise
        .all([
          quickBooksTokensCollection.createIndex({ id: 1 }, { unique: true }),
          quickBooksTokensCollection.createIndex({ updatedAt: -1 }),
          quickBooksStatesCollection.createIndex({ id: 1 }, { unique: true }),
          quickBooksStatesCollection.createIndex({ createdAt: 1 }),
        ])
        .catch((error) => {
          quickBooksIndexesPromise = undefined
          throw error
        })
    }

    await quickBooksIndexesPromise

    return {
      quickBooksTokensCollection,
      quickBooksStatesCollection,
    }
  }

  async function refreshQuickBooksAccessToken({
    quickBooksTokensCollection,
    tokenDoc,
    clientId,
    clientSecret,
  }) {
    if (!tokenDoc?.refreshToken) {
      throw new AppError('QuickBooks is not connected yet. Connect QuickBooks first.', 409)
    }

    if (isExpiredAt(tokenDoc.refreshTokenExpiresAt)) {
      throw new AppError('QuickBooks refresh token expired. Reconnect QuickBooks.', 401)
    }

    const refreshPayload = await exchangeQuickBooksToken({
      clientId,
      clientSecret,
      grantType: 'refresh_token',
      refreshToken: tokenDoc.refreshToken,
    })
    const normalizedToken = mapQuickBooksTokenPayload(refreshPayload, tokenDoc)
    const now = nowIso()

    await quickBooksTokensCollection.updateOne(
      { id: quickBooksTokenDocId },
      {
        $set: {
          accessToken: normalizedToken.accessToken,
          refreshToken: normalizedToken.refreshToken,
          tokenType: normalizedToken.tokenType,
          accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
          refreshTokenExpiresAt: normalizedToken.refreshTokenExpiresAt,
          updatedAt: now,
          lastRefreshAt: now,
        },
      },
      { upsert: true },
    )

    return {
      ...tokenDoc,
      ...normalizedToken,
      updatedAt: now,
      lastRefreshAt: now,
    }
  }

  async function resolveQuickBooksAccessToken({
    quickBooksTokensCollection,
    clientId,
    clientSecret,
    forceRefresh,
  }) {
    const tokenDoc = await quickBooksTokensCollection.findOne({
      id: quickBooksTokenDocId,
    })

    if (!tokenDoc) {
      throw new AppError('QuickBooks is not connected yet. Connect QuickBooks first.', 409)
    }

    const shouldRefresh = forceRefresh
      || isExpiredAt(tokenDoc.accessTokenExpiresAt, quickBooksAccessTokenRefreshSkewMs)

    if (!shouldRefresh && tokenDoc.accessToken) {
      return tokenDoc
    }

    return refreshQuickBooksAccessToken({
      quickBooksTokensCollection,
      tokenDoc,
      clientId,
      clientSecret,
    })
  }

  app.get('/api/quickbooks/status', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
    try {
      const clientId = normalizeText(process.env.QUICKBOOKS_CLIENT_ID, 300)
      const clientSecret = normalizeText(process.env.QUICKBOOKS_CLIENT_SECRET, 300)
      const isConfigured = Boolean(clientId && clientSecret)
      const { quickBooksTokensCollection } = await getQuickBooksCollections()
      const tokenDoc = await quickBooksTokensCollection.findOne(
        {
          id: quickBooksTokenDocId,
        },
        {
          projection: {
            _id: 0,
            accessToken: 0,
            refreshToken: 0,
          },
        },
      )

      if (!tokenDoc) {
        return res.json({
          isConfigured,
          connected: false,
          realmId: null,
        })
      }

      return res.json({
        isConfigured,
        connected: true,
        realmId: normalizeText(tokenDoc.realmId, 160) || null,
        companyName: normalizeText(tokenDoc.companyName, 240) || null,
        apiBaseUrl: normalizeQuickBooksApiBaseUrl(process.env.QUICKBOOKS_API_BASE_URL),
        updatedAt: tokenDoc.updatedAt ?? null,
        accessTokenExpiresAt: tokenDoc.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: tokenDoc.refreshTokenExpiresAt ?? null,
        needsReconnect: isExpiredAt(tokenDoc.refreshTokenExpiresAt),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/quickbooks/oauth/start', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
    try {
      const quickBooksConfig = getQuickBooksConfig(req)
      const { quickBooksStatesCollection } = await getQuickBooksCollections()
      const now = nowIso()
      const cutoffIso = new Date(Date.now() - quickBooksOauthStateTtlMs).toISOString()
      const stateId = randomUUID()
      const redirectPath = sanitizeRedirectPath(req.query?.redirectPath || '/quickbooks')

      await quickBooksStatesCollection.deleteMany({
        createdAt: {
          $lt: cutoffIso,
        },
      })

      await quickBooksStatesCollection.insertOne({
        id: stateId,
        redirectPath,
        requestedByUid: normalizeText(req.authUser?.uid, 160) || null,
        requestedByEmail: normalizeText(req.authUser?.email, 240) || null,
        createdAt: now,
      })

      const authorizeUrl = new URL(quickBooksAuthorizeUrl)
      authorizeUrl.searchParams.set('client_id', quickBooksConfig.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('scope', quickBooksConfig.scopes)
      authorizeUrl.searchParams.set('redirect_uri', quickBooksConfig.redirectUri)
      authorizeUrl.searchParams.set('state', stateId)

      return res.json({
        authorizeUrl: authorizeUrl.toString(),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/quickbooks/oauth/callback', async (req, res) => {
    let redirectPath = '/quickbooks'

    try {
      const quickBooksConfig = getQuickBooksConfig(req)
      const stateId = normalizeText(req.query?.state, 180)
      const code = normalizeText(req.query?.code, 1500)
      const realmId = normalizeText(req.query?.realmId, 180)
      const oauthError = normalizeText(req.query?.error, 120)
      const oauthErrorDescription = normalizeText(req.query?.error_description, 700)
      const { quickBooksTokensCollection, quickBooksStatesCollection } = await getQuickBooksCollections()
      const stateDoc = stateId
        ? await quickBooksStatesCollection.findOne({ id: stateId })
        : null
      redirectPath = sanitizeRedirectPath(stateDoc?.redirectPath || '/quickbooks')

      if (stateDoc?.id) {
        await quickBooksStatesCollection.deleteOne({ id: stateDoc.id })
      }

      if (!stateDoc || isStaleState(stateDoc.createdAt)) {
        throw new AppError('QuickBooks connection state expired. Please try again.', 400)
      }

      if (oauthError) {
        const message = oauthErrorDescription || `QuickBooks authorization failed: ${oauthError}`
        const html = toQuickBooksCallbackHtml({
          redirectPath,
          status: 'error',
          message,
        })

        return res.status(200).type('html').send(html)
      }

      if (!code || !realmId) {
        throw new AppError('Missing QuickBooks authorization code or company realm ID.', 400)
      }

      const tokenPayload = await exchangeQuickBooksToken({
        clientId: quickBooksConfig.clientId,
        clientSecret: quickBooksConfig.clientSecret,
        grantType: 'authorization_code',
        code,
        redirectUri: quickBooksConfig.redirectUri,
      })
      const normalizedToken = mapQuickBooksTokenPayload(tokenPayload)
      const productionValidationQuery = 'SELECT * FROM CompanyInfo STARTPOSITION 1 MAXRESULTS 1'
      let connectedCompanyName = null

      try {
        const validationPayload = await quickBooksQuery({
          apiBaseUrl: quickBooksConfig.apiBaseUrl,
          realmId,
          accessToken: normalizedToken.accessToken,
          query: productionValidationQuery,
        })
        const companyInfoRaw = Array.isArray(validationPayload?.QueryResponse?.CompanyInfo)
          ? validationPayload.QueryResponse.CompanyInfo[0]
          : null

        connectedCompanyName = normalizeText(companyInfoRaw?.CompanyName, 240) || null
      } catch (validationError) {
        if (Number(validationError?.status) === 403) {
          throw new AppError(
            'QuickBooks token is not authorized for production API. Use Production QuickBooks Client ID/Secret and reconnect using a production company.',
            403,
          )
        }

        throw validationError
      }

      const now = nowIso()

      await quickBooksTokensCollection.updateOne(
        {
          id: quickBooksTokenDocId,
        },
        {
          $set: {
            id: quickBooksTokenDocId,
            realmId,
            accessToken: normalizedToken.accessToken,
            refreshToken: normalizedToken.refreshToken,
            tokenType: normalizedToken.tokenType,
            accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
            refreshTokenExpiresAt: normalizedToken.refreshTokenExpiresAt,
            apiBaseUrl: quickBooksConfig.apiBaseUrl,
            companyName: connectedCompanyName,
            updatedAt: now,
            connectedAt: now,
            connectedByUid: stateDoc.requestedByUid ?? null,
            connectedByEmail: stateDoc.requestedByEmail ?? null,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      )

      const html = toQuickBooksCallbackHtml({
        redirectPath,
        status: 'connected',
        message: 'QuickBooks connected successfully. Redirecting back to the app.',
      })

      return res.status(200).type('html').send(html)
    } catch (error) {
      const html = toQuickBooksCallbackHtml({
        redirectPath,
        status: 'error',
        message: normalizeText(error?.message, 700) || 'QuickBooks connection failed. Please try again.',
      })

      return res.status(200).type('html').send(html)
    }
  })

  app.get('/api/quickbooks/overview', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
    try {
      const quickBooksConfig = getQuickBooksConfig(req)
      const { quickBooksTokensCollection } = await getQuickBooksCollections()
      const forceRefresh = String(req.query?.refresh ?? '').trim() === '1'

      // Return cached result when available and no refresh is requested.
      // forceRefresh still writes the fresh result into cache so the next
      // visitor benefits immediately.
      if (!forceRefresh) {
        const cached = qbCacheGet(QB_OVERVIEW_CACHE_KEY)
        if (cached) return res.json(cached)
      }

      let tokenDoc = await resolveQuickBooksAccessToken({
        quickBooksTokensCollection,
        clientId: quickBooksConfig.clientId,
        clientSecret: quickBooksConfig.clientSecret,
        forceRefresh,
      })
      const resolveQuery = (queryText) => quickBooksQuery({
        apiBaseUrl: quickBooksConfig.apiBaseUrl,
        realmId: tokenDoc.realmId,
        accessToken: tokenDoc.accessToken,
        query: queryText,
      })

      const queryFn = async (query) => {
        let lastError

        try {
          return await resolveQuery(query)
        } catch (error) {
          lastError = error

          if (Number(error?.status) === 401) {
            tokenDoc = await resolveQuickBooksAccessToken({
              quickBooksTokensCollection,
              clientId: quickBooksConfig.clientId,
              clientSecret: quickBooksConfig.clientSecret,
              forceRefresh: true,
            })

            try {
              return await resolveQuery(query)
            } catch (retryError) {
              lastError = retryError
            }
          }

          if (Number(lastError?.status) === 403) {
            throw new AppError(
              'QuickBooks authorization failed for production API host. Reconnect QuickBooks using the production company.',
              403,
            )
          }

          throw lastError
        }
      }

      const companyInfoPayload = await queryFn('SELECT * FROM CompanyInfo STARTPOSITION 1 MAXRESULTS 1')
      const companyInfoRaw = Array.isArray(companyInfoPayload?.QueryResponse?.CompanyInfo)
        ? companyInfoPayload.QueryResponse.CompanyInfo[0]
        : null
      const companyInfo = companyInfoRaw
        ? {
            id: normalizeText(companyInfoRaw.Id, 160) || null,
            companyName: normalizeText(companyInfoRaw.CompanyName, 240) || null,
            legalName: normalizeText(companyInfoRaw.LegalName, 240) || null,
            email: normalizeText(companyInfoRaw.Email?.Address, 240) || null,
            country: normalizeText(companyInfoRaw.Country, 120) || null,
          }
        : null

      if (companyInfo?.companyName) {
        await quickBooksTokensCollection.updateOne(
          { id: quickBooksTokenDocId },
          {
            $set: {
              companyName: companyInfo.companyName,
              updatedAt: nowIso(),
            },
          },
        )
      }

      const [
        customersResult,
        purchaseOrdersResult,
        billsResult,
        invoicesResult,
        paymentsResult,
        accountsResult,
        journalEntriesResult,
        transfersResult,
        depositsResult,
        checksResult,
      ] = await Promise.all([
        queryAllQuickBooksRows(queryFn, 'Customer'),
        queryAllQuickBooksRows(queryFn, 'PurchaseOrder'),
        queryAllQuickBooksRows(queryFn, 'Bill'),
        queryAllQuickBooksRows(queryFn, 'Invoice'),
        queryAllQuickBooksRows(queryFn, 'Payment'),
        queryAllQuickBooksRows(queryFn, 'Account'),
        queryAllQuickBooksRows(queryFn, 'JournalEntry'),
        queryAllQuickBooksRows(queryFn, 'Transfer'),
        queryAllQuickBooksRows(queryFn, 'Deposit'),
        // Some QuickBooks contexts reject SELECT * FROM Check; Purchase is the
        // supported transaction entity for check-like outflows.
        queryAllQuickBooksRows(queryFn, 'Purchase'),
      ])

      const projectsById = new Map()

      customersResult.rows.forEach((customer) => {
        if (!isQuickBooksProjectCustomer(customer)) {
          return
        }

        const projectId = normalizeText(customer?.Id, 160)

        if (!projectId) {
          return
        }

        const projectName =
          normalizeText(customer?.FullyQualifiedName, 260)
          || normalizeText(customer?.DisplayName, 260)
          || projectId
        const active = customer?.Active !== false

        projectsById.set(projectId, createEmptyProjectSummary(projectId, projectName, active))
      })

      const totals = {
        projectCount: projectsById.size,
        purchaseOrderCount: 0,
        purchaseOrderAmount: 0,
        purchaseOrderLineCount: 0,
        purchaseOrderLineAmount: 0,
        purchaseOrderLineWithoutProjectCount: 0,
        purchaseOrderLineWithoutProjectAmount: 0,
        billCount: 0,
        billAmount: 0,
        invoiceCount: 0,
        invoiceAmount: 0,
        paymentCount: 0,
        paymentAmount: 0,
        unlinkedTransactionCount: 0,
        unlinkedAmount: 0,
        outstandingAmount: 0,
        loanSummaryCount: 0,
        loanTotalAmount: 0,
        loanInvestedAmount: 0,
        loanTakenOutAmount: 0,
      }
      const unlinkedTransactions = []
      const purchaseOrderLineDetails = []
      const billDetails = []
      const invoiceDetails = []
      const paymentDetails = []
      const unlinkedPurchaseOrderLines = []

      purchaseOrdersResult.rows.forEach((purchaseOrder) => {
        const purchaseOrderAmount = normalizeMoney(purchaseOrder?.TotalAmt)
        const purchaseOrderId = normalizeText(purchaseOrder?.Id, 160) || null
        const purchaseOrderDocNumber = normalizeQuickBooksDocNumber(purchaseOrder)
        const purchaseOrderDate = normalizeText(purchaseOrder?.TxnDate, 40) || null
        const headerRefs = extractProjectRefsFromQuickBooksTxn(purchaseOrder)
        const lines = Array.isArray(purchaseOrder?.Line) && purchaseOrder.Line.length > 0
          ? purchaseOrder.Line
          : [
              {
                Amount: purchaseOrderAmount,
                Description: 'Purchase order total (no line items found).',
              },
            ]

        totals.purchaseOrderCount += 1
        totals.purchaseOrderAmount = normalizeMoney(totals.purchaseOrderAmount + purchaseOrderAmount)

        lines.forEach((line, lineIndex) => {
          const lineAmount = normalizeMoney(line?.Amount)
          const lineDescription = normalizeQuickBooksLineDescription(line)
          let lineRefs = extractProjectRefsFromQuickBooksTxn(line)

          if (lineRefs.length === 0 && headerRefs.length === 1) {
            lineRefs = headerRefs
          }

          totals.purchaseOrderLineCount += 1
          totals.purchaseOrderLineAmount = normalizeMoney(totals.purchaseOrderLineAmount + lineAmount)

          const detailBase = {
            type: 'purchaseOrderLine',
            id: purchaseOrderId,
            docNumber: purchaseOrderDocNumber,
            txnDate: purchaseOrderDate,
            totalAmount: lineAmount,
            lineNumber: lineIndex + 1,
            lineDescription,
            candidateProjectRefs: lineRefs,
          }

          const pushUnlinkedPurchaseOrderLine = (reason) => {
            totals.unlinkedTransactionCount += 1
            totals.unlinkedAmount = normalizeMoney(totals.unlinkedAmount + lineAmount)
            totals.purchaseOrderLineWithoutProjectCount += 1
            totals.purchaseOrderLineWithoutProjectAmount = normalizeMoney(
              totals.purchaseOrderLineWithoutProjectAmount + lineAmount,
            )

            const detailRow = toQuickBooksDetailRow({
              ...detailBase,
              reason,
            })

            purchaseOrderLineDetails.push(detailRow)
            unlinkedPurchaseOrderLines.push(detailRow)
          }

          if (lineRefs.length === 0) {
            pushUnlinkedPurchaseOrderLine('Missing project reference on this purchase-order line.')
            return
          }

          if (lineRefs.length > 1) {
            pushUnlinkedPurchaseOrderLine('Multiple project references found on this purchase-order line.')
            return
          }

          const projectRefId = lineRefs[0]
          const projectRow = projectsById.get(projectRefId)

          if (!projectRow) {
            pushUnlinkedPurchaseOrderLine(
              'Referenced customer is not a QuickBooks Project (Job=true) or no longer exists.',
            )
            return
          }

          applyTransactionToProject(projectRow, 'purchaseOrder', lineAmount)
          purchaseOrderLineDetails.push(
            toQuickBooksDetailRow({
              ...detailBase,
              projectId: projectRefId,
              projectName: projectRow.projectName,
            }),
          )
        })
      })

      const processTransactionRows = (txnTypeKey, txnRows, detailRows) => {
        const typeConfig = txnTypeConfigByKey[txnTypeKey]

        if (!typeConfig) {
          return
        }

        txnRows.forEach((txn) => {
          const amount = normalizeMoney(txn?.TotalAmt)
          const refs = extractProjectRefsFromQuickBooksTxn(txn)

          totals[typeConfig.countField] += 1
          totals[typeConfig.amountField] = normalizeMoney(totals[typeConfig.amountField] + amount)

          const detailBase = {
            type: txnTypeKey,
            id: normalizeText(txn?.Id, 160) || null,
            docNumber: normalizeQuickBooksDocNumber(txn),
            txnDate: normalizeText(txn?.TxnDate, 40) || null,
            totalAmount: amount,
            balanceAmount: txnTypeKey === 'invoice' ? normalizeMoney(txn?.Balance) : null,
            candidateProjectRefs: refs,
          }

          const pushUnlinkedTransaction = (reason) => {
            totals.unlinkedTransactionCount += 1
            totals.unlinkedAmount = normalizeMoney(totals.unlinkedAmount + amount)

            unlinkedTransactions.push({
              type: txnTypeKey,
              id: detailBase.id,
              docNumber: detailBase.docNumber,
              txnDate: detailBase.txnDate,
              totalAmount: amount,
              candidateProjectRefs: refs,
              reason,
            })

            detailRows.push(
              toQuickBooksDetailRow({
                ...detailBase,
                reason,
              }),
            )
          }

          if (refs.length === 0) {
            pushUnlinkedTransaction('Missing project reference.')
            return
          }

          if (refs.length > 1) {
            pushUnlinkedTransaction('Multiple project references found in one transaction.')
            return
          }

          const projectRefId = refs[0]
          const projectRow = projectsById.get(projectRefId)

          if (!projectRow) {
            pushUnlinkedTransaction(
              'Referenced customer is not a QuickBooks Project (Job=true) or no longer exists.',
            )
            return
          }

          applyTransactionToProject(projectRow, txnTypeKey, amount)
          detailRows.push(
            toQuickBooksDetailRow({
              ...detailBase,
              projectId: projectRefId,
              projectName: projectRow.projectName,
            }),
          )
        })
      }

      processTransactionRows('bill', billsResult.rows, billDetails)
      processTransactionRows('invoice', invoicesResult.rows, invoiceDetails)
      processTransactionRows('payment', paymentsResult.rows, paymentDetails)

      const accountsById = new Map()

      accountsResult.rows.forEach((accountRow) => {
        const accountId = normalizeText(accountRow?.Id, 160)

        if (!accountId) {
          return
        }

        accountsById.set(accountId, accountRow)
      })

      const loanAccountsById = new Map(
        [...accountsById.entries()].filter(([, accountRow]) => isQuickBooksLoanAccount(accountRow)),
      )
      const loanBucketsById = new Map(
        quickBooksKnownLoanOwners.map((owner) => [
          owner.key,
          createLoanBucket({
            bucketId: owner.key,
            ownerKey: owner.key,
            label: owner.label,
          }),
        ]),
      )
      const loanBucketByAccountId = new Map()

      const resolveLoanLabelFromOwnerKey = (ownerKey) => {
        const matchedOwner = quickBooksKnownLoanOwners.find((owner) => owner.key === ownerKey)

        return matchedOwner?.label || 'Loan'
      }

      const ensureLoanBucketById = ({ bucketId, ownerKey = null, label }) => {
        if (!bucketId) {
          return null
        }

        if (!loanBucketsById.has(bucketId)) {
          loanBucketsById.set(
            bucketId,
            createLoanBucket({
              bucketId,
              ownerKey,
              label,
            }),
          )
        }

        return loanBucketsById.get(bucketId) ?? null
      }

      const attachLoanAccountToBucket = ({ bucket, accountId }) => {
        if (!bucket) {
          return
        }

        const normalizedAccountId = normalizeText(accountId, 160)

        if (!normalizedAccountId) {
          return
        }

        if (!bucket.accountIds.includes(normalizedAccountId)) {
          bucket.accountIds.push(normalizedAccountId)
        }

        const accountRow = loanAccountsById.get(normalizedAccountId)
        const accountNumber = getQuickBooksAccountNumber(accountRow)

        if (accountNumber && !bucket.accountNumbers.includes(accountNumber)) {
          bucket.accountNumbers.push(accountNumber)
        }
      }

      const ensureLoanBucketForAccount = (accountId) => {
        const normalizedAccountId = normalizeText(accountId, 160)

        if (!normalizedAccountId) {
          return null
        }

        if (loanBucketByAccountId.has(normalizedAccountId)) {
          return loanBucketByAccountId.get(normalizedAccountId)
        }

        const accountRow = loanAccountsById.get(normalizedAccountId)

        if (!accountRow) {
          return null
        }

        const accountDisplayName = getQuickBooksAccountDisplayName(accountRow)
        const accountNumber = getQuickBooksAccountNumber(accountRow)
        const ownerKey =
          resolveQuickBooksLoanOwnerKey(accountDisplayName)
          || resolveQuickBooksLoanOwnerKeyFromAccountNumber(accountNumber)
          || resolveQuickBooksLoanOwnerKey(accountNumber)
          || null
        const fallbackBucketId = accountNumber
          ? `loan_account:${accountNumber}`
          : `loan_account:${normalizedAccountId}`
        const bucketId = ownerKey || fallbackBucketId

        const bucket = ensureLoanBucketById({
          bucketId,
          ownerKey,
          label: ownerKey
            ? resolveLoanLabelFromOwnerKey(ownerKey)
            : accountNumber
              ? `Loan (${accountNumber})`
              : `Loan (${accountDisplayName})`,
        })

        if (!bucket) {
          return null
        }

        if (!bucket.accountIds.includes(normalizedAccountId)) {
          bucket.totalLoanAmount = normalizeMoney(
            bucket.totalLoanAmount + normalizeLoanOutstandingAmount(accountRow),
          )
        }

        attachLoanAccountToBucket({
          bucket,
          accountId: normalizedAccountId,
        })

        loanBucketByAccountId.set(normalizedAccountId, bucket)

        return bucket
      }

      const resolveLoanBucketForMovement = ({ accountId, className = null }) => {
        const normalizedAccountId = normalizeText(accountId, 160)

        if (!normalizedAccountId) {
          return null
        }

        const classOwnerKey = resolveQuickBooksLoanOwnerKey(className)

        if (classOwnerKey) {
          const bucket = ensureLoanBucketById({
            bucketId: classOwnerKey,
            ownerKey: classOwnerKey,
            label: resolveLoanLabelFromOwnerKey(classOwnerKey),
          })

          attachLoanAccountToBucket({
            bucket,
            accountId: normalizedAccountId,
          })

          return bucket
        }

        return ensureLoanBucketForAccount(normalizedAccountId)
      }

      const appendLoanMovementDetail = ({
        accountId,
        txnType,
        txnId,
        txnDocNumber,
        txnDate,
        amount,
        direction,
        description = null,
        className = null,
        counterpartyAccountName = null,
      }) => {
        const bucket = resolveLoanBucketForMovement({
          accountId,
          className,
        })

        if (!bucket) {
          return
        }

        const normalizedAmount = normalizeMoney(amount)

        if (normalizedAmount <= 0) {
          return
        }

        const investedAmount = direction === 'in' ? normalizedAmount : 0
        const takenOutAmount = direction === 'out' ? normalizedAmount : 0
        const accountRow = loanAccountsById.get(normalizeText(accountId, 160))

        bucket.totalInvestedAmount = normalizeMoney(bucket.totalInvestedAmount + investedAmount)
        bucket.totalTakenOutAmount = normalizeMoney(bucket.totalTakenOutAmount + takenOutAmount)
        bucket.movementOutstandingAmount = normalizeMoney(
          bucket.movementOutstandingAmount + investedAmount - takenOutAmount,
        )
        bucket.movementCount += 1
        bucket.details.push({
          type: txnType,
          id: normalizeText(txnId, 160) || null,
          docNumber: normalizeText(txnDocNumber, 160) || null,
          txnDate: normalizeText(txnDate, 40) || null,
          amount: normalizedAmount,
          direction,
          investedAmount,
          takenOutAmount,
          accountId: normalizeText(accountId, 160) || null,
          accountName: getQuickBooksAccountDisplayName(accountRow),
          accountNumber: getQuickBooksAccountNumber(accountRow),
          className: normalizeText(className, 200) || null,
          description: normalizeText(description, 280) || null,
          counterpartyAccountName: normalizeText(counterpartyAccountName, 260) || null,
        })
      }

      loanAccountsById.forEach((_, accountId) => {
        ensureLoanBucketForAccount(accountId)
      })

      journalEntriesResult.rows.forEach((journalEntry) => {
        const txnId = normalizeText(journalEntry?.Id, 160) || null
        const txnDocNumber = normalizeQuickBooksDocNumber(journalEntry)
        const txnDate = normalizeText(journalEntry?.TxnDate, 40) || null
        const lines = Array.isArray(journalEntry?.Line) ? journalEntry.Line : []

        lines.forEach((line) => {
          const accountId = extractQuickBooksLineAccountRef(line)

          if (!loanAccountsById.has(accountId)) {
            return
          }

          const accountRow = loanAccountsById.get(accountId)
          const direction = resolveLoanMovementDirectionFromPostingType({
            postingType: extractQuickBooksLinePostingType(line),
            accountType: accountRow?.AccountType,
          }) || 'unknown'

          appendLoanMovementDetail({
            accountId,
            txnType: 'journalEntry',
            txnId,
            txnDocNumber,
            txnDate,
            amount: line?.Amount,
            direction,
            description: line?.Description,
            className: extractQuickBooksLineClassName(line),
          })
        })
      })

      transfersResult.rows.forEach((transfer) => {
        const txnId = normalizeText(transfer?.Id, 160) || null
        const txnDocNumber = normalizeQuickBooksDocNumber(transfer)
        const txnDate = normalizeText(transfer?.TxnDate, 40) || null
        const amount = normalizeMoney(transfer?.Amount)
        const fromAccountId = extractQuickBooksRefValue(transfer?.FromAccountRef)
        const toAccountId = extractQuickBooksRefValue(transfer?.ToAccountRef)
        const fromAccountName = extractQuickBooksRefName(transfer?.FromAccountRef)
        const toAccountName = extractQuickBooksRefName(transfer?.ToAccountRef)

        if (loanAccountsById.has(fromAccountId)) {
          appendLoanMovementDetail({
            accountId: fromAccountId,
            txnType: 'transfer',
            txnId,
            txnDocNumber,
            txnDate,
            amount,
            direction: 'out',
            description: transfer?.PrivateNote || transfer?.Memo || null,
            counterpartyAccountName: toAccountName,
          })
        }

        if (loanAccountsById.has(toAccountId)) {
          appendLoanMovementDetail({
            accountId: toAccountId,
            txnType: 'transfer',
            txnId,
            txnDocNumber,
            txnDate,
            amount,
            direction: 'in',
            description: transfer?.PrivateNote || transfer?.Memo || null,
            counterpartyAccountName: fromAccountName,
          })
        }
      })

      depositsResult.rows.forEach((deposit) => {
        const txnId = normalizeText(deposit?.Id, 160) || null
        const txnDocNumber = normalizeQuickBooksDocNumber(deposit)
        const txnDate = normalizeText(deposit?.TxnDate, 40) || null
        const lines = Array.isArray(deposit?.Line) ? deposit.Line : []

        lines.forEach((line) => {
          const accountId = extractQuickBooksLineAccountRef(line)

          if (!loanAccountsById.has(accountId)) {
            return
          }

          appendLoanMovementDetail({
            accountId,
            txnType: 'deposit',
            txnId,
            txnDocNumber,
            txnDate,
            amount: line?.Amount,
            direction: 'in',
            description: line?.Description || deposit?.PrivateNote || deposit?.Memo || null,
            className: extractQuickBooksLineClassName(line),
          })
        })
      })

      checksResult.rows.forEach((check) => {
        const txnId = normalizeText(check?.Id, 160) || null
        const txnDocNumber = normalizeQuickBooksDocNumber(check)
        const txnDate = normalizeText(check?.TxnDate, 40) || null
        const lines = Array.isArray(check?.Line) ? check.Line : []

        lines.forEach((line) => {
          const accountId = extractQuickBooksLineAccountRef(line)

          if (!loanAccountsById.has(accountId)) {
            return
          }

          appendLoanMovementDetail({
            accountId,
            txnType: 'check',
            txnId,
            txnDocNumber,
            txnDate,
            amount: line?.Amount,
            direction: 'out',
            description: line?.Description || check?.PrivateNote || check?.Memo || null,
            className: extractQuickBooksLineClassName(line),
          })
        })
      })

      const knownLoanOwnerOrder = new Map(
        quickBooksKnownLoanOwners.map((owner, index) => [owner.key, index]),
      )
      const sortedLoanSummaries = [...loanBucketsById.values()]
        .filter((bucket) => bucket.ownerKey || bucket.accountIds.length > 0)
        .map((bucket) => {
          const effectiveLoanAmount = Math.abs(bucket.totalLoanAmount) > 0.004
            ? normalizeMoney(bucket.totalLoanAmount)
            : normalizeMoney(bucket.movementOutstandingAmount)
          const sortedDetails = [...bucket.details].sort((left, right) => {
            const leftDate = Date.parse(left.txnDate || '')
            const rightDate = Date.parse(right.txnDate || '')

            if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
              return rightDate - leftDate
            }

            return String(left.docNumber || left.id || '').localeCompare(String(right.docNumber || right.id || ''))
          })

          return {
            ...bucket,
            totalLoanAmount: effectiveLoanAmount,
            totalInvestedAmount: normalizeMoney(bucket.totalInvestedAmount),
            totalTakenOutAmount: normalizeMoney(bucket.totalTakenOutAmount),
            details: sortedDetails,
          }
        })
        .sort((left, right) => {
          const leftKnownOrder = left.ownerKey ? knownLoanOwnerOrder.get(left.ownerKey) : undefined
          const rightKnownOrder = right.ownerKey ? knownLoanOwnerOrder.get(right.ownerKey) : undefined

          if (Number.isFinite(leftKnownOrder) && Number.isFinite(rightKnownOrder) && leftKnownOrder !== rightKnownOrder) {
            return Number(leftKnownOrder) - Number(rightKnownOrder)
          }

          if (Number.isFinite(leftKnownOrder) && !Number.isFinite(rightKnownOrder)) {
            return -1
          }

          if (!Number.isFinite(leftKnownOrder) && Number.isFinite(rightKnownOrder)) {
            return 1
          }

          if (right.totalLoanAmount !== left.totalLoanAmount) {
            return right.totalLoanAmount - left.totalLoanAmount
          }

          return left.label.localeCompare(right.label)
        })

      const loanSummaries = sortedLoanSummaries.slice(0, quickBooksMaxLoanBuckets)

      loanSummaries.forEach((bucket) => {
        totals.loanTotalAmount = normalizeMoney(totals.loanTotalAmount + bucket.totalLoanAmount)
        totals.loanInvestedAmount = normalizeMoney(totals.loanInvestedAmount + bucket.totalInvestedAmount)
        totals.loanTakenOutAmount = normalizeMoney(totals.loanTakenOutAmount + bucket.totalTakenOutAmount)
      })
      totals.loanSummaryCount = loanSummaries.length

      const projects = [...projectsById.values()]
        .map((project) => {
          const outstandingAmount = normalizeMoney(project.invoiceAmount - project.paymentAmount)

          return {
            ...project,
            outstandingAmount,
          }
        })
        .sort((left, right) => {
          if (right.invoiceAmount !== left.invoiceAmount) {
            return right.invoiceAmount - left.invoiceAmount
          }

          return left.projectName.localeCompare(right.projectName)
        })

      totals.outstandingAmount = normalizeMoney(totals.invoiceAmount - totals.paymentAmount)

      const warnings = []

      if (customersResult.truncated) {
        warnings.push('Customer/project query was truncated. Increase pagination limits if needed.')
      }

      if (purchaseOrdersResult.truncated || billsResult.truncated || invoicesResult.truncated || paymentsResult.truncated) {
        warnings.push('One or more QuickBooks transaction queries were truncated. Results may be partial.')
      }

      if (
        accountsResult.truncated
        || journalEntriesResult.truncated
        || transfersResult.truncated
        || depositsResult.truncated
        || checksResult.truncated
      ) {
        warnings.push('One or more QuickBooks loan queries were truncated. Loan totals may be partial.')
      }

      if (sortedLoanSummaries.length > loanSummaries.length) {
        warnings.push(
          `Loan summary list capped at ${quickBooksMaxLoanBuckets} buckets to keep the response fast.`,
        )
      }

      const visibleUnlinkedTransactions = unlinkedTransactions.slice(0, quickBooksMaxUnlinkedTransactions)

      if (unlinkedTransactions.length > visibleUnlinkedTransactions.length) {
        warnings.push(
          `Unlinked transaction list capped at ${quickBooksMaxUnlinkedTransactions} rows to keep the response fast.`,
        )
      }

      const capDetails = (rows, label) => {
        const visibleRows = rows.slice(0, quickBooksMaxDetailRowsPerType)

        if (rows.length > visibleRows.length) {
          warnings.push(
            `${label} detail list capped at ${quickBooksMaxDetailRowsPerType} rows to keep the response fast.`,
          )
        }

        return visibleRows
      }

      const visiblePurchaseOrderLineDetails = capDetails(purchaseOrderLineDetails, 'Purchase-order line')
      const visibleBillDetails = capDetails(billDetails, 'Bill')
      const visibleInvoiceDetails = capDetails(invoiceDetails, 'Invoice')
      const visiblePaymentDetails = capDetails(paymentDetails, 'Payment')
      const visibleUnlinkedPurchaseOrderLines = capDetails(
        unlinkedPurchaseOrderLines,
        'Unlinked purchase-order line',
      )
      const visibleLoanSummaries = loanSummaries.map((bucket) => {
        const visibleDetails = bucket.details.slice(0, quickBooksMaxLoanDetailRowsPerBucket)

        if (bucket.details.length > visibleDetails.length) {
          warnings.push(
            `${bucket.label} detail list capped at ${quickBooksMaxLoanDetailRowsPerBucket} rows to keep the response fast.`,
          )
        }

        return {
          ...bucket,
          details: visibleDetails,
        }
      })

      await quickBooksTokensCollection.updateOne(
        { id: quickBooksTokenDocId },
        {
          $set: {
            lastOverviewSyncAt: nowIso(),
          },
        },
      )

      const overviewPayload = {
        generatedAt: nowIso(),
        realmId: normalizeText(tokenDoc.realmId, 160),
        companyInfo,
        totals,
        projects,
        loanSummaries: visibleLoanSummaries,
        unlinkedTransactions: visibleUnlinkedTransactions,
        details: {
          purchaseOrderLines: visiblePurchaseOrderLineDetails,
          bills: visibleBillDetails,
          invoices: visibleInvoiceDetails,
          payments: visiblePaymentDetails,
          unlinkedPurchaseOrderLines: visibleUnlinkedPurchaseOrderLines,
        },
        warnings,
      }

      qbCacheSet(QB_OVERVIEW_CACHE_KEY, overviewPayload, QB_OVERVIEW_CACHE_TTL_MS)

      return res.json(overviewPayload)
    } catch (error) {
      next(error)
    }
  })
}
