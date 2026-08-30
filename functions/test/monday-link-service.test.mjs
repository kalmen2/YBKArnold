import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMondayLinkService,
  MONDAY_LINK_ROLES,
} from '../src/orders/monday-link-service.mjs'
import { MONDAY_BOARDS } from '../src/orders/monday-board-map.mjs'

// Fixtures mirror real items on the live boards, including their real defects.
const DESIGN_ITEMS = [
  { id: '12862865420', name: 'Rudin Management Co., Inc. – Tables', ack: '260804' },
]
const ORDER_TRACK_ITEMS = [
  { id: '11572123772', name: 'Hi - Touch / 260306-A', ack: '260306-A' },
  { id: '11572082615', name: 'Hi - Touch / 260306-B', ack: '260306-B' },
  { id: '11572100830', name: 'Hi - Touch / 260306-C', ack: '260306-C' },
  { id: '12369677959', name: 'MOII / 260610', ack: '260610' },
]
const SHIPPED_ITEMS = [
  // Same order number on two live items — a real conflict on the Shipped board.
  { id: '11743534119', name: "Waldner's / 250904-A", ack: '250904-A' },
  { id: '10920056821', name: "Waldner's / 250904-A", ack: '250904-A' },
  // Name says 240111, ACK says 240207. ACK is authoritative.
  { id: '6107026728', name: 'CFI / 240111', ack: '240207' },
  { id: '5937994625', name: 'Look Henricksen / 240111', ack: '240111' },
  // Blank ACK; the order number survives only in the name.
  { id: '8540534739', name: 'EvensonBest/240606R', ack: '' },
]
const NEW_ORDERS_2026_ITEMS = [
  { id: '12862870123', name: 'Insidesource / 260804', ack: '260804' },
  // ACK is a transposition of the name's 260610 — a real typo in production.
  { id: '12369676978', name: 'MOII / 260610', ack: '206010' },
  { id: '11572124000', name: 'Hi - Touch / 260306-A', ack: '260306-A' },
]

const ITEMS_BY_BOARD = {
  [MONDAY_BOARDS.design.id]: DESIGN_ITEMS,
  [MONDAY_BOARDS.orderTrack.id]: ORDER_TRACK_ITEMS,
  [MONDAY_BOARDS.shipped.id]: SHIPPED_ITEMS,
  [MONDAY_BOARDS.newOrders2026.id]: NEW_ORDERS_2026_ITEMS,
}

function createService({ items = ITEMS_BY_BOARD, onFetch = () => {} } = {}) {
  return createMondayLinkService({
    fetchMondayBoardSelectedColumns: async ({ boardId, boardName }) => {
      onFetch(boardId)
      return {
        board: { id: boardId, name: boardName },
        items: (items[boardId] ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          columnValues: [{ id: 'text9', type: 'text', text: item.ack, value: null }],
        })),
      }
    },
  })
}

test('resolves the production item and reports no relink when the stored id is right', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({
    orderNumber: '260610',
    storedItemId: '12369677959',
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.itemId, '12369677959')
  assert.equal(result.boardId, MONDAY_BOARDS.orderTrack.id)
  assert.equal(result.linkSource, 'ack')
  assert.equal(result.relinked, false)
})

test('flags a relink when the stored id points at a different item', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({
    orderNumber: '260610',
    storedItemId: '99999999',
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.itemId, '12369677959')
  assert.equal(result.relinked, true)
})

test('ACK wins over a name that contains a different order number', async () => {
  const { resolveMondayLink } = createService()
  const byName = await resolveMondayLink({ orderNumber: '240111' })
  assert.equal(byName.status, 'ok')
  // 6107026728 is *named* "CFI / 240111" but its ACK is 240207.
  assert.equal(byName.itemId, '5937994625')

  const byAck = await resolveMondayLink({ orderNumber: '240207' })
  assert.equal(byAck.status, 'ok')
  assert.equal(byAck.itemId, '6107026728')
})

test('two live items sharing an ACK are a duplicate, and both are returned', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({ orderNumber: '250904-A' })
  assert.equal(result.status, 'duplicate')
  assert.equal(result.itemId, null)
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.itemId).sort(),
    ['10920056821', '11743534119'],
  )
  assert.equal(result.candidates[0].boardId, MONDAY_BOARDS.shipped.id)
})

test('an order number absent from Monday is not_found, distinct from duplicate', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({ orderNumber: '999999' })
  assert.equal(result.status, 'not_found')
  assert.deepEqual(result.candidates, [])
})

test('a blank ACK falls back to the name and records the weaker link source', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({ orderNumber: '240606R' })
  assert.equal(result.status, 'ok')
  assert.equal(result.itemId, '8540534739')
  assert.equal(result.linkSource, 'name_inferred')
})

test('a blank-ACK name collision never outvotes a real ACK match', async () => {
  // 'ghost' carries no ACK but its name yields 240111, which is 5937994625's
  // real ACK. Merging the tiers would call this a duplicate; ACK must win.
  const { resolveMondayLink } = createService({
    items: {
      ...ITEMS_BY_BOARD,
      [MONDAY_BOARDS.shipped.id]: [
        ...SHIPPED_ITEMS,
        { id: 'ghost', name: 'Stray / 240111', ack: '' },
      ],
    },
  })
  const result = await resolveMondayLink({ orderNumber: '240111' })
  assert.equal(result.status, 'ok')
  assert.equal(result.itemId, '5937994625')
  assert.equal(result.linkSource, 'ack')
})

test('suffix order numbers stay distinct across the production boards', async () => {
  const { resolveMondayLink } = createService()
  for (const [orderNumber, itemId] of [
    ['260306-A', '11572123772'],
    ['260306-B', '11572082615'],
    ['260306-C', '11572100830'],
  ]) {
    const result = await resolveMondayLink({ orderNumber })
    assert.equal(result.status, 'ok', `${orderNumber} should resolve`)
    assert.equal(result.itemId, itemId)
  }
})

test('an order on both a production and a financial board is never a duplicate', async () => {
  const { resolveMondayLink } = createService()
  // 260306-A exists on Order Track AND on New Orders 2026.
  const production = await resolveMondayLink({
    orderNumber: '260306-A',
    role: MONDAY_LINK_ROLES.production,
  })
  const financial = await resolveMondayLink({
    orderNumber: '260306-A',
    role: MONDAY_LINK_ROLES.financial,
  })
  assert.equal(production.status, 'ok')
  assert.equal(production.itemId, '11572123772')
  assert.equal(financial.status, 'ok')
  assert.equal(financial.itemId, '11572124000')
  assert.notEqual(production.itemId, financial.itemId)
})

test('the financial role only searches the board matching the order-number prefix', async () => {
  const fetched = []
  const { resolveMondayLink } = createService({ onFetch: (boardId) => fetched.push(boardId) })
  await resolveMondayLink({ orderNumber: '260804', role: MONDAY_LINK_ROLES.financial })
  assert.deepEqual(fetched, [MONDAY_BOARDS.newOrders2026.id])
})

test("a mistyped financial ACK is reported not_found rather than guessed", async () => {
  const { resolveMondayLink } = createService()
  // The New Orders item for 260610 carries the transposed ACK 206010.
  const result = await resolveMondayLink({
    orderNumber: '260610',
    role: MONDAY_LINK_ROLES.financial,
  })
  assert.equal(result.status, 'not_found')
})

test('assertMondayLink throws a 409 that names the conflicting items', async () => {
  const { assertMondayLink } = createService()
  await assert.rejects(
    () => assertMondayLink({ orderNumber: '250904-A' }),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'monday_link_needs_review')
      assert.match(error.message, /Needs review/)
      assert.match(error.message, /11743534119/)
      assert.equal(error.mondayLink.status, 'duplicate')
      return true
    },
  )
})

test('assertMondayLink returns the resolved link when it is unambiguous', async () => {
  const { assertMondayLink } = createService()
  const result = await assertMondayLink({ orderNumber: '260610' })
  assert.equal(result.itemId, '12369677959')
})

test('board reads are cached across resolves and refreshed after the ttl', async () => {
  let clock = 0
  const fetched = []
  const { resolveMondayLink } = createMondayLinkService({
    cacheTtlMs: 1000,
    now: () => clock,
    fetchMondayBoardSelectedColumns: async ({ boardId }) => {
      fetched.push(boardId)
      return {
        board: { id: boardId },
        items: (ITEMS_BY_BOARD[boardId] ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          columnValues: [{ id: 'text9', text: item.ack }],
        })),
      }
    },
  })

  await resolveMondayLink({ orderNumber: '260610' })
  assert.equal(fetched.length, 3, 'three production boards on the first resolve')

  await resolveMondayLink({ orderNumber: '260306-A' })
  assert.equal(fetched.length, 3, 'second resolve is served from cache')

  clock = 2000
  await resolveMondayLink({ orderNumber: '260610' })
  assert.equal(fetched.length, 6, 'cache expires after the ttl')
})

test('link fields and history describe a relink for the correct role', async () => {
  const { resolveMondayLink, buildLinkFields, buildLinkHistoryEntry } = createService()
  const result = await resolveMondayLink({
    orderNumber: '260610',
    storedItemId: 'stale-id',
  })
  const verifiedAt = '2026-08-30T00:00:00.000Z'

  assert.deepEqual(buildLinkFields(result, { verifiedAt }), {
    monday_production_item_id: '12369677959',
    monday_board_id: MONDAY_BOARDS.orderTrack.id,
    monday_link_status: 'ok',
    monday_link_source: 'ack',
    monday_link_candidates: [],
    monday_links_verified_at: verifiedAt,
  })
  assert.deepEqual(buildLinkHistoryEntry(result, { previousItemId: 'stale-id', verifiedAt }), {
    role: 'production',
    previousItemId: 'stale-id',
    nextItemId: '12369677959',
    verifiedAt,
    reason: 'relinked_by_order_number_ack',
  })
})

test('a failed resolve records the review status without clearing the stored link', async () => {
  const { resolveMondayLink, buildLinkFields, buildLinkHistoryEntry } = createService()
  const result = await resolveMondayLink({ orderNumber: '250904-A' })
  const verifiedAt = '2026-08-30T00:00:00.000Z'
  const fields = buildLinkFields(result, { verifiedAt })

  assert.equal(fields.monday_link_status, 'duplicate')
  assert.equal(fields.monday_production_item_id, undefined, 'must not overwrite the stored id')
  assert.equal(fields.monday_link_candidates.length, 2)
  assert.equal(buildLinkHistoryEntry(result, { previousItemId: 'x', verifiedAt }), null)
})

test('boardIds scopes the search to the board a caller is about to write to', async () => {
  const fetched = []
  const { resolveMondayLink } = createService({ onFetch: (boardId) => fetched.push(boardId) })
  // 260804 exists on Design AND New Orders 2026. Scoped to Design, only the
  // Design item is a candidate, so this is not a duplicate.
  const result = await resolveMondayLink({
    orderNumber: '260804',
    boardIds: [MONDAY_BOARDS.design.id],
  })
  assert.deepEqual(fetched, [MONDAY_BOARDS.design.id])
  assert.equal(result.status, 'ok')
  assert.equal(result.itemId, '12862865420')
})

test('the warranty pre-create check treats an unused order number as free', async () => {
  const { resolveMondayLink } = createService()
  const result = await resolveMondayLink({ orderNumber: '260610_WR' })
  assert.equal(result.status, 'not_found')
})
