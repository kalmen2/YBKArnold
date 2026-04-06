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

const defaultTimesheetStageNames = [
  'Design',
  'Base/Form',
  'Build',
  'Sand or Lam',
  'Sealer',
  'Lacquer',
  'Ready',
  'Invoiced',
]

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

  if (!indexesPromise) {
    indexesPromise = Promise.all([
      workersCollection.createIndex({ id: 1 }, { unique: true }),
      entriesCollection.createIndex({ id: 1 }, { unique: true }),
      entriesCollection.createIndex({ workerId: 1 }),
      entriesCollection.createIndex({ stageId: 1 }),
      entriesCollection.createIndex({ date: -1 }),
      stagesCollection.createIndex({ id: 1 }, { unique: true }),
      stagesCollection.createIndex({ normalizedName: 1 }, { unique: true }),
    ]).then(async () => {
      await ensureDefaultStages(stagesCollection)
      await ensureStageSortOrder(stagesCollection)
    })
  }

  await indexesPromise

  return {
    database,
    workersCollection,
    entriesCollection,
    stagesCollection,
  }
}

async function ensureDefaultStages(stagesCollection) {
  const existingCount = await stagesCollection.countDocuments({}, { limit: 1 })

  if (existingCount > 0) {
    return
  }

  const now = new Date().toISOString()
  const defaults = defaultTimesheetStageNames.map((name, index) => ({
    id: randomUUID(),
    name,
    normalizedName: normalizeStageName(name),
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }))

  try {
    await stagesCollection.insertMany(defaults, { ordered: false })
  } catch (error) {
    if (Number(error?.code) !== 11000) {
      throw error
    }
  }
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

app.get('/api/health', async (_req, res, next) => {
  try {
    const { database } = await getCollections()
    await database.command({ ping: 1 })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.get('/api/dashboard/monday', async (_req, res, next) => {
  try {
    const snapshot = await fetchMondayDashboardSnapshot()
    res.json(snapshot)
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
