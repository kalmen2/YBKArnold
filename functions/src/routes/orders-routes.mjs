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

  function mapCutListDocuments(orderDocument) {
    const seenUrls = new Set()
    const documents = Array.isArray(orderDocument?.cut_list_documents)
      ? orderDocument.cut_list_documents
      : []

    const mappedDocuments = documents
      .map((document) => {
        const url = String(document?.url ?? '').trim()

        if (!url || seenUrls.has(url)) {
          return null
        }

        seenUrls.add(url)

        return {
          fileName: String(document?.fileName ?? '').trim() || 'cut-list.pdf',
          mimeType: String(document?.mimeType ?? '').trim() || 'application/pdf',
          url,
          uploadedAt: String(document?.uploadedAt ?? '').trim() || null,
        }
      })
      .filter(Boolean)

    const legacyUrl =
      String(orderDocument?.Cut_list_cached ?? '').trim()
      || String(orderDocument?.Cut_list_source ?? '').trim()
      || String(orderDocument?.Cut_list ?? '').trim()
      || null

    if (legacyUrl && !seenUrls.has(legacyUrl)) {
      mappedDocuments.push({
        fileName: 'cut-list.pdf',
        mimeType: 'application/pdf',
        url: legacyUrl,
        uploadedAt: null,
      })
    }

    return mappedDocuments
  }

  async function recoverStoredCutListDocuments(orderDocument, ordersUnifiedCollection) {
    if (!orderDocument) {
      return
    }

    const existingDocuments = mapCutListDocuments(orderDocument)

    if (existingDocuments.length > 1) {
      return
    }

    const bucket = typeof getOrderPhotosBucket === 'function'
      ? getOrderPhotosBucket()
      : null
    const storageOrderId = sanitizeStorageSegment(
      orderDocument?.order_number || orderDocument?.monday_item_id,
      'order',
    )

    if (!bucket || !storageOrderId) {
      return
    }

    try {
      const [files] = await bucket.getFiles({
        prefix: `orders-cut-lists/${storageOrderId}/`,
      })
      const recoveredDocuments = (
        await Promise.all(
          files.map(async (file) => {
            const [metadata] = await file.getMetadata()
            const token = String(
              metadata?.metadata?.firebaseStorageDownloadTokens ?? '',
            ).split(',')[0].trim()

            if (!token) {
              return null
            }

            const rawFileName = String(file.name ?? '').split('/').pop() || 'cut-list.pdf'
            const fileName = rawFileName.replace(/^\d+-/, '') || 'cut-list.pdf'

            return {
              fileName,
              mimeType: String(metadata?.contentType ?? '').trim() || 'application/pdf',
              url: buildFirebaseStorageDownloadUrl(bucket.name, file.name, token),
              uploadedAt:
                String(metadata?.timeCreated ?? metadata?.updated ?? '').trim()
                || null,
              storagePath: file.name,
            }
          }),
        )
      )
        .filter(Boolean)
        .sort((left, right) => {
          const leftTime = Date.parse(left.uploadedAt || '') || 0
          const rightTime = Date.parse(right.uploadedAt || '') || 0
          return leftTime - rightTime
        })

      if (recoveredDocuments.length <= existingDocuments.length) {
        return
      }

      orderDocument.cut_list_documents = recoveredDocuments
      await ordersUnifiedCollection.updateOne(
        { orderKey: orderDocument.orderKey },
        {
          $set: {
            cut_list_documents: recoveredDocuments,
            updatedAt: new Date().toISOString(),
          },
        },
      )
    } catch {
      // Storage recovery is best-effort. The current Monday/website link
      // remains available if an old file cannot be enumerated.
    }
  }

  function resolveOptionalMoney(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') {
        continue
      }

      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }

    return null
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
      sourceValue === 'quickbooks' || sourceValue === 'monday' || sourceValue === 'merged' || sourceValue === 'website'
        ? sourceValue
        : hasMondayRecord
          ? 'monday'
          : 'quickbooks'

    const isShipped = Boolean(orderDocument?.is_shipped)
    const customerSignedBolUrl =
      String(orderDocument?.Customer_Signed_BOL_source ?? '').trim()
      || String(orderDocument?.Customer_Signed_BOL ?? '').trim()
      || null
    const customerSignedBol = String(orderDocument?.customer_signed_bol ?? '').trim() || null
    const customerSignedBolRequired =
      isShipped && orderDocument?.customer_signed_bol_required !== false
    const mondayStatus =
      String(orderDocument?.job_status ?? '').trim()
      || String(orderDocument?.Monday_status ?? '').trim()
      || null
    const inDesign = Boolean(orderDocument?.in_design)
    const quickBooksInvoiceTotal =
      orderDocument?.invoiceAmount !== null
      && orderDocument?.invoiceAmount !== undefined
      && orderDocument?.invoiceAmount !== ''
      && Number.isFinite(Number(orderDocument.invoiceAmount))
      ? Number(orderDocument.invoiceAmount)
      : null
    const explicitlyCalculatedOrderTotal =
      orderDocument?.website_calculated_order_total !== null
      && orderDocument?.website_calculated_order_total !== undefined
      && Number.isFinite(Number(orderDocument.website_calculated_order_total))
        ? Number(orderDocument.website_calculated_order_total)
        : null
    const legacyEligibleCalculatedOrderTotal =
      (
        String(orderDocument?.source_quote_id ?? '').trim()
        || Number(orderDocument?.change_version || 0) > 0
      )
      && orderDocument?.canonical_order_value !== null
      && orderDocument?.canonical_order_value !== undefined
      && orderDocument?.canonical_order_value !== ''
      && Number.isFinite(Number(orderDocument.canonical_order_value))
        ? Number(orderDocument.canonical_order_value)
        : String(orderDocument?.created_via_website_manual_at ?? '').trim()
          && orderDocument?.orderValue !== null
          && orderDocument?.orderValue !== undefined
          && orderDocument?.orderValue !== ''
          && Number.isFinite(Number(orderDocument.orderValue))
          ? Number(orderDocument.orderValue) + (
              orderDocument?.freightValue !== null
              && orderDocument?.freightValue !== undefined
              && orderDocument?.freightValue !== ''
              && Number.isFinite(Number(orderDocument.freightValue))
                ? Number(orderDocument.freightValue)
                : 0
            )
          : null
    const websiteCalculatedOrderTotal =
      explicitlyCalculatedOrderTotal ?? legacyEligibleCalculatedOrderTotal
    const hasQuickBooksInvoice = Boolean(
      String(orderDocument?.invoiceNumber ?? '').trim()
      && quickBooksInvoiceTotal !== null,
    )
    const invoiceTotalMismatch = Boolean(
      websiteCalculatedOrderTotal !== null
      && hasQuickBooksInvoice
      && Math.round(quickBooksInvoiceTotal * 100) !== Math.round(websiteCalculatedOrderTotal * 100),
    )
    const baseHazardReason = String(orderDocument?.hazard_reason ?? '').trim()
      || (!hasMondayRecord && !inDesign
        ? 'Not found in Monday Order Track.'
        : !hasQuickBooksRecord && !inDesign
          ? 'Not found in QuickBooks projects.'
          : null)
    const hazardReason = [
      baseHazardReason,
      customerSignedBolRequired && !customerSignedBolUrl && !customerSignedBol
        ? 'Customer Signed BOL is missing after shipment.'
        : null,
      invoiceTotalMismatch
        ? 'The total from QuickBooks does not match the total from the order.'
        : null,
    ].filter(Boolean).join(' ') || null
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
    const quoteSnapshot = orderDocument?.source_quote_snapshot
      && typeof orderDocument.source_quote_snapshot === 'object'
      ? orderDocument.source_quote_snapshot
      : {}
    const toDocumentLine = (item, category, fallbackDescription, index) => ({
      id: String(item?.id ?? item?.itemNumber ?? `${category}-${index + 1}`).trim(),
      description: String(item?.description ?? item?.title ?? fallbackDescription).trim() || fallbackDescription,
      qty: Number.isFinite(Number(item?.qty)) ? Number(item.qty) : null,
      unitPrice: Number.isFinite(Number(item?.unitPrice)) ? Number(item.unitPrice) : null,
      extPrice: Number.isFinite(Number(item?.extPrice ?? item?.price))
        ? Number(item.extPrice ?? item.price)
        : 0,
      category,
    })
    const orderDocumentLines = [
      ...(Array.isArray(quoteSnapshot?.lineItems)
        ? quoteSnapshot.lineItems.map((item, index) => toDocumentLine(item, 'product', 'Product', index))
        : []),
      ...(Array.isArray(quoteSnapshot?.additionalServices)
        ? quoteSnapshot.additionalServices.map((item, index) => toDocumentLine(item, 'additional', 'Additional service', index))
        : []),
      ...(Array.isArray(quoteSnapshot?.shippingServices)
        ? quoteSnapshot.shippingServices.map((item, index) => toDocumentLine(item, 'freight', 'Freight service', index))
        : []),
    ]

    return {
      id: String(orderDocument?.orderKey ?? resolvedOrderNumber).trim() || resolvedOrderNumber,
      canonicalOrderId: String(orderDocument?.canonical_order_id ?? '').trim() || null,
      sourceQuoteId: String(orderDocument?.source_quote_id ?? '').trim() || null,
      sourceQuoteNumber: String(orderDocument?.source_quote_number ?? '').trim() || null,
      sourceQuoteTitle: String(orderDocument?.source_quote_title ?? '').trim() || null,
      quoteCreatedAt: String(orderDocument?.quote_created_at ?? '').trim() || null,
      quoteSentAt: String(orderDocument?.quote_sent_at ?? '').trim() || null,
      quoteViewedAt: String(orderDocument?.quote_viewed_at ?? '').trim() || null,
      quoteAcceptedAt: String(orderDocument?.quote_accepted_at ?? '').trim() || null,
      convertedAt: String(orderDocument?.converted_at ?? '').trim() || null,
      convertedByEmail: String(orderDocument?.converted_by_email ?? '').trim() || null,
      dealerSourceId: String(orderDocument?.dealer_source_id ?? '').trim() || null,
      dealerName: String(orderDocument?.dealer_name ?? '').trim() || null,
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
      customerSignedBol,
      customerSignedBolUrl,
      changeVersion: Number.isFinite(Number(orderDocument?.change_version))
        ? Number(orderDocument.change_version)
        : 0,
      changeOrderStatus: String(orderDocument?.change_order_status ?? '').trim() || null,
      changeOrderUrl: String(orderDocument?.change_order_url ?? '').trim() || null,
      changeOrderName: String(orderDocument?.change_order_name ?? '').trim() || null,
      pendingChangeVersion: Number.isFinite(Number(orderDocument?.pending_order_change?.version))
        ? Number(orderDocument.pending_order_change.version)
        : null,
      pendingOrderChangeLines: Array.isArray(orderDocument?.pending_order_change?.lines)
        ? orderDocument.pending_order_change.lines
        : [],
      pendingChangeProductNet: Number.isFinite(Number(orderDocument?.pending_order_change?.productNet))
        ? Number(orderDocument.pending_order_change.productNet)
        : null,
      pendingChangeFreightNet: Number.isFinite(Number(orderDocument?.pending_order_change?.freightNet))
        ? Number(orderDocument.pending_order_change.freightNet)
        : null,
      customerSignedChangeOrder:
        String(orderDocument?.customer_signed_change_order ?? '').trim() || null,
      customerSignedChangeOrderUrl:
        String(orderDocument?.customer_signed_change_order_url ?? '').trim()
        || String(orderDocument?.Customer_Signed_Change_Order ?? '').trim()
        || null,
      inspectionSheet: String(orderDocument?.inspection_sheet ?? '').trim() || null,
      inspectionSheetUrl:
        String(orderDocument?.Inspection_sheet_source ?? '').trim()
        || String(orderDocument?.Inspection_sheet ?? '').trim()
        || null,
      poNumber: String(orderDocument?.po_number ?? '').trim() || null,
      bench: String(orderDocument?.bench ?? '').trim() || null,
      notes: String(orderDocument?.monday_notes ?? '').trim() || null,
      description: String(orderDocument?.monday_description ?? '').trim() || null,
      contactName: String(quoteSnapshot?.contactName ?? '').trim() || null,
      contactEmail: String(quoteSnapshot?.contactEmail ?? '').trim() || null,
      contactPhone: String(quoteSnapshot?.contactPhone ?? '').trim() || null,
      leadTime: String(orderDocument?.lead_time_text ?? quoteSnapshot?.leadTime ?? '').trim() || null,
      freightDescription: String(quoteSnapshot?.freightDescription ?? '').trim() || null,
      productValue: resolveOptionalMoney(
        orderDocument?.canonical_product_value,
        Number.isFinite(Number(orderDocument?.canonical_order_value))
          ? Number(orderDocument.canonical_order_value) - Number(orderDocument?.canonical_freight_value || 0)
          : null,
      ),
      productGrossValue: resolveOptionalMoney(orderDocument?.canonical_product_gross_value),
      discountPercent: resolveOptionalMoney(orderDocument?.discount_percent),
      discountAmount: resolveOptionalMoney(orderDocument?.discount_amount),
      discountScope: orderDocument?.discount_scope === 'products_and_freight'
        ? 'products_and_freight'
        : 'products',
      freightGrossValue: resolveOptionalMoney(orderDocument?.canonical_freight_gross_value),
      discountFreightAmount: resolveOptionalMoney(orderDocument?.discount_freight_amount),
      orderDocumentLines,
      orderValue: resolveOptionalMoney(
        orderDocument?.orderValue,
        orderDocument?.canonical_order_value,
        orderDocument?.source_quote_snapshot?.totalAmount,
        String(orderDocument?.created_via_website_manual_at ?? '').trim()
          ? orderDocument?.poAmount
          : null,
      ),
      freightValue: resolveOptionalMoney(
        orderDocument?.freightValue,
        orderDocument?.canonical_freight_value,
        orderDocument?.source_quote_snapshot?.freight,
      ),
      salesRep: String(orderDocument?.sales_rep ?? '').trim() || null,
      depositReceivedDate: String(orderDocument?.deposit_received_date ?? '').trim() || null,
      poAmount: Number.isFinite(Number(orderDocument?.poAmount)) ? Number(orderDocument.poAmount) : null,
      billedAmount: Number.isFinite(Number(orderDocument?.billedAmount))
        ? Number(orderDocument.billedAmount)
        : Number.isFinite(Number(orderDocument?.billAmount))
          ? Number(orderDocument.billAmount)
          : null,
      invoiceAmount: Number.isFinite(Number(orderDocument?.invoiceAmount)) ? Number(orderDocument.invoiceAmount) : null,
      websiteCalculatedOrderTotal,
      invoiceTotalMatchesOrder: websiteCalculatedOrderTotal !== null && hasQuickBooksInvoice
        ? !invoiceTotalMismatch
        : null,
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
      isWarrantyOrder: Boolean(orderDocument?.is_warranty_order),
      warrantyParentOrderNumber:
        String(orderDocument?.warranty_parent_order_number ?? '').trim() || null,
      isArchived: Boolean(String(orderDocument?.archived_at ?? '').trim()),
      archivedAt: String(orderDocument?.archived_at ?? '').trim() || null,
      archivedByEmail: String(orderDocument?.archived_by_email ?? '').trim() || null,
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
      cutListDocuments: mapCutListDocuments(orderDocument),
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
      depositRequired: typeof orderDocument?.deposit_required === 'boolean'
        ? orderDocument.deposit_required
        : null,
      depositPercent: orderDocument?.deposit_percent !== null
        && orderDocument?.deposit_percent !== undefined
        && orderDocument?.deposit_percent !== ''
        && Number.isFinite(Number(orderDocument.deposit_percent))
        ? Number(orderDocument.deposit_percent)
        : null,
      depositRequestUrl: String(orderDocument?.deposit_request_url ?? '').trim() || null,
      depositRequestName: String(orderDocument?.deposit_request_name ?? '').trim() || null,
      orderConfirmationUrl: String(orderDocument?.order_confirmation_url ?? '').trim() || null,
      orderConfirmationName: String(orderDocument?.order_confirmation_name ?? '').trim() || null,
      workOrderUrl: String(orderDocument?.work_order_url ?? '').trim() || null,
      workOrderName: String(orderDocument?.work_order_name ?? '').trim() || null,
      proformaInvoiceUrl: String(orderDocument?.proforma_invoice_url ?? '').trim() || null,
      proformaInvoiceName: String(orderDocument?.proforma_invoice_name ?? '').trim() || null,
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

      // A linked claim/rework order remains operationally independent in
      // Monday, but financially points at the main order's QuickBooks project.
      // Do not copy dollar totals onto the child: that would double-count the
      // parent's project. We only inherit project identity and navigation.
      const parent = rowsByOrderNumber.get(parentKey)

      if (parent?.hasQuickBooksRecord) {
        row.hasQuickBooksRecord = true
        row.quickBooksProjectId = parent.quickBooksProjectId
        row.quickBooksProjectName = parent.quickBooksProjectName
        row.quickBooksProjectIds = [...parent.quickBooksProjectIds]
        row.quickBooksProjectNames = [...parent.quickBooksProjectNames]
        row.source = row.hasMondayRecord ? 'merged' : row.source

        if (row.hasMondayRecord && /not found in quickbooks/i.test(String(row.hazardReason ?? ''))) {
          row.hazardReason = null
        }
      }
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

  function getOrderAccess(req) {
    const user = toPublicAuthUser(req.authUser)

    return {
      isSalesRep: Boolean(user?.isSalesRep),
      isShopWorker: Boolean(user?.isShopWorker),
      canViewOrderValue: Boolean(user?.canViewOrderValue),
      canViewLaborCost: Boolean(user?.canViewLaborCost),
      canViewFullFinancials: Boolean(user?.canViewFullFinancials),
    }
  }

  function redactOrderForAccess(order, access) {
    if (!order) {
      return null
    }

    const redacted = {
      ...order,
      familyRollup: order.familyRollup
        ? { ...order.familyRollup }
        : order.familyRollup,
    }

    if (!access.canViewOrderValue) {
      redacted.orderValue = null
      redacted.productValue = null
      redacted.freightValue = null
      redacted.websiteCalculatedOrderTotal = null
      redacted.invoiceTotalMatchesOrder = null
      redacted.orderDocumentLines = []
      redacted.pendingOrderChangeLines = []
      redacted.pendingChangeProductNet = null
      redacted.pendingChangeFreightNet = null
      redacted.salesRep = null
      redacted.depositReceivedDate = null
      redacted.poAmount = null
      if (redacted.familyRollup) {
        redacted.familyRollup.poAmount = null
      }
    }

    if (!access.canViewLaborCost) {
      redacted.totalLaborCost = null
      if (redacted.familyRollup) {
        redacted.familyRollup.totalLaborCost = null
      }
    }

    if (!access.canViewFullFinancials) {
      redacted.billedAmount = null
      redacted.invoiceAmount = null
      redacted.invoiceNumber = null
      redacted.invoiceCachedUrl = null
      redacted.invoiceFileName = null
      redacted.amountOwed = null
      redacted.billBalanceAmount = null

      if (redacted.familyRollup) {
        redacted.familyRollup.billedAmount = null
        redacted.familyRollup.invoiceAmount = null
        redacted.familyRollup.amountOwed = null
        redacted.familyRollup.billBalanceAmount = null
      }
    }

    if (access.isShopWorker) {
      // Shop Workers only need production-facing order context. Keep the
      // manager-authored Ready percentage/date, but do not expose Monday
      // workflow state, customer purchasing references, or labor activity.
      redacted.poNumber = null
      redacted.mondayStatus = null
      redacted.progressPercent = null
      redacted.rowStatus = null
      redacted.mondayItemUrl = null
      redacted.mondayBoardId = null
      redacted.mondayBoardName = null
      redacted.totalHours = null
      redacted.paidInFull = null
      if (redacted.familyRollup) {
        redacted.familyRollup.totalHours = null
      }

      // Never give the app a Monday source URL. If the Firebase copy is not
      // present yet, the authenticated download endpoint will create it once.
      redacted.shopDrawingUrl = redacted.shopDrawingCachedUrl || null

      // These generated documents contain customer pricing. Shop Workers only
      // receive production-facing documents such as shop drawings and cut lists.
      redacted.depositRequestUrl = null
      redacted.depositRequestName = null
      redacted.orderConfirmationUrl = null
      redacted.orderConfirmationName = null
      redacted.proformaInvoiceUrl = null
      redacted.proformaInvoiceName = null
      redacted.changeOrderUrl = null
      redacted.changeOrderName = null
      redacted.customerSignedChangeOrderUrl = null
      redacted.customerSignedChangeOrder = null
    }

    return redacted
  }

  // ---- Routes -----------------------------------------------------------

  // GET /api/orders/overview — pure DB read. Never triggers Monday/QB.
  app.get('/api/orders/overview', requireFirebaseAuth, async (req, res, next) => {
    try {
      const access = getOrderAccess(req)

      if (access.isSalesRep) {
        return res.status(403).json({
          error: 'Sales Reps access their assigned work from the Sales page.',
        })
      }

      const {
        dashboardSnapshotsCollection,
        entriesCollection,
        ordersUnifiedCollection,
        workersCollection,
      } = await getCollections()

      const unifiedOrderDocuments = await ordersUnifiedCollection
        .find(
          {
            is_cancelled: { $ne: true },
            is_deleted: { $ne: true },
          },
          {
            projection: {
              _id: 0,
              orderKey: 1,
              canonical_order_id: 1,
              is_canonical_order: 1,
              source_quote_id: 1,
              source_quote_number: 1,
              source_quote_title: 1,
              quote_created_at: 1,
              quote_sent_at: 1,
              quote_viewed_at: 1,
              quote_accepted_at: 1,
              converted_at: 1,
              converted_by_email: 1,
              dealer_source_id: 1,
              dealer_name: 1,
              order_number: 1,
              monday_item_id: 1,
              Monday_url: 1,
              Monday_status: 1,
              job_status: 1,
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
              customer_signed_bol: 1,
              Customer_Signed_BOL: 1,
              Customer_Signed_BOL_source: 1,
              customer_signed_bol_required: 1,
              change_version: 1,
              change_order_status: 1,
              change_order_url: 1,
              change_order_name: 1,
              pending_order_change: 1,
              customer_signed_change_order: 1,
              customer_signed_change_order_url: 1,
              Customer_Signed_Change_Order: 1,
              inspection_sheet: 1,
              Inspection_sheet: 1,
              Inspection_sheet_source: 1,
              po_number: 1,
              bench: 1,
              monday_notes: 1,
              monday_description: 1,
              orderValue: 1,
              freightValue: 1,
              canonical_product_gross_value: 1,
              discount_percent: 1,
              discount_amount: 1,
              discount_scope: 1,
              discount_freight_amount: 1,
              canonical_freight_gross_value: 1,
              sales_rep: 1,
              deposit_received_date: 1,
              canonical_order_value: 1,
              canonical_freight_value: 1,
              source_quote_snapshot: 1,
              canonical_product_value: 1,
              lead_time_text: 1,
              created_via_website_manual_at: 1,
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
              cut_list_documents: 1,
              amountOwed: 1,
              billBalanceAmount: 1,
              billAmount: 1,
              billedAmount: 1,
              invoiceNumber: 1,
              invoiceAmount: 1,
              website_calculated_order_total: 1,
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
              is_warranty_order: 1,
              warranty_parent_order_number: 1,
              archived_at: 1,
              archived_by_uid: 1,
              archived_by_email: 1,
              has_monday_record: 1,
              has_quickbooks_record: 1,
              in_design: 1,
              hazard_reason: 1,
              source: 1,
              parent_order_number: 1,
              deposit_request_url: 1,
              deposit_request_name: 1,
              order_confirmation_url: 1,
              order_confirmation_name: 1,
              work_order_url: 1,
              work_order_name: 1,
              proforma_invoice_url: 1,
              proforma_invoice_name: 1,
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

      const unredactedRows = unifiedOrderDocuments.map(
        (doc) => mapUnifiedOrderDocumentToOverviewRow(doc, laborLookups),
      )
      attachFamilyRollups(unredactedRows)
      const rows = unredactedRows.map((row) => redactOrderForAccess(row, access))
      const shippedCount = rows.filter((row) => row.isShipped).length
      const hazardCount = rows.filter((row) => !row.isArchived && Boolean(row.hazardReason)).length
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
      const access = getOrderAccess(req)

      if (!access.canViewFullFinancials || access.isSalesRep) {
        return res.status(403).json({
          error: 'Only Admin users can open invoice documents.',
        })
      }

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
        const access = getOrderAccess(req)

        if (access.isSalesRep) {
          return res.status(403).json({
            error: 'Sales Reps access their assigned work from the Sales page.',
          })
        }

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
    createMondayItem,
    getCollections,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    updateMondayItemJsonColumn,
    updateMondayItemName,
    updateMondayItemTextColumn,
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
    resolveMondayOrderContext,
    syncMondayProgressDetailsToCollections,
    toPublicAuthUser,
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
        const access = getOrderAccess(req)
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
                    job_status: 1,
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
                    customer_signed_bol: 1,
                    Customer_Signed_BOL: 1,
                    Customer_Signed_BOL_source: 1,
                    customer_signed_bol_required: 1,
                    change_version: 1,
                    change_order_status: 1,
                    change_order_url: 1,
                    change_order_name: 1,
                    pending_order_change: 1,
                    customer_signed_change_order: 1,
                    customer_signed_change_order_url: 1,
                    Customer_Signed_Change_Order: 1,
                    inspection_sheet: 1,
                    Inspection_sheet: 1,
                    Inspection_sheet_source: 1,
                    po_number: 1,
                    bench: 1,
                    monday_notes: 1,
                    monday_description: 1,
                    orderValue: 1,
                    freightValue: 1,
                    canonical_product_gross_value: 1,
                    discount_percent: 1,
                    discount_amount: 1,
                    discount_scope: 1,
                    discount_freight_amount: 1,
                    canonical_freight_gross_value: 1,
                    sales_rep: 1,
                    deposit_received_date: 1,
                    canonical_order_value: 1,
                    canonical_freight_value: 1,
                    source_quote_snapshot: 1,
                    created_via_website_manual_at: 1,
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
                    cut_list_documents: 1,
                    deposit_request_url: 1,
                    deposit_request_name: 1,
                    order_confirmation_url: 1,
                    order_confirmation_name: 1,
                    work_order_url: 1,
                    work_order_name: 1,
                    proforma_invoice_url: 1,
                    proforma_invoice_name: 1,
                    amountOwed: 1,
                    billBalanceAmount: 1,
                    billAmount: 1,
                    billedAmount: 1,
                    invoiceNumber: 1,
                    invoiceAmount: 1,
                    website_calculated_order_total: 1,
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

        await recoverStoredCutListDocuments(
          unifiedOrderDocument,
          ordersUnifiedCollection,
        )

        const latestManagerStatus = managerHistory[0] ?? null
        const normalizedOrderDetails = unifiedOrderDocument
          ? redactOrderForAccess(
            mapUnifiedOrderDocumentToOverviewRow(unifiedOrderDocument, null),
            access,
          )
          : null
        const visibleEntries = access.isShopWorker
          ? []
          : matchedEntries.map((entry) => ({
            ...entry,
            payRate: access.canViewLaborCost ? entry.payRate : null,
            rate: access.canViewLaborCost ? entry.rate : null,
            laborCost: access.canViewLaborCost ? entry.laborCost : null,
          }))
        const visibleWorkerTotals = access.isShopWorker
          ? []
          : [...workerTotalsById.values()]
            .map((worker) => ({
              ...worker,
              totalLaborCost: access.canViewLaborCost ? worker.totalLaborCost : null,
            }))
            .sort(
              (left, right) =>
                right.totalHours - left.totalHours
                || left.workerName.localeCompare(right.workerName),
            )

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
            entryCount: access.isShopWorker ? 0 : matchedEntries.length,
            workerCount: access.isShopWorker ? 0 : workerTotalsById.size,
            totalRegularHours: access.isShopWorker ? 0 : totalRegularHours,
            totalOvertimeHours: access.isShopWorker ? 0 : totalOvertimeHours,
            totalHours: access.isShopWorker ? 0 : totalHours,
            totalLaborCost: access.canViewLaborCost ? totalLaborCost : null,
          },
          workers: visibleWorkerTotals,
          entries: visibleEntries,
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
