// Monday progress + order-edit endpoints: live stage-status reads, single
// and bulk status writes (bulk goes through the retry queue; single falls
// back to it when Monday is unreachable), order-number changes with linked-
// history protection, and order-details edits with Monday write-through.

import { randomUUID } from 'node:crypto'
import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import {
  applyStatusToStoredProgressDetails,
  buildOrderIdentityFilter,
  enqueueMondayProgressStatusUpdates,
  hasOwnField,
  normalizeIsoDateInput,
  normalizeOrderNumberInput,
  normalizeQueuedProgressStatusValue,
  resolveMondayProgressStatusLabel,
} from './order-shared.mjs'

export function registerOrderProgressRoutes(app, {
  authApprovalApproved,
  authRoleAdmin,
  buildMondayProgressDetailsResponse,
  clearMondayColumnValue,
  extractProgressStatusColumnIds,
  fetchMondayBoardItemsByIds,
  fetchMondayStatusColumnOptions,
  getCollections,
  getOrdersProgressStatusQueueCollection,
  mobileAlertTargetModeSelected,
  normalizeEmail,
  processQueuedMondayProgressStatusUpdates,
  pullLiveMondayProgressDetails,
  refreshOrdersUnifiedCollection,
  requireFirebaseAuth,
  requireManagerOrAdminRole,
  resolveMondayOrderContext,
  syncMondayProgressDetailsToCollections,
  toPublicAuthUser,
  toPublicMobileAlert,
  updateMondayDateColumnValue,
  updateMondayItemName,
  updateMondayItemStatusColumn,
  updateMondayItemTextColumn,
  updateMondayLinkColumnValue,
}) {
  const linkedOrderNumberChangeMessage =
    'Sorry, this cannot be done because of its linked. If it needs to be done, contact admin.'

  function hasLinkedOrderNumberBlockers(linkState) {
    return Boolean(
      linkState?.hasTimesheetEntries
      || linkState?.hasTimesheetProgressHistory
      || linkState?.hasQuickBooksRecordOnOrder
      || linkState?.hasQuickBooksOrderForCurrentNumber
      || linkState?.hasQuickBooksOrderForNextNumber,
    )
  }

  async function resolveOrderNumberChangeLinkState({
    entriesCollection,
    orderProgressCollection,
    ordersUnifiedCollection,
    mondayItemId,
    currentOrderNumber,
    nextOrderNumber,
    hasQuickBooksRecordOnOrder,
  }) {
    const normalizedCurrentOrderNumber = normalizeOrderNumberInput(currentOrderNumber)
    const normalizedNextOrderNumber = normalizeOrderNumberInput(nextOrderNumber)
    const normalizedMondayItemId = String(mondayItemId ?? '').trim()

    const timesheetEntriesPromise = normalizedCurrentOrderNumber
      ? entriesCollection.countDocuments(
        { jobName: normalizedCurrentOrderNumber },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const timesheetProgressPromise = normalizedCurrentOrderNumber
      ? orderProgressCollection.countDocuments(
        { jobName: normalizedCurrentOrderNumber },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const quickBooksCurrentPromise = normalizedCurrentOrderNumber
      ? ordersUnifiedCollection.countDocuments(
        {
          has_quickbooks_record: true,
          order_number: normalizedCurrentOrderNumber,
        },
        { limit: 1 },
      )
      : Promise.resolve(0)
    const quickBooksNextPromise = normalizedNextOrderNumber
      ? ordersUnifiedCollection.countDocuments(
        {
          has_quickbooks_record: true,
          order_number: normalizedNextOrderNumber,
          ...(normalizedMondayItemId
            ? { monday_item_id: { $ne: normalizedMondayItemId } }
            : {}),
        },
        { limit: 1 },
      )
      : Promise.resolve(0)

    const [
      timesheetEntriesCount,
      timesheetProgressCount,
      quickBooksCurrentCount,
      quickBooksNextCount,
    ] = await Promise.all([
      timesheetEntriesPromise,
      timesheetProgressPromise,
      quickBooksCurrentPromise,
      quickBooksNextPromise,
    ])

    return {
      hasTimesheetEntries: Number(timesheetEntriesCount) > 0,
      hasTimesheetProgressHistory: Number(timesheetProgressCount) > 0,
      hasQuickBooksRecordOnOrder: Boolean(hasQuickBooksRecordOnOrder),
      hasQuickBooksOrderForCurrentNumber: Number(quickBooksCurrentCount) > 0,
      hasQuickBooksOrderForNextNumber: Number(quickBooksNextCount) > 0,
    }
  }

  async function createOrderNumberChangeAdminAlert({
    authUsersCollection,
    mobileAlertsCollection,
    publicUser,
    mondayItemId,
    currentOrderNumber,
    requestedOrderNumber,
    linkedState,
  }) {
    const adminUsers = await authUsersCollection
      .find(
        {
          approvalStatus: authApprovalApproved,
          role: authRoleAdmin,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      .toArray()

    const recipientUids = adminUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => Boolean(user?.uid && user.isApproved && user.isAdmin))
      .map((user) => String(user.uid))

    if (recipientUids.length === 0) {
      throw {
        status: 404,
        message: 'No approved admin recipients found.',
      }
    }

    const senderLabel = normalizeOptionalShortText(publicUser?.displayName, 120)
      || normalizeOptionalShortText(publicUser?.email, 200)
      || 'A team member'
    const currentValue = normalizeOrderNumberInput(currentOrderNumber) || '(unknown)'
    const nextValue = normalizeOrderNumberInput(requestedOrderNumber) || '(unknown)'

    const reasonParts = []

    if (linkedState?.hasTimesheetEntries || linkedState?.hasTimesheetProgressHistory) {
      reasonParts.push('linked to timesheet history')
    }

    if (
      linkedState?.hasQuickBooksRecordOnOrder
      || linkedState?.hasQuickBooksOrderForCurrentNumber
      || linkedState?.hasQuickBooksOrderForNextNumber
    ) {
      reasonParts.push('linked in QuickBooks')
    }

    const reasonText = reasonParts.length > 0
      ? ` Blocked reason: ${reasonParts.join(' and ')}.`
      : ''
    const now = new Date().toISOString()
    const alertDocument = {
      id: randomUUID(),
      title: 'Order Number Change Request',
      message:
        `${senderLabel} requested order number change ${currentValue} -> ${nextValue} for Monday item ${mondayItemId}.`
        + reasonText,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: String(publicUser?.uid ?? '').trim() || null,
      createdByEmail: normalizeEmail(publicUser?.email) || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: {
        type: 'orders_order_number_change_request',
        mondayItemId: String(mondayItemId ?? '').trim() || null,
        currentOrderNumber: currentValue,
        requestedOrderNumber: nextValue,
        sourceUid: String(publicUser?.uid ?? '').trim() || null,
        sourceEmail: normalizeEmail(publicUser?.email) || null,
        linkedState,
      },
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)

    return alertDocument
  }

  // GET /api/orders/monday/progress-details — pull live Monday status details
  // for one item, including each status column's dropdown options.
  app.get(
    '/api/orders/monday/progress-details',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.query?.mondayItemId ?? '').trim()

        if (!mondayItemId) {
          return res.status(400).json({
            error: 'mondayItemId is required.',
          })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

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

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        return res.json(buildMondayProgressDetailsResponse({
          hasMondayRecord: true,
          inDesign: Boolean(context?.inDesign),
          isShipped: syncResult.isShipped,
          liveOrder,
          mondayItemId,
          mondayStatus: syncResult.mondayStatus,
          mondayUpdatedAt: syncResult.mondayUpdatedAt,
          progressStatusDetails,
        }))
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/progress-status — update a single Monday status
  // column from the Orders popup dropdowns.
  app.post(
    '/api/orders/monday/progress-status',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const columnId = String(req.body?.columnId ?? '').trim()
        const hasStatusField = Boolean(
          req.body
          && Object.prototype.hasOwnProperty.call(req.body, 'status'),
        )
        const status = hasStatusField
          ? String(req.body?.status ?? '').trim()
          : ''

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!columnId) {
          return res.status(400).json({ error: 'columnId is required.' })
        }

        if (!hasStatusField) {
          return res.status(400).json({ error: 'status is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const knownColumnIds = extractProgressStatusColumnIds(context.rawProgressStatusDetails)

        if (knownColumnIds.length > 0 && !knownColumnIds.includes(columnId)) {
          return res.status(400).json({
            error: 'Column is not part of this order\'s tracked Monday status columns.',
          })
        }

        try {
          const optionsByColumnId = await fetchMondayStatusColumnOptions({
            boardId: context.boardId,
            columnIds: [columnId],
          })
          let resolvedStatusLabel = ''

          if (status) {
            const resolvedStatusResult = resolveMondayProgressStatusLabel({
              status,
              columnId,
              optionsByColumnId,
            })

            if (!resolvedStatusResult.ok) {
              return res.status(400).json({
                error: resolvedStatusResult.error,
              })
            }

            resolvedStatusLabel = resolvedStatusResult.statusLabel
          }

          await updateMondayItemStatusColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId,
            statusLabel: resolvedStatusLabel,
          })

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

          const syncResult = await syncMondayProgressDetailsToCollections({
            mondayItemId,
            boardId: context.boardId,
            boardName: resolvedBoardName,
            boardUrl: resolvedBoardUrl,
            liveOrder,
            progressStatusDetails,
            mondayOrdersCollection,
            ordersUnifiedCollection,
          })

          return res.json({
            ...buildMondayProgressDetailsResponse({
              hasMondayRecord: true,
              inDesign: Boolean(context?.inDesign),
              isShipped: syncResult.isShipped,
              liveOrder,
              mondayItemId,
              mondayStatus: syncResult.mondayStatus,
              mondayUpdatedAt: syncResult.mondayUpdatedAt,
              progressStatusDetails,
            }),
            ok: true,
          })
        } catch (mondayError) {
          // Monday is unreachable (outage or rate limit). Never lose the
          // edit: apply it to the website's stored data right away and queue
          // the Monday push, which retries with backoff until it lands.
          const now = new Date().toISOString()
          const patchedDetails = applyStatusToStoredProgressDetails(
            context.rawProgressStatusDetails,
            columnId,
            status,
          )

          await Promise.all([
            ordersUnifiedCollection.updateOne(
              { monday_item_id: mondayItemId },
              {
                $set: {
                  progress_status_details: patchedDetails,
                  updatedAt: now,
                },
              },
            ),
            mondayOrdersCollection.updateOne(
              { mondayItemId },
              {
                $set: {
                  progressStatusDetails: patchedDetails,
                  updatedAt: now,
                },
              },
            ),
          ])

          const queueCollection = await getOrdersProgressStatusQueueCollection()

          await enqueueMondayProgressStatusUpdates({
            queueCollection,
            updates: [{ mondayItemId, columnId, status }],
            queuedByUid: String(req.authUser?.uid ?? '').trim() || null,
            queuedByEmail: normalizeEmail(req.authUser?.email) || null,
          })

          console.warn('Monday progress-status update queued after live push failed.', {
            mondayItemId,
            columnId,
            error: normalizeOptionalShortText(mondayError?.message, 280) || 'unknown error',
          })

          return res.json({
            ...buildMondayProgressDetailsResponse({
              hasMondayRecord: true,
              inDesign: Boolean(context?.inDesign),
              isShipped: Boolean(context?.isShipped),
              liveOrder: null,
              mondayItemId,
              mondayStatus: context?.mondayStatus ?? null,
              mondayUpdatedAt: now,
              progressStatusDetails: patchedDetails,
            }),
            ok: true,
            queued: true,
            warning: 'Monday is unreachable right now. The update was saved on the website and will sync to Monday automatically.',
          })
        }
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/progress-status/bulk — queue many Monday status
  // updates quickly, then sync to Monday in background.
  app.post(
    '/api/orders/monday/progress-status/bulk',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const rawUpdates = Array.isArray(req.body?.updates)
          ? req.body.updates
          : []

        if (rawUpdates.length === 0) {
          return res.status(400).json({ error: 'updates is required.' })
        }

        if (rawUpdates.length > 250) {
          return res.status(400).json({
            error: 'Too many updates in one request. Maximum is 250.',
          })
        }

        const updates = rawUpdates.map((entry) => {
          const hasStatusField = Boolean(
            entry && Object.prototype.hasOwnProperty.call(entry, 'status'),
          )

          return {
            mondayItemId: String(entry?.mondayItemId ?? '').trim(),
            columnId: String(entry?.columnId ?? '').trim(),
            hasStatusField,
            status: hasStatusField
              ? String(entry?.status ?? '').trim()
              : '',
          }
        })

        const malformedUpdateIndex = updates.findIndex((entry) => (
          !entry.mondayItemId
          || !entry.columnId
          || !entry.hasStatusField
        ))

        if (malformedUpdateIndex >= 0) {
          return res.status(400).json({
            error: `Invalid update at index ${malformedUpdateIndex}. mondayItemId, columnId, and status are required.`,
          })
        }

        const collections = await getCollections()
        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = collections
        const queueCollection = await getOrdersProgressStatusQueueCollection(collections)
        const contextByItemId = new Map()
        const acceptedUpdates = []
        const failedUpdates = []

        for (const update of updates) {
          const mondayItemId = update.mondayItemId
          const columnId = update.columnId
          const status = normalizeQueuedProgressStatusValue(update.status)
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
              failedUpdates.push({
                mondayItemId,
                columnId,
                status,
                error:
                  normalizeOptionalShortText(contextError?.message, 280)
                  || 'Could not resolve Monday board for this order.',
              })
              continue
            }

            contextByItemId.set(mondayItemId, context ?? null)
          }

          if (!context?.boardId) {
            failedUpdates.push({
              mondayItemId,
              columnId,
              status,
              error: 'Could not resolve Monday board for this order.',
            })
            continue
          }

          const knownColumnIds = extractProgressStatusColumnIds(context.rawProgressStatusDetails)

          if (knownColumnIds.length > 0 && !knownColumnIds.includes(columnId)) {
            failedUpdates.push({
              mondayItemId,
              columnId,
              status,
              error: 'Column is not part of this order\'s tracked Monday status columns.',
            })
            continue
          }

          acceptedUpdates.push({
            mondayItemId,
            columnId,
            status,
          })
        }

        const queuedUpdates = await enqueueMondayProgressStatusUpdates({
          queueCollection,
          updates: acceptedUpdates,
          queuedByUid: String(req.authUser?.uid ?? '').trim() || null,
          queuedByEmail: normalizeEmail(req.authUser?.email) || null,
        })

        if (queuedUpdates.length > 0) {
          void processQueuedMondayProgressStatusUpdates({
            maxJobs: Math.max(1, queuedUpdates.length),
            source: 'bulk_enqueue',
          }).catch((queueError) => {
            console.error('orders progress-status queue processor failed after enqueue.', queueError)
          })
        }

        const warningMessage = queuedUpdates.length > 0
          ? 'Saved to backend. Monday sync is running in the background and may take a little time.'
          : null
        const warnings = warningMessage ? [warningMessage] : []

        return res.json({
          ok: failedUpdates.length === 0,
          updatedCount: queuedUpdates.length,
          queuedCount: queuedUpdates.length,
          failedCount: failedUpdates.length,
          failedUpdates,
          queuedUpdates: queuedUpdates.map((entry) => ({
            mondayItemId: entry.mondayItemId,
            columnId: entry.columnId,
            status: entry.status,
          })),
          orders: [],
          warnings,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/order-number — update the Monday order number
  // (ack column when available; fallback to item name). Non-admin updates are
  // blocked when linked to timesheet history or QuickBooks.
  app.post(
    '/api/orders/monday/order-number',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedOrderNumber = normalizeOrderNumberInput(req.body?.orderNumber)
        const requestedCurrentOrderNumber = normalizeOrderNumberInput(req.body?.currentOrderNumber)
        const publicUser = toPublicAuthUser(req.authUser)

        if (!publicUser?.isApproved) {
          return res.status(403).json({
            error: 'Approved access is required.',
          })
        }

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedOrderNumber) {
          return res.status(400).json({ error: 'orderNumber is required.' })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
          entriesCollection,
          orderProgressCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const [existingOrderDocument, liveSnapshot] = await Promise.all([
          ordersUnifiedCollection.findOne(
            { monday_item_id: mondayItemId },
            {
              projection: {
                _id: 0,
                monday_item_id: 1,
                order_number: 1,
                has_quickbooks_record: 1,
              },
            },
          ),
          fetchMondayBoardItemsByIds({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            itemIds: [mondayItemId],
          }),
        ])

        const liveOrder = Array.isArray(liveSnapshot?.orders)
          ? liveSnapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const currentOrderNumber =
          normalizeOrderNumberInput(existingOrderDocument?.order_number)
          || normalizeOrderNumberInput(liveOrder?.jobNumber)
          || requestedCurrentOrderNumber

        if (!currentOrderNumber) {
          return res.status(400).json({
            error: 'Current order number could not be resolved for this Monday item.',
          })
        }

        if (requestedOrderNumber === currentOrderNumber) {
          return res.json({
            ok: true,
            noChange: true,
            order: {
              mondayItemId,
              orderNumber: currentOrderNumber,
              previousOrderNumber: currentOrderNumber,
            },
          })
        }

        const conflictingOrder = await ordersUnifiedCollection.findOne(
          {
            order_number: requestedOrderNumber,
            monday_item_id: { $ne: mondayItemId },
          },
          {
            projection: {
              _id: 0,
              monday_item_id: 1,
            },
          },
        )

        if (conflictingOrder) {
          return res.status(409).json({
            error: 'This order number is already assigned to another order.',
          })
        }

        const linkedState = await resolveOrderNumberChangeLinkState({
          entriesCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
          mondayItemId,
          currentOrderNumber,
          nextOrderNumber: requestedOrderNumber,
          hasQuickBooksRecordOnOrder: Boolean(existingOrderDocument?.has_quickbooks_record),
        })

        if (!publicUser.isAdmin && hasLinkedOrderNumberBlockers(linkedState)) {
          return res.status(403).json({
            error: linkedOrderNumberChangeMessage,
            code: 'ORDER_NUMBER_CHANGE_REQUIRES_ADMIN',
            canContactAdmin: true,
            linkedState,
          })
        }

        const orderNumberColumnId = String(liveSnapshot?.columnDetection?.ackColumnId ?? '').trim() || null

        if (orderNumberColumnId) {
          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: orderNumberColumnId,
            textValue: requestedOrderNumber,
          })
        } else {
          await updateMondayItemName({
            boardId: context.boardId,
            itemId: mondayItemId,
            itemName: requestedOrderNumber,
          })
        }

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const now = new Date().toISOString()
        const refreshedOrderNumber =
          normalizeOrderNumberInput(refreshedLiveOrder?.jobNumber)
          || requestedOrderNumber
        const refreshedOrderName = normalizeOptionalShortText(refreshedLiveOrder?.name, 250) || null

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                jobNumber: refreshedOrderNumber,
                orderName: refreshedOrderName,
                mondayBoardId: context.boardId,
                mondayBoardName: resolvedBoardName,
                mondayBoardUrl: resolvedBoardUrl,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
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
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Monday_url:
                  String(refreshedLiveOrder?.itemUrl ?? '').trim()
                  || resolvedBoardUrl
                  || null,
                order_number: refreshedOrderNumber,
                order_name: refreshedOrderName,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Order saved to Monday, but unified refresh failed.'
        }

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_number: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            previousOrderNumber: currentOrderNumber,
            orderNumber:
              normalizeOrderNumberInput(updatedOrderDocument?.order_number)
              || refreshedOrderNumber,
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          updatedVia: orderNumberColumnId
            ? 'monday_order_number_column'
            : 'monday_item_name',
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/order-number/contact-admin — send an admin bell
  // request when a linked order-number change requires admin action.
  app.post(
    '/api/orders/monday/order-number/contact-admin',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const requestedOrderNumber = normalizeOrderNumberInput(
          req.body?.requestedOrderNumber ?? req.body?.orderNumber,
        )
        const requestedCurrentOrderNumber = normalizeOrderNumberInput(req.body?.currentOrderNumber)
        const publicUser = toPublicAuthUser(req.authUser)

        if (!publicUser?.isApproved) {
          return res.status(403).json({
            error: 'Approved access is required.',
          })
        }

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (!requestedOrderNumber) {
          return res.status(400).json({ error: 'requestedOrderNumber is required.' })
        }

        const {
          authUsersCollection,
          entriesCollection,
          mobileAlertsCollection,
          mondayOrdersCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const [existingOrderDocument, liveSnapshot] = await Promise.all([
          ordersUnifiedCollection.findOne(
            { monday_item_id: mondayItemId },
            {
              projection: {
                _id: 0,
                monday_item_id: 1,
                order_number: 1,
                has_quickbooks_record: 1,
              },
            },
          ),
          fetchMondayBoardItemsByIds({
            boardId: context.boardId,
            boardName: context.boardName,
            boardUrl: context.boardUrl,
            itemIds: [mondayItemId],
          }),
        ])

        const liveOrder = Array.isArray(liveSnapshot?.orders)
          ? liveSnapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const currentOrderNumber =
          normalizeOrderNumberInput(existingOrderDocument?.order_number)
          || normalizeOrderNumberInput(liveOrder?.jobNumber)
          || requestedCurrentOrderNumber

        const linkedState = await resolveOrderNumberChangeLinkState({
          entriesCollection,
          orderProgressCollection,
          ordersUnifiedCollection,
          mondayItemId,
          currentOrderNumber,
          nextOrderNumber: requestedOrderNumber,
          hasQuickBooksRecordOnOrder: Boolean(existingOrderDocument?.has_quickbooks_record),
        })

        const alertDocument = await createOrderNumberChangeAdminAlert({
          authUsersCollection,
          mobileAlertsCollection,
          publicUser,
          mondayItemId,
          currentOrderNumber,
          requestedOrderNumber,
          linkedState,
        })

        return res.status(201).json({
          ok: true,
          alert: toPublicMobileAlert(alertDocument),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/monday/order-details — manager-only edit endpoint for
  // key order fields that must write through to Monday first.
  app.post(
    '/api/orders/monday/order-details',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
        const hasOrderNameField = hasOwnField(req.body, 'orderName')
        const hasPoNumberField = hasOwnField(req.body, 'poNumber')
        const hasNotesField = hasOwnField(req.body, 'notes')
        const hasDescriptionField = hasOwnField(req.body, 'description')
        const hasOrderDateField = hasOwnField(req.body, 'orderDate')
        const hasDueDateField =
          hasOwnField(req.body, 'dueDate')
          || hasOwnField(req.body, 'leadTime')
          || hasOwnField(req.body, 'leadTimeDate')
        const hasLeadTimeDaysField = hasOwnField(req.body, 'leadTimeDays')
        const hasPodDateField = hasOwnField(req.body, 'podDate')

        if (!mondayItemId) {
          return res.status(400).json({ error: 'mondayItemId is required.' })
        }

        if (
          !hasOrderNameField
          && !hasPoNumberField
          && !hasNotesField
          && !hasDescriptionField
          && !hasOrderDateField
          && !hasDueDateField
          && !hasLeadTimeDaysField
          && !hasPodDateField
        ) {
          return res.status(400).json({
            error: 'At least one editable field is required.',
          })
        }

        const rawOrderNameInput = String(req.body?.orderName ?? '').trim()
        const rawPoNumberInput = String(req.body?.poNumber ?? '').trim()
  const rawNotesInput = String(req.body?.notes ?? '').trim()
        const rawDescriptionInput = String(req.body?.description ?? '').trim()
        const rawOrderDateInput = String(req.body?.orderDate ?? '').trim()
        const rawDueDateInput = String(
          hasOwnField(req.body, 'dueDate')
            ? req.body?.dueDate
            : hasOwnField(req.body, 'leadTimeDate')
              ? req.body?.leadTimeDate
              : req.body?.leadTime,
        ).trim()
        const rawPodDateInput = String(req.body?.podDate ?? '').trim()
        const rawLeadTimeDaysInput = String(req.body?.leadTimeDays ?? '').trim()

        const requestedOrderName = normalizeOptionalShortText(rawOrderNameInput, 250)
        const requestedPoNumber = normalizeOptionalShortText(rawPoNumberInput, 120) || ''
  const requestedNotes = normalizeOptionalShortText(rawNotesInput, 2000) || ''
        const requestedDescription = normalizeOptionalShortText(rawDescriptionInput, 2000) || ''
        const requestedOrderDate = normalizeIsoDateInput(rawOrderDateInput)
        const requestedDueDate = normalizeIsoDateInput(rawDueDateInput)
        const requestedPodDate = normalizeIsoDateInput(rawPodDateInput)

        if (hasOrderNameField && !requestedOrderName) {
          return res.status(400).json({ error: 'orderName is required.' })
        }

        if (hasOrderDateField && rawOrderDateInput && !requestedOrderDate) {
          return res.status(400).json({ error: 'orderDate must be YYYY-MM-DD.' })
        }

        if (hasDueDateField && rawDueDateInput && !requestedDueDate) {
          return res.status(400).json({ error: 'leadTime must be YYYY-MM-DD.' })
        }

        if (hasPodDateField && rawPodDateInput && !requestedPodDate) {
          return res.status(400).json({ error: 'podDate must be YYYY-MM-DD.' })
        }

        let requestedLeadTimeDaysText = ''

        if (hasLeadTimeDaysField) {
          if (rawLeadTimeDaysInput) {
            const parsedLeadTimeDays = Number(rawLeadTimeDaysInput)

            if (!Number.isFinite(parsedLeadTimeDays) || parsedLeadTimeDays < 0) {
              return res.status(400).json({
                error: 'leadTimeDays must be a non-negative number.',
              })
            }

            requestedLeadTimeDaysText = String(Number(parsedLeadTimeDays.toFixed(2)))
          }
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()

        const context = await resolveMondayOrderContext({
          mondayItemId,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        if (!context?.boardId) {
          return res.status(404).json({
            error: 'Could not resolve Monday board for this order.',
          })
        }

        const snapshot = await fetchMondayBoardItemsByIds({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          itemIds: [mondayItemId],
        })
        const liveOrder = Array.isArray(snapshot?.orders)
          ? snapshot.orders[0]
          : null

        if (!liveOrder) {
          return res.status(404).json({
            error: 'Monday item was not found on the configured board.',
          })
        }

        const poNumberColumnId = String(snapshot?.columnDetection?.poNumberColumnId ?? '').trim()
  const notesColumnId = String(snapshot?.columnDetection?.notesColumnId ?? '').trim()
        const descriptionColumnId = String(snapshot?.columnDetection?.descriptionColumnId ?? '').trim()
        const orderDateColumnId = String(snapshot?.columnDetection?.orderDateColumnId ?? '').trim()
        const dueDateColumnId = String(snapshot?.columnDetection?.dueDateColumnId ?? '').trim()
        const leadTimeColumnId = String(snapshot?.columnDetection?.leadTimeColumnId ?? '').trim()
        const shipDateColumnId = String(snapshot?.columnDetection?.shipDateColumnId ?? '').trim()

        if (hasOrderNameField) {
          await updateMondayItemName({
            boardId: context.boardId,
            itemId: mondayItemId,
            itemName: requestedOrderName,
          })
        }

        if (hasPoNumberField) {
          if (!poNumberColumnId) {
            return res.status(409).json({
              error: 'PO number column could not be resolved for this board.',
            })
          }

          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: poNumberColumnId,
            textValue: requestedPoNumber,
          })
        }

        if (hasNotesField) {
          if (!notesColumnId) {
            return res.status(409).json({
              error: 'Notes column could not be resolved for this board.',
            })
          }

          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: notesColumnId,
            textValue: requestedNotes,
          })
        }

        if (hasDescriptionField) {
          if (!descriptionColumnId) {
            return res.status(409).json({
              error: 'Description column could not be resolved for this board.',
            })
          }

          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: descriptionColumnId,
            textValue: requestedDescription,
          })
        }

        if (hasOrderDateField) {
          if (!orderDateColumnId) {
            return res.status(409).json({
              error: 'Order date column could not be resolved for this board.',
            })
          }

          await updateMondayDateColumnValue({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: orderDateColumnId,
            dateValue: requestedOrderDate,
          })
        }

        if (hasDueDateField) {
          const targetDueDateColumnId = dueDateColumnId || leadTimeColumnId

          if (!targetDueDateColumnId) {
            return res.status(409).json({
              error: 'Lead time column could not be resolved for this board.',
            })
          }

          await updateMondayDateColumnValue({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: targetDueDateColumnId,
            dateValue: requestedDueDate,
          })
        }

        if (hasLeadTimeDaysField) {
          if (!leadTimeColumnId) {
            return res.status(409).json({
              error: 'Lead time days column could not be resolved for this board.',
            })
          }

          await updateMondayItemTextColumn({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: leadTimeColumnId,
            textValue: requestedLeadTimeDaysText,
          })
        }

        if (hasPodDateField) {
          if (!shipDateColumnId) {
            return res.status(409).json({
              error: 'POD date column could not be resolved for this board.',
            })
          }

          await updateMondayDateColumnValue({
            boardId: context.boardId,
            itemId: mondayItemId,
            columnId: shipDateColumnId,
            dateValue: requestedPodDate,
          })
        }

        const {
          liveOrder: refreshedLiveOrder,
          resolvedBoardName,
          resolvedBoardUrl,
          progressStatusDetails,
        } = await pullLiveMondayProgressDetails({
          boardId: context.boardId,
          boardName: context.boardName,
          boardUrl: context.boardUrl,
          mondayItemId,
        })

        const syncResult = await syncMondayProgressDetailsToCollections({
          mondayItemId,
          boardId: context.boardId,
          boardName: resolvedBoardName,
          boardUrl: resolvedBoardUrl,
          liveOrder: refreshedLiveOrder,
          progressStatusDetails,
          mondayOrdersCollection,
          ordersUnifiedCollection,
        })

        const now = new Date().toISOString()
        const refreshedOrderName = normalizeOptionalShortText(refreshedLiveOrder?.name, 250) || null
        const refreshedPoNumber = normalizeOptionalShortText(refreshedLiveOrder?.poNumber, 120) || null
        const refreshedNotes = normalizeOptionalShortText(refreshedLiveOrder?.notes, 2000) || null
        const refreshedDescription = normalizeOptionalShortText(refreshedLiveOrder?.description, 2000) || null
        const refreshedOrderDate = normalizeIsoDateInput(refreshedLiveOrder?.orderDate) || null
        const refreshedDueDate = normalizeIsoDateInput(refreshedLiveOrder?.dueDate) || null
        const refreshedShippedAt = String(refreshedLiveOrder?.shippedAt ?? '').trim() || null
        const refreshedLeadTimeDays = Number.isFinite(Number(refreshedLiveOrder?.leadTimeDays))
          ? Number(refreshedLiveOrder.leadTimeDays)
          : null

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                mondayBoardId: context.boardId,
                mondayBoardName: resolvedBoardName,
                mondayBoardUrl: resolvedBoardUrl,
                orderName: refreshedOrderName,
                jobNumber: String(refreshedLiveOrder?.jobNumber ?? '').trim() || null,
                poNumber: refreshedPoNumber,
                notes: refreshedNotes,
                description: refreshedDescription,
                orderDate: refreshedOrderDate,
                dueDate: refreshedDueDate,
                leadTimeDays: refreshedLeadTimeDays,
                shippedAt: refreshedShippedAt,
                mondayUpdatedAt: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSeenAt: now,
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
                monday_board_id: context.boardId,
                monday_board_name: resolvedBoardName,
                Monday_url:
                  String(refreshedLiveOrder?.itemUrl ?? '').trim()
                  || resolvedBoardUrl
                  || null,
                order_name: refreshedOrderName,
                po_number: refreshedPoNumber,
                monday_notes: refreshedNotes,
                monday_description: refreshedDescription,
                order_date: refreshedOrderDate,
                Due_date: refreshedDueDate,
                Lead_time_days: refreshedLeadTimeDays,
                shipped_at: refreshedShippedAt,
                monday_updated_at: syncResult.mondayUpdatedAt,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
            { upsert: true },
          ),
        ])

        let refreshWarning = null

        try {
          await refreshOrdersUnifiedCollection()
        } catch (refreshError) {
          refreshWarning = refreshError instanceof Error
            ? refreshError.message
            : 'Order saved to Monday, but unified refresh failed.'
        }

        const updatedOrderDocument = await ordersUnifiedCollection.findOne(
          { monday_item_id: mondayItemId },
          {
            projection: {
              _id: 0,
              order_name: 1,
              po_number: 1,
              monday_notes: 1,
              monday_description: 1,
              order_date: 1,
              Due_date: 1,
              Lead_time_days: 1,
              shipped_at: 1,
              monday_updated_at: 1,
            },
          },
        )

        return res.json({
          ok: true,
          order: {
            mondayItemId,
            orderName: String(updatedOrderDocument?.order_name ?? '').trim() || refreshedOrderName,
            poNumber: String(updatedOrderDocument?.po_number ?? '').trim() || refreshedPoNumber,
            notes:
              String(updatedOrderDocument?.monday_notes ?? '').trim()
              || refreshedNotes,
            description:
              String(updatedOrderDocument?.monday_description ?? '').trim()
              || refreshedDescription,
            orderDate: String(updatedOrderDocument?.order_date ?? '').trim() || refreshedOrderDate,
            dueDate: String(updatedOrderDocument?.Due_date ?? '').trim() || refreshedDueDate,
            leadTimeDays: Number.isFinite(Number(updatedOrderDocument?.Lead_time_days))
              ? Number(updatedOrderDocument.Lead_time_days)
              : refreshedLeadTimeDays,
            podDate: String(updatedOrderDocument?.shipped_at ?? '').trim() || refreshedShippedAt,
            mondayUpdatedAt:
              String(updatedOrderDocument?.monday_updated_at ?? '').trim()
              || syncResult.mondayUpdatedAt,
          },
          warning: refreshWarning,
        })
      } catch (error) {
        next(error)
      }
    },
  )

}
