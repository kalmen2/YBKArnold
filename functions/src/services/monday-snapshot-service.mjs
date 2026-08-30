const mondayItemsPageLimit = 200
const mondayItemsMaxPages = 10
const mondayBoardsPageLimit = 100
const mondayBoardsMaxPages = 25
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

function normalizeMondayColumnTitle(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function buildColumnsMappingBetweenBoards(sourceColumns, targetColumns) {
  const normalizedSourceColumns = Array.isArray(sourceColumns)
    ? sourceColumns
    : []
  const normalizedTargetColumns = Array.isArray(targetColumns)
    ? targetColumns
    : []
  const targetById = new Map()
  const targetByTitleAndType = new Map()
  const targetByTitle = new Map()
  const usedTargetColumnIds = new Set()

  normalizedTargetColumns.forEach((column) => {
    const columnId = String(column?.id ?? '').trim()

    if (!columnId) {
      return
    }

    const columnType = String(column?.type ?? '').trim().toLowerCase()
    const titleKey = normalizeMondayColumnTitle(column?.title)
    const titleAndTypeKey = `${titleKey}::${columnType}`

    targetById.set(columnId, column)

    if (titleKey && !targetByTitle.has(titleKey)) {
      targetByTitle.set(titleKey, column)
    }

    if (titleKey && columnType && !targetByTitleAndType.has(titleAndTypeKey)) {
      targetByTitleAndType.set(titleAndTypeKey, column)
    }
  })

  return normalizedSourceColumns.map((sourceColumn) => {
    const sourceId = String(sourceColumn?.id ?? '').trim()

    if (!sourceId) {
      return null
    }

    const sourceType = String(sourceColumn?.type ?? '').trim().toLowerCase()
    const sourceTitleKey = normalizeMondayColumnTitle(sourceColumn?.title)
    const titleAndTypeKey = `${sourceTitleKey}::${sourceType}`
    let matchedTarget = null

    if (sourceId === 'name' && targetById.has('name')) {
      matchedTarget = targetById.get('name')
    }

    if (!matchedTarget) {
      const sameIdTarget = targetById.get(sourceId)

      if (sameIdTarget && !usedTargetColumnIds.has(String(sameIdTarget?.id ?? '').trim())) {
        matchedTarget = sameIdTarget
      }
    }

    if (!matchedTarget && sourceTitleKey) {
      const titleAndTypeTarget = targetByTitleAndType.get(titleAndTypeKey)

      if (
        titleAndTypeTarget
        && !usedTargetColumnIds.has(String(titleAndTypeTarget?.id ?? '').trim())
      ) {
        matchedTarget = titleAndTypeTarget
      }
    }

    if (!matchedTarget && sourceTitleKey) {
      const titleTarget = targetByTitle.get(sourceTitleKey)

      if (titleTarget && !usedTargetColumnIds.has(String(titleTarget?.id ?? '').trim())) {
        matchedTarget = titleTarget
      }
    }

    const matchedTargetId = String(matchedTarget?.id ?? '').trim() || null

    if (matchedTargetId) {
      usedTargetColumnIds.add(matchedTargetId)
    }

    // Monday formula columns cannot be copied between boards. We keep them in
    // the mapping with a null target so move_item_to_board can still proceed.
    if (sourceType === 'formula') {
      return {
        source: sourceId,
        target: null,
      }
    }

    return {
      source: sourceId,
      target: matchedTargetId,
    }
  }).filter(Boolean)
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
  const boardCatalogCacheTtlMs = 5 * 60 * 1000
  let cachedBoardsCatalogSnapshot = null

  const buildItemsPageQuery = typeof buildMondayItemsPageQuery === 'function'
    ? buildMondayItemsPageQuery
    : () => mondayItemsPageQuery

  const mondayStatusColors = Object.freeze({
    'working on it': '#fdab3d', 'is here': '#00c875', done: '#00c875',
    stuck: '#df2f4a', ordered: '#007eb5', com: '#9d50dd',
    'to be determined': '#cd9282', 'make in house': '#ff6d3b',
    partial: '#cab641', 'partial receipt': '#4eccc6', 'by other': '#333333',
    'in cart': '#ffadad', canceled: '#ff007f',
  })

  function normalizeMondaySubitems(item) {
    return (Array.isArray(item?.subitems) ? item.subitems : []).map((subitem) => {
      const values = Array.isArray(subitem?.column_values) ? subitem.column_values : []
      const byTitle = (patterns) => values.find((value) => {
        const title = String(value?.column?.title ?? '').trim().toLowerCase()
        return patterns.some((pattern) => pattern.test(title))
      })
      const status = String(byTitle([/^status$/])?.text ?? '').trim() || null
      return {
        id: String(subitem?.id ?? '').trim(),
        name: String(subitem?.name ?? '').trim() || 'Subitem',
        status,
        statusColor: status ? mondayStatusColors[status.toLowerCase()] || null : null,
        vendor: String(byTitle([/^vendor$/])?.text ?? '').trim() || null,
        dateOrdered: String(byTitle([/^date ordered/])?.text ?? '').trim() || null,
        dateReceived: String(byTitle([/^date received/, /^received date/])?.text ?? '').trim() || null,
        dueDate: String(byTitle([/^due date/])?.text ?? '').trim() || null,
        createdAt: String(subitem?.created_at ?? '').trim() || null,
        updatedAt: String(subitem?.updated_at ?? '').trim() || null,
      }
    }).filter((subitem) => subitem.id)
  }

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
      'cutListColumnId',
      'shipToColumnId',
      'shipNotesColumnId',
      'bolColumnId',
      'signedBolColumnId',
      'inspectionSheetColumnId',
      'poNumberColumnId',
      'benchColumnId',
      'notesColumnId',
      'descriptionColumnId',
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
          const detectedFromPage = detectMondayColumns(pageItems, boardId)
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
      const columnMap = detectMondayColumns(uniqueRawItems, boardId)
      const orders = uniqueRawItems
        .map((item) => ({
          ...normalizeMondayOrder(item, columnMap, { boardUrl }),
          subitems: normalizeMondaySubitems(item),
        }))
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

          const upstreamStatus = Number(response?.status ?? 0)
          const status = response.ok ? 502 : upstreamStatus
          const fallbackMessage = response.ok
            ? 'Monday API returned an error.'
            : `Monday API request failed with status ${upstreamStatus || 'unknown'}.`
          const message = extractMondayErrorMessage(payload, fallbackMessage)
          const retryAfterHeaderMs = parseRetryAfterMs(response.headers?.get('retry-after'))
          const retryAfterPayloadMs = extractRetryDelayMsFromPayload(payload)
          const retryAfterMs = Math.max(retryAfterHeaderMs, retryAfterPayloadMs)

          if (
            !isRetriableMondayFailure({ status: upstreamStatus, payload, message })
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

  function normalizeStatusOptionLabel(value) {
    return String(value ?? '').trim() || null
  }

  function normalizeStatusOptionColor(value) {
    const normalizedValue = String(value ?? '').trim()

    if (!normalizedValue) {
      return null
    }

    if (/^#[0-9a-fA-F]{3,8}$/.test(normalizedValue)) {
      return normalizedValue
    }

    return null
  }

  function parseStatusColumnOptionsFromSettings(rawSettings) {
    if (typeof rawSettings !== 'string' || !rawSettings.trim()) {
      return []
    }

    try {
      const parsed = JSON.parse(rawSettings)
      const labels = parsed?.labels && typeof parsed.labels === 'object'
        ? parsed.labels
        : {}
      const labelsColors = parsed?.labels_colors && typeof parsed.labels_colors === 'object'
        ? parsed.labels_colors
        : {}
      const entries = Object.entries(labels)
        .filter(([, label]) => normalizeStatusOptionLabel(label))
        .sort(([leftKey], [rightKey]) => {
          const leftNumber = Number(leftKey)
          const rightNumber = Number(rightKey)

          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber
          }

          return String(leftKey).localeCompare(String(rightKey))
        })

      const options = []
      const labelsSeen = new Set()

      entries.forEach(([index, label]) => {
        const normalizedLabel = normalizeStatusOptionLabel(label)

        if (!normalizedLabel || labelsSeen.has(normalizedLabel)) {
          return
        }

        labelsSeen.add(normalizedLabel)

        const colorEntry = labelsColors?.[index]
        const normalizedColorEntry = colorEntry && typeof colorEntry === 'object'
          ? colorEntry
          : {}

        options.push({
          label: normalizedLabel,
          index: String(index ?? '').trim() || null,
          color: normalizeStatusOptionColor(normalizedColorEntry?.color),
          border: normalizeStatusOptionColor(normalizedColorEntry?.border),
          varName: String(normalizedColorEntry?.var_name ?? '').trim() || null,
        })
      })

      return options
    } catch {
      return []
    }
  }

  async function fetchMondayStatusColumnOptions({ boardId, columnIds = [] }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedColumnIds = [...new Set(
      (Array.isArray(columnIds) ? columnIds : [])
        .map((columnId) => String(columnId ?? '').trim())
        .filter(Boolean),
    )]

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for status options lookup.',
      }
    }

    if (normalizedColumnIds.length === 0) {
      return {}
    }

    const data = await callMondayGraphql(
      `
query GetBoardStatusColumnOptions($boardId: ID!, $columnIds: [String!]) {
  boards(ids: [$boardId]) {
    id
    columns(ids: $columnIds) {
      id
      type
      settings_str
    }
  }
}
`,
      {
        boardId: normalizedBoardId,
        columnIds: normalizedColumnIds,
      },
    )

    const board = Array.isArray(data?.boards) ? data.boards[0] : null
    const columns = Array.isArray(board?.columns) ? board.columns : []
    const optionsByColumnId = {}

    columns.forEach((column) => {
      const columnId = String(column?.id ?? '').trim()

      if (!columnId) {
        return
      }

      optionsByColumnId[columnId] = parseStatusColumnOptionsFromSettings(column?.settings_str)
    })

    return optionsByColumnId
  }

  async function createMondayItem({ boardId, itemName }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedItemName = String(itemName ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for item create.',
      }
    }

    if (!normalizedItemName) {
      throw {
        status: 400,
        message: 'Missing Monday item name for item create.',
      }
    }

    const data = await callMondayGraphql(
      `
mutation CreateMondayItem($boardId: ID!, $itemName: String!) {
  create_item(
    board_id: $boardId,
    item_name: $itemName
  ) {
    id
    name
  }
}
`,
      {
        boardId: normalizedBoardId,
        itemName: normalizedItemName,
      },
    )

    const createdItem = data?.create_item ?? null
    const itemId = String(createdItem?.id ?? '').trim()

    if (!itemId) {
      throw {
        status: 502,
        message: 'Monday did not return a created item id.',
      }
    }

    invalidateMondayBoardNamesCache(normalizedBoardId)

    return {
      boardId: normalizedBoardId,
      itemId,
      itemName: String(createdItem?.name ?? '').trim() || normalizedItemName,
    }
  }

  async function deleteMondayItem({ itemId, boardId = null }) {
    ensureMondayConfiguration()

    const normalizedItemId = String(itemId ?? '').trim()
    const normalizedBoardId = String(boardId ?? '').trim()

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for item delete.',
      }
    }

    let mode = 'delete'

    try {
      await callMondayGraphql(
        `
mutation DeleteMondayItem($itemId: ID!) {
  delete_item(item_id: $itemId) {
    id
  }
}
`,
        {
          itemId: normalizedItemId,
        },
      )
    } catch (deleteError) {
      await callMondayGraphql(
        `
mutation ArchiveMondayItem($itemId: ID!) {
  archive_item(item_id: $itemId) {
    id
  }
}
`,
        {
          itemId: normalizedItemId,
        },
      )
      mode = 'archive'
    }

    if (normalizedBoardId) {
      invalidateMondayBoardNamesCache(normalizedBoardId)
    }

    return {
      itemId: normalizedItemId,
      boardId: normalizedBoardId || null,
      mode,
    }
  }

  async function updateMondayItemStatusColumn({
    boardId,
    itemId,
    columnId,
    statusIndex = null,
    statusLabel,
  }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedItemId = String(itemId ?? '').trim()
    const normalizedColumnId = String(columnId ?? '').trim()
    const normalizedStatusLabel = String(statusLabel ?? '').trim()
    const normalizedStatusIndex = String(statusIndex ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for status update.',
      }
    }

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for status update.',
      }
    }

    if (!normalizedColumnId) {
      throw {
        status: 400,
        message: 'Missing Monday column id for status update.',
      }
    }

    if (normalizedStatusLabel || normalizedStatusIndex) {
      await callMondayGraphql(
        `
mutation UpdateMondayItemStatusColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
`,
        {
          boardId: normalizedBoardId,
          itemId: normalizedItemId,
          columnId: normalizedColumnId,
          value: normalizedStatusIndex
            ? JSON.stringify({ index: Number.isFinite(Number(normalizedStatusIndex))
              ? Number(normalizedStatusIndex)
              : normalizedStatusIndex })
            : JSON.stringify({ label: normalizedStatusLabel }),
        },
      )
    } else {
      await callMondayGraphql(
        `
mutation ClearMondayItemStatusColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
  change_simple_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
`,
        {
          boardId: normalizedBoardId,
          itemId: normalizedItemId,
          columnId: normalizedColumnId,
          value: '',
        },
      )
    }

    return {
      boardId: normalizedBoardId,
      itemId: normalizedItemId,
      columnId: normalizedColumnId,
      statusLabel: normalizedStatusLabel || null,
    }
  }

  async function updateMondayItemTextColumn({ boardId, itemId, columnId, textValue }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedItemId = String(itemId ?? '').trim()
    const normalizedColumnId = String(columnId ?? '').trim()
    const normalizedTextValue = String(textValue ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for text update.',
      }
    }

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for text update.',
      }
    }

    if (!normalizedColumnId) {
      throw {
        status: 400,
        message: 'Missing Monday column id for text update.',
      }
    }

    await callMondayGraphql(
      `
mutation UpdateMondayItemTextColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
  change_simple_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
`,
      {
        boardId: normalizedBoardId,
        itemId: normalizedItemId,
        columnId: normalizedColumnId,
        value: normalizedTextValue,
      },
    )

    return {
      boardId: normalizedBoardId,
      itemId: normalizedItemId,
      columnId: normalizedColumnId,
      textValue: normalizedTextValue,
    }
  }

  async function updateMondayItemJsonColumn({ boardId, itemId, columnId, jsonValue }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedItemId = String(itemId ?? '').trim()
    const normalizedColumnId = String(columnId ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for JSON update.',
      }
    }

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for JSON update.',
      }
    }

    if (!normalizedColumnId) {
      throw {
        status: 400,
        message: 'Missing Monday column id for JSON update.',
      }
    }

    if (jsonValue === undefined || jsonValue === null) {
      throw {
        status: 400,
        message: 'Missing Monday JSON value for JSON update.',
      }
    }

    const serializedValue = typeof jsonValue === 'string'
      ? String(jsonValue).trim()
      : JSON.stringify(jsonValue)

    if (!serializedValue) {
      throw {
        status: 400,
        message: 'Missing Monday JSON value for JSON update.',
      }
    }

    await callMondayGraphql(
      `
mutation UpdateMondayItemJsonColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
`,
      {
        boardId: normalizedBoardId,
        itemId: normalizedItemId,
        columnId: normalizedColumnId,
        value: serializedValue,
      },
    )

    return {
      boardId: normalizedBoardId,
      itemId: normalizedItemId,
      columnId: normalizedColumnId,
      value: serializedValue,
    }
  }

  async function updateMondayItemName({ boardId, itemId, itemName }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedItemId = String(itemId ?? '').trim()
    const normalizedItemName = String(itemName ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 500,
        message: 'Missing Monday board id for item name update.',
      }
    }

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for item name update.',
      }
    }

    if (!normalizedItemName) {
      throw {
        status: 400,
        message: 'Missing Monday item name for item name update.',
      }
    }

    await callMondayGraphql(
      `
mutation UpdateMondayItemName($boardId: ID!, $itemId: ID!, $name: String!) {
  change_simple_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: "name",
    value: $name
  ) {
    id
  }
}
`,
      {
        boardId: normalizedBoardId,
        itemId: normalizedItemId,
        name: normalizedItemName,
      },
    )

    return {
      boardId: normalizedBoardId,
      itemId: normalizedItemId,
      itemName: normalizedItemName,
    }
  }

  async function moveMondayItemToBoard({ sourceBoardId, targetBoardId, itemId }) {
    ensureMondayConfiguration()

    const normalizedSourceBoardId = String(sourceBoardId ?? '').trim()
    const normalizedTargetBoardId = String(targetBoardId ?? '').trim()
    const normalizedItemId = String(itemId ?? '').trim()

    if (!normalizedSourceBoardId) {
      throw {
        status: 400,
        message: 'Missing source Monday board id for move.',
      }
    }

    if (!normalizedTargetBoardId) {
      throw {
        status: 500,
        message: 'Missing target Monday board id for move.',
      }
    }

    if (!normalizedItemId) {
      throw {
        status: 400,
        message: 'Missing Monday item id for move.',
      }
    }

    const boardMetadata = await callMondayGraphql(
      `
query GetMoveBoardMetadata($sourceBoardId: ID!, $targetBoardId: ID!) {
  sourceBoards: boards(ids: [$sourceBoardId]) {
    id
    name
    columns {
      id
      type
      title
    }
  }

  targetBoards: boards(ids: [$targetBoardId]) {
    id
    name
    columns {
      id
      type
      title
    }
    groups {
      id
      title
    }
  }
}
`,
      {
        sourceBoardId: normalizedSourceBoardId,
        targetBoardId: normalizedTargetBoardId,
      },
    )

    const sourceBoard = Array.isArray(boardMetadata?.sourceBoards)
      ? boardMetadata.sourceBoards[0]
      : null
    const targetBoard = Array.isArray(boardMetadata?.targetBoards)
      ? boardMetadata.targetBoards[0]
      : null

    if (!sourceBoard) {
      throw {
        status: 404,
        message: `Source Monday board ${normalizedSourceBoardId} was not found.`,
      }
    }

    if (!targetBoard) {
      throw {
        status: 404,
        message: `Target Monday board ${normalizedTargetBoardId} was not found.`,
      }
    }

    const targetGroups = Array.isArray(targetBoard?.groups)
      ? targetBoard.groups
      : []
    const targetGroup = targetGroups.find((group) => String(group?.id ?? '').trim()) || null
    const targetGroupId = String(targetGroup?.id ?? '').trim()

    if (!targetGroupId) {
      throw {
        status: 409,
        message: `Target Monday board ${normalizedTargetBoardId} does not have an active group.`,
      }
    }

    const sourceColumns = Array.isArray(sourceBoard?.columns)
      ? sourceBoard.columns
      : []
    const targetColumns = Array.isArray(targetBoard?.columns)
      ? targetBoard.columns
      : []
    const columnsMapping = buildColumnsMappingBetweenBoards(sourceColumns, targetColumns)
    let mappingMode = 'explicit'

    try {
      await callMondayGraphql(
        `
mutation MoveMondayItemToBoard($itemId: ID!, $boardId: ID!, $groupId: ID!, $columnsMapping: [ColumnMappingInput!]) {
  move_item_to_board(
    item_id: $itemId
    board_id: $boardId
    group_id: $groupId
    columns_mapping: $columnsMapping
  ) {
    id
  }
}
`,
        {
          itemId: normalizedItemId,
          boardId: normalizedTargetBoardId,
          groupId: targetGroupId,
          columnsMapping,
        },
      )
    } catch (error) {
      // If explicit mapping fails due a board schema mismatch, retry with
      // Monday's built-in best-match mapping to keep shipping operational.
      await callMondayGraphql(
        `
mutation MoveMondayItemToBoardFallback($itemId: ID!, $boardId: ID!, $groupId: ID!) {
  move_item_to_board(
    item_id: $itemId
    board_id: $boardId
    group_id: $groupId
  ) {
    id
  }
}
`,
        {
          itemId: normalizedItemId,
          boardId: normalizedTargetBoardId,
          groupId: targetGroupId,
        },
      )
      mappingMode = 'best_match_fallback'
    }

    return {
      itemId: normalizedItemId,
      sourceBoardId: normalizedSourceBoardId,
      sourceBoardName: String(sourceBoard?.name ?? '').trim() || null,
      targetBoardId: normalizedTargetBoardId,
      targetBoardName: String(targetBoard?.name ?? '').trim() || null,
      targetGroupId,
      targetGroupTitle: String(targetGroup?.title ?? '').trim() || null,
      mappingMode,
      mappedColumnCount: columnsMapping.filter((entry) => String(entry?.target ?? '').trim()).length,
      totalSourceColumnCount: columnsMapping.length,
    }
  }

  async function createMondaySubitem({ parentItemId, itemName }) {
    ensureMondayConfiguration()
    const normalizedParentItemId = String(parentItemId ?? '').trim()
    const normalizedItemName = String(itemName ?? '').trim().slice(0, 500)
    if (!normalizedParentItemId) throw { status: 400, message: 'Missing parent Monday item id.' }
    if (!normalizedItemName) throw { status: 400, message: 'Missing subitem name.' }
    const data = await callMondayGraphql(
      `mutation CreateMondaySubitem($parentItemId: ID!, $itemName: String!) {
        create_subitem(parent_item_id: $parentItemId, item_name: $itemName) { id name }
      }`,
      { parentItemId: normalizedParentItemId, itemName: normalizedItemName },
    )
    const subitem = data?.create_subitem
    if (!subitem?.id) throw { status: 502, message: 'Monday did not return the new subitem.' }
    return { id: String(subitem.id), name: String(subitem.name ?? normalizedItemName) }
  }

  async function fetchMondayBoardsCatalog({ forceRefresh = false } = {}) {
    ensureMondayConfiguration()

    if (
      !forceRefresh
      && cachedBoardsCatalogSnapshot
      && Date.now() - cachedBoardsCatalogSnapshot.fetchedAt < boardCatalogCacheTtlMs
    ) {
      return cachedBoardsCatalogSnapshot.boards
    }

    const boardsQuery = `
query ListMondayBoards($limit: Int!, $page: Int!) {
  boards(limit: $limit, page: $page, state: active) {
    id
    name
  }
}
`

    const boardsById = new Map()
    let page = 1

    while (page <= mondayBoardsMaxPages) {
      const data = await callMondayGraphql(boardsQuery, {
        limit: mondayBoardsPageLimit,
        page,
      })

      const pageBoards = Array.isArray(data?.boards)
        ? data.boards
        : []

      pageBoards.forEach((board) => {
        const boardId = String(board?.id ?? '').trim()

        if (!boardId || boardsById.has(boardId)) {
          return
        }

        boardsById.set(boardId, {
          id: boardId,
          name: String(board?.name ?? '').trim() || null,
        })
      })

      if (pageBoards.length < mondayBoardsPageLimit) {
        break
      }

      page += 1
    }

    const boards = [...boardsById.values()].sort((left, right) => {
      const leftName = String(left?.name ?? '').trim().toLowerCase()
      const rightName = String(right?.name ?? '').trim().toLowerCase()
      const byName = leftName.localeCompare(rightName)

      if (byName !== 0) {
        return byName
      }

      return String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
    })

    cachedBoardsCatalogSnapshot = {
      fetchedAt: Date.now(),
      boards,
    }

    return boards
  }

  async function fetchMondayBoardColumns({ boardId }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()

    if (!normalizedBoardId) {
      throw {
        status: 400,
        message: 'Missing Monday board id for board-columns lookup.',
      }
    }

    const data = await callMondayGraphql(
      `
query GetMondayBoardColumns($boardId: ID!) {
  boards(ids: [$boardId]) {
    id
    name
    columns {
      id
      title
      type
    }
  }
}
`,
      {
        boardId: normalizedBoardId,
      },
    )

    const board = Array.isArray(data?.boards)
      ? data.boards[0]
      : null

    if (!board) {
      throw {
        status: 404,
        message: `Monday board ${normalizedBoardId} was not found.`,
      }
    }

    const columns = (Array.isArray(board?.columns) ? board.columns : [])
      .map((column) => {
        const columnId = String(column?.id ?? '').trim()

        if (!columnId) {
          return null
        }

        return {
          id: columnId,
          title: String(column?.title ?? '').trim() || null,
          type: String(column?.type ?? '').trim() || null,
        }
      })
      .filter(Boolean)

    return {
      board: {
        id: String(board?.id ?? normalizedBoardId).trim() || normalizedBoardId,
        name: String(board?.name ?? '').trim() || null,
      },
      columns,
    }
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

  // Fetches a deliberately small, caller-selected set of columns for every
  // item on one board. This keeps yearly New Orders enrichment inexpensive
  // while still matching by the board's authoritative ACK column.
  async function fetchMondayBoardSelectedColumns({
    boardId,
    boardUrl = null,
    boardName = null,
    columnIds = [],
  }) {
    ensureMondayConfiguration()

    const normalizedBoardId = String(boardId ?? '').trim()
    const normalizedColumnIds = [...new Set(
      (Array.isArray(columnIds) ? columnIds : [])
        .map((columnId) => String(columnId ?? '').trim())
        .filter(Boolean),
    )]

    if (!normalizedBoardId) {
      throw { status: 500, message: 'Missing Monday board id for selected-column lookup.' }
    }

    if (normalizedColumnIds.length === 0) {
      throw { status: 400, message: 'At least one Monday column id is required.' }
    }

    const idsLiteral = `[${normalizedColumnIds.map((id) => JSON.stringify(id)).join(', ')}]`
    const selectedColumnsQuery = `
query GetBoardSelectedColumns($boardId: ID!, $limit: Int!, $cursor: String) {
  boards(ids: [$boardId]) {
    id
    name
    items_page(limit: $limit, cursor: $cursor) {
      cursor
      items {
        id
        name
        column_values(ids: ${idsLiteral}) {
          id
          type
          text
          value
        }
      }
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
      const data = await callMondayGraphql(selectedColumnsQuery, {
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

    return {
      board,
      generatedAt: new Date().toISOString(),
      items: dedupeMondayItems(collectedItems).map((item) => ({
        id: String(item?.id ?? '').trim(),
        name: String(item?.name ?? '').trim(),
        columnValues: (Array.isArray(item?.column_values) ? item.column_values : [])
          .map((columnValue) => ({
            id: String(columnValue?.id ?? '').trim(),
            type: String(columnValue?.type ?? '').trim() || null,
            text: String(columnValue?.text ?? '').trim() || null,
            value: columnValue?.value ?? null,
          }))
          .filter((columnValue) => Boolean(columnValue.id)),
      })),
    }
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
        columnDetection: detectMondayColumns([], normalizedBoardId),
      }
    }

    const itemsByIdsQuery = `
query GetItemsByIds($itemIds: [ID!]!) {
  items(ids: $itemIds) {
    id
    name
    state
    board { id name }
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
    subitems {
      id
      name
      created_at
      updated_at
      column_values { id type text value column { title } }
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

    // items(ids:) is global in Monday.  Do not trust a returned item merely
    // because its id exists: it must still be active on the board requested.
    const uniqueRawItems = dedupeMondayItems(rawItems).filter((item) => (
      String(item?.state ?? '').trim().toLowerCase() === 'active'
      && String(item?.board?.id ?? '').trim() === normalizedBoardId
    ))
    const columnMap = detectMondayColumns(uniqueRawItems, normalizedBoardId)
    const orders = uniqueRawItems
      .map((item) => ({
        ...normalizeMondayOrder(item, columnMap, { boardUrl }),
        subitems: normalizeMondaySubitems(item),
      }))
      .sort(compareOrdersByUrgency)

    return {
      board: boardInfo,
      generatedAt: new Date().toISOString(),
      orders,
      columnDetection: columnMap,
    }
  }

  return {
    createMondayItem,
    createMondaySubitem,
    deleteMondayItem,
    fetchMondayAssetDownloadInfo,
    fetchMondayBoardColumns,
    fetchMondayBoardItemNames,
    fetchMondayBoardItemsByIds,
    fetchMondayBoardSelectedColumns,
    fetchMondayBoardsCatalog,
    fetchMondayDashboardSnapshot,
    fetchMondayStatusColumnOptions,
    invalidateMondayBoardNamesCache,
    moveMondayItemToBoard,
    updateMondayItemJsonColumn,
    updateMondayItemName,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
  }
}
