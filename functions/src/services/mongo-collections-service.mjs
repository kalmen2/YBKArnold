import { MongoClient } from 'mongodb'

export function createMongoCollectionsService({
  mongoDbName,
  mongoUri,
}) {
  const maxMongoConnectAttempts = 4
  let mongoClient = null
  let databasePromise
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
    const activeClient = mongoClient

    mongoClient = null
    databasePromise = undefined
    indexesPromise = undefined

    if (!activeClient) {
      return
    }

    try {
      await activeClient.close()
    } catch {
      // Ignore close failures; next request will create a new client.
    }
  }

  async function waitBeforeRetry(attempt) {
    const retryDelayMs = Math.min(1000, 200 * (attempt + 1))

    await new Promise((resolve) => {
      setTimeout(resolve, retryDelayMs)
    })
  }

  async function ensureDatabaseConnection() {
    if (!databasePromise) {
      mongoClient = new MongoClient(mongoUri, {
        connectTimeoutMS: 10000,
        maxPoolSize: 20,
        minPoolSize: 0,
        retryReads: true,
        retryWrites: true,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      databasePromise = mongoClient.connect().then(() => mongoClient.db(mongoDbName))
    }

    try {
      return await databasePromise
    } catch (error) {
      await resetMongoState()
      throw error
    }
  }

  async function getCollections() {
    if (!mongoUri) {
      throw {
        status: 500,
        message: 'Missing MONGODB_URI in Firebase Functions environment.',
      }
    }

    let lastError

    for (let attempt = 0; attempt < maxMongoConnectAttempts; attempt += 1) {
      try {
        const database = await ensureDatabaseConnection()
        const workersCollection = database.collection('workers')
        const entriesCollection = database.collection('timesheet_entries')
        const stagesCollection = database.collection('timesheet_stages')
        const orderProgressCollection = database.collection('timesheet_order_progress')
        const missingWorkerReviewsCollection = database.collection('timesheet_missing_worker_reviews')
        const dashboardSnapshotsCollection = database.collection('dashboard_snapshots')
        const mondayOrdersCollection = database.collection('monday_orders')
        const authUsersCollection = database.collection('auth_users')
        const authActivityLogsCollection = database.collection('auth_activity_logs')
        const mobilePushTokensCollection = database.collection('mobile_push_tokens')
        const mobileAlertsCollection = database.collection('mobile_alerts')
        const mobileAlertReadsCollection = database.collection('mobile_alert_reads')
        const crmImportRunsCollection = database.collection('crm_import_runs')
        const crmAccountsCollection = database.collection('crm_accounts')
        const crmContactsCollection = database.collection('crm_contacts')
        const crmSalesRepsCollection = database.collection('crm_sales_reps')
        const crmDuplicateQueueCollection = database.collection('crm_duplicate_queue')
        const crmQuotesCollection = database.collection('crm_quotes')
        const crmOrdersCollection = database.collection('crm_orders')

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
            authUsersCollection.createIndex({ uid: 1 }, { unique: true }),
            authUsersCollection.createIndex({ emailLower: 1 }, { unique: true }),
            authUsersCollection.createIndex({ linkedWorkerId: 1 }, { unique: true, sparse: true }),
            authUsersCollection.createIndex({ approvalStatus: 1, role: 1 }),
            authActivityLogsCollection.createIndex({ uid: 1, createdAt: -1 }),
            authActivityLogsCollection.createIndex({ createdAt: -1 }),
            authActivityLogsCollection.createIndex({ type: 1, createdAt: -1 }),
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
            // Text search indexes for CRM
            crmAccountsCollection.createIndex(
              { name: 'text', email: 'text' },
              { name: 'crm_accounts_text', weights: { name: 10, email: 5 } },
            ),
            crmContactsCollection.createIndex(
              { fullName: 'text', primaryEmail: 'text', phone: 'text' },
              { name: 'crm_contacts_text', weights: { fullName: 10, primaryEmail: 5, phone: 3 } },
            ),
          ]).then(async () => {
            await removeLegacyTimesheetEntryIndexes(entriesCollection)
            await ensureDefaultStages()
            await ensureStageSortOrder(stagesCollection)
          })
        }

        try {
          await indexesPromise
        } catch (error) {
          indexesPromise = undefined
          throw error
        }

        return {
          database,
          mongoClient,
          workersCollection,
          entriesCollection,
          stagesCollection,
          orderProgressCollection,
          missingWorkerReviewsCollection,
          dashboardSnapshotsCollection,
          mondayOrdersCollection,
          authUsersCollection,
          authActivityLogsCollection,
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
    if (!mongoClient) {
      return
    }

    await mongoClient.close()
    mongoClient = null
    databasePromise = undefined
    indexesPromise = undefined
  }

  async function ensureDefaultStages() {
    // Defaults are intentionally disabled; stages are user-managed.
    return
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
