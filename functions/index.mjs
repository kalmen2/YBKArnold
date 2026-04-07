import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import * as functions from 'firebase-functions/v1'
import { MongoClient } from 'mongodb'

export const app = express()

app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))

const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_system'
const mondayApiUrl = process.env.MONDAY_API_URL ?? 'https://api.monday.com/v2'
const mondayApiToken = String(process.env.MONDAY_API_TOKEN ?? '').trim()
const mondayBoardId = String(process.env.MONDAY_BOARD_ID ?? '').trim()
const mondayBoardUrl = String(process.env.MONDAY_BOARD_URL ?? '').trim()
const zendeskApiToken = String(process.env.ZENDESK_API_TOKEN ?? '').trim()
const zendeskEmail = String(process.env.ZENDESK_EMAIL ?? '').trim()
const zendeskUrl = String(process.env.ZENDESK_URL ?? '').trim()
const zendeskTicketFieldCacheTtlMs = 30 * 60 * 1000
const zendeskTicketFieldErrorCacheTtlMs = 5 * 60 * 1000

let zendeskOrderNumberFieldId = null
let zendeskOrderNumberFieldExpiresAt = 0
let zendeskOrderNumberFieldPromise = null

const mondayProgressStatusConfig = [
  { key: 'priority', titleKeywords: ['priority'], weight: 0 },
  { key: 'design', titleKeywords: ['design'], weight: 13 },
  { key: 'baseForm', titleKeywords: ['base/form', 'base form'], weight: 13 },
  { key: 'build', titleKeywords: ['build'], weight: 13 },
  { key: 'sandOrLam', titleKeywords: ['sand or lam', 'sand', 'lam'], weight: 13 },
  { key: 'sealer', titleKeywords: ['sealer'], weight: 12 },
  { key: 'lacquer', titleKeywords: ['lacquer'], weight: 12 },
  { key: 'ready', titleKeywords: ['ready'], weight: 12 },
  { key: 'invoiced', titleKeywords: ['invoiced'], weight: 12 },
]

const mondayItemsPageQuery = `
query GetBoardItems($boardId: ID!, $limit: Int!, $cursor: String) {
  boards(ids: [$boardId]) {
    id
    name
    items_page(limit: $limit, cursor: $cursor) {
      cursor
      items {
        id
        name
        created_at
        updated_at
        group {
          id
          title
        }
        column_values {
          id
          type
          text
          value
          column {
            title
          }
        }
      }
    }
  }
}
`

let mongoClient = null
let databasePromise
let indexesPromise

async function getCollections() {
  if (!mongoUri) {
    throw {
      status: 500,
      message: 'Missing MONGODB_URI in Firebase Functions environment.',
    }
  }

  if (!databasePromise) {
    mongoClient = new MongoClient(mongoUri)
    databasePromise = mongoClient.connect().then(() => mongoClient.db(mongoDbName))
  }

  const database = await databasePromise
  const workersCollection = database.collection('workers')
  const entriesCollection = database.collection('timesheet_entries')
  const stagesCollection = database.collection('timesheet_stages')
  const dashboardSnapshotsCollection = database.collection('dashboard_snapshots')

  if (!indexesPromise) {
    indexesPromise = Promise.all([
      workersCollection.createIndex({ id: 1 }, { unique: true }),
      entriesCollection.createIndex({ id: 1 }, { unique: true }),
      entriesCollection.createIndex({ workerId: 1 }),
      entriesCollection.createIndex({ stageId: 1 }),
      entriesCollection.createIndex({ date: -1 }),
      stagesCollection.createIndex({ id: 1 }, { unique: true }),
      stagesCollection.createIndex({ normalizedName: 1 }, { unique: true }),
      dashboardSnapshotsCollection.createIndex({ snapshotKey: 1 }, { unique: true }),
    ]).then(async () => {
      await ensureDefaultStages()
      await ensureStageSortOrder(stagesCollection)
    })
  }

  await indexesPromise

  return {
    database,
    workersCollection,
    entriesCollection,
    stagesCollection,
    dashboardSnapshotsCollection,
  }
}

async function ensureDefaultStages() {
  // Defaults are intentionally disabled; stages are user-managed.
  return
}

async function ensureStageSortOrder(stagesCollection) {
  const stages = await stagesCollection
    .find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          sortOrder: 1,
          createdAt: 1,
          name: 1,
        },
      },
    )
    .sort({ sortOrder: 1, createdAt: 1, name: 1 })
    .toArray()

  if (stages.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const writes = []

  stages.forEach((stage, index) => {
    const current = Number(stage.sortOrder)

    if (!Number.isInteger(current) || current !== index) {
      writes.push({
        updateOne: {
          filter: { id: stage.id },
          update: {
            $set: {
              sortOrder: index,
              updatedAt: now,
            },
          },
        },
      })
    }
  })

  if (writes.length > 0) {
    await stagesCollection.bulkWrite(writes, { ordered: false })
  }
}

function isDashboardRefreshRequested(req) {
  const rawValue = Array.isArray(req.query?.refresh)
    ? req.query.refresh[0]
    : req.query?.refresh
  const normalizedValue = String(rawValue ?? '')
    .trim()
    .toLowerCase()

  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

async function getDashboardSnapshotFromCache(snapshotKey) {
  const { dashboardSnapshotsCollection } = await getCollections()
  const cachedDocument = await dashboardSnapshotsCollection.findOne(
    { snapshotKey },
    {
      projection: {
        _id: 0,
        snapshot: 1,
      },
    },
  )

  return cachedDocument?.snapshot ?? null
}

async function setDashboardSnapshotCache(snapshotKey, snapshot) {
  const { dashboardSnapshotsCollection } = await getCollections()

  await dashboardSnapshotsCollection.updateOne(
    { snapshotKey },
    {
      $set: {
        snapshotKey,
        snapshot,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  )
}

async function clearSupportSnapshotCache() {
  const { dashboardSnapshotsCollection } = await getCollections()

  await dashboardSnapshotsCollection.deleteMany({
    snapshotKey: /^support_/,
  })
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const { database } = await getCollections()
    await database.command({ ping: 1 })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('monday')

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchMondayDashboardSnapshot()
    await setDashboardSnapshotCache('monday', snapshot)

    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/zendesk', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache('zendesk')

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskTicketSummary()
    await setDashboardSnapshotCache('zendesk', snapshot)

    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const snapshotKey = 'support_alerts'

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlerts()
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/alerts/tickets', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limitPerBucket = toBoundedInteger(req.query?.limitPerBucket, 10, 200, 100)
    const snapshotKey = `support_alert_tickets_${limitPerBucket}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportAlertTicketsSnapshot(limitPerBucket)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets', async (req, res, next) => {
  try {
    const refreshRequested = isDashboardRefreshRequested(req)
    const limit = toBoundedInteger(req.query?.limit, 10, 100, 50)
    const snapshotKey = `support_tickets_${limit}`

    if (!refreshRequested) {
      const cachedSnapshot = await getDashboardSnapshotFromCache(snapshotKey)

      if (cachedSnapshot) {
        return res.json(cachedSnapshot)
      }
    }

    const snapshot = await fetchZendeskSupportTicketsSnapshot(limit)
    await setDashboardSnapshotCache(snapshotKey, snapshot)
    res.json(snapshot)
  } catch (error) {
    next(error)
  }
})

app.get('/api/support/tickets/:ticketId/conversation', async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId ?? '').trim()

    if (!/^[0-9]+$/.test(ticketId)) {
      return res.status(400).json({ error: 'ticketId must be numeric.' })
    }

    const conversation = await fetchZendeskTicketConversation(ticketId)
    res.json(conversation)
  } catch (error) {
    next(error)
  }
})

app.post('/api/support/tickets', async (req, res, next) => {
  try {
    const subject = String(req.body?.subject ?? '').trim()
    const description = String(req.body?.description ?? '').trim()
    const requesterName = String(req.body?.requesterName ?? '').trim()
    const requesterEmail = String(req.body?.requesterEmail ?? '').trim()
    const priority = String(req.body?.priority ?? '').trim().toLowerCase()

    if (!subject) {
      return res.status(400).json({ error: 'subject is required.' })
    }

    if (!description) {
      return res.status(400).json({ error: 'description is required.' })
    }

    if (requesterEmail && !requesterName) {
      return res.status(400).json({ error: 'requesterName is required when requesterEmail is provided.' })
    }

    const allowedPriorities = ['low', 'normal', 'high', 'urgent']
    const normalizedPriority = allowedPriorities.includes(priority) ? priority : null

    const createdTicket = await createZendeskSupportTicket({
      subject,
      description,
      requesterName,
      requesterEmail,
      priority: normalizedPriority,
    })

    try {
      await clearSupportSnapshotCache()
    } catch (cacheError) {
      console.warn('Unable to clear support snapshot cache after ticket creation.', cacheError)
    }

    return res.status(201).json(createdTicket)
  } catch (error) {
    next(error)
  }
})

app.get('/api/timesheet/state', async (_req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()

    const [workers, entries, stages] = await Promise.all([
      workersCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ fullName: 1 })
        .toArray(),
      entriesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedName: 0,
            },
          },
        )
        .sort({ sortOrder: 1, name: 1 })
        .toArray(),
    ])

    res.json({ workers, entries, stages })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/stages', async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const name = String(req.body?.name ?? '').trim()

    if (!name) {
      return res.status(400).json({ error: 'stage name is required.' })
    }

    const normalizedName = normalizeStageName(name)
    const duplicate = await stagesCollection.findOne(
      { normalizedName },
      { projection: { _id: 0, id: 1 } },
    )

    if (duplicate) {
      return res.status(400).json({ error: 'Stage already exists.' })
    }

    const now = new Date().toISOString()
    const highestSortOrderStage = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            sortOrder: 1,
          },
        },
      )
      .sort({ sortOrder: -1 })
      .limit(1)
      .toArray()
    const nextSortOrder = Number.isInteger(highestSortOrderStage[0]?.sortOrder)
      ? Number(highestSortOrderStage[0].sortOrder) + 1
      : 0

    const stage = {
      id: randomUUID(),
      name,
      normalizedName,
      sortOrder: nextSortOrder,
      createdAt: now,
      updatedAt: now,
    }

    await stagesCollection.insertOne(stage)

    return res.status(201).json({
      stage: {
        id: stage.id,
        name: stage.name,
        sortOrder: stage.sortOrder,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/stages/:stageId', async (req, res, next) => {
  try {
    const { stagesCollection, entriesCollection } = await getCollections()
    const stageId = String(req.params.stageId ?? '').trim()

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required.' })
    }

    const inUseCount = await entriesCollection.countDocuments({ stageId })

    if (inUseCount > 0) {
      return res.status(400).json({
        error: 'Cannot remove stage with existing entries. Update or remove those entries first.',
      })
    }

    const result = await stagesCollection.deleteOne({ id: stageId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Stage not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/stages/reorder', async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const stageIds = Array.isArray(req.body?.stageIds) ? req.body.stageIds : []

    if (stageIds.length === 0) {
      return res.status(400).json({ error: 'stageIds array is required.' })
    }

    const uniqueStageIds = [...new Set(stageIds.map((value) => String(value ?? '').trim()))].filter(Boolean)

    if (uniqueStageIds.length !== stageIds.length) {
      return res.status(400).json({ error: 'stageIds must be unique and non-empty.' })
    }

    const existingStages = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )
      .toArray()

    if (existingStages.length !== uniqueStageIds.length) {
      return res.status(400).json({ error: 'stageIds must include all existing stages.' })
    }

    const existingSet = new Set(existingStages.map((stage) => String(stage.id)))
    const allPresent = uniqueStageIds.every((id) => existingSet.has(id))

    if (!allPresent) {
      return res.status(400).json({ error: 'One or more stage IDs are invalid.' })
    }

    const now = new Date().toISOString()
    const writes = uniqueStageIds.map((id, index) => ({
      updateOne: {
        filter: { id },
        update: {
          $set: {
            sortOrder: index,
            updatedAt: now,
          },
        },
      },
    }))

    await stagesCollection.bulkWrite(writes, { ordered: true })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers', async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const input = req.body ?? {}
    const worker = validateWorkerInput(input)

    await workersCollection.insertOne(worker)

    res.status(201).json({ worker })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers/bulk', async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const payloadWorkers = Array.isArray(req.body?.workers) ? req.body.workers : []

    if (payloadWorkers.length === 0) {
      return res.status(400).json({ error: 'workers array is required.' })
    }

    const workers = payloadWorkers.map((entry, index) =>
      validateWorkerInput(entry, `workers[${index}]`),
    )

    await workersCollection.insertMany(workers)

    return res.status(201).json({ insertedCount: workers.length })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/workers/:workerId', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection } = await getCollections()
    const workerId = String(req.params.workerId ?? '')

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    const usedInEntries = await entriesCollection.countDocuments({ workerId })

    if (usedInEntries > 0) {
      return res.status(400).json({
        error: 'Cannot remove worker with existing entries. Remove entries first.',
      })
    }

    await workersCollection.deleteOne({ id: workerId })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/entries/bulk', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required.' })
    }

    const entries = rows.map((row, index) =>
      validateEntryInput(row, date, `rows[${index}]`),
    )

    const workerIds = [...new Set(entries.map((entry) => entry.workerId))]
    const validWorkers = await workersCollection
      .find(
        {
          id: {
            $in: workerIds,
          },
        },
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )
      .toArray()

    if (validWorkers.length !== workerIds.length) {
      return res.status(400).json({ error: 'One or more worker IDs are invalid.' })
    }

    const stageIds = [...new Set(entries.map((entry) => entry.stageId).filter(Boolean))]

    if (stageIds.length > 0) {
      const validStages = await stagesCollection
        .find(
          {
            id: {
              $in: stageIds,
            },
          },
          {
            projection: {
              _id: 0,
              id: 1,
            },
          },
        )
        .toArray()

      if (validStages.length !== stageIds.length) {
        return res.status(400).json({ error: 'One or more stage IDs are invalid.' })
      }
    }

    await entriesCollection.insertMany(entries)

    return res.status(201).json({ insertedCount: entries.length })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/entries/:entryId', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const existingEntry = await entriesCollection.findOne(
      { id: entryId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingEntry) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    const date = String(req.body?.date ?? '').trim()

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    const updatedFields = validateEntryFields(req.body, date)
    const workerExists = await workersCollection.countDocuments({
      id: updatedFields.workerId,
    })

    if (workerExists === 0) {
      return res.status(400).json({ error: 'workerId is invalid.' })
    }

    if (updatedFields.stageId) {
      const stageExists = await stagesCollection.countDocuments({
        id: updatedFields.stageId,
      })

      if (stageExists === 0) {
        return res.status(400).json({ error: 'stageId is invalid.' })
      }
    }

    const hasStageField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'stageId')
    const shouldUnsetStage = hasStageField && !updatedFields.stageId
    const updateOperation = shouldUnsetStage
      ? {
          $set: updatedFields,
          $unset: {
            stageId: '',
          },
        }
      : {
          $set: updatedFields,
        }

    await entriesCollection.updateOne(
      { id: entryId },
      updateOperation,
    )

    const nextEntry = {
      ...existingEntry,
      ...updatedFields,
    }

    if (shouldUnsetStage) {
      delete nextEntry.stageId
    }

    return res.json({
      entry: nextEntry,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/entries/:entryId', async (req, res, next) => {
  try {
    const { entriesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const result = await entriesCollection.deleteOne({ id: entryId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.use((error, _req, res, _next) => {
  const status = Number(error?.status ?? 500)
  const message =
    error?.message || error?.details || 'Unexpected server error occurred.'

  res.status(status).json({ error: message })
})

export async function closeMongoConnections() {
  if (!mongoClient) {
    return
  }

  await mongoClient.close()
  mongoClient = null
  databasePromise = undefined
  indexesPromise = undefined
}

export const apiV1 = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onRequest(app)

async function fetchMondayDashboardSnapshot() {
  ensureMondayConfiguration()

  let cursor = null
  let pageCount = 0
  const rawItems = []
  let boardInfo = null

  while (pageCount < 10) {
    const data = await callMondayGraphql(mondayItemsPageQuery, {
      boardId: mondayBoardId,
      limit: 200,
      cursor,
    })

    const board = data?.boards?.[0]

    if (!board) {
      throw {
        status: 404,
        message: 'Monday board was not found. Check MONDAY_BOARD_ID.',
      }
    }

    boardInfo = {
      id: String(board.id ?? mondayBoardId),
      name: String(board.name ?? 'Order Track'),
      url: mondayBoardUrl || null,
    }

    const pageItems = Array.isArray(board.items_page?.items)
      ? board.items_page.items
      : []

    rawItems.push(...pageItems)
    cursor = board.items_page?.cursor || null
    pageCount += 1

    if (!cursor) {
      break
    }
  }

  const columnMap = detectMondayColumns(rawItems)
  const orders = rawItems
    .map((item) => normalizeMondayOrder(item, columnMap))
    .sort(compareOrdersByUrgency)

  const lateOrders = orders.filter((order) => order.isLate)
  const dueSoonOrders = orders.filter(
    (order) =>
      !order.isDone &&
      typeof order.daysUntilDue === 'number' &&
      order.daysUntilDue >= 0 &&
      order.daysUntilDue <= 7,
  )
  const completedOrders = orders.filter((order) => order.isDone)
  const activeOrders = orders.filter((order) => !order.isDone)
  const missingDueDateOrders = activeOrders.filter((order) => !order.effectiveDueDate)

  const ordersWithLeadTime = orders.filter((order) =>
    Number.isFinite(order.leadTimeDays),
  )
  const leadTimeTotal = ordersWithLeadTime.reduce(
    (total, order) => total + Number(order.leadTimeDays ?? 0),
    0,
  )
  const averageLeadTimeDays =
    ordersWithLeadTime.length > 0
      ? Number((leadTimeTotal / ordersWithLeadTime.length).toFixed(1))
      : null

  return {
    board: boardInfo,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalOrders: orders.length,
      activeOrders: activeOrders.length,
      completedOrders: completedOrders.length,
      lateOrders: lateOrders.length,
      dueSoonOrders: dueSoonOrders.length,
      missingDueDateOrders: missingDueDateOrders.length,
      averageLeadTimeDays,
    },
    buckets: {
      byStatus: buildBucketCounts(orders, 'statusLabel'),
      byGroup: buildBucketCounts(orders, 'groupTitle'),
    },
    details: {
      lateOrders,
      dueSoonOrders,
      activeOrders,
      completedOrders,
      missingDueDateOrders,
    },
    orders,
    columnDetection: columnMap,
  }
}

async function fetchZendeskTicketSummary() {
  ensureZendeskConfiguration()

  const statusContext = await fetchZendeskStatusContext()
  const {
    openTotalQuery,
    inProgressQuery,
    openCustomStatusQuery,
    pendingQuery,
    solvedQuery,
  } = buildZendeskStatusQueries(statusContext)

  const [
    newTickets,
    openTotalTickets,
    inProgressTickets,
    openCustomStatusTickets,
    pendingTickets,
    solvedTickets,
  ] = await Promise.all([
    fetchZendeskTicketCount('type:ticket status:new'),
    fetchZendeskTicketCount(openTotalQuery),
    fetchZendeskTicketCount(inProgressQuery),
    openCustomStatusQuery ? fetchZendeskTicketCount(openCustomStatusQuery) : Promise.resolve(null),
    fetchZendeskTicketCount(pendingQuery),
    fetchZendeskTicketCount(solvedQuery),
  ])
  const normalizedOpenTotalTickets = Number.isFinite(openTotalTickets)
    ? Math.max(Math.round(openTotalTickets), 0)
    : 0
  const normalizedInProgressTickets = Number.isFinite(inProgressTickets)
    ? Math.max(Math.round(inProgressTickets), 0)
    : 0
  const normalizedOpenCustomStatusTickets = Number.isFinite(openCustomStatusTickets)
    ? Math.max(Math.round(openCustomStatusTickets), 0)
    : null
  const normalizedOpenTickets =
    normalizedOpenCustomStatusTickets !== null
      ? normalizedOpenCustomStatusTickets
      : inProgressCustomStatusId
        ? Math.max(normalizedOpenTotalTickets - normalizedInProgressTickets, 0)
        : normalizedOpenTotalTickets

  return {
    generatedAt: new Date().toISOString(),
    agentUrl: buildZendeskAgentUrl(),
    metrics: {
      newTickets,
      inProgressTickets: normalizedInProgressTickets,
      openTickets: normalizedOpenTickets,
      pendingTickets,
      solvedTickets,
      openTotalTickets: normalizedOpenTickets + normalizedInProgressTickets,
    },
  }
}

async function fetchZendeskSupportAlerts() {
  ensureZendeskConfiguration()

  const statusContext = await fetchZendeskStatusContext()
  const {
    inProgressQuery,
    openCustomStatusQuery,
    pendingQuery,
  } = buildZendeskStatusQueries(statusContext)

  const openQuery = openCustomStatusQuery || 'type:ticket status:open'

  const [newOver24Hours, openOver24Hours, inProgressOver48Hours, pendingOver48Hours] =
    await Promise.all([
      countZendeskTicketsOlderThanHours('type:ticket status:new', 24),
      countZendeskTicketsOlderThanHours(openQuery, 24),
      countZendeskTicketsOlderThanHours(inProgressQuery, 48),
      countZendeskTicketsOlderThanHours(pendingQuery, 48),
    ])

  return {
    generatedAt: new Date().toISOString(),
    agentUrl: buildZendeskAgentUrl(),
    alerts: {
      newOver24Hours,
      openOver24Hours,
      inProgressOver48Hours,
      pendingOver48Hours,
    },
  }
}

async function fetchZendeskSupportAlertTicketsSnapshot(limitPerBucket = 100) {
  ensureZendeskConfiguration()

  const [statusContext, orderNumberFieldId] = await Promise.all([
    fetchZendeskStatusContext(),
    resolveZendeskOrderNumberFieldId(),
  ])
  const {
    inProgressQuery,
    openCustomStatusQuery,
    pendingQuery,
  } = buildZendeskStatusQueries(statusContext)
  const openQuery = openCustomStatusQuery || 'type:ticket status:open'

  const [
    newOver24HoursRaw,
    openOver24HoursRaw,
    inProgressOver48HoursRaw,
    pendingOver48HoursRaw,
  ] = await Promise.all([
    fetchZendeskTicketsOlderThanHours('type:ticket status:new', 24, limitPerBucket),
    fetchZendeskTicketsOlderThanHours(openQuery, 24, limitPerBucket),
    fetchZendeskTicketsOlderThanHours(inProgressQuery, 48, limitPerBucket),
    fetchZendeskTicketsOlderThanHours(pendingQuery, 48, limitPerBucket),
  ])

  const userIds = new Set()
  const allRawTickets = [
    ...newOver24HoursRaw,
    ...openOver24HoursRaw,
    ...inProgressOver48HoursRaw,
    ...pendingOver48HoursRaw,
  ]

  allRawTickets.forEach((ticket) => {
    const requesterId = Number(ticket?.requester_id)
    const assigneeId = Number(ticket?.assignee_id)

    if (Number.isFinite(requesterId) && requesterId > 0) {
      userIds.add(requesterId)
    }

    if (Number.isFinite(assigneeId) && assigneeId > 0) {
      userIds.add(assigneeId)
    }
  })

  const usersById = await fetchZendeskUsersByIds([...userIds])
  const normalize = (ticket) =>
    normalizeZendeskSupportTicket(
      ticket,
      statusContext,
      usersById,
      orderNumberFieldId,
    )

  return {
    generatedAt: new Date().toISOString(),
    agentUrl: buildZendeskAgentUrl(),
    buckets: {
      newOver24Hours: newOver24HoursRaw.map(normalize),
      openOver24Hours: openOver24HoursRaw.map(normalize),
      inProgressOver48Hours: inProgressOver48HoursRaw.map(normalize),
      pendingOver48Hours: pendingOver48HoursRaw.map(normalize),
    },
  }
}

async function fetchZendeskSupportTicketsSnapshot(limit = 50) {
  ensureZendeskConfiguration()

  const [statusContext, orderNumberFieldId] = await Promise.all([
    fetchZendeskStatusContext(),
    resolveZendeskOrderNumberFieldId(),
  ])
  const tickets = await fetchZendeskSearchTickets('type:ticket status<solved', {
    page: 1,
    perPage: toBoundedInteger(limit, 10, 100, 50),
    sortBy: 'updated_at',
    sortOrder: 'desc',
  })

  const userIds = new Set()

  tickets.forEach((ticket) => {
    const requesterId = Number(ticket?.requester_id)
    const assigneeId = Number(ticket?.assignee_id)

    if (Number.isFinite(requesterId) && requesterId > 0) {
      userIds.add(requesterId)
    }

    if (Number.isFinite(assigneeId) && assigneeId > 0) {
      userIds.add(assigneeId)
    }
  })

  const usersById = await fetchZendeskUsersByIds([...userIds])
  const normalizedTickets = tickets.map((ticket) =>
    normalizeZendeskSupportTicket(
      ticket,
      statusContext,
      usersById,
      orderNumberFieldId,
    ),
  )

  return {
    generatedAt: new Date().toISOString(),
    agentUrl: buildZendeskAgentUrl(),
    tickets: normalizedTickets,
  }
}

async function fetchZendeskTicketConversation(ticketId) {
  ensureZendeskConfiguration()

  const [statusContext, orderNumberFieldId, ticketPayload, commentsPayload] = await Promise.all([
    fetchZendeskStatusContext(),
    resolveZendeskOrderNumberFieldId(),
    callZendeskApi(`/tickets/${encodeURIComponent(ticketId)}.json`, {
      method: 'GET',
    }),
    callZendeskApi(`/tickets/${encodeURIComponent(ticketId)}/comments.json`, {
      method: 'GET',
    }),
  ])

  const ticket = ticketPayload?.ticket ?? null

  if (!ticket) {
    throw {
      status: 404,
      message: 'Zendesk ticket was not found.',
    }
  }

  const comments = Array.isArray(commentsPayload?.comments)
    ? commentsPayload.comments
    : []
  const userIds = new Set()
  const requesterId = Number(ticket?.requester_id)
  const assigneeId = Number(ticket?.assignee_id)

  if (Number.isFinite(requesterId) && requesterId > 0) {
    userIds.add(requesterId)
  }

  if (Number.isFinite(assigneeId) && assigneeId > 0) {
    userIds.add(assigneeId)
  }

  comments.forEach((comment) => {
    const authorId = Number(comment?.author_id)

    if (Number.isFinite(authorId) && authorId > 0) {
      userIds.add(authorId)
    }
  })

  const usersById = await fetchZendeskUsersByIds([...userIds])
  const normalizedTicket = normalizeZendeskSupportTicket(
    ticket,
    statusContext,
    usersById,
    orderNumberFieldId,
  )
  const normalizedComments = comments
    .map((comment) => {
      const authorId = Number(comment?.author_id)
      const author = usersById.get(authorId)
      const plainBody = String(comment?.plain_body ?? '').trim()
      const fallbackBody = String(comment?.body ?? comment?.html_body ?? '').trim()

      return {
        id: Number(comment?.id),
        authorName: String(author?.name ?? 'Unknown user'),
        createdAt: String(comment?.created_at ?? ''),
        body: plainBody || fallbackBody,
        public: Boolean(comment?.public),
      }
    })
    .filter((comment) => Number.isFinite(comment.id) && comment.id > 0)
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )

  return {
    generatedAt: new Date().toISOString(),
    ticket: normalizedTicket,
    comments: normalizedComments,
  }
}

async function fetchZendeskTicketsOlderThanHours(query, thresholdHours, limit = 100) {
  const maxPages = 40
  const perPage = 100
  const cutoffMs = Date.now() - thresholdHours * 60 * 60 * 1000
  let page = 1
  const tickets = []

  while (page <= maxPages && tickets.length < limit) {
    const pageResults = await fetchZendeskSearchTickets(query, {
      page,
      perPage,
      sortBy: 'created_at',
      sortOrder: 'asc',
    })

    if (pageResults.length === 0) {
      break
    }

    let shouldStop = false

    for (const ticket of pageResults) {
      const createdAtMs = Date.parse(String(ticket?.created_at ?? ''))

      if (!Number.isFinite(createdAtMs)) {
        continue
      }

      if (createdAtMs <= cutoffMs) {
        tickets.push(ticket)

        if (tickets.length >= limit) {
          break
        }
      } else {
        shouldStop = true
        break
      }
    }

    if (shouldStop || pageResults.length < perPage || tickets.length >= limit) {
      break
    }

    page += 1
  }

  return tickets.sort(
    (left, right) =>
      new Date(String(right?.updated_at ?? '')).getTime() -
      new Date(String(left?.updated_at ?? '')).getTime(),
  )
}

async function createZendeskSupportTicket(input) {
  ensureZendeskConfiguration()

  const ticketPayload = {
    ticket: {
      subject: input.subject,
      comment: {
        body: input.description,
      },
    },
  }

  if (input.priority) {
    ticketPayload.ticket.priority = input.priority
  }

  if (input.requesterName && input.requesterEmail) {
    ticketPayload.ticket.requester = {
      name: input.requesterName,
      email: input.requesterEmail,
    }
  }

  const payload = await callZendeskApi('/tickets.json', {
    method: 'POST',
    body: JSON.stringify(ticketPayload),
  })
  const ticket = payload?.ticket ?? null

  if (!ticket) {
    throw {
      status: 502,
      message: 'Zendesk create ticket response did not include a ticket.',
    }
  }

  const [statusContext, orderNumberFieldId] = await Promise.all([
    fetchZendeskStatusContext(),
    resolveZendeskOrderNumberFieldId(),
  ])
  const requesterId = Number(ticket?.requester_id)
  const assigneeId = Number(ticket?.assignee_id)
  const userIds = [requesterId, assigneeId].filter(
    (id) => Number.isFinite(id) && id > 0,
  )
  const usersById = await fetchZendeskUsersByIds(userIds)

  return {
    ticket: normalizeZendeskSupportTicket(
      ticket,
      statusContext,
      usersById,
      orderNumberFieldId,
    ),
  }
}

async function fetchZendeskStatusContext() {
  const customStatuses = await fetchZendeskCustomStatuses()

  return {
    customStatuses,
    customStatusById: buildZendeskCustomStatusMap(customStatuses),
    inProgressCustomStatusId:
      resolveZendeskCustomStatusId(customStatuses, 'In Progress', 'open') ||
      resolveZendeskCustomStatusId(customStatuses, 'In Progress'),
    openCustomStatusId:
      resolveZendeskCustomStatusId(customStatuses, 'Open', 'open') ||
      resolveZendeskCustomStatusId(customStatuses, 'Open'),
    pendingCustomStatusId:
      resolveZendeskCustomStatusId(customStatuses, 'Pending', 'pending') ||
      resolveZendeskCustomStatusId(customStatuses, 'Pending'),
    solvedCustomStatusId:
      resolveZendeskCustomStatusId(customStatuses, 'Solved', 'solved') ||
      resolveZendeskCustomStatusId(customStatuses, 'Solved'),
  }
}

function buildZendeskStatusQueries(statusContext) {
  const inProgressQuery = statusContext.inProgressCustomStatusId
    ? buildZendeskCustomStatusCountQuery(statusContext.inProgressCustomStatusId)
    : 'type:ticket status:hold'
  const openCustomStatusQuery = statusContext.openCustomStatusId
    ? buildZendeskCustomStatusCountQuery(statusContext.openCustomStatusId)
    : null

  return {
    openTotalQuery: 'type:ticket status:open',
    inProgressQuery,
    openCustomStatusQuery,
    pendingQuery: statusContext.pendingCustomStatusId
      ? buildZendeskCustomStatusCountQuery(statusContext.pendingCustomStatusId)
      : 'type:ticket status:pending',
    solvedQuery: statusContext.solvedCustomStatusId
      ? buildZendeskCustomStatusCountQuery(statusContext.solvedCustomStatusId)
      : 'type:ticket status:solved',
  }
}

function buildZendeskCustomStatusMap(customStatuses) {
  const map = new Map()

  customStatuses.forEach((entry) => {
    const id = Number(entry?.id)

    if (!Number.isFinite(id) || id <= 0) {
      return
    }

    map.set(id, {
      id,
      agentLabel: String(entry?.agentLabel ?? '').trim(),
      endUserLabel: String(entry?.endUserLabel ?? '').trim(),
      statusCategory: String(entry?.statusCategory ?? '').trim(),
    })
  })

  return map
}

async function countZendeskTicketsOlderThanHours(query, thresholdHours) {
  const maxPages = 40
  const perPage = 100
  const cutoffMs = Date.now() - thresholdHours * 60 * 60 * 1000
  let page = 1
  let total = 0

  while (page <= maxPages) {
    const pageResults = await fetchZendeskSearchTickets(query, {
      page,
      perPage,
      sortBy: 'created_at',
      sortOrder: 'asc',
    })

    if (pageResults.length === 0) {
      break
    }

    let shouldStop = false

    for (const ticket of pageResults) {
      const createdAtMs = Date.parse(String(ticket?.created_at ?? ''))

      if (!Number.isFinite(createdAtMs)) {
        continue
      }

      if (createdAtMs <= cutoffMs) {
        total += 1
      } else {
        shouldStop = true
        break
      }
    }

    if (shouldStop || pageResults.length < perPage) {
      break
    }

    page += 1
  }

  return total
}

async function fetchZendeskSearchTickets(query, options = {}) {
  const page = toBoundedInteger(options.page, 1, 1000, 1)
  const perPage = toBoundedInteger(options.perPage, 1, 100, 50)
  const sortBy = String(options.sortBy ?? 'updated_at').trim() || 'updated_at'
  const sortOrder =
    String(options.sortOrder ?? 'desc').trim().toLowerCase() === 'asc'
      ? 'asc'
      : 'desc'
  const searchParams = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(perPage),
    sort_by: sortBy,
    sort_order: sortOrder,
  })
  const payload = await callZendeskApi(`/search.json?${searchParams.toString()}`, {
    method: 'GET',
  })
  const results = Array.isArray(payload?.results) ? payload.results : []

  return results.filter((result) => {
    const resultType = String(result?.result_type ?? 'ticket').toLowerCase()
    return resultType === 'ticket'
  })
}

async function fetchZendeskUsersByIds(userIds) {
  const normalizedIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
  const usersById = new Map()

  if (normalizedIds.length === 0) {
    return usersById
  }

  const chunkSize = 100

  for (let start = 0; start < normalizedIds.length; start += chunkSize) {
    const chunk = normalizedIds.slice(start, start + chunkSize)
    const payload = await callZendeskApi(
      `/users/show_many.json?ids=${encodeURIComponent(chunk.join(','))}`,
      {
        method: 'GET',
      },
    )
    const users = Array.isArray(payload?.users) ? payload.users : []

    users.forEach((entry) => {
      const id = Number(entry?.id)

      if (!Number.isFinite(id) || id <= 0) {
        return
      }

      usersById.set(id, {
        id,
        name: String(entry?.name ?? '').trim() || 'Unknown user',
        email: String(entry?.email ?? '').trim(),
      })
    })
  }

  return usersById
}

function normalizeZendeskSupportTicket(
  ticket,
  statusContext,
  usersById,
  orderNumberFieldId = null,
) {
  const id = Number(ticket?.id)
  const requesterId = Number(ticket?.requester_id)
  const assigneeId = Number(ticket?.assignee_id)
  const requester = usersById.get(requesterId)
  const assignee = usersById.get(assigneeId)
  const statusLabel = resolveZendeskTicketStatusLabel(ticket, statusContext)
  const orderNumber = resolveZendeskOrderNumber(ticket, orderNumberFieldId)

  return {
    id: Number.isFinite(id) ? id : 0,
    subject: String(ticket?.subject ?? '').trim() || `Ticket #${id}`,
    orderNumber,
    status: String(ticket?.status ?? '').trim().toLowerCase(),
    statusLabel,
    priority: String(ticket?.priority ?? '').trim().toLowerCase() || 'normal',
    requesterName: String(requester?.name ?? 'Unknown requester'),
    assigneeName: String(assignee?.name ?? 'Unassigned'),
    createdAt: String(ticket?.created_at ?? ''),
    updatedAt: String(ticket?.updated_at ?? ''),
    url: buildZendeskTicketUrl(id),
  }
}

function resolveZendeskTicketStatusLabel(ticket, statusContext) {
  const customStatusId = Number(ticket?.custom_status_id)

  if (Number.isFinite(customStatusId) && customStatusId > 0) {
    const customStatus = statusContext.customStatusById.get(customStatusId)

    if (customStatus?.agentLabel) {
      return customStatus.agentLabel
    }
  }

  return formatZendeskStatusLabel(ticket?.status)
}

function formatZendeskStatusLabel(statusValue) {
  const normalized = normalizeLookupValue(statusValue)

  if (!normalized) {
    return 'Unknown'
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function buildZendeskTicketUrl(ticketId) {
  const origin = buildZendeskOrigin()

  if (!origin || !Number.isFinite(Number(ticketId)) || Number(ticketId) <= 0) {
    return null
  }

  return `${origin}/agent/tickets/${Number(ticketId)}`
}

function resolveZendeskOrderNumber(ticket, orderNumberFieldId) {
  const normalizedFieldId = Number(orderNumberFieldId)

  if (!Number.isFinite(normalizedFieldId) || normalizedFieldId <= 0) {
    return null
  }

  const customFields = Array.isArray(ticket?.custom_fields) ? ticket.custom_fields : []
  const matchingField = customFields.find(
    (entry) => Number(entry?.id) === normalizedFieldId,
  )
  const rawValue = matchingField?.value

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return String(rawValue)
  }

  if (typeof rawValue === 'string') {
    const trimmedValue = rawValue.trim()
    return trimmedValue || null
  }

  return null
}

async function resolveZendeskOrderNumberFieldId() {
  const now = Date.now()

  if (zendeskOrderNumberFieldPromise) {
    return zendeskOrderNumberFieldPromise
  }

  if (zendeskOrderNumberFieldExpiresAt > now) {
    return zendeskOrderNumberFieldId
  }

  zendeskOrderNumberFieldPromise = (async () => {
    try {
      const resolvedFieldId = await fetchZendeskOrderNumberFieldId()

      zendeskOrderNumberFieldId =
        Number.isFinite(Number(resolvedFieldId)) && Number(resolvedFieldId) > 0
          ? Number(resolvedFieldId)
          : null
      zendeskOrderNumberFieldExpiresAt = Date.now() + zendeskTicketFieldCacheTtlMs
      return zendeskOrderNumberFieldId
    } catch (error) {
      zendeskOrderNumberFieldId = null
      zendeskOrderNumberFieldExpiresAt = Date.now() + zendeskTicketFieldErrorCacheTtlMs
      console.warn('Unable to resolve Zendesk order-number field.', error)
      return null
    } finally {
      zendeskOrderNumberFieldPromise = null
    }
  })()

  return zendeskOrderNumberFieldPromise
}

async function fetchZendeskOrderNumberFieldId() {
  const perPage = 100
  const maxPages = 10

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await callZendeskApi(
      `/ticket_fields.json?page=${page}&per_page=${perPage}`,
      {
        method: 'GET',
      },
    )
    const ticketFields = Array.isArray(payload?.ticket_fields)
      ? payload.ticket_fields
      : []
    const orderNumberField = ticketFields.find(isZendeskOrderNumberTicketField)

    if (orderNumberField) {
      const id = Number(orderNumberField?.id)
      return Number.isFinite(id) && id > 0 ? id : null
    }

    if (!payload?.next_page || ticketFields.length < perPage) {
      break
    }
  }

  return null
}

function isZendeskOrderNumberTicketField(ticketField) {
  const candidateLabels = [
    ticketField?.title,
    ticketField?.raw_title,
    ticketField?.title_in_portal,
    ticketField?.raw_title_in_portal,
    ticketField?.tag,
    ticketField?.key,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  if (candidateLabels.length === 0) {
    return false
  }

  return candidateLabels.some((label) => {
    const rawLabel = label.toLowerCase()
    const normalizedLabel = normalizeLookupValue(label)

    return (
      /\border\s*#/.test(rawLabel) ||
      /\border\s*(number|num|no|nr)\b/.test(rawLabel) ||
      normalizedLabel.includes('order number') ||
      normalizedLabel.includes('order num') ||
      normalizedLabel.includes('order no')
    )
  })
}

async function fetchZendeskCustomStatuses() {
  const apiBaseUrl = buildZendeskApiBaseUrl()

  if (!apiBaseUrl) {
    return []
  }

  const response = await fetch(`${apiBaseUrl}/custom_statuses.json`, {
    method: 'GET',
    headers: {
      Authorization: buildZendeskAuthorizationHeader(),
      'Content-Type': 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    // Custom statuses can be unavailable by plan/permissions; fallback to status queries.
    if ([401, 403, 404].includes(response.status)) {
      return []
    }

    throw {
      status: 502,
      message: `Zendesk custom status request failed with status ${response.status}.`,
    }
  }

  return (Array.isArray(payload?.custom_statuses) ? payload.custom_statuses : [])
    .map((entry) => ({
      id: Number(entry?.id),
      agentLabel: String(entry?.agent_label ?? entry?.name ?? '').trim(),
      endUserLabel: String(entry?.end_user_label ?? '').trim(),
      statusCategory: String(entry?.status_category ?? '').trim(),
    }))
    .filter((entry) => Number.isFinite(entry.id) && entry.id > 0)
}

function resolveZendeskCustomStatusId(customStatuses, label, statusCategory = null) {
  const normalizedTarget = normalizeLookupValue(label)

  if (!normalizedTarget || !Array.isArray(customStatuses) || customStatuses.length === 0) {
    return null
  }

  const filteredStatuses = statusCategory
    ? customStatuses.filter(
        (entry) =>
          normalizeLookupValue(entry?.statusCategory) ===
          normalizeLookupValue(statusCategory),
      )
    : customStatuses

  const exactMatch = filteredStatuses.find((entry) => {
    const candidateLabels = [entry?.agentLabel, entry?.endUserLabel]
      .map((value) => normalizeLookupValue(value))
      .filter(Boolean)

    return candidateLabels.includes(normalizedTarget)
  })

  if (exactMatch) {
    return Number(exactMatch.id)
  }

  const containsMatch = filteredStatuses.find((entry) => {
    const candidateLabels = [entry?.agentLabel, entry?.endUserLabel]
      .map((value) => normalizeLookupValue(value))
      .filter(Boolean)

    return candidateLabels.some((candidate) => candidate.includes(normalizedTarget))
  })

  return containsMatch ? Number(containsMatch.id) : null
}

function buildZendeskCustomStatusCountQuery(customStatusId) {
  return `type:ticket custom_status_id:${Number(customStatusId)}`
}

function ensureMondayConfiguration() {
  if (!mondayApiToken) {
    throw {
      status: 500,
      message: 'Missing MONDAY_API_TOKEN in environment configuration.',
    }
  }

  if (!mondayBoardId) {
    throw {
      status: 500,
      message: 'Missing MONDAY_BOARD_ID in environment configuration.',
    }
  }
}

function ensureZendeskConfiguration() {
  if (!zendeskApiToken) {
    throw {
      status: 500,
      message: 'Missing ZENDESK_API_TOKEN in environment configuration.',
    }
  }

  if (!buildZendeskApiBaseUrl()) {
    throw {
      status: 500,
      message: 'Missing or invalid ZENDESK_URL in environment configuration.',
    }
  }
}

function buildZendeskOrigin() {
  const input = String(zendeskUrl ?? '').trim()

  if (!input) {
    return null
  }

  try {
    return new URL(input).origin
  } catch {
    return null
  }
}

function buildZendeskApiBaseUrl() {
  const origin = buildZendeskOrigin()
  return origin ? `${origin}/api/v2` : null
}

function buildZendeskAgentUrl() {
  const origin = buildZendeskOrigin()
  return origin ? `${origin}/agent` : null
}

async function callZendeskApi(path, options = {}) {
  const apiBaseUrl = buildZendeskApiBaseUrl()

  if (!apiBaseUrl) {
    throw {
      status: 500,
      message: 'Missing or invalid ZENDESK_URL in environment configuration.',
    }
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'GET',
    ...options,
    headers: {
      Authorization: buildZendeskAuthorizationHeader(),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const rawMessage =
      String(payload?.description || payload?.error || '').trim() ||
      `Zendesk API request failed with status ${response.status}.`
    const message =
      rawMessage === 'invalid_token' && !zendeskEmail
        ? 'Zendesk rejected ZENDESK_API_TOKEN. If this is an API token, also set ZENDESK_EMAIL.'
        : rawMessage

    throw {
      status: 502,
      message,
    }
  }

  return payload
}

async function fetchZendeskTicketCount(query) {
  const payload = await callZendeskApi(
    `/search/count.json?query=${encodeURIComponent(query)}`,
    {
      method: 'GET',
    },
  )

  const numericCount =
    Number(payload?.count?.value ?? payload?.count ?? payload?.total ?? 0)

  return Number.isFinite(numericCount) && numericCount >= 0
    ? Math.round(numericCount)
    : 0
}

function buildZendeskAuthorizationHeader() {
  if (zendeskEmail) {
    const encodedCredentials = Buffer.from(
      `${zendeskEmail}/token:${zendeskApiToken}`,
    ).toString('base64')

    return `Basic ${encodedCredentials}`
  }

  return `Bearer ${zendeskApiToken}`
}

async function callMondayGraphql(query, variables) {
  const response = await fetch(mondayApiUrl, {
    method: 'POST',
    headers: {
      Authorization: mondayApiToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Monday API request failed with status ${response.status}.`,
    }
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw {
      status: 502,
      message: payload.errors[0]?.message ?? 'Monday API returned an error.',
    }
  }

  return payload?.data ?? {}
}

function detectMondayColumns(items) {
  const sampleItems = items.slice(0, 50)
  const columns = []
  const seen = new Set()

  sampleItems.forEach((item) => {
    const values = Array.isArray(item?.column_values) ? item.column_values : []

    values.forEach((value) => {
      const id = String(value?.id ?? '')

      if (!id || seen.has(id)) {
        return
      }

      seen.add(id)
      columns.push({
        id,
        title: String(value?.column?.title ?? ''),
        type: String(value?.type ?? ''),
      })
    })
  })

  const statusColumnId = pickColumnId(
    columns,
    ['design', 'stage', 'state'],
    ['status', 'color'],
  )
  const readyColumnId = pickColumnId(columns, ['ready'], ['status', 'color'])
  const shipDateColumnId = pickColumnId(
    columns,
    ['ship date', 'date shipped', 'shipped'],
    ['date', 'timeline'],
  )
  const leadTimeColumnId = pickColumnId(
    columns,
    ['lead time', 'leadtime', 'lead', 'production time'],
    ['numbers', 'numeric', 'text', 'long-text'],
    ['date', 'timeline'],
  )
  const dueDateColumnId = pickColumnId(
    columns,
    ['ready by', 'need by', 'due', 'ship', 'delivery', 'target', 'eta', 'lead time'],
    ['date', 'timeline'],
  )
  let orderDateColumnId = pickColumnId(
    columns,
    ['order date', 'ordered', 'po date', 'received', 'start'],
    ['date', 'timeline'],
  )

  if (orderDateColumnId && orderDateColumnId === dueDateColumnId) {
    orderDateColumnId = null
  }

  const progressStatusColumns = mondayProgressStatusConfig
    .map((config) => ({
      key: config.key,
      weight: config.weight,
      columnId: pickColumnId(columns, config.titleKeywords, ['status', 'color']),
    }))
    .filter((entry) => Boolean(entry.columnId) && entry.weight >= 0)

  return {
    statusColumnId,
    readyColumnId,
    shipDateColumnId,
    leadTimeColumnId,
    dueDateColumnId,
    orderDateColumnId,
    progressStatusColumns,
  }
}

function pickColumnId(columns, keywords, preferredTypes = [], disallowedTypes = []) {
  let bestId = null
  let bestScore = 0

  columns.forEach((column) => {
    if (disallowedTypes.includes(column.type)) {
      return
    }

    const haystack = normalizeLookupValue(`${column.title} ${column.id}`)
    let score = 0

    keywords.forEach((keyword) => {
      const normalizedKeyword = normalizeLookupValue(keyword)

      if (haystack.includes(normalizedKeyword)) {
        score += normalizedKeyword.length + 3
      }
    })

    if (preferredTypes.includes(column.type)) {
      score += 4
    }

    if (score > bestScore) {
      bestScore = score
      bestId = column.id
    }
  })

  if (bestScore < 6) {
    return null
  }

  return bestId
}

function normalizeMondayOrder(item, columnMap) {
  const columnValues = Array.isArray(item?.column_values) ? item.column_values : []
  const statusColumn =
    findColumnById(columnValues, columnMap.statusColumnId) ||
    findColumnByKeywords(columnValues, ['design', 'stage'])
  const readyColumn =
    findColumnById(columnValues, columnMap.readyColumnId) ||
    findColumnByKeywords(columnValues, ['ready'])
  const shipDateColumn =
    findColumnById(columnValues, columnMap.shipDateColumnId) ||
    findColumnByKeywords(columnValues, ['ship date', 'shipped'])
  const leadTimeColumn =
    findColumnById(columnValues, columnMap.leadTimeColumnId) ||
    findColumnByKeywords(columnValues, ['lead'])
  const dueDateColumn =
    findColumnById(columnValues, columnMap.dueDateColumnId) ||
    findColumnByKeywords(columnValues, ['due', 'ready', 'ship'])
  const orderDateColumn =
    findColumnById(columnValues, columnMap.orderDateColumnId) ||
    findColumnByKeywords(columnValues, ['order date', 'ordered'])

  const stageLabel = readTextFromColumn(statusColumn) || 'Unspecified'
  const readyLabel = readTextFromColumn(readyColumn)
  const leadTimeDays = parseLeadTimeDays(
    readTextFromColumn(leadTimeColumn),
    leadTimeColumn?.value,
  )
  const shippedAt = parseDateFromColumn(shipDateColumn)
  const directDueDate = parseDateFromColumn(dueDateColumn)
  const orderDate = parseDateFromColumn(orderDateColumn) || parseDateValue(item?.created_at)
  const computedDueDate =
    orderDate && Number.isFinite(leadTimeDays)
      ? addDaysToIsoDate(orderDate, Number(leadTimeDays))
      : null
  const effectiveDueDate = directDueDate || computedDueDate
  const daysUntilDue = effectiveDueDate
    ? differenceInDaysFromToday(effectiveDueDate)
    : null
  const progressPercent = calculateProgressPercent(
    columnValues,
    columnMap.progressStatusColumns,
  )
  const isReady = isCompletedStatus(readyLabel)
  const isDone = Boolean(shippedAt)
  const statusLabel = buildWorkflowStatusLabel({
    isDone,
    isReady,
    progressPercent,
    stageLabel,
  })
  const isLate = !isDone && typeof daysUntilDue === 'number' ? daysUntilDue < 0 : false
  const daysLate = isLate && typeof daysUntilDue === 'number' ? Math.abs(daysUntilDue) : 0

  return {
    id: String(item?.id ?? ''),
    name: String(item?.name ?? 'Untitled order'),
    groupTitle: String(item?.group?.title ?? 'Ungrouped'),
    statusLabel,
    stageLabel,
    readyLabel,
    leadTimeDays,
    progressPercent,
    orderDate,
    shippedAt,
    dueDate: directDueDate,
    computedDueDate,
    effectiveDueDate,
    daysUntilDue,
    isDone,
    isLate,
    daysLate,
    updatedAt: parseDateValue(item?.updated_at),
    itemUrl: buildMondayItemUrl(item?.id),
  }
}

function findColumnById(columnValues, columnId) {
  if (!columnId) {
    return null
  }

  return columnValues.find((columnValue) => columnValue?.id === columnId) ?? null
}

function findColumnByKeywords(columnValues, keywords) {
  const normalizedKeywords = keywords.map((keyword) => normalizeLookupValue(keyword))

  return (
    columnValues.find((columnValue) => {
      const haystack = normalizeLookupValue(
        `${columnValue?.column?.title ?? ''} ${columnValue?.id ?? ''}`,
      )

      return normalizedKeywords.some((keyword) => haystack.includes(keyword))
    }) ?? null
  )
}

function normalizeLookupValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseJsonValue(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

function readTextFromColumn(columnValue) {
  if (!columnValue) {
    return ''
  }

  const textValue = String(columnValue.text ?? '').trim()

  if (textValue) {
    return textValue
  }

  const parsed = parseJsonValue(columnValue.value)

  if (typeof parsed?.label === 'string') {
    return parsed.label
  }

  if (typeof parsed?.text === 'string') {
    return parsed.text
  }

  return ''
}

function calculateProgressPercent(columnValues, progressStatusColumns) {
  const usableColumns = Array.isArray(progressStatusColumns)
    ? progressStatusColumns.filter((column) => Number(column.weight) > 0 && column.columnId)
    : []

  if (usableColumns.length === 0) {
    return null
  }

  const totalWeight = usableColumns.reduce(
    (total, column) => total + Number(column.weight),
    0,
  )

  if (totalWeight <= 0) {
    return null
  }

  let earnedWeight = 0

  usableColumns.forEach((column) => {
    const value = findColumnById(columnValues, column.columnId)
    const label = readTextFromColumn(value)

    if (isCompletedStatus(label)) {
      earnedWeight += Number(column.weight)
    }
  })

  return Math.round((earnedWeight / totalWeight) * 100)
}

function buildWorkflowStatusLabel({ isDone, isReady, progressPercent, stageLabel }) {
  if (isDone) {
    return 'Shipped'
  }

  if (isReady) {
    return 'Ready / Not Shipped'
  }

  if (typeof progressPercent === 'number') {
    return `In Progress (${progressPercent}%)`
  }

  if (stageLabel && stageLabel !== 'Unspecified') {
    return `In ${stageLabel}`
  }

  return 'Not Started'
}

function parseLeadTimeDays(textValue, rawValue) {
  const parsed = parseJsonValue(rawValue)
  const candidates = [
    String(textValue ?? '').trim(),
    typeof parsed?.number === 'number' ? String(parsed.number) : '',
    typeof parsed?.number === 'string' ? parsed.number : '',
    typeof parsed?.text === 'string' ? parsed.text : '',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().trim()

    if (/\d{4}-\d{2}-\d{2}/.test(normalized)) {
      continue
    }

    const hasUnit = /(day|week|month|wk|mo)/.test(normalized)
    const isNumericOnly = /^-?\d+(\.\d+)?$/.test(normalized)

    if (!hasUnit && !isNumericOnly) {
      continue
    }

    const match = candidate.match(/-?\d+(\.\d+)?/)

    if (!match) {
      continue
    }

    let days = Number(match[0])

    if (!Number.isFinite(days) || days <= 0) {
      continue
    }

    if (normalized.includes('week')) {
      days *= 7
    } else if (normalized.includes('month')) {
      days *= 30
    }

    if (!hasUnit && days > 365) {
      continue
    }

    if (days > 3650) {
      continue
    }

    return Math.round(days)
  }

  return null
}

function parseDateFromColumn(columnValue) {
  if (!columnValue) {
    return null
  }

  const textDate = parseDateValue(columnValue.text)

  if (textDate) {
    return textDate
  }

  const parsed = parseJsonValue(columnValue.value)

  const parsedCandidates = [parsed?.date, parsed?.to, parsed?.from]

  for (const candidate of parsedCandidates) {
    const dateValue = parseDateValue(candidate)

    if (dateValue) {
      return dateValue
    }
  }

  return null
}

function parseDateValue(value) {
  const raw = String(value ?? '').trim()

  if (!raw) {
    return null
  }

  const isoDateMatch = raw.match(/\d{4}-\d{2}-\d{2}/)

  if (isoDateMatch) {
    return isoDateMatch[0]
  }

  const parsedDate = new Date(raw)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  return formatIsoDate(parsedDate)
}

function formatIsoDate(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysToIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const targetDate = new Date(year, month - 1, day)
  targetDate.setDate(targetDate.getDate() + days)

  return formatIsoDate(targetDate)
}

function differenceInDaysFromToday(isoDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [year, month, day] = isoDate.split('-').map(Number)
  const compareDate = new Date(year, month - 1, day)
  compareDate.setHours(0, 0, 0, 0)

  return Math.round((compareDate.getTime() - today.getTime()) / 86400000)
}

function isCompletedStatus(statusLabel) {
  const normalized = normalizeLookupValue(statusLabel)

  if (!normalized) {
    return false
  }

  if (normalized.includes('not ready')) {
    return false
  }

  return [
    'completed',
    'complete',
    'closed',
    'delivered',
    'shipped',
    'done',
    'paid in full',
  ].some((keyword) => normalized.includes(keyword))
}

function buildMondayItemUrl(itemId) {
  if (!mondayBoardUrl || !itemId) {
    return null
  }

  return `${mondayBoardUrl.replace(/\/+$/, '')}/pulses/${String(itemId)}`
}

function buildBucketCounts(orders, key) {
  const bucketMap = new Map()

  orders.forEach((order) => {
    const value = String(order[key] ?? '').trim() || 'Unspecified'
    bucketMap.set(value, (bucketMap.get(value) ?? 0) + 1)
  })

  return [...bucketMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function compareOrdersByUrgency(left, right) {
  const leftRank = left.isLate
    ? 0
    : left.isDone
      ? 3
      : left.effectiveDueDate
        ? 1
        : 2
  const rightRank = right.isLate
    ? 0
    : right.isDone
      ? 3
      : right.effectiveDueDate
        ? 1
        : 2

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (leftRank === 0) {
    return right.daysLate - left.daysLate
  }

  if (leftRank === 1) {
    return Number(left.daysUntilDue ?? 0) - Number(right.daysUntilDue ?? 0)
  }

  return left.name.localeCompare(right.name)
}

function validateWorkerInput(input, path = 'worker') {
  const fullName = String(input?.fullName ?? '').trim()
  const role = String(input?.role ?? '').trim()
  const email = String(input?.email ?? '').trim()
  const phone = String(input?.phone ?? '').trim()
  const hourlyRate = Number(input?.hourlyRate)

  if (!fullName) {
    throw {
      status: 400,
      message: `${path}.fullName is required.`,
    }
  }

  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    throw {
      status: 400,
      message: `${path}.hourlyRate must be a positive number.`,
    }
  }

  const now = new Date().toISOString()

  return {
    id: randomUUID(),
    fullName,
    role,
    email,
    phone,
    hourlyRate,
    createdAt: now,
    updatedAt: now,
  }
}

function validateEntryInput(input, date, path = 'entry') {
  const fields = validateEntryFields(input, date, path)

  return {
    id: randomUUID(),
    ...fields,
    createdAt: new Date().toISOString(),
  }
}

function validateEntryFields(input, date, path = 'entry') {
  const normalizedDate = String(date ?? '').trim()
  const workerId = String(input?.workerId ?? '').trim()
  const stageId = String(input?.stageId ?? '').trim()
  const jobName = String(input?.jobName ?? '').trim()
  const hours = Number(input?.hours)
  const notes = String(input?.notes ?? '').trim()

  if (!normalizedDate) {
    throw {
      status: 400,
      message: 'date is required.',
    }
  }

  if (!workerId) {
    throw {
      status: 400,
      message: `${path}.workerId is required.`,
    }
  }

  if (!jobName) {
    throw {
      status: 400,
      message: `${path}.jobName is required.`,
    }
  }

  if (!Number.isFinite(hours) || hours <= 0) {
    throw {
      status: 400,
      message: `${path}.hours must be a positive number.`,
    }
  }

  const fields = {
    workerId,
    date: normalizedDate,
    jobName,
    hours,
    notes,
  }

  if (stageId) {
    fields.stageId = stageId
  }

  return fields
}

function normalizeStageName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toBoundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  if (parsed < min) {
    return min
  }

  if (parsed > max) {
    return max
  }

  return parsed
}
