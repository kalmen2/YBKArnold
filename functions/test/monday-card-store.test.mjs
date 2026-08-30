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

test('a write lands on the mirror AND the owning order', async () => {
  const c = fakeCollections({ orders: [{ monday_production_item_id: '111' }] })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '111', set: { notes: 'hello' }, collections: c })
  assert.equal(r.embeddedCount, 1)
  assert.deepEqual(c.calls.mirrorUpdates[0].update.$set, { notes: 'hello', mondayItemId: '111' })
  assert.deepEqual(c.calls.orderUpdates[0].update.$set, {
    'monday.card.notes': 'hello',
    'monday.card.mondayItemId': '111',
  })
})

test('a card with no owning order still updates the mirror, and says so', async () => {
  const c = fakeCollections({ orders: [] })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '999', set: { notes: 'x' }, collections: c })
  assert.equal(r.mirrored, true)
  assert.equal(r.embeddedCount, 0, 'unlinked cards cannot embed - the mirror is still needed')
  assert.equal(c.calls.mirrorUpdates.length, 1)
})

test('a card claimed by two orders updates both rather than picking one', async () => {
  const c = fakeCollections({
    orders: [{ monday_production_item_id: '111' }, { monday_item_id: '111' }],
  })
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '111', set: { bench: 'B' }, collections: c })
  assert.equal(r.embeddedCount, 2)
})

test('reads prefer the embedded copy over the mirror', async () => {
  const c = fakeCollections({
    orders: [{ monday_production_item_id: '111', monday: { card: { notes: 'embedded' } } }],
    mirror: [{ mondayItemId: '111', notes: 'stale-mirror', statusLabel: 'Open' }],
  })
  const { readMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const card = await readMondayCard({ mondayItemId: '111', collections: c })
  assert.equal(card.notes, 'embedded')
  assert.equal(card.statusLabel, 'Open', 'mirror-only fields still surface during migration')
})

test('reads fall back to the mirror when nothing is embedded yet', async () => {
  const c = fakeCollections({
    orders: [{ monday_production_item_id: '111' }],
    mirror: [{ mondayItemId: '111', notes: 'from-mirror' }],
  })
  const { readMondayCard } = createMondayCardStore({ getCollections: async () => c })
  assert.equal((await readMondayCard({ mondayItemId: '111', collections: c })).notes, 'from-mirror')
})

test('delete removes the mirror row and unsets the embedded copy', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { deleteMondayCard } = createMondayCardStore({ getCollections: async () => c })
  await deleteMondayCard({ mondayItemId: '111', collections: c })
  assert.equal(c.calls.mirrorDeletes.length, 1)
  assert.equal(c.calls.orderUnsets.length, 1)
})

test('a blank item id is a no-op on both copies', async () => {
  const c = fakeCollections()
  const { writeMondayCard } = createMondayCardStore({ getCollections: async () => c })
  const r = await writeMondayCard({ mondayItemId: '  ', set: { notes: 'x' }, collections: c })
  assert.equal(r.mirrored, false)
  assert.equal(c.calls.mirrorUpdates.length, 0)
  assert.equal(c.calls.orderUpdates.length, 0)
})

// --- drop-in compat wrappers ---------------------------------------------

test('updateOneCompat mirrors a $set to both copies and returns the mirror result', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  c.mondayOrdersCollection.updateOne = async (filter, update, opts) => {
    c.calls.mirrorUpdates.push({ filter, update, opts })
    return { matchedCount: 1, modifiedCount: 1 }
  }
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  const r = await updateOneCompat({ mondayItemId: '111' }, { $set: { notes: 'n' } })
  assert.equal(r.matchedCount, 1, 'mirror result is passed through unchanged')
  assert.deepEqual(c.calls.orderUpdates[0].update.$set, { 'monday.card.notes': 'n' })
})

test('updateOneCompat passes through untouched when the filter is not keyed on mondayItemId', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  await updateOneCompat({ someOtherKey: 'x' }, { $set: { notes: 'n' } })
  assert.equal(c.calls.mirrorUpdates.length, 1, 'mirror still written')
  assert.equal(c.calls.orderUpdates.length, 0, 'no embedded write is guessed at')
})

test('updateOneCompat does not embed when the update has no $set', async () => {
  const c = fakeCollections({ orders: [{ monday_item_id: '111' }] })
  const { updateOneCompat } = createMondayCardStore({ getCollections: async () => c })
  await updateOneCompat({ mondayItemId: '111' }, { $unset: { notes: '' } })
  assert.equal(c.calls.orderUpdates.length, 0)
})
