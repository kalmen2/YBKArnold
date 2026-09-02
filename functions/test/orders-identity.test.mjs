import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMondayOrderNumberLookup,
  findUniqueMondayOrderMatch,
  normalizeOrderNumberKey,
  resolveOrderNumberFromMondayOrder,
} from '../src/services/orders-merge-helpers.mjs'
import {
  buildArchivedOrderKey,
  buildOrderIdentityFilter,
  releaseFinishedOrderKey,
  resolveSingleOrder,
} from '../src/orders/order-shared.mjs'

test('ACK wins when a Monday item name contains a different order number', () => {
  const resolved = resolveOrderNumberFromMondayOrder({
    jobNumber: '240207',
    orderName: 'CFI / 240111',
  })
  assert.equal(resolved, '240207')
})

test('a blank ACK falls back to the full order number in the item name', () => {
  const resolved = resolveOrderNumberFromMondayOrder({
    jobNumber: '',
    orderName: 'EvensonBest / 240606R',
  })
  assert.equal(resolved, '240606R')
})

test('suffix order numbers stay distinct and never collapse to digits only', () => {
  const items = [
    { id: 'a', name: 'Hi-Touch / 260306-A', ack: '260306-A' },
    { id: 'b', name: 'Hi-Touch / 260306-B', ack: '260306-B' },
    { id: 'c', name: 'Hi-Touch / 260306-C', ack: '260306-C' },
  ]
  const lookup = buildMondayOrderNumberLookup(items, (item) => item.ack)
  assert.equal(findUniqueMondayOrderMatch({ order_number: '260306-A' }, lookup)?.id, 'a')
  assert.equal(findUniqueMondayOrderMatch({ order_number: '260306-B' }, lookup)?.id, 'b')
  assert.equal(findUniqueMondayOrderMatch({ order_number: '260306-C' }, lookup)?.id, 'c')
  assert.notEqual(normalizeOrderNumberKey('260306-A'), normalizeOrderNumberKey('260306-B'))
})

test('duplicate ACKs are ambiguous and cannot be auto-linked', () => {
  const lookup = buildMondayOrderNumberLookup([
    { id: 'old', name: 'Order 250904-A', ack: '250904-A' },
    { id: 'new', name: 'Order 250904-A', ack: '250904-A' },
  ], (item) => item.ack)
  assert.equal(findUniqueMondayOrderMatch({ order_number: '250904-A' }, lookup), null)
})

test('write identity prefers the immutable order key and never builds an OR filter', () => {
  assert.deepEqual(buildOrderIdentityFilter({
    orderKey: 'order:260809', mondayItemId: 'stale-item', orderNumber: '260809',
  }), { orderKey: 'order:260809' })
})

// --- resolveSingleOrder ---------------------------------------------------
//
// buildOrderIdentityFilter returns only the highest-priority identity it was
// given, so a stale client-supplied orderKey used to make updateOne silently
// match nothing. resolveSingleOrder falls through the identities instead and
// hands back a filter keyed on the record's own _id.

// Supports the small subset of query shapes these helpers issue: equality on a
// field, `{ $ne: true }` for the live-order scope, and a top-level `$or` of
// equality clauses.
function matchesClause(doc, field, condition) {
  if (condition !== null && typeof condition === 'object' && '$ne' in condition) {
    return doc[field] !== condition.$ne
  }

  return doc[field] === condition
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$or') {
      return condition.some((clause) => matchesFilter(doc, clause))
    }

    return matchesClause(doc, field, condition)
  })
}

function createFakeCollection(documents) {
  return {
    find(filter) {
      const matches = documents.filter((doc) => matchesFilter(doc, filter))
      return {
        limit: (count) => ({ toArray: async () => matches.slice(0, count) }),
      }
    },
    async findOne(filter) {
      return documents.find((doc) => matchesFilter(doc, filter)) || null
    },
    async updateOne(filter, update) {
      const doc = documents.find((candidate) => matchesFilter(candidate, filter))

      if (!doc) {
        return { modifiedCount: 0 }
      }

      Object.assign(doc, update.$set)

      return { modifiedCount: 1 }
    },
  }
}

const ORDERS = [
  { _id: 'a', orderKey: 'order:260809', order_number: '260809', monday_item_id: '111' },
  { _id: 'b', orderKey: 'order:260810', order_number: '260810', monday_item_id: '222' },
]

test('resolveSingleOrder finds the order by its immutable key and returns an _id filter', async () => {
  const result = await resolveSingleOrder(createFakeCollection(ORDERS), {
    orderKey: 'order:260809',
  })
  assert.equal(result.order._id, 'a')
  assert.deepEqual(result.filter, { _id: 'a' })
  assert.equal(result.matchedBy, 'orderKey')
})

test('a stale orderKey falls through to the next identity instead of silently matching nothing', async () => {
  const result = await resolveSingleOrder(createFakeCollection(ORDERS), {
    orderKey: 'order:this-key-is-stale',
    mondayItemId: '222',
    orderNumber: '260810',
  })
  assert.equal(result.order._id, 'b')
  assert.deepEqual(result.filter, { _id: 'b' })
  assert.equal(result.matchedBy, 'monday_item_id')
})

test('an identity matching two orders is reported ambiguous rather than resolved arbitrarily', async () => {
  const duplicated = [
    { _id: 'a', order_number: '260809' },
    { _id: 'b', order_number: '260809' },
  ]
  const result = await resolveSingleOrder(createFakeCollection(duplicated), {
    orderNumber: '260809',
  })
  assert.equal(result.order, null)
  assert.equal(result.filter, null)
  assert.equal(result.ambiguous, true)
})

test('no matching identity resolves to nothing without claiming ambiguity', async () => {
  const result = await resolveSingleOrder(createFakeCollection(ORDERS), {
    orderNumber: '999999',
  })
  assert.equal(result.order, null)
  assert.equal(result.ambiguous, false)
})

// --- finished orders release the acknowledgement number --------------------
//
// A deleted or cancelled order stays in Mongo as history. It must not reserve
// its number, block a rename, or win an identity lookup away from the live
// order that reused it. Order 260809 was queued for deletion while still
// holding `order:260809`, which reserved the number against the unique index
// and made every attempt to reuse it fail.

test('a reused order number resolves to the live order, not the deleted one', async () => {
  const reused = [
    { _id: 'finished', order_number: '260809', orderKey: 'deleted:finished', is_deleted: true },
    { _id: 'live', order_number: '260809', orderKey: 'order:260809' },
  ]
  const result = await resolveSingleOrder(createFakeCollection(reused), {
    orderNumber: '260809',
  })
  assert.equal(result.order._id, 'live')
  assert.equal(result.ambiguous, undefined)
})

test('a cancelled order does not make a reused number ambiguous either', async () => {
  const reused = [
    { _id: 'finished', order_number: '260809', orderKey: 'cancelled:finished', is_cancelled: true },
    { _id: 'live', order_number: '260809', orderKey: 'order:260809' },
  ]
  const result = await resolveSingleOrder(createFakeCollection(reused), {
    orderNumber: '260809',
  })
  assert.equal(result.order._id, 'live')
})

test('a finished order is still reachable by its own key so admins can clear it', async () => {
  const finished = [
    { _id: 'finished', order_number: '260809', orderKey: 'deleted:finished', is_deleted: true },
  ]
  const result = await resolveSingleOrder(createFakeCollection(finished), {
    orderKey: 'deleted:finished',
  })
  assert.equal(result.order._id, 'finished')
  assert.deepEqual(result.filter, { _id: 'finished' })
})

test('two live orders on one number are still ambiguous', async () => {
  const duplicated = [
    { _id: 'a', order_number: '260809' },
    { _id: 'b', order_number: '260809' },
  ]
  const result = await resolveSingleOrder(createFakeCollection(duplicated), {
    orderNumber: '260809',
  })
  assert.equal(result.ambiguous, true)
})

test('releasing a deleted order moves it off the natural key and remembers it', async () => {
  const documents = [
    { _id: 'finished', order_number: '260809', orderKey: 'order:260809', is_deleted: true },
  ]
  const collection = createFakeCollection(documents)
  assert.equal(await releaseFinishedOrderKey(collection, 'order:260809'), true)
  assert.equal(documents[0].orderKey, 'deleted:finished')
  assert.equal(documents[0].restore_order_key, 'order:260809')
})

test('releasing a cancelled order archives it under the cancelled prefix', async () => {
  const documents = [
    { _id: 'finished', order_number: '260809', orderKey: 'order:260809', is_cancelled: true },
  ]
  const collection = createFakeCollection(documents)
  assert.equal(await releaseFinishedOrderKey(collection, 'order:260809'), true)
  assert.equal(documents[0].orderKey, 'cancelled:finished')
})

test('releasing never touches a live order holding the key', async () => {
  const documents = [
    { _id: 'live', order_number: '260809', orderKey: 'order:260809' },
  ]
  const collection = createFakeCollection(documents)
  assert.equal(await releaseFinishedOrderKey(collection, 'order:260809'), false)
  assert.equal(documents[0].orderKey, 'order:260809')
})

test('archived keys stay unique per finished order', () => {
  assert.equal(buildArchivedOrderKey('cancelled', 'abc'), 'cancelled:abc')
  assert.equal(buildArchivedOrderKey('deleted', 'abc'), 'deleted:abc')
  assert.notEqual(buildArchivedOrderKey('deleted', ''), buildArchivedOrderKey('deleted', ''))
})
