// Orders endpoints — overview (DB only), refresh (the one place the manual
// trigger does live Monday + QuickBooks pulls), and job-details (DB only,
// Mongo-side prefilter on jobName).

import {
  QUICKBOOKS_API_BASE_URL_DEFAULT as quickBooksApiBaseUrlDefault,
  QUICKBOOKS_TOKEN_URL as quickBooksTokenUrl,
  normalizeQuickBooksApiBaseUrl,
  resolveQuickBooksErrorMessage,
  toIsoTimeFromNow,
} from '../utils/quickbooks-utils.mjs'
import {
  buildFirebaseStorageDownloadUrl,
  isExpiredAt,
  toMoneyOrZero as toMoney,
} from '../utils/value-utils.mjs'

export function registerOrdersRoutes(app, deps) {
  const {
    authApprovalApproved,
    authRoleAdmin,
    decodeBase64Image,
    fetchMondayBoardItemsByIds,
    fetchMondayStatusColumnOptions,
    getCollections,
    getOrderPhotosBucket,
    mobileAlertTargetModeSelected,
    moveMondayItemToBoard,
    normalizeEmail,
    normalizeOptionalShortText,
    randomUUID,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    toPublicAuthUser,
    toPublicMobileAlert,
    updateMondayItemName,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
  } = deps
  const laborLookupsCacheTtlMs = 30 * 1000
  const quickBooksTokenDocId = 'primary'
  const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
  let cachedLaborLookups = null
  let cachedLaborLookupsExpiresAt = 0
  let ordersChatsIndexesPromise
  const linkedOrderNumberChangeMessage =
    'Sorry, this cannot be done because of its linked. If it needs to be done, contact admin.'
  const shippingDocumentMimeTypes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ])

  function sanitizeQuickBooksTokenText(value, maxLength = 8000) {
    return String(value ?? '').trim().slice(0, maxLength)
  }

  function sanitizeStorageSegment(value, fallback = 'unknown') {
    const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')

    if (!normalized) {
      return fallback
    }

    return normalized.slice(0, 120)
  }

  function sanitizeDownloadFileName(value, fallbackFileName = 'invoice.pdf') {
    const normalized = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')

    if (!normalized) {
      return fallbackFileName
    }

    return normalized
  }

  function ensurePdfFileName(value, fallbackFileName = 'invoice.pdf') {
    const safeFileName = sanitizeDownloadFileName(value, fallbackFileName)

    if (/\.pdf$/i.test(safeFileName)) {
      return safeFileName
    }

    return `${safeFileName}.pdf`
  }

  function normalizeShippingDocumentType(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if (normalized === 'signed_bol' || normalized === 'signed-bol') {
      return 'signed_bol'
    }

    if (normalized === 'inspection_sheet' || normalized === 'inspection-sheet') {
      return 'inspection_sheet'
    }

    return ''
  }

  function extensionForShippingDocumentMimeType(mimeType) {
    const normalized = String(mimeType ?? '').trim().toLowerCase()

    switch (normalized) {
      case 'image/jpeg':
        return 'jpg'
      case 'image/png':
        return 'png'
      case 'image/webp':
        return 'webp'
      case 'image/heic':
        return 'heic'
      case 'image/heif':
        return 'heif'
      default:
        return 'pdf'
    }
  }

  function ensureShippingDocumentFileName(fileName, mimeType, fallbackBaseName) {
    const safeName = sanitizeDownloadFileName(fileName, fallbackBaseName)

    if (/\.[a-zA-Z0-9]{2,8}$/.test(safeName)) {
      return safeName
    }

    return `${safeName}.${extensionForShippingDocumentMimeType(mimeType)}`
  }

  function buildOrderIdentityFilter({
    orderKey,
    mondayItemId,
    orderNumber,
  }) {
    const normalizedOrderKey = String(orderKey ?? '').trim()
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()
    const normalizedOrderNumber = String(orderNumber ?? '').trim()
    const filters = []

    if (normalizedOrderKey) {
      filters.push({ orderKey: normalizedOrderKey })
    }

    if (normalizedMondayItemId) {
      filters.push({ monday_item_id: normalizedMondayItemId })
    }

    if (normalizedOrderNumber) {
      filters.push({ order_number: normalizedOrderNumber })
    }

    if (filters.length === 0) {
      return null
    }

    if (filters.length === 1) {
      return filters[0]
    }

    return { $or: filters }
  }

  function resolveShippingDocumentFieldNames(documentType) {
    if (documentType === 'signed_bol') {
      return {
        documentLabel: 'Signed BOL',
        storageFolder: 'signed-bol',
        fileNameField: 'signed_bol',
        urlFieldPrimary: 'Signed_BOL_source',
        urlFieldLegacy: 'Signed_BOL',
        uploadedAtField: 'signed_bol_uploaded_at',
        storagePathField: 'signed_bol_storage_path',
        mimeTypeField: 'signed_bol_mime_type',
      }
    }

    return {
      documentLabel: 'Inspection Sheet',
      storageFolder: 'inspection-sheet',
      fileNameField: 'inspection_sheet',
      urlFieldPrimary: 'Inspection_sheet_source',
      urlFieldLegacy: 'Inspection_sheet',
      uploadedAtField: 'inspection_sheet_uploaded_at',
      storagePathField: 'inspection_sheet_storage_path',
      mimeTypeField: 'inspection_sheet_mime_type',
    }
  }

  async function exchangeQuickBooksRefreshToken({
    clientId,
    clientSecret,
    refreshToken,
  }) {
    const encodedAuthToken = Buffer
      .from(`${clientId}:${clientSecret}`)
      .toString('base64')
    const formData = new URLSearchParams()

    formData.set('grant_type', 'refresh_token')
    formData.set('refresh_token', sanitizeQuickBooksTokenText(refreshToken, 8000))

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
      throw new Error(
        `QuickBooks token request failed: ${resolveQuickBooksErrorMessage(payload, `status ${response.status}`)}`,
      )
    }

    return payload
  }

  function mapQuickBooksRefreshPayload(payload, existingTokenDoc) {
    const accessToken = sanitizeQuickBooksTokenText(payload?.access_token, 8000)
    const refreshToken = sanitizeQuickBooksTokenText(payload?.refresh_token, 8000)

    if (!accessToken || !refreshToken) {
      throw new Error('QuickBooks token response is missing required token fields.')
    }

    return {
      accessToken,
      refreshToken,
      tokenType: sanitizeQuickBooksTokenText(payload?.token_type, 40) || 'bearer',
      accessTokenExpiresAt: toIsoTimeFromNow(payload?.expires_in),
      refreshTokenExpiresAt:
        toIsoTimeFromNow(payload?.x_refresh_token_expires_in)
        ?? existingTokenDoc?.refreshTokenExpiresAt
        ?? null,
    }
  }

  async function refreshQuickBooksAccessToken({
    quickBooksTokensCollection,
    tokenDoc,
    clientId,
    clientSecret,
  }) {
    if (!tokenDoc?.refreshToken) {
      throw new Error('QuickBooks is not connected yet. Connect QuickBooks first.')
    }

    if (isExpiredAt(tokenDoc.refreshTokenExpiresAt)) {
      throw new Error('QuickBooks refresh token expired. Reconnect QuickBooks.')
    }

    const refreshPayload = await exchangeQuickBooksRefreshToken({
      clientId,
      clientSecret,
      refreshToken: tokenDoc.refreshToken,
    })
    const normalizedToken = mapQuickBooksRefreshPayload(refreshPayload, tokenDoc)
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
    forceRefresh = false,
  }) {
    const tokenDoc = await quickBooksTokensCollection.findOne({
      id: quickBooksTokenDocId,
    })

    if (!tokenDoc) {
      throw new Error('QuickBooks is not connected yet. Connect QuickBooks first.')
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

  async function quickBooksQuery({
    apiBaseUrl,
    realmId,
    accessToken,
    query,
  }) {
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
      throw Object.assign(new Error('QuickBooks access token is no longer valid.'), { status: 401 })
    }

    if (!response.ok) {
      const bodySummary = sanitizeQuickBooksTokenText(String(responseText || '').replace(/\s+/g, ' '), 300)
      const fallbackMessage = bodySummary
        ? `status ${response.status} (${bodySummary})`
        : `status ${response.status}`

      throw Object.assign(
        new Error(`QuickBooks query failed: ${resolveQuickBooksErrorMessage(payload, fallbackMessage)}`),
        { status: response.status },
      )
    }

    return payload
  }

  async function quickBooksDownloadInvoicePdf({
    apiBaseUrl,
    realmId,
    accessToken,
    invoiceId,
  }) {
    const endpoint = `${normalizeQuickBooksApiBaseUrl(apiBaseUrl)}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(invoiceId)}/pdf?minorversion=75`
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/pdf',
      },
    })

    if (response.status === 401) {
      throw Object.assign(new Error('QuickBooks access token is no longer valid.'), { status: 401 })
    }

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      const fallbackMessage = sanitizeQuickBooksTokenText(responseText || '', 240)
      throw Object.assign(
        new Error(
          `QuickBooks invoice PDF download failed: ${fallbackMessage || `status ${response.status}`}`,
        ),
        { status: response.status },
      )
    }

    const contentType = String(response.headers.get('content-type') ?? '').trim() || 'application/pdf'
    const buffer = Buffer.from(await response.arrayBuffer())

    return {
      contentType,
      buffer,
    }
  }

  function escapeQuickBooksString(value) {
    return String(value ?? '').replace(/'/g, "\\'")
  }

  // ---- Helpers ----------------------------------------------------------

  function normalizeJobLookupValue(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  }

  function extractJobDigits(value) {
    const digits = String(value ?? '').replace(/\D+/g, '').trim()
    return digits || null
  }

  function buildJobLookupValues(values) {
    const normalizedValues = new Set()
    const digitValues = new Set()

    ;(Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = normalizeJobLookupValue(value)
      if (normalized) {
        normalizedValues.add(normalized)
      }
      const digits = extractJobDigits(value)
      if (digits) {
        digitValues.add(digits)
      }
    })

    return { normalizedValues, digitValues }
  }

  function doesJobNameMatchLookup(jobName, lookup) {
    const normalized = normalizeJobLookupValue(jobName)
    if (normalized && lookup.normalizedValues.has(normalized)) {
      return true
    }
    const digits = extractJobDigits(jobName)
    return digits ? lookup.digitValues.has(digits) : false
  }

  function getEntryRegularHours(entry) {
    const value = Number(entry?.hours)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  function getEntryOvertimeHours(entry) {
    const value = Number(entry?.overtimeHours)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  function getEntryRate(entry, workerDocument) {
    const snapshot = Number(entry?.payRate)
    if (Number.isFinite(snapshot) && snapshot > 0) {
      return snapshot
    }
    const fallback = Number(workerDocument?.hourlyRate)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  }

  function extractJobNumber(orderDocument) {
    const explicit = String(orderDocument?.jobNumber ?? '').trim()
    if (explicit) {
      return explicit
    }
    const matched = String(orderDocument?.orderName ?? '').trim().match(/\b\d{4,}\b/)
    if (matched?.[0]) {
      return matched[0]
    }
    return String(orderDocument?.mondayItemId ?? '').trim()
  }

  function upsertLaborTotals(targetMap, key, totals) {
    if (!key) {
      return
    }
    const existing = targetMap.get(key) ?? { totalHours: 0, totalLaborCost: 0 }
    existing.totalHours += Number(totals?.totalHours ?? 0)
    existing.totalLaborCost = toMoney(existing.totalLaborCost + Number(totals?.totalLaborCost ?? 0))
    targetMap.set(key, existing)
  }

  function resolveBestLaborTotals(candidates, byNormalizedJob, byDigits) {
    const normalizedValues = candidates?.normalizedValues instanceof Set
      ? [...candidates.normalizedValues]
      : []
    const digitValues = candidates?.digitValues instanceof Set
      ? [...candidates.digitValues]
      : []

    const normalizedMatches = normalizedValues
      .map((value) => byNormalizedJob.get(value))
      .filter(Boolean)
    if (normalizedMatches.length > 0) {
      return normalizedMatches.reduce((best, next) => {
        if (!best) {
          return next
        }
        return Number(next.totalHours) > Number(best.totalHours) ? next : best
      }, null)
    }

    const digitMatches = digitValues
      .map((value) => byDigits.get(value))
      .filter(Boolean)

    if (digitMatches.length > 0) {
      return digitMatches.reduce((best, next) => {
        if (!best) {
          return next
        }
        return Number(next.totalHours) > Number(best.totalHours) ? next : best
      }, null)
    }

    return null
  }

  async function buildLaborTotalsLookups(entriesCollection, workersCollection) {
    const [entryDocuments, workerDocuments] = await Promise.all([
      entriesCollection.find(
        {},
        {
          projection: {
            _id: 0,
            workerId: 1,
            jobName: 1,
            hours: 1,
            overtimeHours: 1,
            payRate: 1,
          },
        },
      ).toArray(),
      workersCollection.find({}, { projection: { _id: 0, id: 1, hourlyRate: 1 } }).toArray(),
    ])

    const workersById = new Map(workerDocuments.map((worker) => [String(worker?.id ?? '').trim(), worker]))
    const byNormalizedJob = new Map()
    const byDigits = new Map()

    for (const entry of entryDocuments) {
      const jobName = String(entry?.jobName ?? '').trim()
      const normalizedJobName = normalizeJobLookupValue(jobName)
      if (!normalizedJobName) {
        continue
      }

      const regularHours = getEntryRegularHours(entry)
      const overtimeHours = getEntryOvertimeHours(entry)
      const totalHours = regularHours + overtimeHours
      const worker = workersById.get(String(entry?.workerId ?? '').trim()) ?? null
      const rate = getEntryRate(entry, worker)
      const totalLaborCost = toMoney(regularHours * rate + overtimeHours * rate * 1.5)
      const totals = { totalHours, totalLaborCost }

      upsertLaborTotals(byNormalizedJob, normalizedJobName, totals)

      const digits = extractJobDigits(jobName)
      if (digits) {
        upsertLaborTotals(byDigits, digits, totals)
      }
    }

    return { byDigits, byNormalizedJob }
  }

  async function getLaborTotalsLookups(entriesCollection, workersCollection) {
    const now = Date.now()

    if (cachedLaborLookups && now < cachedLaborLookupsExpiresAt) {
      return cachedLaborLookups
    }

    const freshLookups = await buildLaborTotalsLookups(entriesCollection, workersCollection)
    cachedLaborLookups = freshLookups
    cachedLaborLookupsExpiresAt = now + laborLookupsCacheTtlMs

    return freshLookups
  }

  function normalizeProgressDetailOptions(options) {
    return [...new Set(
      (Array.isArray(options) ? options : [])
        .map((option) => {
          if (typeof option === 'string') {
            return String(option).trim()
          }

          if (option && typeof option === 'object') {
            return String(option?.label ?? '').trim()
          }

          return ''
        })
        .filter(Boolean),
    )]
  }

  function normalizeProgressDetailOptionStyles(optionStyles) {
    const stylesByLabel = new Map()

    ;(Array.isArray(optionStyles) ? optionStyles : []).forEach((entry) => {
      const label = String(
        (entry && typeof entry === 'object')
          ? entry?.label
          : entry,
      ).trim()

      if (!label || stylesByLabel.has(label)) {
        return
      }

      const normalizedEntry = entry && typeof entry === 'object'
        ? entry
        : {}
      const color = String(normalizedEntry?.color ?? '').trim() || null
      const border = String(normalizedEntry?.border ?? '').trim() || null
      const varName = String(
        normalizedEntry?.varName
        ?? normalizedEntry?.var_name
        ?? '',
      ).trim() || null

      stylesByLabel.set(label, {
        label,
        color,
        border,
        varName,
      })
    })

    return [...stylesByLabel.values()]
  }

  function normalizeProgressStatusDetails(details, optionsByColumnId = {}) {
    return (Array.isArray(details) ? details : []).map((entry) => {
      const columnId = String(entry?.columnId ?? '').trim() || null
      const metadataOptions = columnId
        ? optionsByColumnId?.[columnId]
        : []
      const optionStyles = normalizeProgressDetailOptionStyles([
        ...normalizeProgressDetailOptionStyles(metadataOptions),
        ...normalizeProgressDetailOptionStyles(entry?.optionStyles),
      ])
      const options = normalizeProgressDetailOptions([
        ...normalizeProgressDetailOptions(metadataOptions),
        ...normalizeProgressDetailOptions(entry?.options),
        ...optionStyles.map((style) => style.label),
      ])

      return {
        key: String(entry?.key ?? '').trim() || null,
        label: String(entry?.label ?? '').trim() || null,
        weight: Number.isFinite(Number(entry?.weight)) ? Number(entry.weight) : 0,
        columnId,
        status: String(entry?.status ?? '').trim() || null,
        options,
        optionStyles,
      }
    })
  }

  function resolveRowStatusLabel({ hasMondayRecord, inDesign, isShipped, mondayStatus }) {
    if (!hasMondayRecord && !inDesign) {
      return 'Not in Monday'
    }

    if (isShipped) {
      return 'Shipped'
    }

    if (inDesign) {
      return 'In Design'
    }

    return String(mondayStatus ?? '').trim() || 'Open'
  }

  function extractProgressStatusColumnIds(candidateDetails) {
    return [...new Set(
      (Array.isArray(candidateDetails) ? candidateDetails : [])
        .map((entry) => String(entry?.columnId ?? '').trim())
        .filter(Boolean),
    )]
  }

  function normalizeOrderNumberInput(value) {
    return normalizeOptionalShortText(value, 120)
  }

  function normalizeOrderChatUidList(input, maxItems = 25) {
    const sourceItems = Array.isArray(input)
      ? input
      : [input]
    const seen = new Set()
    const normalized = []

    for (const rawValue of sourceItems) {
      const value = normalizeOptionalShortText(rawValue, 200)

      if (!value || seen.has(value)) {
        continue
      }

      seen.add(value)
      normalized.push(value)

      if (normalized.length >= maxItems) {
        break
      }
    }

    return normalized
  }

  function normalizeOrderChatReminderDate(value) {
    const normalized = String(normalizeOptionalShortText(value, 16) ?? '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return ''
    }

    const parsed = new Date(`${normalized}T00:00:00.000Z`)

    if (Number.isNaN(parsed.getTime())) {
      return ''
    }

    return normalized
  }

  function normalizeOrderChatReminderInput(input) {
    const source = input && typeof input === 'object'
      ? input
      : {}
    const dueDate = normalizeOrderChatReminderDate(source.dueDate)

    if (!dueDate) {
      return null
    }

    return {
      dueDate,
      note: normalizeOptionalShortText(source.note, 500) || null,
      targetUserUids: normalizeOrderChatUidList(source.targetUserUids, 25),
    }
  }

  function normalizeOrderChatMessage(value) {
    return String(value ?? '').trim().slice(0, 4000)
  }

  function normalizeOrderChatContext(input) {
    const source = input && typeof input === 'object'
      ? input
      : {}

    return {
      orderNumber: normalizeOrderNumberInput(source.orderNumber) || null,
      mondayItemId: normalizeOptionalShortText(source.mondayItemId, 120) || null,
      orderName: normalizeOptionalShortText(source.orderName, 250) || null,
    }
  }

  function normalizeOrderChatOffset(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0
    }

    return Math.floor(parsed)
  }

  function normalizeOrderChatLimit(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 150
    }

    return Math.min(500, Math.max(1, Math.floor(parsed)))
  }

  async function getOrdersChatsCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const ordersDatabase = collections?.databasesByDomain?.orders

    if (!ordersDatabase) {
      throw new Error('Orders database is unavailable.')
    }

    const ordersChatsCollection = ordersDatabase.collection('orders_chats')

    if (!ordersChatsIndexesPromise) {
      ordersChatsIndexesPromise = Promise.all([
        ordersChatsCollection.createIndex({ id: 1 }, { unique: true }),
        ordersChatsCollection.createIndex({ orderId: 1, createdAt: 1 }),
        ordersChatsCollection.createIndex({ 'reminder.dueDate': 1, 'reminder.notifiedAt': 1 }),
        ordersChatsCollection.createIndex({ createdAt: -1 }),
      ])
    }

    try {
      await ordersChatsIndexesPromise
    } catch (error) {
      ordersChatsIndexesPromise = undefined
      throw error
    }

    return ordersChatsCollection
  }

  function canManageOrderChatMessage({ publicUser, authUser, chatMessage }) {
    if (publicUser?.isApproved && publicUser?.isAdmin) {
      return true
    }

    const requesterUid = normalizeOptionalShortText(authUser?.uid, 200)
    const requesterEmail = normalizeEmail(authUser?.email)
    const createdByUid = normalizeOptionalShortText(chatMessage?.createdByUid, 200)
    const createdByEmail = normalizeEmail(chatMessage?.createdByEmail)

    return Boolean(
      (requesterUid && createdByUid && requesterUid === createdByUid)
      || (requesterEmail && createdByEmail && requesterEmail === createdByEmail),
    )
  }

  async function createOrderChatInAppAlert({
    mobileAlertsCollection,
    title,
    message,
    createdByUid,
    createdByEmail,
    recipientUids,
    metadata,
  }) {
    if (!Array.isArray(recipientUids) || recipientUids.length === 0) {
      return
    }

    const now = new Date().toISOString()

    await mobileAlertsCollection.insertOne({
      id: randomUUID(),
      title,
      message,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: createdByUid || null,
      createdByEmail: createdByEmail || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: metadata && typeof metadata === 'object'
        ? metadata
        : {},
      createdAt: now,
      updatedAt: now,
    })
  }

  function hasLinkedOrderNumberBlockers(linkState) {
    return Boolean(
      linkState?.hasTimesheetEntries
      || linkState?.hasTimesheetProgressHistory
      || linkState?.hasQuickBooksRecordOnOrder
      || linkState?.hasQuickBooksOrderForCurrentNumber
      || linkState?.hasQuickBooksOrderForNextNumber,
    )
  }

  async function resolveOrderNumberChangeLinkState({
    entriesCollection,
    orderProgressCollection,
    ordersUnifiedCollection,
    mondayItemId,
    currentOrderNumber,
    nextOrderNumber,
    hasQuickBooksRecordOnOrder,
  }) {
    const normalizedCurrentOrderNumber = normalizeOrderNumberInput(currentOrderNumber)
    const normalizedNextOrderNumber = normalizeOrderNumberInput(nextOrderNumber)
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    const timesheetEntriesPromise = normalizedCurrentOrderNumber
      ? entriesCollection.countDocuments(
        { jobName: normalizedCurrentOrderNumber },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const timesheetProgressPromise = normalizedCurrentOrderNumber
      ? orderProgressCollection.countDocuments(
        { jobName: normalizedCurrentOrderNumber },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const quickBooksCurrentPromise = normalizedCurrentOrderNumber
      ? ordersUnifiedCollection.countDocuments(
        {
          has_quickbooks_record: true,
          order_number: normalizedCurrentOrderNumber,
        },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const quickBooksNextPromise = normalizedNextOrderNumber
      ? ordersUnifiedCollection.countDocuments(
        {
          has_quickbooks_record: true,
          order_number: normalizedNextOrderNumber,
          ...(normalizedMondayItemId
            ? { monday_item_id: { $ne: normalizedMondayItemId } }
            : {}),
        },
        { limit: 1 },
      )
      : Promise.resolve(0)

    const [
      timesheetEntriesCount,
      timesheetProgressCount,
      quickBooksCurrentCount,
      quickBooksNextCount,
    ] = await Promise.all([
      timesheetEntriesPromise,
      timesheetProgressPromise,
      quickBooksCurrentPromise,
      quickBooksNextPromise,
    ])

    return {
      hasTimesheetEntries: Number(timesheetEntriesCount) > 0,
      hasTimesheetProgressHistory: Number(timesheetProgressCount) > 0,
      hasQuickBooksRecordOnOrder: Boolean(hasQuickBooksRecordOnOrder),
      hasQuickBooksOrderForCurrentNumber: Number(quickBooksCurrentCount) > 0,
      hasQuickBooksOrderForNextNumber: Number(quickBooksNextCount) > 0,
    }
  }

  async function createOrderNumberChangeAdminAlert({
    authUsersCollection,
    mobileAlertsCollection,
    publicUser,
    mondayItemId,
    currentOrderNumber,
    requestedOrderNumber,
    linkedState,
  }) {
    const adminUsers = await authUsersCollection
      .find(
        {
          approvalStatus: authApprovalApproved,
          role: authRoleAdmin,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      .toArray()

    const recipientUids = adminUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => Boolean(user?.uid && user.isApproved && user.isAdmin))
      .map((user) => String(user.uid))

    if (recipientUids.length === 0) {
      throw {
        status: 404,
        message: 'No approved admin recipients found.',
      }
    }

    const senderLabel = normalizeOptionalShortText(publicUser?.displayName, 120)
      || normalizeOptionalShortText(publicUser?.email, 200)
      || 'A team member'
    const currentValue = normalizeOrderNumberInput(currentOrderNumber) || '(unknown)'
    const nextValue = normalizeOrderNumberInput(requestedOrderNumber) || '(unknown)'

    const reasonParts = []

    if (linkedState?.hasTimesheetEntries || linkedState?.hasTimesheetProgressHistory) {
      reasonParts.push('linked to timesheet history')
    }

    if (
      linkedState?.hasQuickBooksRecordOnOrder
      || linkedState?.hasQuickBooksOrderForCurrentNumber
      || linkedState?.hasQuickBooksOrderForNextNumber
    ) {
      reasonParts.push('linked in QuickBooks')
    }

    const reasonText = reasonParts.length > 0
      ? ` Blocked reason: ${reasonParts.join(' and ')}.`
      : ''
    const now = new Date().toISOString()
    const alertDocument = {
      id: randomUUID(),
      title: 'Order Number Change Request',
      message:
        `${senderLabel} requested order number change ${currentValue} -> ${nextValue} for Monday item ${mondayItemId}.`
        + reasonText,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: String(publicUser?.uid ?? '').trim() || null,
      createdByEmail: normalizeEmail(publicUser?.email) || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: {
        type: 'orders_order_number_change_request',
        mondayItemId: String(mondayItemId ?? '').trim() || null,
        currentOrderNumber: currentValue,
        requestedOrderNumber: nextValue,
        sourceUid: String(publicUser?.uid ?? '').trim() || null,
        sourceEmail: normalizeEmail(publicUser?.email) || null,
        linkedState,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return alertDocument
  }

  async function createOrdersMovedToShippedOutsideWebsiteAdminAlert({
    authUsersCollection,
    mobileAlertsCollection,
    publicUser,
    refreshSummary,
  }) {
    const rawDetectedOrders = Array.isArray(refreshSummary?.mondayMovedToShippedOutsideWebsiteOrders)
      ? refreshSummary.mondayMovedToShippedOutsideWebsiteOrders
      : []
    const detectedOrders = rawDetectedOrders
      .map((entry) => ({
        orderKey: normalizeOptionalShortText(entry?.orderKey, 200) || null,
        orderNumber: normalizeOrderNumberInput(entry?.orderNumber) || null,
        orderName: normalizeOptionalShortText(entry?.orderName, 260) || null,
        mondayItemId: normalizeOptionalShortText(entry?.mondayItemId, 120) || null,
        mondayItemUrl: normalizeOptionalShortText(entry?.mondayItemUrl, 500) || null,
        shippedAt: normalizeOptionalShortText(entry?.shippedAt, 80) || null,
      }))
      .filter((entry) => Boolean(entry.orderKey || entry.mondayItemId || entry.orderNumber))
      .slice(0, 100)

    const detectedCountRaw = Number(refreshSummary?.mondayMovedToShippedOutsideWebsiteCount)
    const detectedCount = Number.isFinite(detectedCountRaw)
      ? Math.max(0, Math.floor(detectedCountRaw))
      : detectedOrders.length

    if (detectedCount <= 0 || detectedOrders.length === 0) {
      return null
    }

    const adminUsers = await authUsersCollection
      .find(
        {
          approvalStatus: authApprovalApproved,
          role: authRoleAdmin,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      .toArray()

    const recipientUids = adminUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => Boolean(user?.uid && user.isApproved && user.isAdmin))
      .map((user) => String(user.uid))

    if (recipientUids.length === 0) {
      return null
    }

    const senderLabel = normalizeOptionalShortText(publicUser?.displayName, 120)
      || normalizeOptionalShortText(publicUser?.email, 200)
      || 'A team member'
    const sampleLabels = detectedOrders
      .slice(0, 6)
      .map((entry) => entry.orderNumber || entry.mondayItemId || entry.orderKey)
      .filter(Boolean)
    const overflowCount = Math.max(0, detectedCount - sampleLabels.length)
    const sampleText = sampleLabels.join(', ')
    const now = new Date().toISOString()

    const alertDocument = {
      id: randomUUID(),
      title: 'Orders: Direct Monday Shipping Detected',
      message:
        `${senderLabel} refreshed orders and detected ${detectedCount} order(s) moved from Order Track to Shipped directly in Monday (outside website shipping flow).`
        + (sampleText ? ` Orders: ${sampleText}` : '')
        + (overflowCount > 0 ? `, +${overflowCount} more.` : '.'),
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: String(publicUser?.uid ?? '').trim() || null,
      createdByEmail: normalizeEmail(publicUser?.email) || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: {
        type: 'orders_monday_direct_ship_detected',
        detectedCount,
        refreshedAt: normalizeOptionalShortText(refreshSummary?.refreshedAt, 80) || now,
        sourceUid: String(publicUser?.uid ?? '').trim() || null,
        sourceEmail: normalizeEmail(publicUser?.email) || null,
        orders: detectedOrders,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return alertDocument
  }

  async function resolveMondayOrderContext({
    mondayItemId,
    mondayOrdersCollection,
    ordersUnifiedCollection,
  }) {
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    if (!normalizedMondayItemId) {
      return null
    }

    const [unifiedDocument, mondayOrderDocument] = await Promise.all([
      ordersUnifiedCollection.findOne(
        { monday_item_id: normalizedMondayItemId },
        {
          projection: {
            _id: 0,
            monday_item_id: 1,
            monday_board_id: 1,
            monday_board_name: 1,
            Monday_url: 1,
            has_monday_record: 1,
            in_design: 1,
            is_shipped: 1,
            Monday_status: 1,
            progress_status_details: 1,
          },
        },
      ),
      mondayOrdersCollection.findOne(
        { mondayItemId: normalizedMondayItemId },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            mondayBoardId: 1,
            mondayBoardName: 1,
            mondayBoardUrl: 1,
            statusLabel: 1,
            progressStatusDetails: 1,
          },
        },
      ),
    ])

    const boardId = String(
      unifiedDocument?.monday_board_id
      ?? mondayOrderDocument?.mondayBoardId
      ?? '',
    ).trim() || null
    const boardName = String(
      mondayOrderDocument?.mondayBoardName
      ?? unifiedDocument?.monday_board_name
      ?? '',
    ).trim() || null
    const boardUrl = String(mondayOrderDocument?.mondayBoardUrl ?? '').trim() || null
    const hasMondayRecord = Boolean(
      unifiedDocument?.has_monday_record
      ?? mondayOrderDocument,
    )
    const inDesign = Boolean(unifiedDocument?.in_design)
    const isShipped = Boolean(unifiedDocument?.is_shipped)
    const mondayStatus = String(
      unifiedDocument?.Monday_status
      ?? mondayOrderDocument?.statusLabel
      ?? '',
    ).trim() || null
    const rawProgressStatusDetails =
      (Array.isArray(unifiedDocument?.progress_status_details)
        ? unifiedDocument.progress_status_details
        : null)
      || (Array.isArray(mondayOrderDocument?.progressStatusDetails)
        ? mondayOrderDocument.progressStatusDetails
        : [])

    return {
      mondayItemId: normalizedMondayItemId,
      boardId,
      boardName,
      boardUrl,
      hasMondayRecord,
      inDesign,
      isShipped,
      mondayStatus,
      rawProgressStatusDetails,
    }
  }

  async function pullLiveMondayProgressDetails({
    boardId,
    boardName,
    boardUrl,
    mondayItemId,
  }) {
    const snapshot = await fetchMondayBoardItemsByIds({
      boardId,
      boardName,
      boardUrl,
      itemIds: [mondayItemId],
    })

    const liveOrder = Array.isArray(snapshot?.orders) ? snapshot.orders[0] : null

    if (!liveOrder) {
      throw {
        status: 404,
        message: 'Monday item was not found on the configured board.',
      }
    }

    const progressStatusColumnIds = extractProgressStatusColumnIds(liveOrder?.progressStatusDetails)
    const optionsByColumnId = progressStatusColumnIds.length > 0
      ? await fetchMondayStatusColumnOptions({
        boardId,
        columnIds: progressStatusColumnIds,
      })
      : {}

    return {
      liveOrder,
      resolvedBoardName: String(snapshot?.board?.name ?? boardName ?? '').trim() || null,
      resolvedBoardUrl: String(snapshot?.board?.url ?? boardUrl ?? '').trim() || null,
      progressStatusDetails: normalizeProgressStatusDetails(
        liveOrder?.progressStatusDetails,
        optionsByColumnId,
      ),
    }
  }

  async function syncMondayProgressDetailsToCollections({
    mondayItemId,
    boardId,
    boardName,
    boardUrl,
    liveOrder,
    progressStatusDetails,
    mondayOrdersCollection,
    ordersUnifiedCollection,
  }) {
    const now = new Date().toISOString()
    const mondayStatus = String(liveOrder?.statusLabel ?? '').trim() || null
    const mondayUpdatedAt = String(liveOrder?.updatedAt ?? '').trim() || now
    const isShipped = Boolean(liveOrder?.isDone || liveOrder?.shippedAt)
    const liveShippedAt = String(liveOrder?.shippedAt ?? '').trim() || null
    const shippedSetFields = liveShippedAt
      ? {
        shipped_at: liveShippedAt,
        shipped_at_inferred: false,
      }
      : isShipped
        ? {
          shipped_at_inferred: true,
        }
        : {
          shipped_at: null,
          shipped_at_inferred: null,
        }

    await Promise.all([
      mondayOrdersCollection.updateOne(
        { mondayItemId },
        {
          $set: {
            mondayItemId,
            mondayBoardId: boardId,
            mondayBoardName: boardName,
            mondayBoardUrl: boardUrl,
            statusLabel: mondayStatus,
            stageLabel: String(liveOrder?.stageLabel ?? '').trim() || null,
            readyLabel: String(liveOrder?.readyLabel ?? '').trim() || null,
            progressStatusDetails,
            progressPercent: Number.isFinite(Number(liveOrder?.progressPercent))
              ? Number(liveOrder.progressPercent)
              : null,
            orderDate: String(liveOrder?.orderDate ?? '').trim() || null,
            dueDate: String(liveOrder?.dueDate ?? '').trim() || null,
            computedDueDate: String(liveOrder?.computedDueDate ?? '').trim() || null,
            effectiveDueDate: String(liveOrder?.effectiveDueDate ?? '').trim() || null,
            leadTimeDays: Number.isFinite(Number(liveOrder?.leadTimeDays))
              ? Number(liveOrder.leadTimeDays)
              : null,
            shippedAt: String(liveOrder?.shippedAt ?? '').trim() || null,
            isDone: isShipped,
            isLate: Boolean(liveOrder?.isLate),
            daysLate: Number.isFinite(Number(liveOrder?.daysLate))
              ? Number(liveOrder.daysLate)
              : 0,
            mondayItemUrl: String(liveOrder?.itemUrl ?? '').trim() || null,
            mondayUpdatedAt,
            updatedAt: now,
            lastSeenAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      ),
      ordersUnifiedCollection.updateOne(
        { monday_item_id: mondayItemId },
        {
          $set: {
            has_monday_record: true,
            monday_item_id: mondayItemId,
            monday_board_id: boardId,
            monday_board_name: boardName,
            Monday_url: String(liveOrder?.itemUrl ?? '').trim() || null,
            Monday_status: isShipped ? 'Shipped' : mondayStatus,
            is_shipped: isShipped,
            ...shippedSetFields,
            Due_date:
              String(liveOrder?.effectiveDueDate ?? '').trim()
              || String(liveOrder?.dueDate ?? '').trim()
              || String(liveOrder?.computedDueDate ?? '').trim()
              || null,
            Lead_time_days: Number.isFinite(Number(liveOrder?.leadTimeDays))
              ? Number(liveOrder.leadTimeDays)
              : null,
            progress_percent: Number.isFinite(Number(liveOrder?.progressPercent))
              ? Number(liveOrder.progressPercent)
              : null,
            progress_status_details: progressStatusDetails,
            order_date: String(liveOrder?.orderDate ?? '').trim() || null,
            monday_updated_at: mondayUpdatedAt,
            updatedAt: now,
            lastSyncedAt: now,
          },
        },
      ),
    ])

    return {
      mondayStatus,
      mondayUpdatedAt,
      isShipped,
    }
  }

  function buildMondayProgressDetailsResponse({
    hasMondayRecord,
    inDesign,
    isShipped,
    liveOrder,
    mondayItemId,
    mondayStatus,
    mondayUpdatedAt,
    progressStatusDetails,
  }) {
    return {
      generatedAt: new Date().toISOString(),
      order: {
        mondayItemId,
        mondayStatus,
        rowStatus: resolveRowStatusLabel({
          hasMondayRecord,
          inDesign,
          isShipped,
          mondayStatus,
        }),
        progressPercent: Number.isFinite(Number(liveOrder?.progressPercent))
          ? Number(liveOrder.progressPercent)
          : null,
        progressStatusDetails,
        mondayUpdatedAt,
      },
    }
  }

  function mapUnifiedOrderDocumentToOverviewRow(orderDocument, laborLookups) {
    const hasMondayRecord = Boolean(orderDocument?.has_monday_record)
    const hasQuickBooksRecord = Boolean(orderDocument?.has_quickbooks_record)
    const orderNumber = String(orderDocument?.order_number ?? '').trim()
    const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()
    const quickBooksProjectId = String(orderDocument?.qb_project_id ?? '').trim()
    const quickBooksProjectName = String(orderDocument?.qb_project_name ?? '').trim()
    const quickBooksProjectIds = [
      ...new Set(
        [
          quickBooksProjectId,
          ...(Array.isArray(orderDocument?.qb_project_ids)
            ? orderDocument.qb_project_ids.map((value) => String(value ?? '').trim())
            : []),
        ].filter(Boolean),
      ),
    ]
    const quickBooksProjectNames = [
      ...new Set(
        [
          quickBooksProjectName,
          ...(Array.isArray(orderDocument?.qb_project_names)
            ? orderDocument.qb_project_names.map((value) => String(value ?? '').trim())
            : []),
        ].filter(Boolean),
      ),
    ]
    const primaryQuickBooksProjectId = quickBooksProjectIds[0] || ''
    const primaryQuickBooksProjectName = quickBooksProjectNames[0] || ''
    const resolvedOrderNumber = orderNumber || mondayItemId || primaryQuickBooksProjectId
    const statusHistory = (Array.isArray(orderDocument?.status) ? orderDocument.status : [])
      .map((entry) => ({
        id: String(entry?.id ?? '').trim() || null,
        date: String(entry?.date ?? '').trim() || null,
        jobName: String(entry?.jobName ?? '').trim() || null,
        readyPercent: Number.isFinite(Number(entry?.readyPercent)) ? Number(entry.readyPercent) : null,
        updatedAt: String(entry?.updatedAt ?? '').trim() || null,
      }))
    const progressStatusDetails = normalizeProgressStatusDetails(
      orderDocument?.progress_status_details,
    )

    const sourceValue = String(orderDocument?.source ?? '').trim().toLowerCase()
    const source =
      sourceValue === 'quickbooks' || sourceValue === 'monday' || sourceValue === 'merged'
        ? sourceValue
        : hasMondayRecord
          ? 'monday'
          : 'quickbooks'

    const isShipped = Boolean(orderDocument?.is_shipped)
    const mondayStatus = String(orderDocument?.Monday_status ?? '').trim() || null
    const inDesign = Boolean(orderDocument?.in_design)
    const hazardReason = String(orderDocument?.hazard_reason ?? '').trim()
      || (!hasMondayRecord && !inDesign
        ? 'Not found in Monday Order Track.'
        : !hasQuickBooksRecord
          ? 'Not found in QuickBooks projects.'
          : null)
    const amountOwed = Number.isFinite(Number(orderDocument?.amountOwed))
      ? Number(orderDocument.amountOwed)
      : null
    const billBalanceAmount =
      orderDocument?.billBalanceAmount !== null
      && orderDocument?.billBalanceAmount !== undefined
      && Number.isFinite(Number(orderDocument?.billBalanceAmount))
      ? Number(orderDocument.billBalanceAmount)
      : null
    const paidInFull =
      typeof orderDocument?.paidInFull === 'boolean'
        ? Boolean(orderDocument.paidInFull)
        : Number.isFinite(amountOwed)
          ? amountOwed <= 0.004
          : null
    const rowStatus = resolveRowStatusLabel({ hasMondayRecord, inDesign, isShipped, mondayStatus })
    const laborCandidates = buildJobLookupValues([
      resolvedOrderNumber,
      String(orderDocument?.order_name ?? '').trim(),
      mondayItemId,
      ...quickBooksProjectIds,
      ...quickBooksProjectNames,
    ])
    const laborTotals = laborLookups
      ? resolveBestLaborTotals(
        laborCandidates,
        laborLookups.byNormalizedJob,
        laborLookups.byDigits,
      )
      : null

    return {
      id: String(orderDocument?.orderKey ?? resolvedOrderNumber).trim() || resolvedOrderNumber,
      mondayItemId,
      orderNumber: resolvedOrderNumber,
      jobNumber: resolvedOrderNumber,
      orderName: String(orderDocument?.order_name ?? '').trim() || null,
      shipTo: String(orderDocument?.ship_to ?? '').trim() || null,
      shipNotes: String(orderDocument?.ship_notes ?? '').trim() || null,
      bol: String(orderDocument?.bol ?? '').trim() || null,
      bolCachedUrl: String(orderDocument?.BOL_cached ?? '').trim() || null,
      bolUrl:
        String(orderDocument?.BOL_source ?? '').trim()
        || String(orderDocument?.BOL ?? '').trim()
        || null,
      signedBol: String(orderDocument?.signed_bol ?? '').trim() || null,
      signedBolUrl:
        String(orderDocument?.Signed_BOL_source ?? '').trim()
        || String(orderDocument?.Signed_BOL ?? '').trim()
        || null,
      inspectionSheet: String(orderDocument?.inspection_sheet ?? '').trim() || null,
      inspectionSheetUrl:
        String(orderDocument?.Inspection_sheet_source ?? '').trim()
        || String(orderDocument?.Inspection_sheet ?? '').trim()
        || null,
      poNumber: String(orderDocument?.po_number ?? '').trim() || null,
      notes: String(orderDocument?.monday_notes ?? '').trim() || null,
      description: String(orderDocument?.monday_description ?? '').trim() || null,
      poAmount: Number.isFinite(Number(orderDocument?.poAmount)) ? Number(orderDocument.poAmount) : null,
      billedAmount: Number.isFinite(Number(orderDocument?.billedAmount))
        ? Number(orderDocument.billedAmount)
        : Number.isFinite(Number(orderDocument?.billAmount))
          ? Number(orderDocument.billAmount)
          : null,
      invoiceAmount: Number.isFinite(Number(orderDocument?.invoiceAmount)) ? Number(orderDocument.invoiceAmount) : null,
      invoiceNumber: String(orderDocument?.invoiceNumber ?? '').trim() || null,
      invoiceCachedUrl: String(orderDocument?.invoice_pdf_cached_url ?? '').trim() || null,
      invoiceFileName: String(orderDocument?.invoice_pdf_file_name ?? '').trim() || null,
      paidInFull,
      amountOwed,
      billBalanceAmount,
      totalHours: laborTotals ? Number(Number(laborTotals.totalHours).toFixed(2)) : null,
      totalLaborCost: laborTotals ? toMoney(laborTotals.totalLaborCost) : null,
      orderDate: String(orderDocument?.order_date ?? '').trim() || null,
      mondayStatus,
      rowStatus,
      managerReadyPercent: Number.isFinite(Number(orderDocument?.manager_ready_percent))
        ? Number(orderDocument.manager_ready_percent)
        : null,
      managerReadyDate: String(orderDocument?.manager_ready_date ?? '').trim() || null,
      managerReadyUpdatedAt: String(orderDocument?.manager_ready_updated_at ?? '').trim() || null,
      progressPercent: Number.isFinite(Number(orderDocument?.progress_percent))
        ? Number(orderDocument.progress_percent)
        : null,
      progressStatusDetails,
      leadTimeDays: Number.isFinite(Number(orderDocument?.Lead_time_days))
        ? Number(orderDocument.Lead_time_days)
        : null,
      statusHistory,
      isShipped,
      shippedAt: String(orderDocument?.shipped_at ?? '').trim() || null,
      shippedAtInferred:
        typeof orderDocument?.shipped_at_inferred === 'boolean'
          ? Boolean(orderDocument.shipped_at_inferred)
          : null,
      mondayBoardId: String(orderDocument?.monday_board_id ?? '').trim() || null,
      mondayBoardName: String(orderDocument?.monday_board_name ?? '').trim() || null,
      mondayUpdatedAt: String(orderDocument?.monday_updated_at ?? '').trim() || null,
      mondayItemUrl: String(orderDocument?.Monday_url ?? '').trim() || null,
      dueDate: String(orderDocument?.Due_date ?? '').trim() || null,
      shopDrawingCachedUrl: String(orderDocument?.Shop_drawing_cached ?? '').trim() || null,
      shopDrawingUrl:
        String(orderDocument?.Shop_drawing_source ?? '').trim()
        || String(orderDocument?.Shop_drawing ?? '').trim()
        || null,
      cutListCachedUrl: String(orderDocument?.Cut_list_cached ?? '').trim() || null,
      cutListUrl:
        String(orderDocument?.Cut_list_source ?? '').trim()
        || String(orderDocument?.Cut_list ?? '').trim()
        || null,
      source,
      hasMondayRecord,
      hasQuickBooksRecord,
      inDesign,
      quickBooksProjectId: primaryQuickBooksProjectId || null,
      quickBooksProjectName: primaryQuickBooksProjectName || null,
      quickBooksProjectIds,
      quickBooksProjectNames,
      hazardReason,
    }
  }

  // ---- Routes -----------------------------------------------------------

  // GET /api/orders/overview — pure DB read. Never triggers Monday/QB.
  app.get('/api/orders/overview', requireFirebaseAuth, async (_req, res, next) => {
    try {
      const {
        dashboardSnapshotsCollection,
        entriesCollection,
        ordersUnifiedCollection,
        workersCollection,
      } = await getCollections()

      const unifiedOrderDocuments = await ordersUnifiedCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              monday_item_id: 1,
              Monday_url: 1,
              Monday_status: 1,
              order_name: 1,
              ship_to: 1,
              ship_notes: 1,
              bol: 1,
              BOL: 1,
              BOL_cached: 1,
              BOL_source: 1,
              signed_bol: 1,
              Signed_BOL: 1,
              Signed_BOL_source: 1,
              inspection_sheet: 1,
              Inspection_sheet: 1,
              Inspection_sheet_source: 1,
              po_number: 1,
              monday_notes: 1,
              monday_description: 1,
              is_shipped: 1,
              status: 1,
              Due_date: 1,
              Lead_time_days: 1,
              progress_percent: 1,
              progress_status_details: 1,
              order_date: 1,
              Shop_drawing: 1,
              Shop_drawing_cached: 1,
              Shop_drawing_source: 1,
              Cut_list: 1,
              Cut_list_cached: 1,
              Cut_list_source: 1,
              amountOwed: 1,
              billBalanceAmount: 1,
              billAmount: 1,
              billedAmount: 1,
              invoiceNumber: 1,
              invoiceAmount: 1,
              invoice_pdf_cached_url: 1,
              invoice_pdf_file_name: 1,
              paidInFull: 1,
              poAmount: 1,
              shipped_at: 1,
              shipped_at_inferred: 1,
              has_monday_record: 1,
              has_quickbooks_record: 1,
              in_design: 1,
              hazard_reason: 1,
              source: 1,
              qb_project_id: 1,
              qb_project_name: 1,
              qb_project_ids: 1,
              qb_project_names: 1,
              monday_board_id: 1,
              monday_board_name: 1,
              monday_updated_at: 1,
              manager_ready_percent: 1,
              manager_ready_date: 1,
              manager_ready_updated_at: 1,
              quickbooks_synced_at: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ is_shipped: 1, Due_date: 1, order_number: 1, updatedAt: -1 })
        .toArray()

      const lastRefreshDoc = await dashboardSnapshotsCollection.findOne(
        { snapshotKey: 'orders_unified_refresh' },
        { projection: { _id: 0, snapshot: 1, updatedAt: 1 } },
      )
      const lastRefresh = lastRefreshDoc?.snapshot ?? null
      const quickBooksSyncedAtFromRows = unifiedOrderDocuments.find((doc) =>
        String(doc?.quickbooks_synced_at ?? '').trim()
      )?.quickbooks_synced_at
      const laborLookups = await getLaborTotalsLookups(entriesCollection, workersCollection)

      const rows = unifiedOrderDocuments.map((doc) => mapUnifiedOrderDocumentToOverviewRow(doc, laborLookups))
      const shippedCount = rows.filter((row) => row.isShipped).length
      const hazardCount = rows.filter((row) => Boolean(row.hazardReason)).length
      const mondayOnlyCount = rows.filter((row) => row.hasMondayRecord && !row.hasQuickBooksRecord).length
      const quickBooksOnlyCount = rows.filter((row) => !row.hasMondayRecord && row.hasQuickBooksRecord).length

      return res.json({
        generatedAt: new Date().toISOString(),
        lastRefreshedAt:
          String(lastRefresh?.refreshedAt ?? lastRefreshDoc?.updatedAt ?? '').trim() || null,
        lastRefreshWarnings: Array.isArray(lastRefresh?.warnings) ? lastRefresh.warnings : [],
        quickBooksSyncedAt:
          String(lastRefresh?.quickBooksSyncedAt ?? '').trim()
          || String(quickBooksSyncedAtFromRows ?? '').trim()
          || null,
        counts: {
          total: rows.length,
          shipped: shippedCount,
          nonShipped: rows.length - shippedCount,
          hazard: hazardCount,
          mondayOnly: mondayOnlyCount,
          quickBooksOnly: quickBooksOnlyCount,
        },
        orders: rows,
      })
    } catch (error) {
      next(error)
    }
  })

  // GET /api/orders/invoice/download — open cached invoice PDF when available;
  // otherwise fetch once from QuickBooks, store in Firebase Storage + Mongo,
  // and serve the saved version.
  app.get('/api/orders/invoice/download', requireFirebaseAuth, async (req, res, next) => {
    try {
      const orderId = String(req.query?.orderId ?? '').trim()
      const orderNumber = String(req.query?.orderNumber ?? '').trim()

      if (!orderId && !orderNumber) {
        return res.status(400).json({ error: 'orderId or orderNumber is required.' })
      }

      const {
        ordersUnifiedCollection,
        quickBooksTokensCollection,
      } = await getCollections()
      const bucket = typeof getOrderPhotosBucket === 'function' ? getOrderPhotosBucket() : null

      if (!bucket) {
        throw Object.assign(new Error('Order photo storage bucket is unavailable.'), { status: 500 })
      }

      const orderFilters = []

      if (orderId) {
        orderFilters.push({ monday_item_id: orderId })
      }

      if (orderNumber) {
        orderFilters.push({ order_number: orderNumber })
      }

      const orderDocument = await ordersUnifiedCollection.findOne(
        orderFilters.length <= 1
          ? (orderFilters[0] ?? {})
          : { $or: orderFilters },
        {
          projection: {
            _id: 0,
            orderKey: 1,
            monday_item_id: 1,
            order_number: 1,
            invoiceNumber: 1,
            invoice_pdf_cached_url: 1,
            invoice_pdf_file_name: 1,
            invoice_qb_id: 1,
            invoice_qb_doc_number: 1,
          },
        },
      )

      if (!orderDocument) {
        return res.status(404).json({ error: 'Order was not found.' })
      }

      let cachedInvoiceUrl = String(orderDocument?.invoice_pdf_cached_url ?? '').trim()
      let cachedInvoiceFileName = ensurePdfFileName(
        String(orderDocument?.invoice_pdf_file_name ?? '').trim(),
        `${sanitizeStorageSegment(orderDocument?.order_number || orderDocument?.monday_item_id || orderId || orderNumber || 'order')}-invoice.pdf`,
      )

      if (!cachedInvoiceUrl) {
        const invoiceNumberTokens = String(orderDocument?.invoiceNumber ?? '')
          .split(',')
          .map((value) => sanitizeQuickBooksTokenText(value, 180))
          .filter(Boolean)

        if (invoiceNumberTokens.length === 0) {
          return res.status(404).json({ error: 'No invoice number is linked to this order.' })
        }

        const clientId = sanitizeQuickBooksTokenText(process.env.QUICKBOOKS_CLIENT_ID, 300)
        const clientSecret = sanitizeQuickBooksTokenText(process.env.QUICKBOOKS_CLIENT_SECRET, 300)

        if (!clientId || !clientSecret) {
          return res.status(500).json({
            error: 'QuickBooks is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.',
          })
        }

        let tokenDoc = await resolveQuickBooksAccessToken({
          quickBooksTokensCollection,
          clientId,
          clientSecret,
        })
        const realmId = sanitizeQuickBooksTokenText(tokenDoc?.realmId, 160)

        if (!realmId) {
          return res.status(409).json({
            error: 'QuickBooks connection is missing realmId. Reconnect QuickBooks.',
          })
        }

        let apiBaseUrl = normalizeQuickBooksApiBaseUrl(
          sanitizeQuickBooksTokenText(tokenDoc?.apiBaseUrl, 400)
          || sanitizeQuickBooksTokenText(process.env.QUICKBOOKS_API_BASE_URL, 400)
          || quickBooksApiBaseUrlDefault,
        )
        let matchedInvoice = null
        let matchedInvoiceNumber = ''

        for (const invoiceNumberToken of invoiceNumberTokens) {
          const invoiceQuery = `SELECT Id, DocNumber, TxnDate FROM Invoice WHERE DocNumber = '${escapeQuickBooksString(invoiceNumberToken)}' ORDER BY MetaData.LastUpdatedTime DESC STARTPOSITION 1 MAXRESULTS 10`
          let queryPayload = null

          try {
            queryPayload = await quickBooksQuery({
              apiBaseUrl,
              realmId,
              accessToken: tokenDoc.accessToken,
              query: invoiceQuery,
            })
          } catch (error) {
            if (Number(error?.status) !== 401) {
              throw error
            }

            tokenDoc = await resolveQuickBooksAccessToken({
              quickBooksTokensCollection,
              clientId,
              clientSecret,
              forceRefresh: true,
            })
            apiBaseUrl = normalizeQuickBooksApiBaseUrl(
              sanitizeQuickBooksTokenText(tokenDoc?.apiBaseUrl, 400)
              || sanitizeQuickBooksTokenText(process.env.QUICKBOOKS_API_BASE_URL, 400)
              || quickBooksApiBaseUrlDefault,
            )
            queryPayload = await quickBooksQuery({
              apiBaseUrl,
              realmId,
              accessToken: tokenDoc.accessToken,
              query: invoiceQuery,
            })
          }

          const invoiceRows = Array.isArray(queryPayload?.QueryResponse?.Invoice)
            ? queryPayload.QueryResponse.Invoice
            : []

          if (invoiceRows.length > 0) {
            matchedInvoice = invoiceRows[0]
            matchedInvoiceNumber = invoiceNumberToken
            break
          }
        }

        if (!matchedInvoice) {
          return res.status(404).json({
            error: 'Invoice PDF was not found in QuickBooks for this order.',
          })
        }

        const resolvedInvoiceId = sanitizeQuickBooksTokenText(matchedInvoice?.Id, 160)
        const resolvedInvoiceDocNumber = sanitizeQuickBooksTokenText(
          matchedInvoice?.DocNumber,
          160,
        ) || matchedInvoiceNumber

        if (!resolvedInvoiceId) {
          return res.status(404).json({
            error: 'Invoice PDF was not found in QuickBooks for this order.',
          })
        }

        let invoicePdfResult = null

        try {
          invoicePdfResult = await quickBooksDownloadInvoicePdf({
            apiBaseUrl,
            realmId,
            accessToken: tokenDoc.accessToken,
            invoiceId: resolvedInvoiceId,
          })
        } catch (error) {
          if (Number(error?.status) !== 401) {
            throw error
          }

          tokenDoc = await resolveQuickBooksAccessToken({
            quickBooksTokensCollection,
            clientId,
            clientSecret,
            forceRefresh: true,
          })
          apiBaseUrl = normalizeQuickBooksApiBaseUrl(
            sanitizeQuickBooksTokenText(tokenDoc?.apiBaseUrl, 400)
            || sanitizeQuickBooksTokenText(process.env.QUICKBOOKS_API_BASE_URL, 400)
            || quickBooksApiBaseUrlDefault,
          )
          invoicePdfResult = await quickBooksDownloadInvoicePdf({
            apiBaseUrl,
            realmId,
            accessToken: tokenDoc.accessToken,
            invoiceId: resolvedInvoiceId,
          })
        }

        if (!invoicePdfResult?.buffer || invoicePdfResult.buffer.length <= 0) {
          return res.status(404).json({
            error: 'Invoice PDF was not found in QuickBooks for this order.',
          })
        }

        const storageOrderId = sanitizeStorageSegment(
          orderDocument?.monday_item_id
          || orderDocument?.order_number
          || orderId
          || orderNumber,
          'order',
        )
        const docSegment = sanitizeStorageSegment(resolvedInvoiceDocNumber || resolvedInvoiceId, 'invoice')
        cachedInvoiceFileName = ensurePdfFileName(
          `${storageOrderId}-invoice-${docSegment}.pdf`,
          `${storageOrderId}-invoice.pdf`,
        )
        const storagePath = `quickbooks-invoices/${storageOrderId}/${sanitizeDownloadFileName(cachedInvoiceFileName, `${storageOrderId}-invoice.pdf`)}`
        const downloadToken = typeof randomUUID === 'function'
          ? randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
        const now = new Date().toISOString()

        await bucket.file(storagePath).save(invoicePdfResult.buffer, {
          resumable: false,
          metadata: {
            contentType: invoicePdfResult.contentType || 'application/pdf',
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              mondayItemId: sanitizeQuickBooksTokenText(orderDocument?.monday_item_id, 120) || null,
              orderNumber: sanitizeQuickBooksTokenText(orderDocument?.order_number, 120) || null,
              quickBooksInvoiceId: resolvedInvoiceId,
              quickBooksInvoiceNumber: resolvedInvoiceDocNumber,
              syncedAt: now,
            },
          },
        })

        cachedInvoiceUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)

        const resolvedOrderKey = String(orderDocument?.orderKey ?? '').trim()
        const resolvedMondayItemId = String(orderDocument?.monday_item_id ?? '').trim()
        const resolvedOrderNumber = String(orderDocument?.order_number ?? '').trim()
        const invoiceUpdateFilter = resolvedOrderKey
          ? { orderKey: resolvedOrderKey }
          : resolvedMondayItemId
            ? { monday_item_id: resolvedMondayItemId }
            : resolvedOrderNumber
              ? { order_number: resolvedOrderNumber }
              : null

        if (invoiceUpdateFilter) {
          await ordersUnifiedCollection.updateOne(
            invoiceUpdateFilter,
            {
              $set: {
                invoice_pdf_storage_path: storagePath,
                invoice_pdf_cached_url: cachedInvoiceUrl,
                invoice_pdf_cached_at: now,
                invoice_pdf_file_name: cachedInvoiceFileName,
                invoice_qb_id: resolvedInvoiceId,
                invoice_qb_doc_number: resolvedInvoiceDocNumber,
                invoice_pdf_cache_status: 'ready',
                invoice_pdf_cache_error: null,
                updatedAt: now,
              },
            },
          )
        }

        res.setHeader('Content-Type', invoicePdfResult.contentType || 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${cachedInvoiceFileName.replace(/"/g, '')}"`)
        res.setHeader('Cache-Control', 'private, max-age=120')
        return res.status(200).send(invoicePdfResult.buffer)
      }

      const upstreamResponse = await fetch(cachedInvoiceUrl)

      if (!upstreamResponse.ok) {
        return res.status(502).json({
          error: 'Could not load the cached invoice right now.',
        })
      }

      const contentType =
        String(upstreamResponse.headers.get('content-type') ?? '').trim()
        || 'application/pdf'
      const contentLength = String(upstreamResponse.headers.get('content-length') ?? '').trim()
      const buffer = Buffer.from(await upstreamResponse.arrayBuffer())

      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', `inline; filename="${cachedInvoiceFileName.replace(/"/g, '')}"`)
      res.setHeader('Cache-Control', 'private, max-age=120')
      if (contentLength) {
        res.setHeader('Content-Length', contentLength)
      }

      return res.status(200).send(buffer)
    } catch (error) {
      next(error)
    }
  })

  // POST /api/orders/refresh — the one place users explicitly trigger live
  // Monday + QuickBooks pulls. Rate-limited at the app level (1 / 2 min).
  app.post(
    '/api/orders/refresh',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const summary = await refreshOrdersUnifiedCollection()
        const publicUser = toPublicAuthUser(req.authUser)
        const {
          authUsersCollection,
          dashboardSnapshotsCollection,
          mobileAlertsCollection,
        } = await getCollections()

        let refreshAlertWarning = null
        const movedOutsideWebsiteCount = Number(summary?.mondayMovedToShippedOutsideWebsiteCount)

        if (Number.isFinite(movedOutsideWebsiteCount) && movedOutsideWebsiteCount > 0) {
          try {
            await createOrdersMovedToShippedOutsideWebsiteAdminAlert({
              authUsersCollection,
              mobileAlertsCollection,
              publicUser,
              refreshSummary: summary,
            })
          } catch (alertError) {
            refreshAlertWarning =
              normalizeOptionalShortText(alertError?.message, 280)
              || 'Detected direct Monday shipping but failed to notify admins.'
          }
        }

        if (refreshAlertWarning) {
          const existingWarnings = Array.isArray(summary?.warnings) ? summary.warnings : []
          summary.warnings = [...new Set([...existingWarnings, refreshAlertWarning])]
        }

        await dashboardSnapshotsCollection.updateOne(
          { snapshotKey: 'orders_unified_refresh' },
          {
            $set: {
              snapshotKey: 'orders_unified_refresh',
              snapshot: summary,
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        )
        return res.json({ ok: true, summary })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /api/orders/monday/progress-details — pull live Monday status details
  // for one item, including each status column's dropdown options.
  app.get(
    '/api/orders/monday/progress-details',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.query?.mondayItemId ?? '').trim()

        if (!mondayItemId) {
          return res.status(400).json({
            error: 'mondayItemId is required.',
          })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const {
          liveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        return res.json(buildMondayProgressDetailsResponse({
          hasMondayRecord: true,
          inDesign: Boolean(context?.inDesign),
          isShipped: syncResult.isShipped,
          liveOrder,
          mondayItemId,
          mondayStatus: syncResult.mondayStatus,
          mondayUpdatedAt: syncResult.mondayUpdatedAt,
          progressStatusDetails,
        }))
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/progress-status — update a single Monday status
  // column from the Orders popup dropdowns.
  app.post(
    '/api/orders/monday/progress-status',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const columnId = String(req.body?.columnId ?? '').trim()
        const status = String(req.body?.status ?? '').trim()

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!columnId) {
          return res.status(400).json({ error: 'columnId is required.' })
        }

        if (!status) {
          return res.status(400).json({ error: 'status is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const knownColumnIds = extractProgressStatusColumnIds(context.rawProgressStatusDetails)

        if (knownColumnIds.length > 0 && !knownColumnIds.includes(columnId)) {
          return res.status(400).json({
            error: 'Column is not part of this order\'s tracked Monday status columns.',
          })
        }

        const optionsByColumnId = await fetchMondayStatusColumnOptions({
          boardId: context.boardId,
          columnIds: [columnId],
        })
        const allowedOptions = normalizeProgressDetailOptions(optionsByColumnId?.[columnId])

        if (allowedOptions.length > 0 && !allowedOptions.includes(status)) {
          return res.status(400).json({
            error: 'Selected status is not valid for this Monday column.',
          })
        }

        await updateMondayItemStatusColumn({
          boardId: context.boardId,
          itemId: mondayItemId,
          columnId,
          statusLabel: status,
        })

        const {
          liveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        return res.json({
          ...buildMondayProgressDetailsResponse({
            hasMondayRecord: true,
            inDesign: Boolean(context?.inDesign),
            isShipped: syncResult.isShipped,
            liveOrder,
            mondayItemId,
            mondayStatus: syncResult.mondayStatus,
            mondayUpdatedAt: syncResult.mondayUpdatedAt,
            progressStatusDetails,
          }),
          ok: true,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/order-number — update the Monday order number
  // (ack column when available; fallback to item name). Non-admin updates are
  // blocked when linked to timesheet history or QuickBooks.
  app.post(
    '/api/orders/monday/order-number',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedOrderNumber = normalizeOrderNumberInput(req.body?.orderNumber)
        const requestedCurrentOrderNumber = normalizeOrderNumberInput(req.body?.currentOrderNumber)
        const publicUser = toPublicAuthUser(req.authUser)

        if (!publicUser?.isApproved) {
          return res.status(403).json({
            error: 'Approved access is required.',
          })
        }

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedOrderNumber) {
          return res.status(400).json({ error: 'orderNumber is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
          entriesCollection,
          orderProgressCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const [existingOrderDocument, liveSnapshot] = await Promise.all([
          ordersUnifiedCollection.findOne(
            { monday_item_id: mondayItemId },
            {
              projection: {
                _id: 0,
                monday_item_id: 1,
                order_number: 1,
                has_quickbooks_record: 1,
              },
            },
          ),
          fetchMondayBoardItemsByIds({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            itemIds: [mondayItemId],
          }),
        ])

        const liveOrder = Array.isArray(liveSnapshot?.orders)
          ? liveSnapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const currentOrderNumber =
          normalizeOrderNumberInput(existingOrderDocument?.order_number)
          || normalizeOrderNumberInput(liveOrder?.jobNumber)
          || requestedCurrentOrderNumber

        if (!currentOrderNumber) {
          return res.status(400).json({
            error: 'Current order number could not be resolved for this Monday item.',
          })
        }

        if (requestedOrderNumber === currentOrderNumber) {
          return res.json({
            ok: true,
            noChange: true,
            order: {
              mondayItemId,
              orderNumber: currentOrderNumber,
              previousOrderNumber: currentOrderNumber,
            },
          })
        }

        const conflictingOrder = await ordersUnifiedCollection.findOne(
          {
            order_number: requestedOrderNumber,
            monday_item_id: { $ne: mondayItemId },
          },
          {
            projection: {
              _id: 0,
              monday_item_id: 1,
            },
          },
        )

        if (conflictingOrder) {
          return res.status(409).json({
            error: 'This order number is already assigned to another order.',
          })
        }

        const linkedState = await resolveOrderNumberChangeLinkState({
          entriesCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
          mondayItemId,
          currentOrderNumber,
          nextOrderNumber: requestedOrderNumber,
          hasQuickBooksRecordOnOrder: Boolean(existingOrderDocument?.has_quickbooks_record),
        })

        if (!publicUser.isAdmin && hasLinkedOrderNumberBlockers(linkedState)) {
          return res.status(403).json({
            error: linkedOrderNumberChangeMessage,
            code: 'ORDER_NUMBER_CHANGE_REQUIRES_ADMIN',
            canContactAdmin: true,
            linkedState,
          })
        }

        const orderNumberColumnId = String(liveSnapshot?.columnDetection?.ackColumnId ?? '').trim() || null

        if (orderNumberColumnId) {
          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: orderNumberColumnId,
            textValue: requestedOrderNumber,
          })
        } else {
          await updateMondayItemName({
            boardId: context.boardId,
            itemId: mondayItemId,
            itemName: requestedOrderNumber,
          })
        }

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const now = new Date().toISOString()
        const refreshedOrderNumber =
          normalizeOrderNumberInput(refreshedLiveOrder?.jobNumber)
          || requestedOrderNumber
        const refreshedOrderName = normalizeOptionalShortText(refreshedLiveOrder?.name, 250) || null

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                jobNumber: refreshedOrderNumber,
                orderName: refreshedOrderName,
                mondayBoardId: context.boardId,
                mondayBoardName: resolvedBoardName,
                mondayBoardUrl: resolvedBoardUrl,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            { monday_item_id: mondayItemId },
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Monday_url:
                  String(refreshedLiveOrder?.itemUrl ?? '').trim()
                  || resolvedBoardUrl
                  || null,
                order_number: refreshedOrderNumber,
                order_name: refreshedOrderName,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Order saved to Monday, but unified refresh failed.'
        }

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            previousOrderNumber: currentOrderNumber,
            orderNumber:
              normalizeOrderNumberInput(updatedOrderDocument?.order_number)
              || refreshedOrderNumber,
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          updatedVia: orderNumberColumnId
            ? 'monday_order_number_column'
            : 'monday_item_name',
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/order-number/contact-admin — send an admin bell
  // request when a linked order-number change requires admin action.
  app.post(
    '/api/orders/monday/order-number/contact-admin',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedOrderNumber = normalizeOrderNumberInput(
          req.body?.requestedOrderNumber ?? req.body?.orderNumber,
        )
        const requestedCurrentOrderNumber = normalizeOrderNumberInput(req.body?.currentOrderNumber)
        const publicUser = toPublicAuthUser(req.authUser)

        if (!publicUser?.isApproved) {
          return res.status(403).json({
            error: 'Approved access is required.',
          })
        }

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedOrderNumber) {
          return res.status(400).json({ error: 'requestedOrderNumber is required.' })
        }

        const {
          authUsersCollection,
          entriesCollection,
          mobileAlertsCollection,
          mondayOrdersCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const [existingOrderDocument, liveSnapshot] = await Promise.all([
          ordersUnifiedCollection.findOne(
            { monday_item_id: mondayItemId },
            {
              projection: {
                _id: 0,
                monday_item_id: 1,
                order_number: 1,
                has_quickbooks_record: 1,
              },
            },
          ),
          fetchMondayBoardItemsByIds({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            itemIds: [mondayItemId],
          }),
        ])

        const liveOrder = Array.isArray(liveSnapshot?.orders)
          ? liveSnapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const currentOrderNumber =
          normalizeOrderNumberInput(existingOrderDocument?.order_number)
          || normalizeOrderNumberInput(liveOrder?.jobNumber)
          || requestedCurrentOrderNumber

        const linkedState = await resolveOrderNumberChangeLinkState({
          entriesCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
          mondayItemId,
          currentOrderNumber,
          nextOrderNumber: requestedOrderNumber,
          hasQuickBooksRecordOnOrder: Boolean(existingOrderDocument?.has_quickbooks_record),
        })

        const alertDocument = await createOrderNumberChangeAdminAlert({
          authUsersCollection,
          mobileAlertsCollection,
          publicUser,
          mondayItemId,
          currentOrderNumber,
          requestedOrderNumber,
          linkedState,
        })

        return res.status(201).json({
          ok: true,
          alert: toPublicMobileAlert(alertDocument),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/documents/upload — upload shipping documents to Firebase
  // Storage, then persist the URL on the unified order row.
  app.post(
    '/api/orders/documents/upload',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const documentType = normalizeShippingDocumentType(req.body?.documentType)
        const mimeType = String(req.body?.mimeType ?? 'application/pdf')
          .trim()
          .toLowerCase()
        const base64Payload = req.body?.fileBase64
          ?? req.body?.fileData
          ?? req.body?.data
          ?? null
        const requestedFileName = String(req.body?.fileName ?? '').trim()
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        if (!documentType) {
          return res.status(400).json({
            error: 'documentType must be signed_bol or inspection_sheet.',
          })
        }

        if (!shippingDocumentMimeTypes.has(mimeType)) {
          return res.status(400).json({
            error: 'Unsupported document mimeType.',
          })
        }

        const fileBuffer = decodeBase64Image(base64Payload)

        if (!fileBuffer || fileBuffer.length <= 0) {
          return res.status(400).json({
            error: 'fileBase64 is required.',
          })
        }

        if (fileBuffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({
            error: 'File exceeds 10MB limit.',
          })
        }

        const {
          ordersUnifiedCollection,
        } = await getCollections()
        const bucket = typeof getOrderPhotosBucket === 'function'
          ? getOrderPhotosBucket()
          : null

        if (!bucket) {
          throw Object.assign(new Error('Order photo storage bucket is unavailable.'), { status: 500 })
        }

        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({
            error: 'Order was not found.',
          })
        }

        const documentFields = resolveShippingDocumentFieldNames(documentType)
        const now = new Date().toISOString()
        const storageOrderId = sanitizeStorageSegment(
          orderDocument?.order_number
          || orderDocument?.monday_item_id
          || orderDocument?.orderKey
          || req.body?.orderNumber,
          'order',
        )
        const storedFileName = ensureShippingDocumentFileName(
          requestedFileName,
          mimeType,
          `${storageOrderId}-${documentFields.storageFolder}.pdf`,
        )
        const storagePath = `orders-shipping-docs/${storageOrderId}/${documentFields.storageFolder}/${Date.now()}-${storedFileName}`
        const downloadToken = typeof randomUUID === 'function'
          ? randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

        await bucket.file(storagePath).save(fileBuffer, {
          resumable: false,
          metadata: {
            contentType: mimeType,
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
              mondayItemId: String(orderDocument?.monday_item_id ?? '').trim() || null,
              orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
              documentType,
              uploadedAt: now,
            },
          },
        })

        const downloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId: orderDocument?.monday_item_id,
          orderNumber: orderDocument?.order_number,
        })

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for document update.',
          })
        }

        await ordersUnifiedCollection.updateOne(
          updateFilter,
          {
            $set: {
              [documentFields.fileNameField]: storedFileName,
              [documentFields.urlFieldPrimary]: downloadUrl,
              [documentFields.urlFieldLegacy]: downloadUrl,
              [documentFields.uploadedAtField]: now,
              [documentFields.storagePathField]: storagePath,
              [documentFields.mimeTypeField]: mimeType,
              updatedAt: now,
              lastSyncedAt: now,
            },
          },
        )

        const refreshedOrderDocument = await ordersUnifiedCollection.findOne(
          updateFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              monday_item_id: 1,
              order_number: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
            },
          },
        )

        return res.status(201).json({
          ok: true,
          document: {
            type: documentType,
            label: documentFields.documentLabel,
            fileName: storedFileName,
            mimeType,
            url: downloadUrl,
            uploadedAt: now,
          },
          order: {
            orderKey: String(refreshedOrderDocument?.orderKey ?? '').trim() || null,
            mondayItemId: String(refreshedOrderDocument?.monday_item_id ?? '').trim() || null,
            orderNumber: String(refreshedOrderDocument?.order_number ?? '').trim() || null,
            isShipped: Boolean(refreshedOrderDocument?.is_shipped),
            signedBol: String(refreshedOrderDocument?.signed_bol ?? '').trim() || null,
            signedBolUrl:
              String(refreshedOrderDocument?.Signed_BOL_source ?? '').trim()
              || String(refreshedOrderDocument?.Signed_BOL ?? '').trim()
              || null,
            inspectionSheet: String(refreshedOrderDocument?.inspection_sheet ?? '').trim() || null,
            inspectionSheetUrl:
              String(refreshedOrderDocument?.Inspection_sheet_source ?? '').trim()
              || String(refreshedOrderDocument?.Inspection_sheet ?? '').trim()
              || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/ship — move an order from Order Track to Shipped in
  // Monday after required website shipping docs are uploaded.
  app.post(
    '/api/orders/ship',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
              monday_board_id: 1,
              monday_board_name: 1,
              Monday_url: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()

        if (!mondayItemId) {
          return res.status(409).json({
            error: 'This order is not linked to a Monday item, so it cannot be shipped from the website.',
          })
        }

        const signedBolValue = String(orderDocument?.signed_bol ?? '').trim()
        const signedBolUrl =
          String(orderDocument?.Signed_BOL_source ?? '').trim()
          || String(orderDocument?.Signed_BOL ?? '').trim()
          || null
        const inspectionSheetValue = String(orderDocument?.inspection_sheet ?? '').trim()
        const inspectionSheetUrl =
          String(orderDocument?.Inspection_sheet_source ?? '').trim()
          || String(orderDocument?.Inspection_sheet ?? '').trim()
          || null

        if (!signedBolValue && !signedBolUrl) {
          return res.status(409).json({
            error: 'Signed BOL must be uploaded before shipping.',
          })
        }

        if (!inspectionSheetValue && !inspectionSheetUrl) {
          return res.status(409).json({
            error: 'Inspection Sheet must be uploaded before shipping.',
          })
        }

        if (Boolean(orderDocument?.is_shipped)) {
          return res.status(409).json({
            error: 'Order is already shipped. You can still upload shipping documents.',
          })
        }

        const sourceBoardId = String(orderDocument?.monday_board_id ?? '').trim()
        const targetBoardId = String(process.env.MONDAY_SHIPPED_BOARD_ID ?? '').trim()
        const targetBoardUrl = String(process.env.MONDAY_SHIPPED_BOARD_URL ?? '').trim() || null

        if (!sourceBoardId) {
          return res.status(409).json({
            error: 'Could not resolve source Monday board for this order.',
          })
        }

        if (!targetBoardId) {
          return res.status(500).json({
            error: 'MONDAY_SHIPPED_BOARD_ID is not configured.',
          })
        }

        const moveResult = await moveMondayItemToBoard({
          sourceBoardId,
          targetBoardId,
          itemId: mondayItemId,
        })
        const movedSnapshot = await fetchMondayBoardItemsByIds({
          boardId: targetBoardId,
          boardName: moveResult?.targetBoardName,
          boardUrl: targetBoardUrl,
          itemIds: [mondayItemId],
        })
        const movedOrder = Array.isArray(movedSnapshot?.orders)
          ? movedSnapshot.orders[0]
          : null
        const now = new Date().toISOString()
        const mondayUpdatedAt = String(movedOrder?.updatedAt ?? '').trim() || now
        const mondayStatus = String(movedOrder?.statusLabel ?? '').trim() || 'Shipped'
        const shippedAt = String(movedOrder?.shippedAt ?? '').trim() || now
        const progressStatusDetails = normalizeProgressStatusDetails(movedOrder?.progressStatusDetails)
        const publicUser = toPublicAuthUser(req.authUser)
        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId,
          orderNumber: orderDocument?.order_number,
        })

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for shipping update.',
          })
        }

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                mondayBoardId: targetBoardId,
                mondayBoardName: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || null,
                mondayBoardUrl: targetBoardUrl,
                orderName: String(movedOrder?.name ?? '').trim() || String(orderDocument?.order_name ?? '').trim() || null,
                jobNumber: String(movedOrder?.jobNumber ?? '').trim() || String(orderDocument?.order_number ?? '').trim() || null,
                statusLabel: 'Shipped',
                stageLabel: String(movedOrder?.stageLabel ?? '').trim() || null,
                readyLabel: String(movedOrder?.readyLabel ?? '').trim() || null,
                progressStatusDetails,
                progressPercent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                orderDate: String(movedOrder?.orderDate ?? '').trim() || null,
                dueDate: String(movedOrder?.dueDate ?? '').trim() || null,
                computedDueDate: String(movedOrder?.computedDueDate ?? '').trim() || null,
                effectiveDueDate: String(movedOrder?.effectiveDueDate ?? '').trim() || null,
                leadTimeDays: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                shippedAt,
                movedToShippedAt: now,
                isDone: true,
                isLate: Boolean(movedOrder?.isLate),
                daysLate: Number.isFinite(Number(movedOrder?.daysLate))
                  ? Number(movedOrder.daysLate)
                  : 0,
                mondayItemUrl: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
                mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
              },
              $setOnInsert: {
                createdAt: now,
              },
            },
            { upsert: true },
          ),
          ordersUnifiedCollection.updateOne(
            updateFilter,
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: targetBoardId,
                monday_board_name: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || 'Shipped Orders',
                Monday_url: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
                Monday_status: 'Shipped',
                is_shipped: true,
                shipped_at: shippedAt,
                shipped_at_inferred: String(movedOrder?.shippedAt ?? '').trim() ? false : true,
                Due_date:
                  String(movedOrder?.effectiveDueDate ?? '').trim()
                  || String(movedOrder?.dueDate ?? '').trim()
                  || String(movedOrder?.computedDueDate ?? '').trim()
                  || null,
                Lead_time_days: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                progress_percent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                progress_status_details: progressStatusDetails,
                order_date: String(movedOrder?.orderDate ?? '').trim() || null,
                monday_updated_at: mondayUpdatedAt,
                moved_to_shipped_via_website_at: now,
                moved_to_shipped_via_website_by_uid: String(publicUser?.uid ?? '').trim() || null,
                moved_to_shipped_via_website_by_email: normalizeEmail(publicUser?.email) || null,
                monday_ship_mapping_mode: String(moveResult?.mappingMode ?? '').trim() || null,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
          ),
        ])

        return res.json({
          ok: true,
          move: {
            itemId: mondayItemId,
            sourceBoardId: moveResult?.sourceBoardId || sourceBoardId,
            sourceBoardName: moveResult?.sourceBoardName || null,
            targetBoardId: moveResult?.targetBoardId || targetBoardId,
            targetBoardName: moveResult?.targetBoardName || null,
            targetGroupId: moveResult?.targetGroupId || null,
            targetGroupTitle: moveResult?.targetGroupTitle || null,
            mappingMode: moveResult?.mappingMode || 'explicit',
            mappedColumnCount: Number(moveResult?.mappedColumnCount) || 0,
            totalSourceColumnCount: Number(moveResult?.totalSourceColumnCount) || 0,
          },
          order: {
            orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
            mondayItemId,
            orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
            isShipped: true,
            shippedAt,
            mondayStatus,
            mondayBoardId: targetBoardId,
            mondayBoardName: moveResult?.targetBoardName || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  app.get('/api/orders/chat-users', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { authUsersCollection } = await getCollections()
      const userDocuments = await authUsersCollection
        .find(
          {
            approvalStatus: authApprovalApproved,
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .toArray()

      const users = userDocuments
        .map((document) => toPublicAuthUser(document))
        .map((user) => {
          const uid = normalizeOptionalShortText(user?.uid, 200)
          const email = normalizeEmail(user?.email)

          if (!uid || !email) {
            return null
          }

          return {
            uid,
            email,
            displayName: normalizeOptionalShortText(user?.displayName, 200) || null,
            isAdmin: Boolean(user?.isAdmin),
            isSalesRep: Boolean(user?.isSalesRep),
            hasWebAccess: Boolean(user?.hasWebAccess),
            hasAppAccess: Boolean(user?.hasAppAccess),
            lastActivityAt: String(user?.lastActivityAt ?? '').trim() || null,
          }
        })
        .filter(Boolean)
        .sort((left, right) => {
          const leftLabel = String(left.displayName ?? left.email).toLowerCase()
          const rightLabel = String(right.displayName ?? right.email).toLowerCase()

          if (leftLabel === rightLabel) {
            return left.email.localeCompare(right.email)
          }

          return leftLabel.localeCompare(rightLabel)
        })

      return res.json({
        users,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/orders/:orderId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const offset = normalizeOrderChatOffset(req.query?.offset)
      const limit = normalizeOrderChatLimit(req.query?.limit)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)
      const filter = {
        orderId,
      }

      const [total, messages] = await Promise.all([
        ordersChatsCollection.countDocuments(filter),
        ordersChatsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                id: 1,
                orderId: 1,
                orderNumber: 1,
                mondayItemId: 1,
                orderName: 1,
                message: 1,
                mentionUserUids: 1,
                mentionUserEmails: 1,
                reminder: 1,
                createdAt: 1,
                createdByUid: 1,
                createdByEmail: 1,
                createdByName: 1,
                updatedAt: 1,
                updatedByUid: 1,
                updatedByEmail: 1,
                updatedByName: 1,
              },
            },
          )
          .sort({ createdAt: 1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        messages,
        total,
        offset,
        limit,
        hasMore: offset + messages.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/orders/:orderId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const body = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const messageText = normalizeOrderChatMessage(body.message)
      const requestedMentionUserUids = normalizeOrderChatUidList(body.mentionUserUids, 25)
      const requestedReminder = normalizeOrderChatReminderInput(body.reminder)
      const orderContext = normalizeOrderChatContext(body)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      if (body.reminder && !requestedReminder) {
        return res.status(400).json({
          error: 'reminder.dueDate must be a valid ISO date in YYYY-MM-DD format.',
        })
      }

      const collections = await getCollections()
      const { authUsersCollection, mobileAlertsCollection } = collections
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const now = new Date().toISOString()
      const requesterUid = normalizeOptionalShortText(req.authUser?.uid, 200)
      const requesterEmail = normalizeEmail(req.authUser?.email) || null
      const requestedRecipientUids = normalizeOrderChatUidList([
        ...requestedMentionUserUids,
        ...(requestedReminder?.targetUserUids ?? []),
      ], 50)
      const recipientUsers = requestedRecipientUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: {
                $in: requestedRecipientUids,
              },
              approvalStatus: authApprovalApproved,
            },
            {
              projection: {
                _id: 0,
              },
            },
          )
          .toArray()
        : []
      const recipientByUid = new Map(
        recipientUsers
          .map((document) => toPublicAuthUser(document))
          .filter((user) => Boolean(user?.uid))
          .map((user) => [user.uid, user]),
      )
      const mentionRecipientUids = requestedMentionUserUids
        .filter((uid) => uid !== requesterUid)
        .filter((uid) => recipientByUid.has(uid))
      const mentionRecipientEmails = mentionRecipientUids
        .map((uid) => normalizeEmail(recipientByUid.get(uid)?.email))
        .filter(Boolean)
      const reminderRecipientUids = (requestedReminder?.targetUserUids ?? [])
        .filter((uid) => recipientByUid.has(uid))
      const reminderRecipientEmails = reminderRecipientUids
        .map((uid) => normalizeEmail(recipientByUid.get(uid)?.email))
        .filter(Boolean)
      const reminder = requestedReminder
        ? {
          id: randomUUID(),
          dueDate: requestedReminder.dueDate,
          note: requestedReminder.note || null,
          targetUserUids: reminderRecipientUids,
          targetUserEmails: reminderRecipientEmails,
          notifiedAt: null,
          createdAt: now,
        }
        : null

      const message = {
        id: randomUUID(),
        orderId,
        orderNumber: orderContext.orderNumber,
        mondayItemId: orderContext.mondayItemId,
        orderName: orderContext.orderName,
        message: messageText,
        mentionUserUids: mentionRecipientUids,
        mentionUserEmails: mentionRecipientEmails,
        reminder,
        createdAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: normalizeOptionalShortText(publicUser?.displayName, 200) || null,
      }

      await ordersChatsCollection.insertOne(message)

      if (mentionRecipientUids.length > 0) {
        const orderLabel = orderContext.orderNumber || orderContext.orderName || orderId
        await createOrderChatInAppAlert({
          mobileAlertsCollection,
          title: `Mentioned in order chat: ${orderLabel}`,
          message: `${normalizeOptionalShortText(publicUser?.displayName || requesterEmail || 'A teammate', 120)} mentioned you: ${messageText.slice(0, 300)}`,
          createdByUid: requesterUid,
          createdByEmail: requesterEmail,
          recipientUids: mentionRecipientUids,
          metadata: {
            source: 'orders_chat_mention',
            orderId,
            orderNumber: orderContext.orderNumber,
            mondayItemId: orderContext.mondayItemId,
            orderName: orderContext.orderName,
            chatMessageId: message.id,
          },
        })
      }

      return res.status(201).json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/orders/:orderId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const messageId = normalizeOptionalShortText(req.params.messageId, 160)
      const body = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const messageText = normalizeOrderChatMessage(body.message)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const existingMessage = await ordersChatsCollection.findOne(
        {
          id: messageId,
          orderId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageOrderChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only edit your own chat messages unless you are an admin.',
        })
      }

      const now = new Date().toISOString()
      const message = await ordersChatsCollection.findOneAndUpdate(
        {
          id: messageId,
          orderId,
        },
        {
          $set: {
            message: messageText,
            updatedAt: now,
            updatedByUid: normalizeOptionalShortText(req.authUser?.uid, 200) || null,
            updatedByEmail: normalizeEmail(req.authUser?.email) || null,
            updatedByName: normalizeOptionalShortText(publicUser?.displayName, 200) || null,
          },
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            orderNumber: 1,
            mondayItemId: 1,
            orderName: 1,
            message: 1,
            mentionUserUids: 1,
            mentionUserEmails: 1,
            reminder: 1,
            createdAt: 1,
            createdByUid: 1,
            createdByEmail: 1,
            createdByName: 1,
            updatedAt: 1,
            updatedByUid: 1,
            updatedByEmail: 1,
            updatedByName: 1,
          },
        },
      )

      return res.json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/orders/:orderId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const messageId = normalizeOptionalShortText(req.params.messageId, 160)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const existingMessage = await ordersChatsCollection.findOne(
        {
          id: messageId,
          orderId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageOrderChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only delete your own chat messages unless you are an admin.',
        })
      }

      await ordersChatsCollection.deleteOne({
        id: messageId,
        orderId,
      })

      return res.json({
        ok: true,
        messageId,
      })
    } catch (error) {
      next(error)
    }
  })

  // GET /api/orders/job-details — DB only. Mongo-side prefilter on jobName
  // (digit-token + normalized regex) keeps this off the full-collection scan.
  app.get(
    '/api/orders/job-details',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.query?.mondayItemId ?? '').trim()
        const jobNumber = String(req.query?.jobNumber ?? '').trim()
        const orderName = String(req.query?.orderName ?? '').trim()

        if (!mondayItemId && !jobNumber && !orderName) {
          return res.status(400).json({
            error: 'At least one of mondayItemId, jobNumber, or orderName is required.',
          })
        }

        const {
          mondayOrdersCollection,
          entriesCollection,
          workersCollection,
          stagesCollection,
          ordersUnifiedCollection,
          orderProgressCollection,
        } = await getCollections()

        const orderDocument = mondayItemId
          ? await mondayOrdersCollection.findOne(
            { mondayItemId },
            {
              projection: {
                _id: 0,
                mondayItemId: 1,
                orderName: 1,
                jobNumber: 1,
                statusLabel: 1,
                movedToShippedAt: 1,
                shippedAt: 1,
                mondayItemUrl: 1,
                mondayBoardName: 1,
                mondayBoardId: 1,
                mondayUpdatedAt: 1,
              },
            },
          )
          : null

        const resolvedJobNumber =
          jobNumber || extractJobNumber(orderDocument) || String(mondayItemId ?? '').trim()

        const lookup = buildJobLookupValues([
          resolvedJobNumber,
          orderName,
          mondayItemId,
          String(orderDocument?.jobNumber ?? '').trim(),
          String(orderDocument?.orderName ?? '').trim(),
        ])

        if (lookup.normalizedValues.size === 0 && lookup.digitValues.size === 0) {
          return res.status(400).json({
            error: 'Could not build a valid job lookup from the provided values.',
          })
        }

        const escapeRegex = (value) =>
          String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const jobNameOrFilters = []

        for (const digitValue of lookup.digitValues) {
          const escaped = escapeRegex(digitValue)
          if (escaped) {
            jobNameOrFilters.push({ jobName: { $regex: escaped } })
          }
        }
        for (const normalizedValue of lookup.normalizedValues) {
          const escaped = escapeRegex(normalizedValue)
          if (escaped) {
            jobNameOrFilters.push({ jobName: { $regex: escaped, $options: 'i' } })
          }
        }
        const jobNameFilter = jobNameOrFilters.length > 0 ? { $or: jobNameOrFilters } : {}

        const unifiedOrderFilters = []

        if (mondayItemId) {
          unifiedOrderFilters.push({ monday_item_id: mondayItemId })
        }

        if (resolvedJobNumber) {
          unifiedOrderFilters.push({ order_number: resolvedJobNumber })
        }

        if (orderName) {
          unifiedOrderFilters.push({ order_name: { $regex: escapeRegex(orderName), $options: 'i' } })
        }

        for (const digitValue of lookup.digitValues) {
          const escaped = escapeRegex(digitValue)

          if (!escaped) {
            continue
          }

          unifiedOrderFilters.push({ order_number: { $regex: escaped } })
          unifiedOrderFilters.push({ order_name: { $regex: escaped, $options: 'i' } })
        }

        for (const normalizedValue of lookup.normalizedValues) {
          const escaped = escapeRegex(normalizedValue)

          if (!escaped) {
            continue
          }

          unifiedOrderFilters.push({ order_number: { $regex: escaped, $options: 'i' } })
          unifiedOrderFilters.push({ order_name: { $regex: escaped, $options: 'i' } })
        }

        const unifiedOrderFilter = unifiedOrderFilters.length > 0 ? { $or: unifiedOrderFilters } : null

        const [entries, workers, stages, orderProgressDocuments, unifiedOrderDocument] = await Promise.all([
          entriesCollection
            .find(jobNameFilter, {
              projection: {
                _id: 0,
                id: 1,
                workerId: 1,
                stageId: 1,
                date: 1,
                jobName: 1,
                hours: 1,
                overtimeHours: 1,
                payRate: 1,
                notes: 1,
                createdAt: 1,
              },
            })
            .sort({ date: -1, createdAt: -1 })
            .toArray(),
          workersCollection
            .find({}, { projection: { _id: 0, id: 1, fullName: 1, hourlyRate: 1 } })
            .toArray(),
          stagesCollection.find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
          orderProgressCollection
            .find(jobNameFilter, {
              projection: { _id: 0, id: 1, date: 1, jobName: 1, readyPercent: 1, updatedAt: 1 },
            })
            .sort({ date: -1, updatedAt: -1 })
            .toArray(),
          unifiedOrderFilter
            ? ordersUnifiedCollection
              .find(
                unifiedOrderFilter,
                {
                  projection: {
                    _id: 0,
                    orderKey: 1,
                    order_number: 1,
                    monday_item_id: 1,
                    Monday_url: 1,
                    Monday_status: 1,
                    order_name: 1,
                    ship_to: 1,
                    ship_notes: 1,
                    bol: 1,
                    BOL: 1,
                    BOL_cached: 1,
                    BOL_source: 1,
                    signed_bol: 1,
                    Signed_BOL: 1,
                    Signed_BOL_source: 1,
                    inspection_sheet: 1,
                    Inspection_sheet: 1,
                    Inspection_sheet_source: 1,
                    po_number: 1,
                    monday_notes: 1,
                    monday_description: 1,
                    is_shipped: 1,
                    status: 1,
                    Due_date: 1,
                    Lead_time_days: 1,
                    progress_percent: 1,
                    progress_status_details: 1,
                    order_date: 1,
                    Shop_drawing: 1,
                    Shop_drawing_cached: 1,
                    Shop_drawing_source: 1,
                    Cut_list: 1,
                    Cut_list_cached: 1,
                    Cut_list_source: 1,
                    amountOwed: 1,
                    billBalanceAmount: 1,
                    billAmount: 1,
                    billedAmount: 1,
                    invoiceNumber: 1,
                    invoiceAmount: 1,
                    paidInFull: 1,
                    poAmount: 1,
                    shipped_at: 1,
                    shipped_at_inferred: 1,
                    has_monday_record: 1,
                    has_quickbooks_record: 1,
                    in_design: 1,
                    hazard_reason: 1,
                    source: 1,
                    qb_project_id: 1,
                    qb_project_name: 1,
                    qb_project_ids: 1,
                    qb_project_names: 1,
                    monday_board_id: 1,
                    monday_board_name: 1,
                    monday_updated_at: 1,
                    manager_ready_percent: 1,
                    manager_ready_date: 1,
                    manager_ready_updated_at: 1,
                    quickbooks_synced_at: 1,
                    updatedAt: 1,
                  },
                },
              )
              .sort({ updatedAt: -1, monday_updated_at: -1 })
              .limit(1)
              .next()
            : null,
        ])

        const workersById = new Map(workers.map((w) => [String(w.id ?? '').trim(), w]))
        const stagesById = new Map(stages.map((s) => [String(s.id ?? '').trim(), s]))

        const matchedEntries = entries
          .filter((entry) => doesJobNameMatchLookup(entry?.jobName, lookup))
          .map((entry) => {
            const workerDocument = workersById.get(String(entry?.workerId ?? '').trim()) ?? null
            const stageDocument = stagesById.get(String(entry?.stageId ?? '').trim()) ?? null
            const regularHours = getEntryRegularHours(entry)
            const overtimeHours = getEntryOvertimeHours(entry)
            const totalHours = regularHours + overtimeHours
            const rate = getEntryRate(entry, workerDocument)
            const laborCost = toMoney(regularHours * rate + overtimeHours * rate * 1.5)
            return {
              ...entry,
              workerName: String(workerDocument?.fullName ?? '').trim() || 'Unknown worker',
              stageName: String(stageDocument?.name ?? '').trim() || null,
              regularHours,
              overtimeHours,
              totalHours,
              rate,
              laborCost,
            }
          })

        const workerTotalsById = new Map()
        let totalRegularHours = 0
        let totalOvertimeHours = 0
        let totalHours = 0
        let totalLaborCost = 0

        matchedEntries.forEach((entry) => {
          const workerId = String(entry.workerId ?? '').trim()
          const existing = workerTotalsById.get(workerId) ?? {
            workerId,
            workerName: entry.workerName,
            totalRegularHours: 0,
            totalOvertimeHours: 0,
            totalHours: 0,
            totalLaborCost: 0,
          }
          existing.totalRegularHours += entry.regularHours
          existing.totalOvertimeHours += entry.overtimeHours
          existing.totalHours += entry.totalHours
          existing.totalLaborCost = toMoney(existing.totalLaborCost + entry.laborCost)
          workerTotalsById.set(workerId, existing)

          totalRegularHours += entry.regularHours
          totalOvertimeHours += entry.overtimeHours
          totalHours += entry.totalHours
          totalLaborCost = toMoney(totalLaborCost + entry.laborCost)
        })

        const managerHistory = orderProgressDocuments
          .filter((progress) => doesJobNameMatchLookup(progress?.jobName, lookup))
          .map((progress) => ({
            id: String(progress?.id ?? '').trim() || null,
            date: String(progress?.date ?? '').trim() || null,
            jobName: String(progress?.jobName ?? '').trim() || null,
            readyPercent: Number.isFinite(Number(progress?.readyPercent))
              ? Number(progress.readyPercent)
              : null,
            updatedAt: String(progress?.updatedAt ?? '').trim() || null,
          }))

        const latestManagerStatus = managerHistory[0] ?? null
        const normalizedOrderDetails = unifiedOrderDocument
          ? mapUnifiedOrderDocumentToOverviewRow(unifiedOrderDocument, null)
          : null

        return res.json({
          generatedAt: new Date().toISOString(),
          order: normalizedOrderDetails,
          job: {
            mondayItemId: String(orderDocument?.mondayItemId ?? mondayItemId).trim() || null,
            jobNumber: resolvedJobNumber || null,
            orderName: String(orderDocument?.orderName ?? orderName).trim() || null,
            mondayStatusLabel: String(orderDocument?.statusLabel ?? '').trim() || null,
            mondayItemUrl: String(orderDocument?.mondayItemUrl ?? '').trim() || null,
            mondayBoardId: String(orderDocument?.mondayBoardId ?? '').trim() || null,
            mondayBoardName: String(orderDocument?.mondayBoardName ?? '').trim() || null,
            mondayUpdatedAt: String(orderDocument?.mondayUpdatedAt ?? '').trim() || null,
            latestManagerReadyPercent: latestManagerStatus?.readyPercent ?? null,
            latestManagerReadyDate: latestManagerStatus?.date ?? null,
            latestManagerReadyUpdatedAt: latestManagerStatus?.updatedAt ?? null,
          },
          summary: {
            entryCount: matchedEntries.length,
            workerCount: workerTotalsById.size,
            totalRegularHours,
            totalOvertimeHours,
            totalHours,
            totalLaborCost,
          },
          workers: [...workerTotalsById.values()].sort(
            (left, right) =>
              right.totalHours - left.totalHours
              || left.workerName.localeCompare(right.workerName),
          ),
          entries: matchedEntries,
          managerHistory,
        })
      } catch (error) {
        next(error)
      }
    },
  )
}
