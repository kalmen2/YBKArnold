// Orders refresh orchestrator.
//
// One canonical flow used by both the manual Refresh button and the daily cron:
//   1. Pull Order Track from Monday (whitelisted columns, no subitems).
//   2. Pull QuickBooks projects + financials.
//   3. Merge by order number / Monday item id / QB project id.
//   4. For QB-only non-shipped rows: ONE name-only lookup against the Design
//      (Pre-Production) board. Matches → flag "in design", not a hazard.
//   5. For every non-shipped QB row still missing from Monday (including
//      carryover rows), run ONE name-only lookup against the Shipped board.
//      Matches → mark shipped.
//      Then fetch details for ONLY those matched shipped item ids so we can
//      hydrate shipped date / drawings / dates without a full shipped-board
//      detail pull.
//      Misses on carryover rows → real hazard.
//   6. Bulk upsert. Stale-row cleanup is gated by a sanity floor so a partial
//      Monday pull cannot wipe real orders.
//
// Targeted name-only lookups replace the old "pull the entire shipped board"
// and "pull the entire pre-production board" patterns.

import { createQuickBooksProjectsService } from './quickbooks-projects-service.mjs'
import {
  buildNameLookupFromMondayItems,
  buildOrderKey,
  buildStatusHistoryLookups,
  createEmptyUnifiedOrder,
  findNameLookupMatch,
  hydrateUnifiedRowFromStoredDocument,
  isShippedOrderDocument,
  normalizeText,
  resolveOrderNumberFromMondayOrder,
  resolveStatusHistoryForOrder,
  shouldUseQuickBooksOrderNumberForKey,
  toIsoOrNull,
  toBooleanOrNull,
  toTimestampMs,
} from './orders-merge-helpers.mjs'

const SANITY_FLOOR = 10

function shouldReplaceMondayDetails(existing, incoming) {
  if (!existing?.has_monday_record) {
    return true
  }
  if (incoming?.is_shipped && !existing?.is_shipped) {
    return true
  }
  const existingMs = toTimestampMs(existing?.monday_updated_at)
  const incomingMs = toTimestampMs(incoming?.monday_updated_at)
  if (Number.isFinite(incomingMs) && !Number.isFinite(existingMs)) {
    return true
  }
  if (Number.isFinite(incomingMs) && Number.isFinite(existingMs) && incomingMs > existingMs) {
    return true
  }
  return false
}

export function createOrdersUnifiedService(deps) {
  const {
    fetchMondayBoardItemNames,
    fetchMondayBoardItemsByIds,
    fetchMondayDashboardSnapshot,
    getCollections,
    invalidateMondayBoardNamesCache,
    mondayBoardId,
    mondayPreproductionBoardId,
    mondayPreproductionBoardUrl,
    mondayShippedBoardId,
    mondayShippedBoardUrl,
    persistNewMondayOrders,
    setDashboardSnapshotCache,
  } = deps

  const { fetchProjectsFinancials } = createQuickBooksProjectsService({ getCollections })

  let inFlightRefresh = null

  // -- Order Track pull -----------------------------------------------------

  async function pullOrderTrack(warnings) {
    try {
      const snapshot = await fetchMondayDashboardSnapshot()
      await persistNewMondayOrders(snapshot)
      await setDashboardSnapshotCache('monday', snapshot)
      return snapshot
    } catch (error) {
      warnings.push(`Order Track refresh failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return null
    }
  }

  async function pullQuickBooks(warnings) {
    try {
      const data = await fetchProjectsFinancials()
      warnings.push(...(Array.isArray(data?.warnings) ? data.warnings : []))
      return { data, succeeded: true }
    } catch (error) {
      warnings.push(`QuickBooks refresh failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return {
        data: { generatedAt: null, warnings: [], projects: [] },
        succeeded: false,
      }
    }
  }

  // -- Build the merged map -------------------------------------------------

  function applyMondayOrdersToMerged(orderTrackOrders, mergedByKey, normalizedShippedBoardId) {
    const activeMondayItemIds = new Set()

    orderTrackOrders.forEach((order) => {
      const mondayItemId = normalizeText(order?.id, 120) || null
      if (!mondayItemId) {
        return
      }
      activeMondayItemIds.add(mondayItemId)

      const orderNumber = resolveOrderNumberFromMondayOrder({
        jobNumber: order?.jobNumber,
        orderName: order?.name,
      })
      const orderKey = buildOrderKey({ orderNumber, mondayItemId })
      if (!orderKey) {
        return
      }

      const row = mergedByKey.get(orderKey) ?? createEmptyUnifiedOrder(orderKey)
      const incoming = {
        order_number: orderNumber,
        monday_item_id: mondayItemId,
        Monday_url: normalizeText(order?.itemUrl, 500) || null,
        Monday_status: normalizeText(order?.statusLabel, 260) || null,
        order_name: normalizeText(order?.name, 260) || null,
        is_shipped: isShippedOrderDocument(
          {
            mondayBoardId: order?.boardId,
            movedToShippedAt: order?.movedToShippedAt,
            statusLabel: order?.statusLabel,
          },
          normalizedShippedBoardId,
        ),
        Due_date:
          toIsoOrNull(order?.effectiveDueDate)
          || toIsoOrNull(order?.dueDate)
          || toIsoOrNull(order?.computedDueDate),
        Lead_time_days: Number.isFinite(Number(order?.leadTimeDays))
          ? Number(order.leadTimeDays)
          : null,
        progress_percent: Number.isFinite(Number(order?.progressPercent))
          ? Number(order.progressPercent)
          : null,
        order_date: toIsoOrNull(order?.orderDate),
        Shop_drawing_cached: normalizeText(order?.shopDrawingCachedUrl, 800) || null,
        Shop_drawing_source: normalizeText(order?.shopDrawingUrl, 800) || null,
        shipped_at: toIsoOrNull(order?.shippedAt),
        monday_board_id: normalizeText(order?.boardId, 120) || null,
        monday_board_name: normalizeText(order?.boardName, 260) || null,
        monday_updated_at: toIsoOrNull(order?.updatedAt),
      }
      incoming.Shop_drawing = incoming.Shop_drawing_cached || incoming.Shop_drawing_source || null

      if (!row.order_number && incoming.order_number) {
        row.order_number = incoming.order_number
      }

      if (shouldReplaceMondayDetails(row, incoming)) {
        Object.assign(row, {
          monday_item_id: incoming.monday_item_id,
          Monday_url: incoming.Monday_url,
          Monday_status: incoming.is_shipped ? 'Shipped' : incoming.Monday_status,
          order_name: incoming.order_name || row.order_name,
          Due_date: incoming.Due_date || row.Due_date,
          Lead_time_days: incoming.Lead_time_days ?? row.Lead_time_days,
          progress_percent: incoming.progress_percent ?? row.progress_percent,
          order_date: incoming.order_date || row.order_date,
          Shop_drawing_cached: incoming.Shop_drawing_cached || null,
          Shop_drawing_source: incoming.Shop_drawing_source || null,
          Shop_drawing: incoming.Shop_drawing || row.Shop_drawing,
          shipped_at: incoming.shipped_at || row.shipped_at,
          monday_board_id: incoming.monday_board_id,
          monday_board_name: incoming.monday_board_name,
          monday_updated_at: incoming.monday_updated_at,
        })
      }

      row.is_shipped = row.is_shipped || incoming.is_shipped
      row.has_monday_record = true
      mergedByKey.set(orderKey, row)
    })

    return activeMondayItemIds
  }

  function applyQuickBooksToMerged(quickBooksProjects, mergedByKey) {
    const activeQuickBooksProjectIds = new Set()

    const toMoney = (value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
    }

    const addMoney = (left, right) => {
      const leftValue = toMoney(left)
      const rightValue = toMoney(right)
      if (leftValue === null && rightValue === null) {
        return null
      }
      return Number(((leftValue ?? 0) + (rightValue ?? 0)).toFixed(2))
    }

    const mergeCsvValue = (existingValue, nextValue) => {
      const normalizedNextValue = normalizeText(nextValue, 200) || null
      if (!normalizedNextValue) {
        return normalizeText(existingValue, 500) || null
      }

      const existingParts = String(existingValue ?? '')
        .split(',')
        .map((part) => normalizeText(part, 200))
        .filter(Boolean)
      if (!existingParts.includes(normalizedNextValue)) {
        existingParts.push(normalizedNextValue)
      }

      return normalizeText(existingParts.join(', '), 500) || null
    }

    quickBooksProjects.forEach((project) => {
      const orderNumber = normalizeText(project?.orderNumber, 120) || null
      const projectId = normalizeText(project?.projectId, 120) || null
      const projectName = normalizeText(project?.projectName, 260) || null

      if (projectId) {
        activeQuickBooksProjectIds.add(projectId)
      }

      const orderKey = buildOrderKey({
        orderNumber: shouldUseQuickBooksOrderNumberForKey(orderNumber) ? orderNumber : null,
        quickBooksProjectId: projectId,
      })
      if (!orderKey) {
        return
      }

      const row = mergedByKey.get(orderKey) ?? createEmptyUnifiedOrder(orderKey)

      if (!row.order_number && orderNumber) {
        row.order_number = orderNumber
      }
      if (!row.order_name) {
        row.order_name = projectName
      }

      const existingProjectIds = Array.isArray(row.qb_project_ids)
        ? row.qb_project_ids
          .map((value) => normalizeText(value, 120))
          .filter(Boolean)
        : []
      const existingProjectNames = Array.isArray(row.qb_project_names)
        ? row.qb_project_names
          .map((value) => normalizeText(value, 260))
          .filter(Boolean)
        : []

      if (projectId && !existingProjectIds.includes(projectId)) {
        existingProjectIds.push(projectId)
      }
      if (projectName && !existingProjectNames.includes(projectName)) {
        existingProjectNames.push(projectName)
      }

      row.has_quickbooks_record = true
      row.qb_project_ids = existingProjectIds
      row.qb_project_names = existingProjectNames
      row.qb_project_id = normalizeText(row.qb_project_id, 120) || existingProjectIds[0] || null
      row.qb_project_name = normalizeText(row.qb_project_name, 260) || existingProjectNames[0] || null
      row.billedAmount = addMoney(row.billedAmount ?? row.billAmount, project?.billAmount)
      row.billAmount = row.billedAmount
      row.billBalanceAmount = addMoney(row.billBalanceAmount, project?.billBalanceAmount)
      row.invoiceAmount = addMoney(row.invoiceAmount, project?.invoiceAmount)
      row.paymentAmount = addMoney(row.paymentAmount, project?.paymentAmount)
      row.amountOwed = addMoney(row.amountOwed, project?.amountOwed)
      row.poAmount = addMoney(row.poAmount, project?.purchaseOrderAmount)
      row.invoiceNumber = mergeCsvValue(row.invoiceNumber, project?.invoiceNumber)

      const projectPaidInFull = toBooleanOrNull(project?.paidInFull)
      if (typeof projectPaidInFull === 'boolean') {
        row.paidInFull =
          typeof row.paidInFull === 'boolean'
            ? row.paidInFull && projectPaidInFull
            : projectPaidInFull
      }

      mergedByKey.set(orderKey, row)
    })

    return activeQuickBooksProjectIds
  }

  // -- Targeted name-only lookups ------------------------------------------

  async function flagDesignBoardMatches(mergedByKey, warnings) {
    const designBoardId = normalizeText(mondayPreproductionBoardId, 120)
    if (!designBoardId) {
      return { candidateCount: 0, matchedCount: 0 }
    }

    const candidates = []
    mergedByKey.forEach((row) => {
      if (row.has_quickbooks_record && !row.has_monday_record && !row.is_shipped) {
        candidates.push(row)
      }
    })

    if (candidates.length === 0) {
      return { candidateCount: 0, matchedCount: 0 }
    }

    let snapshot = null
    try {
      snapshot = await fetchMondayBoardItemNames({
        boardId: designBoardId,
        boardUrl: normalizeText(mondayPreproductionBoardUrl, 400) || null,
        boardName: 'Pre-Production / Design AKF',
      })
    } catch (error) {
      warnings.push(`Design board lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return { candidateCount: candidates.length, matchedCount: 0 }
    }

    const lookup = buildNameLookupFromMondayItems(snapshot.items)
    let matchedCount = 0

    candidates.forEach((row) => {
      const match = findNameLookupMatch(row, lookup)
      if (!match) {
        return
      }
      row.in_design = true
      row.Monday_status = 'In Design'
      row.monday_item_id = row.monday_item_id || match.id
      row.monday_board_id = designBoardId
      row.monday_board_name = snapshot.board?.name || row.monday_board_name
      matchedCount += 1
    })

    return { candidateCount: candidates.length, matchedCount }
  }

  async function checkShippedBoardForMissing(carryoverRows, warnings) {
    const shippedBoardId = normalizeText(mondayShippedBoardId, 120)
    if (!shippedBoardId || carryoverRows.length === 0) {
      return { lookup: null, snapshot: null }
    }

    try {
      const snapshot = await fetchMondayBoardItemNames({
        boardId: shippedBoardId,
        boardUrl: normalizeText(mondayShippedBoardUrl, 400) || null,
        boardName: 'Shipped Orders',
      })
      return {
        lookup: buildNameLookupFromMondayItems(snapshot.items),
        snapshot,
      }
    } catch (error) {
      warnings.push(`Shipped board lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return { lookup: null, snapshot: null }
    }
  }

  async function enrichMatchedShippedRows({ matchedRowsByItemId, refreshedAt, warnings }) {
    const shippedBoardId = normalizeText(mondayShippedBoardId, 120)

    if (!shippedBoardId || matchedRowsByItemId.size === 0 || typeof fetchMondayBoardItemsByIds !== 'function') {
      return 0
    }

    try {
      const matchedItemIds = [...matchedRowsByItemId.keys()]
      const snapshot = await fetchMondayBoardItemsByIds({
        boardId: shippedBoardId,
        boardUrl: normalizeText(mondayShippedBoardUrl, 400) || null,
        boardName: 'Shipped Orders',
        itemIds: matchedItemIds,
      })
      const detailRowsByItemId = new Map(
        (Array.isArray(snapshot?.orders) ? snapshot.orders : [])
          .map((order) => [normalizeText(order?.id, 120), order]),
      )
      let enrichedCount = 0

      matchedRowsByItemId.forEach((row, itemId) => {
        const detail = detailRowsByItemId.get(itemId)

        if (!detail) {
          return
        }

        row.has_monday_record = true
        row.is_shipped = true
        row.Monday_status = 'Shipped'
        row.monday_item_id = itemId
        row.monday_board_id = shippedBoardId
        row.monday_board_name = normalizeText(snapshot?.board?.name, 260)
          || row.monday_board_name
          || 'Shipped Orders'
        row.order_name = normalizeText(detail?.name, 260) || row.order_name
        row.Monday_url = normalizeText(detail?.itemUrl, 500) || row.Monday_url
        row.shipped_at = toIsoOrNull(detail?.shippedAt) || row.shipped_at || refreshedAt
        row.Due_date = toIsoOrNull(detail?.effectiveDueDate) || row.Due_date
        row.order_date = toIsoOrNull(detail?.orderDate) || row.order_date
        row.monday_updated_at = toIsoOrNull(detail?.updatedAt) || row.monday_updated_at

        const leadTimeDays = Number(detail?.leadTimeDays)
        if (Number.isFinite(leadTimeDays)) {
          row.Lead_time_days = leadTimeDays
        }

        const progressPercent = Number(detail?.progressPercent)
        if (Number.isFinite(progressPercent)) {
          row.progress_percent = progressPercent
        }

        const sourceDrawingUrl = normalizeText(detail?.shopDrawingUrl, 800) || null
        if (sourceDrawingUrl) {
          row.Shop_drawing_source = sourceDrawingUrl
          row.Shop_drawing = row.Shop_drawing_cached || row.Shop_drawing_source || row.Shop_drawing
        }

        row.hazard_reason = null
        enrichedCount += 1
      })

      return enrichedCount
    } catch (error) {
      warnings.push(`Shipped detail lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return 0
    }
  }

  // -- Main refresh ---------------------------------------------------------

  async function runRefresh() {
    const refreshedAt = new Date().toISOString()
    const warnings = []
    const orderTrackBoardId = normalizeText(mondayBoardId, 120)
    const shippedBoardId = normalizeText(mondayShippedBoardId, 120)

    // Always invalidate the targeted-lookup name caches at the start of a
    // refresh — we want fresh state for the design and shipped boards.
    if (typeof invalidateMondayBoardNamesCache === 'function') {
      invalidateMondayBoardNamesCache()
    }

    const [orderTrackSnapshot, quickBooksResult] = await Promise.all([
      pullOrderTrack(warnings),
      pullQuickBooks(warnings),
    ])
    const quickBooksData = quickBooksResult.data
    const quickBooksSucceeded = quickBooksResult.succeeded

    const { mondayOrdersCollection, orderProgressCollection, ordersUnifiedCollection } =
      await getCollections()

    const orderTrackOrderQuery = orderTrackBoardId
      ? { mondayBoardId: orderTrackBoardId }
      : shippedBoardId
        ? { mondayBoardId: { $ne: shippedBoardId } }
        : {}

    const [orderTrackDocuments, orderProgressDocuments, existingNonShippedRows] = await Promise.all([
      mondayOrdersCollection
        .find(orderTrackOrderQuery, {
          projection: {
            _id: 0,
            mondayItemId: 1,
            mondayItemUrl: 1,
            statusLabel: 1,
            orderName: 1,
            jobNumber: 1,
            mondayBoardId: 1,
            mondayBoardName: 1,
            mondayUpdatedAt: 1,
            orderDate: 1,
            dueDate: 1,
            effectiveDueDate: 1,
            computedDueDate: 1,
            leadTimeDays: 1,
            progressPercent: 1,
            shippedAt: 1,
            movedToShippedAt: 1,
            shopDrawingDownloadUrl: 1,
            shopDrawingUrl: 1,
          },
        })
        .toArray(),
      orderProgressCollection
        .find({}, { projection: { _id: 0, id: 1, date: 1, jobName: 1, readyPercent: 1, updatedAt: 1 } })
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
      ordersUnifiedCollection.find({ is_shipped: { $ne: true } }).toArray(),
    ])

    const statusHistoryLookups = buildStatusHistoryLookups(orderProgressDocuments)
    const mergedByKey = new Map()

    const orderTrackOrdersForMerge = orderTrackDocuments.map((doc) => ({
      id: doc.mondayItemId,
      name: doc.orderName,
      jobNumber: doc.jobNumber,
      itemUrl: doc.mondayItemUrl,
      statusLabel: doc.statusLabel,
      boardId: doc.mondayBoardId,
      boardName: doc.mondayBoardName,
      updatedAt: doc.mondayUpdatedAt,
      orderDate: doc.orderDate,
      dueDate: doc.dueDate,
      effectiveDueDate: doc.effectiveDueDate,
      computedDueDate: doc.computedDueDate,
      leadTimeDays: doc.leadTimeDays,
      progressPercent: doc.progressPercent,
      shippedAt: doc.shippedAt,
      movedToShippedAt: doc.movedToShippedAt,
      shopDrawingCachedUrl: doc.shopDrawingDownloadUrl,
      shopDrawingUrl: doc.shopDrawingUrl,
    }))

    const activeMondayItemIds = applyMondayOrdersToMerged(
      orderTrackOrdersForMerge,
      mergedByKey,
      shippedBoardId,
    )
    const activeQuickBooksProjectIds = applyQuickBooksToMerged(
      Array.isArray(quickBooksData?.projects) ? quickBooksData.projects : [],
      mergedByKey,
    )

    // Targeted design-board lookup for QB-only non-shipped rows.
    const designStats = await flagDesignBoardMatches(mergedByKey, warnings)

    // Carryover: rows in DB (non-shipped) that didn't show up in this pull.
    const carryoverCandidates = []
    ;(Array.isArray(existingNonShippedRows) ? existingNonShippedRows : []).forEach((stored) => {
      const row = hydrateUnifiedRowFromStoredDocument(stored)
      if (!row || mergedByKey.has(row.orderKey)) {
        return
      }
      const mondayId = normalizeText(row.monday_item_id, 120)
      if (mondayId && activeMondayItemIds.has(mondayId)) {
        return
      }
      const projectIds = [
        normalizeText(row.qb_project_id, 120),
        ...(Array.isArray(row.qb_project_ids)
          ? row.qb_project_ids.map((value) => normalizeText(value, 120)).filter(Boolean)
          : []),
      ]
      const hasActiveProject = projectIds.some((projectId) => activeQuickBooksProjectIds.has(projectId))
      if (hasActiveProject) {
        return
      }
      carryoverCandidates.push(row)
    })

    const quickBooksOnlyCandidates = []
    mergedByKey.forEach((row) => {
      if (row.has_quickbooks_record && !row.has_monday_record && !row.is_shipped) {
        quickBooksOnlyCandidates.push(row)
      }
    })
    const rowsToCheckOnShipped = [...quickBooksOnlyCandidates, ...carryoverCandidates]
    const carryoverOrderKeys = new Set(carryoverCandidates.map((row) => row.orderKey))
    const { lookup: shippedLookup } = await checkShippedBoardForMissing(rowsToCheckOnShipped, warnings)

    let carryoverMarkedShippedCount = 0
    let carryoverHazardCount = 0
    let quickBooksOnlyMarkedShippedCount = 0
    const matchedRowsByItemId = new Map()

    rowsToCheckOnShipped.forEach((row) => {
      const match = shippedLookup ? findNameLookupMatch(row, shippedLookup) : null

      if (match) {
        const matchedItemId = normalizeText(match?.id, 120)

        row.is_shipped = true
        row.Monday_status = 'Shipped'
        row.shipped_at = row.shipped_at || refreshedAt
        row.has_monday_record = true
        row.monday_item_id = row.monday_item_id || matchedItemId
        row.monday_board_id = normalizeText(mondayShippedBoardId, 120) || row.monday_board_id
        row.monday_board_name = row.monday_board_name || 'Shipped Orders'
        row.hazard_reason = null

        if (matchedItemId) {
          matchedRowsByItemId.set(matchedItemId, row)
        }

        if (carryoverOrderKeys.has(row.orderKey)) {
          carryoverMarkedShippedCount += 1
        } else {
          quickBooksOnlyMarkedShippedCount += 1
        }
      } else if (carryoverOrderKeys.has(row.orderKey)) {
        row.hazard_reason = 'Missing from Order Track and not found on the Shipped board.'
        carryoverHazardCount += 1
      }

      mergedByKey.set(row.orderKey, row)
    })

    const shippedDetailEnrichedCount = await enrichMatchedShippedRows({
      matchedRowsByItemId,
      refreshedAt,
      warnings,
    })

    // -- Final mapping --------------------------------------------------------

    const mergedRows = [...mergedByKey.values()].map((row) => {
      const statusHistory = resolveStatusHistoryForOrder(row, statusHistoryLookups)
      const latest = statusHistory[0] ?? null
      const hasMonday = Boolean(row.has_monday_record)
      const hasQB = Boolean(row.has_quickbooks_record)
      const existingHazard = normalizeText(row.hazard_reason, 500) || null

      row.status = statusHistory
      row.manager_ready_percent = Number.isFinite(Number(latest?.readyPercent))
        ? Number(latest.readyPercent)
        : null
      row.manager_ready_date = normalizeText(latest?.date, 80) || null
      row.manager_ready_updated_at = normalizeText(latest?.updatedAt, 80) || null
      row.order_number = row.order_number || row.monday_item_id || row.qb_project_id || null
      row.order_name = row.order_name || row.qb_project_name || null
      row.Shop_drawing_cached = normalizeText(row.Shop_drawing_cached, 800) || null
      row.Shop_drawing_source = normalizeText(row.Shop_drawing_source, 800) || null
      if (!row.Shop_drawing_cached && !row.Shop_drawing_source) {
        row.Shop_drawing_source = normalizeText(row.Shop_drawing, 800) || null
      }
      row.Shop_drawing = row.Shop_drawing_cached || row.Shop_drawing_source || null

      // Hazard rules:
      //   - Order Track has it but QB doesn't  → real hazard (must be fixed)
      //   - QB has it but Order Track doesn't, and we found it in design → not a hazard
      //   - QB has it but Order Track doesn't, and design didn't match   → hazard
      //   - QB outage → don't fabricate "missing from QuickBooks" hazards
      if (existingHazard) {
        row.hazard_reason = existingHazard
      } else if (hasMonday && !hasQB && quickBooksSucceeded) {
        row.hazard_reason = 'Order Track item not found in QuickBooks projects.'
      } else if (hasQB && !hasMonday && !row.in_design) {
        row.hazard_reason = 'QuickBooks project not found in Order Track or Design.'
      } else {
        row.hazard_reason = null
      }

      row.source = hasMonday && hasQB ? 'merged' : hasQB ? 'quickbooks' : 'monday'
      row.lastSyncedAt = refreshedAt
      row.updatedAt = refreshedAt
      row.quickbooks_synced_at = quickBooksData?.generatedAt || null

      return row
    })

    if (mergedRows.length > 0) {
      await ordersUnifiedCollection.bulkWrite(
        mergedRows.map((row) => ({
          updateOne: {
            filter: { orderKey: row.orderKey },
            update: {
              $set: row,
              $unset: {
                totalBilledAmount: '',
                billsAmount: '',
              },
              $setOnInsert: { createdAt: refreshedAt },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      )

      // Stale-row cleanup: only when this run produced a substantial dataset,
      // so a partial Monday outage cannot wipe real orders.
      const safeToCleanUp =
        orderTrackDocuments.length >= SANITY_FLOOR && mergedRows.length >= SANITY_FLOOR

      if (safeToCleanUp) {
        await ordersUnifiedCollection.deleteMany({
          lastSyncedAt: { $ne: refreshedAt },
          is_shipped: { $ne: true },
        })
      } else {
        warnings.push(
          `Skipped stale-row cleanup: ${orderTrackDocuments.length} Order Track / ${mergedRows.length} merged rows (floor ${SANITY_FLOOR}).`,
        )
      }
    }

    return {
      refreshedAt,
      mergedOrderCount: mergedRows.length,
      orderTrackOrderCount: orderTrackOrders(orderTrackSnapshot).length,
      designBoardCandidateCount: designStats.candidateCount,
      designBoardMatchedCount: designStats.matchedCount,
      carryoverCheckedCount: carryoverCandidates.length,
      carryoverMarkedShippedCount,
      carryoverHazardCount,
      shippedLookupCandidateCount: rowsToCheckOnShipped.length,
      quickBooksOnlyShippedCheckedCount: quickBooksOnlyCandidates.length,
      quickBooksOnlyMarkedShippedCount,
      shippedDetailEnrichedCount,
      quickBooksProjectCount: Array.isArray(quickBooksData?.projects)
        ? quickBooksData.projects.length
        : 0,
      quickBooksSyncedAt: quickBooksData?.generatedAt || null,
      warnings,
    }
  }

  function orderTrackOrders(snapshot) {
    return Array.isArray(snapshot?.orders) ? snapshot.orders : []
  }

  async function refreshOrdersUnifiedCollection() {
    if (inFlightRefresh) {
      return inFlightRefresh
    }
    const promise = runRefresh()
    inFlightRefresh = promise.finally(() => {
      if (inFlightRefresh === promise) {
        inFlightRefresh = null
      }
    })
    return inFlightRefresh
  }

  return { refreshOrdersUnifiedCollection }
}
