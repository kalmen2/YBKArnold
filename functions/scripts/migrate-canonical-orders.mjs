import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'

const APPLY = process.argv.includes('--apply')
const MIGRATION_NAME = 'canonical-orders-v1'

function text(value) {
  return String(value ?? '').trim()
}

function normalizeOrderNumber(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function canonicalOrderKey(order) {
  const normalizedOrderNumber = normalizeOrderNumber(order?.orderNumber)
  if (normalizedOrderNumber) return `order:${normalizedOrderNumber}`
  return `canonical:${text(order?.id) || randomUUID()}`
}

function withoutMongoId(document) {
  const next = { ...(document ?? {}) }
  delete next._id
  return next
}

function buildCanonicalFields(order, quote, currentOperationalRow, migratedAt) {
  const canonicalId = text(order?.id) || randomUUID()
  const sourceQuoteId = text(quote?.id) || text(order?.sourceQuoteId) || null
  const sourceQuoteNumber = text(quote?.quoteNumber) || text(order?.sourceQuoteNumber) || null
  const orderNumber = text(order?.orderNumber) || sourceQuoteNumber || canonicalId
  const hasMondayRecord = Boolean(currentOperationalRow?.has_monday_record)
  const hasQuickBooksRecord = Boolean(currentOperationalRow?.has_quickbooks_record)
  const hasDesignReference = Boolean(text(order?.mondaySecondaryItemId))
  const sourceQuoteSnapshot = quote ? withoutMongoId(quote) : null

  return {
    id: canonicalId,
    dealerSourceId: text(order?.dealerSourceId) || text(quote?.dealerSourceId) || null,
    dealerName: text(order?.dealerName) || text(quote?.dealerName) || text(quote?.companyName) || null,
    orderNumber,
    title: text(order?.title) || text(quote?.title) || sourceQuoteNumber || orderNumber,
    sourceQuoteId,
    sourceQuoteNumber,
    sourceQuoteTitle: text(quote?.title) || text(order?.sourceQuoteTitle) || null,
    mondayPrimaryBoardId: text(order?.mondayPrimaryBoardId) || null,
    mondayPrimaryItemId: text(order?.mondayPrimaryItemId) || null,
    mondaySecondaryBoardId: text(order?.mondaySecondaryBoardId) || null,
    mondaySecondaryItemId: text(order?.mondaySecondaryItemId) || null,
    poDate: text(order?.poDate) || null,
    poNumber: text(order?.poNumber) || null,
    leadTimeDate: text(order?.leadTimeDate) || null,
    shipTo: text(order?.shipTo) || null,
    crmStatus: text(order?.status) || 'pending',
    progressPercent: Number.isFinite(Number(order?.progressPercent)) ? Number(order.progressPercent) : 5,
    orderValue: Number.isFinite(Number(order?.orderValue)) ? Number(order.orderValue) : null,
    currency: text(order?.currency) || text(quote?.currency) || 'USD',
    dueDate: text(order?.dueDate) || null,
    shippedAt: text(order?.shippedAt) || null,
    deliveredAt: text(order?.deliveredAt) || null,
    notes: text(order?.notes) || null,
    createdByUid: text(order?.createdByUid) || null,
    createdByEmail: text(order?.createdByEmail) || null,
    lastStatusChangedAt: text(order?.lastStatusChangedAt) || text(order?.createdAt) || migratedAt,
    canonical_order_id: canonicalId,
    is_canonical_order: true,
    has_crm_record: true,
    orderKey: text(currentOperationalRow?.orderKey) || canonicalOrderKey({ ...order, orderNumber }),
    order_number: orderNumber,
    order_name: text(currentOperationalRow?.order_name) || text(order?.title) || sourceQuoteNumber || orderNumber,
    dealer_source_id: text(order?.dealerSourceId) || text(quote?.dealerSourceId) || null,
    dealer_name: text(order?.dealerName) || text(quote?.dealerName) || text(quote?.companyName) || null,
    source_quote_id: sourceQuoteId,
    source_quote_number: sourceQuoteNumber,
    source_quote_title: text(quote?.title) || text(order?.sourceQuoteTitle) || null,
    source_quote_snapshot: sourceQuoteSnapshot,
    quote_created_at: text(quote?.createdAt) || null,
    quote_sent_at: text(quote?.sentAt) || null,
    quote_viewed_at: text(quote?.viewedAt) || text(quote?.readAt) || null,
    quote_accepted_at: text(quote?.acceptedAt) || text(order?.createdAt) || null,
    converted_at: text(quote?.acceptedAt) || text(order?.createdAt) || migratedAt,
    converted_by_uid: text(order?.createdByUid) || null,
    converted_by_email: text(order?.createdByEmail) || null,
    canonical_status: text(order?.status) || 'pending',
    canonical_progress_percent: Number.isFinite(Number(order?.progressPercent)) ? Number(order.progressPercent) : 5,
    canonical_order_value: Number.isFinite(Number(order?.orderValue)) ? Number(order.orderValue) : null,
    canonical_currency: text(order?.currency) || text(quote?.currency) || 'USD',
    canonical_notes: text(order?.notes) || null,
    canonical_created_at: text(order?.createdAt) || migratedAt,
    canonical_updated_at: text(order?.updatedAt) || migratedAt,
    monday_primary_board_id: text(order?.mondayPrimaryBoardId) || null,
    monday_primary_item_id: text(order?.mondayPrimaryItemId) || null,
    monday_secondary_board_id: text(order?.mondaySecondaryBoardId) || null,
    monday_secondary_item_id: text(order?.mondaySecondaryItemId) || null,
    po_number: text(currentOperationalRow?.po_number) || text(order?.poNumber) || null,
    ship_to: text(currentOperationalRow?.ship_to) || text(order?.shipTo) || null,
    order_date: text(currentOperationalRow?.order_date) || text(order?.poDate) || null,
    Due_date: text(currentOperationalRow?.Due_date) || text(order?.leadTimeDate) || text(order?.dueDate) || null,
    has_monday_record: hasMondayRecord,
    has_quickbooks_record: hasQuickBooksRecord,
    in_design: Boolean(currentOperationalRow?.in_design) || (hasDesignReference && !currentOperationalRow),
    is_shipped: Boolean(currentOperationalRow?.is_shipped) || Boolean(order?.shippedAt),
    hazard_reason: text(currentOperationalRow?.hazard_reason)
      || (!hasMondayRecord ? 'Order was created from a quote but is missing from Monday.' : null),
    source: text(currentOperationalRow?.source) || (hasMondayRecord ? 'monday' : hasQuickBooksRecord ? 'quickbooks' : 'website'),
    migration: {
      name: MIGRATION_NAME,
      migratedAt,
      legacyCrmOrderId: canonicalId,
    },
  }
}

const mongoUri = text(process.env.MONGODB_URI)
if (!mongoUri) throw new Error('MONGODB_URI is required.')

const client = new MongoClient(mongoUri)
await client.connect()

try {
  const baseName = text(process.env.MONGODB_DB) || 'arnold_system'
  const platformDb = client.db(text(process.env.MONGODB_DB_PLATFORM) || baseName)
  const ordersDb = client.db(text(process.env.MONGODB_DB_ORDERS) || `${baseName}_orders`)
  const crmDb = client.db(text(process.env.MONGODB_DB_CRM) || `${baseName}_crm`)
  const sourceOperational = ordersDb.collection('orders_unified')
  const sourceCrmOrders = crmDb.collection('crm_orders')
  const quotes = crmDb.collection('crm_quotes')
  const targetOrders = ordersDb.collection('orders')
  const backups = platformDb.collection('migration_backups')
  const runs = platformDb.collection('migration_runs')
  const migratedAt = new Date().toISOString()
  const batchId = `${MIGRATION_NAME}:${migratedAt}`

  const previousRun = await runs.findOne({ name: MIGRATION_NAME, status: 'completed' })
  if (previousRun && APPLY) {
    throw new Error(`${MIGRATION_NAME} already completed at ${previousRun.completedAt}.`)
  }

  const [operationalRows, crmOrderRows, quoteRows] = await Promise.all([
    sourceOperational.find({}).toArray(),
    sourceCrmOrders.find({}).toArray(),
    quotes.find({}).toArray(),
  ])

  const quotesById = new Map()
  const quotesByNumber = new Map()
  for (const quote of quoteRows) {
    const id = text(quote?.id)
    if (id) quotesById.set(id, quote)
    const number = normalizeOrderNumber(quote?.quoteNumber)
    if (!number) continue
    const entries = quotesByNumber.get(number) ?? []
    entries.push(quote)
    quotesByNumber.set(number, entries)
  }

  const operationalByKey = new Map()
  const operationalByOrderNumber = new Map()
  const operationalByMondayItemId = new Map()
  for (const row of operationalRows) {
    const orderKey = text(row?.orderKey)
    if (orderKey) operationalByKey.set(orderKey, row)
    const orderNumber = normalizeOrderNumber(row?.order_number)
    if (orderNumber) operationalByOrderNumber.set(orderNumber, row)
    const mondayItemId = text(row?.monday_item_id)
    if (mondayItemId) operationalByMondayItemId.set(mondayItemId, row)
  }

  const preparedCrmOrders = crmOrderRows.map((order) => {
    const explicitQuote = quotesById.get(text(order?.sourceQuoteId)) ?? null
    const quoteMatches = quotesByNumber.get(normalizeOrderNumber(order?.orderNumber)) ?? []
    const quote = explicitQuote || (quoteMatches.length === 1 ? quoteMatches[0] : null)
    const currentOperationalRow = operationalByMondayItemId.get(text(order?.mondaySecondaryItemId))
      || operationalByMondayItemId.get(text(order?.mondayPrimaryItemId))
      || operationalByOrderNumber.get(normalizeOrderNumber(order?.orderNumber))
      || null
    return {
      order,
      quote,
      currentOperationalRow,
      canonicalFields: buildCanonicalFields(order, quote, currentOperationalRow, migratedAt),
    }
  })

  const targetOrderKeys = new Set(operationalRows.map((row) => text(row?.orderKey)).filter(Boolean))
  for (const prepared of preparedCrmOrders) targetOrderKeys.add(prepared.canonicalFields.orderKey)

  const summary = {
    apply: APPLY,
    batchId,
    sourceOperationalCount: operationalRows.length,
    sourceCrmOrderCount: crmOrderRows.length,
    sourceQuoteCount: quoteRows.length,
    linkedCrmOrderCount: preparedCrmOrders.filter((entry) => entry.quote).length,
    unlinkedCrmOrderCount: preparedCrmOrders.filter((entry) => !entry.quote).length,
    expectedCanonicalOrderCount: targetOrderKeys.size,
    canonicalOrdersBefore: await targetOrders.countDocuments({}),
  }

  console.log(JSON.stringify(summary, null, 2))
  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write the migration.')
    process.exitCode = 0
  } else {
    const backupOperations = []
    for (const row of operationalRows) {
      backupOperations.push({ insertOne: { document: { batchId, migrationName: MIGRATION_NAME, sourceDatabase: ordersDb.databaseName, sourceCollection: 'orders_unified', sourceId: text(row?._id), originalDocument: row, backedUpAt: migratedAt } } })
    }
    for (const row of crmOrderRows) {
      backupOperations.push({ insertOne: { document: { batchId, migrationName: MIGRATION_NAME, sourceDatabase: crmDb.databaseName, sourceCollection: 'crm_orders', sourceId: text(row?._id), originalDocument: row, backedUpAt: migratedAt } } })
    }
    if (backupOperations.length > 0) await backups.bulkWrite(backupOperations, { ordered: false })

    if (operationalRows.length > 0) {
      await targetOrders.bulkWrite(operationalRows.map((row) => ({
        replaceOne: {
          filter: { orderKey: row.orderKey },
          replacement: withoutMongoId(row),
          upsert: true,
        },
      })), { ordered: false })
    }

    for (const prepared of preparedCrmOrders) {
      await targetOrders.updateOne(
        { orderKey: prepared.canonicalFields.orderKey },
        { $set: prepared.canonicalFields, $setOnInsert: { createdAt: migratedAt } },
        { upsert: true },
      )
      if (prepared.quote) {
        await quotes.updateOne(
          { id: prepared.quote.id },
          { $set: {
            convertedOrderId: prepared.canonicalFields.canonical_order_id,
            convertedOrderNumber: prepared.canonicalFields.order_number,
            convertedAt: prepared.canonicalFields.converted_at,
            updatedAt: text(prepared.quote.updatedAt) || migratedAt,
          } },
        )
      }
    }

    await Promise.all([
      targetOrders.createIndex({ orderKey: 1 }, { unique: true }),
      targetOrders.createIndex({ canonical_order_id: 1 }, { unique: true, sparse: true }),
      targetOrders.createIndex({ source_quote_id: 1 }, { unique: true, sparse: true }),
      targetOrders.createIndex({ order_number: 1 }),
      targetOrders.createIndex({ monday_primary_item_id: 1 }, { sparse: true }),
      targetOrders.createIndex({ monday_secondary_item_id: 1 }, { sparse: true }),
    ])

    const canonicalOrdersAfter = await targetOrders.countDocuments({})
    if (canonicalOrdersAfter !== summary.expectedCanonicalOrderCount) {
      throw new Error(`Verification failed: expected ${summary.expectedCanonicalOrderCount} canonical orders, found ${canonicalOrdersAfter}.`)
    }

    const completedAt = new Date().toISOString()
    await runs.insertOne({
      id: randomUUID(),
      name: MIGRATION_NAME,
      status: 'completed',
      batchId,
      startedAt: migratedAt,
      completedAt,
      summary: { ...summary, canonicalOrdersAfter },
    })
    console.log(JSON.stringify({ ok: true, canonicalOrdersAfter, backupCount: backupOperations.length, completedAt }, null, 2))
  }
} finally {
  await client.close()
}
