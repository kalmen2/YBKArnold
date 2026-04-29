export function createMondaySnapshotService({
  ensureMondayConfiguration,
  mondayApiUrl,
  mondayApiToken,
  mondayBoardId,
  mondayBoardUrl,
  mondayItemsPageQuery,
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
}) {
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

    let cursor = null
    let pageCount = 0
    const rawItems = []
    let boardInfo = null

    while (pageCount < 10) {
      const data = await callMondayGraphql(mondayItemsPageQuery, {
        boardId,
        limit: 200,
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

      rawItems.push(...pageItems)
      cursor = board.items_page?.cursor || null
      pageCount += 1

      if (!cursor) {
        break
      }
    }

    const columnMap = detectMondayColumns(rawItems)
    const orders = rawItems
      .map((item) => normalizeMondayOrder(item, columnMap))
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
  }

  async function callMondayGraphql(query, variables) {
    const response = await fetch(mondayApiUrl, {
      method: 'POST',
      headers: {
        Authorization: mondayApiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw {
        status: 502,
        message: `Monday API request failed with status ${response.status}.`,
      }
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw {
        status: 502,
        message: payload.errors[0]?.message ?? 'Monday API returned an error.',
      }
    }

    return payload?.data ?? {}
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

  return {
    fetchMondayAssetDownloadInfo,
    fetchMondayDashboardSnapshot,
  }
}
