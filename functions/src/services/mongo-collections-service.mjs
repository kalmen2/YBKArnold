import { MongoClient } from 'mongodb'
import {
  findMissingMongoDomainUris,
  resolveMongoDomainConfiguration,
} from './mongo-domain-config.mjs'

export function createMongoCollectionsService({
  mongoDbName,
  mongoUri,
}) {
  const maxMongoConnectAttempts = 4
  const mongoDomainConfig = resolveMongoDomainConfiguration({
    mongoDbName,
    mongoUri,
  })
  const mongoClientsByUri = new Map()
  const mongoClientConnectPromisesByUri = new Map()
  const databasePromisesByDomain = new Map()
  let indexesPromise

  function isTransientMongoError(error) {
    const message = String(error?.message ?? '').toLowerCase()
    const codeName = String(error?.codeName ?? '').toLowerCase()

    if (!message && !codeName) {
      return false
    }

    if (message.includes('tlsv1 alert internal error') || message.includes('ssl3_read_bytes')) {
      return true
    }

    if (
      message.includes('server selection timed out')
      || message.includes('connection') && message.includes('closed')
      || message.includes('client network socket disconnected')
    ) {
      return true
    }

    return codeName === 'hostunreachable' || codeName === 'networktimeout'
  }

  async function resetMongoState() {
    const activeClients = [...mongoClientsByUri.values()]

    mongoClientsByUri.clear()
    mongoClientConnectPromisesByUri.clear()
    databasePromisesByDomain.clear()
    indexesPromise = undefined

    await Promise.all(
      activeClients.map(async (client) => {
        try {
          await client.close()
        } catch {
          // Ignore close failures; next request will create a new client.
        }
      }),
    )
  }

  async function waitBeforeRetry(attempt) {
    const retryDelayMs = Math.min(1000, 200 * (attempt + 1))

    await new Promise((resolve) => {
      setTimeout(resolve, retryDelayMs)
    })
  }

  function getOrCreateMongoClient(uri) {
    const normalizedUri = String(uri ?? '').trim()

    if (!normalizedUri) {
      return null
    }

    if (!mongoClientsByUri.has(normalizedUri)) {
      const client = new MongoClient(normalizedUri, {
        connectTimeoutMS: 10000,
        maxPoolSize: 20,
        minPoolSize: 0,
        retryReads: true,
        retryWrites: true,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      mongoClientsByUri.set(normalizedUri, client)
    }

    return mongoClientsByUri.get(normalizedUri)
  }

  async function ensureMongoClientConnected(uri) {
    const normalizedUri = String(uri ?? '').trim()
    const mongoClient = getOrCreateMongoClient(normalizedUri)

    if (!mongoClient) {
      return null
    }

    if (!mongoClientConnectPromisesByUri.has(normalizedUri)) {
      mongoClientConnectPromisesByUri.set(normalizedUri, mongoClient.connect())
    }

    try {
      await mongoClientConnectPromisesByUri.get(normalizedUri)
    } catch (error) {
      mongoClientConnectPromisesByUri.delete(normalizedUri)
      mongoClientsByUri.delete(normalizedUri)

      try {
        await mongoClient.close()
      } catch {
        // Ignore close failures during reset.
      }

      throw error
    }

    return mongoClient
  }

  async function ensureDomainDatabase(domainKey) {
    const domainConfig = mongoDomainConfig.domains?.[domainKey]

    if (!domainConfig) {
      throw new Error(`Unsupported Mongo domain "${domainKey}".`)
    }

    if (!databasePromisesByDomain.has(domainKey)) {
      const initializationPromise = (async () => {
        const mongoClient = await ensureMongoClientConnected(domainConfig.uri)

        if (!mongoClient) {
          throw {
            status: 500,
            message: 'Missing MONGODB_URI in Firebase Functions environment.',
          }
        }

        return {
          database: mongoClient.db(domainConfig.dbName),
          mongoClient,
        }
      })()

      databasePromisesByDomain.set(domainKey, initializationPromise)
    }

    const databasePromise = databasePromisesByDomain.get(domainKey)

    try {
      return await databasePromise
    } catch (error) {
      databasePromisesByDomain.delete(domainKey)
      indexesPromise = undefined
      throw error
    }
  }

  async function ensureAllDomainDatabases() {
    const domainEntries = await Promise.all(
      mongoDomainConfig.domainKeys.map(async (domainKey) => {
        const connection = await ensureDomainDatabase(domainKey)

        return [domainKey, connection]
      }),
    )

    return Object.fromEntries(domainEntries)
  }

  async function getCollections() {
    const missingDomainUris = findMissingMongoDomainUris(mongoDomainConfig)

    if (missingDomainUris.length > 0) {
      const missingUrisSummary = missingDomainUris
        .map((entry) => `${entry.domainKey} (${entry.uriEnvVar})`)
        .join(', ')

      throw {
        status: 500,
        message: `Missing Mongo URI configuration for domain(s): ${missingUrisSummary}.`,
      }
    }

    let lastError

    for (let attempt = 0; attempt < maxMongoConnectAttempts; attempt += 1) {
      try {
        const databasesByDomain = await ensureAllDomainDatabases()
        const platformDatabase = databasesByDomain.platform.database
        const ordersDatabase = databasesByDomain.orders.database
        const crmDatabase = databasesByDomain.crm.database
        const timesheetDatabase = databasesByDomain.timesheet.database
        const authDatabase = databasesByDomain.auth.database
        const aiDatabase = databasesByDomain.ai.database
        const purchasingDatabase = databasesByDomain.purchasing.database
        const integrationsDatabase = databasesByDomain.integrations.database

        const workersCollection = timesheetDatabase.collection('workers')
        const entriesCollection = timesheetDatabase.collection('timesheet_entries')
        const stagesCollection = timesheetDatabase.collection('timesheet_stages')
        const orderProgressCollection = timesheetDatabase.collection('timesheet_order_progress')
        const missingWorkerReviewsCollection = timesheetDatabase.collection('timesheet_missing_worker_reviews')
        const dashboardSnapshotsCollection = platformDatabase.collection('dashboard_snapshots')
        const mondayOrdersCollection = ordersDatabase.collection('monday_orders')
        const ordersUnifiedCollection = ordersDatabase.collection('orders_unified')
        const authUsersCollection = authDatabase.collection('auth_users')
        const mobilePushTokensCollection = authDatabase.collection('mobile_push_tokens')
        const mobileAlertsCollection = authDatabase.collection('mobile_alerts')
        const mobileAlertReadsCollection = authDatabase.collection('mobile_alert_reads')
        const crmImportRunsCollection = crmDatabase.collection('crm_import_runs')
        const crmAccountsCollection = crmDatabase.collection('crm_accounts')
        const crmContactsCollection = crmDatabase.collection('crm_contacts')
        const crmSalesRepsCollection = crmDatabase.collection('crm_sales_reps')
        const crmDuplicateQueueCollection = crmDatabase.collection('crm_duplicate_queue')
        const crmQuotesCollection = crmDatabase.collection('crm_quotes')
        const crmOrdersCollection = crmDatabase.collection('crm_orders')
        const aiRulesCollection = aiDatabase.collection('ai_rules')
        const aiCommentSummariesCollection = aiDatabase.collection('ai_comment_summaries')
        const purchasingItemsCollection = purchasingDatabase.collection('purchasing_items')
        const purchasingTransactionsCollection = purchasingDatabase.collection('purchasing_transactions')
        const quickBooksTokensCollection = integrationsDatabase.collection('quickbooks_oauth_tokens')
        const quickBooksStatesCollection = integrationsDatabase.collection('quickbooks_oauth_states')

        const legacyDatabase = mongoDomainConfig.isSplitDeployment
          ? null
          : databasesByDomain.platform.database

        if (!indexesPromise) {
          indexesPromise = Promise.all([
            workersCollection.createIndex({ id: 1 }, { unique: true }),
            workersCollection.createIndex({ workerNumber: 1 }, { unique: true, sparse: true }),
            entriesCollection.createIndex({ id: 1 }, { unique: true }),
            entriesCollection.createIndex({ workerId: 1 }),
            entriesCollection.createIndex({ stageId: 1 }),
            entriesCollection.createIndex({ date: -1 }),
            stagesCollection.createIndex({ id: 1 }, { unique: true }),
            stagesCollection.createIndex({ normalizedName: 1 }, { unique: true }),
            orderProgressCollection.createIndex({ id: 1 }, { unique: true }),
            orderProgressCollection.createIndex({ date: -1, normalizedJobName: 1 }, { unique: true }),
            orderProgressCollection.createIndex({ date: -1 }),
            missingWorkerReviewsCollection.createIndex({ id: 1 }, { unique: true }),
            missingWorkerReviewsCollection.createIndex({ date: -1, workerId: 1 }, { unique: true }),
            missingWorkerReviewsCollection.createIndex({ date: -1 }),
            missingWorkerReviewsCollection.createIndex({ approved: 1, date: -1 }),
            dashboardSnapshotsCollection.createIndex({ snapshotKey: 1 }, { unique: true }),
            mondayOrdersCollection.createIndex({ mondayItemId: 1 }, { unique: true }),
            mondayOrdersCollection.createIndex({ createdAt: -1 }),
            mondayOrdersCollection.createIndex({ orderName: 1 }),
            ordersUnifiedCollection.createIndex({ orderKey: 1 }, { unique: true }),
            ordersUnifiedCollection.createIndex({ order_number: 1 }),
            ordersUnifiedCollection.createIndex({ is_shipped: 1, Due_date: 1 }),
            ordersUnifiedCollection.createIndex({ has_monday_record: 1, has_quickbooks_record: 1 }),
            ordersUnifiedCollection.createIndex({ hazard_reason: 1 }),
            ordersUnifiedCollection.createIndex({ updatedAt: -1 }),
            ordersUnifiedCollection.createIndex(
              { order_name: 'text', order_number: 'text' },
              { name: 'orders_unified_text', weights: { order_number: 10, order_name: 6 } },
            ),
            authUsersCollection.createIndex({ uid: 1 }, { unique: true }),
            authUsersCollection.createIndex({ emailLower: 1 }, { unique: true }),
            authUsersCollection.createIndex({ linkedWorkerId: 1 }, { unique: true, sparse: true }),
            authUsersCollection.createIndex({ linkedZendeskUserId: 1 }, { unique: true, sparse: true }),
            authUsersCollection.createIndex({ approvalStatus: 1, role: 1 }),
            mobilePushTokensCollection.createIndex({ token: 1 }, { unique: true }),
            mobilePushTokensCollection.createIndex({ uid: 1, active: 1, updatedAt: -1 }),
            mobilePushTokensCollection.createIndex({ emailLower: 1, active: 1 }),
            mobilePushTokensCollection.createIndex({ active: 1, updatedAt: -1 }),
            mobileAlertsCollection.createIndex({ id: 1 }, { unique: true }),
            mobileAlertsCollection.createIndex({ createdAt: -1 }),
            mobileAlertReadsCollection.createIndex({ id: 1 }, { unique: true }),
            mobileAlertReadsCollection.createIndex({ uid: 1, alertId: 1 }, { unique: true }),
            mobileAlertReadsCollection.createIndex({ uid: 1, readAt: -1 }),
            mobileAlertReadsCollection.createIndex({ alertId: 1, readAt: -1 }),
            crmImportRunsCollection.createIndex({ id: 1 }, { unique: true }),
            crmImportRunsCollection.createIndex({ importedAt: -1 }),
            crmImportRunsCollection.createIndex({ importFingerprint: 1 }),
            crmAccountsCollection.createIndex({ id: 1 }, { unique: true }),
            crmAccountsCollection.createIndex({ sourceId: 1 }, { unique: true }),
            crmAccountsCollection.createIndex({ nameLower: 1 }),
            crmAccountsCollection.createIndex({ emailLower: 1 }, { sparse: true }),
            crmAccountsCollection.createIndex({ ownerEmailLower: 1 }, { sparse: true }),
            crmAccountsCollection.createIndex({ lastImportRunId: 1 }),
            crmAccountsCollection.createIndex({ deletedAt: 1 }, { sparse: true }),
            crmContactsCollection.createIndex({ id: 1 }, { unique: true }),
            crmContactsCollection.createIndex({ sourceId: 1 }, { unique: true }),
            crmContactsCollection.createIndex({ accountSourceId: 1 }),
            crmContactsCollection.createIndex({ primaryEmailLower: 1 }, { sparse: true }),
            crmContactsCollection.createIndex({ contactOrigin: 1 }),
            crmContactsCollection.createIndex({ lastImportRunId: 1 }),
            crmContactsCollection.createIndex({ deletedAt: 1 }, { sparse: true }),
            crmSalesRepsCollection.createIndex({ id: 1 }, { unique: true }),
            crmSalesRepsCollection.createIndex({ nameLower: 1 }, { unique: true }),
            crmSalesRepsCollection.createIndex({ companyNameLower: 1 }),
            crmSalesRepsCollection.createIndex({ states: 1 }),
            crmSalesRepsCollection.createIndex({ updatedAt: -1 }),
            crmSalesRepsCollection.createIndex({ isDeleted: 1 }, { sparse: true }),
            crmDuplicateQueueCollection.createIndex({ id: 1 }, { unique: true }),
            crmDuplicateQueueCollection.createIndex({ status: 1, createdAt: -1 }),
            crmDuplicateQueueCollection.createIndex({ importRunId: 1, status: 1 }),
            crmDuplicateQueueCollection.createIndex({ conflictType: 1, status: 1 }),
            crmQuotesCollection.createIndex({ id: 1 }, { unique: true }),
            crmQuotesCollection.createIndex({ dealerSourceId: 1, status: 1 }),
            crmQuotesCollection.createIndex({ quoteNumber: 1 }, { sparse: true }),
            crmQuotesCollection.createIndex({ status: 1, updatedAt: -1 }),
            crmQuotesCollection.createIndex({ createdAt: -1 }),
            crmOrdersCollection.createIndex({ id: 1 }, { unique: true }),
            crmOrdersCollection.createIndex({ dealerSourceId: 1, status: 1 }),
            crmOrdersCollection.createIndex({ orderNumber: 1 }, { sparse: true }),
            crmOrdersCollection.createIndex({ status: 1, updatedAt: -1 }),
            crmOrdersCollection.createIndex({ createdAt: -1 }),
            aiRulesCollection.createIndex({ category: 1 }, { unique: true }),
            aiCommentSummariesCollection.createIndex({ commentId: 1 }, { unique: true }),
            purchasingItemsCollection.createIndex({ itemKey: 1 }, { unique: true }),
            purchasingItemsCollection.createIndex({ totalSpent: -1 }),
            purchasingItemsCollection.createIndex({ lastPurchaseDate: -1 }),
            purchasingItemsCollection.createIndex(
              { itemRaw: 'text', descriptions: 'text', vendorRaws: 'text' },
              { name: 'purchasing_items_text', weights: { itemRaw: 10, descriptions: 5, vendorRaws: 3 } },
            ),
            purchasingTransactionsCollection.createIndex({ id: 1 }, { unique: true }),
            purchasingTransactionsCollection.createIndex({ itemKey: 1, date: -1 }),
            purchasingTransactionsCollection.createIndex({ vendorKey: 1, date: -1 }),
            purchasingTransactionsCollection.createIndex({ poNumber: 1 }, { sparse: true }),
            // Text search indexes for CRM
            crmAccountsCollection.createIndex(
              { name: 'text', email: 'text' },
              { name: 'crm_accounts_text', weights: { name: 10, email: 5 } },
            ),
            crmContactsCollection.createIndex(
              { fullName: 'text', primaryEmail: 'text', phone: 'text' },
              { name: 'crm_contacts_text', weights: { fullName: 10, primaryEmail: 5, phone: 3 } },
            ),
            quickBooksTokensCollection.createIndex({ id: 1 }, { unique: true }),
            quickBooksTokensCollection.createIndex({ updatedAt: -1 }),
            quickBooksStatesCollection.createIndex({ id: 1 }, { unique: true }),
            quickBooksStatesCollection.createIndex({ createdAt: 1 }),
          ]).then(async () => {
            await removeLegacyTimesheetEntryIndexes(entriesCollection)
            if (legacyDatabase) {
              await dropLegacyAuthActivityLogsCollection(legacyDatabase)
              await dropLegacyOrdersLedgerCollection(legacyDatabase)
            }
            await ensureDefaultStages()
            await ensureStageSortOrder(stagesCollection)
            await seedDefaultAiRules(aiRulesCollection)
          })
        }

        try {
          await indexesPromise
        } catch (error) {
          indexesPromise = undefined
          throw error
        }

        return {
          database: platformDatabase,
          mongoClient: databasesByDomain.platform.mongoClient,
          databasesByDomain: {
            platform: platformDatabase,
            orders: ordersDatabase,
            crm: crmDatabase,
            timesheet: timesheetDatabase,
            auth: authDatabase,
            ai: aiDatabase,
            purchasing: purchasingDatabase,
            integrations: integrationsDatabase,
          },
          mongoClientsByDomain: {
            platform: databasesByDomain.platform.mongoClient,
            orders: databasesByDomain.orders.mongoClient,
            crm: databasesByDomain.crm.mongoClient,
            timesheet: databasesByDomain.timesheet.mongoClient,
            auth: databasesByDomain.auth.mongoClient,
            ai: databasesByDomain.ai.mongoClient,
            purchasing: databasesByDomain.purchasing.mongoClient,
            integrations: databasesByDomain.integrations.mongoClient,
          },
          mongoDomainConfig,
          workersCollection,
          entriesCollection,
          stagesCollection,
          orderProgressCollection,
          missingWorkerReviewsCollection,
          dashboardSnapshotsCollection,
          mondayOrdersCollection,
          ordersUnifiedCollection,
          authUsersCollection,
          mobilePushTokensCollection,
          mobileAlertsCollection,
          mobileAlertReadsCollection,
          crmImportRunsCollection,
          crmAccountsCollection,
          crmContactsCollection,
          crmSalesRepsCollection,
          crmDuplicateQueueCollection,
          crmQuotesCollection,
          crmOrdersCollection,
          aiRulesCollection,
          aiCommentSummariesCollection,
          purchasingItemsCollection,
          purchasingTransactionsCollection,
          quickBooksTokensCollection,
          quickBooksStatesCollection,
        }
      } catch (error) {
        lastError = error

        const canRetry = attempt < maxMongoConnectAttempts - 1 && isTransientMongoError(error)

        if (!canRetry) {
          throw error
        }

        console.warn('Retrying Mongo connection after transient error.', {
          attempt: attempt + 1,
          maxAttempts: maxMongoConnectAttempts,
          message: String(error?.message ?? ''),
        })

        await resetMongoState()
        await waitBeforeRetry(attempt)
      }
    }

    throw lastError
  }

  async function closeMongoConnections() {
    if (mongoClientsByUri.size === 0) {
      return
    }

    await Promise.all(
      [...mongoClientsByUri.values()].map((client) => client.close()),
    )

    mongoClientsByUri.clear()
    mongoClientConnectPromisesByUri.clear()
    databasePromisesByDomain.clear()
    indexesPromise = undefined
  }

  async function seedDefaultAiRules(aiRulesCollection) {
    const now = new Date().toISOString()
    const categories = ['support', 'summaries', 'general', 'purchasing']

    for (const category of categories) {
      await aiRulesCollection.updateOne(
        { category },
        {
          $set: { updatedAt: now },
          $setOnInsert: { category, content: '', createdAt: now },
        },
        { upsert: true },
      )
    }
  }

  async function ensureDefaultStages() {
    // Defaults are intentionally disabled; stages are user-managed.
    return
  }

  async function dropLegacyAuthActivityLogsCollection(database) {
    try {
      await database.collection('auth_activity_logs').drop()
    } catch (error) {
      if (String(error?.codeName ?? '') === 'NamespaceNotFound') {
        return
      }

      throw error
    }
  }

  async function dropLegacyOrdersLedgerCollection(database) {
    try {
      await database.collection('orders_ledger').drop()
    } catch (error) {
      if (String(error?.codeName ?? '') === 'NamespaceNotFound') {
        return
      }

      throw error
    }
  }

  async function removeLegacyTimesheetEntryIndexes(entriesCollection) {
    const indexes = await entriesCollection.indexes()
    const legacyUniqueIndexes = indexes.filter((index) => {
      if (!index?.unique) {
        return false
      }

      const key = index?.key ?? {}
      const keyNames = Object.keys(key)

      if (keyNames.length !== 2) {
        return false
      }

      if (!keyNames.includes('workerId') || !keyNames.includes('date')) {
        return false
      }

      const workerDirection = Number(key.workerId)
      const dateDirection = Number(key.date)

      return Math.abs(workerDirection) === 1 && Math.abs(dateDirection) === 1
    })

    if (legacyUniqueIndexes.length === 0) {
      return
    }

    await Promise.all(
      legacyUniqueIndexes.map(async (index) => {
        const indexName = String(index?.name ?? '').trim()

        if (!indexName || indexName === '_id_') {
          return
        }

        try {
          await entriesCollection.dropIndex(indexName)
        } catch (error) {
          if (String(error?.codeName ?? '') === 'IndexNotFound') {
            return
          }

          throw error
        }
      }),
    )
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

  return {
    closeMongoConnections,
    getCollections,
  }
}
