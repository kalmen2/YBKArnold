import { AppError } from '../utils/app-error.mjs'

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
    const now = new Date().toISOString()

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
      const now = new Date().toISOString()
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

      const now = new Date().toISOString()

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
              updatedAt: new Date().toISOString(),
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
      ] = await Promise.all([
        queryAllQuickBooksRows(queryFn, 'Customer'),
        queryAllQuickBooksRows(queryFn, 'PurchaseOrder'),
        queryAllQuickBooksRows(queryFn, 'Bill'),
        queryAllQuickBooksRows(queryFn, 'Invoice'),
        queryAllQuickBooksRows(queryFn, 'Payment'),
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

      await quickBooksTokensCollection.updateOne(
        { id: quickBooksTokenDocId },
        {
          $set: {
            lastOverviewSyncAt: new Date().toISOString(),
          },
        },
      )

      return res.json({
        generatedAt: new Date().toISOString(),
        realmId: normalizeText(tokenDoc.realmId, 160),
        companyInfo,
        totals,
        projects,
        unlinkedTransactions: visibleUnlinkedTransactions,
        details: {
          purchaseOrderLines: visiblePurchaseOrderLineDetails,
          bills: visibleBillDetails,
          invoices: visibleInvoiceDetails,
          payments: visiblePaymentDetails,
          unlinkedPurchaseOrderLines: visibleUnlinkedPurchaseOrderLines,
        },
        warnings,
      })
    } catch (error) {
      next(error)
    }
  })
}
