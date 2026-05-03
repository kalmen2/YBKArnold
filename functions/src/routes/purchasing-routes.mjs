const quickBooksTokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const quickBooksApiBaseUrlDefault = 'https://quickbooks.api.intuit.com'
const quickBooksTokenDocId = 'primary'
const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
const quickBooksBillPageSize = 200
const quickBooksMaxBillPages = 30
const purchasingSyncSnapshotKey = 'purchasing_qbo_sync'
const purchasingPhotosPrefix = 'purchasing-item-photos'
const maxPurchasingPhotoBytes = 8 * 1024 * 1024
const purchasingAiDeliveryLocation = 'United States (USA)'
const purchasingAiSearchUrl = 'https://html.duckduckgo.com/html/'
const purchasingAiMaxSearchCandidates = 12

let quickBooksIndexesPromise

function createHttpError(message, status = 500) {
  const error = new Error(message)
  error.status = status
  return error
}

function normalizeText(value, maxLength = 400) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function toMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeQuickBooksString(value) {
  return String(value ?? '').replace(/'/g, "\\'")
}

function normalizeHttpUrl(rawValue) {
  const raw = String(rawValue ?? '').trim()

  if (!raw) {
    return null
  }

  try {
    const parsed = new URL(raw)

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x3A;/gi, ':')
}

function stripHtmlToText(value, maxLength = 3000) {
  const withoutTags = String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  const normalized = decodeHtmlEntities(withoutTags)
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.slice(0, maxLength)
}

function resolveDuckDuckGoResultUrl(rawHref) {
  const href = decodeHtmlEntities(rawHref).trim()

  if (!href) {
    return null
  }

  const normalizedHref = href.startsWith('//')
    ? `https:${href}`
    : /^duckduckgo\.com\//i.test(href)
      ? `https://${href}`
      : href

  if (/^\/l\/\?/i.test(normalizedHref) || /^https?:\/\/duckduckgo\.com\/l\/\?/i.test(normalizedHref)) {
    const redirectUrl = normalizedHref.startsWith('http')
      ? normalizedHref
      : `https://duckduckgo.com${normalizedHref.startsWith('/') ? normalizedHref : `/${normalizedHref}`}`

    try {
      const parsedRedirectUrl = new URL(redirectUrl)
      const targetUrl = parsedRedirectUrl.searchParams.get('uddg')

      return normalizeHttpUrl(targetUrl)
    } catch {
      return null
    }
  }

  return normalizeHttpUrl(normalizedHref)
}

function extractDuckDuckGoSearchCandidates(searchHtml, maxResults = purchasingAiMaxSearchCandidates) {
  const html = String(searchHtml ?? '')
  const linkPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetPattern = /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi
  const candidates = []
  const seenUrls = new Set()
  const snippets = []
  let snippetMatch = snippetPattern.exec(html)

  while (snippetMatch) {
    snippets.push(stripHtmlToText(snippetMatch[1], 420))
    snippetMatch = snippetPattern.exec(html)
  }

  let linkIndex = 0
  let match = linkPattern.exec(html)

  while (match && candidates.length < maxResults) {
    const url = resolveDuckDuckGoResultUrl(match[1])
    const title = stripHtmlToText(match[2], 260)
    const snippet = normalizeText(snippets[linkIndex], 420)

    if (url && !seenUrls.has(url)) {
      seenUrls.add(url)
      candidates.push({
        url,
        title,
        snippet,
      })
    }

    linkIndex += 1
    match = linkPattern.exec(html)
  }

  return candidates
}

function resolvePurchasingAiPriceBand(optionPrice, referencePrice) {
  const optionAmount = Number(optionPrice)
  const referenceAmount = Number(referencePrice)

  if (!Number.isFinite(optionAmount) || optionAmount <= 0 || !Number.isFinite(referenceAmount) || referenceAmount <= 0) {
    return {
      status: 'yellow',
      deltaPercent: null,
      thresholdPercent: null,
    }
  }

  const deltaPercent = Number((((optionAmount - referenceAmount) / referenceAmount) * 100).toFixed(2))

  if (optionAmount <= referenceAmount) {
    return {
      status: 'green',
      deltaPercent,
      thresholdPercent: 0,
    }
  }

  const thresholdPercent = referenceAmount < 100 ? 3 : 1
  const yellowCeiling = referenceAmount * (1 + thresholdPercent / 100)

  if (optionAmount <= yellowCeiling) {
    return {
      status: 'yellow',
      deltaPercent,
      thresholdPercent,
    }
  }

  return {
    status: 'red',
    deltaPercent,
    thresholdPercent,
  }
}

function uniqueTextList(values, maxItems = 12) {
  const seen = new Set()
  const result = []

  for (const value of values) {
    const normalized = normalizeText(value, 320)

    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(normalized)

    if (result.length >= maxItems) {
      break
    }
  }

  return result
}

function normalizePurchasingItemSearchToken(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[()]/g, ' ')
    .replace(/[_,]+/g, ' ')
    .replace(/\b(\d+)P(\d+)\b/gi, '$1.$2')
    .replace(/([0-9])X([0-9])/gi, '$1 x $2')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildPurchasingAiSearchProfile(itemName) {
  const raw = normalizeText(itemName, 320)
  const parentheticalMatches = [...raw.matchAll(/\(([^()]{2,})\)/g)]
  const parentheticalDescriptor = normalizePurchasingItemSearchToken(
    parentheticalMatches.at(-1)?.[1] ?? '',
  )
  const withoutParentheses = normalizePurchasingItemSearchToken(raw.replace(/\([^)]*\)/g, ' '))
  const normalizedRaw = normalizePurchasingItemSearchToken(raw)
  const preferredDescriptor = parentheticalDescriptor || withoutParentheses || normalizedRaw
  const tokenSource = `${preferredDescriptor} ${withoutParentheses}`.toLowerCase()
  const allTokens = tokenSource
    .split(/[^a-z0-9./]+/gi)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
  const dimensionTokens = allTokens.filter((token) => /^(\d+(?:\.\d+)?|\d+\/\d+|x)$/.test(token))
  const materialTokens = allTokens.filter((token) =>
    /^[a-z]{2,}$/.test(token)
    && !['the', 'and', 'for', 'with', 'panel', 'sheet'].includes(token))
  const keyTerms = uniqueTextList([
    ...materialTokens,
    ...dimensionTokens,
  ], 14)
  const compactDescriptor = uniqueTextList([
    preferredDescriptor,
    withoutParentheses,
    normalizedRaw,
    keyTerms.join(' '),
  ], 4)
    .join(' ')
    .slice(0, 220)

  const queryCandidates = uniqueTextList([
    `${preferredDescriptor} buy price`,
    `${preferredDescriptor} supplier`,
    `${preferredDescriptor} supplier usa`,
    `${compactDescriptor} buy price`,
    `${compactDescriptor} ships in united states`,
    `${uniqueTextList(materialTokens, 6).join(' ')} ${uniqueTextList(dimensionTokens, 6).join(' ')} panel price`,
  ], 6)

  return {
    original: raw,
    preferredDescriptor,
    keyTerms,
    queries: queryCandidates,
  }
}

function normalizeQuickBooksApiBaseUrl(value) {
  const normalized = normalizeText(value, 400)

  if (!normalized) {
    return quickBooksApiBaseUrlDefault
  }

  return normalized.replace(/\/$/, '')
}

function parseDateOnly(value) {
  const raw = normalizeText(value, 80)

  if (!raw) {
    return null
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)

  if (usMatch) {
    const month = usMatch[1].padStart(2, '0')
    const day = usMatch[2].padStart(2, '0')
    let year = usMatch[3]

    if (year.length === 2) {
      year = `20${year}`
    }

    return `${year}-${month}-${day}`
  }

  const parsed = Date.parse(raw)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return new Date(parsed).toISOString().slice(0, 10)
}

function isExpiredAt(isoTimestamp, skewMs = 0) {
  const timestampMs = Date.parse(normalizeText(isoTimestamp, 80))

  if (!Number.isFinite(timestampMs)) {
    return true
  }

  return Date.now() >= timestampMs - skewMs
}

function toIsoTimeFromNow(secondsFromNow) {
  const seconds = Number(secondsFromNow)

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return new Date(Date.now() + seconds * 1000).toISOString()
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

function maxIsoTimestamp(left, right) {
  const leftMs = Date.parse(normalizeText(left, 80))
  const rightMs = Date.parse(normalizeText(right, 80))

  if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
    return null
  }

  if (!Number.isFinite(leftMs)) {
    return normalizeText(right, 80) || null
  }

  if (!Number.isFinite(rightMs)) {
    return normalizeText(left, 80) || null
  }

  return rightMs > leftMs ? normalizeText(right, 80) : normalizeText(left, 80)
}

function isSpendTransaction(type) {
  const normalized = normalizeText(type, 80)

  return [
    'Item Receipt',
    'Bill',
    'Check',
    'Credit Card Charge',
    'Purchase',
  ].includes(normalized)
}

function normalizeBillLineDetail(line) {
  if (!line || typeof line !== 'object') {
    return null
  }

  if (line.ItemBasedExpenseLineDetail && typeof line.ItemBasedExpenseLineDetail === 'object') {
    return line.ItemBasedExpenseLineDetail
  }

  if (line.AccountBasedExpenseLineDetail && typeof line.AccountBasedExpenseLineDetail === 'object') {
    return line.AccountBasedExpenseLineDetail
  }

  return null
}

async function exchangeQuickBooksToken({
  clientId,
  clientSecret,
  grantType,
  refreshToken,
}) {
  const encodedAuthToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const formData = new URLSearchParams()
  formData.set('grant_type', grantType)
  formData.set('refresh_token', normalizeText(refreshToken, 8000))

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
    throw createHttpError(
      `QuickBooks token refresh failed: ${resolveQuickBooksErrorMessage(payload, `status ${response.status}`)}`,
      502,
    )
  }

  return payload
}

export function registerPurchasingRoutes(app, deps) {
  const {
    decodeBase64Image,
    findExactItemPurchaseOptions,
    getCollections,
    getOrderPhotosBucket,
    isSupportedPhotoMimeType,
    randomUUID,
    resolvePurchasingItemSearchMatches,
    requireFirebaseAuth,
  } = deps

  const purchasingItemSummaryProjection = {
    _id: 0,
    itemKey: 1,
    itemRaw: 1,
    descriptions: 1,
    totalSpent: 1,
    totalQty: 1,
    transactionCount: 1,
    vendorCount: 1,
    vendorRaws: 1,
    firstPurchaseDate: 1,
    lastPurchaseDate: 1,
  }

  async function getQuickBooksCollections() {
    const { database } = await getCollections()
    const quickBooksTokensCollection = database.collection('quickbooks_oauth_tokens')

    if (!quickBooksIndexesPromise) {
      quickBooksIndexesPromise = quickBooksTokensCollection
        .createIndex({ id: 1 }, { unique: true })
        .catch((error) => {
          quickBooksIndexesPromise = undefined
          throw error
        })
    }

    await quickBooksIndexesPromise

    return { quickBooksTokensCollection }
  }

  function getQuickBooksConfig() {
    const clientId = normalizeText(process.env.QUICKBOOKS_CLIENT_ID, 300)
    const clientSecret = normalizeText(process.env.QUICKBOOKS_CLIENT_SECRET, 300)
    const configuredApiBaseUrl = normalizeText(process.env.QUICKBOOKS_API_BASE_URL, 400)

    if (!clientId || !clientSecret) {
      throw createHttpError(
        'QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
        500,
      )
    }

    return {
      clientId,
      clientSecret,
      apiBaseUrl: normalizeQuickBooksApiBaseUrl(configuredApiBaseUrl || quickBooksApiBaseUrlDefault),
    }
  }

  async function refreshQuickBooksAccessToken({
    quickBooksTokensCollection,
    tokenDoc,
    clientId,
    clientSecret,
  }) {
    if (!tokenDoc?.refreshToken) {
      throw createHttpError('QuickBooks is not connected yet. Connect QuickBooks first.', 409)
    }

    if (isExpiredAt(tokenDoc.refreshTokenExpiresAt)) {
      throw createHttpError('QuickBooks refresh token expired. Reconnect QuickBooks.', 401)
    }

    const refreshPayload = await exchangeQuickBooksToken({
      clientId,
      clientSecret,
      grantType: 'refresh_token',
      refreshToken: tokenDoc.refreshToken,
    })

    const accessToken = normalizeText(refreshPayload?.access_token, 8000)
    const refreshToken = normalizeText(refreshPayload?.refresh_token, 8000)

    if (!accessToken || !refreshToken) {
      throw createHttpError('QuickBooks token response is missing required fields.', 502)
    }

    const now = new Date().toISOString()
    const normalizedToken = {
      ...tokenDoc,
      accessToken,
      refreshToken,
      tokenType: normalizeText(refreshPayload?.token_type, 40) || 'bearer',
      accessTokenExpiresAt: toIsoTimeFromNow(refreshPayload?.expires_in),
      refreshTokenExpiresAt:
        toIsoTimeFromNow(refreshPayload?.x_refresh_token_expires_in)
        ?? tokenDoc?.refreshTokenExpiresAt
        ?? null,
      updatedAt: now,
      lastRefreshAt: now,
    }

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

    return normalizedToken
  }

  async function resolveQuickBooksAccessToken({
    quickBooksTokensCollection,
    clientId,
    clientSecret,
    forceRefresh,
  }) {
    const tokenDoc = await quickBooksTokensCollection.findOne({ id: quickBooksTokenDocId })

    if (!tokenDoc) {
      throw createHttpError('QuickBooks is not connected yet. Connect QuickBooks first.', 409)
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
      throw createHttpError('QuickBooks access token is no longer valid.', 401)
    }

    if (!response.ok) {
      const bodySummary = normalizeText(String(responseText || '').replace(/\s+/g, ' '), 300)
      const fallbackMessage = bodySummary
        ? `status ${response.status} (${bodySummary})`
        : `status ${response.status}`
      throw createHttpError(
        `QuickBooks query failed: ${resolveQuickBooksErrorMessage(payload, fallbackMessage)}`,
        response.status,
      )
    }

    return payload
  }

  async function queryIncrementalQuickBooksBills({ queryFn, lastUpdatedCursor }) {
    const bills = []
    let startPosition = 1
    const filterCursor = normalizeText(lastUpdatedCursor, 80) || null
    let maxUpdatedAt = normalizeText(lastUpdatedCursor, 80) || null
    let truncated = false

    for (let page = 0; page < quickBooksMaxBillPages; page += 1) {
      const whereClause = filterCursor
        ? ` WHERE MetaData.LastUpdatedTime >= '${escapeQuickBooksString(filterCursor)}'`
        : ''
      const query = `SELECT * FROM Bill${whereClause} ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${startPosition} MAXRESULTS ${quickBooksBillPageSize}`
      const payload = await queryFn(query)
      const rows = Array.isArray(payload?.QueryResponse?.Bill)
        ? payload.QueryResponse.Bill
        : []

      rows.forEach((bill) => {
        maxUpdatedAt = maxIsoTimestamp(maxUpdatedAt, bill?.MetaData?.LastUpdatedTime)
      })

      bills.push(...rows)

      if (rows.length < quickBooksBillPageSize) {
        return {
          bills,
          truncated,
          maxUpdatedAt,
        }
      }

      startPosition += quickBooksBillPageSize
    }

    truncated = true

    return {
      bills,
      truncated,
      maxUpdatedAt,
    }
  }

  function extractLinkedPurchaseOrderNumber(bill) {
    const linkedTransactions = Array.isArray(bill?.LinkedTxn) ? bill.LinkedTxn : []
    const purchaseOrderLink = linkedTransactions.find((linkedTxn) =>
      normalizeText(linkedTxn?.TxnType, 80).toLowerCase() === 'purchaseorder')

    return normalizeText(purchaseOrderLink?.TxnId, 160) || null
  }

  function buildQuickBooksBillLineTransactions(bill) {
    const billId = normalizeText(bill?.Id, 160)

    if (!billId) {
      return []
    }

    const billDate = parseDateOnly(bill?.TxnDate)
    const billUpdatedAt = normalizeText(bill?.MetaData?.LastUpdatedTime, 80) || null
    const billDocNumber = normalizeText(bill?.DocNumber, 160) || null
    const vendorRaw =
      extractQuickBooksRefName(bill?.VendorRef)
      || extractQuickBooksRefValue(bill?.VendorRef)
      || null
    const poNumber = extractLinkedPurchaseOrderNumber(bill)
    const memo =
      normalizeText(bill?.PrivateNote, 600)
      || normalizeText(bill?.Memo, 600)
      || null
    const lines = Array.isArray(bill?.Line) && bill.Line.length > 0
      ? bill.Line
      : [
          {
            Id: 'summary',
            Amount: bill?.TotalAmt,
            Description: normalizeText(bill?.PrivateNote, 320) || 'QuickBooks bill line summary',
          },
        ]

    return lines
      .map((line, index) => {
        const lineDetail = normalizeBillLineDetail(line)
        const itemRaw =
          normalizeText(lineDetail?.ItemRef?.name, 260)
          || normalizeText(line?.Description, 320)
          || normalizeText(lineDetail?.AccountRef?.name, 260)
          || normalizeText(lineDetail?.AccountRef?.value, 160)
          || `Bill ${billId} line ${index + 1}`
        const itemDescription =
          normalizeText(line?.Description, 320)
          || normalizeText(lineDetail?.ItemRef?.name, 260)
          || normalizeText(lineDetail?.AccountRef?.name, 260)
          || null
        const itemKey = normKey(itemRaw)

        if (!itemKey) {
          return null
        }

        const amount = toMoney(line?.Amount)
        const qtyFromLine = Number(lineDetail?.Qty)
        const qty = Number.isFinite(qtyFromLine) && qtyFromLine > 0
          ? qtyFromLine
          : amount !== 0
            ? 1
            : 0
        const unitPriceFromLine = Number(lineDetail?.UnitPrice)
        const unitCost = Number.isFinite(unitPriceFromLine) && unitPriceFromLine > 0
          ? Number(unitPriceFromLine.toFixed(4))
          : qty > 0
            ? Number((amount / qty).toFixed(4))
            : 0
        const vendorKey = normKey(vendorRaw) || 'unknown'
        const lineId = normalizeText(line?.Id, 120) || String(index + 1)
        const id = `qbo_bill:${billId}:line:${lineId}`

        return {
          id,
          source: 'qbo_online',
          type: 'Bill',
          date: billDate,
          poDate: null,
          poNumber,
          transNumber: billDocNumber,
          itemKey,
          itemRaw,
          itemDescription,
          vendorKey,
          vendorRaw,
          qty,
          unitCost,
          amount,
          memo,
          shipDate: null,
          delivDate: null,
          shipDays: null,
          quickBooksBillId: billId,
          quickBooksLineId: lineId,
          quickBooksUpdatedAt: billUpdatedAt,
          updatedAt: new Date().toISOString(),
        }
      })
      .filter(Boolean)
  }

  async function upsertPurchasingTransactions(transactions, purchasingTransactionsCollection) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
      }
    }

    const chunkSize = 500
    const now = new Date().toISOString()
    let insertedCount = 0
    let updatedCount = 0

    for (let i = 0; i < transactions.length; i += chunkSize) {
      const chunk = transactions.slice(i, i + chunkSize)
      const operations = chunk.map((transaction) => ({
        updateOne: {
          filter: { id: transaction.id },
          update: {
            $set: {
              ...transaction,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        },
      }))

      const writeResult = await purchasingTransactionsCollection.bulkWrite(operations, {
        ordered: false,
      })

      insertedCount += Number(writeResult?.upsertedCount ?? 0)
      updatedCount += Number(writeResult?.modifiedCount ?? 0)
    }

    return {
      insertedCount,
      updatedCount,
    }
  }

  async function rebuildPurchasingItemsForKeys({
    itemKeys,
    purchasingItemsCollection,
    purchasingTransactionsCollection,
  }) {
    const uniqueItemKeys = [...new Set((Array.isArray(itemKeys) ? itemKeys : []).filter(Boolean))]

    if (uniqueItemKeys.length === 0) {
      return {
        rebuiltCount: 0,
      }
    }

    let rebuiltCount = 0

    for (const itemKey of uniqueItemKeys) {
      const transactions = await purchasingTransactionsCollection
        .find(
          { itemKey },
          {
            projection: {
              _id: 0,
              type: 1,
              date: 1,
              itemRaw: 1,
              itemDescription: 1,
              vendorRaw: 1,
              vendorKey: 1,
              qty: 1,
              amount: 1,
            },
          },
        )
        .toArray()

      if (!transactions.length) {
        continue
      }

      const descriptions = new Set()
      const vendorRaws = new Set()
      const vendorKeys = new Set()
      let itemRaw = ''
      let totalSpent = 0
      let totalQty = 0
      let firstPurchaseDate = null
      let lastPurchaseDate = null

      transactions.forEach((transaction) => {
        const txItemRaw = normalizeText(transaction?.itemRaw, 320)
        const txDescription = normalizeText(transaction?.itemDescription, 320)
        const txVendorRaw = normalizeText(transaction?.vendorRaw, 260)
        const txVendorKey = normalizeText(transaction?.vendorKey, 260)
        const txDate = parseDateOnly(transaction?.date)
        const txAmount = toNumber(transaction?.amount)
        const txQty = toNumber(transaction?.qty)

        if (txItemRaw && txItemRaw.length > itemRaw.length) {
          itemRaw = txItemRaw
        }

        if (txDescription) {
          descriptions.add(txDescription)
        }

        if (txVendorRaw) {
          vendorRaws.add(txVendorRaw)
        }

        if (txVendorKey) {
          vendorKeys.add(txVendorKey)
        }

        if (isSpendTransaction(transaction?.type)) {
          totalSpent = toMoney(totalSpent + txAmount)
          totalQty = toNumber(totalQty + txQty)
        }

        if (txDate) {
          if (!firstPurchaseDate || txDate < firstPurchaseDate) {
            firstPurchaseDate = txDate
          }

          if (!lastPurchaseDate || txDate > lastPurchaseDate) {
            lastPurchaseDate = txDate
          }
        }
      })

      await purchasingItemsCollection.updateOne(
        { itemKey },
        {
          $set: {
            itemKey,
            itemRaw: itemRaw || itemKey,
            descriptions: [...descriptions].slice(0, 20),
            vendorRaws: [...vendorRaws],
            vendorKeys: [...vendorKeys],
            vendorCount: vendorKeys.size,
            totalSpent,
            totalQty: Number(totalQty.toFixed(3)),
            transactionCount: transactions.length,
            firstPurchaseDate,
            lastPurchaseDate,
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: {
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      )

      rebuiltCount += 1
    }

    return {
      rebuiltCount,
    }
  }

  async function getPurchasingSyncSnapshot(dashboardSnapshotsCollection) {
    const snapshotDocument = await dashboardSnapshotsCollection.findOne(
      { snapshotKey: purchasingSyncSnapshotKey },
      {
        projection: {
          _id: 0,
          snapshot: 1,
        },
      },
    )

    return snapshotDocument?.snapshot ?? null
  }

  async function setPurchasingSyncSnapshot(dashboardSnapshotsCollection, snapshot) {
    await dashboardSnapshotsCollection.updateOne(
      { snapshotKey: purchasingSyncSnapshotKey },
      {
        $set: {
          snapshotKey: purchasingSyncSnapshotKey,
          snapshot,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    )
  }

  async function syncPurchasingFromQuickBooks({ force = false } = {}) {
    const syncStartedAt = new Date().toISOString()
    const {
      dashboardSnapshotsCollection,
      purchasingItemsCollection,
      purchasingTransactionsCollection,
    } = await getCollections()
    const previousSnapshot = await getPurchasingSyncSnapshot(dashboardSnapshotsCollection)

    try {
      const quickBooksConfig = getQuickBooksConfig()
      const { quickBooksTokensCollection } = await getQuickBooksCollections()
      let tokenDoc = await resolveQuickBooksAccessToken({
        quickBooksTokensCollection,
        clientId: quickBooksConfig.clientId,
        clientSecret: quickBooksConfig.clientSecret,
        forceRefresh: false,
      })
      const realmId = normalizeText(tokenDoc?.realmId, 160)

      if (!realmId) {
        throw createHttpError('QuickBooks connection is missing realm ID. Reconnect QuickBooks.', 409)
      }

      const resolveQuery = (queryText) => quickBooksQuery({
        apiBaseUrl: quickBooksConfig.apiBaseUrl,
        realmId,
        accessToken: tokenDoc.accessToken,
        query: queryText,
      })

      const queryFn = async (queryText) => {
        try {
          return await resolveQuery(queryText)
        } catch (error) {
          if (Number(error?.status) !== 401) {
            throw error
          }

          tokenDoc = await resolveQuickBooksAccessToken({
            quickBooksTokensCollection,
            clientId: quickBooksConfig.clientId,
            clientSecret: quickBooksConfig.clientSecret,
            forceRefresh: true,
          })

          return resolveQuery(queryText)
        }
      }

      const lastUpdatedCursor = force
        ? null
        : normalizeText(previousSnapshot?.lastQuickBooksBillUpdatedAt, 80) || null
      const previousCursorBillIds = force
        ? new Set()
        : new Set(
            (Array.isArray(previousSnapshot?.lastQuickBooksBillIdsAtCursor)
              ? previousSnapshot.lastQuickBooksBillIdsAtCursor
              : [])
              .map((billId) => normalizeText(billId, 160))
              .filter(Boolean),
          )
      const billQueryResult = await queryIncrementalQuickBooksBills({
        queryFn,
        lastUpdatedCursor,
      })
      const filteredBills = billQueryResult.bills.filter((bill) => {
        if (!lastUpdatedCursor) {
          return true
        }

        const billUpdatedAt = normalizeText(bill?.MetaData?.LastUpdatedTime, 80)
        const billId = normalizeText(bill?.Id, 160)

        if (!billUpdatedAt || !billId) {
          return true
        }

        if (billUpdatedAt !== lastUpdatedCursor) {
          return true
        }

        return !previousCursorBillIds.has(billId)
      })
      const transactions = filteredBills.flatMap((bill) =>
        buildQuickBooksBillLineTransactions(bill))
      const touchedItemKeys = [...new Set(transactions.map((transaction) => transaction.itemKey).filter(Boolean))]
      const transactionWriteSummary = await upsertPurchasingTransactions(
        transactions,
        purchasingTransactionsCollection,
      )
      const itemRebuildSummary = await rebuildPurchasingItemsForKeys({
        itemKeys: touchedItemKeys,
        purchasingItemsCollection,
        purchasingTransactionsCollection,
      })
      const syncFinishedAt = new Date().toISOString()
      const nextCursor =
        billQueryResult.maxUpdatedAt
        || normalizeText(previousSnapshot?.lastQuickBooksBillUpdatedAt, 80)
        || null
      const nextCursorBillIds = new Set(
        billQueryResult.bills
          .filter((bill) => normalizeText(bill?.MetaData?.LastUpdatedTime, 80) === nextCursor)
          .map((bill) => normalizeText(bill?.Id, 160))
          .filter(Boolean),
      )

      if (nextCursor && nextCursor === lastUpdatedCursor) {
        previousCursorBillIds.forEach((billId) => {
          nextCursorBillIds.add(billId)
        })
      }

      const nextSnapshot = {
        source: 'quickbooks_online',
        lastAttemptedRefreshAt: syncStartedAt,
        lastSuccessfulRefreshAt: syncFinishedAt,
        lastQuickBooksBillUpdatedAt: nextCursor,
        lastQuickBooksBillIdsAtCursor: [...nextCursorBillIds].slice(0, 5000),
        billCountFetched: filteredBills.length,
        lineCountFetched: transactions.length,
        newTransactionCount: transactionWriteSummary.insertedCount,
        updatedTransactionCount: transactionWriteSummary.updatedCount,
        touchedItemCount: touchedItemKeys.length,
        rebuiltItemCount: itemRebuildSummary.rebuiltCount,
        truncated: Boolean(billQueryResult.truncated),
        lastErrorMessage: null,
        lastErrorAt: null,
      }

      await setPurchasingSyncSnapshot(dashboardSnapshotsCollection, nextSnapshot)

      return nextSnapshot
    } catch (error) {
      const failureMessage = normalizeText(error?.message || error?.details, 900)
        || 'QuickBooks purchasing sync failed.'
      const failedSnapshot = {
        ...previousSnapshot,
        source: 'quickbooks_online',
        lastAttemptedRefreshAt: syncStartedAt,
        lastErrorMessage: failureMessage,
        lastErrorAt: new Date().toISOString(),
      }

      await setPurchasingSyncSnapshot(dashboardSnapshotsCollection, failedSnapshot)

      throw createHttpError(failureMessage, Number(error?.status) || 500)
    }
  }

  function resolvePurchasingItemKey(req) {
    const rawKey = req.query?.key ?? req.body?.key ?? req.params?.itemKey ?? ''

    return normKey(rawKey)
  }

  function buildPurchasingItemPhotoPrefix(itemKey) {
    const encodedItemKey = Buffer
      .from(String(itemKey ?? ''), 'utf8')
      .toString('base64url')

    return `${purchasingPhotosPrefix}/${encodedItemKey}/`
  }

  function extensionForPurchasingPhotoMimeType(mimeType) {
    const normalized = String(mimeType ?? '').trim().toLowerCase()

    switch (normalized) {
      case 'image/png':
        return 'png'
      case 'image/webp':
        return 'webp'
      case 'image/heic':
        return 'heic'
      case 'image/heif':
        return 'heif'
      default:
        return 'jpg'
    }
  }

  function extractPurchasingPhotoTimestampMs(path) {
    const fileName = String(path ?? '').split('/').pop() ?? ''
    const leadingPart = fileName.split('-')[0]
    const parsed = Number(leadingPart)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null
    }

    return parsed
  }

  function buildFirebaseStorageDownloadUrl(bucketName, objectPath, downloadToken) {
    const encodedObjectPath = encodeURIComponent(String(objectPath ?? '').trim())
    const encodedToken = encodeURIComponent(String(downloadToken ?? '').trim())

    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedObjectPath}?alt=media&token=${encodedToken}`
  }

  async function buildPurchasingItemPhotoRecord(file, bucketName) {
    const timestampMs = extractPurchasingPhotoTimestampMs(file.name) ?? Date.now()
    const [metadata] = await file.getMetadata()
    const tokenList = String(metadata?.metadata?.firebaseStorageDownloadTokens ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    let downloadToken = tokenList[0] ?? null

    if (!downloadToken) {
      downloadToken = randomUUID()
      await file.setMetadata({
        metadata: {
          ...(metadata?.metadata ?? {}),
          firebaseStorageDownloadTokens: downloadToken,
        },
      })
    }

    const url = buildFirebaseStorageDownloadUrl(bucketName, file.name, downloadToken)

    return {
      path: file.name,
      url,
      createdAt: new Date(timestampMs).toISOString(),
    }
  }

  async function listPurchasingItemPhotoRecords(itemKey) {
    const prefix = buildPurchasingItemPhotoPrefix(itemKey)
    const bucket = getOrderPhotosBucket()
    const [files] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      maxResults: 200,
    })
    const usableFiles = files.filter((file) => file?.name && !file.name.endsWith('/'))
    const photoRecords = await Promise.all(
      usableFiles.map((file) => buildPurchasingItemPhotoRecord(file, bucket.name)),
    )

    return photoRecords.sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
  }

  async function savePurchasingItemPhotoRecord(itemKey, imageBuffer, mimeType) {
    const timestampMs = Date.now()
    const extension = extensionForPurchasingPhotoMimeType(mimeType)
    const objectPath = `${buildPurchasingItemPhotoPrefix(itemKey)}${timestampMs}-${randomUUID()}.${extension}`
    const downloadToken = randomUUID()
    const bucket = getOrderPhotosBucket()
    const file = bucket.file(objectPath)

    await file.save(imageBuffer, {
      resumable: false,
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          purchasingItemKey: itemKey,
          uploadedAt: new Date(timestampMs).toISOString(),
        },
      },
    })

    return buildPurchasingItemPhotoRecord(file, bucket.name)
  }

  function normalizePurchasingItemPhotoPath(itemKey, rawPath) {
    const normalizedPath = String(rawPath ?? '').trim().replace(/^\/+/, '')

    if (!normalizedPath) {
      return null
    }

    const expectedPrefix = buildPurchasingItemPhotoPrefix(itemKey)

    if (!normalizedPath.startsWith(expectedPrefix) || normalizedPath.includes('..')) {
      return null
    }

    return normalizedPath
  }

  function buildPurchasingItemPhotoDownloadFileName(itemKey, path) {
    const sourceFileName = String(path ?? '').split('/').pop() ?? ''
    const safeSourceFileName = sourceFileName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')

    if (safeSourceFileName) {
      return safeSourceFileName
    }

    const safeItemKey = String(itemKey ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 80)

    return `purchasing-${safeItemKey || 'item'}-image.jpg`
  }

  async function deletePurchasingItemPhotoRecord(itemKey, path) {
    const normalizedPath = normalizePurchasingItemPhotoPath(itemKey, path)

    if (!normalizedPath) {
      return false
    }

    const bucket = getOrderPhotosBucket()
    const file = bucket.file(normalizedPath)
    const [exists] = await file.exists()

    if (!exists) {
      return false
    }

    await file.delete()

    return true
  }

  async function fetchPurchasingAiSearchCandidates(itemName) {
    const profile = buildPurchasingAiSearchProfile(itemName)
    const seenUrls = new Set()
    const mergedCandidates = []
    let hadSearchAttempt = false

    for (const searchQuery of profile.queries) {
      if (mergedCandidates.length >= purchasingAiMaxSearchCandidates) {
        break
      }

      const searchEndpoint = `${purchasingAiSearchUrl}?q=${encodeURIComponent(searchQuery)}`

      try {
        const response = await fetch(searchEndpoint, {
          method: 'GET',
          headers: {
            Accept: 'text/html',
            'User-Agent': 'ArnoldApi/1.0 (+purchasing-ai-search)',
          },
          signal: AbortSignal.timeout(14000),
        })

        hadSearchAttempt = true

        if (!response.ok) {
          continue
        }

        const searchHtml = await response.text()
        const queryCandidates = extractDuckDuckGoSearchCandidates(searchHtml, purchasingAiMaxSearchCandidates)

        for (const candidate of queryCandidates) {
          const candidateUrl = normalizeText(candidate?.url, 1200)

          if (!candidateUrl || seenUrls.has(candidateUrl)) {
            continue
          }

          seenUrls.add(candidateUrl)
          mergedCandidates.push({
            ...candidate,
            sourceQuery: searchQuery,
          })

          if (mergedCandidates.length >= purchasingAiMaxSearchCandidates) {
            break
          }
        }
      } catch {
        // Continue to next query variation; one failed search should not block sourcing.
      }
    }

    if (!hadSearchAttempt) {
      throw createHttpError('Could not run supplier web search at this time.', 502)
    }

    return {
      profile,
      candidates: mergedCandidates,
    }
  }

  async function fetchPurchasingAiCandidatePreview(candidate) {
    const fallbackCandidate = {
      url: String(candidate?.url ?? '').trim(),
      title: normalizeText(candidate?.title, 260),
      snippet: normalizeText(candidate?.snippet, 500),
      pageExcerpt: '',
    }

    if (!fallbackCandidate.url) {
      return null
    }

    try {
      const response = await fetch(fallbackCandidate.url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'ArnoldApi/1.0 (+purchasing-ai-search)',
        },
        signal: AbortSignal.timeout(12000),
      })

      if (!response.ok) {
        return fallbackCandidate
      }

      const pageHtml = (await response.text()).slice(0, 260000)
      const titleMatch = pageHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const metaDescriptionMatch = pageHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i)
      const pageText = stripHtmlToText(pageHtml, 3200)

      return {
        url: fallbackCandidate.url,
        title: normalizeText(titleMatch?.[1], 260) || fallbackCandidate.title,
        snippet: normalizeText(metaDescriptionMatch?.[1], 500) || fallbackCandidate.snippet,
        pageExcerpt: pageText,
      }
    } catch {
      return fallbackCandidate
    }
  }

  async function resolvePurchasingAiSearchInput(req) {
    const itemKey = resolvePurchasingItemKey(req)
    const requestedItemName = normalizeText(req.body?.itemName, 260)
    const requestedReferencePrice = Number(req.body?.referencePrice)
    let itemName = requestedItemName
    let referencePrice = Number.isFinite(requestedReferencePrice) && requestedReferencePrice > 0
      ? Number(requestedReferencePrice.toFixed(2))
      : null

    if (!itemKey) {
      return {
        itemKey: null,
        itemName,
        referencePrice,
      }
    }

    const { purchasingItemsCollection } = await getCollections()
    const item = await purchasingItemsCollection.findOne(
      { itemKey },
      {
        projection: {
          _id: 0,
          itemRaw: 1,
          totalSpent: 1,
          totalQty: 1,
        },
      },
    )

    if (!item && !itemName) {
      throw createHttpError('Item not found.', 404)
    }

    if (!itemName) {
      itemName = normalizeText(item?.itemRaw, 260)
    }

    if (!referencePrice) {
      const totalSpent = Number(item?.totalSpent)
      const totalQty = Number(item?.totalQty)

      if (Number.isFinite(totalSpent) && Number.isFinite(totalQty) && totalQty > 0) {
        referencePrice = Number((totalSpent / totalQty).toFixed(2))
      }
    }

    return {
      itemKey,
      itemName,
      referencePrice,
    }
  }

  async function fetchPurchasingSearchAiCandidates({
    search,
    purchasingItemsCollection,
    maxCandidates = 180,
  }) {
    const normalizedSearch = normalizePurchasingItemSearchToken(search).toLowerCase()
    const searchTokens = normalizedSearch
      .split(/[^a-z0-9./]+/gi)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 4)
    const resolvedLimit = Math.min(Math.max(Number(maxCandidates) || 180, 30), 260)
    const candidateByItemKey = new Map()

    async function mergeCandidateQuery(cursor) {
      const rows = await cursor.toArray()

      for (const row of rows) {
        const itemKey = normalizeText(row?.itemKey, 260)
        const itemRaw = normalizeText(row?.itemRaw, 320)

        if (!itemKey || !itemRaw || candidateByItemKey.has(itemKey)) {
          continue
        }

        candidateByItemKey.set(itemKey, {
          itemKey,
          itemRaw,
          descriptions: Array.isArray(row?.descriptions) ? row.descriptions : [],
          vendorRaws: Array.isArray(row?.vendorRaws) ? row.vendorRaws : [],
        })

        if (candidateByItemKey.size >= resolvedLimit) {
          break
        }
      }
    }

    if (normalizedSearch) {
      const fullSearchRegex = new RegExp(escapeRegExp(normalizedSearch), 'i')

      await mergeCandidateQuery(
        purchasingItemsCollection
          .find(
            {
              $or: [
                { itemRaw: fullSearchRegex },
                { descriptions: fullSearchRegex },
                { vendorRaws: fullSearchRegex },
              ],
            },
            { projection: purchasingItemSummaryProjection },
          )
          .sort({ totalSpent: -1, lastPurchaseDate: -1 })
          .limit(Math.min(resolvedLimit, 140)),
      )
    }

    for (const token of searchTokens) {
      if (candidateByItemKey.size >= resolvedLimit) {
        break
      }

      const tokenRegex = new RegExp(escapeRegExp(token), 'i')

      await mergeCandidateQuery(
        purchasingItemsCollection
          .find(
            {
              $or: [
                { itemRaw: tokenRegex },
                { descriptions: tokenRegex },
                { vendorRaws: tokenRegex },
              ],
            },
            { projection: purchasingItemSummaryProjection },
          )
          .sort({ totalSpent: -1, lastPurchaseDate: -1 })
          .limit(Math.min(90, resolvedLimit)),
      )
    }

    if (candidateByItemKey.size < resolvedLimit) {
      await mergeCandidateQuery(
        purchasingItemsCollection
          .find({}, { projection: purchasingItemSummaryProjection })
          .sort({ lastPurchaseDate: -1, totalSpent: -1 })
          .limit(resolvedLimit),
      )
    }

    return [...candidateByItemKey.values()].slice(0, resolvedLimit)
  }

  function mergePurchasingItemsByPriority(primaryItems, secondaryItems, maxItems) {
    const resolvedLimit = Math.max(Number(maxItems) || 0, 1)
    const merged = []
    const seenItemKeys = new Set()

    for (const item of [...(Array.isArray(primaryItems) ? primaryItems : []), ...(Array.isArray(secondaryItems) ? secondaryItems : [])]) {
      const itemKey = normalizeText(item?.itemKey, 260)

      if (!item || !itemKey || seenItemKeys.has(itemKey)) {
        continue
      }

      seenItemKeys.add(itemKey)
      merged.push(item)

      if (merged.length >= resolvedLimit) {
        break
      }
    }

    return merged
  }

  app.post('/api/purchasing/items/ai-search', requireFirebaseAuth, async (req, res, next) => {
    try {
      if (typeof findExactItemPurchaseOptions !== 'function') {
        throw createHttpError('AI sourcing is not available right now.', 503)
      }

      const resolvedInput = await resolvePurchasingAiSearchInput(req)

      const {
        itemKey,
        itemName,
        referencePrice,
      } = resolvedInput

      if (!itemName) {
        return res.status(400).json({ error: 'itemName or key is required.' })
      }

      const { profile: itemSearchProfile, candidates: searchCandidates } = await fetchPurchasingAiSearchCandidates(itemName)
      const candidatePreviews = await Promise.all(
        searchCandidates.map((candidate) => fetchPurchasingAiCandidatePreview(candidate)),
      )
      const candidateEvidence = candidatePreviews.filter(Boolean)
      const aiResult = await findExactItemPurchaseOptions({
        itemName,
        itemSearchProfile,
        deliveryLocation: purchasingAiDeliveryLocation,
        referencePrice,
        candidates: candidateEvidence,
      })
      const options = (Array.isArray(aiResult?.options) ? aiResult.options : [])
        .map((option) => {
          const parsedUnitPrice = Number(option?.unitPrice)
          const unitPrice = Number.isFinite(parsedUnitPrice) && parsedUnitPrice > 0
            ? Number(parsedUnitPrice.toFixed(2))
            : null
          const priceBand = resolvePurchasingAiPriceBand(unitPrice, referencePrice)

          return {
            vendorName: normalizeText(option?.vendorName, 180) || 'Unknown vendor',
            productTitle: normalizeText(option?.productTitle, 280) || itemName,
            url: normalizeText(option?.url, 1000),
            unitPrice,
            currency: normalizeText(option?.currency, 12) || 'USD',
            shippingEvidence: normalizeText(option?.shippingEvidence, 500),
            exactMatchEvidence: normalizeText(option?.exactMatchEvidence, 500),
            notes: normalizeText(option?.notes, 500),
            priceStatus: priceBand.status,
            deltaPercent: priceBand.deltaPercent,
            thresholdPercent: priceBand.thresholdPercent,
          }
        })
        .filter((option) => option.url)
        .sort((left, right) => {
          const leftPrice = left.unitPrice == null ? Number.POSITIVE_INFINITY : left.unitPrice
          const rightPrice = right.unitPrice == null ? Number.POSITIVE_INFINITY : right.unitPrice
          return leftPrice - rightPrice
        })

      return res.json({
        generatedAt: new Date().toISOString(),
        itemKey,
        itemName,
        deliveryLocation: purchasingAiDeliveryLocation,
        referencePrice: Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : null,
        candidatesScanned: candidateEvidence.length,
        matchedOptionCount: options.length,
        excludedCandidateCount: Number(aiResult?.excludedCount ?? Math.max(candidateEvidence.length - options.length, 0)),
        options,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/purchasing/items', requireFirebaseAuth, async (req, res, next) => {
    try {
      const refreshRequested = String(req.query?.refresh ?? '').trim() === '1'
      const search = String(req.query?.search ?? '').trim()
      const aiAssistRequested = String(req.query?.aiAssist ?? '').trim() === '1'
      const pageSize = Math.min(Math.max(Number(req.query?.pageSize) || 100, 1), 500)
      const page = Math.max(Number(req.query?.page) || 1, 1)
      const {
        dashboardSnapshotsCollection,
        purchasingItemsCollection,
      } = await getCollections()
      let refreshSummary = null

      if (refreshRequested) {
        refreshSummary = await syncPurchasingFromQuickBooks({ force: false })
      }

      const filter = {}

      if (search) {
        const safe = escapeRegExp(search)
        const rx = new RegExp(safe, 'i')
        filter.$or = [
          { itemRaw: rx },
          { descriptions: rx },
          { vendorRaws: rx },
        ]
      }

      let totalCount = await purchasingItemsCollection.countDocuments(filter)
      let totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
      let safePage = Math.min(page, totalPages)

      let items = await purchasingItemsCollection
        .find(filter, {
          projection: purchasingItemSummaryProjection,
        })
        .sort({ totalSpent: -1, lastPurchaseDate: -1 })
        .skip((safePage - 1) * pageSize)
        .limit(pageSize)
        .toArray()

      let aiAssist = {
        enabled: Boolean(search && aiAssistRequested),
        used: false,
        mode: 'none',
        matchedCount: 0,
        topConfidence: null,
        usedFallback: false,
        message: null,
      }

      const shouldRunAiAssist =
        Boolean(search)
        && aiAssistRequested
        && typeof resolvePurchasingItemSearchMatches === 'function'

      if (shouldRunAiAssist) {
        const shouldRunFallbackMode = totalCount === 0
        const shouldRunRerankMode = !shouldRunFallbackMode && safePage === 1 && totalCount <= 120

        if (shouldRunFallbackMode || shouldRunRerankMode) {
          const aiCandidates = await fetchPurchasingSearchAiCandidates({
            search,
            purchasingItemsCollection,
            maxCandidates: 180,
          })

          if (aiCandidates.length > 0) {
            const aiMatchResult = await resolvePurchasingItemSearchMatches({
              query: search,
              candidates: aiCandidates,
              maxMatches: Math.min(Math.max(pageSize, 10), 24),
            })
            const candidateByIndex = new Map(
              aiCandidates.map((candidate, index) => [index, candidate]),
            )
            const rankedItemKeys = []
            const seenRankedItemKeys = new Set()

            for (const match of Array.isArray(aiMatchResult?.matches) ? aiMatchResult.matches : []) {
              const candidate = candidateByIndex.get(Number(match?.sourceCandidateIndex))
              const itemKey = normalizeText(candidate?.itemKey, 260)

              if (!itemKey || seenRankedItemKeys.has(itemKey)) {
                continue
              }

              seenRankedItemKeys.add(itemKey)
              rankedItemKeys.push(itemKey)
            }

            if (rankedItemKeys.length > 0) {
              const matchedItems = await purchasingItemsCollection
                .find(
                  { itemKey: { $in: rankedItemKeys } },
                  { projection: purchasingItemSummaryProjection },
                )
                .toArray()
              const matchedItemByKey = new Map(
                matchedItems.map((item) => [normalizeText(item?.itemKey, 260), item]),
              )
              const matchedItemsOrdered = rankedItemKeys
                .map((itemKey) => matchedItemByKey.get(itemKey))
                .filter(Boolean)
              const topConfidenceRaw = Number(aiMatchResult?.matches?.[0]?.confidence)
              const topConfidence = Number.isFinite(topConfidenceRaw)
                ? Number(topConfidenceRaw.toFixed(2))
                : null

              if (shouldRunFallbackMode) {
                totalCount = matchedItemsOrdered.length
                totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
                safePage = Math.min(page, totalPages)
                items = matchedItemsOrdered.slice((safePage - 1) * pageSize, safePage * pageSize)
                aiAssist = {
                  enabled: true,
                  used: true,
                  mode: 'fallback',
                  matchedCount: matchedItemsOrdered.length,
                  topConfidence,
                  usedFallback: Boolean(aiMatchResult?.usedFallback),
                  message: matchedItemsOrdered.length > 0
                    ? 'AI matched similar item names for your search.'
                    : 'AI could not find a similar item name.',
                }
              } else if (shouldRunRerankMode) {
                items = mergePurchasingItemsByPriority(matchedItemsOrdered, items, pageSize)
                aiAssist = {
                  enabled: true,
                  used: true,
                  mode: 'rerank',
                  matchedCount: matchedItemsOrdered.length,
                  topConfidence,
                  usedFallback: Boolean(aiMatchResult?.usedFallback),
                  message: 'AI prioritized likely exact item matches at the top.',
                }
              }
            }
          }
        }
      }

      const syncSnapshot = await getPurchasingSyncSnapshot(dashboardSnapshotsCollection)

      return res.json({
        generatedAt: new Date().toISOString(),
        page: safePage,
        pageSize,
        totalPages,
        totalCount,
        count: items.length,
        refreshSummary,
        sync: {
          source: normalizeText(syncSnapshot?.source, 80) || null,
          lastAttemptedRefreshAt: normalizeText(syncSnapshot?.lastAttemptedRefreshAt, 80) || null,
          lastSuccessfulRefreshAt: normalizeText(syncSnapshot?.lastSuccessfulRefreshAt, 80) || null,
          lastQuickBooksBillUpdatedAt:
            normalizeText(syncSnapshot?.lastQuickBooksBillUpdatedAt, 80) || null,
          lastErrorMessage: normalizeText(syncSnapshot?.lastErrorMessage, 900) || null,
          lastErrorAt: normalizeText(syncSnapshot?.lastErrorAt, 80) || null,
          truncated: Boolean(syncSnapshot?.truncated),
        },
        aiAssist,
        items,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/purchasing/refresh', requireFirebaseAuth, async (req, res, next) => {
    try {
      const forceRefresh = String(req.query?.force ?? '').trim() === '1'
      const summary = await syncPurchasingFromQuickBooks({ force: forceRefresh })

      return res.json({
        generatedAt: new Date().toISOString(),
        summary,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/purchasing/items/photos', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = resolvePurchasingItemKey(req)

      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const photos = await listPurchasingItemPhotoRecords(itemKey)

      return res.json({
        itemKey,
        photos,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/purchasing/items/photos/download', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = resolvePurchasingItemKey(req)

      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const rawPath = Array.isArray(req.query?.path)
        ? req.query.path[0]
        : req.query?.path
      const photoPath = normalizePurchasingItemPhotoPath(itemKey, rawPath)

      if (!photoPath) {
        return res.status(400).json({ error: 'A valid photo path is required.' })
      }

      const bucket = getOrderPhotosBucket()
      const file = bucket.file(photoPath)
      const [exists] = await file.exists()

      if (!exists) {
        return res.status(404).json({ error: 'Photo not found.' })
      }

      const [metadata] = await file.getMetadata()
      const contentType = String(metadata?.contentType ?? '').trim() || 'application/octet-stream'
      const fileName = buildPurchasingItemPhotoDownloadFileName(itemKey, photoPath)

      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
      res.setHeader('Cache-Control', 'private, max-age=60')

      await new Promise((resolve, reject) => {
        const stream = file.createReadStream()

        stream.on('error', reject)
        stream.on('end', resolve)
        stream.pipe(res)
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/purchasing/items/photos', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = resolvePurchasingItemKey(req)

      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const mimeType = String(req.body?.mimeType ?? 'image/jpeg')
        .trim()
        .toLowerCase()

      if (!isSupportedPhotoMimeType(mimeType)) {
        return res.status(400).json({ error: 'Unsupported image mimeType.' })
      }

      const imageBuffer = decodeBase64Image(req.body?.imageBase64)

      if (!imageBuffer || imageBuffer.length === 0) {
        return res.status(400).json({ error: 'imageBase64 is required.' })
      }

      if (imageBuffer.length > maxPurchasingPhotoBytes) {
        return res.status(400).json({ error: 'Image exceeds 8MB limit.' })
      }

      const photo = await savePurchasingItemPhotoRecord(itemKey, imageBuffer, mimeType)

      return res.status(201).json({
        itemKey,
        photo,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/purchasing/items/photos', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = resolvePurchasingItemKey(req)

      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const queryPath = Array.isArray(req.query?.path)
        ? req.query.path[0]
        : req.query?.path
      const photoPath = normalizePurchasingItemPhotoPath(
        itemKey,
        req.body?.path ?? queryPath,
      )

      if (!photoPath) {
        return res.status(400).json({ error: 'A valid photo path is required.' })
      }

      const deleted = await deletePurchasingItemPhotoRecord(itemKey, photoPath)

      if (!deleted) {
        return res.status(404).json({ error: 'Photo not found.' })
      }

      return res.json({
        ok: true,
        itemKey,
        path: photoPath,
      })
    } catch (error) {
      next(error)
    }
  })

  // Detail lookup uses a query param so itemKeys containing '/', '(', '"', etc.
  // are not split or rejected by URL path normalization (Firebase Hosting decodes
  // %2F back to '/', which breaks `:itemKey` segment matching).
  async function purchasingItemDetailHandler(req, res, next) {
    try {
      const rawKey = req.query?.key ?? req.params?.itemKey ?? ''
      const itemKey = String(rawKey).trim().toLowerCase()
      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const { purchasingItemsCollection, purchasingTransactionsCollection } = await getCollections()
      const item = await purchasingItemsCollection.findOne(
        { itemKey },
        { projection: { _id: 0 } },
      )

      if (!item) {
        return res.status(404).json({ error: 'Item not found.' })
      }

      const transactions = await purchasingTransactionsCollection
        .find({ itemKey }, { projection: { _id: 0 } })
        .sort({ date: -1 })
        .toArray()

      // Build per-vendor breakdown with shipping + price stats
      const byVendor = new Map()
      let grandSpent = 0
      let grandQty = 0
      const grandPriceList = []

      transactions.forEach((tx) => {
        const vendorKey = tx.vendorKey || 'unknown'
        const existing = byVendor.get(vendorKey) || {
          vendorKey,
          vendorRaw: tx.vendorRaw || vendorKey,
          totalSpent: 0,
          totalQty: 0,
          transactionCount: 0,
          firstPurchaseDate: null,
          lastPurchaseDate: null,
          shipDaysList: [],
          unitPriceList: [],
          poCount: 0,
          receiptCount: 0,
        }

        const amount = toNumber(tx.amount)
        const qty = toNumber(tx.qty)
        const unit = toNumber(tx.unitCost)
        existing.totalSpent = toMoney(existing.totalSpent + amount)
        existing.totalQty = toNumber(existing.totalQty + qty)
        existing.transactionCount += 1
        if (tx.type === 'Purchase Order') existing.poCount += 1
        if (tx.type === 'Item Receipt') existing.receiptCount += 1

        if (tx.date) {
          if (!existing.firstPurchaseDate || tx.date < existing.firstPurchaseDate) {
            existing.firstPurchaseDate = tx.date
          }
          if (!existing.lastPurchaseDate || tx.date > existing.lastPurchaseDate) {
            existing.lastPurchaseDate = tx.date
          }
        }

        if (Number.isFinite(Number(tx.shipDays)) && Number(tx.shipDays) >= 0) {
          existing.shipDaysList.push(Number(tx.shipDays))
        }

        if (qty > 0 && unit > 0) {
          existing.unitPriceList.push(unit)
          grandPriceList.push(unit)
        }

        grandSpent = toMoney(grandSpent + amount)
        grandQty = toNumber(grandQty + qty)

        byVendor.set(vendorKey, existing)
      })

      function priceStats(list) {
        if (!list.length) return { highest: null, lowest: null, average: null, sampleCount: 0 }
        const highest = Math.max(...list)
        const lowest = Math.min(...list)
        const average = list.reduce((a, b) => a + b, 0) / list.length
        return {
          highest: Number(highest.toFixed(4)),
          lowest: Number(lowest.toFixed(4)),
          average: Number(average.toFixed(4)),
          sampleCount: list.length,
        }
      }

      const vendors = [...byVendor.values()].map((v) => {
        const list = v.shipDaysList
        const fastest = list.length ? Math.min(...list) : null
        const slowest = list.length ? Math.max(...list) : null
        const average = list.length
          ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(1))
          : null
        const ps = priceStats(v.unitPriceList)
        return {
          vendorKey: v.vendorKey,
          vendorRaw: v.vendorRaw,
          totalSpent: v.totalSpent,
          totalQty: v.totalQty,
          transactionCount: v.transactionCount,
          poCount: v.poCount,
          receiptCount: v.receiptCount,
          firstPurchaseDate: v.firstPurchaseDate,
          lastPurchaseDate: v.lastPurchaseDate,
          fastestShipDays: fastest,
          slowestShipDays: slowest,
          averageShipDays: average,
          shipSampleCount: list.length,
          highestPrice: ps.highest,
          lowestPrice: ps.lowest,
          averagePrice: ps.average,
          priceSampleCount: ps.sampleCount,
        }
      }).sort((a, b) => b.totalSpent - a.totalSpent)

      const allShip = transactions
        .map((t) => Number(t.shipDays))
        .filter((n) => Number.isFinite(n) && n >= 0)
      const overallFastest = allShip.length ? Math.min(...allShip) : null
      const overallSlowest = allShip.length ? Math.max(...allShip) : null
      const overallAvg = allShip.length
        ? Number((allShip.reduce((a, b) => a + b, 0) / allShip.length).toFixed(1))
        : null

      const overallPrice = priceStats(grandPriceList)

      return res.json({
        generatedAt: new Date().toISOString(),
        item,
        summary: {
          totalSpent: grandSpent,
          totalQty: grandQty,
          transactionCount: transactions.length,
          vendorCount: vendors.length,
          fastestShipDays: overallFastest,
          slowestShipDays: overallSlowest,
          averageShipDays: overallAvg,
          shipSampleCount: allShip.length,
          highestPrice: overallPrice.highest,
          lowestPrice: overallPrice.lowest,
          averagePrice: overallPrice.average,
          priceSampleCount: overallPrice.sampleCount,
        },
        vendors,
        transactions,
      })
    } catch (error) {
      next(error)
    }
  }

  app.get('/api/purchasing/items/detail', requireFirebaseAuth, purchasingItemDetailHandler)
  app.get('/api/purchasing/items/:itemKey', requireFirebaseAuth, purchasingItemDetailHandler)
}
