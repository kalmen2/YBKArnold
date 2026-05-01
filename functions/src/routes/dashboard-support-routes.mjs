import { createTtlCache } from '../utils/ttl-cache.mjs'

export function registerDashboardSupportRoutes(app, deps) {
  const {
    clearSupportSnapshotCache,
    createZendeskTicketReply,
    createZendeskSupportTicket,
    fetchMondayDashboardSnapshot,
    fetchZendeskSupportAgents,
    fetchZendeskSupportAlertTicketsSnapshot,
    fetchZendeskSupportAlerts,
    fetchZendeskSupportTicketsSnapshot,
    fetchZendeskTicketConversation,
    fetchZendeskTicketSummary,
    getCollections,
    getDashboardSnapshotFromCache,
    isDashboardRefreshRequested,
    mondayShippedBoardId,
    mondayShippedBoardUrl,
    persistNewMondayOrders,
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

  function normalizeJobLookupValue(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function extractJobDigits(value) {
    const digits = String(value ?? '').replace(/\D+/g, '').trim()

    return digits || null
  }

  function buildJobLookupValues(values) {
    const normalizedValues = new Set()
    const digitValues = new Set()

    ;(Array.isArray(values) ? values : []).forEach((value) => {
      const normalizedValue = normalizeJobLookupValue(value)

      if (normalizedValue) {
        normalizedValues.add(normalizedValue)
      }

      const digitValue = extractJobDigits(value)

      if (digitValue) {
        digitValues.add(digitValue)
      }
    })

    return {
      normalizedValues,
      digitValues,
    }
  }

  function doesJobNameMatchLookup(jobName, lookup) {
    const normalizedJobName = normalizeJobLookupValue(jobName)

    if (normalizedJobName && lookup.normalizedValues.has(normalizedJobName)) {
      return true
    }

    const jobDigits = extractJobDigits(jobName)

    if (jobDigits && lookup.digitValues.has(jobDigits)) {
      return true
    }

    return false
  }

  function buildLatestOrderProgressLookups(orderProgressDocuments) {
    const latestByNormalized = new Map()
    const latestByDigits = new Map()

    ;(Array.isArray(orderProgressDocuments) ? orderProgressDocuments : []).forEach((progress) => {
      const normalizedJobName = normalizeJobLookupValue(progress?.jobName)

      if (normalizedJobName && !latestByNormalized.has(normalizedJobName)) {
        latestByNormalized.set(normalizedJobName, progress)
      }

      const jobDigits = extractJobDigits(progress?.jobName)

      if (jobDigits && !latestByDigits.has(jobDigits)) {
        latestByDigits.set(jobDigits, progress)
      }
    })

    return {
      latestByNormalized,
      latestByDigits,
    }
  }

  function resolveLatestOrderProgressForOrder(orderDocument, progressLookups) {
    const orderJobNumber = extractJobNumber(orderDocument)
    const orderName = String(orderDocument?.orderName ?? '').trim()
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()
    const lookup = buildJobLookupValues([orderJobNumber, orderName, mondayItemId])

    for (const normalizedValue of lookup.normalizedValues) {
      const progress = progressLookups.latestByNormalized.get(normalizedValue)

      if (progress) {
        return progress
      }
    }

    for (const digitValue of lookup.digitValues) {
      const progress = progressLookups.latestByDigits.get(digitValue)

      if (progress) {
        return progress
      }
    }

    return null
  }

  function getEntryRegularHours(entry) {
    const regularHours = Number(entry?.hours)

    if (!Number.isFinite(regularHours) || regularHours < 0) {
      return 0
    }

    return regularHours
  }

  function getEntryOvertimeHours(entry) {
    const overtimeHours = Number(entry?.overtimeHours)

    if (!Number.isFinite(overtimeHours) || overtimeHours < 0) {
      return 0
    }

    return overtimeHours
  }

  function getEntryRate(entry, workerDocument) {
    const snapshotRate = Number(entry?.payRate)

    if (Number.isFinite(snapshotRate) && snapshotRate > 0) {
      return snapshotRate
    }

    const workerRate = Number(workerDocument?.hourlyRate)

    if (Number.isFinite(workerRate) && workerRate > 0) {
      return workerRate
    }

    return 0
  }

  function toMoney(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      return 0
    }

    return Number(parsed.toFixed(2))
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

  function snapshotHasInvoicePaymentFields(snapshot) {
    const orders = Array.isArray(snapshot?.orders) ? snapshot.orders : []

    if (orders.length === 0) {
      return true
    }

    const sampleOrder = orders.find((order) => order && typeof order === 'object')

    if (!sampleOrder) {
      return true
    }

    return (
      Object.prototype.hasOwnProperty.call(sampleOrder, 'invoiceNumber')
      && Object.prototype.hasOwnProperty.call(sampleOrder, 'paidInFull')
      && Object.prototype.hasOwnProperty.call(sampleOrder, 'amountOwed')
    )
  }

  async function refreshMondayOrdersAndCache() {
    const snapshot = await fetchMondayDashboardSnapshot()

    await persistNewMondayOrders(snapshot)
    await setDashboardSnapshotCache('monday', snapshot)

    const shippedBoardId = String(mondayShippedBoardId ?? '').trim()

    if (shippedBoardId) {
      try {
        const shippedSnapshot = await fetchMondayDashboardSnapshot({
          boardId: shippedBoardId,
          boardUrl: String(mondayShippedBoardUrl ?? '').trim() || null,
          boardName: 'Shipped Orders',
        })

        await persistNewMondayOrders(shippedSnapshot)
        await setDashboardSnapshotCache(`monday_shipped_${shippedBoardId}`, shippedSnapshot)
      } catch (error) {
        console.error('Unable to refresh shipped Monday board snapshot.', error)
      }
    }

    return snapshot
  }

  function isShippedOrderDocument(orderDocument) {
    const shippedBoardId = String(mondayShippedBoardId ?? '').trim()
    const boardId = String(orderDocument?.mondayBoardId ?? '').trim()
    const movedToShippedAt = String(orderDocument?.movedToShippedAt ?? '').trim()
    const statusLabel = String(orderDocument?.statusLabel ?? '').trim().toLowerCase()

    if (shippedBoardId && boardId === shippedBoardId) {
      return true
    }

    if (movedToShippedAt) {
      return true
    }

    if (/\bnot\s+shipped\b/.test(statusLabel)) {
      return false
    }

    return /\bshipped\b/.test(statusLabel)
  }

  function extractJobNumber(orderDocument) {
    const explicitJobNumber = String(orderDocument?.jobNumber ?? '').trim()

    if (explicitJobNumber) {
      return explicitJobNumber
    }

    const orderName = String(orderDocument?.orderName ?? '').trim()
    const matchedDigits = orderName.match(/\b\d{4,}\b/)

    if (matchedDigits?.[0]) {
      return matchedDigits[0]
    }

    return String(orderDocument?.mondayItemId ?? '').trim()
  }

  function buildOrdersOverviewRow(orderDocument, progressLookups) {
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()
    const orderName = String(orderDocument?.orderName ?? '').trim() || null
    const isShipped = isShippedOrderDocument(orderDocument)
    const rawStatusLabel = String(orderDocument?.statusLabel ?? '').trim() || null
    const latestManagerProgress = resolveLatestOrderProgressForOrder(orderDocument, progressLookups)
    const estimatedReadyAt =
      String(
        orderDocument?.estimatedReadyAt
        ?? orderDocument?.estimatedReadyDate
        ?? orderDocument?.estimatedReady
        ?? '',
      ).trim() || null

    return {
      id: mondayItemId,
      mondayItemId,
      jobNumber: extractJobNumber(orderDocument),
      orderName,
      poAmount: Number.isFinite(orderDocument?.poAmount) ? Number(orderDocument.poAmount) : null,
      invoiceNumber: String(orderDocument?.invoiceNumber ?? '').trim() || null,
      progressPercent: Number.isFinite(orderDocument?.progressPercent)
        ? Number(orderDocument.progressPercent)
        : null,
      mondayStatusLabel: isShipped ? 'Shipped' : rawStatusLabel,
      managerReadyPercent: Number.isFinite(Number(latestManagerProgress?.readyPercent))
        ? Number(latestManagerProgress.readyPercent)
        : null,
      managerReadyDate: String(latestManagerProgress?.date ?? '').trim() || null,
      managerReadyUpdatedAt: String(latestManagerProgress?.updatedAt ?? '').trim() || null,
      estimatedReadyAt,
      statusLabel: isShipped ? 'Shipped' : rawStatusLabel,
      isShipped,
      shippedAt: String(orderDocument?.shippedAt ?? '').trim() || null,
      movedToShippedAt: String(orderDocument?.movedToShippedAt ?? '').trim() || null,
      mondayBoardId: String(orderDocument?.mondayBoardId ?? '').trim() || null,
      mondayBoardName: String(orderDocument?.mondayBoardName ?? '').trim() || null,
      mondayUpdatedAt: String(orderDocument?.mondayUpdatedAt ?? '').trim() || null,
      mondayItemUrl: String(orderDocument?.mondayItemUrl ?? '').trim() || null,
      dueDate: String(orderDocument?.effectiveDueDate ?? '').trim()
        || String(orderDocument?.dueDate ?? '').trim()
        || String(orderDocument?.computedDueDate ?? '').trim()
        || null,
      shopDrawingCachedUrl: String(orderDocument?.shopDrawingDownloadUrl ?? '').trim() || null,
      shopDrawingUrl: String(orderDocument?.shopDrawingUrl ?? '').trim() || null,
      shopDrawingFileName: String(orderDocument?.shopDrawingFileName ?? '').trim() || null,
    }
  }


app.get('/api/orders/overview', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
  try {
    const includeShipped = String(req.query?.includeShipped ?? '').trim() === '1'
    const refreshRequested = isDashboardRefreshRequested(req)
    const { mondayOrdersCollection, orderProgressCollection } = await getCollections()
    const existingCount = await mondayOrdersCollection.estimatedDocumentCount()
    let refreshed = false

    if (refreshRequested || existingCount === 0) {
      await refreshMondayOrdersAndCache()
      refreshed = true
    }

    const orderDocuments = await mondayOrdersCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            jobNumber: 1,
            orderName: 1,
            poAmount: 1,
            invoiceNumber: 1,
            progressPercent: 1,
            estimatedReadyAt: 1,
            estimatedReadyDate: 1,
            estimatedReady: 1,
            statusLabel: 1,
            isDone: 1,
            shippedAt: 1,
            movedToShippedAt: 1,
            mondayBoardId: 1,
            mondayBoardName: 1,
            mondayUpdatedAt: 1,
            mondayItemUrl: 1,
            effectiveDueDate: 1,
            dueDate: 1,
            computedDueDate: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingUrl: 1,
            shopDrawingFileName: 1,
            updatedAt: 1,
            createdAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1, createdAt: -1, mondayItemId: 1 })
      .toArray()

    const orderProgressDocuments = await orderProgressCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            date: 1,
            jobName: 1,
            readyPercent: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ date: -1, updatedAt: -1 })
      .toArray()
    const progressLookups = buildLatestOrderProgressLookups(orderProgressDocuments)

    const rows = orderDocuments.map((orderDocument) =>
      buildOrdersOverviewRow(orderDocument, progressLookups)
    )
    const shippedCount = rows.filter((row) => row.isShipped).length
    const visibleRows = includeShipped ? rows : rows.filter((row) => !row.isShipped)

    return res.json({
      generatedAt: new Date().toISOString(),
      includeShipped,
      refreshed,
      counts: {
        total: rows.length,
        shipped: shippedCount,
        visible: visibleRows.length,
      },
      orders: visibleRows,
    })
  } catch (error) {
    next(error)
  }
})


app.get('/api/orders/job-details', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
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
      jobNumber
      || extractJobNumber(orderDocument)
      || String(mondayItemId ?? '').trim()

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

    const [entries, workers, stages, orderProgressDocuments] = await Promise.all([
      entriesCollection
        .find(
          {},
          {
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
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      workersCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              fullName: 1,
              hourlyRate: 1,
            },
          },
        )
        .toArray(),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
            },
          },
        )
        .toArray(),
      orderProgressCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              date: 1,
              jobName: 1,
              readyPercent: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
    ])

    const workersById = new Map(
      workers.map((worker) => [String(worker.id ?? '').trim(), worker]),
    )
    const stagesById = new Map(
      stages.map((stage) => [String(stage.id ?? '').trim(), stage]),
    )

    const matchedEntries = entries
      .filter((entry) => doesJobNameMatchLookup(entry?.jobName, lookup))
      .map((entry) => {
        const workerId = String(entry?.workerId ?? '').trim()
        const workerDocument = workersById.get(workerId) ?? null
        const stageId = String(entry?.stageId ?? '').trim()
        const stageDocument = stagesById.get(stageId) ?? null
        const regularHours = getEntryRegularHours(entry)
        const overtimeHours = getEntryOvertimeHours(entry)
        const totalHours = regularHours + overtimeHours
        const rate = getEntryRate(entry, workerDocument)
        const laborCost = toMoney((regularHours * rate) + (overtimeHours * rate * 1.5))

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

    return res.json({
      generatedAt: new Date().toISOString(),
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
        (left, right) => right.totalHours - left.totalHours || left.workerName.localeCompare(right.workerName),
      ),
      entries: matchedEntries,
      managerHistory,
    })
  } catch (error) {
    next(error)
  }
})


app.get('/api/dashboard/monday', requireFirebaseAuth, async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    let snapshot = null

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

      if (cachedSnapshot) {
        snapshot = cachedSnapshot
      }
    }

    if (snapshot && !snapshotHasInvoicePaymentFields(snapshot)) {
      snapshot = null
    }

    if (!snapshot) {
      snapshot = await fetchMondayDashboardSnapshot()
    }

    const shopDrawingCacheByOrderId = await loadShopDrawingCacheByOrderId(
      Array.isArray(snapshot?.orders)
        ? snapshot.orders.map((order) => order?.id)
        : [],
    )
    const enrichedSnapshot = enrichMondaySnapshotWithShopDrawingCache(
      snapshot,
      shopDrawingCacheByOrderId,
    )

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
          },
        },
      )
    }

    const refreshRequested = isDashboardRefreshRequested(req)
    let orderDocument = await loadOrderDrawingDocument()

    if (
      refreshRequested
      || !orderDocument
      || !String(orderDocument.shopDrawingDownloadUrl ?? '').trim()
    ) {
      await refreshMondayOrdersAndCache()
      orderDocument = await loadOrderDrawingDocument()
    }

    if (!orderDocument) {
      return res.status(404).json({ error: 'Order not found in Monday data.' })
    }

    const cachedDrawingUrl = String(orderDocument.shopDrawingDownloadUrl ?? '').trim()

    if (!cachedDrawingUrl) {
      return res.status(404).json({ error: 'No cached shop drawing found for this order.' })
    }

    if (renderInline) {
      return res.redirect(302, cachedDrawingUrl)
    }

    let upstreamResponse = await fetch(cachedDrawingUrl)

    if (!upstreamResponse.ok && !refreshRequested) {
      await refreshMondayOrdersAndCache()
      orderDocument = await loadOrderDrawingDocument()

      const refreshedDrawingUrl = String(orderDocument?.shopDrawingDownloadUrl ?? '').trim()

      if (refreshedDrawingUrl) {
        upstreamResponse = await fetch(refreshedDrawingUrl)
      }
    }

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
      let snapshot = null

      if (!refreshRequested) {
        snapshot = await getDashboardSnapshotFromCache('monday')
      }

      if (snapshot && !snapshotHasInvoicePaymentFields(snapshot)) {
        snapshot = null
      }

      if (!snapshot) {
        snapshot = await fetchMondayDashboardSnapshot()
      }

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
