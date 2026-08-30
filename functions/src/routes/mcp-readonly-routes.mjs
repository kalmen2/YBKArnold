import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'

const MAX_RESULTS = 50
const READ_ONLY_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
const SENSITIVE_KEY = /(?:password|secret|token|credential|authorization|cookie|api[-_]?key|refresh|access[-_]?token|private[-_]?key|rawbody)/i

function toText(value, maximum = 240) {
  return String(value ?? '').trim().slice(0, maximum)
}

function toSafeJson(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toSafeJson)
  if (typeof value !== 'object') return value
  if (typeof value.toJSON === 'function' && Object.getPrototypeOf(value) !== Object.prototype) {
    return toSafeJson(value.toJSON())
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, child]) => [key, toSafeJson(child)]),
  )
}

function jsonResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(toSafeJson(value), null, 2) }],
  }
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function oauthRequiredResult(resourceMetadataUrl) {
  return {
    content: [{ type: 'text', text: 'Authentication required. Sign in to Arnold to continue.' }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadataUrl}", error="insufficient_scope", error_description="Sign in to Arnold to continue"`,
      ],
    },
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isPrivileged(principal) {
  return principal.role === 'admin' || principal.role === 'manager' || principal.isOwner
}

function allowedTypesFor(principal) {
  if (isPrivileged(principal) || principal.role === 'office_worker') {
    return new Set([
      'orders', 'quotes', 'customers', 'contacts', 'sales_reps', 'purchasing_items',
      'purchasing_transactions', 'workers', 'time_entries', 'stages', 'order_chats',
      'chat_threads', 'chat_messages', 'crm_orders', 'order_progress', 'alerts', 'dashboard_snapshots',
    ])
  }

  if (principal.role === 'sales_rep') {
    return new Set(['quotes', 'customers', 'contacts', 'sales_reps'])
  }

  if (principal.role === 'shop_worker') {
    return new Set(['orders', 'purchasing_items', 'order_chats', 'workers', 'stages'])
  }

  return new Set(['orders', 'purchasing_items', 'order_chats'])
}

function createRecordDefinitions(collections) {
  const ordersDatabase = collections.databasesByDomain?.orders
  const authDatabase = collections.databasesByDomain?.auth

  return {
    orders: {
      collection: collections.ordersUnifiedCollection,
      idFields: ['orderKey', 'canonical_order_id', 'monday_item_id', 'order_number'],
      searchFields: ['order_number', 'order_name', 'dealer_name', 'po_number', 'sales_rep', 'status'],
      sort: { updatedAt: -1 },
    },
    quotes: {
      collection: collections.crmQuotesCollection,
      idFields: ['id', 'sourceId', 'quoteNumber'],
      searchFields: ['quoteNumber', 'title', 'dealerName', 'dealerSourceId', 'status'],
      sort: { updatedAt: -1 },
    },
    crm_orders: {
      collection: collections.crmOrdersCollection,
      idFields: ['id', 'sourceId', 'orderNumber'],
      searchFields: ['orderNumber', 'title', 'dealerName', 'dealerSourceId', 'status'],
      sort: { updatedAt: -1 },
    },
    customers: {
      collection: collections.crmAccountsCollection,
      idFields: ['id', 'sourceId'],
      searchFields: ['name', 'companyName', 'email', 'phone', 'sourceId'],
      sort: { updatedAt: -1 },
    },
    contacts: {
      collection: collections.crmContactsCollection,
      idFields: ['id', 'sourceId'],
      searchFields: ['name', 'firstName', 'lastName', 'email', 'primaryEmail', 'phone', 'accountName'],
      sort: {updatedAt: -1 },
    },
    sales_reps: {
      collection: collections.crmSalesRepsCollection,
      idFields: ['id', 'sourceId'],
      searchFields: ['name', 'email', 'companyName', 'phone'],
      sort: { updatedAt: -1 },
    },
    purchasing_items: {
      collection: collections.purchasingItemsCollection,
      idFields: ['id', 'itemKey'],
      searchFields: ['itemKey', 'itemRaw', 'descriptions', 'vendorRaws'],
      sort: { lastPurchaseDate: -1 },
    },
    purchasing_transactions: {
      collection: collections.purchasingTransactionsCollection,
      idFields: ['id'],
      searchFields: ['itemKey', 'vendorKey', 'vendorName', 'poNumber', 'referenceNumber'],
      sort: { date: -1 },
    },
    workers: {
      collection: collections.workersCollection,
      idFields: ['id', 'workerNumber'],
      searchFields: ['fullName', 'email', 'workerNumber', 'role'],
      sort: { fullName: 1 },
    },
    time_entries: {
      collection: collections.entriesCollection,
      idFields: ['id'],
      searchFields: ['jobNumber', 'jobName', 'workerName', 'stageName'],
      sort: { date: -1 },
    },
    stages: {
      collection: collections.stagesCollection,
      idFields: ['id', 'name'],
      searchFields: ['name', 'description'],
      sort: { sortOrder: 1 },
    },
    order_progress: {
      collection: collections.orderProgressCollection,
      idFields: ['id', 'orderId', 'orderNumber'],
      searchFields: ['orderId', 'orderNumber', 'orderName', 'status', 'stageName'],
      sort: { updatedAt: -1 },
    },
    alerts: {
      collection: collections.mobileAlertsCollection,
      idFields: ['id'],
      searchFields: ['title', 'message'],
      sort: { createdAt: -1 },
    },
    order_chats: {
      collection: ordersDatabase?.collection('orders_chats'),
      idFields: ['id'],
      searchFields: ['orderNumber', 'orderName', 'message', 'createdByName', 'createdByEmail'],
      sort: { createdAt: -1 },
    },
    chat_threads: {
      collection: authDatabase?.collection('app_chats'),
      idFields: ['id'],
      searchFields: ['name', 'lastMessagePreview', 'type'],
      sort: { updatedAt: -1 },
      privateToMember: true,
    },
    chat_messages: {
      collection: authDatabase?.collection('app_chat_messages'),
      idFields: ['id'],
      searchFields: ['message', 'createdByName', 'createdByEmail', 'chatId'],
      sort: { createdAt: -1 },
      privateToMember: true,
    },
    dashboard_snapshots: {
      collection: collections.dashboardSnapshotsCollection,
      idFields: ['id'],
      searchFields: ['generatedAt', 'source'],
      sort: { generatedAt: -1 },
    },
  }
}

async function chatVisibilityFilter({ recordType, definition, collections, principal }) {
  if (!definition.privateToMember || isPrivileged(principal)) return {}

  const authDatabase = collections.databasesByDomain?.auth
  const threads = authDatabase?.collection('app_chats')
  if (!threads) return { id: '__no_access__' }

  if (recordType === 'chat_threads') return { memberUids: principal.uid }
  const threadIds = await threads.find({ memberUids: principal.uid }, { projection: { _id: 0, id: 1 } }).limit(500).toArray()
  return { chatId: { $in: threadIds.map((thread) => thread.id).filter(Boolean) } }
}

async function authorizeReadOnlyMcpRequest(req, { getAuth, getReadOnlyCollections, ownerEmail }) {
  const authorization = toText(req.get('authorization'), 10000)
  const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
  if (!token) throw { status: 401, message: 'A Firebase ID token is required.' }

  let decoded
  try {
    decoded = await getAuth().verifyIdToken(token)
  } catch {
    throw { status: 401, message: 'The Firebase ID token is invalid or expired.' }
  }

  const uid = toText(decoded?.uid, 220)
  const email = toText(decoded?.email, 320).toLowerCase()
  if (!uid || !email) throw { status: 401, message: 'A signed-in Firebase user with email is required.' }

  const { authUsersCollection } = await getReadOnlyCollections()
  const user = await authUsersCollection.findOne(
    { $or: [{ uid }, { emailLower: email }] },
    { projection: { _id: 0, uid: 1, email: 1, emailLower: 1, role: 1, approvalStatus: 1, isOwner: 1 } },
  )
  const isOwner = Boolean(user?.isOwner) || email === toText(ownerEmail, 320).toLowerCase()
  if (!isOwner && user?.approvalStatus !== 'approved') {
    throw { status: 403, message: 'An approved Arnold account is required.' }
  }

  return {
    uid,
    email,
    role: isOwner ? 'admin' : toText(user?.role, 60) || 'standard',
    isOwner,
  }
}

function registerTools(server, { collections, principal, resourceMetadataUrl }) {
  const authRequired = !principal
  const auth = { securitySchemes: [{ type: 'oauth2', scopes: ['arnold.read'] }] }
  if (authRequired) {
    const requireLogin = async () => oauthRequiredResult(resourceMetadataUrl)
    server.registerTool('list_available_record_types', { title: 'List available Arnold record types', description: 'Lists the website data categories the signed-in user may search and retrieve.', annotations: READ_ONLY_ANNOTATIONS, ...auth }, requireLogin)
    server.registerTool('search_arnold_records', { title: 'Search Arnold website records', description: 'Searches permitted Arnold website records. Sign-in is required.', inputSchema: { query: z.string().trim().min(2).max(120), recordTypes: z.array(z.string()).max(20).optional(), limit: z.number().int().min(1).max(MAX_RESULTS).optional().default(20) }, annotations: READ_ONLY_ANNOTATIONS, ...auth }, requireLogin)
    server.registerTool('get_arnold_record', { title: 'Get an Arnold website record', description: 'Gets one permitted Arnold website record. Sign-in is required.', inputSchema: { recordType: z.string().trim().min(1).max(80), recordId: z.string().trim().min(1).max(240) }, annotations: READ_ONLY_ANNOTATIONS, ...auth }, requireLogin)
    server.registerTool('get_arnold_dashboard_summary', { title: 'Get Arnold dashboard summary', description: 'Returns a read-only operational summary. Sign-in is required.', annotations: READ_ONLY_ANNOTATIONS, ...auth }, requireLogin)
    return
  }
  const definitions = createRecordDefinitions(collections)
  const allowedTypes = allowedTypesFor(principal)
  const listedTypes = [...allowedTypes].filter((type) => definitions[type]?.collection)

  server.registerTool('list_available_record_types', {
    title: 'List available Arnold record types',
    description: 'Lists the website data categories the signed-in user may search and retrieve.',
    annotations: READ_ONLY_ANNOTATIONS,
    ...auth,
  }, async () => jsonResult({ recordTypes: listedTypes }))

  server.registerTool('search_arnold_records', {
    title: 'Search Arnold website records',
    description: 'Searches permitted orders, purchasing, CRM, workforce, chat, and dashboard records. It never changes data.',
    inputSchema: {
      query: z.string().trim().min(2).max(120).describe('Words, order number, PO number, person, company, item, or other search text.'),
      recordTypes: z.array(z.string()).max(20).optional().describe('Optional record types from list_available_record_types. Omit to search every allowed type.'),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional().default(20),
    },
    annotations: READ_ONLY_ANNOTATIONS,
    ...auth,
  }, async ({ query, recordTypes, limit }) => {
    const requestedTypes = Array.isArray(recordTypes) && recordTypes.length > 0 ? recordTypes : listedTypes
    const selectedTypes = [...new Set(requestedTypes.map((type) => toText(type, 80)))].filter((type) => listedTypes.includes(type))
    if (selectedTypes.length === 0) return errorResult('No permitted record types were requested.')

    const pattern = new RegExp(escapeRegex(query), 'i')
    const resultGroups = await Promise.all(selectedTypes.map(async (type) => {
      const definition = definitions[type]
      const privateFilter = definition.privateToMember
        ? await chatVisibilityFilter({ recordType: type, definition, collections, principal })
        : {}
      const searchFilter = { $or: definition.searchFields.map((field) => ({ [field]: pattern })) }
      const filter = { $and: [privateFilter, searchFilter] }
      const records = await definition.collection
        .find(filter, { projection: { _id: 0 } })
        .sort(definition.sort)
        .limit(Math.min(limit, 25))
        .toArray()
      return { recordType: type, records }
    }))

    return jsonResult({ query, results: resultGroups, totalRecords: resultGroups.reduce((total, group) => total + group.records.length, 0) })
  })

  server.registerTool('get_arnold_record', {
    title: 'Get an Arnold website record',
    description: 'Gets one permitted record by its ID, number, or key. It never changes data.',
    inputSchema: {
      recordType: z.string().trim().min(1).max(80),
      recordId: z.string().trim().min(1).max(240),
    },
    annotations: READ_ONLY_ANNOTATIONS,
    ...auth,
  }, async ({ recordType, recordId }) => {
    if (!listedTypes.includes(recordType)) return errorResult('That record type is unavailable for this account.')
    const definition = definitions[recordType]
    const baseFilter = { $or: definition.idFields.map((field) => ({ [field]: recordId })) }
    const privateFilter = definition.privateToMember
      ? await chatVisibilityFilter({ recordType, definition, collections, principal })
      : {}
    const record = await definition.collection.findOne({ $and: [privateFilter, baseFilter] }, { projection: { _id: 0 } })
    if (!record) return errorResult('Record not found or not available for this account.')
    return jsonResult({ recordType, record })
  })

  server.registerTool('get_arnold_dashboard_summary', {
    title: 'Get Arnold dashboard summary',
    description: 'Returns a read-only operational summary from stored website data.',
    annotations: READ_ONLY_ANNOTATIONS,
    ...auth,
  }, async () => {
    if (!allowedTypes.has('dashboard_snapshots') && !isPrivileged(principal)) {
      return errorResult('Dashboard data is unavailable for this account.')
    }
    const [snapshot, openOrders, purchasingItems, quotes] = await Promise.all([
      collections.dashboardSnapshotsCollection.find({}).sort({ generatedAt: -1 }).limit(1).next(),
      collections.ordersUnifiedCollection.countDocuments({ is_cancelled: { $ne: true }, is_deleted: { $ne: true }, is_shipped: { $ne: true } }),
      collections.purchasingItemsCollection.countDocuments({}),
      collections.crmQuotesCollection.countDocuments({ deletedAt: { $exists: false } }),
    ])
    return jsonResult({ snapshot, counts: { openOrders, purchasingItems, quotes } })
  })
}

export function registerReadOnlyMcpRoutes(app, deps) {
  const { getAuth, getReadOnlyCollections, ownerEmail, verifyMcpAccessToken } = deps

  app.post('/mcp', async (req, res) => {
    try {
      const authorization = toText(req.get('authorization'), 10000)
      const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
      const issuer = String(process.env.MCP_OAUTH_ISSUER ?? '').trim().replace(/\/$/, '')
      const resourceMetadataUrl = issuer ? `${issuer}/.well-known/oauth-protected-resource` : `${req.protocol}://${req.get('host')}/.well-known/oauth-protected-resource`
      let principal = null
      if (token) {
        try { principal = verifyMcpAccessToken ? await verifyMcpAccessToken(token) : await authorizeReadOnlyMcpRequest(req, { getAuth, getReadOnlyCollections, ownerEmail }) } catch { principal = null }
      }
      const collections = principal ? await getReadOnlyCollections() : null
      const server = new McpServer({ name: 'arnold-readonly', version: '1.0.0' })
      registerTools(server, { collections, principal, resourceMetadataUrl })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
    } catch (error) {
      console.error('MCP request failed after authentication.', { message: toText(error?.message, 500), name: toText(error?.name, 120) })
      if (!res.headersSent) {
        res.status(Number(error?.status) || 500).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: toText(error?.message, 500) || 'MCP request failed.' },
          id: req.body?.id ?? null,
        })
      }
    }
  })

  app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST for MCP requests.' }))
  app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'This MCP server is read-only.' }))
}

export const __testables = { allowedTypesFor, chatVisibilityFilter }
