// Push a changed order value back to Monday's New Orders board.
//
// The website used to write the order value to Monday exactly once, during
// quote conversion. Every later edit — an added line, a change order, freight
// booked after the fact — stayed in MongoDB only, so Monday drifted low and
// silently. This module closes that gap.
//
// Monday's "Order value" column holds the PRODUCT total only; freight lives in
// its own column. That split is preserved here: writing the grand total into
// the order value column would double-count freight against Monday's own
// freight column.

import { NEW_ORDERS_FINANCIAL_BOARDS_BY_PREFIX } from './monday-board-map.mjs'

function text(value) {
  return String(value ?? '').trim()
}

function money(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * New Orders boards are split per year and keyed by the order number's first
 * two digits (260903 -> 2026). Orders older than the mapped years, and any
 * number that is not in that shape, have no board to write to.
 */
export function resolveNewOrdersFinancialBoard(orderNumber) {
  const prefix = text(orderNumber).slice(0, 2)

  if (!/^\d{2}$/.test(prefix)) {
    return null
  }

  return NEW_ORDERS_FINANCIAL_BOARDS_BY_PREFIX[prefix] ?? null
}

/**
 * Write product and freight values onto the order's New Orders item.
 *
 * Never throws: a Monday outage must not fail the user's save. The caller gets
 * a result describing what happened and is expected to log it, not surface it.
 */
export async function pushOrderValuesToMonday({
  orderDocument,
  productValue,
  freightValue,
  updateMondayItemTextColumn,
}) {
  if (typeof updateMondayItemTextColumn !== 'function') {
    return { pushed: false, reason: 'monday_writer_unavailable' }
  }

  const orderNumber = text(orderDocument?.order_number) || text(orderDocument?.orderNumber)
  const board = resolveNewOrdersFinancialBoard(orderNumber)

  if (!board) {
    return { pushed: false, reason: 'no_mapped_board', orderNumber }
  }

  // The item id is recorded by the New Orders enrichment pass during a refresh.
  // An order that has never matched an item there has nothing to write to.
  const itemId = text(orderDocument?.new_orders_item_id)
    || text(orderDocument?.monday_financial_item_id)

  if (!itemId) {
    return { pushed: false, reason: 'no_new_orders_item', orderNumber }
  }

  const boardId = text(orderDocument?.new_orders_board_id)
    || text(orderDocument?.monday_financial_board_id)
    || board.boardId

  const writes = [
    { columnId: board.orderValueColumnId, value: money(productValue), field: 'productValue' },
    { columnId: board.freightValueColumnId, value: money(freightValue), field: 'freightValue' },
  ].filter((write) => write.columnId && write.value !== null)

  if (writes.length === 0) {
    return { pushed: false, reason: 'nothing_to_write', orderNumber }
  }

  const written = []
  const failed = []

  for (const write of writes) {
    try {
      await updateMondayItemTextColumn({
        boardId,
        itemId,
        columnId: write.columnId,
        textValue: String(write.value),
      })
      written.push({ field: write.field, value: write.value })
    } catch (error) {
      failed.push({ field: write.field, message: text(error?.message) || 'unknown error' })
    }
  }

  return {
    pushed: written.length > 0,
    reason: failed.length === 0 ? 'ok' : 'partial',
    orderNumber,
    boardId,
    itemId,
    written,
    failed,
  }
}
