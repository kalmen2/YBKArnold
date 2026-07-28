// Warranty endpoints create linked _WR production orders and retain the
// original order's warranty history. Archive state is website-owned and
// intentionally never pushed to Monday.

import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import {
  buildOrderIdentityFilter,
  buildWarrantyRouteOrderPayload,
  calculateDateDifferenceDays,
  normalizeIsoDateInput,
} from './order-shared.mjs'
import { MONDAY_BOARDS } from './monday-board-map.mjs'

export function registerOrderWarrantyRoutes(app, {
  createMondayItem,
  getCollections,
  refreshOrdersUnifiedCollection,
  requireFirebaseAuth,
  updateMondayItemJsonColumn,
  updateMondayItemName,
  updateMondayItemTextColumn,
}) {
  // POST /api/orders/warranty/issue — create a separate production order on
  // Order Track. It keeps its own Monday lifecycle, but parent_order_number
  // links all QuickBooks financials back to the original project.
  app.post('/api/orders/warranty/issue', requireFirebaseAuth, async (req, res, next) => {
    try {
      const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
      const description = normalizeOptionalShortText(req.body?.description, 2000)
      const requestedReportedDate = normalizeIsoDateInput(req.body?.reportedDate)
      const requestedLeadTimeDate = normalizeIsoDateInput(req.body?.leadTimeDate)

      if (!mondayItemId) {
        return res.status(400).json({ error: 'mondayItemId is required.' })
      }

      if (!description) {
        return res.status(400).json({ error: 'description is required.' })
      }

      if (!requestedLeadTimeDate) {
        return res.status(400).json({ error: 'leadTimeDate is required and must be YYYY-MM-DD.' })
      }

      const { ordersUnifiedCollection } = await getCollections()
      const currentOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            orderKey: 1,
            monday_item_id: 1,
            order_number: 1,
            order_name: 1,
            po_number: 1,
            ship_to: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      if (!currentOrderDocument) {
        return res.status(404).json({ error: 'Order was not found for this Monday item.' })
      }

      if (!Boolean(currentOrderDocument?.is_shipped)) {
        return res.status(409).json({
          error: 'Warranty issues can only be opened after the order is shipped.',
        })
      }

      if (Boolean(currentOrderDocument?.warranty_issue_active)) {
        return res.status(409).json({
          error: 'This order already has an active warranty issue.',
        })
      }

      const now = new Date().toISOString()
      const reportedDate = requestedReportedDate || now.slice(0, 10)
      const originalOrderNumber = String(currentOrderDocument?.order_number ?? '').trim()
      const warrantyOrderNumber = `${originalOrderNumber}_WR`
      const orderTrackBoardId = String(MONDAY_BOARDS.orderTrack.id)
      const orderTrackColumns = MONDAY_BOARDS.orderTrack.columns
      const duplicateWarrantyOrder = await ordersUnifiedCollection.findOne(
        {
          order_number: new RegExp(
            `^${warrantyOrderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            'i',
          ),
          is_deleted: { $ne: true },
          is_cancelled: { $ne: true },
        },
        { projection: { _id: 0, order_number: 1 } },
      )

      if (duplicateWarrantyOrder) {
        return res.status(409).json({
          error: `Warranty order ${warrantyOrderNumber} already exists.`,
        })
      }

      const originalOrderName = normalizeOptionalShortText(
        currentOrderDocument?.order_name,
        260,
      ) || originalOrderNumber
      const warrantyOrderName = `Warranty - ${originalOrderName}`
      const mondayItemName = `${warrantyOrderName} / ${warrantyOrderNumber}`
      const createdItem = await createMondayItem({
        boardId: orderTrackBoardId,
        itemName: mondayItemName,
      })
      const warrantyMondayItemId = String(createdItem?.itemId ?? '').trim()

      if (!warrantyMondayItemId) {
        return res.status(502).json({
          error: 'Monday did not return the warranty order item id.',
        })
      }

      await updateMondayItemName({
        boardId: orderTrackBoardId,
        itemId: warrantyMondayItemId,
        itemName: mondayItemName,
      })
      await updateMondayItemTextColumn({
        boardId: orderTrackBoardId,
        itemId: warrantyMondayItemId,
        columnId: orderTrackColumns.ackNumber,
        textValue: warrantyOrderNumber,
      })

      await Promise.all([
        updateMondayItemTextColumn({
          boardId: orderTrackBoardId,
          itemId: warrantyMondayItemId,
          columnId: orderTrackColumns.description,
          textValue: description,
        }),
        updateMondayItemJsonColumn({
          boardId: orderTrackBoardId,
          itemId: warrantyMondayItemId,
          columnId: orderTrackColumns.leadTime,
          jsonValue: { date: requestedLeadTimeDate },
        }),
        updateMondayItemJsonColumn({
          boardId: orderTrackBoardId,
          itemId: warrantyMondayItemId,
          columnId: orderTrackColumns.poDate,
          jsonValue: { date: reportedDate },
        }),
      ])
      const optionalMondayUpdates = []
      const poNumber = normalizeOptionalShortText(currentOrderDocument?.po_number, 120)
      const shipTo = normalizeOptionalShortText(currentOrderDocument?.ship_to, 500)

      if (poNumber) {
        optionalMondayUpdates.push(updateMondayItemTextColumn({
          boardId: orderTrackBoardId,
          itemId: warrantyMondayItemId,
          columnId: orderTrackColumns.poNumber,
          textValue: poNumber,
        }))
      }
      if (shipTo) {
        optionalMondayUpdates.push(updateMondayItemTextColumn({
          boardId: orderTrackBoardId,
          itemId: warrantyMondayItemId,
          columnId: orderTrackColumns.shipTo,
          textValue: shipTo,
        }))
      }

      if (optionalMondayUpdates.length > 0) {
        await Promise.allSettled(optionalMondayUpdates)
      }
      const warrantyOrderKey = `order:${warrantyOrderNumber
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')}`

      await Promise.all([
        ordersUnifiedCollection.updateOne(
          { monday_item_id: mondayItemId },
          {
            $set: {
              warranty_issue_active: true,
              warranty_issue_description: description,
              warranty_issue_reported_at: reportedDate,
              warranty_issue_lead_time_date: requestedLeadTimeDate,
              warranty_issue_done_at: null,
              updatedAt: now,
              lastSyncedAt: now,
            },
          },
        ),
        ordersUnifiedCollection.updateOne(
          { orderKey: warrantyOrderKey },
          {
            $set: {
              orderKey: warrantyOrderKey,
              order_number: warrantyOrderNumber,
              monday_item_id: warrantyMondayItemId,
              Monday_url:
                `https://arnoldcontract.monday.com/boards/${orderTrackBoardId}/pulses/${warrantyMondayItemId}`,
              order_name: warrantyOrderName,
              po_number: poNumber || null,
              ship_to: shipTo || null,
              monday_description: description,
              order_date: reportedDate,
              Due_date: requestedLeadTimeDate,
              has_monday_record: true,
              has_quickbooks_record: false,
              in_design: false,
              is_shipped: false,
              source: 'monday',
              monday_board_id: orderTrackBoardId,
              monday_board_name: MONDAY_BOARDS.orderTrack.name,
              monday_updated_at: now,
              parent_order_number: originalOrderNumber,
              is_warranty_order: true,
              warranty_parent_order_number: originalOrderNumber,
              canonical_order_value: 0,
              canonical_freight_value: 0,
              orderValue: 0,
              freightValue: 0,
              updatedAt: now,
              lastSyncedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
              status: [],
            },
          },
          { upsert: true },
        ),
      ])

      try {
        await refreshOrdersUnifiedCollection()
      } catch {
        // The new row is already persisted above. A later manual refresh will
        // hydrate any additional Monday fields.
      }

      const updatedOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            order_number: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      return res.status(201).json({
        ok: true,
        order: buildWarrantyRouteOrderPayload({
          orderDocument: updatedOrderDocument,
          mondayItemId,
        }),
        createdOrder: {
          orderNumber: warrantyOrderNumber,
          mondayItemId: warrantyMondayItemId,
          parentOrderNumber: originalOrderNumber,
          mondayItemUrl:
            `https://arnoldcontract.monday.com/boards/${orderTrackBoardId}/pulses/${warrantyMondayItemId}`,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  // POST /api/orders/warranty/lead-time — set or clear lead-time date for
  // an active warranty issue.
  app.post('/api/orders/warranty/lead-time', requireFirebaseAuth, async (req, res, next) => {
    try {
      const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
      const rawLeadTimeDate = String(req.body?.leadTimeDate ?? '').trim()
      const leadTimeDate = normalizeIsoDateInput(rawLeadTimeDate)

      if (!mondayItemId) {
        return res.status(400).json({ error: 'mondayItemId is required.' })
      }

      if (rawLeadTimeDate && !leadTimeDate) {
        return res.status(400).json({ error: 'leadTimeDate must be YYYY-MM-DD.' })
      }

      const { ordersUnifiedCollection } = await getCollections()
      const currentOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            order_number: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      if (!currentOrderDocument) {
        return res.status(404).json({ error: 'Order was not found for this Monday item.' })
      }

      if (!Boolean(currentOrderDocument?.warranty_issue_active)) {
        return res.status(409).json({ error: 'No active warranty issue was found for this order.' })
      }

      const now = new Date().toISOString()

      await ordersUnifiedCollection.updateOne(
        { monday_item_id: mondayItemId },
        {
          $set: {
            warranty_issue_lead_time_date: leadTimeDate || null,
            updatedAt: now,
            lastSyncedAt: now,
          },
        },
      )

      const updatedOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            order_number: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      return res.json({
        ok: true,
        order: buildWarrantyRouteOrderPayload({
          orderDocument: updatedOrderDocument,
          mondayItemId,
        }),
      })
    } catch (error) {
      next(error)
    }
  })

  // POST /api/orders/warranty/done — close active warranty issue and retain
  // completion history on the order.
  app.post('/api/orders/warranty/done', requireFirebaseAuth, async (req, res, next) => {
    try {
      const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
      const rawDoneDate = String(req.body?.doneDate ?? '').trim()
      const doneDate = normalizeIsoDateInput(rawDoneDate)

      if (!mondayItemId) {
        return res.status(400).json({ error: 'mondayItemId is required.' })
      }

      if (rawDoneDate && !doneDate) {
        return res.status(400).json({ error: 'doneDate must be YYYY-MM-DD.' })
      }

      const { ordersUnifiedCollection } = await getCollections()
      const currentOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            order_number: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      if (!currentOrderDocument) {
        return res.status(404).json({ error: 'Order was not found for this Monday item.' })
      }

      if (!Boolean(currentOrderDocument?.warranty_issue_active)) {
        return res.status(409).json({ error: 'No active warranty issue was found for this order.' })
      }

      const now = new Date().toISOString()
      const resolvedDoneDate = doneDate || now.slice(0, 10)
      const issueDescription = normalizeOptionalShortText(
        currentOrderDocument?.warranty_issue_description,
        2000,
      ) || null
      const reportedAt = normalizeIsoDateInput(currentOrderDocument?.warranty_issue_reported_at) || null
      const leadTimeDate = normalizeIsoDateInput(currentOrderDocument?.warranty_issue_lead_time_date) || null
      const durationDays = calculateDateDifferenceDays(reportedAt, resolvedDoneDate)
      const leadTimeVarianceDays = calculateDateDifferenceDays(leadTimeDate, resolvedDoneDate)

      await ordersUnifiedCollection.updateOne(
        { monday_item_id: mondayItemId },
        {
          $set: {
            warranty_issue_active: false,
            warranty_issue_description: null,
            warranty_issue_reported_at: null,
            warranty_issue_lead_time_date: null,
            warranty_issue_done_at: resolvedDoneDate,
            warranty_last_completed_description: issueDescription,
            warranty_last_completed_reported_at: reportedAt,
            warranty_last_completed_lead_time_date: leadTimeDate,
            warranty_last_completed_done_at: resolvedDoneDate,
            warranty_last_completed_duration_days: durationDays,
            warranty_last_completed_lead_time_variance_days: leadTimeVarianceDays,
            updatedAt: now,
            lastSyncedAt: now,
          },
        },
      )

      const updatedOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            order_number: 1,
            is_shipped: 1,
            warranty_issue_active: 1,
            warranty_issue_description: 1,
            warranty_issue_reported_at: 1,
            warranty_issue_lead_time_date: 1,
            warranty_issue_done_at: 1,
            warranty_last_completed_description: 1,
            warranty_last_completed_reported_at: 1,
            warranty_last_completed_lead_time_date: 1,
            warranty_last_completed_done_at: 1,
            warranty_last_completed_duration_days: 1,
            warranty_last_completed_lead_time_variance_days: 1,
          },
        },
      )

      return res.json({
        ok: true,
        order: buildWarrantyRouteOrderPayload({
          orderDocument: updatedOrderDocument,
          mondayItemId,
        }),
      })
    } catch (error) {
      next(error)
    }
  })

  // Website-only archive. This deliberately never changes Monday.
  app.post('/api/orders/archive', requireFirebaseAuth, async (req, res, next) => {
    try {
      const archived = req.body?.archived !== false
      const identityFilter = buildOrderIdentityFilter({
        orderKey: req.body?.orderKey,
        mondayItemId: req.body?.mondayItemId,
        orderNumber: req.body?.orderNumber,
      })

      if (!identityFilter) {
        return res.status(400).json({
          error: 'orderKey, mondayItemId, or orderNumber is required.',
        })
      }

      const { dashboardSnapshotsCollection, ordersUnifiedCollection } = await getCollections()
      const now = new Date().toISOString()
      const authenticatedUser = req.authUser && typeof req.authUser === 'object'
        ? req.authUser
        : {}
      const result = await ordersUnifiedCollection.updateOne(
        {
          ...identityFilter,
          is_deleted: { $ne: true },
          is_cancelled: { $ne: true },
        },
        archived
          ? {
              $set: {
                archived_at: now,
                archived_by_uid: String(authenticatedUser?.uid ?? '').trim() || null,
                archived_by_email: String(authenticatedUser?.email ?? '').trim() || null,
                updatedAt: now,
              },
            }
          : {
              $set: {
                archived_at: null,
                archived_by_uid: null,
                archived_by_email: null,
                updatedAt: now,
              },
            },
      )

      if (result.matchedCount !== 1) {
        return res.status(404).json({ error: 'Order was not found.' })
      }

      await dashboardSnapshotsCollection.deleteOne({ snapshotKey: 'monday' })

      return res.json({
        ok: true,
        archived,
        archivedAt: archived ? now : null,
      })
    } catch (error) {
      next(error)
    }
  })
}
