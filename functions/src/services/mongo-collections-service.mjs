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
  const defaultEmailIntakeRules = [
    '## Email Intake Routing and Chat Importance Rules (Customer-facing)',
    '',
    'Goal:',
    '- Capture only important customer/dealer events worth looking back on later.',
    '- Route each email to one destination type: quote, order, account, or none.',
    '',
    'Scope:',
    '- This system is for customer/dealer-facing communication and customer-impacting updates.',
    '- Ignore vendor/internal procurement noise by default: vendor invoice requests, vendor payment release updates, purchase-order processing, supplier upset messages, freight-only coordination, and internal workflow chatter.',
    '- Only include vendor/internal context when it directly creates a meaningful customer-facing quote/order/account impact.',
    '',
    'What is important:',
    '- Decisions, approvals, commitments, blockers, deadlines, risk, escalations, and service-quality issues.',
    '- Price/discount changes, rush requests, late status, install/reinstall impact, and any change that affects customer expectations.',
    '- Account-level complaints or relationship issues (for example: customer service complaints).',
    '- Casual/random questions without long-term impact should usually be treated as none.',
    '',
    'Destination rules:',
    '- quote:',
    '  - Use for pre-order quote-stage communication.',
    '  - Important examples: discount requests, quote revisions, quote acceptance/decline, meaningful pricing negotiation.',
    '  - Random quote Q&A without business impact should not be logged as important.',
    '- order:',
    '  - Use when communication is tied to an order number or ACK/acknowledgment number.',
    '  - Important examples: late order, rush request, production/shipping delay, install/reinstall schedule risk, quality issue, corrective action.',
    '  - Prefer order as primary when order-specific execution detail exists.',
    '- account:',
    '  - Use for dealer/customer relationship-level issues.',
    '  - Important examples: complaints about service, trust/escalation concerns, recurring account behavior that leadership should remember.',
    '- none:',
    '  - Use when there is no clear destination match or no important customer-facing event to remember.',
    '',
    'Order + Account overlap handling:',
    '- If an event belongs to both order and account, keep detailed facts in order context.',
    '- Account context should keep only a high-level signal (example: "Order 12345 late") without deep operational detail.',
    '- Order remains the detailed source of truth.',
    '',
    'Summary style:',
    '- Write one concise plain-English sentence by default.',
    '- Use two short sentences only when one sentence would lose critical context.',
    '- Never output raw email header dumps (no "From:", "To:", etc.).',
    '- For ACK threads, clearly mention acknowledgment/order context.',
    '',
    'Confidence:',
    '- Return confidence in range 0..1.',
    '- Use high confidence only when destination and summary are strongly supported by the message content.',
  ].join('\n')

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
        const visitorLogsCollection = platformDatabase.collection('visitor_logs')
        const visitorShortcutsCollection = platformDatabase.collection('visitor_shortcuts')
        const mondayOrdersCollection = ordersDatabase.collection('monday_orders')
        const ordersUnifiedCollection = ordersDatabase.collection('orders')
        const authUsersCollection = authDatabase.collection('auth_users')
        const apiKeysCollection = authDatabase.collection('api_keys')
        const mobilePushTokensCollection = authDatabase.collection('mobile_push_tokens')
        const mobileAlertsCollection = authDatabase.collection('mobile_alerts')
        const mobileAlertReadsCollection = authDatabase.collection('mobile_alert_reads')
        const crmImportRunsCollection = crmDatabase.collection('crm_import_runs')
        const crmAccountsCollection = crmDatabase.collection('crm_accounts')
        const crmContactsCollection = crmDatabase.collection('crm_contacts')
        const crmSalesRepsCollection = crmDatabase.collection('crm_sales_reps')
        const crmDuplicateQueueCollection = crmDatabase.collection('crm_duplicate_queue')
        const crmQuotesCollection = crmDatabase.collection('crm_quotes')
        const crmQuotePrintSettingsCollection = crmDatabase.collection('crm_quote_print_settings')
        // Compatibility alias: all order reads and writes now use one canonical
        // Orders collection in the orders domain database.
        const crmOrdersCollection = ordersUnifiedCollection
        const aiRulesCollection = aiDatabase.collection('ai_rules')
        const aiCommentSummariesCollection = aiDatabase.collection('ai_comment_summaries')
        const purchasingItemsCollection = purchasingDatabase.collection('purchasing_items')
        const purchasingTransactionsCollection = purchasingDatabase.collection('purchasing_transactions')
        const quickBooksTokensCollection = integrationsDatabase.collection('quickbooks_oauth_tokens')
        const quickBooksStatesCollection = integrationsDatabase.collection('quickbooks_oauth_states')
        const emailConnectionsCollection = integrationsDatabase.collection('email_oauth_connections')
        const emailOauthStatesCollection = integrationsDatabase.collection('email_oauth_states')
        const emailSyncStatesCollection = integrationsDatabase.collection('email_sync_states')
        const emailIntakeMessagesCollection = integrationsDatabase.collection('email_intake_messages')
        const emailIntakeSuggestionsCollection = integrationsDatabase.collection('email_intake_suggestions')
        const emailIntakeFeedbackCollection = integrationsDatabase.collection('email_intake_feedback')
        const emailIntakeSyncRunsCollection = integrationsDatabase.collection('email_intake_sync_runs')
        const smsBridgeLogsCollection = integrationsDatabase.collection('sms_telegram_bridge_logs')
        const smsBridgePendingRepliesCollection = integrationsDatabase.collection('sms_telegram_bridge_pending_replies')

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
            visitorLogsCollection.createIndex({ id: 1 }, { unique: true }),
            visitorLogsCollection.createIndex({ createdAt: -1 }),
            visitorLogsCollection.createIndex({ createdByUid: 1, createdAt: -1 }),
            visitorShortcutsCollection.createIndex({ id: 1 }, { unique: true }),
            visitorShortcutsCollection.createIndex({ shortcutKey: 1 }, { unique: true }),
            visitorShortcutsCollection.createIndex({ updatedAt: -1 }),
            mondayOrdersCollection.createIndex({ mondayItemId: 1 }, { unique: true }),
            mondayOrdersCollection.createIndex({ createdAt: -1 }),
            mondayOrdersCollection.createIndex({ orderName: 1 }),
            ordersUnifiedCollection.createIndex({ orderKey: 1 }, { unique: true }),
            ordersUnifiedCollection.createIndex({ canonical_order_id: 1 }, { unique: true, sparse: true }),
            ordersUnifiedCollection.createIndex({ source_quote_id: 1 }, { unique: true, sparse: true }),
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
            apiKeysCollection.createIndex({ id: 1 }, { unique: true }),
            apiKeysCollection.createIndex({ keyHash: 1 }, { unique: true }),
            apiKeysCollection.createIndex({ revokedAt: 1, createdAt: -1 }),
            apiKeysCollection.createIndex({ createdAt: -1 }),
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
            crmQuotesCollection.createIndex({ convertedOrderId: 1 }, { sparse: true }),
            crmQuotesCollection.createIndex({ status: 1, updatedAt: -1 }),
            crmQuotesCollection.createIndex({ createdAt: -1 }),
            crmQuotePrintSettingsCollection.createIndex({ id: 1 }, { unique: true }),
            crmOrdersCollection.createIndex({ id: 1 }, { unique: true, sparse: true }),
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
            emailConnectionsCollection.createIndex({ id: 1 }, { unique: true }),
            emailConnectionsCollection.createIndex({ provider: 1, uid: 1 }, { unique: true }),
            emailConnectionsCollection.createIndex({ provider: 1, connectedEmailLower: 1 }),
            emailConnectionsCollection.createIndex({ updatedAt: -1 }),
            emailOauthStatesCollection.createIndex({ id: 1 }, { unique: true }),
            emailOauthStatesCollection.createIndex({ provider: 1, createdAt: 1 }),
            emailSyncStatesCollection.createIndex({ id: 1 }, { unique: true }),
            emailSyncStatesCollection.createIndex({ provider: 1, uid: 1 }, { unique: true }),
            emailSyncStatesCollection.createIndex({ autoSyncEnabled: 1, updatedAt: -1 }),
            emailSyncStatesCollection.createIndex({ lastSyncCompletedAt: -1 }),
            emailIntakeMessagesCollection.createIndex({ id: 1 }, { unique: true }),
            emailIntakeMessagesCollection.createIndex({ provider: 1, uid: 1, externalMessageId: 1 }, { unique: true }),
            emailIntakeMessagesCollection.createIndex({ provider: 1, uid: 1, internetMessageId: 1 }, { unique: true, sparse: true }),
            emailIntakeMessagesCollection.createIndex({ uid: 1, messageDate: -1 }),
            emailIntakeMessagesCollection.createIndex({ createdAt: -1 }),
            emailIntakeSuggestionsCollection.createIndex({ id: 1 }, { unique: true }),
            emailIntakeSuggestionsCollection.createIndex({ messageId: 1 }, { unique: true }),
            emailIntakeSuggestionsCollection.createIndex({ status: 1, createdAt: -1 }),
            emailIntakeSuggestionsCollection.createIndex({ uid: 1, status: 1, createdAt: -1 }),
            emailIntakeSuggestionsCollection.createIndex({ isRead: 1, status: 1, createdAt: -1 }),
            emailIntakeSuggestionsCollection.createIndex({ destinationType: 1, destinationId: 1, createdAt: -1 }),
            emailIntakeFeedbackCollection.createIndex({ id: 1 }, { unique: true }),
            emailIntakeFeedbackCollection.createIndex({ suggestionId: 1, createdAt: -1 }),
            emailIntakeFeedbackCollection.createIndex({ createdAt: -1 }),
            emailIntakeSyncRunsCollection.createIndex({ id: 1 }, { unique: true }),
            emailIntakeSyncRunsCollection.createIndex({ status: 1, updatedAt: -1 }),
            emailIntakeSyncRunsCollection.createIndex({ requestedByUid: 1, createdAt: -1 }),
            smsBridgeLogsCollection.createIndex({ id: 1 }, { unique: true }),
            smsBridgeLogsCollection.createIndex({ createdAt: -1 }),
            smsBridgeLogsCollection.createIndex({ status: 1, updatedAt: -1 }),
            smsBridgePendingRepliesCollection.createIndex({ id: 1 }, { unique: true }),
            smsBridgePendingRepliesCollection.createIndex({ createdAt: -1 }),
            smsBridgePendingRepliesCollection.createIndex({ telegramRequestMessageId: 1 }, { unique: true }),
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
          visitorLogsCollection,
          visitorShortcutsCollection,
          mondayOrdersCollection,
          ordersUnifiedCollection,
          authUsersCollection,
          apiKeysCollection,
          mobilePushTokensCollection,
          mobileAlertsCollection,
          mobileAlertReadsCollection,
          crmImportRunsCollection,
          crmAccountsCollection,
          crmContactsCollection,
          crmSalesRepsCollection,
          crmDuplicateQueueCollection,
          crmQuotesCollection,
          crmQuotePrintSettingsCollection,
          crmOrdersCollection,
          aiRulesCollection,
          aiCommentSummariesCollection,
          purchasingItemsCollection,
          purchasingTransactionsCollection,
          quickBooksTokensCollection,
          quickBooksStatesCollection,
          emailConnectionsCollection,
          emailOauthStatesCollection,
          emailSyncStatesCollection,
          emailIntakeMessagesCollection,
          emailIntakeSuggestionsCollection,
          emailIntakeFeedbackCollection,
          emailIntakeSyncRunsCollection,
          smsBridgeLogsCollection,
          smsBridgePendingRepliesCollection,
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
    const categories = ['support', 'summaries', 'general', 'purchasing', 'email_intake']

    for (const category of categories) {
      const defaultContent = category === 'email_intake'
        ? defaultEmailIntakeRules
        : ''

      await aiRulesCollection.updateOne(
        { category },
        {
          $set: { updatedAt: now },
          $setOnInsert: { category, content: defaultContent, createdAt: now },
        },
        { upsert: true },
      )

      if (category === 'email_intake') {
        await aiRulesCollection.updateOne(
          {
            category,
            $or: [
              { content: { $exists: false } },
              { content: null },
              { content: '' },
            ],
          },
          {
            $set: {
              content: defaultEmailIntakeRules,
              updatedAt: now,
            },
          },
        )
      }
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
