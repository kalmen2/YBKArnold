// Live round-trip harness.
//
// Runs the REAL refresh pipeline (orders-unified-service) against LIVE Monday
// boards, but writes into a sandbox clone of the orders database, so nothing
// here can damage production Arnold data.
//
// Every Monday edit it makes is recorded and reverted at the end, so the boards
// finish in exactly the state they started in.

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { createMondaySnapshotService } from '../../src/services/monday-snapshot-service.mjs'
import { createOrdersUnifiedService } from '../../src/services/orders-unified-service.mjs'
import { createMondayOrderPersistenceService } from '../../src/services/monday-order-persistence-service.mjs'
import { createMongoCollectionsService } from '../../src/services/mongo-collections-service.mjs'
import { createMondayDashboardService } from '../../src/services/monday-dashboard-service.mjs'
import { normalizeLookupToken } from '../../src/utils/value-utils.mjs'

const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
export const env = Object.fromEntries(envText.split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

// Point the orders domain at the sandbox clone before anything reads config.
process.env.MONGODB_DB_ORDERS = 'arnold_system_orders_sandbox'
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v

export const MONDAY_URL = env.MONDAY_API_URL || 'https://api.monday.com/v2'

export async function gql(query, variables = {}) {
  const r = await fetch(MONDAY_URL, {
    method: 'POST',
    headers: { Authorization: env.MONDAY_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const p = await r.json()
  if (p.errors) throw new Error(JSON.stringify(p.errors))
  return p.data
}

// ---- Monday edit/revert bookkeeping -------------------------------------

const journal = []

export async function readColumn(itemId, columnId) {
  const d = await gql('query($id:[ID!],$c:[String!]){items(ids:$id){id name column_values(ids:$c){id text}}}',
    { id: [itemId], c: [columnId] })
  const item = d.items?.[0]
  return { name: item?.name ?? null, text: item?.column_values?.[0]?.text ?? '' }
}

export async function setColumn(itemId, boardId, columnId, value) {
  const before = await readColumn(itemId, columnId)
  journal.push({ kind: 'column', itemId, boardId, columnId, restoreTo: before.text })
  await gql('mutation($b:ID!,$i:ID!,$c:String!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:$c,value:$v){id}}',
    { b: boardId, i: itemId, c: columnId, v: value })
  return before.text
}

export async function setName(itemId, boardId, value) {
  const before = await readColumn(itemId, 'text9')
  journal.push({ kind: 'name', itemId, boardId, restoreTo: before.name })
  await gql('mutation($b:ID!,$i:ID!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:"name",value:$v){id}}',
    { b: boardId, i: itemId, v: value })
  return before.name
}

export async function revertAll() {
  let reverted = 0
  for (const entry of [...journal].reverse()) {
    if (entry.kind === 'column') {
      await gql('mutation($b:ID!,$i:ID!,$c:String!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:$c,value:$v){id}}',
        { b: entry.boardId, i: entry.itemId, c: entry.columnId, v: entry.restoreTo ?? '' })
    } else {
      await gql('mutation($b:ID!,$i:ID!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:"name",value:$v){id}}',
        { b: entry.boardId, i: entry.itemId, v: entry.restoreTo ?? '' })
    }
    reverted += 1
  }
  journal.length = 0
  return reverted
}

export function journalSize() { return journal.length }

// ---- Real refresh pipeline ----------------------------------------------

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
        subitems {
          id
          name
          created_at
          updated_at
          column_values { id type text value column { title } }
        }
      }
    }
  }
}
`

function buildMondayItemsPageQuery(columnIds) {
  const ids = Array.isArray(columnIds)
    ? columnIds
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0)
    : []

  if (ids.length === 0) {
    return mondayItemsPageQuery
  }

  const idsLiteral = `[${ids.map((id) => JSON.stringify(id)).join(', ')}]`

  return `
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
        column_values(ids: ${idsLiteral}) {
          id
          type
          text
          value
          column {
            title
          }
        }
        subitems {
          id
          name
          created_at
          updated_at
          column_values { id type text value column { title } }
        }
      }
    }
  }
}
`
}


const {
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
} = createMondayDashboardService({
  columnOverrides: {
    dueDateColumnId: env.MONDAY_DUE_DATE_COLUMN_ID || null,
    leadTimeColumnId: env.MONDAY_LEAD_TIME_COLUMN_ID || null,
    orderDateColumnId: env.MONDAY_ORDER_DATE_COLUMN_ID || null,
    shipDateColumnId: env.MONDAY_SHIP_DATE_COLUMN_ID || null,
  },
  mondayBoardUrl: env.MONDAY_BOARD_URL,
  normalizeLookupValue: normalizeLookupToken,
})

const mondayService = createMondaySnapshotService({
  ensureMondayConfiguration: () => {},
  mondayApiUrl: MONDAY_URL,
  mondayApiToken: env.MONDAY_API_TOKEN,
  mondayBoardId: env.MONDAY_BOARD_ID,
  mondayBoardUrl: env.MONDAY_BOARD_URL,
  mondayItemsPageQuery,
  buildMondayItemsPageQuery,
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
})

const mongoService = createMongoCollectionsService({
  mongoDbName: env.MONGODB_DB,
  mongoUri: env.MONGODB_URI,
})
const getCollections = () => mongoService.getCollections()

const { persistNewMondayOrders } = createMondayOrderPersistenceService({
  fetchMondayAssetDownloadInfo: mondayService.fetchMondayAssetDownloadInfo,
  getCollections,
  getReadOnlyCollections: () => mongoService.getReadOnlyCollections(),
  getOrderPhotosBucket: () => null,
  mondayBoardId: env.MONDAY_BOARD_ID,
  mondayShippedBoardId: env.MONDAY_SHIPPED_BOARD_ID,
  randomUUID,
})

const { refreshOrdersUnifiedCollection } = createOrdersUnifiedService({
  fetchMondayBoardItemsByIds: mondayService.fetchMondayBoardItemsByIds,
  fetchMondayBoardSelectedColumns: mondayService.fetchMondayBoardSelectedColumns,
  fetchMondayDashboardSnapshot: mondayService.fetchMondayDashboardSnapshot,
  getCollections,
  invalidateMondayBoardNamesCache: mondayService.invalidateMondayBoardNamesCache,
  mondayBoardId: env.MONDAY_BOARD_ID,
  mondayBoardUrl: env.MONDAY_BOARD_URL,
  mondayPreproductionBoardId: env.MONDAY_PREPRODUCTION_BOARD_ID || '1064270065',
  mondayPreproductionBoardUrl: null,
  mondayShippedBoardId: env.MONDAY_SHIPPED_BOARD_ID,
  mondayShippedBoardUrl: env.MONDAY_SHIPPED_BOARD_URL,
  persistNewMondayOrders,
  setDashboardSnapshotCache: () => {}, // no-op: never touch the production cache
})

export async function refresh(label) {
  mondayService.invalidateMondayBoardNamesCache()
  const started = Date.now()
  const summary = await refreshOrdersUnifiedCollection()
  console.log(`    refresh(${label}) ${((Date.now() - started) / 1000).toFixed(1)}s  merged=${summary?.mergedOrderCount ?? '?'}  warnings=${(summary?.warnings ?? []).length}`)
  return summary
}

export async function order(orderNumber) {
  const c = new MongoClient(env.MONGODB_URI)
  await c.connect()
  const d = await c.db('arnold_system_orders_sandbox').collection('orders')
    .findOne({ order_number: orderNumber, is_cancelled: { $ne: true }, is_deleted: { $ne: true } })
  await c.close()
  return d
}

export async function closeAll() {
  await mongoService.closeMongoConnections().catch(() => {})
}
