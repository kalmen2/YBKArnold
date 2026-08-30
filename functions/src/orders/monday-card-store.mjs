// Owns the Monday-card payload that used to live only in `monday_orders`.
//
// This is the expand step of an expand/migrate/contract move onto
// `orders.monday.card`. Every writer goes through here and updates BOTH
// copies, so the embedded copy stays current while readers are converted one
// group at a time. Nothing here decides which copy readers prefer — that is
// readMondayCard's job, and it can be flipped independently.
//
// A card with no owning Arnold order has nowhere to embed. Those writes touch
// the mirror only, which is why `monday_orders` cannot be dropped until the
// unlinked cards are dealt with separately.

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

export function createMondayCardStore({ getCollections }) {
  async function collections() {
    const { mondayOrdersCollection, ordersUnifiedCollection } = await getCollections()
    return { mondayOrdersCollection, ordersUnifiedCollection }
  }

  // Mirrors a $set onto both copies. Returns how many owning orders were
  // updated so a caller can tell the card is unlinked.
  async function writeMondayCard({
    mondayItemId,
    set = {},
    setOnInsert = null,
    upsert = false,
    collections: injected = null,
  }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return { mirrored: false, embeddedCount: 0 }

    const { mondayOrdersCollection, ordersUnifiedCollection } = injected ?? await collections()
    const update = { $set: { ...set, mondayItemId: id } }
    if (setOnInsert) update.$setOnInsert = setOnInsert

    const ownerFilter = buildCardOwnerFilter(id)
    const embedded = toEmbeddedFields({ ...set, mondayItemId: id })

    const [, embeddedResult] = await Promise.all([
      mondayOrdersCollection.updateOne({ mondayItemId: id }, update, { upsert }),
      ownerFilter
        ? ordersUnifiedCollection.updateMany(ownerFilter, { $set: embedded })
        : Promise.resolve({ matchedCount: 0 }),
    ])

    return { mirrored: true, embeddedCount: Number(embeddedResult?.matchedCount ?? 0) }
  }

  // Reads the card. Prefers the embedded copy so the mirror can be retired,
  // and falls back to it while the migration is in flight.
  async function readMondayCard({ mondayItemId, collections: injected = null }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return null

    const { mondayOrdersCollection, ordersUnifiedCollection } = injected ?? await collections()
    const ownerFilter = buildCardOwnerFilter(id)

    const [owner, mirrored] = await Promise.all([
      ownerFilter
        ? ordersUnifiedCollection.findOne(ownerFilter, { projection: { _id: 0, monday: 1 } })
        : Promise.resolve(null),
      mondayOrdersCollection.findOne({ mondayItemId: id }, { projection: { _id: 0 } }),
    ])

    const embedded = owner?.monday?.card ?? null
    if (embedded && Object.keys(embedded).length > 0) {
      return { ...mirrored, ...embedded, mondayItemId: id }
    }
    return mirrored
  }

  async function deleteMondayCard({ mondayItemId, collections: injected = null }) {
    const id = String(mondayItemId ?? '').trim()
    if (!id) return
    const { mondayOrdersCollection, ordersUnifiedCollection } = injected ?? await collections()
    const ownerFilter = buildCardOwnerFilter(id)
    await Promise.all([
      mondayOrdersCollection.deleteOne({ mondayItemId: id }),
      ownerFilter
        ? ordersUnifiedCollection.updateMany(ownerFilter, { $unset: { monday: '' } })
        : Promise.resolve(null),
    ])
  }

  // Drop-in for `mondayOrdersCollection.updateOne(filter, update, options)`.
  // Same signature on purpose: converting a call site is a one-token change,
  // which keeps this migration reviewable. Only writes keyed on mondayItemId
  // can be mirrored to the embedded copy; anything else passes straight
  // through to the mirror so behaviour is never silently changed.
  async function updateOneCompat(filter, update, options = {}) {
    const { mondayOrdersCollection, ordersUnifiedCollection } = await collections()
    const id = String(filter?.mondayItemId ?? '').trim()
    const set = update?.$set && typeof update.$set === 'object' ? update.$set : null
    const ownerFilter = id ? buildCardOwnerFilter(id) : null

    const [mirrorResult] = await Promise.all([
      mondayOrdersCollection.updateOne(filter, update, options),
      ownerFilter && set
        ? ordersUnifiedCollection.updateMany(ownerFilter, { $set: toEmbeddedFields(set) })
        : Promise.resolve(null),
    ])

    return mirrorResult
  }

  // Same idea for findOneAndUpdate.
  async function findOneAndUpdateCompat(filter, update, options = {}) {
    const { mondayOrdersCollection, ordersUnifiedCollection } = await collections()
    const id = String(filter?.mondayItemId ?? '').trim()
    const set = update?.$set && typeof update.$set === 'object' ? update.$set : null
    const ownerFilter = id ? buildCardOwnerFilter(id) : null

    const [mirrorResult] = await Promise.all([
      mondayOrdersCollection.findOneAndUpdate(filter, update, options),
      ownerFilter && set
        ? ordersUnifiedCollection.updateMany(ownerFilter, { $set: toEmbeddedFields(set) })
        : Promise.resolve(null),
    ])

    return mirrorResult
  }

  return {
    writeMondayCard,
    readMondayCard,
    deleteMondayCard,
    updateOneCompat,
    findOneAndUpdateCompat,
  }
}
