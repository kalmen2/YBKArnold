import { createTtlCache } from '../utils/ttl-cache.mjs'

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

  function buildFirebaseStorageDownloadUrl(bucketName, objectPath, downloadToken) {
    const encodedObjectPath = encodeURIComponent(String(objectPath ?? '').trim())
    const encodedToken = encodeURIComponent(String(downloadToken ?? '').trim())

    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedObjectPath}?alt=media&token=${encodedToken}`
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

    const directDueDate = normalizeIsoDate(orderDocument?.Due_date)
    const orderDate = normalizeIsoDate(orderDocument?.order_date)
    const leadTimeDays = toFiniteNumber(orderDocument?.Lead_time_days)
    const computedDueDate =
      !directDueDate && orderDate && Number.isFinite(leadTimeDays)
        ? addDaysToIsoDate(orderDate, Number(leadTimeDays))
        : null
    const effectiveDueDate = directDueDate || computedDueDate
    const daysUntilDue = effectiveDueDate ? differenceInDaysFromToday(effectiveDueDate) : null

    const statusLabel = String(orderDocument?.Monday_status ?? '').trim() || 'Open'
    const normalizedStatusLabel = statusLabel.toLowerCase()
    const isDone = Boolean(orderDocument?.is_shipped)
      || normalizedStatusLabel.includes('shipped')
      || normalizedStatusLabel.includes('delivered')
      || normalizedStatusLabel.includes('complete')
      || normalizedStatusLabel === 'done'
    const isLate = !isDone && typeof daysUntilDue === 'number' ? daysUntilDue < 0 : false
    const daysLate = isLate && typeof daysUntilDue === 'number' ? Math.abs(daysUntilDue) : 0

    const progressPercentValue = toFiniteNumber(orderDocument?.progress_percent)
    const progressPercent = Number.isFinite(progressPercentValue)
      ? Math.max(0, Math.min(100, Math.round(Number(progressPercentValue))))
      : null

    const paidInFull =
      typeof orderDocument?.paidInFull === 'boolean'
        ? Boolean(orderDocument.paidInFull)
        : null

    return {
      id,
      name: String(orderDocument?.order_name ?? '').trim() || orderNumber || id || 'Untitled order',
      mondaySourceBoardType: isDone ? 'shipped_orders' : 'orders_track',
      movedToShippedAt: normalizeIsoDate(orderDocument?.shipped_at),
      groupTitle: String(orderDocument?.monday_board_name ?? '').trim() || 'Orders',
      statusLabel,
      stageLabel: statusLabel,
      readyLabel: progressPercent !== null ? `${progressPercent}%` : 'Unspecified',
      leadTimeDays: Number.isFinite(leadTimeDays) ? Number(leadTimeDays) : null,
      progressPercent,
      orderDate,
      shippedAt: normalizeIsoDate(orderDocument?.shipped_at),
      dueDate: directDueDate,
      computedDueDate,
      effectiveDueDate,
      daysUntilDue,
      isDone,
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
      amountOwed: toFiniteNumber(orderDocument?.amountOwed),
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
            Monday_url: 1,
            Shop_drawing: 1,
            Shop_drawing_cached: 1,
            Shop_drawing_source: 1,
            invoiceNumber: 1,
            paidInFull: 1,
            amountOwed: 1,
            poAmount: 1,
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
      typeof order.daysUntilDue === 'number' && order.daysUntilDue >= 0 && order.daysUntilDue <= 7,
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



// Monday dashboard view is DB-backed from orders_unified so lateness/due
// windows reflect the latest persisted merge state.
app.get('/api/dashboard/monday', requireFirebaseAuth, async (_req, res, next) => {
  try {
    const cachedSnapshot = await getDashboardSnapshotFromCache('monday')
    const snapshot = await buildMondaySnapshotFromUnifiedOrders(cachedSnapshot)

    const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
      Array.isArray(snapshot?.orders)
        ? snapshot.orders.map((order) => order?.id)
        : [],
    )
    const enrichedSnapshot = enrichMondaySnapshotWithShopDrawingCache(snapshot, shopDrawingCacheByOrderId)

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
      const snapshot = await buildMondaySnapshotFromUnifiedOrders(cachedSnapshot)
      const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
        Array.isArray(snapshot?.orders) ? snapshot.orders.map((order) => order?.id) : [],
      )
      return enrichMondaySnapshotWithShopDrawingCache(snapshot, shopDrawingCacheByOrderId)
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
    const snapshotKey = `support_tickets_${limit}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportTicketsSnapshot(limit)
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
