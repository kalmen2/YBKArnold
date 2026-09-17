import { AppError } from '../utils/app-error.mjs'
import {
  QUICKBOOKS_API_BASE_URL_DEFAULT as quickBooksApiBaseUrlDefault,
  QUICKBOOKS_TOKEN_URL as quickBooksTokenUrl,
  extractQuickBooksRefName,
  extractQuickBooksRefValue,
  normalizeQuickBooksApiBaseUrl,
  resolveQuickBooksErrorMessage,
  toIsoTimeFromNow,
} from '../utils/quickbooks-utils.mjs'
import {
  buildFirebaseStorageDownloadUrl,
  isExpiredAt,
  normalizeText,
  toMoneyOrZero as toMoney,
} from '../utils/value-utils.mjs'
const quickBooksTokenDocId = 'primary'
const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
const quickBooksBillPageSize = 200
// A 504 from QuickBooks is its gateway giving up on a slow query, and it is
// usually transient. Without a timeout the call can also hang until the
// function itself is killed, which is what turns a blip into a failed refresh.
const quickBooksQueryTimeoutMs = 25_000
const quickBooksQueryRetryDelaysMs = [1_000, 3_000, 7_000]
const quickBooksTransientStatuses = new Set([429, 500, 502, 503, 504])
const quickBooksMinBillPageSize = 25
const quickBooksMaxBillPages = 30
const quickBooksLookupPageSize = 500
const quickBooksLookupMaxPages = 12
const purchasingSyncSnapshotKey = 'purchasing_qbo_sync'
const purchasingPhotosPrefix = 'purchasing-item-photos'
const maxPurchasingPhotoBytes = 8 * 1024 * 1024
const purchasingAiDeliveryLocation = 'United States (USA)'
const purchasingAiSearchUrl = 'https://html.duckduckgo.com/html/'
const purchasingAiMaxSearchCandidates = 12

const createHttpError = (message, status = 500) => new AppError(message, status)

function normKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripTrailingEllipsis(value) {
  const raw = String(value ?? '').trim()

  if (!raw) {
    return ''
  }

  if (!/(?:\.\.\.|…)\s*$/.test(raw)) {
    return raw
  }

  return raw.replace(/(?:\.\.\.|…)\s*$/, '').trim()
}

function buildPoItemSearchSources(values) {
  const sources = []
  const seen = new Set()

  for (const value of Array.isArray(values) ? values : []) {
    const source = normalizeText(value, 260)

    if (!source) {
      continue
    }

    const normalized = normKey(source)

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      sources.push(normalized)
    }

    const stripped = stripTrailingEllipsis(source)
    const strippedToken = normKey(stripped)

    if (strippedToken && !seen.has(strippedToken)) {
      seen.add(strippedToken)
      sources.push(strippedToken)
    }
  }

  return sources
}

function collectPoItemCandidatesByPrefix({ prefixToken, itemSearchIndex }) {
  if (!prefixToken) {
    return []
  }

  const matches = []

  ;(Array.isArray(itemSearchIndex) ? itemSearchIndex : []).forEach((entry) => {
    if (!entry?.item) {
      return
    }

    if (
      (entry.productToken && entry.productToken.startsWith(prefixToken))
      || (entry.nameToken && entry.nameToken.startsWith(prefixToken))
    ) {
      matches.push(entry.item)
    }
  })

  return matches
}

function resolvePoBestPrefixCandidates({ searchToken, itemSearchIndex }) {
  const normalizedSearchToken = normKey(searchToken)

  if (!normalizedSearchToken) {
    return {
      matchedPrefix: '',
      matches: [],
    }
  }

  const fullMatches = collectPoItemCandidatesByPrefix({
    prefixToken: normalizedSearchToken,
    itemSearchIndex,
  })

  if (fullMatches.length > 0) {
    return {
      matchedPrefix: normalizedSearchToken,
      matches: fullMatches,
    }
  }

  let low = 1
  let high = normalizedSearchToken.length
  let bestPrefix = ''
  let bestMatches = []

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const prefixToken = normalizedSearchToken.slice(0, mid).trim()

    if (!prefixToken) {
      low = mid + 1
      continue
    }

    const matches = collectPoItemCandidatesByPrefix({
      prefixToken,
      itemSearchIndex,
    })

    if (matches.length > 0) {
      bestPrefix = prefixToken
      bestMatches = matches
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return {
    matchedPrefix: bestPrefix,
    matches: bestMatches,
  }
}

function createPoItemAmbiguityError({ line, vendor, candidates }) {
  const options = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 20)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      productNumber: candidate.productNumber || candidate.name,
      description: candidate.description || '',
    }))
  const error = new Error(`Line ${line.index + 1}: multiple QuickBooks items match "${line.productNumber}".`)

  error.status = 409
  error.code = 'PO_ITEM_AMBIGUOUS'
  error.ambiguities = [
    {
      lineId: line.lineId,
      lineIndex: line.index,
      vendorId: line.vendorId,
      vendorName: vendor.name,
      itemName: line.itemName,
      productNumber: line.productNumber,
      quantity: line.quantity,
      options,
    },
  ]

  return error
}

function collectPoItemMatchCandidates({ line, itemSearchIndex }) {
  const searchSources = buildPoItemSearchSources([line.productNumber, line.itemName])
  let bestMatch = null

  searchSources.forEach((searchSource, sourceIndex) => {
    const resolved = resolvePoBestPrefixCandidates({
      searchToken: searchSource,
      itemSearchIndex,
    })

    if (!resolved.matches.length) {
      return
    }

    const candidate = {
      sourceIndex,
      matchedPrefixLength: resolved.matchedPrefix.length,
      matches: resolved.matches,
    }

    if (!bestMatch) {
      bestMatch = candidate
      return
    }

    if (candidate.matchedPrefixLength > bestMatch.matchedPrefixLength) {
      bestMatch = candidate
      return
    }

    if (
      candidate.matchedPrefixLength === bestMatch.matchedPrefixLength
      && candidate.matches.length < bestMatch.matches.length
    ) {
      bestMatch = candidate
    }
  })

  if (!bestMatch) {
    return []
  }

  return [...bestMatch.matches]
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? '')))
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
    requireOfficeManagerOrAdminRole,
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
    requiresDimensions: 1,
    defaultDimensions: 1,
    requiresVeneerDirection: 1,
    defaultVeneerDirection: 1,
  }
  const poVendorContextTtlMs = 2 * 60_000
  const poContextCacheByScope = {
    basic: null,
    withProjects: null,
  }

  async function getQuickBooksCollections() {
    const { quickBooksTokensCollection } = await getCollections()

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

  const delayFor = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

  async function quickBooksQuery(options) {
    let lastError = null

    for (let attempt = 0; attempt <= quickBooksQueryRetryDelaysMs.length; attempt += 1) {
      try {
        return await quickBooksQueryOnce(options)
      } catch (error) {
        const status = Number(error?.status)
        const isTransient = quickBooksTransientStatuses.has(status) || error?.name === 'TimeoutError'

        if (!isTransient || attempt === quickBooksQueryRetryDelaysMs.length) {
          throw error
        }

        lastError = error
        await delayFor(quickBooksQueryRetryDelaysMs[attempt])
      }
    }

    throw lastError
  }

  async function quickBooksQueryOnce({ apiBaseUrl, realmId, accessToken, query }) {
    const endpoint = `${normalizeQuickBooksApiBaseUrl(apiBaseUrl)}/v3/company/${encodeURIComponent(realmId)}/query?minorversion=75&query=${encodeURIComponent(query)}`
    let response = null

    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(quickBooksQueryTimeoutMs),
      })
    } catch (error) {
      // Surface a timeout as a retryable status rather than an opaque abort.
      throw createHttpError(
        `QuickBooks query failed: ${error?.name === 'TimeoutError' ? 'request timed out' : 'network error'}`,
        504,
      )
    }

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

  async function quickBooksCreateEntity({
    apiBaseUrl,
    realmId,
    accessToken,
    entityPath,
    payload,
  }) {
    const endpoint = `${normalizeQuickBooksApiBaseUrl(apiBaseUrl)}/v3/company/${encodeURIComponent(realmId)}/${entityPath}?minorversion=75`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload ?? {}),
    })

    const responseText = await response.text().catch(() => '')
    let parsedPayload = {}

    if (responseText) {
      try {
        parsedPayload = JSON.parse(responseText)
      } catch {
        parsedPayload = {}
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
        `QuickBooks write failed: ${resolveQuickBooksErrorMessage(parsedPayload, fallbackMessage)}`,
        response.status,
      )
    }

    return parsedPayload
  }

  async function createQuickBooksExecutor() {
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
    const resolveCreate = (entityPath, payload) => quickBooksCreateEntity({
      apiBaseUrl: quickBooksConfig.apiBaseUrl,
      realmId,
      accessToken: tokenDoc.accessToken,
      entityPath,
      payload,
    })
    const resolvePdf = (entityPath, entityId) => quickBooksFetchPdf({
      apiBaseUrl: quickBooksConfig.apiBaseUrl,
      realmId,
      accessToken: tokenDoc.accessToken,
      entityPath,
      entityId,
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

    const createFn = async (entityPath, payload) => {
      try {
        return await resolveCreate(entityPath, payload)
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

        return resolveCreate(entityPath, payload)
      }
    }

    const pdfFn = async (entityPath, entityId) => {
      try {
        return await resolvePdf(entityPath, entityId)
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

        return resolvePdf(entityPath, entityId)
      }
    }

    return {
      queryFn,
      createFn,
      pdfFn,
    }
  }

  /**
   * The printable purchase order, straight from QuickBooks.
   *
   * This is the document a vendor is actually sent, so it has to come from
   * QuickBooks rather than be redrawn here. Anything we drew ourselves would
   * eventually disagree with what the vendor received.
   */
  async function quickBooksFetchPdf({ apiBaseUrl, realmId, accessToken, entityPath, entityId }) {
    const endpoint = `${normalizeQuickBooksApiBaseUrl(apiBaseUrl)}/v3/company/${encodeURIComponent(realmId)}/${entityPath}/${encodeURIComponent(entityId)}/pdf?minorversion=75`
    let response = null

    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/pdf',
        },
        signal: AbortSignal.timeout(quickBooksQueryTimeoutMs),
      })
    } catch (error) {
      throw createHttpError(
        `QuickBooks PDF request failed: ${error?.name === 'TimeoutError' ? 'request timed out' : 'network error'}`,
        504,
      )
    }

    if (!response.ok) {
      throw createHttpError(
        `QuickBooks returned ${response.status} for the purchase order PDF.`,
        response.status === 401 ? 401 : 502,
      )
    }

    return Buffer.from(await response.arrayBuffer())
  }

  async function queryAllQuickBooksRows({
    queryFn,
    entityName,
    fields = '*',
    whereClause = '',
    orderBy = '',
    pageSize = quickBooksLookupPageSize,
    maxPages = quickBooksLookupMaxPages,
  }) {
    const rows = []
    let startPosition = 1
    let truncated = false

    for (let page = 0; page < maxPages; page += 1) {
      const whereSegment = whereClause ? ` WHERE ${whereClause}` : ''
      const orderSegment = orderBy ? ` ORDERBY ${orderBy}` : ''
      const query = `SELECT ${fields} FROM ${entityName}${whereSegment}${orderSegment} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      const payload = await queryFn(query)
      const batchRows = Array.isArray(payload?.QueryResponse?.[entityName])
        ? payload.QueryResponse[entityName]
        : []

      rows.push(...batchRows)

      if (batchRows.length < pageSize) {
        return {
          rows,
          truncated,
        }
      }

      startPosition += pageSize
    }

    truncated = true

    return {
      rows,
      truncated,
    }
  }

  function splitQuickBooksProjectLabel(projectName, fallbackProjectId = '') {
    const normalizedName = normalizeText(projectName, 260)

    if (!normalizedName) {
      return {
        customerName: '',
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
        customerName: '',
        projectNumber: segments[0] || normalizeText(fallbackProjectId, 160) || '',
      }
    }

    return {
      customerName: segments.slice(0, -1).join(' : '),
      projectNumber: segments[segments.length - 1] || normalizeText(fallbackProjectId, 160) || '',
    }
  }

  function normalizePoDocNumberForSorting(value) {
    const raw = normalizeText(value, 120)

    if (!raw) {
      return null
    }

    if (/^\d+$/.test(raw)) {
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    }

    const trailingDigits = raw.match(/(\d+)(?!.*\d)/)

    if (!trailingDigits?.[1]) {
      return null
    }

    const parsed = Number(trailingDigits[1])
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  function resolveNextSequentialPoNumber(purchaseOrders) {
    const maxDocNumber = (Array.isArray(purchaseOrders) ? purchaseOrders : []).reduce((currentMax, po) => {
      const parsed = normalizePoDocNumberForSorting(po?.DocNumber)
      return parsed != null && parsed > currentMax ? parsed : currentMax
    }, 0)

    return String(maxDocNumber + 1)
  }

  function parseRequestDateOnly(value) {
    const parsed = parseDateOnly(value)

    if (parsed) {
      return parsed
    }

    return new Date().toISOString().slice(0, 10)
  }

  function buildQuickBooksPoContext({
    items,
    vendors,
    customers,
    purchaseOrders,
  }) {
    const mappedItems = (Array.isArray(items) ? items : [])
      .map((item) => {
        const id = normalizeText(item?.Id, 160)
        const itemName =
          normalizeText(item?.FullyQualifiedName, 260)
          || normalizeText(item?.Name, 260)
          || id
        const description =
          normalizeText(item?.Description, 800)
          || normalizeText(item?.PurchaseDesc, 800)
          || normalizeText(item?.SalesDesc, 800)
          || ''
        const productNumber =
          normalizeText(item?.Sku, 160)
          || normalizeText(item?.Name, 260)
          || ''

        if (!id || !itemName) {
          return null
        }

        return {
          id,
          name: itemName,
          productNumber,
          description,
          active: item?.Active !== false,
          // Carried so a newly created item can copy the accounts the existing
          // ones already use, rather than hard-coding a chart of accounts here.
          type: normalizeText(item?.Type, 40) || null,
          expenseAccountId: extractQuickBooksRefValue(item?.ExpenseAccountRef) || null,
          incomeAccountId: extractQuickBooksRefValue(item?.IncomeAccountRef) || null,
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name))

    const mappedVendors = (Array.isArray(vendors) ? vendors : [])
      .map((vendor) => {
        const id = normalizeText(vendor?.Id, 160)
        const name =
          normalizeText(vendor?.DisplayName, 260)
          || normalizeText(vendor?.CompanyName, 260)
          || normalizeText(vendor?.PrintOnCheckName, 260)
          || id

        if (!id || !name) {
          return null
        }

        return {
          id,
          name,
          active: vendor?.Active !== false,
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name))

    const mappedProjects = (Array.isArray(customers) ? customers : [])
      .filter((customer) => customer?.Job === true)
      .map((customer) => {
        const id = normalizeText(customer?.Id, 160)
        const projectName =
          normalizeText(customer?.FullyQualifiedName, 260)
          || normalizeText(customer?.DisplayName, 260)
          || id

        if (!id || !projectName) {
          return null
        }

        const projectLabel = splitQuickBooksProjectLabel(projectName, id)

        return {
          id,
          name: projectName,
          projectNumber: normalizeText(projectLabel.projectNumber, 160) || id,
          customerName: normalizeText(projectLabel.customerName, 260) || '',
          active: customer?.Active !== false,
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name))

    return {
      items: mappedItems,
      vendors: mappedVendors,
      projects: mappedProjects,
      nextPoNumber: resolveNextSequentialPoNumber(purchaseOrders),
    }
  }

  async function fetchQuickBooksPoContext({
    queryFn,
    includeItems = false,
    includeProjects = false,
    includePurchaseOrders = false,
  }) {
    const tasks = []

    if (includeItems) {
      tasks.push(
        queryAllQuickBooksRows({
          queryFn,
          entityName: 'Item',
          orderBy: 'Name',
        }),
      )
    }

    tasks.push(
      queryAllQuickBooksRows({
        queryFn,
        entityName: 'Vendor',
        orderBy: 'DisplayName',
      }),
    )

    if (includeProjects) {
      tasks.push(
        queryAllQuickBooksRows({
          queryFn,
          entityName: 'Customer',
          orderBy: 'DisplayName',
        }),
      )
    }

    if (includePurchaseOrders) {
      tasks.push(
        queryAllQuickBooksRows({
          queryFn,
          entityName: 'PurchaseOrder',
          fields: 'Id, DocNumber, TxnDate',
          orderBy: 'MetaData.LastUpdatedTime',
        }),
      )
    }

    const results = await Promise.all(tasks)
    let pointer = 0
    const itemResult = includeItems
      ? results[pointer++]
      : { rows: [], truncated: false }
    const vendorResult = results[pointer++]
    const customerResult = includeProjects
      ? results[pointer++]
      : { rows: [], truncated: false }
    const purchaseOrderResult = includePurchaseOrders
      ? results[pointer++]
      : { rows: [], truncated: false }

    return {
      ...buildQuickBooksPoContext({
        items: itemResult.rows,
        vendors: vendorResult.rows,
        customers: customerResult.rows,
        purchaseOrders: purchaseOrderResult.rows,
      }),
      truncated: {
        items: Boolean(itemResult.truncated),
        vendors: Boolean(vendorResult.truncated),
        projects: Boolean(customerResult.truncated),
        purchaseOrders: Boolean(purchaseOrderResult.truncated),
      },
    }
  }

  /** Full lines, unlike the PO-context query, which only needs id and date. */
  async function queryQuickBooksPurchaseOrderLines({ queryFn }) {
    return queryAllQuickBooksRows({
      queryFn,
      entityName: 'PurchaseOrder',
      orderBy: 'MetaData.LastUpdatedTime',
    })
  }

  async function queryIncrementalQuickBooksBills({ queryFn, lastUpdatedCursor }) {
    const bills = []
    let startPosition = 1
    const filterCursor = normalizeText(lastUpdatedCursor, 80) || null
    let maxUpdatedAt = normalizeText(lastUpdatedCursor, 80) || null
    let truncated = false

    // Bills are fetched with SELECT *, so a page carries every line of every
    // bill. When QuickBooks times out on one, the page was too heavy: halve it
    // and try the same position again rather than failing the whole refresh.
    let pageSize = quickBooksBillPageSize

    for (let page = 0; page < quickBooksMaxBillPages; page += 1) {
      const whereClause = filterCursor
        ? ` WHERE MetaData.LastUpdatedTime >= '${escapeQuickBooksString(filterCursor)}'`
        : ''
      let payload = null

      for (;;) {
        const query = `SELECT * FROM Bill${whereClause} ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`

        try {
          payload = await queryFn(query)
          break
        } catch (error) {
          const status = Number(error?.status)

          if (!quickBooksTransientStatuses.has(status) || pageSize <= quickBooksMinBillPageSize) {
            throw error
          }

          pageSize = Math.max(quickBooksMinBillPageSize, Math.floor(pageSize / 2))
        }
      }

      const rows = Array.isArray(payload?.QueryResponse?.Bill)
        ? payload.QueryResponse.Bill
        : []

      rows.forEach((bill) => {
        maxUpdatedAt = maxIsoTimestamp(maxUpdatedAt, bill?.MetaData?.LastUpdatedTime)
      })

      bills.push(...rows)

      if (rows.length < pageSize) {
        return {
          bills,
          truncated,
          maxUpdatedAt,
        }
      }

      startPosition += pageSize
    }

    truncated = true

    return {
      bills,
      truncated,
      maxUpdatedAt,
    }
  }

  /**
   * Purchase orders, stored the same way bills are.
   *
   * Two things need them. A bill already records which purchase order it
   * settles, so having the order's own date is what makes "how long did it
   * take" answerable at all — that arithmetic has been in the item screen for
   * a while, reading a field nothing ever filled in. And an order with no bill
   * against it is simply something that is still on its way, which is the other
   * half of what a buying list has to show.
   */
  function buildQuickBooksPurchaseOrderLineTransactions(purchaseOrder) {
    const purchaseOrderId = normalizeText(purchaseOrder?.Id, 160)

    if (!purchaseOrderId) {
      return []
    }

    const poDate = parseDateOnly(purchaseOrder?.TxnDate)
    const updatedAt = normalizeText(purchaseOrder?.MetaData?.LastUpdatedTime, 80) || null
    const docNumber = normalizeText(purchaseOrder?.DocNumber, 160) || null
    // Open or Closed. Closed does not have to mean everything arrived — see the
    // note on the purchase orders endpoint.
    const poStatus = normalizeText(purchaseOrder?.POStatus, 40) || null
    const vendorRaw =
      extractQuickBooksRefName(purchaseOrder?.VendorRef)
      || extractQuickBooksRefValue(purchaseOrder?.VendorRef)
      || null
    const memo =
      normalizeText(purchaseOrder?.PrivateNote, 600)
      || normalizeText(purchaseOrder?.Memo, 600)
      || null
    const lines = Array.isArray(purchaseOrder?.Line) ? purchaseOrder.Line : []

    return lines
      .map((line, index) => {
        const lineDetail = normalizeBillLineDetail(line)
        const itemRaw =
          normalizeText(lineDetail?.ItemRef?.name, 260)
          || normalizeText(line?.Description, 320)
          || normalizeText(lineDetail?.AccountRef?.name, 260)
          || null
        const itemKey = normKey(itemRaw)

        if (!itemKey) {
          return null
        }

        const amount = toMoney(line?.Amount)
        const qtyFromLine = Number(lineDetail?.Qty)
        const qty = Number.isFinite(qtyFromLine) && qtyFromLine > 0 ? qtyFromLine : 1
        const unitPriceFromLine = Number(lineDetail?.UnitPrice)
        const unitCost = Number.isFinite(unitPriceFromLine) && unitPriceFromLine > 0
          ? Number(unitPriceFromLine.toFixed(4))
          : qty > 0
            ? Number((amount / qty).toFixed(4))
            : 0
        const lineId = normalizeText(line?.Id, 120) || String(index + 1)

        return {
          id: `qbo_po:${purchaseOrderId}:line:${lineId}`,
          source: 'qbo_online',
          type: 'Purchase Order',
          date: poDate,
          poDate,
          // Its own id, so a bill's LinkedTxn lands straight on it.
          poNumber: purchaseOrderId,
          transNumber: docNumber,
          poStatus,
          itemKey,
          itemRaw,
          itemDescription: normalizeText(line?.Description, 320) || null,
          vendorKey: normKey(vendorRaw) || 'unknown',
          vendorRaw,
          qty,
          unitCost,
          amount,
          memo,
          shipDate: null,
          delivDate: null,
          shipDays: null,
          quickBooksPurchaseOrderId: purchaseOrderId,
          quickBooksLineId: lineId,
          quickBooksUpdatedAt: updatedAt,
        }
      })
      .filter(Boolean)
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

  /**
   * Days from raising the purchase order to being billed for it.
   *
   * A bill is only written when the goods arrive, so the gap between the two
   * dates is how long the vendor actually took. The item and vendor screens
   * have been reading this field for a while; nothing ever filled it in.
   *
   * Done as a pass over the collection rather than over the batch: a bill
   * arriving today can settle an order raised months ago, and that order is in
   * the database, not in this sync's payload.
   */
  async function backfillShipDays(purchasingTransactionsCollection) {
    const pendingBills = await purchasingTransactionsCollection
      .find(
        { type: 'Bill', poNumber: { $ne: null }, shipDays: null },
        { projection: { _id: 0, id: 1, poNumber: 1, date: 1 } },
      )
      .toArray()

    if (pendingBills.length === 0) {
      return { scanned: 0, updated: 0 }
    }

    const poNumbers = [...new Set(pendingBills.map((bill) => bill.poNumber).filter(Boolean))]
    const purchaseOrders = await purchasingTransactionsCollection
      .find(
        { type: 'Purchase Order', poNumber: { $in: poNumbers } },
        { projection: { _id: 0, poNumber: 1, poDate: 1, date: 1 } },
      )
      .toArray()

    const poDateByNumber = new Map()

    purchaseOrders.forEach((purchaseOrder) => {
      const poDate = purchaseOrder.poDate || purchaseOrder.date

      if (poDate) {
        poDateByNumber.set(String(purchaseOrder.poNumber), poDate)
      }
    })

    const operations = []

    pendingBills.forEach((bill) => {
      const poDate = poDateByNumber.get(String(bill.poNumber))

      if (!poDate || !bill.date) {
        return
      }

      const days = Math.round(
        (new Date(bill.date).getTime() - new Date(poDate).getTime()) / 86400000,
      )

      // A bill dated before its own purchase order is a data entry slip, not a
      // negative delivery time. Record the date, leave the duration unknown.
      operations.push({
        updateOne: {
          filter: { id: bill.id },
          update: {
            $set: Number.isFinite(days) && days >= 0
              ? { poDate, shipDays: days }
              : { poDate },
          },
        },
      })
    })

    if (operations.length === 0) {
      return { scanned: pendingBills.length, updated: 0 }
    }

    const result = await purchasingTransactionsCollection.bulkWrite(operations, { ordered: false })

    return { scanned: pendingBills.length, updated: result.modifiedCount ?? 0 }
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
      // Purchase orders are pulled whole rather than incrementally: a bill can
      // settle an order raised months before the cursor, and without the order
      // line the delivery time cannot be worked out.
      const purchaseOrderResult = await queryQuickBooksPurchaseOrderLines({ queryFn })
      const purchaseOrderTransactions = purchaseOrderResult.rows.flatMap((purchaseOrder) =>
        buildQuickBooksPurchaseOrderLineTransactions(purchaseOrder))
      const billTransactions = filteredBills.flatMap((bill) =>
        buildQuickBooksBillLineTransactions(bill))
      const transactions = [...purchaseOrderTransactions, ...billTransactions]
      const touchedItemKeys = [...new Set(transactions.map((transaction) => transaction.itemKey).filter(Boolean))]
      const transactionWriteSummary = await upsertPurchasingTransactions(
        transactions,
        purchasingTransactionsCollection,
      )
      const shipDaysSummary = await backfillShipDays(purchasingTransactionsCollection)
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
        purchaseOrderCountFetched: purchaseOrderResult.rows.length,
        lineCountFetched: transactions.length,
        shipDaysScanned: shipDaysSummary.scanned,
        shipDaysResolved: shipDaysSummary.updated,
        newTransactionCount: transactionWriteSummary.insertedCount,
        updatedTransactionCount: transactionWriteSummary.updatedCount,
        touchedItemCount: touchedItemKeys.length,
        rebuiltItemCount: itemRebuildSummary.rebuiltCount,
        truncated: Boolean(billQueryResult.truncated) || Boolean(purchaseOrderResult.truncated),
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

  app.get('/api/purchasing/po/context', requireFirebaseAuth, requireOfficeManagerOrAdminRole, async (req, res, next) => {
    try {
      const forceRefresh = req.query?.refresh === '1' || req.query?.refresh === 'true'
      const includeProjects = req.query?.includeProjects === '1' || req.query?.includeProjects === 'true'
      const cacheKey = includeProjects ? 'withProjects' : 'basic'
      const now = Date.now()
      const scopedCache = poContextCacheByScope[cacheKey]

      if (!forceRefresh && scopedCache && (now - scopedCache.fetchedAt) < poVendorContextTtlMs) {
        return res.json(scopedCache.payload)
      }

      const { queryFn } = await createQuickBooksExecutor()
      const context = await fetchQuickBooksPoContext({
        queryFn,
        includeProjects,
      })

      const payload = {
        generatedAt: new Date().toISOString(),
        vendors: context.vendors,
        projects: includeProjects ? context.projects : [],
        truncated: {
          vendors: context.truncated.vendors,
          ...(includeProjects ? { projects: context.truncated.projects } : {}),
        },
      }

      poContextCacheByScope[cacheKey] = {
        fetchedAt: now,
        payload,
      }

      return res.json(payload)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/purchasing/po/create', requireFirebaseAuth, requireOfficeManagerOrAdminRole, async (req, res, next) => {
    try {
      const requestedLines = Array.isArray(req.body?.lines) ? req.body.lines : []

      if (requestedLines.length === 0) {
        return res.status(400).json({ error: 'At least one PO line is required.' })
      }

      const requestedProjectNumber = normalizeText(req.body?.projectNumber, 160)
      const requestedProjectId = normalizeText(req.body?.projectId, 160)
      const poDate = parseRequestDateOnly(req.body?.poDate)
      const memo = normalizeText(req.body?.memo, 900) || null

      const normalizedLines = requestedLines.map((line, index) => {
        const lineId = normalizeText(line?.lineId, 160) || `line-${index + 1}`
        const itemName = normalizeText(line?.itemName, 260)
        const productNumber = normalizeText(line?.productNumber, 260)
        const vendorId = normalizeText(line?.vendorId, 160)
        const vendorName = normalizeText(line?.vendorName, 260)
        const lineProjectNumber = normalizeText(line?.projectNumber, 160)
        const lineProjectId = normalizeText(line?.projectId, 160)
        const description = normalizeText(line?.description, 900) || null
        const quantityRaw = Number(line?.quantity)
        const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0
          ? Number(quantityRaw.toFixed(4))
          : null
        const unitPriceRaw = Number(line?.unitPrice)
        const unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw >= 0
          ? Number(unitPriceRaw.toFixed(4))
          : null

        if (!vendorId) {
          throw createHttpError(`Line ${index + 1}: vendor is required.`, 400)
        }

        if (!productNumber) {
          throw createHttpError(`Line ${index + 1}: product number is required.`, 400)
        }

        if (quantity == null) {
          throw createHttpError(`Line ${index + 1}: quantity must be greater than 0.`, 400)
        }

        return {
          lineId,
          index,
          itemName: itemName || productNumber,
          productNumber,
          vendorId,
          vendorName: vendorName || vendorId,
          projectNumber: lineProjectNumber,
          projectId: lineProjectId,
          description,
          quantity,
          unitPrice,
        }
      })

      const { queryFn, createFn } = await createQuickBooksExecutor()
      const poContext = await fetchQuickBooksPoContext({
        queryFn,
        includeItems: true,
        includeProjects: true,
        includePurchaseOrders: true,
      })
      const vendorById = new Map(
        poContext.vendors.map((vendor) => [vendor.id, vendor]),
      )
      const projectById = new Map(
        poContext.projects.map((project) => [project.id, project]),
      )
      const projectByNumber = new Map(
        poContext.projects
          .map((project) => [normKey(project.projectNumber), project])
          .filter(([projectNumber]) => Boolean(projectNumber)),
      )
      const itemSearchIndex = poContext.items
        .map((item) => ({
          item,
          productToken: normKey(item.productNumber),
          nameToken: normKey(item.name),
        }))
        .filter((entry) => Boolean(entry.productToken || entry.nameToken))

      let resolvedDefaultProject = null

      if (requestedProjectId) {
        resolvedDefaultProject = projectById.get(requestedProjectId) ?? null
      }

      if (!resolvedDefaultProject && requestedProjectNumber) {
        resolvedDefaultProject = projectByNumber.get(normKey(requestedProjectNumber)) ?? null
      }

      if ((requestedProjectId || requestedProjectNumber) && !resolvedDefaultProject) {
        throw createHttpError(
          `Project number "${requestedProjectNumber || requestedProjectId}" was not found in QuickBooks.`,
          409,
        )
      }

      /**
       * The shape QuickBooks wants for a new purchasable item, worked out from
       * the ones already there.
       *
       * Hard-coding an expense account would mean guessing at a chart of
       * accounts that differs per company and changes. Copying the account the
       * existing non-inventory items already post to is both correct and
       * self-maintaining.
       */
      function resolveNewItemTemplate() {
        const purchasable = poContext.items.filter((item) => item.expenseAccountId)

        if (purchasable.length === 0) {
          return null
        }

        const countByAccount = new Map()

        purchasable.forEach((item) => {
          const key = `${item.type || 'NonInventory'}|${item.expenseAccountId}|${item.incomeAccountId || ''}`
          countByAccount.set(key, (countByAccount.get(key) ?? 0) + 1)
        })

        const [mostCommon] = [...countByAccount.entries()].sort((left, right) => right[1] - left[1])
        const [type, expenseAccountId, incomeAccountId] = String(mostCommon[0]).split('|')

        return {
          type: type || 'NonInventory',
          expenseAccountId,
          incomeAccountId: incomeAccountId || null,
        }
      }

      // An item nobody has bought before is normal, not an error. It becomes a
      // real QuickBooks item at this moment because a vendor has been chosen,
      // which is when it stops being a note and starts being a purchase.
      const unmatchedLines = normalizedLines.filter((line) => (
        collectPoItemMatchCandidates({ line, itemSearchIndex }).length === 0
      ))
      const createdItems = []

      if (unmatchedLines.length > 0) {
        const template = resolveNewItemTemplate()

        if (!template) {
          throw createHttpError(
            'No existing QuickBooks item has an expense account to copy, so new items cannot be created automatically. Create one item by hand in QuickBooks first.',
            409,
          )
        }

        const seenNames = new Set()

        for (const line of unmatchedLines) {
          const name = (line.productNumber || line.itemName).slice(0, 100)
          const nameKey = normKey(name)

          if (!nameKey || seenNames.has(nameKey)) {
            continue
          }

          seenNames.add(nameKey)

          const payload = {
            Name: name,
            Type: template.type,
            ExpenseAccountRef: { value: template.expenseAccountId },
            ...(template.incomeAccountId ? { IncomeAccountRef: { value: template.incomeAccountId } } : {}),
            ...(line.description ? { PurchaseDesc: line.description.slice(0, 1000) } : {}),
          }
          const created = await createFn('item', payload)
          const createdItem = created?.Item ?? null
          const createdId = normalizeText(createdItem?.Id, 160)

          if (!createdId) {
            throw createHttpError(`Could not create QuickBooks item "${name}".`, 502)
          }

          const mapped = {
            id: createdId,
            name: normalizeText(createdItem?.Name, 260) || name,
            productNumber: normalizeText(createdItem?.Sku, 160) || name,
            description: line.description || '',
            active: true,
            type: template.type,
            expenseAccountId: template.expenseAccountId,
            incomeAccountId: template.incomeAccountId,
          }

          createdItems.push(mapped)
          poContext.items.push(mapped)
          itemSearchIndex.push({
            item: mapped,
            productToken: normKey(mapped.productNumber),
            nameToken: normKey(mapped.name),
          })
        }
      }

      const linesByVendorId = new Map()

      normalizedLines.forEach((line) => {
        const vendor = vendorById.get(line.vendorId)
        const matchedCandidates = collectPoItemMatchCandidates({
          line,
          itemSearchIndex,
        })
        const matchedItem = matchedCandidates.length === 1
          ? matchedCandidates[0]
          : null

        if (!vendor) {
          throw createHttpError(`Line ${line.index + 1}: vendor is not recognized in QuickBooks.`, 400)
        }

        if (matchedCandidates.length > 1) {
          throw createPoItemAmbiguityError({
            line,
            vendor,
            candidates: matchedCandidates,
          })
        }

        if (!matchedItem) {
          throw createHttpError(
            `Line ${line.index + 1}: QuickBooks item "${line.productNumber}" could not be matched even after creating it.`,
            409,
          )
        }

        let resolvedLineProject = null

        if (line.projectId || line.projectNumber) {
          if (line.projectId) {
            resolvedLineProject = projectById.get(line.projectId) ?? null
          }

          if (!resolvedLineProject && line.projectNumber) {
            resolvedLineProject = projectByNumber.get(normKey(line.projectNumber)) ?? null
          }

          if (!resolvedLineProject) {
            throw createHttpError(
              `Line ${line.index + 1}: project "${line.projectNumber || line.projectId}" was not found in QuickBooks.`,
              409,
            )
          }
        } else if (resolvedDefaultProject) {
          resolvedLineProject = resolvedDefaultProject
        } else {
          throw createHttpError(`Line ${line.index + 1}: project is required.`, 400)
        }

        const existing = linesByVendorId.get(line.vendorId) ?? []
        existing.push({
          ...line,
          itemId: matchedItem.id,
          itemName: matchedItem.name || line.itemName,
          vendorName: vendor.name,
          projectId: resolvedLineProject.id,
          projectName: resolvedLineProject.name,
          projectNumber: resolvedLineProject.projectNumber,
          projectCustomerName: resolvedLineProject.customerName,
        })
        linesByVendorId.set(line.vendorId, existing)
      })

      const vendorGroups = [...linesByVendorId.entries()]
        .map(([vendorId, lines]) => ({
          vendorId,
          vendorName: lines[0]?.vendorName || vendorId,
          lines,
        }))
        .sort((left, right) => left.vendorName.localeCompare(right.vendorName))
      const startingPoNumber = Number(poContext.nextPoNumber)
      const safeStartingPoNumber = Number.isFinite(startingPoNumber) && startingPoNumber > 0
        ? startingPoNumber
        : 1
      const createdPurchaseOrders = []

      for (let index = 0; index < vendorGroups.length; index += 1) {
        const vendorGroup = vendorGroups[index]
        const nextDocNumber = String(safeStartingPoNumber + index)
        const linePayload = vendorGroup.lines.map((line) => {
          const hasUnitPrice = line.unitPrice != null && Number.isFinite(line.unitPrice)
          const amount = hasUnitPrice
            ? Number((line.quantity * Number(line.unitPrice)).toFixed(2))
            : 0

          return {
            Amount: amount,
            Description: line.description || line.itemName || line.productNumber,
            DetailType: 'ItemBasedExpenseLineDetail',
            ItemBasedExpenseLineDetail: {
              ItemRef: {
                value: line.itemId,
                name: line.itemName,
              },
              Qty: line.quantity,
              ...(hasUnitPrice ? { UnitPrice: line.unitPrice } : {}),
              CustomerRef: {
                value: line.projectId,
                name: line.projectName,
              },
            },
          }
        })
        const poPayload = {
          DocNumber: nextDocNumber,
          TxnDate: poDate,
          VendorRef: {
            value: vendorGroup.vendorId,
            name: vendorGroup.vendorName,
          },
          ...(memo ? { PrivateNote: memo } : {}),
          Line: linePayload,
        }

        const created = await createFn('purchaseorder', poPayload)
        const createdPurchaseOrder = created?.PurchaseOrder ?? null
        const docNumber = normalizeText(createdPurchaseOrder?.DocNumber, 160) || nextDocNumber
        const totalAmount = toMoney(createdPurchaseOrder?.TotalAmt)

        createdPurchaseOrders.push({
          quickBooksId: normalizeText(createdPurchaseOrder?.Id, 160) || null,
          docNumber,
          vendorId: vendorGroup.vendorId,
          vendorName: vendorGroup.vendorName,
          lineCount: vendorGroup.lines.length,
          totalAmount,
        })
      }

      const firstResolvedProjectLine = vendorGroups[0]?.lines?.[0] ?? null
      const responseProject = resolvedDefaultProject || (firstResolvedProjectLine
        ? {
            id: firstResolvedProjectLine.projectId,
            name: firstResolvedProjectLine.projectName,
            projectNumber: firstResolvedProjectLine.projectNumber,
            customerName: firstResolvedProjectLine.projectCustomerName,
            active: true,
          }
        : null)

      if (!responseProject) {
        throw createHttpError('Could not resolve project for purchase order lines.', 500)
      }

      return res.status(201).json({
        generatedAt: new Date().toISOString(),
        project: responseProject,
        createdProject: null,
        startingPoNumber: String(safeStartingPoNumber),
        poCount: createdPurchaseOrders.length,
        lineCount: normalizedLines.length,
        // Reported back so the page can say which items it just invented on
        // your behalf, rather than creating them silently.
        createdItems: createdItems.map((item) => ({ id: item.id, name: item.name })),
        purchaseOrders: createdPurchaseOrders,
      })
    } catch (error) {
      if (error?.code === 'PO_ITEM_AMBIGUOUS') {
        return res.status(Number(error?.status || 409)).json({
          error: error?.message || 'Multiple QuickBooks item matches found. Select one option.',
          code: 'PO_ITEM_AMBIGUOUS',
          ambiguities: Array.isArray(error?.ambiguities) ? error.ambiguities : [],
        })
      }

      next(error)
    }
  })

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

  app.patch('/api/purchasing/items/settings', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemKey = String(req.query?.key ?? req.body?.itemKey ?? '').trim().toLowerCase()

      if (!itemKey) {
        return res.status(400).json({ error: 'itemKey is required.' })
      }

      const { purchasingItemsCollection } = await getCollections()
      const existing = await purchasingItemsCollection.findOne(
        { itemKey },
        { projection: { _id: 0, itemKey: 1 } },
      )

      if (!existing) {
        return res.status(404).json({ error: 'Item not found.' })
      }

      const requiresDimensions = req.body?.requiresDimensions === true
      const defaultDimensions = requiresDimensions
        ? normalizeText(req.body?.defaultDimensions, 300) || null
        : null
      const requiresVeneerDirection = requiresDimensions && req.body?.requiresVeneerDirection === true
      const requestedVeneerDirection = normalizeText(req.body?.defaultVeneerDirection, 40).toLowerCase()
      const defaultVeneerDirection = requiresVeneerDirection
        && ['length', 'width', 'none'].includes(requestedVeneerDirection)
        ? requestedVeneerDirection
        : null
      const updatedAt = new Date().toISOString()
      const updatedByEmail = normalizeText(req.authUser?.email, 200) || null
      const item = await purchasingItemsCollection.findOneAndUpdate(
        { itemKey },
        {
          $set: {
            requiresDimensions,
            defaultDimensions,
            requiresVeneerDirection,
            defaultVeneerDirection,
            settingsUpdatedAt: updatedAt,
            settingsUpdatedByEmail: updatedByEmail,
          },
        },
        { returnDocument: 'after', projection: { _id: 0 } },
      )

      return res.json({ item })
    } catch (error) {
      next(error)
    }
  })

  // Any approved, authenticated user can refresh the shared purchasing snapshot.
  // Creating purchase orders remains restricted by requireOfficeManagerOrAdminRole.
  // ---------------------------------------------------------------------------
  // The buying list
  // ---------------------------------------------------------------------------

  /**
   * Orders whose parts are worth buying yet.
   *
   * Design is deliberately excluded: the parts list is still being written
   * there, and buying against a list that is still changing is how you end up
   * with the wrong panel. Production and waiting-for-production are both in,
   * because waiting only means a manager has not pressed the button.
   */
  const buyingListOrderFilter = {
    is_cancelled: { $ne: true },
    is_deleted: { $ne: true },
    is_shipped: { $ne: true },
    is_archived: { $ne: true },
    $or: [
      { in_design: { $ne: true } },
      { production_handoff_status: 'waiting_for_production' },
    ],
  }

  function daysBetween(fromDateText, toDateText) {
    const from = fromDateText ? new Date(fromDateText) : null
    const to = toDateText ? new Date(toDateText) : null

    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return null
    }

    return Math.round((to.getTime() - from.getTime()) / 86400000)
  }

  /**
   * Statuses that mean nobody is buying this.
   *
   * Cancelled speaks for itself. The other three are supplied another way: we
   * make it, somebody else supplies it, or the customer's own material is being
   * used. None of them belong on a list of things to order.
   */
  const NON_PURCHASE_STATUSES = new Set([
    'canceled',
    'cancelled',
    'make in house',
    'by other',
    'com',
  ])

  /** Statuses that mean it has arrived. */
  const RECEIVED_STATUSES = new Set(['is here'])

  /**
   * Statuses that mean an order has been placed.
   *
   * Partial counts as on order rather than received: some of it is still owed,
   * and the part that is still owed is the part worth watching.
   */
  const ORDERED_STATUSES = new Set(['ordered', 'partial', 'partial receipt'])

  /**
   * What a line needs next, decided in one place.
   *
   * The Monday status leads and the dates follow, because the status column is
   * what the shop actually keeps up to date. Of 253 live subitems, 185 said
   * "Is here" while only 69 carried a received date — reading dates first
   * called 116 arrived parts "not ordered".
   *
   * The page, any report and any alert all read this rather than each deciding
   * for itself what "late" means, because two answers to that question is worse
   * than either answer.
   */
  function resolveBuyingState(line, todayText) {
    const status = String(line.status ?? '').trim().toLowerCase()

    if (line.source === 'stock' || NON_PURCHASE_STATUSES.has(status)) {
      return 'not_needed'
    }

    if (RECEIVED_STATUSES.has(status) || line.dateReceived) {
      return 'received'
    }

    if (ORDERED_STATUSES.has(status) || line.dateOrdered) {
      // Ordered, and the date it was promised has passed with nothing booked in.
      return line.dueDate && line.dueDate < todayText ? 'overdue_arrival' : 'ordered'
    }

    if (line.orderByDate && line.orderByDate < todayText) {
      return 'overdue_order'
    }

    return 'not_ordered'
  }

  /**
   * Blank rows Monday creates on its own.
   *
   * Adding a subitem in Monday makes one called "Subitem" with nothing on it,
   * and sixteen of them reached us that way. A row with that name and no other
   * information is not a part anybody has to buy, so it is skipped.
   *
   * Hard-coded on purpose, and temporary: this goes when Monday does. A row
   * named "Subitem" that somebody has since given a vendor, a date, a quantity
   * or a description is real work and is kept.
   */
  const MONDAY_PLACEHOLDER_NAMES = new Set(['', 'item', 'subitem', 'buy', 'new subitem'])

  function isEmptyMondayPlaceholder(part) {
    const name = String(part?.itemName ?? '').trim().toLowerCase()

    if (!MONDAY_PLACEHOLDER_NAMES.has(name)) {
      return false
    }

    const carriesSomething = [
      part?.description,
      part?.vendor,
      part?.dimensions,
      part?.orderByDate,
      part?.dueDate,
      part?.dateOrdered,
      part?.dateReceived,
      part?.status,
      part?.itemKey,
      part?.link,
    ].some((value) => String(value ?? '').trim())

    return !carriesSomething && (Number(part?.quantity) || 1) <= 1
  }

  /** A line nobody can plan around, because it has no dates on it at all. */
  function isMissingDates(line) {
    return !line.orderByDate && !line.dueDate
  }

  function buildBuyingLineFromPart(part, order, todayText) {
    const line = {
      lineId: `part:${order.orderKey}:${part.id}`,
      kind: 'order_part',
      partId: String(part?.id ?? ''),
      orderKey: order.orderKey,
      orderNumber: String(order.order_number ?? '').trim() || null,
      orderName: String(order.name ?? '').trim() || null,
      // The project is the order. There is no third thing to pick.
      projectNumber: String(order.order_number ?? '').trim() || null,
      projectId: String(order.qb_project_id ?? '').trim() || null,
      itemKey: String(part?.itemKey ?? '').trim() || null,
      itemName: String(part?.itemName ?? '').trim() || 'Item',
      description: String(part?.description ?? '').trim() || null,
      dimensions: String(part?.dimensions ?? '').trim() || null,
      quantity: Number.isFinite(Number(part?.quantity)) ? Number(part.quantity) : 1,
      vendor: String(part?.vendor ?? '').trim() || null,
      source: String(part?.source ?? '').trim() === 'stock' ? 'stock' : 'purchase',
      orderByDate: String(part?.orderByDate ?? '').trim() || null,
      dueDate: String(part?.dueDate ?? '').trim() || null,
      dateOrdered: String(part?.dateOrdered ?? '').trim() || null,
      dateReceived: String(part?.dateReceived ?? '').trim() || null,
      status: String(part?.status ?? '').trim() || null,
    }

    return {
      ...line,
      state: resolveBuyingState(line, todayText),
      missingDates: isMissingDates(line),
      daysUntilOrderBy: daysBetween(todayText, line.orderByDate),
      daysUntilDue: daysBetween(todayText, line.dueDate),
    }
  }

  function buildBuyingLineFromRequest(request, todayText) {
    const line = {
      lineId: `request:${request.id}`,
      kind: 'standalone',
      requestId: String(request?.id ?? ''),
      orderKey: null,
      orderNumber: null,
      orderName: null,
      projectNumber: String(request?.projectNumber ?? '').trim() || null,
      projectId: String(request?.projectId ?? '').trim() || null,
      projectName: String(request?.projectName ?? '').trim() || null,
      itemKey: String(request?.itemKey ?? '').trim() || null,
      itemName: String(request?.itemName ?? '').trim() || 'Item',
      description: String(request?.description ?? '').trim() || null,
      dimensions: null,
      quantity: Number.isFinite(Number(request?.quantity)) ? Number(request.quantity) : 1,
      vendor: String(request?.vendor ?? '').trim() || null,
      source: String(request?.source ?? '').trim() === 'stock' ? 'stock' : 'purchase',
      orderByDate: String(request?.orderByDate ?? '').trim() || null,
      dueDate: String(request?.dueDate ?? '').trim() || null,
      dateOrdered: String(request?.dateOrdered ?? '').trim() || null,
      dateReceived: String(request?.dateReceived ?? '').trim() || null,
      status: null,
      notes: String(request?.notes ?? '').trim() || null,
    }

    return {
      ...line,
      state: resolveBuyingState(line, todayText),
      missingDates: isMissingDates(line),
      daysUntilOrderBy: daysBetween(todayText, line.orderByDate),
      daysUntilDue: daysBetween(todayText, line.dueDate),
    }
  }

  app.get('/api/purchasing/buying-list', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { ordersUnifiedCollection, purchasingRequestsCollection } = await getCollections()
      const todayText = new Date().toISOString().slice(0, 10)

      const [orders, requests] = await Promise.all([
        ordersUnifiedCollection
          .find(buyingListOrderFilter, {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              name: 1,
              qb_project_id: 1,
              design_parts: 1,
            },
          })
          .toArray(),
        purchasingRequestsCollection
          .find({ isDeleted: { $ne: true } }, { projection: { _id: 0 } })
          .toArray(),
      ])

      let mondayPlaceholderCount = 0
      const orderLines = orders.flatMap((order) => (
        (Array.isArray(order.design_parts) ? order.design_parts : [])
          .filter((part) => part && String(part.id ?? '').trim())
          .filter((part) => {
            if (!isEmptyMondayPlaceholder(part)) {
              return true
            }

            mondayPlaceholderCount += 1
            return false
          })
          .map((part) => buildBuyingLineFromPart(part, order, todayText))
      ))
      const requestLines = requests.map((request) => buildBuyingLineFromRequest(request, todayText))
      const allLines = [...orderLines, ...requestLines]
      // Cancelled, made in house, supplied by others, customer's own material,
      // and anything taken from stock. Dropped here rather than filtered on the
      // page: none of them is a thing anybody has to buy.
      const lines = allLines.filter((line) => line.state !== 'not_needed')

      const counts = lines.reduce((totals, line) => {
        totals[line.state] = (totals[line.state] ?? 0) + 1
        return totals
      }, {})

      counts.missing_dates = lines.filter((line) => line.missingDates).length

      return res.json({
        generatedAt: new Date().toISOString(),
        today: todayText,
        counts,
        excludedCount: allLines.length - lines.length,
        mondayPlaceholderCount,
        lines,
      })
    } catch (error) {
      next(error)
    }
  })

  // ---------------------------------------------------------------------------
  // Standalone purchase requests
  // ---------------------------------------------------------------------------

  function normalizeRequestDate(value) {
    const text = normalizeText(value, 40)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
  }

  function mapPurchasingRequest(request) {
    return {
      id: String(request?.id ?? ''),
      itemKey: String(request?.itemKey ?? '').trim() || null,
      itemName: String(request?.itemName ?? '').trim() || 'Item',
      description: String(request?.description ?? '').trim() || null,
      projectId: String(request?.projectId ?? '').trim() || null,
      projectNumber: String(request?.projectNumber ?? '').trim() || null,
      projectName: String(request?.projectName ?? '').trim() || null,
      quantity: Number.isFinite(Number(request?.quantity)) ? Number(request.quantity) : 1,
      vendor: String(request?.vendor ?? '').trim() || null,
      source: String(request?.source ?? '').trim() === 'stock' ? 'stock' : 'purchase',
      orderByDate: String(request?.orderByDate ?? '').trim() || null,
      dueDate: String(request?.dueDate ?? '').trim() || null,
      dateOrdered: String(request?.dateOrdered ?? '').trim() || null,
      dateReceived: String(request?.dateReceived ?? '').trim() || null,
      notes: String(request?.notes ?? '').trim() || null,
      createdAt: String(request?.createdAt ?? '').trim() || null,
      createdByEmail: String(request?.createdByEmail ?? '').trim() || null,
      updatedAt: String(request?.updatedAt ?? '').trim() || null,
    }
  }

  app.post('/api/purchasing/requests', requireFirebaseAuth, async (req, res, next) => {
    try {
      const itemName = normalizeText(req.body?.itemName, 260)

      if (!itemName) {
        return res.status(400).json({ error: 'Item name is required.' })
      }

      const quantityRaw = Number(req.body?.quantity)

      if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) {
        return res.status(400).json({ error: 'Quantity must be greater than zero.' })
      }

      // Every purchase belongs to a project, general shop spend included — it
      // has a project called General. Required here rather than at purchase
      // order time, so nothing reaches the buying list unable to be bought.
      const projectId = normalizeText(req.body?.projectId, 160)

      if (!projectId) {
        return res.status(400).json({ error: 'A QuickBooks project is required.' })
      }

      const { purchasingRequestsCollection } = await getCollections()
      const now = new Date().toISOString()
      const request = {
        id: randomUUID(),
        itemKey: normKey(normalizeText(req.body?.itemKey, 260) || itemName) || null,
        itemName,
        description: normalizeText(req.body?.description, 900) || null,
        projectId,
        projectNumber: normalizeText(req.body?.projectNumber, 160) || null,
        projectName: normalizeText(req.body?.projectName, 260) || null,
        quantity: Number(quantityRaw.toFixed(3)),
        vendor: normalizeText(req.body?.vendor, 260) || null,
        source: normalizeText(req.body?.source, 20) === 'stock' ? 'stock' : 'purchase',
        orderByDate: normalizeRequestDate(req.body?.orderByDate),
        dueDate: normalizeRequestDate(req.body?.dueDate),
        dateOrdered: null,
        dateReceived: null,
        notes: normalizeText(req.body?.notes, 900) || null,
        isDeleted: false,
        createdAt: now,
        createdByEmail: normalizeText(req.authUser?.email, 200) || null,
        updatedAt: now,
      }

      await purchasingRequestsCollection.insertOne({ ...request })

      return res.status(201).json({ request: mapPurchasingRequest(request) })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/purchasing/requests/:requestId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const requestId = normalizeText(req.params.requestId, 160)
      const { purchasingRequestsCollection } = await getCollections()
      const existing = await purchasingRequestsCollection.findOne(
        { id: requestId },
        { projection: { _id: 0 } },
      )

      if (!existing) {
        return res.status(404).json({ error: 'Purchase request not found.' })
      }

      const changes = { updatedAt: new Date().toISOString() }

      if (req.body?.itemName !== undefined) {
        const itemName = normalizeText(req.body.itemName, 260)

        if (!itemName) {
          return res.status(400).json({ error: 'Item name is required.' })
        }

        changes.itemName = itemName
        changes.itemKey = normKey(itemName) || null
      }

      if (req.body?.quantity !== undefined) {
        const quantityRaw = Number(req.body.quantity)

        if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) {
          return res.status(400).json({ error: 'Quantity must be greater than zero.' })
        }

        changes.quantity = Number(quantityRaw.toFixed(3))
      }

      if (req.body?.description !== undefined) changes.description = normalizeText(req.body.description, 900) || null
      if (req.body?.vendor !== undefined) changes.vendor = normalizeText(req.body.vendor, 260) || null
      if (req.body?.notes !== undefined) changes.notes = normalizeText(req.body.notes, 900) || null
      if (req.body?.source !== undefined) changes.source = normalizeText(req.body.source, 20) === 'stock' ? 'stock' : 'purchase'
      if (req.body?.orderByDate !== undefined) changes.orderByDate = normalizeRequestDate(req.body.orderByDate)
      if (req.body?.dueDate !== undefined) changes.dueDate = normalizeRequestDate(req.body.dueDate)
      if (req.body?.dateOrdered !== undefined) changes.dateOrdered = normalizeRequestDate(req.body.dateOrdered)
      if (req.body?.dateReceived !== undefined) changes.dateReceived = normalizeRequestDate(req.body.dateReceived)

      await purchasingRequestsCollection.updateOne({ id: requestId }, { $set: changes })

      return res.json({ request: mapPurchasingRequest({ ...existing, ...changes }) })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/purchasing/requests/:requestId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const requestId = normalizeText(req.params.requestId, 160)
      const { purchasingRequestsCollection } = await getCollections()
      // Soft delete: a request that was raised and dropped is worth keeping,
      // because someone always asks why it was never bought.
      const result = await purchasingRequestsCollection.updateOne(
        { id: requestId },
        { $set: { isDeleted: true, updatedAt: new Date().toISOString() } },
      )

      if (!result.matchedCount) {
        return res.status(404).json({ error: 'Purchase request not found.' })
      }

      return res.json({ ok: true, requestId })
    } catch (error) {
      next(error)
    }
  })

  // ---------------------------------------------------------------------------
  // Purchase orders raised
  // ---------------------------------------------------------------------------

  /**
   * Every purchase order in QuickBooks, with its lines.
   *
   * Read live rather than from our own copy: the document a vendor holds is the
   * one in QuickBooks, and a number that has drifted is worse than a slow page.
   */
  app.get('/api/purchasing/purchase-orders', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { queryFn } = await createQuickBooksExecutor()
      const result = await queryAllQuickBooksRows({
        queryFn,
        entityName: 'PurchaseOrder',
        orderBy: 'TxnDate DESC',
      })

      const purchaseOrders = result.rows.map((purchaseOrder) => {
        const lines = (Array.isArray(purchaseOrder?.Line) ? purchaseOrder.Line : [])
          .map((line, index) => {
            const lineDetail = normalizeBillLineDetail(line)
            const itemName =
              normalizeText(lineDetail?.ItemRef?.name, 260)
              || normalizeText(line?.Description, 320)
              || normalizeText(lineDetail?.AccountRef?.name, 260)
              || `Line ${index + 1}`
            const quantity = Number(lineDetail?.Qty)
            const unitPrice = Number(lineDetail?.UnitPrice)

            return {
              lineId: normalizeText(line?.Id, 120) || String(index + 1),
              itemName,
              description: normalizeText(line?.Description, 320) || null,
              projectName: extractQuickBooksRefName(lineDetail?.CustomerRef) || null,
              quantity: Number.isFinite(quantity) ? quantity : null,
              unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
              amount: toMoney(line?.Amount),
            }
          })

        return {
          id: normalizeText(purchaseOrder?.Id, 160),
          docNumber: normalizeText(purchaseOrder?.DocNumber, 160) || null,
          txnDate: parseDateOnly(purchaseOrder?.TxnDate),
          vendorId: extractQuickBooksRefValue(purchaseOrder?.VendorRef) || null,
          vendorName: extractQuickBooksRefName(purchaseOrder?.VendorRef) || null,
          // QuickBooks calls it POStatus, and it is only ever Open or Closed.
          // Closed does not reliably mean everything arrived: QuickBooks closes
          // an order when every line has been billed, but a person can also
          // close one by hand to stop chasing the rest. So Closed means "no
          // longer outstanding", not "fully received". Arrival is judged from
          // bills, which is why the delivery times come from there.
          status: normalizeText(purchaseOrder?.POStatus, 40) || null,
          totalAmount: toMoney(purchaseOrder?.TotalAmt),
          memo: normalizeText(purchaseOrder?.PrivateNote, 600) || null,
          lineCount: lines.length,
          lines,
        }
      })
        .filter((purchaseOrder) => purchaseOrder.id)
        // Closed orders are dropped here rather than filtered on the page.
        // QuickBooks closes an order when every line has been billed, and a
        // person can close one by hand to stop chasing the rest. Either way
        // there is nothing left to do with it, so it is not worth carrying.
        .filter((purchaseOrder) => String(purchaseOrder.status ?? '').toLowerCase() !== 'closed')

      return res.json({
        generatedAt: new Date().toISOString(),
        truncated: Boolean(result.truncated),
        purchaseOrders,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/purchasing/purchase-orders/:purchaseOrderId/pdf', requireFirebaseAuth, async (req, res, next) => {
    try {
      const purchaseOrderId = normalizeText(req.params.purchaseOrderId, 160)

      if (!purchaseOrderId) {
        return res.status(400).json({ error: 'Purchase order id is required.' })
      }

      const { pdfFn } = await createQuickBooksExecutor()
      const pdf = await pdfFn('purchaseorder', purchaseOrderId)
      const docNumber = normalizeText(req.query?.docNumber, 160) || purchaseOrderId

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `inline; filename="PO-${docNumber.replace(/[^a-z0-9._-]+/gi, '-')}.pdf"`,
      )

      return res.end(pdf)
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
