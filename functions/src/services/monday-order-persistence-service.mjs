export function createMondayOrderPersistenceService({ getCollections }) {
  function normalizeMondayItemId(rawValue) {
    const normalized = String(rawValue ?? '').trim()

    return normalized || null
  }

  function buildMondayOrderDocument(order, board, createdAt) {
    return {
      mondayItemId: normalizeMondayItemId(order?.id),
      mondayBoardId: String(board?.id ?? '').trim() || null,
      mondayBoardName: String(board?.name ?? '').trim() || null,
      mondayBoardUrl: String(board?.url ?? '').trim() || null,
      orderName: String(order?.name ?? '').trim() || null,
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
      createdAt,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
    }
  }

  async function persistNewMondayOrders(snapshot) {
    const snapshotOrders = Array.isArray(snapshot?.orders) ? snapshot.orders : []

    if (snapshotOrders.length === 0) {
      return {
        checkedCount: 0,
        newCount: 0,
        insertedCount: 0,
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
      }
    }

    const { mondayOrdersCollection } = await getCollections()
    const now = new Date().toISOString()
    const board = snapshot?.board ?? null
    const operations = mondayItemIds.map((mondayItemId) => ({
      updateOne: {
        filter: { mondayItemId },
        update: {
          $setOnInsert: buildMondayOrderDocument(
            orderByItemId.get(mondayItemId),
            board,
            now,
          ),
        },
        upsert: true,
      },
    }))

    const writeResult = await mondayOrdersCollection.bulkWrite(operations, {
      ordered: false,
    })
    const insertedCount = Number(writeResult?.upsertedCount ?? 0)

    return {
      checkedCount: mondayItemIds.length,
      newCount: insertedCount,
      insertedCount,
    }
  }

  return {
    persistNewMondayOrders,
  }
}
