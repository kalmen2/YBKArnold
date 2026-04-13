import { MongoClient } from 'mongodb'

export function createMongoCollectionsService({
  mongoDbName,
  mongoUri,
}) {
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
    const orderProgressCollection = database.collection('timesheet_order_progress')
    const missingWorkerReviewsCollection = database.collection('timesheet_missing_worker_reviews')
    const dashboardSnapshotsCollection = database.collection('dashboard_snapshots')
    const mondayOrdersCollection = database.collection('monday_orders')
    const authUsersCollection = database.collection('auth_users')
    const authActivityLogsCollection = database.collection('auth_activity_logs')
    const mobilePushTokensCollection = database.collection('mobile_push_tokens')
    const mobileAlertsCollection = database.collection('mobile_alerts')
    const mobileAlertReadsCollection = database.collection('mobile_alert_reads')

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
      orderProgressCollection,
      missingWorkerReviewsCollection,
      dashboardSnapshotsCollection,
      mondayOrdersCollection,
      authUsersCollection,
      authActivityLogsCollection,
      mobilePushTokensCollection,
      mobileAlertsCollection,
      mobileAlertReadsCollection,
    }
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
