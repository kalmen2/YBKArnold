import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMondayCardStore,
  toEmbeddedFields,
  buildCardOwnerFilter,
} from '../src/orders/monday-card-store.mjs'

function fakeCollections({ orders = [], mirror = [] } = {}) {
  const calls = { mirrorUpdates: [], orderUpdates: [], mirrorDeletes: [], orderUnsets: [] }
  const matches = (doc, filter) => {
    if (filter.$or) return filter.$or.some((f) => matches(doc, f))
    return Object.entries(filter).every(([k, v]) => doc[k] === v)
  }
  return {
    calls,
    mondayOrdersCollection: {
      async updateOne(filter, update, opts) { calls.mirrorUpdates.push({ filter, update, opts }) },
      async deleteOne(filter) { calls.mirrorDeletes.push(filter) },
      async findOne(filter) { return mirror.find((d) => matches(d, filter)) ?? null },
    },
    ordersUnifiedCollection: {
      async updateMany(filter, update) {
        const hit = orders.filter((d) => matches(d, filter))
        calls.orderUpdates.push({ filter, update, matchedCount: hit.length })
        if (update.$unset) calls.orderUnsets.push(filter)
        return { matchedCount: hit.length }
      },
      async findOne(filter) { return orders.find((d) => matches(d, filter)) ?? null },
    },
  }
}

test('field names are rewritten under monday.card and _id is dropped', () => {
  assert.deepEqual(toEmbeddedFields({ notes: 'x', _id: 'nope', bench: 'B' }), {
    'monday.card.notes': 'x',
    'monday.card.bench': 'B',
  })
})

test('owner lookup checks both role fields and the legacy field', () => {
  assert.deepEqual(buildCardOwnerFilter(' 123 '), {
    $or: [
      { monday_production_item_id: '123' },
      { monday_financial_item_id: '123' },
      { monday_item_id: '123' },
    ],
  })
  assert.equal(buildCardOwnerFilter(''), null)
})

test('a write lands on the owning order', async () => {
  const c = fakeCollections({ orders: [{ monday_production_item_id: '111' }] })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '111', set: { notes: 'hello' }, collections: c })
  assert.equal(r.embeddedCount, 1)
  assert.deepEqual(c.calls.orderUpdates[0].update.$set, {
    'monday.card.notes': 'hello',
    'monday.card.mondayItemId': '111',
  })
})

test('a card no Arnold order claims is not stored at all', async () => {
  const c = fakeCollections({ orders: [] })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '999', set: { notes: 'x' }, collections: c })
  assert.equal(r.embeddedCount, 0, 'that history stays on the Monday board')
})

test('a card claimed by two orders updates both rather than picking one', async () => {
  const c = fakeCollections({
    orders: [{ monday_production_item_id: '111' }, { monday_item_id: '111' }],
  })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '111', set: { bench: 'B' }, collections: c })
  assert.equal(r.embeddedCount, 2)
})

test('reads come from the embedded card', async () => {
  const c = fakeCollections({
    orders: [{ monday_production_item_id: '111', monday: { card: { notes: 'embedded', statusLabel: 'Open' } } }],
  })
  const { readMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const card = await readMondayCard({ mondayItemId: '111', collections: c })
  assert.equal(card.notes, 'embedded')
  assert.equal(card.statusLabel, 'Open')
  assert.equal(card.mondayItemId, '111')
})

test('an order with no embedded card reads as null, not as an empty card', async () => {
  const c = fakeCollections({ orders: [{ monday_production_item_id: '111' }] })
  const { readMondayCard } = createMondayCardStore({ getCollections: async () => c })
  assert.equal(await readMondayCard({ mondayItemId: '111', collections: c }), null)
})

test('delete unsets the embedded card on the owning order', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { deleteMondayCard } = createMondayCardStore({ getCollections: async () => c })
  await deleteMondayCard({ mondayItemId: '111', collections: c })
  assert.equal(c.calls.orderUnsets.length, 1)
})

test('a blank item id is a no-op', async () => {
  const c = fakeCollections()
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '  ', set: { notes: 'x' }, collections: c })
  assert.equal(r.embeddedCount, 0)
  assert.equal(c.calls.orderUpdates.length, 0)
})

// --- drop-in compat wrappers ---------------------------------------------

test('updateOneCompat writes the $set onto the owning order', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  const r = await updateOneCompat({ mondayItemId: '111' }, { $set: { notes: 'n' } })
  assert.equal(r.matchedCount, 1)
  assert.deepEqual(c.calls.orderUpdates[0].update.$set, { 'monday.card.notes': 'n' })
})

test('updateOneCompat is a no-op when the filter cannot identify an owning order', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  const r = await updateOneCompat({ someOtherKey: 'x' }, { $set: { notes: 'n' } })
  assert.equal(r.matchedCount, 0)
  assert.equal(c.calls.orderUpdates.length, 0, 'no owning order is guessed at')
})

test('updateOneCompat does not embed when the update has no $set', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  await updateOneCompat({ mondayItemId: '111' }, { $unset: { notes: '' } })
  assert.equal(c.calls.orderUpdates.length, 0)
})
