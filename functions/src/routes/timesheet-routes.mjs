import { AppError } from '../utils/app-error.mjs'

export function registerTimesheetRoutes(app, deps) {
  const {
    authApprovalApproved,
    fetchMondayDashboardSnapshot,
    allocateWorkerNumbers,
    ensureEntriesHavePayRates,
    ensureWorkersHaveWorkerNumbers,
    getCollections,
    getDashboardSnapshotFromCache,
    isDashboardRefreshRequested,
    mondayShippedBoardId,
    mondayShippedBoardUrl,
    mobileAlertTargetModeSelected,
    normalizeJobName,
    normalizeOptionalShortText,
    normalizeStageName,
    normalizeEmail,
    randomUUID,
    requireAdminRole,
    requireManagerOrAdminRole,
    requireApprovedLinkedWorker,
    requireFirebaseAuth,
    setDashboardSnapshotCache,
    toPublicAuthUser,
    toPublicMobileAlert,
    validateEntryFields,
    validateEntryInput,
    validateWorkerInput,
  } = deps

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
  const canonicalOrderNumberPattern = /^\d{4,}([A-Z]|-[A-Z])?$/
  const duplicateConstraintMessage =
    'Daily sheet save failed due to a duplicate database constraint. Please refresh and try again.'

  function isDuplicateKeyError(error) {
    return Number(error?.code) === 11000
  }

  function buildDuplicateKeyError() {
    return new AppError(duplicateConstraintMessage, 400)
  }

  function extractOrderDigits(value) {
    return String(value ?? '').replace(/\D+/g, '').trim()
  }

  function normalizeLooseOrderLookup(value) {
    return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  }

  function toIsoDateOnly(value) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    if (isoDatePattern.test(normalized)) {
      return normalized
    }

    // Preserve explicit source date components before timezone conversion.
    const sourceDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/)

    if (sourceDateMatch) {
      return sourceDateMatch[1]
    }

    const parsedMs = Date.parse(normalized)

    if (!Number.isFinite(parsedMs)) {
      return null
    }

    return new Date(parsedMs).toISOString().slice(0, 10)
  }

  async function shouldForceShippedReadyPercent({ ordersUnifiedCollection, date, jobName }) {
    const normalizedJobName = String(jobName ?? '').trim()

    if (!normalizedJobName || !isoDatePattern.test(date)) {
      return false
    }

    const orderDigits = extractOrderDigits(normalizedJobName)
    const orderNumberCandidates = [...new Set([
      normalizedJobName,
      orderDigits,
    ].filter(Boolean))]

    let shippedOrder = null

    if (orderNumberCandidates.length > 0) {
      shippedOrder = await ordersUnifiedCollection.findOne(
        {
          is_shipped: true,
          order_number: {
            $in: orderNumberCandidates,
          },
        },
        {
          projection: {
            _id: 0,
            shipped_at: 1,
          },
        },
      )
    }

    if (!shippedOrder && orderDigits) {
      shippedOrder = await ordersUnifiedCollection.findOne(
        {
          is_shipped: true,
          order_name: {
            $regex: orderDigits,
            $options: 'i',
          },
        },
        {
          projection: {
            _id: 0,
            shipped_at: 1,
          },
        },
      )
    }

    if (!shippedOrder) {
      return false
    }

    const shippedDate = toIsoDateOnly(shippedOrder?.shipped_at)

    if (!shippedDate) {
      return true
    }

    return date >= shippedDate
  }

  function isGeneralOrderJobName(jobName) {
    const digits = extractOrderDigits(jobName)

    return Boolean(digits && /^0+$/.test(digits))
  }

  function resolveShopDrawingFileName({
    shopDrawingCachedUrl,
    shopDrawingSourceUrl,
    shopDrawingValue,
  }) {
    const candidates = [shopDrawingCachedUrl, shopDrawingSourceUrl, shopDrawingValue]

    for (const candidate of candidates) {
      const trimmedCandidate = String(candidate ?? '').trim()

      if (!trimmedCandidate) {
        continue
      }

      try {
        const parsedUrl = new URL(trimmedCandidate)
        const pathname = String(parsedUrl.pathname ?? '').trim()
        const fileName = decodeURIComponent(pathname.split('/').pop() ?? '').trim()

        if (fileName) {
          return fileName
        }
      } catch {
        const withoutQuery = trimmedCandidate.split('?')[0]
        const fileName = String(withoutQuery.split('/').pop() ?? '').trim()

        if (fileName && !fileName.includes(':')) {
          return fileName
        }
      }
    }

    return null
  }

  function toPublicUnifiedOrder(document) {
    const orderNumber = normalizeOptionalShortText(document?.order_number, 120) || null
    const orderName = normalizeOptionalShortText(document?.order_name, 260) || null
    const mondayItemId = normalizeOptionalShortText(document?.monday_item_id, 120) || null
    const shopDrawingCachedUrl = normalizeOptionalShortText(document?.Shop_drawing_cached, 800) || null
    const shopDrawingSourceUrl =
      normalizeOptionalShortText(document?.Shop_drawing_source, 800)
      || normalizeOptionalShortText(document?.Shop_drawing, 800)
      || null
    const sourceValue = String(document?.source ?? '').trim().toLowerCase()
    const source =
      sourceValue === 'monday' || sourceValue === 'quickbooks' || sourceValue === 'merged'
        ? sourceValue
        : Boolean(document?.has_monday_record)
          ? 'monday'
          : 'quickbooks'

    return {
      orderKey: normalizeOptionalShortText(document?.orderKey, 200) || null,
      orderNumber,
      orderName,
      mondayItemId,
      shopDrawingCachedUrl,
      shopDrawingUrl: shopDrawingSourceUrl,
      shopDrawingFileName: resolveShopDrawingFileName({
        shopDrawingCachedUrl,
        shopDrawingSourceUrl,
        shopDrawingValue: document?.Shop_drawing,
      }),
      hasMondayRecord: Boolean(document?.has_monday_record),
      hasQuickBooksRecord: Boolean(document?.has_quickbooks_record),
      inDesign: Boolean(document?.in_design),
      isShipped: Boolean(document?.is_shipped),
      source,
      hazardReason: normalizeOptionalShortText(document?.hazard_reason, 500) || null,
      mondayUpdatedAt: normalizeOptionalShortText(document?.monday_updated_at, 80) || null,
    }
  }

  function buildEmptyWebsiteIssues() {
    return {
      generatedAt: new Date().toISOString(),
      counts: {
        total: 0,
        hazard: 0,
        duplicateMondayLinks: 0,
        unmappedTimesheetJobs: 0,
        missingShopDrawings: 0,
      },
      hazards: [],
      duplicateMondayLinks: [],
      unmappedTimesheetJobs: [],
      missingShopDrawings: [],
    }
  }

  async function loadUnifiedOrdersAndIssues(timesheetState) {
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
            Shop_drawing: 1,
            Shop_drawing_cached: 1,
            Shop_drawing_source: 1,
            has_monday_record: 1,
            has_quickbooks_record: 1,
            in_design: 1,
            is_shipped: 1,
            source: 1,
            hazard_reason: 1,
            monday_updated_at: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ updatedAt: -1, order_number: 1 })
      .toArray()

    const unifiedOrders = unifiedOrderDocuments.map(toPublicUnifiedOrder)
    const duplicateMondayLinks = []

    const hazards = unifiedOrders
      .filter((order) => String(order?.hazardReason ?? '').trim())
      .map((order) => ({
        orderNumber: order.orderNumber,
        orderName: order.orderName,
        hazardReason: order.hazardReason,
        hasMondayRecord: order.hasMondayRecord,
        hasQuickBooksRecord: order.hasQuickBooksRecord,
      }))
      .slice(0, 250)

    const missingShopDrawings = unifiedOrders
      .filter((order) => (
        order.hasMondayRecord
        && !order.isShipped
        && !String(order.shopDrawingCachedUrl ?? '').trim()
        && !String(order.shopDrawingUrl ?? '').trim()
      ))
      .map((order) => ({
        orderNumber: order.orderNumber,
        orderName: order.orderName,
        mondayItemId: order.mondayItemId,
        source: order.source,
        hazardReason: order.hazardReason,
      }))
      .slice(0, 250)

    const unifiedOrderNumbersExact = new Set(
      unifiedOrders
        .map((order) => String(order?.orderNumber ?? '').trim())
        .filter(Boolean),
    )
    const unifiedOrderNumbersLoose = new Set(
      unifiedOrders
        .map((order) => normalizeLooseOrderLookup(order?.orderNumber))
        .filter(Boolean),
    )
    const timesheetJobCountsByName = new Map()

    ;(Array.isArray(timesheetState?.entries) ? timesheetState.entries : []).forEach((entry) => {
      const jobName = String(entry?.jobName ?? '').trim()

      if (!jobName || isGeneralOrderJobName(jobName)) {
        return
      }

      const currentCounts = timesheetJobCountsByName.get(jobName) ?? {
        jobName,
        entryCount: 0,
        progressCount: 0,
      }

      currentCounts.entryCount += 1
      timesheetJobCountsByName.set(jobName, currentCounts)
    })

    ;(Array.isArray(timesheetState?.orderProgress) ? timesheetState.orderProgress : []).forEach((progress) => {
      const jobName = String(progress?.jobName ?? '').trim()

      if (!jobName || isGeneralOrderJobName(jobName)) {
        return
      }

      const currentCounts = timesheetJobCountsByName.get(jobName) ?? {
        jobName,
        entryCount: 0,
        progressCount: 0,
      }

      currentCounts.progressCount += 1
      timesheetJobCountsByName.set(jobName, currentCounts)
    })

    const unmappedTimesheetJobs = [...timesheetJobCountsByName.values()]
      .filter((jobCounts) => {
        const jobName = String(jobCounts?.jobName ?? '').trim()

        if (!jobName) {
          return false
        }

        if (unifiedOrderNumbersExact.has(jobName)) {
          return false
        }

        const looseJobName = normalizeLooseOrderLookup(jobName)

        if (looseJobName && unifiedOrderNumbersLoose.has(looseJobName)) {
          return false
        }

        return canonicalOrderNumberPattern.test(jobName.toUpperCase())
      })
      .sort((left, right) => {
        const leftTotal = Number(left?.entryCount ?? 0) + Number(left?.progressCount ?? 0)
        const rightTotal = Number(right?.entryCount ?? 0) + Number(right?.progressCount ?? 0)

        if (rightTotal !== leftTotal) {
          return rightTotal - leftTotal
        }

        return String(left?.jobName ?? '').localeCompare(String(right?.jobName ?? ''))
      })
      .slice(0, 250)

    const websiteIssues = {
      generatedAt: new Date().toISOString(),
      counts: {
        total:
          hazards.length
          + duplicateMondayLinks.length
          + unmappedTimesheetJobs.length
          + missingShopDrawings.length,
        hazard: hazards.length,
        duplicateMondayLinks: duplicateMondayLinks.length,
        unmappedTimesheetJobs: unmappedTimesheetJobs.length,
        missingShopDrawings: missingShopDrawings.length,
      },
      hazards,
      duplicateMondayLinks: duplicateMondayLinks.slice(0, 250),
      unmappedTimesheetJobs,
      missingShopDrawings,
    }

    return {
      unifiedOrders,
      websiteIssues,
    }
  }

  async function fetchWorkerRateById(workersCollection, workerIds) {
    const uniqueWorkerIds = [...new Set(workerIds.map((value) => String(value ?? '').trim()))].filter(Boolean)

    if (uniqueWorkerIds.length === 0) {
      return new Map()
    }

    const validWorkers = await workersCollection
      .find(
        {
          id: {
            $in: uniqueWorkerIds,
          },
        },
        {
          projection: {
            _id: 0,
            id: 1,
            hourlyRate: 1,
          },
        },
      )
      .toArray()

    if (validWorkers.length !== uniqueWorkerIds.length) {
      throw new AppError('One or more worker IDs are invalid.', 400)
    }

    return new Map(
      validWorkers.map((worker) => [String(worker.id), Number(worker.hourlyRate)]),
    )
  }

  async function assertValidStageIds(stagesCollection, stageIds) {
    const uniqueStageIds = [...new Set(stageIds.map((value) => String(value ?? '').trim()))].filter(Boolean)

    if (uniqueStageIds.length === 0) {
      return
    }

    const validStages = await stagesCollection
      .find(
        {
          id: {
            $in: uniqueStageIds,
          },
        },
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )
      .toArray()

    if (validStages.length !== uniqueStageIds.length) {
      throw {
        status: 400,
        message: 'One or more stage IDs are invalid.',
      }
    }
  }

  function resolveEntryPayRate({
    existingEntryPayRate,
    existingWorkerId,
    nextWorkerId,
    workerRate,
  }) {
    const parsedWorkerRate = Number(workerRate)
    const parsedExistingPayRate = Number(existingEntryPayRate)
    const shouldUseWorkerRate = Number.isFinite(parsedWorkerRate) && parsedWorkerRate > 0
    const workerChanged = String(existingWorkerId ?? '') !== String(nextWorkerId ?? '')

    if (workerChanged) {
      return shouldUseWorkerRate ? parsedWorkerRate : null
    }

    if (Number.isFinite(parsedExistingPayRate) && parsedExistingPayRate > 0) {
      return parsedExistingPayRate
    }

    return shouldUseWorkerRate ? parsedWorkerRate : null
  }

  async function buildTimesheetStatePayload(req) {
    const {
      workersCollection,
      entriesCollection,
      stagesCollection,
      orderProgressCollection,
      missingWorkerReviewsCollection,
    } = await getCollections()

    // Optional date range filter — defaults to the last 90 days if not specified
    const fromDate = String(req.query?.from ?? '').trim()
    const toDate = String(req.query?.to ?? '').trim()
    const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const dateFrom = (isoDatePattern.test(fromDate) ? fromDate : defaultFrom)
    const dateTo = isoDatePattern.test(toDate) ? toDate : undefined
    const dateFilter = dateTo
      ? { date: { $gte: dateFrom, $lte: dateTo } }
      : { date: { $gte: dateFrom } }

    const [workers, entries, stages, orderProgress, missingWorkerReviews] = await Promise.all([
      workersCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ fullName: 1 })
        .toArray(),
      entriesCollection
        .find(
          dateFilter,
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedName: 0,
            },
          },
        )
        .sort({ sortOrder: 1, name: 1 })
        .toArray(),
      orderProgressCollection
        .find(
          dateFilter,
          {
            projection: {
              _id: 0,
              normalizedJobName: 0,
            },
          },
        )
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
      missingWorkerReviewsCollection
        .find(
          dateFilter,
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
    ])

    const workersWithNumbers = await ensureWorkersHaveWorkerNumbers(workersCollection, workers)
    const entriesWithPayRates = await ensureEntriesHavePayRates(
      entriesCollection,
      workersCollection,
      entries,
    )

    return {
      workers: workersWithNumbers,
      entries: entriesWithPayRates,
      stages,
      orderProgress,
      missingWorkerReviews,
    }
  }

  async function loadMondaySnapshot(req) {
    async function loadShippedTransitionMetaByOrderId(orderIds) {
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
              movedToShippedAt: 1,
              shippedAt: 1,
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
                movedToShippedAt: String(orderDocument?.movedToShippedAt ?? '').trim() || null,
                persistedShippedAt: String(orderDocument?.shippedAt ?? '').trim() || null,
              },
            ]
          })
          .filter((entry) => entry !== null),
      )
    }

    function enrichOrdersWithShippedTransitionMeta(orders, transitionMetaByOrderId) {
      if (!Array.isArray(orders) || orders.length === 0) {
        return Array.isArray(orders) ? orders : []
      }

      return orders.map((order) => {
        const orderId = String(order?.id ?? '').trim()

        if (!orderId) {
          return order
        }

        const transitionMeta = transitionMetaByOrderId.get(orderId)

        if (!transitionMeta) {
          return {
            ...order,
            movedToShippedAt: null,
          }
        }

        return {
          ...order,
          movedToShippedAt: transitionMeta.movedToShippedAt,
          shippedAt: transitionMeta.persistedShippedAt || String(order?.shippedAt ?? '').trim() || null,
        }
      })
    }

    const refreshRequested = isDashboardRefreshRequested(req)
    const shippedBoardId = String(mondayShippedBoardId ?? '').trim()
    const shippedBoardUrl = String(mondayShippedBoardUrl ?? '').trim() || null
    let primarySnapshot = null

    if (!refreshRequested) {
      primarySnapshot = await getDashboardSnapshotFromCache('monday')
    }

    if (!primarySnapshot) {
      primarySnapshot = await fetchMondayDashboardSnapshot()
    }

    await setDashboardSnapshotCache('monday', primarySnapshot)

    let shippedSnapshot = null

    if (shippedBoardId) {
      const shippedSnapshotKey = `monday_shipped_${shippedBoardId}`

      try {
        if (!refreshRequested) {
          shippedSnapshot = await getDashboardSnapshotFromCache(shippedSnapshotKey)
        }

        if (!shippedSnapshot) {
          shippedSnapshot = await fetchMondayDashboardSnapshot({
            boardId: shippedBoardId,
            boardUrl: shippedBoardUrl,
            boardName: 'Shipped Orders',
          })
        }

        await setDashboardSnapshotCache(shippedSnapshotKey, shippedSnapshot)
      } catch (error) {
        console.error('Unable to load shipped Monday board snapshot for timesheet fallback.', error)
      }
    }

    const primaryOrders = Array.isArray(primarySnapshot?.orders)
      ? primarySnapshot.orders.map((order) => ({
        ...order,
        mondaySourceBoardType: 'orders_track',
      }))
      : []
    const shippedOrders = Array.isArray(shippedSnapshot?.orders)
      ? shippedSnapshot.orders.map((order) => ({
        ...order,
        mondaySourceBoardType: 'shipped_orders',
      }))
      : []
    const combinedOrders = [...primaryOrders, ...shippedOrders]
    const shippedTransitionMetaByOrderId = await loadShippedTransitionMetaByOrderId(
      combinedOrders.map((order) => order?.id),
    )
    const enrichedOrders = enrichOrdersWithShippedTransitionMeta(
      combinedOrders,
      shippedTransitionMetaByOrderId,
    )

    return {
      ...primarySnapshot,
      orders: enrichedOrders,
      shippedBoard: shippedSnapshot?.board ?? null,
    }
  }


app.get('/api/timesheet/state', requireFirebaseAuth, async (req, res, next) => {
  try {
    const payload = await buildTimesheetStatePayload(req)
    res.json(payload)
  } catch (error) {
    next(error)
  }
})

app.get('/api/timesheet/bootstrap', requireFirebaseAuth, async (req, res, next) => {
  try {
    const timesheetState = await buildTimesheetStatePayload(req)
    const [mondaySnapshot, unifiedContext] = await Promise.all([
      loadMondaySnapshot(req),
      loadUnifiedOrdersAndIssues(timesheetState)
        .catch((error) => {
          console.error('Unable to load unified orders context for timesheet bootstrap.', error)

          return {
            unifiedOrders: [],
            websiteIssues: buildEmptyWebsiteIssues(),
          }
        }),
    ])

    res.json({
      ...timesheetState,
      mondaySnapshot,
      unifiedOrders: Array.isArray(unifiedContext?.unifiedOrders)
        ? unifiedContext.unifiedOrders
        : [],
      websiteIssues: unifiedContext?.websiteIssues ?? buildEmptyWebsiteIssues(),
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/timesheet/missing-worker-reviews', requireFirebaseAuth, async (req, res, next) => {
  try {
    const { workersCollection, missingWorkerReviewsCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const workerId = String(req.body?.workerId ?? '').trim()
    const note = String(req.body?.note ?? '').trim()
    const approved = req.body?.approved === true

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    if (note.length > 2000) {
      return res.status(400).json({ error: 'note is too long.' })
    }

    const workerExists = await workersCollection.countDocuments({ id: workerId })

    if (workerExists === 0) {
      return res.status(400).json({ error: 'workerId is invalid.' })
    }

    const now = new Date().toISOString()
    const updateOperation = approved
      ? {
          $set: {
            date,
            workerId,
            note,
            approved: true,
            approvedAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        }
      : {
          $set: {
            date,
            workerId,
            note,
            approved: false,
            updatedAt: now,
          },
          $unset: {
            approvedAt: '',
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        }

    await missingWorkerReviewsCollection.updateOne(
      {
        date,
        workerId,
      },
      updateOperation,
      {
        upsert: true,
      },
    )

    const review = await missingWorkerReviewsCollection.findOne(
      {
        date,
        workerId,
      },
      {
        projection: {
          _id: 0,
        },
      },
    )

    return res.json({ review })
  } catch (error) {
    next(error)
  }
})

app.put('/api/timesheet/order-progress', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
  try {
    const { orderProgressCollection, ordersUnifiedCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const jobName = String(req.body?.jobName ?? '').trim()
    const readyPercent = Number(req.body?.readyPercent)
    const isWarranty = req.body?.isWarranty === true

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (!jobName) {
      return res.status(400).json({ error: 'jobName is required.' })
    }

    if (!Number.isFinite(readyPercent) || readyPercent < 0 || readyPercent > 100) {
      return res.status(400).json({ error: 'readyPercent must be between 0 and 100.' })
    }

    const normalizedJobName = normalizeJobName(jobName)
    const roundedReadyPercent = Number(readyPercent.toFixed(2))
    const shouldForceToComplete = await shouldForceShippedReadyPercent({
      ordersUnifiedCollection,
      date,
      jobName,
    })
    const resolvedReadyPercent = shouldForceToComplete ? 100 : roundedReadyPercent
    const now = new Date().toISOString()

    await orderProgressCollection.updateOne(
      {
        date,
        normalizedJobName,
      },
      {
        $set: {
          date,
          jobName,
          normalizedJobName,
          readyPercent: resolvedReadyPercent,
          isWarranty,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      {
        upsert: true,
      },
    )

    const progress = await orderProgressCollection.findOne(
      {
        date,
        normalizedJobName,
      },
      {
        projection: {
          _id: 0,
          normalizedJobName: 0,
        },
      },
    )

    return res.json({ progress })
  } catch (error) {
    next(error)
  }
})

app.get('/api/timesheet/my-state', requireFirebaseAuth, requireApprovedLinkedWorker, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const linkedWorkerId = String(req.authLinkedWorkerId ?? '').trim()
    const worker = await workersCollection.findOne(
      { id: linkedWorkerId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!worker) {
      return res.status(404).json({
        error: 'Linked worker profile was not found. Contact an admin.',
      })
    }

    const [entries, workersWithNumbers, stages] = await Promise.all([
      entriesCollection
        .find(
          { workerId: linkedWorkerId },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      ensureWorkersHaveWorkerNumbers(workersCollection, [worker]),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedName: 0,
            },
          },
        )
        .sort({ sortOrder: 1, name: 1 })
        .toArray(),
    ])
    const entriesWithPayRates = await ensureEntriesHavePayRates(
      entriesCollection,
      workersCollection,
      entries,
    )

    return res.json({
      worker: workersWithNumbers[0] ?? worker,
      entries: entriesWithPayRates,
      stages,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/my-entries', requireFirebaseAuth, requireApprovedLinkedWorker, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const linkedWorkerId = String(req.authLinkedWorkerId ?? '').trim()
    const date = String(req.body?.date ?? '').trim()
    const stageId = String(req.body?.stageId ?? '').trim()
    const worker = await workersCollection.findOne(
      { id: linkedWorkerId },
      {
        projection: {
          _id: 0,
          id: 1,
          hourlyRate: 1,
        },
      },
    )

    if (!worker) {
      return res.status(404).json({
        error: 'Linked worker profile was not found. Contact an admin.',
      })
    }

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required.' })
    }

    const stageExists = await stagesCollection.countDocuments({ id: stageId })

    if (stageExists === 0) {
      return res.status(400).json({ error: 'stageId is invalid.' })
    }

    const entry = validateEntryInput(
      {
        ...req.body,
        workerId: linkedWorkerId,
      },
      date,
      'entry',
    )

    const workerRate = Number(worker.hourlyRate)

    if (Number.isFinite(workerRate) && workerRate > 0) {
      entry.payRate = workerRate
    }

    await entriesCollection.insertOne(entry)

    return res.status(201).json({ entry })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/stages', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const name = String(req.body?.name ?? '').trim()

    if (!name) {
      return res.status(400).json({ error: 'stage name is required.' })
    }

    const normalizedName = normalizeStageName(name)
    const duplicate = await stagesCollection.findOne(
      { normalizedName },
      { projection: { _id: 0, id: 1 } },
    )

    if (duplicate) {
      return res.status(400).json({ error: 'Stage already exists.' })
    }

    const now = new Date().toISOString()
    const highestSortOrderStage = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            sortOrder: 1,
          },
        },
      )
      .sort({ sortOrder: -1 })
      .limit(1)
      .toArray()
    const nextSortOrder = Number.isInteger(highestSortOrderStage[0]?.sortOrder)
      ? Number(highestSortOrderStage[0].sortOrder) + 1
      : 0

    const stage = {
      id: randomUUID(),
      name,
      normalizedName,
      sortOrder: nextSortOrder,
      createdAt: now,
      updatedAt: now,
    }

    await stagesCollection.insertOne(stage)

    return res.status(201).json({
      stage: {
        id: stage.id,
        name: stage.name,
        sortOrder: stage.sortOrder,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/stages/:stageId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { stagesCollection, entriesCollection } = await getCollections()
    const stageId = String(req.params.stageId ?? '').trim()

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required.' })
    }

    const inUseCount = await entriesCollection.countDocuments({ stageId })

    if (inUseCount > 0) {
      return res.status(400).json({
        error: 'Cannot remove stage with existing entries. Update or remove those entries first.',
      })
    }

    const result = await stagesCollection.deleteOne({ id: stageId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Stage not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/stages/reorder', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const stageIds = Array.isArray(req.body?.stageIds) ? req.body.stageIds : []

    if (stageIds.length === 0) {
      return res.status(400).json({ error: 'stageIds array is required.' })
    }

    const uniqueStageIds = [...new Set(stageIds.map((value) => String(value ?? '').trim()))].filter(Boolean)

    if (uniqueStageIds.length !== stageIds.length) {
      return res.status(400).json({ error: 'stageIds must be unique and non-empty.' })
    }

    const existingStages = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )
      .toArray()

    if (existingStages.length !== uniqueStageIds.length) {
      return res.status(400).json({ error: 'stageIds must include all existing stages.' })
    }

    const existingSet = new Set(existingStages.map((stage) => String(stage.id)))
    const allPresent = uniqueStageIds.every((id) => existingSet.has(id))

    if (!allPresent) {
      return res.status(400).json({ error: 'One or more stage IDs are invalid.' })
    }

    const now = new Date().toISOString()
    const writes = uniqueStageIds.map((id, index) => ({
      updateOne: {
        filter: { id },
        update: {
          $set: {
            sortOrder: index,
            updatedAt: now,
          },
        },
      },
    }))

    await stagesCollection.bulkWrite(writes, { ordered: true })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const input = req.body ?? {}
    const workerFields = validateWorkerInput(input)
    const [workerNumber] = await allocateWorkerNumbers(workersCollection, 1)
    const now = new Date().toISOString()
    const worker = {
      id: randomUUID(),
      workerNumber,
      ...workerFields,
      createdAt: now,
      updatedAt: now,
    }

    await workersCollection.insertOne(worker)

    res.status(201).json({ worker })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers/bulk', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const payloadWorkers = Array.isArray(req.body?.workers) ? req.body.workers : []

    if (payloadWorkers.length === 0) {
      return res.status(400).json({ error: 'workers array is required.' })
    }

    const workerFieldsList = payloadWorkers.map((entry, index) =>
      validateWorkerInput(entry, `workers[${index}]`),
    )
    const workerNumbers = await allocateWorkerNumbers(workersCollection, workerFieldsList.length)
    const now = new Date().toISOString()
    const workers = workerFieldsList.map((workerFields, index) => ({
      id: randomUUID(),
      workerNumber: workerNumbers[index],
      ...workerFields,
      createdAt: now,
      updatedAt: now,
    }))

    await workersCollection.insertMany(workers)

    return res.status(201).json({ insertedCount: workers.length })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/workers/:workerId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const workerId = String(req.params.workerId ?? '').trim()

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    const existingWorker = await workersCollection.findOne(
      { id: workerId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingWorker) {
      return res.status(404).json({ error: 'Worker not found.' })
    }

    const mergedInput = {
      fullName: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'fullName')
        ? req.body.fullName
        : existingWorker.fullName,
      role: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        ? req.body.role
        : existingWorker.role,
      email: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'email')
        ? req.body.email
        : existingWorker.email,
      phone: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'phone')
        ? req.body.phone
        : existingWorker.phone,
      hourlyRate: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'hourlyRate')
        ? req.body.hourlyRate
        : existingWorker.hourlyRate,
    }

    const workerFields = validateWorkerInput(mergedInput)
    const now = new Date().toISOString()

    await workersCollection.updateOne(
      { id: workerId },
      {
        $set: {
          ...workerFields,
          updatedAt: now,
        },
      },
    )

    return res.json({
      worker: {
        ...existingWorker,
        ...workerFields,
        updatedAt: now,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/workers/:workerId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection } = await getCollections()
    const workerId = String(req.params.workerId ?? '')

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    const usedInEntries = await entriesCollection.countDocuments({ workerId })

    if (usedInEntries > 0) {
      return res.status(400).json({
        error: 'Cannot remove worker with existing entries. Remove entries first.',
      })
    }

    await workersCollection.deleteOne({ id: workerId })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/entries/bulk', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required.' })
    }

    const entries = rows.map((row, index) =>
      validateEntryInput(row, date, `rows[${index}]`),
    )

    const workerRateById = await fetchWorkerRateById(
      workersCollection,
      entries.map((entry) => entry.workerId),
    )
    await assertValidStageIds(
      stagesCollection,
      entries.map((entry) => entry.stageId).filter(Boolean),
    )

    entries.forEach((entry) => {
      const workerRate = workerRateById.get(String(entry.workerId ?? '').trim())

      if (Number.isFinite(workerRate) && workerRate > 0) {
        entry.payRate = workerRate
      }
    })

    await entriesCollection.insertMany(entries)

    return res.status(201).json({ insertedCount: entries.length })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return next(buildDuplicateKeyError())
    }

    next(error)
  }
})

app.post('/api/timesheet/entries/sync', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    const normalizedRows = rows.map((row, index) => {
      const entryId = String(row?.entryId ?? '').trim()
      const fields = validateEntryFields(row, date, `rows[${index}]`)

      return {
        entryId,
        fields,
      }
    })

    const payloadEntryIds = normalizedRows
      .map((row) => row.entryId)
      .filter(Boolean)
    const uniquePayloadEntryIds = [...new Set(payloadEntryIds)]

    if (uniquePayloadEntryIds.length !== payloadEntryIds.length) {
      return res.status(400).json({ error: 'rows contain duplicate entryId values.' })
    }

    const workerRateById = await fetchWorkerRateById(
      workersCollection,
      normalizedRows.map((row) => row.fields.workerId),
    )
    await assertValidStageIds(
      stagesCollection,
      normalizedRows.map((row) => row.fields.stageId).filter(Boolean),
    )

    const existingEntries = await entriesCollection
      .find(
        {
          date,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            workerId: 1,
            payRate: 1,
          },
        },
      )
      .toArray()
    const existingEntriesById = new Map(
      existingEntries.map((entry) => [String(entry.id ?? '').trim(), entry]),
    )

    const unknownEntryId = uniquePayloadEntryIds.find((entryId) => !existingEntriesById.has(entryId))

    if (unknownEntryId) {
      return res.status(400).json({ error: 'One or more entry IDs are invalid for this date.' })
    }

    const now = new Date().toISOString()
    const operations = []
    let insertedCount = 0
    let updatedCount = 0

    const deletedEntryIds = existingEntries
      .map((entry) => String(entry.id ?? '').trim())
      .filter((entryId) => entryId && !uniquePayloadEntryIds.includes(entryId))

    if (deletedEntryIds.length > 0) {
      operations.push({
        deleteMany: {
          filter: {
            date,
            id: {
              $in: deletedEntryIds,
            },
          },
        },
      })
    }

    normalizedRows.forEach((row) => {
      const workerRate = workerRateById.get(String(row.fields.workerId ?? '').trim())

      if (row.entryId) {
        const existingEntry = existingEntriesById.get(row.entryId)
        const payRate = resolveEntryPayRate({
          existingEntryPayRate: existingEntry?.payRate,
          existingWorkerId: existingEntry?.workerId,
          nextWorkerId: row.fields.workerId,
          workerRate,
        })

        const nextFields = {
          ...row.fields,
          ...(payRate
            ? {
                payRate,
              }
            : {}),
        }
        const shouldUnsetStage = !row.fields.stageId

        operations.push({
          updateOne: {
            filter: {
              id: row.entryId,
              date,
            },
            update: shouldUnsetStage
              ? {
                  $set: nextFields,
                  $unset: {
                    stageId: '',
                  },
                }
              : {
                  $set: nextFields,
                },
          },
        })

        updatedCount += 1
        return
      }

      const entry = {
        id: randomUUID(),
        ...row.fields,
        createdAt: now,
        ...(
          Number.isFinite(workerRate) && Number(workerRate) > 0
            ? {
                payRate: Number(workerRate),
              }
            : {}
        ),
      }

      operations.push({
        insertOne: {
          document: entry,
        },
      })

      insertedCount += 1
    })

    let deletedCount = 0

    if (operations.length > 0) {
      const result = await entriesCollection.bulkWrite(operations, { ordered: false })
      deletedCount = Number(result.deletedCount ?? 0)
    }

    return res.json({
      insertedCount,
      updatedCount,
      deletedCount,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return next(buildDuplicateKeyError())
    }

    next(error)
  }
})

app.post('/api/timesheet/order-mismatch-alert', requireFirebaseAuth, async (req, res, next) => {
  try {
    const { authUsersCollection, mobileAlertsCollection } = await getCollections()
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return res.status(403).json({
        error: 'Approved access is required.',
      })
    }

    const date = String(req.body?.date ?? '').trim()
    const orderNumbers = Array.from(
      new Set(
        (Array.isArray(req.body?.orderNumbers) ? req.body.orderNumbers : [])
          .map((value) => normalizeOptionalShortText(value, 120))
          .filter(Boolean),
      ),
    )

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (orderNumbers.length === 0) {
      return res.status(400).json({ error: 'orderNumbers must include at least one value.' })
    }

    const adminUsers = await authUsersCollection
      .find(
        {
          approvalStatus: authApprovalApproved,
          role: 'admin',
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
      return res.status(404).json({ error: 'No approved admin recipients found.' })
    }

    const now = new Date().toISOString()
    const orderListText = orderNumbers.join(', ')
    const senderLabel = normalizeOptionalShortText(publicUser.displayName, 120)
      || normalizeOptionalShortText(publicUser.email, 200)
      || 'A worker'
    const alertDocument = {
      id: randomUUID(),
      title: 'Timesheet Order Mismatch',
      message: `${senderLabel} saved a daily sheet for ${date} with unmatched order numbers: ${orderListText}`,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: String(publicUser.uid ?? '').trim() || null,
      createdByEmail: normalizeEmail(publicUser.email) || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: {
        type: 'timesheet_order_mismatch',
        date,
        orderNumbers,
        sourceUid: String(publicUser.uid ?? '').trim() || null,
        sourceEmail: normalizeEmail(publicUser.email) || null,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return res.status(201).json({
      ok: true,
      alert: toPublicMobileAlert(alertDocument),
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/entries/:entryId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const existingEntry = await entriesCollection.findOne(
      { id: entryId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingEntry) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    const date = String(req.body?.date ?? '').trim()

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!isoDatePattern.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    const updatedFields = validateEntryFields(req.body, date)
    const worker = await workersCollection.findOne({
      id: updatedFields.workerId,
    }, {
      projection: {
        _id: 0,
        id: 1,
        hourlyRate: 1,
      },
    })

    if (!worker) {
      return res.status(400).json({ error: 'workerId is invalid.' })
    }

    const payRate = resolveEntryPayRate({
      existingEntryPayRate: existingEntry.payRate,
      existingWorkerId: existingEntry.workerId,
      nextWorkerId: updatedFields.workerId,
      workerRate: worker.hourlyRate,
    })

    if (payRate) {
      updatedFields.payRate = payRate
    }

    await assertValidStageIds(stagesCollection, [updatedFields.stageId].filter(Boolean))

    const hasStageField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'stageId')
    const shouldUnsetStage = hasStageField && !updatedFields.stageId
    const updateOperation = shouldUnsetStage
      ? {
          $set: updatedFields,
          $unset: {
            stageId: '',
          },
        }
      : {
          $set: updatedFields,
        }

    await entriesCollection.updateOne(
      { id: entryId },
      updateOperation,
    )

    const nextEntry = {
      ...existingEntry,
      ...updatedFields,
    }

    if (shouldUnsetStage) {
      delete nextEntry.stageId
    }

    return res.json({
      entry: nextEntry,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/entries/:entryId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const { entriesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const result = await entriesCollection.deleteOne({ id: entryId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
}
