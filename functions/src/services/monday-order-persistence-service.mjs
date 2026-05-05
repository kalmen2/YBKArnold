export function createMondayOrderPersistenceService({
  fetchMondayAssetDownloadInfo,
  getCollections,
  getOrderPhotosBucket,
  mondayBoardId,
  mondayShippedBoardId,
  randomUUID,
}) {
  function normalizeMondayItemId(rawValue) {
    const normalized = String(rawValue ?? '').trim()

    return normalized || null
  }

  function normalizeUrl(rawValue) {
    const normalized = String(rawValue ?? '').trim()

    return normalized || null
  }

  function normalizeBoardId(rawValue) {
    const normalized = String(rawValue ?? '').trim()

    return normalized || null
  }

  const normalizedOrderTrackBoardId = normalizeBoardId(mondayBoardId)
  const normalizedShippedBoardId = normalizeBoardId(mondayShippedBoardId)

  function sanitizeStorageSegment(rawValue, fallback = 'unknown') {
    const normalized = String(rawValue ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')

    if (!normalized) {
      return fallback
    }

    return normalized.slice(0, 120)
  }

  function sanitizeDownloadFileName(rawValue, fallbackFileName = 'shop-drawing.pdf') {
    const normalized = String(rawValue ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')

    if (!normalized) {
      return fallbackFileName
    }

    return normalized
  }

  function ensurePdfFileName(rawValue, fallbackFileName = 'shop-drawing.pdf') {
    const safeFileName = sanitizeDownloadFileName(rawValue, fallbackFileName)

    if (/\.pdf$/i.test(safeFileName)) {
      return safeFileName
    }

    return `${safeFileName}.pdf`
  }

  function deriveFileNameFromUrl(rawValue) {
    const normalizedUrl = normalizeUrl(rawValue)

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

  function extractMondayAssetIdFromUrl(rawValue) {
    const normalizedUrl = normalizeUrl(rawValue)

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

  function buildFirebaseStorageDownloadUrl(bucketName, objectPath, downloadToken) {
    const encodedObjectPath = encodeURIComponent(String(objectPath ?? '').trim())
    const encodedToken = encodeURIComponent(String(downloadToken ?? '').trim())

    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedObjectPath}?alt=media&token=${encodedToken}`
  }

  function createDownloadToken() {
    if (typeof randomUUID === 'function') {
      return randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }

  function createOrderSetFields({ order, board, now, sourceInfo }) {
    return {
      mondayItemId: normalizeMondayItemId(order?.id),
      mondayBoardId: String(board?.id ?? '').trim() || null,
      mondayBoardName: String(board?.name ?? '').trim() || null,
      mondayBoardUrl: String(board?.url ?? '').trim() || null,
      orderName: String(order?.name ?? '').trim() || null,
      jobNumber: String(order?.jobNumber ?? '').trim() || null,
      groupTitle: String(order?.groupTitle ?? '').trim() || null,
      statusLabel: String(order?.statusLabel ?? '').trim() || null,
      stageLabel: String(order?.stageLabel ?? '').trim() || null,
      readyLabel: String(order?.readyLabel ?? '').trim() || null,
      leadTimeDays: Number.isFinite(order?.leadTimeDays) ? Number(order.leadTimeDays) : null,
      progressPercent: Number.isFinite(order?.progressPercent)
        ? Number(order.progressPercent)
        : null,
      orderDate: String(order?.orderDate ?? '').trim() || null,
      shippedAt: String(order?.shippedAt ?? '').trim() || null,
      dueDate: String(order?.dueDate ?? '').trim() || null,
      computedDueDate: String(order?.computedDueDate ?? '').trim() || null,
      effectiveDueDate: String(order?.effectiveDueDate ?? '').trim() || null,
      daysUntilDue: Number.isFinite(order?.daysUntilDue) ? Number(order.daysUntilDue) : null,
      isDone: Boolean(order?.isDone),
      isLate: Boolean(order?.isLate),
      daysLate: Number.isFinite(order?.daysLate) ? Number(order.daysLate) : 0,
      mondayItemUrl: String(order?.itemUrl ?? '').trim() || null,
      mondayUpdatedAt: String(order?.updatedAt ?? '').trim() || null,
      shopDrawingUrl: normalizeUrl(order?.shopDrawingUrl),
      shopDrawingFileName: sourceInfo.fileName,
      shopDrawingSourceAssetId: sourceInfo.sourceAssetId,
      shopDrawingSourceUrl: sourceInfo.sourceUrl,
      shopDrawingResolvedUrl: sourceInfo.sourceUrl,
      invoiceNumber: String(order?.invoiceNumber ?? '').trim() || null,
      paidInFull: typeof order?.paidInFull === 'boolean' ? Boolean(order.paidInFull) : null,
      amountOwed: Number.isFinite(order?.amountOwed) ? Number(order.amountOwed) : null,
      poAmount: Number.isFinite(order?.poAmount) ? Number(order.poAmount) : null,
      updatedAt: now,
      lastSeenAt: now,
    }
  }

  function buildBoardTransitionFields({ existingOrder, currentBoardId, now }) {
    const existingMovedToShippedAt = String(existingOrder?.movedToShippedAt ?? '').trim() || null
    const previousBoardId = normalizeBoardId(existingOrder?.mondayBoardId)

    if (existingMovedToShippedAt) {
      return {
        movedToShippedAt: existingMovedToShippedAt,
      }
    }

    if (
      !normalizedOrderTrackBoardId
      || !normalizedShippedBoardId
      || !currentBoardId
      || currentBoardId !== normalizedShippedBoardId
      || previousBoardId !== normalizedOrderTrackBoardId
    ) {
      return {
        movedToShippedAt: null,
      }
    }

    return {
      movedToShippedAt: now,
    }
  }

  async function resolveShopDrawingSource(order) {
    const originalUrl = normalizeUrl(order?.shopDrawingUrl)
    const explicitFileName = String(order?.shopDrawingFileName ?? '').trim() || null
    const fallbackFileName = deriveFileNameFromUrl(originalUrl)
    const originalFileName = ensurePdfFileName(
      explicitFileName || fallbackFileName || 'shop-drawing.pdf',
      'shop-drawing.pdf',
    )

    if (!originalUrl) {
      return {
        sourceAssetId: null,
        sourceUrl: null,
        fileName: null,
      }
    }

    const sourceAssetId = extractMondayAssetIdFromUrl(originalUrl)
    return {
      sourceAssetId,
      sourceUrl: originalUrl,
      fileName: originalFileName,
    }
  }

  async function persistNewMondayOrders(snapshot) {
    const snapshotOrders = Array.isArray(snapshot?.orders) ? snapshot.orders : []

    if (snapshotOrders.length === 0) {
      return {
        checkedCount: 0,
        newCount: 0,
        insertedCount: 0,
        movedToShippedCount: 0,
        shopDrawingsCached: 0,
        shopDrawingsReused: 0,
        shopDrawingsFailed: 0,
      }
    }

    const orderByItemId = new Map()

    snapshotOrders.forEach((order) => {
      const mondayItemId = normalizeMondayItemId(order?.id)

      if (!mondayItemId || orderByItemId.has(mondayItemId)) {
        return
      }

      orderByItemId.set(mondayItemId, order)
    })

    const mondayItemIds = [...orderByItemId.keys()]

    if (mondayItemIds.length === 0) {
      return {
        checkedCount: 0,
        newCount: 0,
        insertedCount: 0,
        movedToShippedCount: 0,
        shopDrawingsCached: 0,
        shopDrawingsReused: 0,
        shopDrawingsFailed: 0,
      }
    }

    const { mondayOrdersCollection } = await getCollections()
    const now = new Date().toISOString()
    const board = snapshot?.board ?? null
    const currentBoardId = normalizeBoardId(board?.id)
    const existingOrders = await mondayOrdersCollection
      .find(
        {
          mondayItemId: {
            $in: mondayItemIds,
          },
        },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            mondayBoardId: 1,
            movedToShippedAt: 1,
            shopDrawingDownloadUrl: 1,
          },
        },
      )
      .toArray()
    const existingOrderByItemId = new Map(
      existingOrders.map((orderDocument) => [orderDocument.mondayItemId, orderDocument]),
    )
    let shopDrawingsCached = 0
    let shopDrawingsReused = 0
    let shopDrawingsFailed = 0
    let movedToShippedCount = 0
    const operations = []

    for (const mondayItemId of mondayItemIds) {
      const order = orderByItemId.get(mondayItemId)
      const existingOrder = existingOrderByItemId.get(mondayItemId) ?? null
      const sourceInfo = await resolveShopDrawingSource(order)
      const setFields = createOrderSetFields({
        order,
        board,
        now,
        sourceInfo,
      })
      const existingCachedDrawingUrl = String(existingOrder?.shopDrawingDownloadUrl ?? '').trim()

      if (existingCachedDrawingUrl) {
        setFields.shopDrawingSourceUrl = null
        setFields.shopDrawingResolvedUrl = null
        setFields.shopDrawingUrl = null
      }
      const boardTransitionFields = buildBoardTransitionFields({
        existingOrder,
        currentBoardId,
        now,
      })
      const existingMovedToShippedAt = String(existingOrder?.movedToShippedAt ?? '').trim() || null

      if (!existingMovedToShippedAt && boardTransitionFields.movedToShippedAt) {
        movedToShippedCount += 1
      }

      operations.push({
        updateOne: {
          filter: { mondayItemId },
          update: {
            $set: {
              ...setFields,
              ...boardTransitionFields,
            },
            $setOnInsert: {
              createdAt: now,
              firstSeenAt: now,
            },
          },
          upsert: true,
        },
      })
    }

    const writeResult = await mondayOrdersCollection.bulkWrite(operations, {
      ordered: false,
    })
    const insertedCount = Number(writeResult?.upsertedCount ?? 0)

    return {
      checkedCount: mondayItemIds.length,
      newCount: insertedCount,
      insertedCount,
      movedToShippedCount,
      shopDrawingsCached,
      shopDrawingsReused,
      shopDrawingsFailed,
    }
  }

  return {
    persistNewMondayOrders,
  }
}
