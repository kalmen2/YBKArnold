const quickBooksTokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const quickBooksApiBaseUrlDefault = 'https://quickbooks.api.intuit.com'
const quickBooksTokenDocId = 'primary'
const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
const quickBooksBillPageSize = 200
const quickBooksMaxBillPages = 30
const purchasingSyncSnapshotKey = 'purchasing_qbo_sync'
const purchasingPhotosPrefix = 'purchasing-item-photos'
const maxPurchasingPhotoBytes = 8 * 1024 * 1024

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
    getCollections,
    getOrderPhotosBucket,
    isSupportedPhotoMimeType,
    randomUUID,
    requireFirebaseAuth,
  } = deps

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

  app.get('/api/purchasing/items', requireFirebaseAuth, async (req, res, next) => {
    try {
      const refreshRequested = String(req.query?.refresh ?? '').trim() === '1'
      const search = String(req.query?.search ?? '').trim()
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

      const totalCount = await purchasingItemsCollection.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
      const safePage = Math.min(page, totalPages)

      const items = await purchasingItemsCollection
        .find(filter, {
          projection: {
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
          },
        })
        .sort({ totalSpent: -1, lastPurchaseDate: -1 })
        .skip((safePage - 1) * pageSize)
        .limit(pageSize)
        .toArray()

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
