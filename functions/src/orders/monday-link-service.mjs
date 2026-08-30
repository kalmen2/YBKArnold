// The single place that answers "which Monday item is this Arnold order?"
//
// Arnold's order_number is the matching key — never the Monday item id we
// happen to have stored, and never the item's mutable name. An order
// legitimately has TWO live Monday items at once, so uniqueness is judged per
// ROLE, never across every board:
//
//   production — ONE item that moves Design AKF -> Order Track AKF ->
//                Shipped Orders AKF. move_item_to_board preserves the item id,
//                so only the board changes over the order's lifetime.
//   financial  — a SEPARATE permanent item on New Orders 20XX, the board
//                chosen by the order number's two-digit prefix.
//
// Judged across all boards at once, every healthy order would look like a
// duplicate. That is the bug this module exists to avoid.

import {
  MONDAY_BOARDS,
  NEW_ORDERS_FINANCIAL_BOARDS_BY_PREFIX,
} from './monday-board-map.mjs'
import {
  buildMondayOrderNumberLookup,
  normalizeOrderNumberKey,
  resolveMondayOrderMatch,
} from '../services/orders-merge-helpers.mjs'
import { AppError } from '../utils/app-error.mjs'

export const MONDAY_LINK_ROLES = Object.freeze({
  production: 'production',
  financial: 'financial',
})

const ACK_COLUMN_ID = 'text9'
const DEFAULT_CACHE_TTL_MS = 60 * 1000

export function createMondayLinkService({
  fetchMondayBoardSelectedColumns,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
}) {
  const cachedBoardIndexes = new Map()

  // The production item can be on any of these three boards at a given moment.
  function resolveProductionBoards() {
    return [
      { boardId: MONDAY_BOARDS.design.id, boardName: MONDAY_BOARDS.design.name },
      { boardId: MONDAY_BOARDS.orderTrack.id, boardName: MONDAY_BOARDS.orderTrack.name },
      { boardId: MONDAY_BOARDS.shipped.id, boardName: MONDAY_BOARDS.shipped.name },
    ]
  }

  // Financial items are split across yearly boards by order-number prefix.
  function resolveFinancialBoards(orderNumber) {
    const key = normalizeOrderNumberKey(orderNumber)
    const prefix = key.slice(0, 2)
    const board = NEW_ORDERS_FINANCIAL_BOARDS_BY_PREFIX[prefix]

    if (!board) {
      return []
    }

    return [{ boardId: board.boardId, boardName: `New Orders ${board.year}` }]
  }

  // boardIds lets a caller that already knows the exact board scope the search
  // to it — order creation picks its New Orders board from the request, which
  // is not always the one the order-number prefix implies.
  function resolveBoardsForRole(role, orderNumber, boardIds) {
    const explicitBoardIds = (Array.isArray(boardIds) ? boardIds : [])
      .map((boardId) => String(boardId ?? '').trim())
      .filter(Boolean)

    if (explicitBoardIds.length > 0) {
      return explicitBoardIds.map((boardId) => ({ boardId, boardName: null }))
    }

    if (role === MONDAY_LINK_ROLES.financial) {
      return resolveFinancialBoards(orderNumber)
    }
    return resolveProductionBoards()
  }

  async function loadBoardItems({ boardId, boardName }) {
    const cached = cachedBoardIndexes.get(boardId)

    if (cached && now() - cached.fetchedAt < cacheTtlMs) {
      return cached.items
    }

    const snapshot = await fetchMondayBoardSelectedColumns({
      boardId,
      boardName,
      columnIds: [ACK_COLUMN_ID],
    })
    const items = (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => ({
      id: String(item?.id ?? '').trim(),
      name: String(item?.name ?? '').trim(),
      boardId,
      boardName: String(snapshot?.board?.name ?? boardName ?? '').trim() || null,
      ack: readAckText(item),
    }))

    cachedBoardIndexes.set(boardId, { fetchedAt: now(), items })

    return items
  }

  function readAckText(item) {
    const columnValues = Array.isArray(item?.columnValues) ? item.columnValues : []
    const ackColumn = columnValues.find((columnValue) => columnValue?.id === ACK_COLUMN_ID)
    return String(ackColumn?.text ?? '').trim()
  }

  function invalidateCache(boardId) {
    if (boardId) {
      cachedBoardIndexes.delete(String(boardId).trim())
      return
    }
    cachedBoardIndexes.clear()
  }

  // Resolves one role's Monday item for an Arnold order number.
  //
  // Returns a discriminated result — 'not_found' and 'duplicate' are kept
  // apart on purpose. The first can mean nobody has created the item yet; the
  // second is a data conflict only a person can settle.
  async function resolveMondayLink({
    orderNumber,
    storedItemId = null,
    role = MONDAY_LINK_ROLES.production,
    boardIds = null,
  }) {
    const normalizedStoredItemId = String(storedItemId ?? '').trim() || null
    const orderNumberKey = normalizeOrderNumberKey(orderNumber)

    if (!orderNumberKey) {
      return {
        status: 'not_found',
        role,
        itemId: null,
        boardId: null,
        boardName: null,
        linkSource: null,
        relinked: false,
        candidates: [],
        reason: 'Order has no order number to match on.',
      }
    }

    const boards = resolveBoardsForRole(role, orderNumber, boardIds)

    if (boards.length === 0) {
      return {
        status: 'not_found',
        role,
        itemId: null,
        boardId: null,
        boardName: null,
        linkSource: null,
        relinked: false,
        candidates: [],
        reason: `No ${role} board is configured for order number ${orderNumber}.`,
      }
    }

    const items = []
    for (const board of boards) {
      items.push(...await loadBoardItems(board))
    }

    const lookup = buildMondayOrderNumberLookup(items, (item) => item.ack)
    const match = resolveMondayOrderMatch({ order_number: orderNumber }, lookup)

    if (match.status !== 'ok') {
      return {
        status: match.status,
        role,
        itemId: null,
        boardId: null,
        boardName: null,
        linkSource: match.linkSource,
        relinked: false,
        candidates: describeCandidates(match.candidates, items),
        reason: match.status === 'duplicate'
          ? `Order number ${orderNumber} matches more than one live ${role} Monday item.`
          : `Order number ${orderNumber} was not found on the ${role} Monday boards.`,
      }
    }

    const itemId = String(match.item?.id ?? '').trim() || null

    return {
      status: 'ok',
      role,
      itemId,
      boardId: match.item?.boardId ?? null,
      boardName: match.item?.boardName ?? null,
      linkSource: match.linkSource,
      relinked: Boolean(itemId && normalizedStoredItemId && itemId !== normalizedStoredItemId),
      candidates: [],
      reason: null,
    }
  }

  function describeCandidates(candidates, items) {
    const itemsById = new Map(items.map((item) => [item.id, item]))

    return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
      const item = itemsById.get(candidate.itemId)
      return {
        itemId: candidate.itemId,
        name: candidate.name,
        boardId: item?.boardId ?? null,
        boardName: item?.boardName ?? null,
        ack: item?.ack ?? null,
      }
    })
  }

  // Same as resolveMondayLink, but refuses to continue unless the link is
  // unambiguous. Callers use this immediately before writing to Monday so an
  // unclear match never reaches a mutation.
  async function assertMondayLink({
    orderNumber,
    storedItemId = null,
    role = MONDAY_LINK_ROLES.production,
    boardIds = null,
  }) {
    const result = await resolveMondayLink({ orderNumber, storedItemId, role, boardIds })

    if (result.status === 'ok') {
      return result
    }

    const error = new AppError(buildReviewMessage(result), 409)
    error.code = 'monday_link_needs_review'
    error.mondayLink = result
    throw error
  }

  function buildReviewMessage(result) {
    if (result.status === 'duplicate') {
      const detail = result.candidates
        .map((candidate) => `${candidate.itemId}${candidate.name ? ` (${candidate.name})` : ''}`)
        .join(', ')
      return `${result.reason} Needs review — conflicting Monday items: ${detail}.`
    }
    return `${result.reason} Needs review before this change can sync to Monday.`
  }

  // The link fields to persist on the Arnold order after a resolve.
  function buildLinkFields(result, { verifiedAt }) {
    const role = result.role === MONDAY_LINK_ROLES.financial ? 'financial' : 'production'
    const idField = role === 'financial'
      ? 'monday_financial_item_id'
      : 'monday_production_item_id'
    const boardField = role === 'financial'
      ? 'monday_financial_board_id'
      : 'monday_board_id'

    if (result.status !== 'ok') {
      return {
        monday_link_status: result.status,
        monday_link_source: result.linkSource,
        monday_link_candidates: result.candidates,
        monday_links_verified_at: verifiedAt,
      }
    }

    return {
      [idField]: result.itemId,
      [boardField]: result.boardId,
      monday_link_status: 'ok',
      monday_link_source: result.linkSource,
      monday_link_candidates: [],
      monday_links_verified_at: verifiedAt,
    }
  }

  // One entry per link change, so a wrong relink can be traced afterwards.
  function buildLinkHistoryEntry(result, { previousItemId, verifiedAt }) {
    if (result.status !== 'ok' || !result.relinked) {
      return null
    }

    return {
      role: result.role,
      previousItemId: String(previousItemId ?? '').trim() || null,
      nextItemId: result.itemId,
      verifiedAt,
      reason: `relinked_by_order_number_${result.linkSource}`,
    }
  }

  return {
    assertMondayLink,
    buildLinkFields,
    buildLinkHistoryEntry,
    invalidateMondayLinkCache: invalidateCache,
    resolveMondayLink,
  }
}
