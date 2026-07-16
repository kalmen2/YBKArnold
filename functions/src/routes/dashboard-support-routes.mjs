import { createTtlCache } from '../utils/ttl-cache.mjs'
import { buildFirebaseStorageDownloadUrl } from '../utils/value-utils.mjs'

export function registerDashboardSupportRoutes(app, deps) {
  const {
    clearSupportSnapshotCache,
    createZendeskTicketReply,
    createZendeskSupportTicket,
    fetchMondayAssetDownloadInfo,
    fetchZendeskSupportAgents,
    fetchZendeskSupportAlertTicketsSnapshot,
    fetchZendeskSupportAlerts,
    fetchZendeskSupportTicketsSnapshot,
    fetchZendeskTicketConversation,
    fetchZendeskTicketSummary,
    getCollections,
    getDashboardSnapshotFromCache,
    getOrderPhotosBucket,
    isDashboardRefreshRequested,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    setDashboardSnapshotCache,
    toPublicAuthUser,
    toBoundedInteger,
  } = deps

  // Zendesk ticket conversation cache (5-minute TTL)
  // Avoids a live Zendesk API call on every ticket click — conversations rarely
  // change within a 5-minute window and the frontend already has gcTime: 15 min.
  const _convCache = createTtlCache()
  const CONV_CACHE_TTL_MS = 5 * 60 * 1000
  const convCacheGet = (ticketId) => _convCache.get(ticketId)
  const convCacheSet = (ticketId, payload) => _convCache.set(ticketId, payload, CONV_CACHE_TTL_MS)
  const convCacheDelete = (ticketId) => _convCache.delete(ticketId)

  function normalizeReplyStatus(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')

    if (!normalized) {
      return null
    }

    if (normalized === 'open') {
      return 'open'
    }

    if (normalized === 'pending') {
      return 'pending'
    }

    if (['in_progress', 'inprocess', 'processing', 'process', 'hold'].includes(normalized)) {
      return 'in_progress'
    }

    if (['solved', 'solve', 'resolved', 'close', 'closed', 'done'].includes(normalized)) {
      return 'solved'
    }

    return null
  }

  function sanitizeDownloadFileName(value, fallbackFileName = 'shop-drawing.pdf') {
    const normalized = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')

    if (!normalized) {
      return fallbackFileName
    }

    return normalized
  }

  function ensurePdfFileName(value, fallbackFileName = 'shop-drawing.pdf') {
    const safeFileName = sanitizeDownloadFileName(value, fallbackFileName)

    if (/\.pdf$/i.test(safeFileName)) {
      return safeFileName
    }

    return `${safeFileName}.pdf`
  }

  function normalizeUrl(value) {
    const normalized = String(value ?? '').trim()
    return normalized || null
  }

  function deriveFileNameFromUrl(value) {
    const normalizedUrl = normalizeUrl(value)

    if (!normalizedUrl) {
      return null
    }

    try {
      const parsedUrl = new URL(normalizedUrl)
      const segment = parsedUrl.pathname.split('/').pop() ?? ''
      const decoded = decodeURIComponent(segment).trim()
      return decoded || null
    } catch {
      return null
    }
  }

  function extractMondayAssetIdFromUrl(value) {
    const normalizedUrl = normalizeUrl(value)

    if (!normalizedUrl) {
      return null
    }

    try {
      const parsedUrl = new URL(normalizedUrl)
      const match = parsedUrl.pathname.match(/\/resources\/([0-9]+)(?:\/|$)/i)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  function sanitizeStorageSegment(value, fallback = 'unknown') {
    const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')

    if (!normalized) {
      return fallback
    }

    return normalized.slice(0, 120)
  }

  function createDownloadToken() {
    if (typeof randomUUID === 'function') {
      return randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }

  function normalizeIsoDate(value) {
    const raw = String(value ?? '').trim()

    if (!raw) {
      return null
    }

    const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (directMatch) {
      return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`
    }

    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
      return null
    }

    const year = parsed.getFullYear()
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const day = String(parsed.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function addDaysToIsoDate(isoDate, daysToAdd) {
    const [year, month, day] = String(isoDate ?? '').split('-').map(Number)
    const days = Number(daysToAdd)

    if (!year || !month || !day || !Number.isFinite(days)) {
      return null
    }

    const target = new Date(year, month - 1, day)
    target.setDate(target.getDate() + days)

    const nextYear = target.getFullYear()
    const nextMonth = String(target.getMonth() + 1).padStart(2, '0')
    const nextDay = String(target.getDate()).padStart(2, '0')
    return `${nextYear}-${nextMonth}-${nextDay}`
  }

  function differenceInDaysFromToday(isoDate) {
    const [year, month, day] = String(isoDate ?? '').split('-').map(Number)

    if (!year || !month || !day) {
      return null
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const target = new Date(year, month - 1, day)
    target.setHours(0, 0, 0, 0)

    return Math.round((target.getTime() - today.getTime()) / 86400000)
  }

  function toFiniteNumber(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  function buildBucketCounts(orders, fieldName) {
    const countsByLabel = new Map()

    ;(Array.isArray(orders) ? orders : []).forEach((order) => {
      const label = String(order?.[fieldName] ?? '').trim() || 'Unspecified'
      countsByLabel.set(label, (countsByLabel.get(label) ?? 0) + 1)
    })

    return [...countsByLabel.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count
        }
        return left.label.localeCompare(right.label)
      })
  }

  function compareOrdersByUrgency(left, right) {
    const leftRank = left.isLate
      ? 0
      : left.isDone
        ? 3
        : typeof left.daysUntilDue === 'number'
          ? 1
          : 2
    const rightRank = right.isLate
      ? 0
      : right.isDone
        ? 3
        : typeof right.daysUntilDue === 'number'
          ? 1
          : 2

    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    if (left.isLate && right.isLate) {
      return Number(right.daysLate ?? 0) - Number(left.daysLate ?? 0)
    }

    if (typeof left.daysUntilDue === 'number' && typeof right.daysUntilDue === 'number') {
      return left.daysUntilDue - right.daysUntilDue
    }

    return String(left.name ?? '').localeCompare(String(right.name ?? ''))
  }

  const dashboardProgressStages = [
    { key: 'design', label: 'Design' },
    { key: 'baseform', label: 'Base/Form' },
    { key: 'build', label: 'Build' },
    { key: 'sandorlam', label: 'Sand or lam' },
    { key: 'sealer', label: 'Sealer' },
    { key: 'lacquer', label: 'Lacquer' },
    { key: 'ready', label: 'Ready' },
  ]
  const dashboardProgressStageLabelByKey = new Map(
    dashboardProgressStages.map((stage) => [stage.key, stage.label]),
  )

  function normalizeDashboardProgressKey(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim()
  }

  function normalizeDashboardProgressStatus(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')

    if (!normalized) {
      return null
    }

    if (normalized === 'working on it' || normalized === 'working') {
      return 'working'
    }

    if (normalized === 'done' || normalized === 'ready') {
      return 'done'
    }

    if (normalized === 'stuck' || normalized === 'stock') {
      return 'stuck'
    }

    return null
  }

  function buildDashboardTrackedProgressStageStates(progressStatusDetails) {
    const details = Array.isArray(progressStatusDetails) ? progressStatusDetails : []
    const statusByStage = new Map()

    details.forEach((entry) => {
      const normalizedStatus = normalizeDashboardProgressStatus(entry?.status)

      if (!normalizedStatus) {
        return
      }

      const entryKeys = [
        normalizeDashboardProgressKey(entry?.key),
        normalizeDashboardProgressKey(entry?.label),
      ]

      entryKeys.forEach((entryKey) => {
        if (!entryKey || !dashboardProgressStageLabelByKey.has(entryKey) || statusByStage.has(entryKey)) {
          return
        }

        statusByStage.set(entryKey, normalizedStatus)
      })
    })

    return dashboardProgressStages
      .map((stage, index) => {
        const status = statusByStage.get(stage.key)

        if (!status) {
          return null
        }

        return {
          key: stage.key,
          label: stage.label,
          index,
          status,
        }
      })
      .filter((stage) => Boolean(stage))
  }

  function resolveDashboardTrackedRowStatusLabel(progressStatusDetails) {
    const trackedStages = buildDashboardTrackedProgressStageStates(progressStatusDetails)
    const newestStage = trackedStages[trackedStages.length - 1]

    if (!newestStage) {
      return null
    }

    if (newestStage.status === 'working') {
      return `${newestStage.label} working on it`
    }

    if (newestStage.status === 'stuck') {
      return `${newestStage.label} stuck`
    }

    return newestStage.key === 'ready'
      ? 'Ready'
      : `${newestStage.label} ready`
  }

  function resolveDashboardReadyStageLabel(progressStatusDetails) {
    const details = Array.isArray(progressStatusDetails) ? progressStatusDetails : []

    for (const entry of details) {
      const entryKey = normalizeDashboardProgressKey(entry?.key)
      const entryLabel = normalizeDashboardProgressKey(entry?.label)

      if (entryKey !== 'ready' && entryLabel !== 'ready') {
        continue
      }

      const status = String(entry?.status ?? '').trim()

      if (status) {
        return status
      }
    }

    return null
  }

  function resolveDashboardRowStatusLabel({
    isDone,
    mondayStatus,
    progressStatusDetails,
  }) {
    if (isDone) {
      return 'Shipped'
    }

    const trackedStatus = resolveDashboardTrackedRowStatusLabel(progressStatusDetails)

    if (trackedStatus) {
      return trackedStatus
    }

    return String(mondayStatus ?? '').trim() || 'Open'
  }

  function resolveDashboardProductionStarted({
    isDone,
    persistedValue,
    progressStatusDetails,
  }) {
    if (isDone) {
      return true
    }

    if (typeof persistedValue === 'boolean') {
      return persistedValue
    }

    const trackedStages = buildDashboardTrackedProgressStageStates(progressStatusDetails)

    if (trackedStages.length === 0) {
      return false
    }

    return trackedStages.some((stage) => stage.index > 0)
  }

  function buildDefaultColumnDetection(cachedSnapshot) {
    if (cachedSnapshot?.columnDetection && typeof cachedSnapshot.columnDetection === 'object') {
      return cachedSnapshot.columnDetection
    }

    return {
      statusColumnId: null,
      readyColumnId: null,
      shipDateColumnId: null,
      leadTimeColumnId: null,
      dueDateColumnId: null,
      orderDateColumnId: null,
      invoiceNumberColumnId: null,
      paidInFullColumnId: null,
      amountOwedColumnId: null,
      poAmountColumnId: null,
      progressStatusColumns: [],
    }
  }

  function resolveBoardMetadata(cachedSnapshot, unifiedOrderDocuments) {
    const cachedBoard = cachedSnapshot?.board ?? null
    const cachedBoardId = String(cachedBoard?.id ?? '').trim()
    const cachedBoardName = String(cachedBoard?.name ?? '').trim()
    const cachedBoardUrl = normalizeUrl(cachedBoard?.url)

    if (cachedBoardId || cachedBoardName) {
      return {
        board: {
          id: cachedBoardId || 'orders_unified',
          name: cachedBoardName || 'Orders Unified',
          url: cachedBoardUrl,
        },
        shippedBoard: cachedSnapshot?.shippedBoard ?? null,
      }
    }

    const primaryOrderDocument = (Array.isArray(unifiedOrderDocuments) ? unifiedOrderDocuments : []).find((doc) => {
      const boardName = String(doc?.monday_board_name ?? '').trim().toLowerCase()
      return !Boolean(doc?.is_shipped) && !boardName.includes('shipped')
    }) ?? (Array.isArray(unifiedOrderDocuments) ? unifiedOrderDocuments : [])[0]

    const primaryBoardId = String(primaryOrderDocument?.monday_board_id ?? '').trim()
    const primaryBoardName = String(primaryOrderDocument?.monday_board_name ?? '').trim()

    const shippedOrderDocument = (Array.isArray(unifiedOrderDocuments) ? unifiedOrderDocuments : []).find((doc) => {
      const boardName = String(doc?.monday_board_name ?? '').trim().toLowerCase()
      return Boolean(doc?.is_shipped) || boardName.includes('shipped')
    })

    const shippedBoardId = String(shippedOrderDocument?.monday_board_id ?? '').trim()
    const shippedBoardName = String(shippedOrderDocument?.monday_board_name ?? '').trim()

    return {
      board: {
        id: primaryBoardId || 'orders_unified',
        name: primaryBoardName || 'Orders Unified',
        url: null,
      },
      shippedBoard:
        shippedBoardId || shippedBoardName
          ? {
            id: shippedBoardId || 'shipped_orders',
            name: shippedBoardName || 'Shipped Orders',
            url: null,
          }
          : null,
    }
  }

  function mapUnifiedOrderToDashboardOrder(orderDocument) {
    const orderNumber = String(orderDocument?.order_number ?? '').trim()
    const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()
    const quickBooksProjectId = String(orderDocument?.qb_project_id ?? '').trim()
    const fallbackId = String(orderDocument?.orderKey ?? '').trim()
    const id = mondayItemId || orderNumber || quickBooksProjectId || fallbackId

    const rawDueDate = normalizeIsoDate(orderDocument?.Due_date)
    const orderDate = normalizeIsoDate(orderDocument?.order_date)
    const rawLeadTimeDays = toFiniteNumber(orderDocument?.Lead_time_days)

    const statusLabel = String(orderDocument?.Monday_status ?? '').trim() || 'Open'
    const normalizedStatusLabel = statusLabel.toLowerCase()
    const isDone = Boolean(orderDocument?.is_shipped)
      || normalizedStatusLabel.includes('shipped')
      || normalizedStatusLabel.includes('delivered')
      || normalizedStatusLabel.includes('complete')
      || normalizedStatusLabel === 'done'

    const progressPercentValue = toFiniteNumber(orderDocument?.progress_percent)
    const progressPercent = Number.isFinite(progressPercentValue)
      ? Math.max(0, Math.min(100, Math.round(Number(progressPercentValue))))
      : null
    const progressStatusDetails = Array.isArray(orderDocument?.progress_status_details)
      ? orderDocument.progress_status_details
      : []
    const rowStatus = resolveDashboardRowStatusLabel({
      isDone,
      mondayStatus: statusLabel,
      progressStatusDetails,
    })
    const isProductionStarted = resolveDashboardProductionStarted({
      isDone,
      persistedValue:
        typeof orderDocument?.is_production_started === 'boolean'
          ? orderDocument.is_production_started
          : null,
      progressStatusDetails,
    })
    const scheduleEligible = isDone || isProductionStarted
    const leadTimeDays = scheduleEligible && Number.isFinite(rawLeadTimeDays)
      ? Number(rawLeadTimeDays)
      : null
    const directDueDate = scheduleEligible ? rawDueDate : null
    const computedDueDate = null
    const effectiveDueDate = directDueDate || computedDueDate
    const daysUntilDue = effectiveDueDate ? differenceInDaysFromToday(effectiveDueDate) : null
    const isLate = !isDone && isProductionStarted && typeof daysUntilDue === 'number'
      ? daysUntilDue < 0
      : false
    const daysLate = isLate && typeof daysUntilDue === 'number' ? Math.abs(daysUntilDue) : 0
    const readyStageLabel = resolveDashboardReadyStageLabel(progressStatusDetails)
    const amountOwed = toFiniteNumber(orderDocument?.amountOwed)

    const paidInFull =
      typeof orderDocument?.paidInFull === 'boolean'
        ? Boolean(orderDocument.paidInFull)
        : Number.isFinite(amountOwed)
          ? amountOwed <= 0.004
          : null

    return {
      id,
      mondayItemId: mondayItemId || null,
      orderNumber: orderNumber || null,
      poNumber: String(orderDocument?.po_number ?? '').trim() || null,
      name: String(orderDocument?.order_name ?? '').trim() || orderNumber || id || 'Untitled order',
      mondaySourceBoardType: isDone ? 'shipped_orders' : 'orders_track',
      movedToShippedAt: normalizeIsoDate(orderDocument?.shipped_at),
      groupTitle: String(orderDocument?.monday_board_name ?? '').trim() || 'Orders',
      statusLabel,
      rowStatus,
      stageLabel: rowStatus,
      readyLabel: readyStageLabel || (progressPercent !== null ? `${progressPercent}%` : 'Unspecified'),
      leadTimeDays: Number.isFinite(leadTimeDays) ? Number(leadTimeDays) : null,
      progressPercent,
      orderDate,
      shippedAt: normalizeIsoDate(orderDocument?.shipped_at),
      dueDate: directDueDate,
      computedDueDate,
      effectiveDueDate,
      daysUntilDue,
      isDone,
      isProductionStarted,
      isLate,
      daysLate,
      updatedAt:
        normalizeIsoDate(orderDocument?.monday_updated_at)
        || normalizeIsoDate(orderDocument?.updatedAt),
      itemUrl: normalizeUrl(orderDocument?.Monday_url),
      shopDrawingUrl: normalizeUrl(orderDocument?.Shop_drawing_source)
        || normalizeUrl(orderDocument?.Shop_drawing),
      shopDrawingCachedUrl: normalizeUrl(orderDocument?.Shop_drawing_cached),
      shopDrawingFileName: null,
      invoiceNumber: String(orderDocument?.invoiceNumber ?? '').trim() || null,
      paidInFull,
      amountOwed,
      poAmount: toFiniteNumber(orderDocument?.poAmount),
    }
  }

  async function buildMondaySnapshotFromUnifiedOrders(cachedSnapshot) {
    const { ordersUnifiedCollection } = await getCollections()
    const unifiedOrderDocuments = await ordersUnifiedCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            orderKey: 1,
            order_number: 1,
            order_name: 1,
            monday_item_id: 1,
            qb_project_id: 1,
            is_shipped: 1,
            Monday_status: 1,
            Due_date: 1,
            Lead_time_days: 1,
            progress_percent: 1,
            order_date: 1,
            shipped_at: 1,
            monday_board_id: 1,
            monday_board_name: 1,
            monday_updated_at: 1,
            updatedAt: 1,
            is_production_started: 1,
            Monday_url: 1,
            Shop_drawing: 1,
            Shop_drawing_cached: 1,
            Shop_drawing_source: 1,
            invoiceNumber: 1,
            paidInFull: 1,
            amountOwed: 1,
            po_number: 1,
            poAmount: 1,
            progress_status_details: 1,
          },
        },
      )
      .sort({ is_shipped: 1, Due_date: 1, order_number: 1, updatedAt: -1 })
      .toArray()

    const { board, shippedBoard } = resolveBoardMetadata(cachedSnapshot, unifiedOrderDocuments)

    const orders = unifiedOrderDocuments
      .map(mapUnifiedOrderToDashboardOrder)
      .filter((order) => String(order?.id ?? '').trim())
      .sort(compareOrdersByUrgency)

    const activeOrders = orders.filter((order) => !order.isDone)
    const completedOrders = orders.filter((order) => order.isDone)
    const lateOrders = activeOrders.filter((order) => order.isLate)
    const dueSoonOrders = activeOrders.filter((order) =>
      order.isProductionStarted
      && typeof order.daysUntilDue === 'number'
      && order.daysUntilDue >= 0
      && order.daysUntilDue <= 7,
    )
    const missingDueDateOrders = activeOrders.filter((order) => !order.effectiveDueDate)

    const ordersWithLeadTime = orders.filter((order) => Number.isFinite(Number(order.leadTimeDays)))
    const leadTimeTotal = ordersWithLeadTime.reduce(
      (total, order) => total + Number(order.leadTimeDays ?? 0),
      0,
    )
    const averageLeadTimeDays =
      ordersWithLeadTime.length > 0
        ? Number((leadTimeTotal / ordersWithLeadTime.length).toFixed(1))
        : null

    return {
      board,
      shippedBoard,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalOrders: orders.length,
        activeOrders: activeOrders.length,
        completedOrders: completedOrders.length,
        lateOrders: lateOrders.length,
        dueSoonOrders: dueSoonOrders.length,
        missingDueDateOrders: missingDueDateOrders.length,
        averageLeadTimeDays,
      },
      buckets: {
        byStatus: buildBucketCounts(orders, 'statusLabel'),
        byGroup: buildBucketCounts(orders, 'groupTitle'),
      },
      details: {
        lateOrders,
        dueSoonOrders,
        activeOrders,
        completedOrders,
        missingDueDateOrders,
      },
      orders,
      columnDetection: buildDefaultColumnDetection(cachedSnapshot),
    }
  }

  async function loadShopDrawingCacheByOrderId(orderIds) {
    const normalizedOrderIds = [
      ...new Set(
        (Array.isArray(orderIds) ? orderIds : [])
          .map((value) => String(value ?? '').trim())
          .filter((value) => Boolean(value)),
      ),
    ]

    if (normalizedOrderIds.length === 0) {
      return new Map()
    }

    const { mondayOrdersCollection } = await getCollections()
    const orderDocuments = await mondayOrdersCollection
      .find(
        {
          mondayItemId: {
            $in: normalizedOrderIds,
          },
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingFileName: 1,
          },
        },
      )
      .toArray()

    return new Map(
      orderDocuments
        .map((orderDocument) => {
          const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

          if (!mondayItemId) {
            return null
          }

          return [
            mondayItemId,
            {
              cachedUrl: String(orderDocument?.shopDrawingDownloadUrl ?? '').trim() || null,
              fileName: String(orderDocument?.shopDrawingFileName ?? '').trim() || null,
            },
          ]
        })
        .filter((entry) => entry !== null),
    )
  }

  function enrichOrdersWithShopDrawingCache(orders, cacheByOrderId) {
    if (!Array.isArray(orders) || orders.length === 0) {
      return Array.isArray(orders) ? orders : []
    }

    return orders.map((order) => {
      const orderId = String(order?.id ?? '').trim()

      if (!orderId) {
        return order
      }

      const cachedEntry = cacheByOrderId.get(orderId)
      const cachedUrl = String(cachedEntry?.cachedUrl ?? '').trim() || null

      if (!cachedUrl) {
        return order
      }

      return {
        ...order,
        shopDrawingCachedUrl: cachedUrl,
        shopDrawingFileName:
          String(cachedEntry?.fileName ?? '').trim()
          || String(order?.shopDrawingFileName ?? '').trim()
          || null,
      }
    })
  }

  function enrichMondaySnapshotWithShopDrawingCache(snapshot, cacheByOrderId) {
    const details = snapshot?.details ?? {}

    return {
      ...snapshot,
      orders: enrichOrdersWithShopDrawingCache(snapshot?.orders, cacheByOrderId),
      details: {
        ...details,
        lateOrders: enrichOrdersWithShopDrawingCache(details.lateOrders, cacheByOrderId),
        dueSoonOrders: enrichOrdersWithShopDrawingCache(details.dueSoonOrders, cacheByOrderId),
        activeOrders: enrichOrdersWithShopDrawingCache(details.activeOrders, cacheByOrderId),
        completedOrders: enrichOrdersWithShopDrawingCache(details.completedOrders, cacheByOrderId),
        missingDueDateOrders: enrichOrdersWithShopDrawingCache(
          details.missingDueDateOrders,
          cacheByOrderId,
        ),
      },
    }
  }

  async function resolveOnDemandShopDrawingSource(orderDocument) {
    const existingSourceUrl =
      normalizeUrl(orderDocument?.shopDrawingSourceUrl)
      || normalizeUrl(orderDocument?.shopDrawingResolvedUrl)
      || normalizeUrl(orderDocument?.shopDrawingUrl)

    if (!existingSourceUrl) {
      return {
        sourceUrl: null,
        sourceAssetId: null,
        fileName: null,
      }
    }

    const sourceAssetId =
      String(orderDocument?.shopDrawingSourceAssetId ?? '').trim()
      || extractMondayAssetIdFromUrl(existingSourceUrl)
      || null
    const fallbackFileName =
      String(orderDocument?.shopDrawingFileName ?? '').trim()
      || deriveFileNameFromUrl(existingSourceUrl)
      || `order-${String(orderDocument?.mondayItemId ?? '').trim() || 'shop'}-shop-drawing.pdf`
    const resolvedFileName = ensurePdfFileName(fallbackFileName)
    const isProtectedMondayAssetUrl = /\/protected_static\//i.test(existingSourceUrl)

    if (!isProtectedMondayAssetUrl || !sourceAssetId || typeof fetchMondayAssetDownloadInfo !== 'function') {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }

    try {
      const assetInfo = await fetchMondayAssetDownloadInfo(sourceAssetId)
      const publicUrl = normalizeUrl(assetInfo?.publicUrl)
      const fileName = ensurePdfFileName(
        String(assetInfo?.name ?? '').trim() || resolvedFileName,
        resolvedFileName,
      )

      return {
        sourceUrl: publicUrl || existingSourceUrl,
        sourceAssetId,
        fileName,
      }
    } catch {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }
  }

  async function cacheShopDrawingOnDemand(orderDocument) {
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      throw new Error('Missing Monday item id for this shop drawing.')
    }

    const bucket = typeof getOrderPhotosBucket === 'function' ? getOrderPhotosBucket() : null

    if (!bucket) {
      throw new Error('Order photo storage bucket is unavailable.')
    }

    const sourceInfo = await resolveOnDemandShopDrawingSource(orderDocument)

    if (!sourceInfo.sourceUrl) {
      return null
    }

    const sourceResponse = await fetch(sourceInfo.sourceUrl)

    if (!sourceResponse.ok) {
      throw new Error(`Shop drawing source responded with status ${sourceResponse.status}.`)
    }

    const contentType = String(sourceResponse.headers.get('content-type') ?? '').trim() || 'application/pdf'
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
    const storageOrderId = sanitizeStorageSegment(mondayItemId)
    const storageFileName = sanitizeDownloadFileName(
      sourceInfo.fileName,
      `${storageOrderId}-shop-drawing.pdf`,
    )
    const storagePath = `monday-shop-drawings/${storageOrderId}/${storageFileName}`
    const downloadToken = createDownloadToken()
    const now = new Date().toISOString()
    const targetFile = bucket.file(storagePath)

    await targetFile.save(sourceBuffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          mondayItemId,
          sourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          sourceUrl: sourceInfo.sourceUrl,
          syncedAt: now,
        },
      },
    })

    const cachedDownloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
    const { mondayOrdersCollection } = await getCollections()

    await mondayOrdersCollection.updateOne(
      {
        mondayItemId,
      },
      {
        $set: {
          shopDrawingStoragePath: storagePath,
          shopDrawingDownloadUrl: cachedDownloadUrl,
          shopDrawingContentType: contentType,
          shopDrawingCachedAt: now,
          shopDrawingCacheStatus: 'ready',
          shopDrawingCacheError: null,
          shopDrawingFileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-shop-drawing.pdf`),
          shopDrawingSourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          shopDrawingSourceUrl: null,
          shopDrawingResolvedUrl: null,
          shopDrawingUrl: null,
          updatedAt: now,
        },
      },
    )

    return {
      downloadUrl: cachedDownloadUrl,
      fileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-shop-drawing.pdf`),
    }
  }

  async function resolveOnDemandCutListSource(orderDocument) {
    const existingSourceUrl =
      normalizeUrl(orderDocument?.cutListSourceUrl)
      || normalizeUrl(orderDocument?.cutListResolvedUrl)
      || normalizeUrl(orderDocument?.cutListUrl)

    if (!existingSourceUrl) {
      return {
        sourceUrl: null,
        sourceAssetId: null,
        fileName: null,
      }
    }

    const sourceAssetId =
      String(orderDocument?.cutListSourceAssetId ?? '').trim()
      || extractMondayAssetIdFromUrl(existingSourceUrl)
      || null
    const fallbackFileName =
      String(orderDocument?.cutListFileName ?? '').trim()
      || deriveFileNameFromUrl(existingSourceUrl)
      || `order-${String(orderDocument?.mondayItemId ?? '').trim() || 'cut-list'}-cut-list.pdf`
    const resolvedFileName = ensurePdfFileName(fallbackFileName)
    const isProtectedMondayAssetUrl = /\/protected_static\//i.test(existingSourceUrl)

    if (!isProtectedMondayAssetUrl || !sourceAssetId || typeof fetchMondayAssetDownloadInfo !== 'function') {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }

    try {
      const assetInfo = await fetchMondayAssetDownloadInfo(sourceAssetId)
      const publicUrl = normalizeUrl(assetInfo?.publicUrl)
      const fileName = ensurePdfFileName(
        String(assetInfo?.name ?? '').trim() || resolvedFileName,
        resolvedFileName,
      )

      return {
        sourceUrl: publicUrl || existingSourceUrl,
        sourceAssetId,
        fileName,
      }
    } catch {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }
  }

  async function cacheCutListOnDemand(orderDocument) {
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      throw new Error('Missing Monday item id for this cut list.')
    }

    const bucket = typeof getOrderPhotosBucket === 'function' ? getOrderPhotosBucket() : null

    if (!bucket) {
      throw new Error('Order photo storage bucket is unavailable.')
    }

    const sourceInfo = await resolveOnDemandCutListSource(orderDocument)

    if (!sourceInfo.sourceUrl) {
      return null
    }

    const sourceResponse = await fetch(sourceInfo.sourceUrl)

    if (!sourceResponse.ok) {
      throw new Error(`Cut list source responded with status ${sourceResponse.status}.`)
    }

    const contentType = String(sourceResponse.headers.get('content-type') ?? '').trim() || 'application/pdf'
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
    const storageOrderId = sanitizeStorageSegment(mondayItemId)
    const storageFileName = sanitizeDownloadFileName(
      sourceInfo.fileName,
      `${storageOrderId}-cut-list.pdf`,
    )
    const storagePath = `monday-cut-lists/${storageOrderId}/${storageFileName}`
    const downloadToken = createDownloadToken()
    const now = new Date().toISOString()
    const targetFile = bucket.file(storagePath)

    await targetFile.save(sourceBuffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          mondayItemId,
          sourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          sourceUrl: sourceInfo.sourceUrl,
          syncedAt: now,
        },
      },
    })

    const cachedDownloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
    const { mondayOrdersCollection } = await getCollections()

    await mondayOrdersCollection.updateOne(
      {
        mondayItemId,
      },
      {
        $set: {
          cutListStoragePath: storagePath,
          cutListDownloadUrl: cachedDownloadUrl,
          cutListContentType: contentType,
          cutListCachedAt: now,
          cutListCacheStatus: 'ready',
          cutListCacheError: null,
          cutListFileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-cut-list.pdf`),
          cutListSourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          cutListSourceUrl: null,
          cutListResolvedUrl: null,
          cutListUrl: null,
          updatedAt: now,
        },
      },
    )

    return {
      downloadUrl: cachedDownloadUrl,
      fileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-cut-list.pdf`),
    }
  }

  async function resolveOnDemandBolSource(orderDocument) {
    const existingSourceUrl =
      normalizeUrl(orderDocument?.bolSourceUrl)
      || normalizeUrl(orderDocument?.bolResolvedUrl)
      || normalizeUrl(orderDocument?.bolUrl)
      || normalizeUrl(orderDocument?.bol)

    if (!existingSourceUrl) {
      return {
        sourceUrl: null,
        sourceAssetId: null,
        fileName: null,
      }
    }

    const sourceAssetId =
      String(orderDocument?.bolSourceAssetId ?? '').trim()
      || extractMondayAssetIdFromUrl(existingSourceUrl)
      || null
    const fallbackFileName =
      String(orderDocument?.bolFileName ?? '').trim()
      || deriveFileNameFromUrl(existingSourceUrl)
      || `order-${String(orderDocument?.mondayItemId ?? '').trim() || 'bol'}-bol.pdf`
    const resolvedFileName = ensurePdfFileName(fallbackFileName)
    const isProtectedMondayAssetUrl = /\/protected_static\//i.test(existingSourceUrl)

    if (!isProtectedMondayAssetUrl || !sourceAssetId || typeof fetchMondayAssetDownloadInfo !== 'function') {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }

    try {
      const assetInfo = await fetchMondayAssetDownloadInfo(sourceAssetId)
      const publicUrl = normalizeUrl(assetInfo?.publicUrl)
      const fileName = ensurePdfFileName(
        String(assetInfo?.name ?? '').trim() || resolvedFileName,
        resolvedFileName,
      )

      return {
        sourceUrl: publicUrl || existingSourceUrl,
        sourceAssetId,
        fileName,
      }
    } catch {
      return {
        sourceUrl: existingSourceUrl,
        sourceAssetId,
        fileName: resolvedFileName,
      }
    }
  }

  async function cacheBolOnDemand(orderDocument) {
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      throw new Error('Missing Monday item id for this BOL.')
    }

    const bucket = typeof getOrderPhotosBucket === 'function' ? getOrderPhotosBucket() : null

    if (!bucket) {
      throw new Error('Order photo storage bucket is unavailable.')
    }

    const sourceInfo = await resolveOnDemandBolSource(orderDocument)

    if (!sourceInfo.sourceUrl) {
      return null
    }

    const sourceResponse = await fetch(sourceInfo.sourceUrl)

    if (!sourceResponse.ok) {
      throw new Error(`BOL source responded with status ${sourceResponse.status}.`)
    }

    const contentType = String(sourceResponse.headers.get('content-type') ?? '').trim() || 'application/pdf'
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
    const storageOrderId = sanitizeStorageSegment(mondayItemId)
    const storageFileName = sanitizeDownloadFileName(
      sourceInfo.fileName,
      `${storageOrderId}-bol.pdf`,
    )
    const storagePath = `monday-bol/${storageOrderId}/${storageFileName}`
    const downloadToken = createDownloadToken()
    const now = new Date().toISOString()
    const targetFile = bucket.file(storagePath)

    await targetFile.save(sourceBuffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          mondayItemId,
          sourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          sourceUrl: sourceInfo.sourceUrl,
          syncedAt: now,
        },
      },
    })

    const cachedDownloadUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken)
    const { mondayOrdersCollection } = await getCollections()

    await mondayOrdersCollection.updateOne(
      {
        mondayItemId,
      },
      {
        $set: {
          bolStoragePath: storagePath,
          bolDownloadUrl: cachedDownloadUrl,
          bolContentType: contentType,
          bolCachedAt: now,
          bolCacheStatus: 'ready',
          bolCacheError: null,
          bolFileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-bol.pdf`),
          bolSourceAssetId: String(sourceInfo.sourceAssetId ?? '').trim() || null,
          bolSourceUrl: null,
          bolResolvedUrl: null,
          bolUrl: null,
          updatedAt: now,
        },
      },
    )

    return {
      downloadUrl: cachedDownloadUrl,
      fileName: ensurePdfFileName(sourceInfo.fileName, `${storageOrderId}-bol.pdf`),
    }
  }



// Monday dashboard view is DB-backed from orders_unified so lateness/due
// windows reflect the latest persisted merge state.
app.get('/api/dashboard/monday', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

    if (!refreshRequested && cachedSnapshot) {
      return res.json(cachedSnapshot)
    }

    const snapshot = await buildMondaySnapshotFromUnifiedOrders(cachedSnapshot)

    const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
      Array.isArray(snapshot?.orders)
        ? snapshot.orders.map((order) => order?.id)
        : [],
    )
    const enrichedSnapshot = enrichMondaySnapshotWithShopDrawingCache(snapshot, shopDrawingCacheByOrderId)

    await setDashboardSnapshotCache('monday', enrichedSnapshot)

    res.json(enrichedSnapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday/shop-drawing/download', requireFirebaseAuth, async (req, res, next) => {
  try {
    const orderId = String(req.query?.orderId ?? '').trim()
    const renderInline = String(req.query?.inline ?? '').trim() === '1'

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    async function loadOrderDrawingDocument() {
      const { mondayOrdersCollection } = await getCollections()

      return mondayOrdersCollection.findOne(
        {
          mondayItemId: orderId,
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingFileName: 1,
            shopDrawingSourceAssetId: 1,
            shopDrawingSourceUrl: 1,
            shopDrawingResolvedUrl: 1,
            shopDrawingUrl: 1,
          },
        },
      )
    }

    let orderDocument = await loadOrderDrawingDocument()

    if (!orderDocument) {
      return res.status(404).json({ error: 'Order not found in Monday data.' })
    }

    let cachedDrawingUrl = String(orderDocument.shopDrawingDownloadUrl ?? '').trim()

    // If we have a Monday source URL but no Firebase cache yet, mirror it once
    // and null out the source URL going forward (per the "first-time-only"
    // pull rule). After this, every reader gets the cached Firebase URL.
    if (!cachedDrawingUrl) {
      const hasStoredSource = Boolean(
        String(orderDocument.shopDrawingSourceUrl ?? '').trim()
        || String(orderDocument.shopDrawingResolvedUrl ?? '').trim()
        || String(orderDocument.shopDrawingUrl ?? '').trim(),
      )

      if (!hasStoredSource) {
        return res.status(404).json({ error: 'No shop drawing source found for this order.' })
      }

      try {
        const cacheResult = await cacheShopDrawingOnDemand(orderDocument)
        cachedDrawingUrl = String(cacheResult?.downloadUrl ?? '').trim()
        if (cacheResult?.fileName) {
          orderDocument.shopDrawingFileName = cacheResult.fileName
        }
      } catch (cacheError) {
        const message = cacheError instanceof Error
          ? cacheError.message
          : 'Could not cache this shop drawing right now.'
        return res.status(502).json({ error: message })
      }
    }

    if (!cachedDrawingUrl) {
      return res.status(404).json({ error: 'No shop drawing source found for this order.' })
    }

    if (renderInline) {
      return res.redirect(302, cachedDrawingUrl)
    }

    let upstreamResponse = await fetch(cachedDrawingUrl)

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        error: 'Could not download this shop drawing from cache right now.',
      })
    }

    const downloadFileName = ensurePdfFileName(
      orderDocument.shopDrawingFileName,
      `order-${orderId}-shop-drawing.pdf`,
    )
    const contentType =
      String(upstreamResponse.headers.get('content-type') ?? '').trim() ||
      'application/pdf'
    const contentLength = String(upstreamResponse.headers.get('content-length') ?? '').trim()

    res.setHeader('Content-Type', contentType)
    const contentDispositionType = renderInline ? 'inline' : 'attachment'
    res.setHeader(
      'Content-Disposition',
      `${contentDispositionType}; filename="${downloadFileName.replace(/"/g, '')}"`,
    )
    res.setHeader('Cache-Control', 'private, max-age=120')
    if (contentLength) {
      res.setHeader('Content-Length', contentLength)
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer())

    return res.status(200).send(buffer)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday/cut-list/download', requireFirebaseAuth, async (req, res, next) => {
  try {
    const orderId = String(req.query?.orderId ?? '').trim()
    const renderInline = String(req.query?.inline ?? '').trim() === '1'
    const resolveOnly = String(req.query?.resolveOnly ?? '').trim() === '1'

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    async function loadOrderCutListDocument() {
      const { mondayOrdersCollection } = await getCollections()

      return mondayOrdersCollection.findOne(
        {
          mondayItemId: orderId,
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            cutListDownloadUrl: 1,
            cutListFileName: 1,
            cutListSourceAssetId: 1,
            cutListSourceUrl: 1,
            cutListResolvedUrl: 1,
            cutListUrl: 1,
          },
        },
      )
    }

    let orderDocument = await loadOrderCutListDocument()

    if (!orderDocument) {
      return res.status(404).json({ error: 'Order not found in Monday data.' })
    }

    let cachedCutListUrl = String(orderDocument.cutListDownloadUrl ?? '').trim()

    // Apply the same one-time pull rule as shop drawings:
    // fetch from Monday only once, cache in Firebase, and then serve cache only.
    if (!cachedCutListUrl) {
      const hasStoredSource = Boolean(
        String(orderDocument.cutListSourceUrl ?? '').trim()
        || String(orderDocument.cutListResolvedUrl ?? '').trim()
        || String(orderDocument.cutListUrl ?? '').trim(),
      )

      if (!hasStoredSource) {
        return res.status(404).json({ error: 'No cut list source found for this order.' })
      }

      try {
        const cacheResult = await cacheCutListOnDemand(orderDocument)
        cachedCutListUrl = String(cacheResult?.downloadUrl ?? '').trim()
        if (cacheResult?.fileName) {
          orderDocument.cutListFileName = cacheResult.fileName
        }
      } catch (cacheError) {
        const message = cacheError instanceof Error
          ? cacheError.message
          : 'Could not cache this cut list right now.'
        return res.status(502).json({ error: message })
      }
    }

    if (!cachedCutListUrl) {
      return res.status(404).json({ error: 'No cut list source found for this order.' })
    }

    if (resolveOnly) {
      return res.json({
        orderId,
        cachedUrl: cachedCutListUrl,
        fileName: ensurePdfFileName(
          orderDocument.cutListFileName,
          `order-${orderId}-cut-list.pdf`,
        ),
      })
    }

    if (renderInline) {
      return res.redirect(302, cachedCutListUrl)
    }

    const upstreamResponse = await fetch(cachedCutListUrl)

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        error: 'Could not download this cut list from cache right now.',
      })
    }

    const downloadFileName = ensurePdfFileName(
      orderDocument.cutListFileName,
      `order-${orderId}-cut-list.pdf`,
    )
    const contentType =
      String(upstreamResponse.headers.get('content-type') ?? '').trim() ||
      'application/pdf'
    const contentLength = String(upstreamResponse.headers.get('content-length') ?? '').trim()

    res.setHeader('Content-Type', contentType)
    const contentDispositionType = renderInline ? 'inline' : 'attachment'
    res.setHeader(
      'Content-Disposition',
      `${contentDispositionType}; filename="${downloadFileName.replace(/"/g, '')}"`,
    )
    res.setHeader('Cache-Control', 'private, max-age=120')
    if (contentLength) {
      res.setHeader('Content-Length', contentLength)
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer())

    return res.status(200).send(buffer)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday/bol/download', requireFirebaseAuth, async (req, res, next) => {
  try {
    const orderId = String(req.query?.orderId ?? '').trim()
    const renderInline = String(req.query?.inline ?? '').trim() === '1'
    const cacheOnly = String(req.query?.cacheOnly ?? '').trim() === '1'
    const forceRefresh =
      String(req.query?.forceRefresh ?? '').trim() === '1'
      || String(req.query?.refresh ?? '').trim() === '1'

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required.' })
    }

    async function loadOrderBolDocument() {
      const { mondayOrdersCollection } = await getCollections()

      return mondayOrdersCollection.findOne(
        {
          mondayItemId: orderId,
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            bolDownloadUrl: 1,
            bolFileName: 1,
            bolSourceAssetId: 1,
            bolSourceUrl: 1,
            bolResolvedUrl: 1,
            bolUrl: 1,
            bol: 1,
          },
        },
      )
    }

    let orderDocument = await loadOrderBolDocument()

    if (!orderDocument) {
      return res.status(404).json({ error: 'Order not found in Monday data.' })
    }

    const existingCachedBolUrl = String(orderDocument.bolDownloadUrl ?? '').trim()
    let cachedBolUrl = forceRefresh ? '' : existingCachedBolUrl
    const hasStoredSource = Boolean(
      String(orderDocument.bolSourceUrl ?? '').trim()
      || String(orderDocument.bolResolvedUrl ?? '').trim()
      || String(orderDocument.bolUrl ?? '').trim()
      || String(orderDocument.bol ?? '').trim(),
    )

    if ((!cachedBolUrl || forceRefresh) && hasStoredSource) {
      try {
        const cacheResult = await cacheBolOnDemand(orderDocument)
        cachedBolUrl = String(cacheResult?.downloadUrl ?? '').trim()
        if (cacheResult?.fileName) {
          orderDocument.bolFileName = cacheResult.fileName
        }
      } catch (cacheError) {
        const message = cacheError instanceof Error
          ? cacheError.message
          : 'Could not cache this BOL right now.'
        return res.status(502).json({ error: message })
      }
    }

    // If force refresh is requested but we have no source anymore, keep serving
    // existing cache instead of failing the request.
    if (!cachedBolUrl && forceRefresh && existingCachedBolUrl) {
      cachedBolUrl = existingCachedBolUrl
    }

    if (!cachedBolUrl) {
      return res.status(404).json({ error: 'No BOL source found for this order.' })
    }

    const downloadFileName = ensurePdfFileName(
      orderDocument.bolFileName,
      `order-${orderId}-bol.pdf`,
    )

    if (cacheOnly) {
      return res.json({
        ok: true,
        orderId,
        cachedBolUrl,
        fileName: downloadFileName,
        refreshedFromMonday: forceRefresh && hasStoredSource,
      })
    }

    if (renderInline) {
      return res.redirect(302, cachedBolUrl)
    }

    const upstreamResponse = await fetch(cachedBolUrl)

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        error: 'Could not download this BOL from cache right now.',
      })
    }

    const contentType =
      String(upstreamResponse.headers.get('content-type') ?? '').trim() ||
      'application/pdf'
    const contentLength = String(upstreamResponse.headers.get('content-length') ?? '').trim()

    res.setHeader('Content-Type', contentType)
    const contentDispositionType = renderInline ? 'inline' : 'attachment'
    res.setHeader(
      'Content-Disposition',
      `${contentDispositionType}; filename="${downloadFileName.replace(/"/g, '')}"`,
    )
    res.setHeader('Cache-Control', 'private, max-age=120')
    if (contentLength) {
      res.setHeader('Content-Length', contentLength)
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer())

    return res.status(200).send(buffer)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/zendesk', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('zendesk')

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskTicketSummary()
    await setDashboardSnapshotCache('zendesk', snapshot)

    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/bootstrap', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    async function loadMonday() {
      const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

      if (!refreshRequested && cachedSnapshot) {
        return cachedSnapshot
      }

      const snapshot = await buildMondaySnapshotFromUnifiedOrders(cachedSnapshot)
      const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
        Array.isArray(snapshot?.orders) ? snapshot.orders.map((order) => order?.id) : [],
      )
      const enrichedSnapshot = enrichMondaySnapshotWithShopDrawingCache(snapshot, shopDrawingCacheByOrderId)

      await setDashboardSnapshotCache('monday', enrichedSnapshot)

      return enrichedSnapshot
    }

    async function loadZendesk() {
      if (!refreshRequested) {
        const cachedSnapshot = await getDashboardSnapshotFromCache('zendesk')
        if (cachedSnapshot) {
          return cachedSnapshot
        }
      }

      const snapshot = await fetchZendeskTicketSummary()
      await setDashboardSnapshotCache('zendesk', snapshot)
      return snapshot
    }

    const [mondaySnapshot, zendeskSnapshot] = await Promise.all([loadMonday(), loadZendesk()])

    return res.json({ mondaySnapshot, zendeskSnapshot })
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const snapshotKey = 'support_alerts'

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlerts()
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts/tickets', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limitPerBucket = toBoundedInteger(req.query?.limitPerBucket, 10, 200, 100)
    const snapshotKey = `support_alert_tickets_${limitPerBucket}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlertTicketsSnapshot(limitPerBucket)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limit = toBoundedInteger(req.query?.limit, 10, 100, 50)
    const requestedStatus = String(req.query?.status ?? '').trim().toLowerCase()
    const allowedStatuses = new Set(['new', 'open', 'in_progress', 'pending', 'solved'])
    const status = allowedStatuses.has(requestedStatus) ? requestedStatus : ''
    const snapshotKey = `support_tickets_${status || 'active'}_${limit}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportTicketsSnapshot(limit, status)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/zendesk-agents', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const limit = toBoundedInteger(req.query?.limit, 25, 1000, 300)
    const agents = await fetchZendeskSupportAgents(limit)

    return res.json({
      generatedAt: new Date().toISOString(),
      agents,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets/:ticketId/conversation', requireFirebaseAuth, async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId ?? '').trim()

    if (!/^[0-9]+$/.test(ticketId)) {
      return res.status(400).json({ error: 'ticketId must be numeric.' })
    }

    const cached = convCacheGet(ticketId)
    if (cached) {
      return res.json(cached)
    }

    const conversation = await fetchZendeskTicketConversation(ticketId)
    convCacheSet(ticketId, conversation)
    res.json(conversation)
  } catch (error) {
    next(error)
  }
})

app.post('/api/support/tickets/:ticketId/replies', requireFirebaseAuth, async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId ?? '').trim()

    if (!/^[0-9]+$/.test(ticketId)) {
      return res.status(400).json({ error: 'ticketId must be numeric.' })
    }

    const body = String(req.body?.body ?? '').trim()

    if (!body) {
      return res.status(400).json({ error: 'body is required.' })
    }

    if (body.length > 64000) {
      return res.status(400).json({ error: 'body exceeds 64kb limit.' })
    }

    const rawIsPublic = req.body?.isPublic
    let isPublic = true

    if (typeof rawIsPublic === 'boolean') {
      isPublic = rawIsPublic
    } else if (rawIsPublic !== undefined) {
      const normalizedIsPublic = String(rawIsPublic).trim().toLowerCase()

      if (['true', '1', 'yes', 'on'].includes(normalizedIsPublic)) {
        isPublic = true
      } else if (['false', '0', 'no', 'off'].includes(normalizedIsPublic)) {
        isPublic = false
      } else {
        return res.status(400).json({ error: 'isPublic must be boolean.' })
      }
    }

    const rawStatus = req.body?.status
    const hasStatus =
      rawStatus !== undefined
      && rawStatus !== null
      && String(rawStatus).trim() !== ''
    const status = hasStatus ? normalizeReplyStatus(rawStatus) : null

    if (hasStatus && !status) {
      return res.status(400).json({
        error: 'status must be one of open, pending, in_progress, solved.',
      })
    }

    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return res.status(403).json({ error: 'Approved access is required.' })
    }

    const linkedZendeskUserId = Number(publicUser.linkedZendeskUserId)

    if (!Number.isFinite(linkedZendeskUserId) || linkedZendeskUserId <= 0) {
      return res.status(403).json({
        error: 'Your account is not linked to a Zendesk agent yet. Ask an admin to assign one in Admin Users.',
      })
    }

    const replyResult = await createZendeskTicketReply(ticketId, {
      body,
      isPublic,
      authorId: linkedZendeskUserId,
      status,
    })

    convCacheDelete(ticketId)

    let conversation = null

    try {
      conversation = await fetchZendeskTicketConversation(ticketId)
      convCacheSet(ticketId, conversation)
    } catch (conversationError) {
      console.warn('Unable to refresh support conversation after reply.', conversationError)
    }

    try {
      await clearSupportSnapshotCache()
    } catch (cacheError) {
      console.warn('Unable to clear support snapshot cache after reply.', cacheError)
    }

    return res.status(201).json({
      conversation,
      reply: {
        ticketId: Number(ticketId),
        isPublic,
        authorId: linkedZendeskUserId,
        authorName:
          String(publicUser.linkedZendeskUserName ?? '').trim()
          || String(publicUser.displayName ?? '').trim()
          || publicUser.email,
        status,
        appliedStatus: replyResult.appliedStatus,
        updatedAt: replyResult.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/support/tickets', requireFirebaseAuth, async (req, res, next) => {
  try {
    const subject = String(req.body?.subject ?? '').trim()
    const description = String(req.body?.description ?? '').trim()
    const requesterName = String(req.body?.requesterName ?? '').trim()
    const requesterEmail = String(req.body?.requesterEmail ?? '').trim()
    const priority = String(req.body?.priority ?? '').trim().toLowerCase()

    if (!subject) {
      return res.status(400).json({ error: 'subject is required.' })
    }

    if (!description) {
      return res.status(400).json({ error: 'description is required.' })
    }

    if (requesterEmail && !requesterName) {
      return res.status(400).json({ error: 'requesterName is required when requesterEmail is provided.' })
    }

    const allowedPriorities = ['low', 'normal', 'high', 'urgent']
    const normalizedPriority = allowedPriorities.includes(priority) ? priority : null

    const createdTicket = await createZendeskSupportTicket({
      subject,
      description,
      requesterName,
      requesterEmail,
      priority: normalizedPriority,
    })

    try {
      await clearSupportSnapshotCache()
    } catch (cacheError) {
      console.warn('Unable to clear support snapshot cache after ticket creation.', cacheError)
    }

    return res.status(201).json(createdTicket)
  } catch (error) {
    next(error)
  }
})

}
