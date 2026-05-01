export function registerOrdersLedgerRoutes(app, deps) {
  const {
    fetchMondayDashboardSnapshot,
    getCollections,
    isDashboardRefreshRequested,
    mondayShippedBoardId,
    mondayShippedBoardUrl,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
  } = deps

  function normalizeLookupValue(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function extractOrderNumber(order) {
    const explicit = String(order?.jobNumber ?? '').trim()

    if (explicit) {
      return explicit
    }

    const name = String(order?.name ?? '').trim()
    const match = name.match(/\b\d{4,}\b/)

    return match?.[0] ?? null
  }

  function normalizeStatusLabel(value) {
    const label = String(value ?? '').trim()

    if (!label) {
      return null
    }

    return label
  }

  function toMoney(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      return null
    }

    return Number(parsed.toFixed(2))
  }

  function toPercent(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      return null
    }

    return Math.max(0, Math.min(100, Number(parsed.toFixed(1))))
  }

  function normalizeIsoDate(value) {
    const normalized = String(value ?? '').trim()

    return normalized || null
  }

  function mergeUniqueStrings(...sources) {
    const values = new Set()

    sources.forEach((source) => {
      if (!Array.isArray(source)) {
        return
      }

      source.forEach((value) => {
        const normalized = String(value ?? '').trim()

        if (normalized) {
          values.add(normalized)
        }
      })
    })

    return [...values]
  }

  function buildOrderKey({ orderNumber, orderName, mondayItemId }) {
    const normalizedOrderName = normalizeLookupValue(orderName)

    if (orderNumber) {
      return `job:${orderNumber}`
    }

    if (normalizedOrderName) {
      return `name:${normalizedOrderName}`
    }

    return `item:${mondayItemId}`
  }

  function createOrderCandidate({ board, order, status }) {
    const mondayItemId = String(order?.id ?? '').trim()

    if (!mondayItemId) {
      return null
    }

    const orderName = String(order?.name ?? '').trim() || null
    const orderNumber = extractOrderNumber(order)
    const orderKey = buildOrderKey({ orderNumber, orderName, mondayItemId })

    const mondayBoardId = String(board?.id ?? '').trim() || null
    const mondayBoardName = String(board?.name ?? '').trim() || null
    const mondayBoardUrl = String(board?.url ?? '').trim() || null

    return {
      orderKey,
      orderNumber,
      orderName,
      status,
      mondayStatusLabel: normalizeStatusLabel(order?.statusLabel),
      progressPercent: toPercent(order?.progressPercent),
      invoiceNumber: String(order?.invoiceNumber ?? '').trim() || null,
      poAmount: toMoney(order?.poAmount),
      dueDate: normalizeIsoDate(order?.dueDate),
      effectiveDueDate: normalizeIsoDate(order?.effectiveDueDate),
      shippedAt: normalizeIsoDate(order?.shippedAt),
      mondayUpdatedAt: normalizeIsoDate(order?.updatedAt),
      latestSourceBoardId: mondayBoardId,
      latestSourceBoardName: mondayBoardName,
      latestSourceBoardUrl: mondayBoardUrl,
      mondayItemIds: [mondayItemId],
      orderNames: orderName ? [orderName] : [],
      mondayBoardIds: mondayBoardId ? [mondayBoardId] : [],
      mondayBoardNames: mondayBoardName ? [mondayBoardName] : [],
      mondayItemUrls: String(order?.itemUrl ?? '').trim() ? [String(order.itemUrl).trim()] : [],
    }
  }

  function createStoredOrderCandidate(orderDocument) {
    const mondayItemId = String(orderDocument?.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      return null
    }

    const orderName = String(orderDocument?.orderName ?? '').trim() || null
    const orderNumber = extractOrderNumber({
      jobNumber: orderDocument?.jobNumber,
      name: orderName,
    })
    const orderKey = buildOrderKey({ orderNumber, orderName, mondayItemId })
    const mondayBoardId = String(orderDocument?.mondayBoardId ?? '').trim() || null
    const mondayBoardName = String(orderDocument?.mondayBoardName ?? '').trim() || null
    const mondayBoardUrl = String(orderDocument?.mondayBoardUrl ?? '').trim() || null
    const status =
      mondayBoardId && mondayBoardId === String(mondayShippedBoardId ?? '').trim()
        ? 'shipped'
        : 'not_shipped'

    return {
      orderKey,
      orderNumber,
      orderName,
      status,
      mondayStatusLabel: normalizeStatusLabel(orderDocument?.statusLabel),
      progressPercent: toPercent(orderDocument?.progressPercent),
      invoiceNumber: String(orderDocument?.invoiceNumber ?? '').trim() || null,
      poAmount: toMoney(orderDocument?.poAmount),
      dueDate: normalizeIsoDate(orderDocument?.dueDate),
      effectiveDueDate: normalizeIsoDate(orderDocument?.effectiveDueDate),
      shippedAt: normalizeIsoDate(orderDocument?.shippedAt),
      mondayUpdatedAt: normalizeIsoDate(orderDocument?.mondayUpdatedAt),
      latestSourceBoardId: mondayBoardId,
      latestSourceBoardName: mondayBoardName,
      latestSourceBoardUrl: mondayBoardUrl,
      mondayItemIds: [mondayItemId],
      orderNames: orderName ? [orderName] : [],
      mondayBoardIds: mondayBoardId ? [mondayBoardId] : [],
      mondayBoardNames: mondayBoardName ? [mondayBoardName] : [],
      mondayItemUrls: String(orderDocument?.mondayItemUrl ?? '').trim()
        ? [String(orderDocument.mondayItemUrl).trim()]
        : [],
    }
  }

  function mergeCandidates(existing, incoming) {
    const preferIncoming = incoming.status === 'shipped' || existing.status !== 'shipped'

    return {
      ...existing,
      ...(preferIncoming ? incoming : {}),
      status: incoming.status === 'shipped' || existing.status === 'shipped'
        ? 'shipped'
        : 'not_shipped',
      orderNumber: existing.orderNumber || incoming.orderNumber || null,
      orderName: incoming.orderName || existing.orderName || null,
      mondayStatusLabel: incoming.mondayStatusLabel || existing.mondayStatusLabel || null,
      progressPercent: incoming.progressPercent ?? existing.progressPercent ?? null,
      invoiceNumber: incoming.invoiceNumber || existing.invoiceNumber || null,
      poAmount: incoming.poAmount ?? existing.poAmount ?? null,
      dueDate: incoming.dueDate || existing.dueDate || null,
      effectiveDueDate: incoming.effectiveDueDate || existing.effectiveDueDate || null,
      shippedAt: incoming.shippedAt || existing.shippedAt || null,
      mondayUpdatedAt: incoming.mondayUpdatedAt || existing.mondayUpdatedAt || null,
      latestSourceBoardId: incoming.latestSourceBoardId || existing.latestSourceBoardId || null,
      latestSourceBoardName: incoming.latestSourceBoardName || existing.latestSourceBoardName || null,
      latestSourceBoardUrl: incoming.latestSourceBoardUrl || existing.latestSourceBoardUrl || null,
      mondayItemIds: mergeUniqueStrings(existing.mondayItemIds, incoming.mondayItemIds),
      orderNames: mergeUniqueStrings(existing.orderNames, incoming.orderNames),
      mondayBoardIds: mergeUniqueStrings(existing.mondayBoardIds, incoming.mondayBoardIds),
      mondayBoardNames: mergeUniqueStrings(existing.mondayBoardNames, incoming.mondayBoardNames),
      mondayItemUrls: mergeUniqueStrings(existing.mondayItemUrls, incoming.mondayItemUrls),
    }
  }

  async function persistLedgerCandidates(aggregatedByKey, now) {
    const { ordersLedgerCollection } = await getCollections()

    let insertedCount = 0
    let updatedCount = 0
    let statusChangedCount = 0

    for (const candidate of aggregatedByKey.values()) {
      const existing = await ordersLedgerCollection.findOne(
        { orderKey: candidate.orderKey },
        {
          projection: {
            _id: 0,
            status: 1,
            firstSeenAt: 1,
            mondayItemIds: 1,
            orderNames: 1,
            mondayBoardIds: 1,
            mondayBoardNames: 1,
            mondayItemUrls: 1,
            statusHistory: 1,
          },
        },
      )

      const previousStatus = String(existing?.status ?? '').trim() || null
      const nextStatus = previousStatus === 'shipped' ? 'shipped' : candidate.status
      const statusHistory = Array.isArray(existing?.statusHistory)
        ? existing.statusHistory.filter((entry) => entry && typeof entry === 'object').slice(-49)
        : []
      const latestStatusHistoryEntry = statusHistory[statusHistory.length - 1] ?? null
      const latestHistoryStatus = String(latestStatusHistoryEntry?.status ?? '').trim() || null

      if (latestHistoryStatus !== nextStatus) {
        statusHistory.push({
          status: nextStatus,
          at: now,
          boardId: candidate.latestSourceBoardId,
          boardName: candidate.latestSourceBoardName,
        })
      }

      if (previousStatus && previousStatus !== nextStatus) {
        statusChangedCount += 1
      }

      const writeResult = await ordersLedgerCollection.updateOne(
        { orderKey: candidate.orderKey },
        {
          $set: {
            orderKey: candidate.orderKey,
            orderNumber: candidate.orderNumber,
            orderName: candidate.orderName,
            orderNames: mergeUniqueStrings(existing?.orderNames, candidate.orderNames),
            status: nextStatus,
            mondayStatusLabel: candidate.mondayStatusLabel,
            progressPercent: candidate.progressPercent,
            invoiceNumber: candidate.invoiceNumber,
            poAmount: candidate.poAmount,
            dueDate: candidate.dueDate,
            effectiveDueDate: candidate.effectiveDueDate,
            shippedAt: candidate.shippedAt,
            mondayUpdatedAt: candidate.mondayUpdatedAt,
            latestSourceBoardId: candidate.latestSourceBoardId,
            latestSourceBoardName: candidate.latestSourceBoardName,
            latestSourceBoardUrl: candidate.latestSourceBoardUrl,
            mondayItemIds: mergeUniqueStrings(existing?.mondayItemIds, candidate.mondayItemIds),
            mondayBoardIds: mergeUniqueStrings(existing?.mondayBoardIds, candidate.mondayBoardIds),
            mondayBoardNames: mergeUniqueStrings(existing?.mondayBoardNames, candidate.mondayBoardNames),
            mondayItemUrls: mergeUniqueStrings(existing?.mondayItemUrls, candidate.mondayItemUrls),
            statusHistory,
            lastSeenAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
            firstSeenAt: now,
          },
        },
        { upsert: true },
      )

      insertedCount += Number(writeResult?.upsertedCount ?? 0)
      updatedCount += Number(writeResult?.matchedCount ?? 0)
    }

    return {
      mergedOrderCount: aggregatedByKey.size,
      insertedCount,
      updatedCount,
      statusChangedCount,
    }
  }

  async function refreshOrdersLedgerCollectionFromMonday() {
    const now = new Date().toISOString()
    const aggregatedByKey = new Map()

    const orderTrackSnapshot = await fetchMondayDashboardSnapshot()
    const orderTrackOrders = Array.isArray(orderTrackSnapshot?.orders) ? orderTrackSnapshot.orders : []

    orderTrackOrders.forEach((order) => {
      const candidate = createOrderCandidate({
        board: orderTrackSnapshot?.board,
        order,
        status: 'not_shipped',
      })

      if (!candidate) {
        return
      }

      const existingCandidate = aggregatedByKey.get(candidate.orderKey)

      if (!existingCandidate) {
        aggregatedByKey.set(candidate.orderKey, candidate)
        return
      }

      aggregatedByKey.set(candidate.orderKey, mergeCandidates(existingCandidate, candidate))
    })

    const shippedBoardId = String(mondayShippedBoardId ?? '').trim()
    let shippedOrdersFetched = 0

    if (shippedBoardId) {
      const shippedSnapshot = await fetchMondayDashboardSnapshot({
        boardId: shippedBoardId,
        boardUrl: String(mondayShippedBoardUrl ?? '').trim() || null,
        boardName: 'Shipped Orders',
      })
      const shippedOrders = Array.isArray(shippedSnapshot?.orders) ? shippedSnapshot.orders : []
      shippedOrdersFetched = shippedOrders.length

      shippedOrders.forEach((order) => {
        const candidate = createOrderCandidate({
          board: shippedSnapshot?.board,
          order,
          status: 'shipped',
        })

        if (!candidate) {
          return
        }

        const existingCandidate = aggregatedByKey.get(candidate.orderKey)

        if (!existingCandidate) {
          aggregatedByKey.set(candidate.orderKey, candidate)
          return
        }

        aggregatedByKey.set(candidate.orderKey, mergeCandidates(existingCandidate, candidate))
      })
    }

    const writeSummary = await persistLedgerCandidates(aggregatedByKey, now)

    return {
      source: 'monday_live',
      refreshedAt: now,
      orderTrackOrdersFetched: orderTrackOrders.length,
      shippedOrdersFetched,
      ...writeSummary,
    }
  }

  async function refreshOrdersLedgerCollectionFromStoredMondayOrders() {
    const now = new Date().toISOString()
    const { mondayOrdersCollection } = await getCollections()
    const storedOrders = await mondayOrdersCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            jobNumber: 1,
            orderName: 1,
            mondayBoardId: 1,
            mondayBoardName: 1,
            mondayBoardUrl: 1,
            statusLabel: 1,
            progressPercent: 1,
            invoiceNumber: 1,
            poAmount: 1,
            dueDate: 1,
            effectiveDueDate: 1,
            shippedAt: 1,
            mondayUpdatedAt: 1,
            mondayItemUrl: 1,
          },
        },
      )
      .toArray()

    const aggregatedByKey = new Map()
    let orderTrackOrdersFetched = 0
    let shippedOrdersFetched = 0

    storedOrders.forEach((orderDocument) => {
      const candidate = createStoredOrderCandidate(orderDocument)

      if (!candidate) {
        return
      }

      if (candidate.status === 'shipped') {
        shippedOrdersFetched += 1
      } else {
        orderTrackOrdersFetched += 1
      }

      const existingCandidate = aggregatedByKey.get(candidate.orderKey)

      if (!existingCandidate) {
        aggregatedByKey.set(candidate.orderKey, candidate)
        return
      }

      aggregatedByKey.set(candidate.orderKey, mergeCandidates(existingCandidate, candidate))
    })

    const writeSummary = await persistLedgerCandidates(aggregatedByKey, now)

    return {
      source: 'monday_stored',
      refreshedAt: now,
      storedOrdersFetched: storedOrders.length,
      orderTrackOrdersFetched,
      shippedOrdersFetched,
      ...writeSummary,
    }
  }

  app.get('/api/orders-ledger/overview', requireFirebaseAuth, requireManagerOrAdminRole, async (req, res, next) => {
    try {
      const refreshRequested = isDashboardRefreshRequested(req)
      const search = String(req.query?.search ?? '').trim()
      const requestedStatus = String(req.query?.status ?? '').trim().toLowerCase()
      const limit = Math.min(Math.max(Number(req.query?.limit) || 600, 1), 2000)
      const statusFilter = requestedStatus === 'shipped' || requestedStatus === 'not_shipped'
        ? requestedStatus
        : 'all'

      const { ordersLedgerCollection } = await getCollections()
      const existingCount = await ordersLedgerCollection.estimatedDocumentCount()
      let refreshSummary = null
      let refreshWarning = null

      if (refreshRequested || existingCount === 0) {
        if (refreshRequested) {
          try {
            refreshSummary = await refreshOrdersLedgerCollectionFromMonday()
          } catch (error) {
            const primaryErrorMessage = String(
              error?.message ?? error?.details ?? 'Monday refresh failed.',
            )

            console.error('Orders ledger live Monday refresh failed.', {
              message: primaryErrorMessage,
            })

            try {
              refreshSummary = await refreshOrdersLedgerCollectionFromStoredMondayOrders()
              refreshWarning = `Live Monday refresh failed (${primaryErrorMessage}). Showing latest stored orders.`
            } catch (fallbackError) {
              const fallbackErrorMessage = String(
                fallbackError?.message ?? fallbackError?.details ?? 'Stored fallback failed.',
              )

              console.error('Orders ledger stored fallback refresh failed.', {
                message: fallbackErrorMessage,
              })

              refreshWarning =
                `Live Monday refresh failed (${primaryErrorMessage}). `
                + `Stored fallback failed (${fallbackErrorMessage}).`
            }
          }
        } else {
          try {
            refreshSummary = await refreshOrdersLedgerCollectionFromStoredMondayOrders()
          } catch (error) {
            const seedErrorMessage = String(
              error?.message ?? error?.details ?? 'Stored orders seed failed.',
            )

            console.error('Orders ledger initial seed from stored Monday orders failed.', {
              message: seedErrorMessage,
            })

            refreshWarning = `Stored orders seed failed (${seedErrorMessage}).`

            try {
              refreshSummary = await refreshOrdersLedgerCollectionFromMonday()
            } catch (fallbackError) {
              const fallbackErrorMessage = String(
                fallbackError?.message ?? fallbackError?.details ?? 'Live Monday fallback failed.',
              )

              console.error('Orders ledger live Monday fallback failed.', {
                message: fallbackErrorMessage,
              })

              refreshWarning =
                `${refreshWarning} `
                + `Live Monday fallback failed (${fallbackErrorMessage}).`
            }
          }
        }
      }

      const query = {}

      if (statusFilter !== 'all') {
        query.status = statusFilter
      }

      if (search) {
        const safe = escapeRegExp(search)
        const rx = new RegExp(safe, 'i')
        query.$or = [
          { orderNumber: rx },
          { orderName: rx },
          { orderNames: rx },
          { mondayItemIds: rx },
        ]
      }

      const [orders, totalCount, shippedCount] = await Promise.all([
        ordersLedgerCollection
          .find(query, {
            projection: {
              _id: 0,
              orderKey: 1,
              orderNumber: 1,
              orderName: 1,
              orderNames: 1,
              status: 1,
              mondayStatusLabel: 1,
              progressPercent: 1,
              invoiceNumber: 1,
              poAmount: 1,
              dueDate: 1,
              effectiveDueDate: 1,
              shippedAt: 1,
              mondayUpdatedAt: 1,
              latestSourceBoardId: 1,
              latestSourceBoardName: 1,
              latestSourceBoardUrl: 1,
              mondayItemIds: 1,
              mondayItemUrls: 1,
              firstSeenAt: 1,
              lastSeenAt: 1,
              updatedAt: 1,
            },
          })
          .sort({ status: 1, lastSeenAt: -1, updatedAt: -1, orderNumber: 1 })
          .limit(limit)
          .toArray(),
        ordersLedgerCollection.countDocuments({}),
        ordersLedgerCollection.countDocuments({ status: 'shipped' }),
      ])

      const notShippedCount = Math.max(totalCount - shippedCount, 0)

      return res.json({
        generatedAt: new Date().toISOString(),
        refreshed: Boolean(refreshSummary),
        refreshSummary,
        refreshSource: String(refreshSummary?.source ?? '').trim() || null,
        refreshWarning,
        filters: {
          search,
          status: statusFilter,
          limit,
        },
        counts: {
          total: totalCount,
          shipped: shippedCount,
          notShipped: notShippedCount,
          visible: orders.length,
        },
        orders,
      })
    } catch (error) {
      next(error)
    }
  })
}
