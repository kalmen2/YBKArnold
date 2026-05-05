const mondayItemsPageLimit = 200
const mondayItemsMaxPages = 10
const mondayMaxRetryAttempts = 5
const mondayBaseRetryDelayMs = 750
const mondayMaxRetryDelayMs = 15_000

function sleep(ms) {
  const delayMs = Math.max(0, Math.floor(Number(ms) || 0))
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function parseRetryAfterMs(rawValue) {
  const normalizedValue = String(rawValue ?? '').trim()

  if (!normalizedValue) {
    return 0
  }

  const numericSeconds = Number(normalizedValue)

  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.round(numericSeconds * 1000)
  }

  const retryAtMs = Date.parse(normalizedValue)

  if (!Number.isFinite(retryAtMs)) {
    return 0
  }

  return Math.max(0, retryAtMs - Date.now())
}

function extractRetryDelayMsFromPayload(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  let maxDelayMs = 0

  errors.forEach((error) => {
    const extensions = error?.extensions && typeof error.extensions === 'object'
      ? error.extensions
      : {}
    const candidates = [
      Number(extensions?.retry_in_ms),
      Number(extensions?.retryAfterMs),
      Number(extensions?.retry_after_ms),
      Number(extensions?.retry_in_seconds) * 1000,
      Number(extensions?.retry_after_seconds) * 1000,
      Number(extensions?.reset_in_x_seconds) * 1000,
      Number(extensions?.reset_in_seconds) * 1000,
      parseRetryAfterMs(extensions?.retry_after),
      parseRetryAfterMs(extensions?.retryAfter),
    ]
      .filter((value) => Number.isFinite(value) && value > 0)

    if (candidates.length > 0) {
      maxDelayMs = Math.max(maxDelayMs, ...candidates)
    }

    const message = String(error?.message ?? '')
    const retryMatch = message.match(/retry\s+in\s+(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds)?/i)

    if (retryMatch?.[1]) {
      const value = Number(retryMatch[1])
      const unit = String(retryMatch[2] ?? '').toLowerCase()

      if (Number.isFinite(value) && value >= 0) {
        const valueMs = unit.startsWith('ms') || unit.startsWith('millisecond')
          ? value
          : value * 1000
        maxDelayMs = Math.max(maxDelayMs, valueMs)
      }
    }
  })

  return maxDelayMs
}

function extractMondayErrorMessage(payload, fallbackMessage) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []

  if (errors.length === 0) {
    return String(fallbackMessage ?? 'Monday API returned an error.')
  }

  const firstMessage = String(errors[0]?.message ?? '').trim()

  if (!firstMessage) {
    return String(fallbackMessage ?? 'Monday API returned an error.')
  }

  return firstMessage
}

const dailyLimitPattern = /daily\s*limit|daily\s*quota|complexity\s*budget|budget\s*exhausted|quota\s*exceeded|exceeded\s*the\s*daily/i
const transientRatePattern = /rate\s*limit|too\s*many\s*requests|throttl|minute\s*limit|per[- ]?minute/i

function messageMatchesPattern(payload, message, pattern) {
  if (pattern.test(String(message ?? ''))) {
    return true
  }

  const errors = Array.isArray(payload?.errors) ? payload.errors : []

  return errors.some((error) => {
    const normalizedErrorMessage = String(error?.message ?? '')
    const normalizedCode = String(error?.extensions?.code ?? '')

    return pattern.test(normalizedErrorMessage) || pattern.test(normalizedCode)
  })
}

function isDailyLimitMondayPayload(payload, message) {
  return messageMatchesPattern(payload, message, dailyLimitPattern)
}

function isRetriableMondayFailure({ status, payload, message }) {
  if (isDailyLimitMondayPayload(payload, message)) {
    return false
  }

  if ([408, 425, 429, 500, 502, 503, 504].includes(Number(status))) {
    return true
  }

  return messageMatchesPattern(payload, message, transientRatePattern)
}

function resolveRetryDelayMs(attempt, retryAfterMs = 0) {
  const safeAttempt = Math.max(0, Number(attempt) || 0)
  const backoffMs = Math.min(
    mondayMaxRetryDelayMs,
    mondayBaseRetryDelayMs * (2 ** safeAttempt),
  )
  const jitterMs = Math.floor(Math.random() * 350)
  const minimumDelayMs = backoffMs + jitterMs

  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(
      mondayMaxRetryDelayMs,
      Math.max(minimumDelayMs, retryAfterMs),
    )
  }

  return minimumDelayMs
}

function dedupeMondayItems(items) {
  const byId = new Map()

  ;(Array.isArray(items) ? items : []).forEach((item, index) => {
    const itemId = String(item?.id ?? '').trim()
    const fallbackKey = `${String(item?.name ?? '').trim()}::${index}`
    const key = itemId || fallbackKey

    if (!byId.has(key)) {
      byId.set(key, item)
    }
  })

  return [...byId.values()]
}

export function createMondaySnapshotService({
  ensureMondayConfiguration,
  mondayApiUrl,
  mondayApiToken,
  mondayBoardId,
  mondayBoardUrl,
  mondayItemsPageQuery,
  buildMondayItemsPageQuery,
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
}) {
  let mondayRequestQueueTail = Promise.resolve()
  const inFlightSnapshotByBoard = new Map()
  const cachedColumnIdsByBoard = new Map()

  const buildItemsPageQuery = typeof buildMondayItemsPageQuery === 'function'
    ? buildMondayItemsPageQuery
    : () => mondayItemsPageQuery

  function collectColumnIdsFromMap(columnMap) {
    if (!columnMap || typeof columnMap !== 'object') {
      return []
    }

    const ids = new Set()
    // Whitelist: only the columns the Orders page actually needs from Monday.
    // Invoice/PO/AmountOwed/PaidInFull come from QuickBooks; the per-stage
    // columns (Design, Build, Sand or lam, ...) are dropped — Progress is read
    // from a single Progress column instead.
    const scalarKeys = [
      'statusColumnId',
      'progressColumnId',
      'ackColumnId',
      'shipDateColumnId',
      'leadTimeColumnId',
      'dueDateColumnId',
      'shopDrawingColumnId',
      'orderDateColumnId',
    ]

    scalarKeys.forEach((key) => {
      const value = columnMap[key]

      if (value) {
        ids.add(String(value))
      }
    })

    const progressStatusColumns = Array.isArray(columnMap.progressStatusColumns)
      ? columnMap.progressStatusColumns
      : []

    progressStatusColumns.forEach((entry) => {
      const columnId = String(entry?.columnId ?? '').trim()

      if (columnId) {
        ids.add(columnId)
      }
    })

    return [...ids]
  }

  function enqueueMondayRequest(task) {
    const queuedTask = mondayRequestQueueTail.then(task, task)

    mondayRequestQueueTail = queuedTask
      .then(() => undefined)
      .catch(() => undefined)

    return queuedTask
  }

  async function fetchMondayDashboardSnapshot(options = {}) {
    ensureMondayConfiguration()

    const boardId = String(options?.boardId ?? mondayBoardId).trim()
    const boardUrl = String(options?.boardUrl ?? mondayBoardUrl).trim() || null
    const fallbackBoardName = String(options?.boardName ?? 'Order Track').trim() || 'Order Track'

    if (!boardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for snapshot fetch.',
      }
    }

    const existingInFlightSnapshot = inFlightSnapshotByBoard.get(boardId)

    if (existingInFlightSnapshot) {
      return existingInFlightSnapshot
    }

    const snapshotPromise = (async () => {
      let cursor = null
      let pageCount = 0
      const rawItems = []
      const seenCursors = new Set()
      let boardInfo = null
      let knownColumnIds = cachedColumnIdsByBoard.get(boardId) ?? null

      while (pageCount < mondayItemsMaxPages) {
        const pageQuery = buildItemsPageQuery(knownColumnIds)
        const data = await callMondayGraphql(pageQuery, {
          boardId,
          limit: mondayItemsPageLimit,
          cursor,
        })

        const board = data?.boards?.[0]

        if (!board) {
          throw {
            status: 404,
            message: `Monday board ${boardId} was not found.`,
          }
        }

        boardInfo = {
          id: String(board.id ?? boardId),
          name: String(board.name ?? fallbackBoardName),
          url: boardUrl,
        }

        const pageItems = Array.isArray(board.items_page?.items)
          ? board.items_page.items
          : []
        const nextCursor = String(board.items_page?.cursor ?? '').trim() || null

        rawItems.push(...pageItems)
        pageCount += 1

        if (!knownColumnIds) {
          const detectedFromPage = detectMondayColumns(pageItems)
          const detectedIds = collectColumnIdsFromMap(detectedFromPage)

          if (detectedIds.length > 0) {
            knownColumnIds = detectedIds
            cachedColumnIdsByBoard.set(boardId, detectedIds)
          }
        }

        if (!nextCursor) {
          break
        }

        if (nextCursor === cursor || seenCursors.has(nextCursor)) {
          console.warn('Stopping Monday pagination because cursor repeated.', {
            boardId,
            pageCount,
          })
          break
        }

        if (pageItems.length < mondayItemsPageLimit) {
          console.warn('Stopping Monday pagination because page returned fewer items than limit while cursor remained.', {
            boardId,
            pageCount,
            itemCount: pageItems.length,
          })
          break
        }

        seenCursors.add(nextCursor)
        cursor = nextCursor
      }

      const uniqueRawItems = dedupeMondayItems(rawItems)
      const columnMap = detectMondayColumns(uniqueRawItems)
      const orders = uniqueRawItems
        .map((item) => normalizeMondayOrder(item, columnMap, { boardUrl }))
        .sort(compareOrdersByUrgency)

      const lateOrders = orders.filter((order) => order.isLate)
      const dueSoonOrders = orders.filter(
        (order) =>
          !order.isDone &&
          typeof order.daysUntilDue === 'number' &&
          order.daysUntilDue >= 0 &&
          order.daysUntilDue <= 7,
      )
      const completedOrders = orders.filter((order) => order.isDone)
      const activeOrders = orders.filter((order) => !order.isDone)
      const missingDueDateOrders = activeOrders.filter((order) => !order.effectiveDueDate)

      const ordersWithLeadTime = orders.filter((order) =>
        Number.isFinite(order.leadTimeDays),
      )
      const leadTimeTotal = ordersWithLeadTime.reduce(
        (total, order) => total + Number(order.leadTimeDays ?? 0),
        0,
      )
      const averageLeadTimeDays =
        ordersWithLeadTime.length > 0
          ? Number((leadTimeTotal / ordersWithLeadTime.length).toFixed(1))
          : null

      return {
        board: boardInfo,
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
        columnDetection: columnMap,
      }
    })()

    inFlightSnapshotByBoard.set(boardId, snapshotPromise)

    try {
      return await snapshotPromise
    } finally {
      if (inFlightSnapshotByBoard.get(boardId) === snapshotPromise) {
        inFlightSnapshotByBoard.delete(boardId)
      }
    }
  }

  async function callMondayGraphql(query, variables) {
    return enqueueMondayRequest(async () => {
      let attempt = 0

      while (attempt <= mondayMaxRetryAttempts) {
        try {
          const response = await fetch(mondayApiUrl, {
            method: 'POST',
            headers: {
              Authorization: mondayApiToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, variables }),
          })
          const payload = await response.json().catch(() => ({}))
          const payloadHasErrors = Array.isArray(payload?.errors) && payload.errors.length > 0

          if (response.ok && !payloadHasErrors) {
            return payload?.data ?? {}
          }

          const status = Number(response?.status ?? 0)
          const fallbackMessage = response.ok
            ? 'Monday API returned an error.'
            : `Monday API request failed with status ${status || 'unknown'}.`
          const message = extractMondayErrorMessage(payload, fallbackMessage)
          const retryAfterHeaderMs = parseRetryAfterMs(response.headers?.get('retry-after'))
          const retryAfterPayloadMs = extractRetryDelayMsFromPayload(payload)
          const retryAfterMs = Math.max(retryAfterHeaderMs, retryAfterPayloadMs)

          if (
            !isRetriableMondayFailure({ status, payload, message })
            || attempt >= mondayMaxRetryAttempts
          ) {
            throw {
              status: status || 502,
              message,
            }
          }

          const delayMs = resolveRetryDelayMs(attempt, retryAfterMs)
          attempt += 1
          await sleep(delayMs)
        } catch (error) {
          const status = Number(error?.status ?? 0)
          const message = String(error?.message ?? '').trim() || 'Monday API request failed.'

          if (status > 0) {
            throw error
          }

          if (attempt >= mondayMaxRetryAttempts) {
            throw {
              status: 502,
              message,
            }
          }

          const delayMs = resolveRetryDelayMs(attempt)
          attempt += 1
          await sleep(delayMs)
        }
      }

      throw {
        status: 502,
        message: 'Monday API request failed after retry attempts.',
      }
    })
  }

  // Targeted name-only fetch: pull every item on a board with just id+name
  // (no column_values block). Used for "is this order on the Shipped board?" /
  // "is this order on the Design board?" without paying for the full column
  // payload. Cached briefly so a single refresh run doesn't re-paginate.
  const boardNamesCacheTtlMs = 5 * 60 * 1000
  const cachedBoardNamesByBoard = new Map()

  async function fetchMondayBoardItemNames({ boardId, boardUrl = null, boardName = null }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()

    if (!normalizedBoardId) {
      throw { status: 500, message: 'Missing Monday board id for name lookup.' }
    }

    const cached = cachedBoardNamesByBoard.get(normalizedBoardId)

    if (cached && Date.now() - cached.fetchedAt < boardNamesCacheTtlMs) {
      return cached.snapshot
    }

    const namesOnlyQuery = `
query GetBoardItemNames($boardId: ID!, $limit: Int!, $cursor: String) {
  boards(ids: [$boardId]) {
    id
    name
    items_page(limit: $limit, cursor: $cursor) {
      cursor
      items { id name }
    }
  }
}
`

    let cursor = null
    let pageCount = 0
    const collectedItems = []
    const seenCursors = new Set()
    let board = null

    while (pageCount < mondayItemsMaxPages) {
      const data = await callMondayGraphql(namesOnlyQuery, {
        boardId: normalizedBoardId,
        limit: mondayItemsPageLimit,
        cursor,
      })

      const boardData = data?.boards?.[0]

      if (!boardData) {
        throw { status: 404, message: `Monday board ${normalizedBoardId} was not found.` }
      }

      if (!board) {
        board = {
          id: String(boardData.id ?? normalizedBoardId),
          name: String(boardData.name ?? boardName ?? ''),
          url: boardUrl,
        }
      }

      const items = Array.isArray(boardData.items_page?.items)
        ? boardData.items_page.items
        : []
      const nextCursor = String(boardData.items_page?.cursor ?? '').trim() || null

      collectedItems.push(...items)
      pageCount += 1

      if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
        break
      }

      if (items.length < mondayItemsPageLimit) {
        break
      }

      seenCursors.add(nextCursor)
      cursor = nextCursor
    }

    const snapshot = {
      board,
      items: dedupeMondayItems(collectedItems).map((item) => ({
        id: String(item?.id ?? ''),
        name: String(item?.name ?? ''),
      })),
    }

    cachedBoardNamesByBoard.set(normalizedBoardId, {
      fetchedAt: Date.now(),
      snapshot,
    })

    return snapshot
  }

  function invalidateMondayBoardNamesCache(boardId) {
    if (boardId) {
      cachedBoardNamesByBoard.delete(String(boardId).trim())
    } else {
      cachedBoardNamesByBoard.clear()
    }
  }

  async function fetchMondayAssetDownloadInfo(assetId) {
    const normalizedAssetId = String(assetId ?? '').trim()

    if (!/^[0-9]+$/.test(normalizedAssetId)) {
      return null
    }

    ensureMondayConfiguration()

    const data = await callMondayGraphql(
      `
query GetAssetDownloadInfo($assetId: ID!) {
  assets(ids: [$assetId]) {
    id
    name
    file_extension
    public_url
    url
  }
}
`,
      {
        assetId: normalizedAssetId,
      },
    )

    const asset = Array.isArray(data?.assets) ? data.assets[0] : null

    if (!asset) {
      return null
    }

    return {
      id: String(asset.id ?? normalizedAssetId),
      name: String(asset.name ?? '').trim() || null,
      fileExtension: String(asset.file_extension ?? '').trim() || null,
      publicUrl: String(asset.public_url ?? '').trim() || null,
      url: String(asset.url ?? '').trim() || null,
    }
  }

  async function fetchMondayBoardItemsByIds({
    boardId,
    boardUrl = null,
    boardName = null,
    itemIds = [],
  }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()

    if (!normalizedBoardId) {
      throw { status: 500, message: 'Missing Monday board id for item detail lookup.' }
    }

    const normalizedItemIds = [...new Set(
      (Array.isArray(itemIds) ? itemIds : [])
        .map((itemId) => String(itemId ?? '').trim())
        .filter((itemId) => itemId.length > 0),
    )]

    if (normalizedItemIds.length === 0) {
      return {
        board: {
          id: normalizedBoardId,
          name: String(boardName ?? '').trim() || null,
          url: String(boardUrl ?? '').trim() || null,
        },
        generatedAt: new Date().toISOString(),
        orders: [],
        columnDetection: detectMondayColumns([]),
      }
    }

    const itemsByIdsQuery = `
query GetItemsByIds($itemIds: [ID!]!) {
  items(ids: $itemIds) {
    id
    name
    created_at
    updated_at
    group {
      id
      title
    }
    column_values {
      id
      type
      text
      value
      column {
        title
      }
    }
  }
}
`

    const chunkSize = 50
    const boardInfo = {
      id: normalizedBoardId,
      name: String(boardName ?? '').trim() || null,
      url: String(boardUrl ?? '').trim() || null,
    }
    const rawItems = []

    for (let index = 0; index < normalizedItemIds.length; index += chunkSize) {
      const itemIdsChunk = normalizedItemIds.slice(index, index + chunkSize)
      const data = await callMondayGraphql(itemsByIdsQuery, {
        itemIds: itemIdsChunk,
      })

      const items = Array.isArray(data?.items) ? data.items : []
      rawItems.push(...items)
    }

    const uniqueRawItems = dedupeMondayItems(rawItems)
    const columnMap = detectMondayColumns(uniqueRawItems)
    const orders = uniqueRawItems
      .map((item) => normalizeMondayOrder(item, columnMap, { boardUrl }))
      .sort(compareOrdersByUrgency)

    return {
      board: boardInfo,
      generatedAt: new Date().toISOString(),
      orders,
      columnDetection: columnMap,
    }
  }

  return {
    fetchMondayAssetDownloadInfo,
    fetchMondayBoardItemNames,
    fetchMondayBoardItemsByIds,
    fetchMondayDashboardSnapshot,
    invalidateMondayBoardNamesCache,
  }
}
