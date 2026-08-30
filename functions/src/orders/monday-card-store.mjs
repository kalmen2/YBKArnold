// Owns the Monday-card payload, which now lives only on the owning order at
// `orders.monday.card`. The `monday_orders` mirror this replaced is gone.
//
// A card with no owning Arnold order is deliberately not stored: that history
// stays on the Monday board rather than being duplicated into Mongo. Reads and
// writes for such a card are no-ops here, so callers must treat a null card as
// "not tracked in Arnold" rather than "missing".

const EMBED_ROOT = 'monday.card'

// { shopDrawingUrl: 'x' } -> { 'monday.card.shopDrawingUrl': 'x' }
export function toEmbeddedFields(fields, root = EMBED_ROOT) {
  const out = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (key === '_id') continue
    out[`${root}.${key}`] = value
  }
  return out
}

// The orders that claim this Monday card. More than one is the duplicate-link
// bug; both are updated rather than silently picking one.
export function buildCardOwnerFilter(mondayItemId) {
  const id = String(mondayItemId ?? '').trim()
  if (!id) return null
  return {
    $or: [
      { monday_production_item_id: id },
      { monday_financial_item_id: id },
      { monday_item_id: id },
    ],
  }
}


// A unique index guards monday.card.mondayItemId, so two orders claiming the
// same card is rejected at write time. That is the correct outcome, but it
// must not fail the user's operation - the link itself needs review, which the
// refresh already flags. Swallow only that error.
async function embedIgnoringDuplicateLink(promise) {
  try {
    return await promise
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return { matchedCount: 0, duplicateLink: true }
    }
    throw error
  }
}

export function createMondayCardStore({ getCollections }) {
  async function collections() {
    const { ordersUnifiedCollection } = await getCollections()
    return { ordersUnifiedCollection }
  }

  // Applies a $set to the owning order's embedded card. Returns how many
  // orders were updated, so a caller can tell the card is untracked.
  async function writeMondayCard({
    mondayItemId,
    set = {},
    collections: injected = null,
  }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return { embeddedCount: 0 }

    const { ordersUnifiedCollection } = injected ?? await collections()
    const ownerFilter = buildCardOwnerFilter(id)
    const embedded = toEmbeddedFields({ ...set, mondayItemId: id })

    const embeddedResult = ownerFilter
      ? await embedIgnoringDuplicateLink(ordersUnifiedCollection.updateMany(ownerFilter, { $set: embedded }))
      : { matchedCount: 0 }

    return { embeddedCount: Number(embeddedResult?.matchedCount ?? 0) }
  }

  // Reads the card off its owning order. Null means no Arnold order claims
  // this Monday card.
  async function readMondayCard({ mondayItemId, collections: injected = null }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return null

    const { ordersUnifiedCollection } = injected ?? await collections()
    const ownerFilter = buildCardOwnerFilter(id)

    const owner = ownerFilter
      ? await ordersUnifiedCollection.findOne(ownerFilter, { projection: { _id: 0, monday: 1 } })
      : null

    const embedded = owner?.monday?.card ?? null
    return embedded && Object.keys(embedded).length > 0
      ? { ...embedded, mondayItemId: id }
      : null
  }

  async function deleteMondayCard({ mondayItemId, collections: injected = null }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return
    const { ordersUnifiedCollection } = injected ?? await collections()
    const ownerFilter = buildCardOwnerFilter(id)
    if (ownerFilter) {
      await ordersUnifiedCollection.updateMany(ownerFilter, { $unset: { monday: '' } })
    }
  }

  // Kept the shape of the old `collection.updateOne(filter, update, options)`
  // so converting each call site stayed a one-token change. A filter not keyed
  // on mondayItemId cannot identify an owning order, so it is a no-op rather
  // than a guess.
  async function updateOneCompat(filter, update, options = {}) {
    const { ordersUnifiedCollection } = await collections()
    const id = String(filter?.mondayItemId ?? '').trim()
    const set = update?.$set && typeof update.$set === 'object' ? update.$set : null
    const ownerFilter = id ? buildCardOwnerFilter(id) : null

    if (!ownerFilter || !set) {
      return { matchedCount: 0, modifiedCount: 0 }
    }

    return embedIgnoringDuplicateLink(
      ordersUnifiedCollection.updateMany(ownerFilter, { $set: toEmbeddedFields(set) }),
    )
  }

  // Same idea for findOneAndUpdate.
  async function findOneAndUpdateCompat(filter, update, options = {}) {
    const { ordersUnifiedCollection } = await collections()
    const id = String(filter?.mondayItemId ?? '').trim()
    const set = update?.$set && typeof update.$set === 'object' ? update.$set : null
    const ownerFilter = id ? buildCardOwnerFilter(id) : null

    if (ownerFilter && set) {
      await embedIgnoringDuplicateLink(
        ordersUnifiedCollection.updateMany(ownerFilter, { $set: toEmbeddedFields(set) }),
      )
    }

    return id ? readMondayCard({ mondayItemId: id }) : null
  }

  // Kept the shape of the old `collection.findOne(filter, options)`.
  async function findOneCompat(filter, options = {}) {
    const id = String(filter?.mondayItemId ?? '').trim()

    if (!id) return null
    return readMondayCard({ mondayItemId: id })
  }

  // Bulk equivalent, for callers that pull many cards by id at once.
  async function findManyByItemIds(mondayItemIds) {
    const ids = [...new Set((Array.isArray(mondayItemIds) ? mondayItemIds : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean))]

    if (ids.length === 0) return []

    const { ordersUnifiedCollection } = await collections()
    const owners = await ordersUnifiedCollection.find({
        $or: [
          { monday_production_item_id: { $in: ids } },
          { monday_financial_item_id: { $in: ids } },
          { monday_item_id: { $in: ids } },
        ],
      }, { projection: { _id: 0, monday: 1 } }).toArray()

    const embeddedById = new Map()
    for (const owner of owners) {
      const card = owner?.monday?.card
      const id = String(card?.mondayItemId ?? '').trim()
      if (id) embeddedById.set(id, card)
    }
    return ids
      .map((id) => {
        const embedded = embeddedById.get(id)
        return embedded ? { ...embedded, mondayItemId: id } : null
      })
      .filter(Boolean)
  }

  return {
    writeMondayCard,
    findOneCompat,
    findManyByItemIds,
    readMondayCard,
    deleteMondayCard,
    updateOneCompat,
    findOneAndUpdateCompat,
  }
}
