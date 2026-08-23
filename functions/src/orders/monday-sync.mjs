// Monday sync helpers for orders: order context resolution, live pulls,
// collection sync, Monday column writers, and the retry queue that guarantees
// no website edit is ever lost when Monday is unreachable.

import { randomUUID } from 'node:crypto'
import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import {
  ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS,
  computeQueuedProgressStatusRetryAt,
  normalizeIsoDateInput,
  normalizeProgressDetailOptions,
  normalizeProgressStatusDetails,
  normalizeQueuedProgressStatusValue,
  resolveMondayProgressStatusLabel,
  resolveRowStatusLabel,
} from './order-shared.mjs'

export function createMondaySyncHelpers(deps) {
  const {
    fetchMondayBoardItemsByIds,
    fetchMondayStatusColumnOptions,
    getCollections,
    updateMondayItemJsonColumn,
    updateMondayItemName,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
  } = deps

  let ordersProgressStatusQueueIndexesPromise
  let ordersProgressStatusQueueInFlight = null
  let ordersDetailsQueueIndexesPromise
  let ordersDetailsQueueInFlight = null
  const ordersProgressStatusQueueCollectionName = 'orders_progress_status_queue'
  const ordersProgressStatusQueueMaxAttempts = ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS.length
  const ordersProgressStatusQueueDefaultBatchSize = 80
  // Jobs stuck in "processing" (instance died or was frozen mid-run) become
  // claimable again after this window so no queued Monday update is ever lost.
  const ordersProgressStatusQueueProcessingStaleMs = 10 * 60 * 1000
  const ordersDetailsQueueCollectionName = 'orders_monday_details_queue'
  const ordersDetailsQueueMaxAttempts = ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS.length
  const ordersDetailsQueueProcessingStaleMs = 10 * 60 * 1000

  async function updateMondayDateColumnValue({
    boardId,
    itemId,
    columnId,
    dateValue,
  }) {
    const normalizedDateValue = normalizeIsoDateInput(dateValue)

    if (!normalizedDateValue) {
      await updateMondayItemTextColumn({
        boardId,
        itemId,
        columnId,
        textValue: '',
      })
      return
    }

    try {
      await updateMondayItemJsonColumn({
        boardId,
        itemId,
        columnId,
        jsonValue: {
          date: normalizedDateValue,
        },
      })
      return
    } catch {
      await updateMondayItemTextColumn({
        boardId,
        itemId,
        columnId,
        textValue: normalizedDateValue,
      })
    }
  }

  async function updateMondayLinkColumnValue({
    boardId,
    itemId,
    columnId,
    urlValue,
    linkText,
  }) {
    const normalizedUrlValue = String(urlValue ?? '').trim()
    const normalizedLinkText = String(linkText ?? '').trim() || normalizedUrlValue || 'Shop drawing'

    if (!normalizedUrlValue) {
      try {
        await updateMondayItemJsonColumn({
          boardId,
          itemId,
          columnId,
          jsonValue: {
            clear_all: true,
          },
        })
        return
      } catch {
        await updateMondayItemTextColumn({
          boardId,
          itemId,
          columnId,
          textValue: '',
        })
        return
      }
    }

    try {
      await updateMondayItemJsonColumn({
        boardId,
        itemId,
        columnId,
        jsonValue: {
          url: normalizedUrlValue,
          text: normalizedLinkText,
        },
      })
      return
    } catch {
      await updateMondayItemTextColumn({
        boardId,
        itemId,
        columnId,
        textValue: normalizedUrlValue,
      })
    }
  }

  async function clearMondayColumnValue({ boardId, itemId, columnId }) {
    try {
      await updateMondayItemJsonColumn({
        boardId,
        itemId,
        columnId,
        jsonValue: {
          clear_all: true,
        },
      })
      return
    } catch {
      await updateMondayItemTextColumn({
        boardId,
        itemId,
        columnId,
        textValue: '',
      })
    }
  }

  function extractProgressStatusColumnIds(candidateDetails) {
    return [...new Set(
      (Array.isArray(candidateDetails) ? candidateDetails : [])
        .map((entry) => String(entry?.columnId ?? '').trim())
        .filter(Boolean),
    )]
  }

  async function getOrdersProgressStatusQueueCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const ordersDatabase = collections?.databasesByDomain?.orders

    if (!ordersDatabase) {
      throw new Error('Orders database is unavailable.')
    }

    const queueCollection = ordersDatabase.collection(ordersProgressStatusQueueCollectionName)

    if (!ordersProgressStatusQueueIndexesPromise) {
      ordersProgressStatusQueueIndexesPromise = Promise.all([
        queueCollection.createIndex({ id: 1 }, { unique: true }),
        queueCollection.createIndex({ requestKey: 1 }, { unique: true }),
        queueCollection.createIndex({ statusState: 1, nextAttemptAt: 1, queuedAt: 1 }),
        queueCollection.createIndex({ statusState: 1, processingStartedAt: 1 }),
        queueCollection.createIndex({ mondayItemId: 1, updatedAt: -1 }),
      ])
    }

    try {
      await ordersProgressStatusQueueIndexesPromise
    } catch (error) {
      ordersProgressStatusQueueIndexesPromise = undefined
      throw error
    }

    return queueCollection
  }

  async function getOrdersDetailsQueueCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const ordersDatabase = collections?.databasesByDomain?.orders

    if (!ordersDatabase) {
      throw new Error('Orders database is unavailable.')
    }

    const queueCollection = ordersDatabase.collection(ordersDetailsQueueCollectionName)

    if (!ordersDetailsQueueIndexesPromise) {
      ordersDetailsQueueIndexesPromise = Promise.all([
        queueCollection.createIndex({ requestKey: 1 }, { unique: true }),
        queueCollection.createIndex({ statusState: 1, nextAttemptAt: 1, queuedAt: 1 }),
        queueCollection.createIndex({ statusState: 1, processingStartedAt: 1 }),
      ])
    }

    try {
      await ordersDetailsQueueIndexesPromise
    } catch (error) {
      ordersDetailsQueueIndexesPromise = undefined
      throw error
    }

    return queueCollection
  }

  async function enqueueMondayOrderDetailsUpdate({
    queueCollection,
    mondayItemId,
    changes,
    queuedByUid = null,
    queuedByEmail = null,
  }) {
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    if (!normalizedMondayItemId || !changes || Object.keys(changes).length === 0) {
      return null
    }

    const now = new Date().toISOString()
    const existing = await queueCollection.findOne(
      { requestKey: normalizedMondayItemId },
      { projection: { changes: 1 } },
    )
    const mergedChanges = {
      ...(existing?.changes && typeof existing.changes === 'object' ? existing.changes : {}),
      ...changes,
    }

    await queueCollection.updateOne(
      { requestKey: normalizedMondayItemId },
      {
        $set: {
          requestKey: normalizedMondayItemId,
          mondayItemId: normalizedMondayItemId,
          changes: mergedChanges,
          statusState: 'queued',
          processingStartedAt: null,
          attempts: 0,
          queuedAt: now,
          nextAttemptAt: now,
          queuedByUid,
          queuedByEmail,
          lastError: null,
          syncedAt: null,
          failedAt: null,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      { upsert: true },
    )

    return mergedChanges
  }

  async function resolveMondayOrderContext({
    mondayItemId,
    mondayOrdersCollection,
    ordersUnifiedCollection,
  }) {
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    if (!normalizedMondayItemId) {
      return null
    }

    const [unifiedDocument, mondayOrderDocument] = await Promise.all([
      ordersUnifiedCollection.findOne(
        { monday_item_id: normalizedMondayItemId },
        {
          projection: {
            _id: 0,
            monday_item_id: 1,
            monday_board_id: 1,
            monday_board_name: 1,
            Monday_url: 1,
            has_monday_record: 1,
            in_design: 1,
            is_shipped: 1,
            Monday_status: 1,
            progress_status_details: 1,
          },
        },
      ),
      mondayOrdersCollection.findOne(
        { mondayItemId: normalizedMondayItemId },
        {
          projection: {
            _id: 0,
            mondayItemId: 1,
            mondayBoardId: 1,
            mondayBoardName: 1,
            mondayBoardUrl: 1,
            statusLabel: 1,
            progressStatusDetails: 1,
          },
        },
      ),
    ])

    const boardId = String(
      unifiedDocument?.monday_board_id
      ?? mondayOrderDocument?.mondayBoardId
      ?? '',
    ).trim() || null
    const boardName = String(
      mondayOrderDocument?.mondayBoardName
      ?? unifiedDocument?.monday_board_name
      ?? '',
    ).trim() || null
    const boardUrl = String(mondayOrderDocument?.mondayBoardUrl ?? '').trim() || null
    const hasMondayRecord = Boolean(
      unifiedDocument?.has_monday_record
      ?? mondayOrderDocument,
    )
    const inDesign = Boolean(unifiedDocument?.in_design)
    const isShipped = Boolean(unifiedDocument?.is_shipped)
    const mondayStatus = String(
      unifiedDocument?.Monday_status
      ?? mondayOrderDocument?.statusLabel
      ?? '',
    ).trim() || null
    const rawProgressStatusDetails =
      (Array.isArray(unifiedDocument?.progress_status_details)
        ? unifiedDocument.progress_status_details
        : null)
      || (Array.isArray(mondayOrderDocument?.progressStatusDetails)
        ? mondayOrderDocument.progressStatusDetails
        : [])

    return {
      mondayItemId: normalizedMondayItemId,
      boardId,
      boardName,
      boardUrl,
      hasMondayRecord,
      inDesign,
      isShipped,
      mondayStatus,
      rawProgressStatusDetails,
    }
  }

  async function pullLiveMondayProgressDetails({
    boardId,
    boardName,
    boardUrl,
    mondayItemId,
  }) {
    const snapshot = await fetchMondayBoardItemsByIds({
      boardId,
      boardName,
      boardUrl,
      itemIds: [mondayItemId],
    })

    const liveOrder = Array.isArray(snapshot?.orders) ? snapshot.orders[0] : null

    if (!liveOrder) {
      throw {
        status: 404,
        message: 'Monday item was not found on the configured board.',
      }
    }

    const progressStatusColumnIds = extractProgressStatusColumnIds(liveOrder?.progressStatusDetails)
    const optionsByColumnId = progressStatusColumnIds.length > 0
      ? await fetchMondayStatusColumnOptions({
        boardId,
        columnIds: progressStatusColumnIds,
      })
      : {}

    return {
      liveOrder,
      resolvedBoardName: String(snapshot?.board?.name ?? boardName ?? '').trim() || null,
      resolvedBoardUrl: String(snapshot?.board?.url ?? boardUrl ?? '').trim() || null,
      progressStatusDetails: normalizeProgressStatusDetails(
        liveOrder?.progressStatusDetails,
        optionsByColumnId,
      ),
    }
  }

  async function syncMondayProgressDetailsToCollections({
    mondayItemId,
    boardId,
    boardName,
    boardUrl,
    liveOrder,
    progressStatusDetails,
    mondayOrdersCollection,
    ordersUnifiedCollection,
  }) {
    const now = new Date().toISOString()
    const mondayStatus = String(liveOrder?.statusLabel ?? '').trim() || null
    const mondayUpdatedAt = String(liveOrder?.updatedAt ?? '').trim() || now
    const isShipped = Boolean(liveOrder?.isDone || liveOrder?.shippedAt)
    const isProductionStarted = Boolean(isShipped || liveOrder?.isProductionStarted)
    const liveShippedAt = String(liveOrder?.shippedAt ?? '').trim() || null
    const shippedSetFields = liveShippedAt
      ? {
        shipped_at: liveShippedAt,
        shipped_at_inferred: false,
      }
      : isShipped
        ? {
          shipped_at_inferred: true,
        }
        : {
          shipped_at: null,
          shipped_at_inferred: null,
        }

    await Promise.all([
      mondayOrdersCollection.updateOne(
        { mondayItemId },
        {
          $set: {
            mondayItemId,
            mondayBoardId: boardId,
            mondayBoardName: boardName,
            mondayBoardUrl: boardUrl,
            statusLabel: mondayStatus,
            stageLabel: String(liveOrder?.stageLabel ?? '').trim() || null,
            readyLabel: String(liveOrder?.readyLabel ?? '').trim() || null,
            progressStatusDetails,
            progressPercent: Number.isFinite(Number(liveOrder?.progressPercent))
              ? Number(liveOrder.progressPercent)
              : null,
            orderDate: String(liveOrder?.orderDate ?? '').trim() || null,
            dueDate: String(liveOrder?.dueDate ?? '').trim() || null,
            computedDueDate: String(liveOrder?.computedDueDate ?? '').trim() || null,
            effectiveDueDate: String(liveOrder?.effectiveDueDate ?? '').trim() || null,
            leadTimeDays: Number.isFinite(Number(liveOrder?.leadTimeDays))
              ? Number(liveOrder.leadTimeDays)
              : null,
            shippedAt: String(liveOrder?.shippedAt ?? '').trim() || null,
            isDone: isShipped,
            isProductionStarted,
            isLate: Boolean(liveOrder?.isLate),
            daysLate: Number.isFinite(Number(liveOrder?.daysLate))
              ? Number(liveOrder.daysLate)
              : 0,
            mondayItemUrl: String(liveOrder?.itemUrl ?? '').trim() || null,
            bench: String(liveOrder?.bench ?? '').trim() || null,
            mondayUpdatedAt,
            updatedAt: now,
            lastSeenAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      ),
      ordersUnifiedCollection.updateOne(
        { monday_item_id: mondayItemId },
        {
          $set: {
            has_monday_record: true,
            monday_item_id: mondayItemId,
            monday_board_id: boardId,
            monday_board_name: boardName,
            Monday_url: String(liveOrder?.itemUrl ?? '').trim() || null,
            Monday_status: isShipped ? 'Shipped' : mondayStatus,
            job_status: isShipped ? 'Shipped' : mondayStatus,
            is_shipped: isShipped,
            is_production_started: isProductionStarted,
            ...shippedSetFields,
            Due_date: String(liveOrder?.dueDate ?? '').trim() || null,
            Lead_time_days: Number.isFinite(Number(liveOrder?.leadTimeDays))
              ? Number(liveOrder.leadTimeDays)
              : null,
            progress_percent: Number.isFinite(Number(liveOrder?.progressPercent))
              ? Number(liveOrder.progressPercent)
              : null,
            progress_status_details: progressStatusDetails,
            bench: String(liveOrder?.bench ?? '').trim() || null,
            order_date: String(liveOrder?.orderDate ?? '').trim() || null,
            monday_updated_at: mondayUpdatedAt,
            updatedAt: now,
            lastSyncedAt: now,
          },
        },
      ),
    ])

    return {
      mondayStatus,
      mondayUpdatedAt,
      isShipped,
    }
  }

  function buildMondayProgressDetailsResponse({
    hasMondayRecord,
    inDesign,
    isShipped,
    liveOrder,
    mondayItemId,
    mondayStatus,
    mondayUpdatedAt,
    progressStatusDetails,
  }) {
    return {
      generatedAt: new Date().toISOString(),
      order: {
        mondayItemId,
        mondayStatus,
        rowStatus: resolveRowStatusLabel({
          hasMondayRecord,
          inDesign,
          isShipped,
          mondayStatus,
          progressStatusDetails,
        }),
        progressPercent: Number.isFinite(Number(liveOrder?.progressPercent))
          ? Number(liveOrder.progressPercent)
          : null,
        progressStatusDetails,
        mondayUpdatedAt,
      },
    }
  }

  async function processQueuedMondayProgressStatusUpdates(options = {}) {
    const maxJobsInput = Number(options?.maxJobs)
    const maxJobs = Number.isFinite(maxJobsInput)
      ? Math.min(250, Math.max(1, Math.floor(maxJobsInput)))
      : ordersProgressStatusQueueDefaultBatchSize
    const processorSource = String(options?.source ?? '').trim() || 'internal'

    if (ordersProgressStatusQueueInFlight) {
      return ordersProgressStatusQueueInFlight
    }

    const processorPromise = (async () => {
      const collections = await getCollections()
      const {
        mondayOrdersCollection,
        ordersUnifiedCollection,
      } = collections
      const queueCollection = await getOrdersProgressStatusQueueCollection(collections)
      const contextByItemId = new Map()
      const optionsByBoardAndColumn = new Map()
      const touchedOrders = new Map()
      const syncWarnings = []

      let processedCount = 0
      let syncedCount = 0
      let requeuedCount = 0
      let failedCount = 0

      while (processedCount < maxJobs) {
        const nowIso = new Date().toISOString()
        const staleProcessingBeforeIso = new Date(
          Date.now() - ordersProgressStatusQueueProcessingStaleMs,
        ).toISOString()
        const claimedJob = await queueCollection.findOneAndUpdate(
          {
            $or: [
              {
                statusState: 'queued',
                nextAttemptAt: {
                  $lte: nowIso,
                },
              },
              {
                statusState: 'processing',
                processingStartedAt: {
                  $lte: staleProcessingBeforeIso,
                },
              },
            ],
          },
          {
            $set: {
              statusState: 'processing',
              processingSource: processorSource,
              processingStartedAt: nowIso,
              updatedAt: nowIso,
            },
          },
          {
            sort: {
              nextAttemptAt: 1,
              queuedAt: 1,
              createdAt: 1,
            },
            returnDocument: 'after',
            projection: {
              _id: 0,
            },
          },
        )

        if (!claimedJob) {
          break
        }

        processedCount += 1

        const jobId = String(claimedJob?.id ?? '').trim()
        const mondayItemId = String(claimedJob?.mondayItemId ?? '').trim()
        const columnId = String(claimedJob?.columnId ?? '').trim()
        const queuedStatus = normalizeQueuedProgressStatusValue(claimedJob?.status)
        const previousAttempts = Number.isFinite(Number(claimedJob?.attempts))
          ? Number(claimedJob.attempts)
          : 0

        const finalizeQueueFailure = async (message, options = {}) => {
          const retryable = options.retryable !== false
          const normalizedMessage = normalizeOptionalShortText(message, 280)
            || 'Could not process queued Monday status update.'
          const nextAttemptNumber = previousAttempts + 1
          const now = new Date().toISOString()

          if (retryable && nextAttemptNumber < ordersProgressStatusQueueMaxAttempts) {
            await queueCollection.updateOne(
              { id: jobId },
              {
                $set: {
                  statusState: 'queued',
                  attempts: nextAttemptNumber,
                  nextAttemptAt: computeQueuedProgressStatusRetryAt(nextAttemptNumber),
                  lastError: normalizedMessage,
                  updatedAt: now,
                },
              },
            )
            requeuedCount += 1
            return
          }

          await queueCollection.updateOne(
            { id: jobId },
            {
              $set: {
                statusState: 'failed',
                attempts: nextAttemptNumber,
                failedAt: now,
                lastError: normalizedMessage,
                updatedAt: now,
              },
            },
          )
          failedCount += 1
        }

        if (!jobId || !mondayItemId || !columnId) {
          await finalizeQueueFailure('Queued status update is missing required fields.', {
            retryable: false,
          })
          continue
        }

        let context = contextByItemId.has(mondayItemId)
          ? contextByItemId.get(mondayItemId)
          : undefined

        if (context === undefined) {
          try {
            context = await resolveMondayOrderContext({
              mondayItemId,
              mondayOrdersCollection,
              ordersUnifiedCollection,
            })
          } catch (contextError) {
            await finalizeQueueFailure(contextError?.message, { retryable: true })
            continue
          }

          contextByItemId.set(mondayItemId, context ?? null)
        }

        if (!context?.boardId) {
          await finalizeQueueFailure('Could not resolve Monday board for this order.', {
            retryable: false,
          })
          continue
        }

        const knownColumnIds = extractProgressStatusColumnIds(context.rawProgressStatusDetails)

        if (knownColumnIds.length > 0 && !knownColumnIds.includes(columnId)) {
          await finalizeQueueFailure(
            'Column is not part of this order\'s tracked Monday status columns.',
            { retryable: false },
          )
          continue
        }

        let resolvedStatusLabel = ''

        if (queuedStatus) {
          const optionsKey = `${context.boardId}:${columnId}`
          let optionsForColumn = optionsByBoardAndColumn.get(optionsKey)

          if (!optionsForColumn) {
            try {
              const optionsPayload = await fetchMondayStatusColumnOptions({
                boardId: context.boardId,
                columnIds: [columnId],
              })
              optionsForColumn = normalizeProgressDetailOptions(optionsPayload?.[columnId])
              optionsByBoardAndColumn.set(optionsKey, optionsForColumn)
            } catch (optionsError) {
              await finalizeQueueFailure(optionsError?.message, { retryable: true })
              continue
            }
          }

          const resolvedStatusResult = resolveMondayProgressStatusLabel({
            status: queuedStatus,
            columnId,
            optionsByColumnId: {
              [columnId]: optionsForColumn,
            },
          })

          if (!resolvedStatusResult.ok) {
            await finalizeQueueFailure(resolvedStatusResult.error, { retryable: false })
            continue
          }

          resolvedStatusLabel = resolvedStatusResult.statusLabel
        }

        try {
          await updateMondayItemStatusColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId,
            statusLabel: resolvedStatusLabel,
          })

          const syncedAt = new Date().toISOString()

          await queueCollection.updateOne(
            { id: jobId },
            {
              $set: {
                statusState: 'synced',
                resolvedStatusLabel,
                syncedAt,
                lastError: null,
                updatedAt: syncedAt,
              },
            },
          )

          touchedOrders.set(mondayItemId, context)
          syncedCount += 1
        } catch (updateError) {
          await finalizeQueueFailure(updateError?.message, { retryable: true })
        }
      }

      let collectionSyncCount = 0

      for (const [mondayItemId, context] of touchedOrders.entries()) {
        try {
          const {
            liveOrder,
            resolvedBoardName,
            resolvedBoardUrl,
            progressStatusDetails,
          } = await pullLiveMondayProgressDetails({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            mondayItemId,
          })

          await syncMondayProgressDetailsToCollections({
            mondayItemId,
            boardId: context.boardId,
            boardName: resolvedBoardName,
            boardUrl: resolvedBoardUrl,
            liveOrder,
            progressStatusDetails,
            mondayOrdersCollection,
            ordersUnifiedCollection,
          })

          collectionSyncCount += 1
        } catch (syncError) {
          syncWarnings.push(
            normalizeOptionalShortText(syncError?.message, 280)
            || `Queued status sync applied in Monday for ${mondayItemId}, but local DB sync failed.`,
          )
        }
      }

      return {
        processedCount,
        syncedCount,
        requeuedCount,
        failedCount,
        collectionSyncCount,
        syncWarnings,
      }
    })()

    ordersProgressStatusQueueInFlight = processorPromise

    try {
      return await processorPromise
    } finally {
      if (ordersProgressStatusQueueInFlight === processorPromise) {
        ordersProgressStatusQueueInFlight = null
      }
    }
  }

  async function processQueuedMondayOrderDetailsUpdates(options = {}) {
    const maxJobs = Math.min(120, Math.max(1, Number(options?.maxJobs) || 60))
    const processorSource = String(options?.source ?? '').trim() || 'internal'

    if (ordersDetailsQueueInFlight) {
      return ordersDetailsQueueInFlight
    }

    const processorPromise = (async () => {
      const collections = await getCollections()
      const { mondayOrdersCollection, ordersUnifiedCollection } = collections
      const queueCollection = await getOrdersDetailsQueueCollection(collections)
      let processedCount = 0
      let syncedCount = 0
      let requeuedCount = 0
      let failedCount = 0

      while (processedCount < maxJobs) {
        const now = new Date().toISOString()
        const staleBefore = new Date(Date.now() - ordersDetailsQueueProcessingStaleMs).toISOString()
        const claimedJob = await queueCollection.findOneAndUpdate(
          {
            $or: [
              { statusState: 'queued', nextAttemptAt: { $lte: now } },
              { statusState: 'processing', processingStartedAt: { $lte: staleBefore } },
            ],
          },
          {
            $set: {
              statusState: 'processing',
              processingSource: processorSource,
              processingStartedAt: now,
              updatedAt: now,
            },
          },
          { sort: { nextAttemptAt: 1, queuedAt: 1 }, returnDocument: 'after', projection: { _id: 0 } },
        )

        if (!claimedJob) break
        processedCount += 1

        const mondayItemId = String(claimedJob?.mondayItemId ?? '').trim()
        const changes = claimedJob?.changes && typeof claimedJob.changes === 'object'
          ? claimedJob.changes
          : {}
        const previousAttempts = Number(claimedJob?.attempts) || 0
        const fail = async (error, retryable = true) => {
          const attempts = previousAttempts + 1
          const updatedAt = new Date().toISOString()
          const lastError = normalizeOptionalShortText(error?.message ?? error, 280)
            || 'Could not sync queued order changes to Monday.'
          const canRetry = retryable && attempts < ordersDetailsQueueMaxAttempts
          await queueCollection.updateOne(
            {
              id: claimedJob.id,
              statusState: 'processing',
              processingStartedAt: claimedJob.processingStartedAt,
            },
            {
              $set: canRetry
                ? {
                  statusState: 'queued', attempts, nextAttemptAt: computeQueuedProgressStatusRetryAt(attempts),
                  lastError, updatedAt,
                }
                : {
                  statusState: 'failed', attempts, failedAt: updatedAt, lastError, updatedAt,
                },
            },
          )
          if (canRetry) requeuedCount += 1
          else failedCount += 1
        }

        if (!mondayItemId || Object.keys(changes).length === 0) {
          await fail('Queued order edit is missing required fields.', false)
          continue
        }

        try {
          const context = await resolveMondayOrderContext({
            mondayItemId,
            mondayOrdersCollection,
            ordersUnifiedCollection,
          })
          if (!context?.boardId) throw new Error('Could not resolve Monday board for this order.')

          const snapshot = await fetchMondayBoardItemsByIds({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            itemIds: [mondayItemId],
          })
          if (!Array.isArray(snapshot?.orders) || !snapshot.orders[0]) {
            throw new Error('Monday item was not found on the configured board.')
          }

          const columns = snapshot?.columnDetection ?? {}
          const writeText = async (changeName, columnName) => {
            if (!Object.prototype.hasOwnProperty.call(changes, changeName)) return
            const columnId = String(columns?.[columnName] ?? '').trim()
            if (!columnId) throw new Error(`${changeName} column could not be resolved for this board.`)
            await updateMondayItemTextColumn({
              boardId: context.boardId, itemId: mondayItemId, columnId, textValue: String(changes[changeName] ?? ''),
            })
          }
          const writeDate = async (changeName, columnName) => {
            if (!Object.prototype.hasOwnProperty.call(changes, changeName)) return
            const columnId = String(columns?.[columnName] ?? '').trim()
            if (!columnId) throw new Error(`${changeName} column could not be resolved for this board.`)
            await updateMondayDateColumnValue({
              boardId: context.boardId, itemId: mondayItemId, columnId, dateValue: changes[changeName],
            })
          }

          if (Object.prototype.hasOwnProperty.call(changes, 'orderName')) {
            await updateMondayItemName({
              boardId: context.boardId,
              itemId: mondayItemId,
              itemName: String(changes.orderName ?? ''),
            })
          }
          await writeText('poNumber', 'poNumberColumnId')
          await writeText('notes', 'notesColumnId')
          await writeText('description', 'descriptionColumnId')
          await writeText('bench', 'benchColumnId')
          await writeDate('dueDate', columns?.dueDateColumnId ? 'dueDateColumnId' : 'leadTimeColumnId')
          await writeText('leadTimeDays', 'leadTimeColumnId')
          await writeDate('podDate', 'shipDateColumnId')

          const syncedAt = new Date().toISOString()
          await queueCollection.updateOne(
            {
              id: claimedJob.id,
              statusState: 'processing',
              processingStartedAt: claimedJob.processingStartedAt,
            },
            { $set: { statusState: 'synced', syncedAt, lastError: null, updatedAt: syncedAt } },
          )
          syncedCount += 1
        } catch (error) {
          await fail(error)
        }
      }

      return { processedCount, syncedCount, requeuedCount, failedCount }
    })()

    ordersDetailsQueueInFlight = processorPromise
    try {
      return await processorPromise
    } finally {
      if (ordersDetailsQueueInFlight === processorPromise) ordersDetailsQueueInFlight = null
    }
  }


  return {
    buildMondayProgressDetailsResponse,
    clearMondayColumnValue,
    extractProgressStatusColumnIds,
    getOrdersProgressStatusQueueCollection,
    getOrdersDetailsQueueCollection,
    enqueueMondayOrderDetailsUpdate,
    processQueuedMondayProgressStatusUpdates,
    processQueuedMondayOrderDetailsUpdates,
    pullLiveMondayProgressDetails,
    resolveMondayOrderContext,
    syncMondayProgressDetailsToCollections,
    updateMondayDateColumnValue,
    updateMondayLinkColumnValue,
  }
}
