// Orders endpoints — overview (DB only), refresh (the one place the manual
// trigger does live Monday + QuickBooks pulls), and job-details (DB only,
// Mongo-side prefilter on jobName).

import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STAGE_KEYS,
  normalizeProgressStageKey,
  normalizeProgressStageStatus as normalizeWebsiteProgressStatus,
} from '../orders/stage-registry.mjs'
import {
  ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS,
  applyStatusToStoredProgressDetails,
  buildOrderIdentityFilter,
  buildProgressStatusQueueRequestKey,
  buildTrackedProgressRowStatusLabel,
  buildTrackedProgressStageStates,
  computeQueuedProgressStatusRetryAt,
  enqueueMondayProgressStatusUpdates,
  ensurePdfFileName,
  sanitizeDownloadFileName,
  sanitizeStorageSegment,
  hasOwnField,
  mapWarrantyStateFromOrderDocument,
  normalizeIsoDateInput,
  normalizeOrderNumberInput,
  normalizeProgressDetailOptions,
  normalizeProgressDetailOptionStyles,
  normalizeProgressStatusDetails,
  normalizeQueuedProgressStatusValue,
  resolveMondayProgressStatusLabel,
  resolveRowStatusLabel,
  resolveNewestTrackedProgressStage,
} from '../orders/order-shared.mjs'
import { createMondaySyncHelpers } from '../orders/monday-sync.mjs'
import { registerOrderChatRoutes } from '../orders/chat-routes.mjs'
import { registerOrderProgressRoutes } from '../orders/progress-routes.mjs'
import { registerOrderDocumentRoutes } from '../orders/document-routes.mjs'
import { registerOrderShippingRoutes } from '../orders/shipping-routes.mjs'
import { registerOrderWarrantyRoutes } from '../orders/warranty-routes.mjs'
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
    createMondayItem,
    deleteMondayItem,
    decodeBase64Image,
    fetchMondayBoardColumns,
    fetchMondayBoardItemsByIds,
    fetchMondayBoardsCatalog,
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
    updateMondayItemJsonColumn,
    updateMondayItemName,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
  } = deps
  const laborLookupsCacheTtlMs = 30 * 1000
  const quickBooksTokenDocId = 'primary'
  const quickBooksAccessTokenRefreshSkewMs = 2 * 60 * 1000
  let cachedLaborLookups = null
  let cachedLaborLookupsExpiresAt = 0
  const fixedOrderProgressStages = ORDER_PROGRESS_STAGES
  const fixedOrderProgressStageKeySet = new Set(ORDER_PROGRESS_STAGE_KEYS)

  const {
    buildMondayProgressDetailsResponse,
    clearMondayColumnValue,
    extractProgressStatusColumnIds,
    getOrdersProgressStatusQueueCollection,
    processQueuedMondayProgressStatusUpdates,
    pullLiveMondayProgressDetails,
    resolveMondayOrderContext,
    syncMondayProgressDetailsToCollections,
    updateMondayDateColumnValue,
    updateMondayLinkColumnValue,
  } = createMondaySyncHelpers({
    fetchMondayBoardItemsByIds,
    fetchMondayStatusColumnOptions,
    getCollections,
    updateMondayItemJsonColumn,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
  })

  function sanitizeQuickBooksTokenText(value, maxLength = 8000) {
    return String(value ?? '').trim().slice(0, maxLength)
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
        : !hasQuickBooksRecord && !inDesign
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
    const rowStatus = resolveRowStatusLabel({
      hasMondayRecord,
      inDesign,
      isShipped,
      mondayStatus,
      progressStatusDetails,
    })
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
      ...mapWarrantyStateFromOrderDocument(orderDocument),
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
      parentOrderNumber: String(orderDocument?.parent_order_number ?? '').trim() || null,
    }
  }

  // Sub-orders stay fully separate orders; linking one to a main order only
  // combines the money and labor view: the main order's familyRollup adds up
  // the whole family so cost/profit can be judged against the main invoice.
  function attachFamilyRollups(rows) {
    const rowsByOrderNumber = new Map()

    rows.forEach((row) => {
      const key = String(row?.orderNumber ?? '').trim().toLowerCase()

      if (key && !rowsByOrderNumber.has(key)) {
        rowsByOrderNumber.set(key, row)
      }
    })

    const childrenByParentKey = new Map()

    rows.forEach((row) => {
      const parentKey = String(row?.parentOrderNumber ?? '').trim().toLowerCase()

      if (!parentKey) {
        return
      }

      if (!childrenByParentKey.has(parentKey)) {
        childrenByParentKey.set(parentKey, [])
      }

      childrenByParentKey.get(parentKey).push(row)
    })

    const sumField = (family, field) => {
      const values = family
        .map((row) => Number(row?.[field]))
        .filter((value) => Number.isFinite(value))

      if (values.length === 0) {
        return null
      }

      return Number(values.reduce((total, value) => total + value, 0).toFixed(2))
    }

    childrenByParentKey.forEach((children, parentKey) => {
      const parent = rowsByOrderNumber.get(parentKey)

      if (!parent) {
        return
      }

      const family = [parent, ...children]

      parent.familyRollup = {
        orderNumbers: family
          .map((row) => String(row?.orderNumber ?? '').trim())
          .filter(Boolean),
        subOrderCount: children.length,
        totalHours: sumField(family, 'totalHours'),
        totalLaborCost: sumField(family, 'totalLaborCost'),
        poAmount: sumField(family, 'poAmount'),
        billedAmount: sumField(family, 'billedAmount'),
        invoiceAmount: sumField(family, 'invoiceAmount'),
        amountOwed: sumField(family, 'amountOwed'),
        billBalanceAmount: sumField(family, 'billBalanceAmount'),
      }
    })
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
              warranty_issue_active: 1,
              warranty_issue_description: 1,
              warranty_issue_reported_at: 1,
              warranty_issue_lead_time_date: 1,
              warranty_issue_done_at: 1,
              warranty_last_completed_description: 1,
              warranty_last_completed_reported_at: 1,
              warranty_last_completed_lead_time_date: 1,
              warranty_last_completed_done_at: 1,
              warranty_last_completed_duration_days: 1,
              warranty_last_completed_lead_time_variance_days: 1,
              has_monday_record: 1,
              has_quickbooks_record: 1,
              in_design: 1,
              hazard_reason: 1,
              source: 1,
              parent_order_number: 1,
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
      attachFamilyRollups(rows)
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

  registerOrderProgressRoutes(app, {
    authApprovalApproved,
    authRoleAdmin,
    buildMondayProgressDetailsResponse,
    clearMondayColumnValue,
    extractProgressStatusColumnIds,
    fetchMondayBoardItemsByIds,
    fetchMondayStatusColumnOptions,
    getCollections,
    getOrdersProgressStatusQueueCollection,
    mobileAlertTargetModeSelected,
    normalizeEmail,
    processQueuedMondayProgressStatusUpdates,
    pullLiveMondayProgressDetails,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    resolveMondayOrderContext,
    syncMondayProgressDetailsToCollections,
    toPublicAuthUser,
    toPublicMobileAlert,
    updateMondayDateColumnValue,
    updateMondayItemName,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
    updateMondayLinkColumnValue,
  })

  registerOrderWarrantyRoutes(app, {
    getCollections,
    requireFirebaseAuth,
  })

  registerOrderDocumentRoutes(app, {
    clearMondayColumnValue,
    decodeBase64Image,
    fetchMondayBoardItemsByIds,
    getCollections,
    getOrderPhotosBucket,
    pullLiveMondayProgressDetails,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    resolveMondayOrderContext,
    syncMondayProgressDetailsToCollections,
    updateMondayLinkColumnValue,
  })

  registerOrderShippingRoutes(app, {
    authApprovalApproved,
    createMondayItem,
    deleteMondayItem,
    fetchMondayBoardColumns,
    fetchMondayBoardItemsByIds,
    fetchMondayBoardsCatalog,
    getCollections,
    mobileAlertTargetModeSelected,
    moveMondayItemToBoard,
    normalizeEmail,
    randomUUID,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    toPublicAuthUser,
    toPublicMobileAlert,
    updateMondayItemJsonColumn,
    updateMondayItemName,
    updateMondayItemTextColumn,
  })

  registerOrderChatRoutes(app, {
    authApprovalApproved,
    getCollections,
    mobileAlertTargetModeSelected,
    normalizeEmail,
    requireFirebaseAuth,
    toPublicAuthUser,
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

  return {
    processQueuedMondayProgressStatusUpdates,
  }
}
