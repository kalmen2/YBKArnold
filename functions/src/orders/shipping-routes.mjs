// Shipping endpoints: the website ship action (gated on signed BOL +
// inspection sheet, moves the Monday card to Shipped and syncs back) and the
// sub-order link that combines a family's money/labor on its main order.

import {
  buildOrderIdentityFilter,
  normalizeProgressStatusDetails,
} from './order-shared.mjs'

export function registerOrderShippingRoutes(app, {
  fetchMondayBoardItemsByIds,
  getCollections,
  moveMondayItemToBoard,
  normalizeEmail,
  requireFirebaseAuth,
  requireManagerOrAdminRole,
  toPublicAuthUser,
}) {
  // POST /api/orders/ship — move an order from Order Track to Shipped in
  // Monday after required website shipping docs are uploaded.
  app.post(
    '/api/orders/ship',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const {
          mondayOrdersCollection,
          ordersUnifiedCollection,
        } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_item_id: 1,
              monday_board_id: 1,
              monday_board_name: 1,
              Monday_url: 1,
              is_shipped: 1,
              signed_bol: 1,
              Signed_BOL_source: 1,
              Signed_BOL: 1,
              inspection_sheet: 1,
              Inspection_sheet_source: 1,
              Inspection_sheet: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()

        if (!mondayItemId) {
          return res.status(409).json({
            error: 'This order is not linked to a Monday item, so it cannot be shipped from the website.',
          })
        }

        const signedBolValue = String(orderDocument?.signed_bol ?? '').trim()
        const signedBolUrl =
          String(orderDocument?.Signed_BOL_source ?? '').trim()
          || String(orderDocument?.Signed_BOL ?? '').trim()
          || null
        const inspectionSheetValue = String(orderDocument?.inspection_sheet ?? '').trim()
        const inspectionSheetUrl =
          String(orderDocument?.Inspection_sheet_source ?? '').trim()
          || String(orderDocument?.Inspection_sheet ?? '').trim()
          || null

        if (!signedBolValue && !signedBolUrl) {
          return res.status(409).json({
            error: 'Signed BOL must be uploaded before shipping.',
          })
        }

        if (!inspectionSheetValue && !inspectionSheetUrl) {
          return res.status(409).json({
            error: 'Inspection Sheet must be uploaded before shipping.',
          })
        }

        if (Boolean(orderDocument?.is_shipped)) {
          return res.status(409).json({
            error: 'Order is already shipped. You can still upload shipping documents.',
          })
        }

        const sourceBoardId = String(orderDocument?.monday_board_id ?? '').trim()
        const targetBoardId = String(process.env.MONDAY_SHIPPED_BOARD_ID ?? '').trim()
        const targetBoardUrl = String(process.env.MONDAY_SHIPPED_BOARD_URL ?? '').trim() || null

        if (!sourceBoardId) {
          return res.status(409).json({
            error: 'Could not resolve source Monday board for this order.',
          })
        }

        if (!targetBoardId) {
          return res.status(500).json({
            error: 'MONDAY_SHIPPED_BOARD_ID is not configured.',
          })
        }

        const moveResult = await moveMondayItemToBoard({
          sourceBoardId,
          targetBoardId,
          itemId: mondayItemId,
        })
        const movedSnapshot = await fetchMondayBoardItemsByIds({
          boardId: targetBoardId,
          boardName: moveResult?.targetBoardName,
          boardUrl: targetBoardUrl,
          itemIds: [mondayItemId],
        })
        const movedOrder = Array.isArray(movedSnapshot?.orders)
          ? movedSnapshot.orders[0]
          : null
        const now = new Date().toISOString()
        const mondayUpdatedAt = String(movedOrder?.updatedAt ?? '').trim() || now
        const mondayStatus = String(movedOrder?.statusLabel ?? '').trim() || 'Shipped'
        const shippedAt = String(movedOrder?.shippedAt ?? '').trim() || now
        const progressStatusDetails = normalizeProgressStatusDetails(movedOrder?.progressStatusDetails)
        const publicUser = toPublicAuthUser(req.authUser)
        const updateFilter = buildOrderIdentityFilter({
          orderKey: orderDocument?.orderKey,
          mondayItemId,
          orderNumber: orderDocument?.order_number,
        })

        if (!updateFilter) {
          return res.status(409).json({
            error: 'Could not resolve order identity for shipping update.',
          })
        }

        await Promise.all([
          mondayOrdersCollection.updateOne(
            { mondayItemId },
            {
              $set: {
                mondayItemId,
                mondayBoardId: targetBoardId,
                mondayBoardName: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || null,
                mondayBoardUrl: targetBoardUrl,
                orderName: String(movedOrder?.name ?? '').trim() || String(orderDocument?.order_name ?? '').trim() || null,
                jobNumber: String(movedOrder?.jobNumber ?? '').trim() || String(orderDocument?.order_number ?? '').trim() || null,
                statusLabel: 'Shipped',
                stageLabel: String(movedOrder?.stageLabel ?? '').trim() || null,
                readyLabel: String(movedOrder?.readyLabel ?? '').trim() || null,
                progressStatusDetails,
                progressPercent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                orderDate: String(movedOrder?.orderDate ?? '').trim() || null,
                dueDate: String(movedOrder?.dueDate ?? '').trim() || null,
                computedDueDate: String(movedOrder?.computedDueDate ?? '').trim() || null,
                effectiveDueDate: String(movedOrder?.effectiveDueDate ?? '').trim() || null,
                leadTimeDays: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                shippedAt,
                movedToShippedAt: now,
                isDone: true,
                isLate: Boolean(movedOrder?.isLate),
                daysLate: Number.isFinite(Number(movedOrder?.daysLate))
                  ? Number(movedOrder.daysLate)
                  : 0,
                mondayItemUrl: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
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
            updateFilter,
            {
              $set: {
                has_monday_record: true,
                monday_item_id: mondayItemId,
                monday_board_id: targetBoardId,
                monday_board_name: moveResult?.targetBoardName || String(orderDocument?.monday_board_name ?? '').trim() || 'Shipped Orders',
                Monday_url: String(movedOrder?.itemUrl ?? '').trim() || String(orderDocument?.Monday_url ?? '').trim() || null,
                Monday_status: 'Shipped',
                is_shipped: true,
                shipped_at: shippedAt,
                shipped_at_inferred: String(movedOrder?.shippedAt ?? '').trim() ? false : true,
                Due_date: String(movedOrder?.dueDate ?? '').trim() || null,
                Lead_time_days: Number.isFinite(Number(movedOrder?.leadTimeDays))
                  ? Number(movedOrder.leadTimeDays)
                  : null,
                progress_percent: Number.isFinite(Number(movedOrder?.progressPercent))
                  ? Number(movedOrder.progressPercent)
                  : null,
                progress_status_details: progressStatusDetails,
                order_date: String(movedOrder?.orderDate ?? '').trim() || null,
                monday_updated_at: mondayUpdatedAt,
                moved_to_shipped_via_website_at: now,
                moved_to_shipped_via_website_by_uid: String(publicUser?.uid ?? '').trim() || null,
                moved_to_shipped_via_website_by_email: normalizeEmail(publicUser?.email) || null,
                monday_ship_mapping_mode: String(moveResult?.mappingMode ?? '').trim() || null,
                updatedAt: now,
                lastSyncedAt: now,
              },
            },
          ),
        ])

        return res.json({
          ok: true,
          move: {
            itemId: mondayItemId,
            sourceBoardId: moveResult?.sourceBoardId || sourceBoardId,
            sourceBoardName: moveResult?.sourceBoardName || null,
            targetBoardId: moveResult?.targetBoardId || targetBoardId,
            targetBoardName: moveResult?.targetBoardName || null,
            targetGroupId: moveResult?.targetGroupId || null,
            targetGroupTitle: moveResult?.targetGroupTitle || null,
            mappingMode: moveResult?.mappingMode || 'explicit',
            mappedColumnCount: Number(moveResult?.mappedColumnCount) || 0,
            totalSourceColumnCount: Number(moveResult?.totalSourceColumnCount) || 0,
          },
          order: {
            orderKey: String(orderDocument?.orderKey ?? '').trim() || null,
            mondayItemId,
            orderNumber: String(orderDocument?.order_number ?? '').trim() || null,
            isShipped: true,
            shippedAt,
            mondayStatus,
            mondayBoardId: targetBoardId,
            mondayBoardName: moveResult?.targetBoardName || null,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  // POST /api/orders/suborder-link — link an order to a main order (or clear
  // the link with parentOrderNumber: null). The sub-order stays a fully
  // separate order everywhere; only the money/labor rollup combines.
  app.post(
    '/api/orders/suborder-link',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const orderIdentityFilter = buildOrderIdentityFilter({
          orderKey: req.body?.orderKey,
          mondayItemId: req.body?.mondayItemId,
          orderNumber: req.body?.orderNumber,
        })

        if (!orderIdentityFilter) {
          return res.status(400).json({
            error: 'orderKey, mondayItemId, or orderNumber is required.',
          })
        }

        const hasParentField = Boolean(
          req.body
          && Object.prototype.hasOwnProperty.call(req.body, 'parentOrderNumber'),
        )

        if (!hasParentField) {
          return res.status(400).json({
            error: 'parentOrderNumber is required (null clears the link).',
          })
        }

        const requestedParentOrderNumber = String(req.body?.parentOrderNumber ?? '').trim()
        const { ordersUnifiedCollection } = await getCollections()
        const orderDocument = await ordersUnifiedCollection.findOne(
          orderIdentityFilter,
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              parent_order_number: 1,
            },
          },
        )

        if (!orderDocument) {
          return res.status(404).json({ error: 'Order was not found.' })
        }

        const orderNumber = String(orderDocument?.order_number ?? '').trim()

        if (requestedParentOrderNumber) {
          if (
            orderNumber
            && requestedParentOrderNumber.toLowerCase() === orderNumber.toLowerCase()
          ) {
            return res.status(400).json({
              error: 'An order cannot be its own main order.',
            })
          }

          const parentDocument = await ordersUnifiedCollection.findOne(
            {
              order_number: new RegExp(
                `^${requestedParentOrderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                'i',
              ),
            },
            {
              projection: {
                _id: 0,
                order_number: 1,
                parent_order_number: 1,
              },
            },
          )

          if (!parentDocument) {
            return res.status(404).json({
              error: `Main order ${requestedParentOrderNumber} was not found.`,
            })
          }

          if (String(parentDocument?.parent_order_number ?? '').trim()) {
            return res.status(409).json({
              error: 'The main order is itself a sub-order. Link to the top-level order instead.',
            })
          }

          if (orderNumber) {
            const childOfThisOrder = await ordersUnifiedCollection.findOne(
              { parent_order_number: new RegExp(`^${orderNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
              { projection: { _id: 0, order_number: 1 } },
            )

            if (childOfThisOrder) {
              return res.status(409).json({
                error: 'This order already has sub-orders, so it cannot become a sub-order itself.',
              })
            }
          }
        }

        const now = new Date().toISOString()
        const resolvedParentOrderNumber = requestedParentOrderNumber || null

        await ordersUnifiedCollection.updateOne(
          orderIdentityFilter,
          {
            $set: {
              parent_order_number: resolvedParentOrderNumber,
              updatedAt: now,
            },
          },
        )

        return res.json({
          ok: true,
          orderNumber: orderNumber || null,
          parentOrderNumber: resolvedParentOrderNumber,
        })
      } catch (error) {
        next(error)
      }
    },
  )

}
