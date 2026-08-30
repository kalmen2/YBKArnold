// Compatibility adapter used while callers are migrated away from the old
// monday_orders collection. Monday-card data lives on its owning orders row at
// monday.card; callers still receive the flat card shape they expect.

const CARD_PATH = 'monday.card'
const CARD_ID_PATH = `${CARD_PATH}.mondayItemId`

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function mapField(field) {
  if (field === 'mondayItemId') return CARD_ID_PATH
  if (field.startsWith('monday.')) return field
  return `${CARD_PATH}.${field}`
}

function mapFilter(filter) {
  if (!isPlainObject(filter)) return filter
  return Object.fromEntries(Object.entries(filter).map(([key, value]) => {
    if (key === '$or' || key === '$and' || key === '$nor') {
      return [key, Array.isArray(value) ? value.map(mapFilter) : value]
    }
    return [key.startsWith('$') ? key : mapField(key), value]
  }))
}

function withCardFilter(filter = {}) {
  return { $and: [{ [CARD_ID_PATH]: { $exists: true } }, mapFilter(filter)] }
}

function flatten(document) {
  if (!document) return document
  const { monday, ...order } = document
  return { ...order, ...(isPlainObject(monday?.card) ? monday.card : {}) }
}

function mapUpdate(update, mondayItemId) {
  const mapped = {}
  for (const [operator, value] of Object.entries(update ?? {})) {
    if (!isPlainObject(value)) {
      mapped[operator] = value
      continue
    }
    if (operator === '$set' || operator === '$unset' || operator === '$inc') {
      mapped[operator] = Object.fromEntries(Object.entries(value).map(([key, entry]) => [mapField(key), entry]))
      continue
    }
    if (operator === '$setOnInsert') {
      mapped[operator] = {
        orderKey: `monday:${mondayItemId}`,
        source: 'monday',
        has_monday_record: true,
        ...Object.fromEntries(Object.entries(value).map(([key, entry]) => [mapField(key), entry])),
      }
      continue
    }
    mapped[operator] = value
  }
  return mapped
}

export function createEmbeddedMondayOrdersCollection({ ordersUnifiedCollection }) {
  function mondayItemIdFromFilter(filter) {
    const raw = filter?.mondayItemId
    return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
  }

  return {
    find(filter = {}, options = {}) {
      let sortSpec = null
      return {
        sort(spec) {
          sortSpec = Object.fromEntries(Object.entries(spec ?? {}).map(([key, value]) => [mapField(key), value]))
          return this
        },
        async toArray() {
          let cursor = ordersUnifiedCollection.find(withCardFilter(filter))
          if (sortSpec) cursor = cursor.sort(sortSpec)
          return (await cursor.toArray()).map(flatten)
        },
      }
    },

    async findOne(filter = {}, options = {}) {
      return flatten(await ordersUnifiedCollection.findOne(withCardFilter(filter), options?.sort ? { sort: options.sort } : undefined))
    },

    async updateOne(filter, update, options = {}) {
      const mondayItemId = mondayItemIdFromFilter(filter)
      if (!mondayItemId) throw new Error('Embedded Monday-card writes require mondayItemId.')
      return ordersUnifiedCollection.updateOne(
        withCardFilter(filter),
        mapUpdate(update, mondayItemId),
        options,
      )
    },

    async findOneAndUpdate(filter, update, options = {}) {
      const mondayItemId = mondayItemIdFromFilter(filter)
      if (!mondayItemId) throw new Error('Embedded Monday-card writes require mondayItemId.')
      const result = await ordersUnifiedCollection.findOneAndUpdate(
        withCardFilter(filter),
        mapUpdate(update, mondayItemId),
        options,
      )
      return flatten(result)
    },

    async deleteOne(filter) {
      return ordersUnifiedCollection.updateOne(withCardFilter(filter), {
        $unset: { [CARD_PATH]: '', 'monday.mondayCardMigratedAt': '' },
      })
    },

    async bulkWrite(operations = [], options = {}) {
      const mapped = operations.map((operation) => {
        if (!operation?.updateOne) throw new Error('Only updateOne bulk operations are supported for embedded Monday cards.')
        const { filter, update, upsert } = operation.updateOne
        const mondayItemId = mondayItemIdFromFilter(filter)
        if (!mondayItemId) throw new Error('Embedded Monday-card writes require mondayItemId.')
        return { updateOne: { filter: withCardFilter(filter), update: mapUpdate(update, mondayItemId), upsert } }
      })
      return ordersUnifiedCollection.bulkWrite(mapped, options)
    },

    countDocuments(filter = {}) {
      return ordersUnifiedCollection.countDocuments(withCardFilter(filter))
    },
  }
}
