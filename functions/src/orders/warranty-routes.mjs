// Warranty endpoints: open an issue on a shipped order, set/clear its
// lead-time promise, and close it while archiving duration + variance
// metrics. Warranty state is website-owned — never synced from Monday.

import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import {
  buildWarrantyRouteOrderPayload,
  calculateDateDifferenceDays,
  normalizeIsoDateInput,
} from './order-shared.mjs'

export function registerOrderWarrantyRoutes(app, {
  getCollections,
  requireFirebaseAuth,
}) {
  // POST /api/orders/warranty/issue — create an active warranty issue.
  app.post('/api/orders/warranty/issue', requireFirebaseAuth, async (req, res, next) => {
    try {
      const mondayItemId = String(req.body?.mondayItemId ?? '').trim()
      const description = normalizeOptionalShortText(req.body?.description, 2000)
      const requestedReportedDate = normalizeIsoDateInput(req.body?.reportedDate)

      if (!mondayItemId) {
        return res.status(400).json({ error: 'mondayItemId is required.' })
      }

      if (!description) {
        return res.status(400).json({ error: 'description is required.' })
      }

      const { ordersUnifiedCollection } = await getCollections()
      const currentOrderDocument = await ordersUnifiedCollection.findOne(
        { monday_item_id: mondayItemId },
        {
          projection: {
            _id: 0,
            monday_item_id: 1,
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

      await ordersUnifiedCollection.updateOne(
        { monday_item_id: mondayItemId },
        {
          $set: {
            warranty_issue_active: true,
            warranty_issue_description: description,
            warranty_issue_reported_at: reportedDate,
            warranty_issue_lead_time_date: null,
            warranty_issue_done_at: null,
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

      return res.status(201).json({
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
}
