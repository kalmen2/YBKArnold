// Orders refresh orchestrator.
//
// One canonical flow used by both the manual Refresh button and the daily cron:
//   1. Pull Order Track from Monday (whitelisted columns, no subitems).
//   2. Pull QuickBooks projects + financials.
//   3. Merge by order number / Monday item id / QB project id.
//   4. Pull all item names from the Design (Pre-Production) board, seed every
//      current Design item into the unified map, and merge any QB matches.
//   5. For every non-shipped QB row still missing from Monday (including
//      carryover rows), run ONE name-only lookup against the Shipped board.
//      Matches → mark shipped.
//      Then fetch details for ONLY those matched shipped item ids so we can
//      hydrate shipped date / drawings / dates without a full shipped-board
//      detail pull.
//      Misses on carryover rows → real hazard.
//   6. Bulk upsert + stale QB-key cleanup for obsolete carryover rows.
//
// Targeted name-only lookups replace the old "pull the entire shipped board"
// and "pull the entire pre-production board" patterns.

import {
  normalizeProgressStageKey,
  normalizeProgressStageStatus,
} from '../orders/stage-registry.mjs'
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
import { toMoneyOrNull as toMoney } from '../utils/value-utils.mjs'

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

function normalizeOrderMatchKey(value) {
  return normalizeText(value, 120)
    .toLowerCase()
    .split(' ')
    .join('')
}

function normalizeProgressStatusDetails(details) {
  const normalizeOptions = (options) => [...new Set(
    (Array.isArray(options) ? options : [])
      .map((option) => {
        if (typeof option === 'string') {
          return normalizeText(option, 120)
        }

        return normalizeText(option?.label, 120)
      })
      .filter(Boolean),
  )]

  const normalizeOptionStyles = (optionStyles) => {
    const stylesByLabel = new Map()

    ;(Array.isArray(optionStyles) ? optionStyles : []).forEach((entry) => {
      const label = normalizeText(
        (entry && typeof entry === 'object') ? entry?.label : entry,
        120,
      )

      if (!label || stylesByLabel.has(label)) {
        return
      }

      stylesByLabel.set(label, {
        label,
        color: normalizeText(entry?.color, 40) || null,
        border: normalizeText(entry?.border, 40) || null,
        varName: normalizeText(entry?.varName ?? entry?.var_name, 80) || null,
      })
    })

    return [...stylesByLabel.values()]
  }

  return (Array.isArray(details) ? details : []).map((entry) => ({
    key: normalizeText(entry?.key, 80) || null,
    label: normalizeText(entry?.label, 120) || null,
    weight: Number.isFinite(Number(entry?.weight)) ? Number(entry.weight) : 0,
    columnId: normalizeText(entry?.columnId, 120) || null,
    status: normalizeText(entry?.status, 200) || null,
    options: normalizeOptions(entry?.options),
    optionStyles: normalizeOptionStyles(entry?.optionStyles),
  }))
}

function resolveProductionStartedFromProgressStatusDetails(progressStatusDetails) {
  const trackedStages = (Array.isArray(progressStatusDetails) ? progressStatusDetails : [])
    .map((entry) => {
      const key = normalizeProgressStageKey(entry?.key)
      const status = normalizeProgressStageStatus(entry?.status)

      if (!key || !status) {
        return null
      }

      return {
        key,
        status,
      }
    })
    .filter((entry) => Boolean(entry))

  if (trackedStages.length === 0) {
    return false
  }

  return trackedStages.some((stage) => stage.key !== 'design')
}

function normalizeOrderProgressJobName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toIsoDateOnly(value) {
  const normalized = normalizeText(value, 80)

  if (!normalized) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized
  }

  // Preserve explicit source date components (e.g. 2026-06-30T23:00:00-05:00)
  // so month/day are not shifted by timezone conversion.
  const sourceDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/)

  if (sourceDateMatch) {
    return sourceDateMatch[1]
  }

  const parsedMs = Date.parse(normalized)

  if (!Number.isFinite(parsedMs)) {
    return null
  }

  return new Date(parsedMs).toISOString().slice(0, 10)
}

function buildShippedProgressRecordId(normalizedJobName, date) {
  const normalizedKey = String(normalizedJobName ?? '')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)

  return `auto_shipped_${normalizedKey || 'unknown'}_${date}`
}

function shouldFlagOrderAsMovedToShippedOutsideWebsite(row, orderTrackBoardId) {
  if (!row?.has_monday_record) {
    return false
  }

  const previousBoardId = normalizeText(row?.monday_board_id, 120)

  if (!orderTrackBoardId) {
    return true
  }

  if (!previousBoardId) {
    return true
  }

  return previousBoardId === orderTrackBoardId
}

function isNewOrdersBoardName(value) {
  const normalizedBoardName = normalizeText(value, 260).toLowerCase()

  if (!normalizedBoardName) {
    return false
  }

  return /^new\s+orders\s+\d{4}$/i.test(normalizedBoardName)
}

function isPendingManualPlacementRow(row, {
  orderTrackBoardId,
  designBoardId,
  shippedBoardId,
}) {
  if (!row || row.is_shipped) {
    return false
  }

  if (!row.has_monday_record || !row.in_design) {
    return false
  }

  const boardId = normalizeText(row?.monday_board_id, 120)
  const boardName = normalizeText(row?.monday_board_name, 260)

  if (!isNewOrdersBoardName(boardName)) {
    return false
  }

  if (boardId && [orderTrackBoardId, designBoardId, shippedBoardId].includes(boardId)) {
    return false
  }

  return true
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
      const progressStatusDetails = normalizeProgressStatusDetails(order?.progressStatusDetails)
      const isShipped = isShippedOrderDocument(
        {
          mondayBoardId: order?.boardId,
          movedToShippedAt: order?.movedToShippedAt,
          statusLabel: order?.statusLabel,
        },
        normalizedShippedBoardId,
      )
      const isProductionStarted =
        typeof order?.isProductionStarted === 'boolean'
          ? order.isProductionStarted
          : resolveProductionStartedFromProgressStatusDetails(progressStatusDetails)
      const scheduleEligible = isShipped || isProductionStarted
      const incoming = {
        order_number: orderNumber,
        monday_item_id: mondayItemId,
        Monday_url: normalizeText(order?.itemUrl, 500) || null,
        Monday_status: normalizeText(order?.statusLabel, 260) || null,
        order_name: normalizeText(order?.name, 260) || null,
        ship_to: normalizeText(order?.shipTo, 500) || null,
        ship_notes: normalizeText(order?.shipNotes, 2000) || null,
        bol: normalizeText(order?.bol, 200) || null,
        BOL_cached: normalizeText(order?.bolCachedUrl, 800) || null,
        BOL_source: normalizeText(order?.bolUrl, 800) || null,
        signed_bol: normalizeText(order?.signedBol, 200) || null,
        Signed_BOL_source: normalizeText(order?.signedBolUrl, 800) || null,
        inspection_sheet: normalizeText(order?.inspectionSheet, 200) || null,
        Inspection_sheet_source: normalizeText(order?.inspectionSheetUrl, 800) || null,
        po_number: normalizeText(order?.poNumber, 120) || null,
        monday_notes: normalizeText(order?.notes, 2000) || null,
        monday_description: normalizeText(order?.description, 2000) || null,
        is_shipped: isShipped,
        is_production_started: isShipped || isProductionStarted,
        Due_date: scheduleEligible
          ? toIsoOrNull(order?.dueDate)
          : null,
        Lead_time_days: scheduleEligible && Number.isFinite(Number(order?.leadTimeDays))
          ? Number(order.leadTimeDays)
          : null,
        progress_percent: Number.isFinite(Number(order?.progressPercent))
          ? Number(order.progressPercent)
          : null,
        progress_status_details: progressStatusDetails,
        order_date: toIsoOrNull(order?.orderDate),
        Shop_drawing_cached: normalizeText(order?.shopDrawingCachedUrl, 800) || null,
        Shop_drawing_source: normalizeText(order?.shopDrawingUrl, 800) || null,
        Cut_list_cached: normalizeText(order?.cutListCachedUrl, 800) || null,
        Cut_list_source: normalizeText(order?.cutListUrl, 800) || null,
        shipped_at: toIsoOrNull(order?.shippedAt),
        shipped_at_inferred: toIsoOrNull(order?.shippedAt)
          ? false
          : isShippedOrderDocument(
            {
              mondayBoardId: order?.boardId,
              movedToShippedAt: order?.movedToShippedAt,
              statusLabel: order?.statusLabel,
            },
            normalizedShippedBoardId,
          )
            ? true
            : null,
        monday_board_id: normalizeText(order?.boardId, 120) || null,
        monday_board_name: normalizeText(order?.boardName, 260) || null,
        monday_updated_at: toIsoOrNull(order?.updatedAt),
      }
      incoming.Shop_drawing = incoming.Shop_drawing_cached || incoming.Shop_drawing_source || null
      incoming.Cut_list = incoming.Cut_list_cached || incoming.Cut_list_source || null
      incoming.BOL = incoming.BOL_cached || incoming.BOL_source || null
      incoming.Signed_BOL = incoming.Signed_BOL_source || null
      incoming.Inspection_sheet = incoming.Inspection_sheet_source || null

      if (!row.order_number && incoming.order_number) {
        row.order_number = incoming.order_number
      }

      if (shouldReplaceMondayDetails(row, incoming)) {
        Object.assign(row, {
          monday_item_id: incoming.monday_item_id,
          Monday_url: incoming.Monday_url,
          Monday_status: incoming.is_shipped ? 'Shipped' : incoming.Monday_status,
          order_name: incoming.order_name || row.order_name,
          ship_to: incoming.ship_to || row.ship_to,
          ship_notes: incoming.ship_notes || row.ship_notes,
          bol: incoming.bol || row.bol,
          BOL_cached: incoming.BOL_cached || null,
          BOL_source: incoming.BOL_source || null,
          BOL: incoming.BOL || row.BOL,
          signed_bol: incoming.signed_bol || row.signed_bol,
          Signed_BOL_source: incoming.Signed_BOL_source || null,
          Signed_BOL: incoming.Signed_BOL || row.Signed_BOL,
          inspection_sheet: incoming.inspection_sheet || row.inspection_sheet,
          Inspection_sheet_source: incoming.Inspection_sheet_source || null,
          Inspection_sheet: incoming.Inspection_sheet || row.Inspection_sheet,
          po_number: incoming.po_number || row.po_number,
          monday_notes: incoming.monday_notes || row.monday_notes,
          monday_description: incoming.monday_description || row.monday_description,
          is_production_started: incoming.is_production_started,
          Due_date: incoming.Due_date,
          Lead_time_days: incoming.Lead_time_days,
          progress_percent: incoming.progress_percent ?? row.progress_percent,
          progress_status_details:
            incoming.progress_status_details.length > 0
              ? incoming.progress_status_details
              : row.progress_status_details,
          order_date: incoming.order_date || row.order_date,
          Shop_drawing_cached: incoming.Shop_drawing_cached || null,
          Shop_drawing_source: incoming.Shop_drawing_source || null,
          Shop_drawing: incoming.Shop_drawing || row.Shop_drawing,
          Cut_list_cached: incoming.Cut_list_cached || null,
          Cut_list_source: incoming.Cut_list_source || null,
          Cut_list: incoming.Cut_list || row.Cut_list,
          shipped_at: incoming.shipped_at || row.shipped_at,
          shipped_at_inferred:
            incoming.shipped_at
              ? false
              : incoming.shipped_at_inferred ?? row.shipped_at_inferred,
          monday_board_id: incoming.monday_board_id,
          monday_board_name: incoming.monday_board_name,
          monday_updated_at: incoming.monday_updated_at,
        })
      }

      row.is_shipped = row.is_shipped || incoming.is_shipped
      row.is_production_started = Boolean(
        row.is_production_started || incoming.is_production_started || row.is_shipped,
      )
      row.has_monday_record = true
      mergedByKey.set(orderKey, row)
    })

    return activeMondayItemIds
  }

  function applyQuickBooksToMerged(quickBooksProjects, mergedByKey) {
    const activeQuickBooksProjectIds = new Set()
    const mondayOrderKeyByMatchKey = new Map()

    mergedByKey.forEach((row, orderKey) => {
      if (!row?.has_monday_record) {
        return
      }

      const matchKey = normalizeOrderMatchKey(row?.order_number)

      if (!matchKey || mondayOrderKeyByMatchKey.has(matchKey)) {
        return
      }

      mondayOrderKeyByMatchKey.set(matchKey, orderKey)
    })

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
      if (!orderNumber) {
        return
      }

      const projectId = normalizeText(project?.projectId, 120) || null
      const projectName = normalizeText(project?.projectName, 260) || null
      const matchKey = normalizeOrderMatchKey(orderNumber)
      const matchedMondayOrderKey = matchKey
        ? mondayOrderKeyByMatchKey.get(matchKey)
        : null

      if (projectId) {
        activeQuickBooksProjectIds.add(projectId)
      }

      const orderKey = matchedMondayOrderKey || buildOrderKey({
        orderNumber: shouldUseQuickBooksOrderNumberForKey(orderNumber) ? orderNumber : null,
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
      return {
        candidateCount: 0,
        matchedCount: 0,
        boardItemCount: 0,
        activeItemIds: new Set(),
        lookupSucceeded: false,
        matchedRowsByItemId: new Map(),
      }
    }

    const candidates = []
    mergedByKey.forEach((row) => {
      if (row.has_quickbooks_record && !row.has_monday_record && !row.is_shipped) {
        candidates.push(row)
      }
    })

    let snapshot = null
    try {
      snapshot = await fetchMondayBoardItemNames({
        boardId: designBoardId,
        boardUrl: normalizeText(mondayPreproductionBoardUrl, 400) || null,
        boardName: 'Pre-Production / Design AKF',
      })
    } catch (error) {
      warnings.push(`Design board lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return {
        candidateCount: candidates.length,
        matchedCount: 0,
        boardItemCount: 0,
        activeItemIds: new Set(),
        lookupSucceeded: false,
        matchedRowsByItemId: new Map(),
      }
    }

    const designItems = Array.isArray(snapshot?.items) ? snapshot.items : []
    const lookup = buildNameLookupFromMondayItems(designItems)
    const matchedRowsByItemId = new Map()
    const activeItemIds = new Set()
    let matchedCount = 0

    candidates.forEach((row) => {
      const match = findNameLookupMatch(row, lookup)

      if (!match) {
        return
      }

      const matchedItemId = normalizeText(match?.id, 120)

      if (!matchedItemId) {
        return
      }

      row.in_design = true
      row.Monday_status = 'In Design'
      row.monday_item_id = row.monday_item_id || matchedItemId
      row.monday_board_id = designBoardId
      row.monday_board_name = snapshot.board?.name || row.monday_board_name

      if (!matchedRowsByItemId.has(matchedItemId)) {
        matchedRowsByItemId.set(matchedItemId, row)
      }

      matchedCount += 1
    })

    designItems.forEach((item) => {
      const itemId = normalizeText(item?.id, 120)

      if (!itemId) {
        return
      }

      activeItemIds.add(itemId)

      const itemName = normalizeText(item?.name, 260) || null
      const orderNumber = resolveOrderNumberFromMondayOrder({
        orderName: itemName,
      })
      const orderKey = buildOrderKey({
        orderNumber,
        mondayItemId: itemId,
      })

      if (!orderKey) {
        return
      }

      const row = mergedByKey.get(orderKey) ?? createEmptyUnifiedOrder(orderKey)

      row.order_number = row.order_number || orderNumber || null
      row.order_name = itemName || row.order_name
      row.in_design = true
      row.has_monday_record = true
      row.is_shipped = false
      row.hazard_reason = null
      row.Monday_status = 'In Design'
      row.monday_item_id = itemId
      row.monday_board_id = designBoardId
      row.monday_board_name = normalizeText(snapshot?.board?.name, 260)
        || row.monday_board_name
        || 'Pre-Production / Design AKF'

      mergedByKey.set(orderKey, row)
      matchedRowsByItemId.set(itemId, row)
    })

    return {
      candidateCount: candidates.length,
      matchedCount,
      boardItemCount: designItems.length,
      activeItemIds,
      lookupSucceeded: true,
      matchedRowsByItemId,
    }
  }

  async function enrichMatchedDesignRows({ matchedRowsByItemId, warnings }) {
    const designBoardId = normalizeText(mondayPreproductionBoardId, 120)

    if (!designBoardId || matchedRowsByItemId.size === 0 || typeof fetchMondayBoardItemsByIds !== 'function') {
      return 0
    }

    try {
      const matchedItemIds = [...matchedRowsByItemId.keys()]
      const snapshot = await fetchMondayBoardItemsByIds({
        boardId: designBoardId,
        boardUrl: normalizeText(mondayPreproductionBoardUrl, 400) || null,
        boardName: 'Pre-Production / Design AKF',
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

        row.in_design = true
        row.has_monday_record = true
        row.monday_item_id = itemId
        row.monday_board_id = designBoardId
        row.monday_board_name = normalizeText(snapshot?.board?.name, 260)
          || row.monday_board_name
          || 'Pre-Production / Design AKF'
        row.order_name = normalizeText(detail?.name, 260) || row.order_name
        row.Monday_status = normalizeText(detail?.statusLabel, 260) || row.Monday_status || 'In Design'
        row.ship_to = normalizeText(detail?.shipTo, 500) || row.ship_to
        row.ship_notes = normalizeText(detail?.shipNotes, 2000) || row.ship_notes
        row.bol = normalizeText(detail?.bol, 200) || row.bol
        row.signed_bol = normalizeText(detail?.signedBol, 200) || row.signed_bol
        row.inspection_sheet = normalizeText(detail?.inspectionSheet, 200) || row.inspection_sheet
        row.po_number = normalizeText(detail?.poNumber, 120) || row.po_number
        row.monday_notes = normalizeText(detail?.notes, 2000) || row.monday_notes
        row.monday_description = normalizeText(detail?.description, 2000) || row.monday_description
        row.Monday_url = normalizeText(detail?.itemUrl, 500) || row.Monday_url
        row.order_date = toIsoOrNull(detail?.orderDate) || row.order_date
        row.monday_updated_at = toIsoOrNull(detail?.updatedAt) || row.monday_updated_at

        const progressStatusDetails = normalizeProgressStatusDetails(detail?.progressStatusDetails)
        const isProductionStarted =
          typeof detail?.isProductionStarted === 'boolean'
            ? detail.isProductionStarted
            : resolveProductionStartedFromProgressStatusDetails(progressStatusDetails)
        const scheduleEligible = row.is_shipped || isProductionStarted

        row.is_production_started = Boolean(scheduleEligible)
        row.Due_date = scheduleEligible
          ? toIsoOrNull(detail?.dueDate)
          : null

        const leadTimeDays = Number(detail?.leadTimeDays)

        if (scheduleEligible && Number.isFinite(leadTimeDays)) {
          row.Lead_time_days = leadTimeDays
        } else if (!scheduleEligible) {
          row.Lead_time_days = null
        }

        const progressPercent = Number(detail?.progressPercent)

        if (Number.isFinite(progressPercent)) {
          row.progress_percent = progressPercent
        }

        if (progressStatusDetails.length > 0) {
          row.progress_status_details = progressStatusDetails
        }

        const sourceDrawingUrl = normalizeText(detail?.shopDrawingUrl, 800) || null

        if (sourceDrawingUrl) {
          row.Shop_drawing_source = sourceDrawingUrl
          row.Shop_drawing = row.Shop_drawing_cached || row.Shop_drawing_source || row.Shop_drawing
        }

        const sourceCutListUrl = normalizeText(detail?.cutListUrl, 800) || null

        if (sourceCutListUrl) {
          row.Cut_list_source = sourceCutListUrl
          row.Cut_list = row.Cut_list_cached || row.Cut_list_source || row.Cut_list
        }

        const sourceBolUrl = normalizeText(detail?.bolUrl, 800) || null

        if (sourceBolUrl) {
          row.BOL_source = sourceBolUrl
          row.BOL = row.BOL_cached || row.BOL_source || row.BOL
        }

        const sourceSignedBolUrl = normalizeText(detail?.signedBolUrl, 800) || null

        if (sourceSignedBolUrl) {
          row.Signed_BOL_source = sourceSignedBolUrl
          row.Signed_BOL = row.Signed_BOL_source || row.Signed_BOL
        }

        const sourceInspectionSheetUrl = normalizeText(detail?.inspectionSheetUrl, 800) || null

        if (sourceInspectionSheetUrl) {
          row.Inspection_sheet_source = sourceInspectionSheetUrl
          row.Inspection_sheet = row.Inspection_sheet_source || row.Inspection_sheet
        }

        row.hazard_reason = null
        enrichedCount += 1
      })

      return enrichedCount
    } catch (error) {
      warnings.push(`Design detail lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)

      return 0
    }
  }

  async function flagPendingManualRowsOnDesignBoard({ pendingRows, warnings }) {
    const designBoardId = normalizeText(mondayPreproductionBoardId, 120)

    if (!designBoardId) {
      return {
        candidateCount: 0,
        matchedCount: 0,
        matchedRowsByItemId: new Map(),
      }
    }

    const candidates = (Array.isArray(pendingRows) ? pendingRows : [])
      .filter((row) => Boolean(row))

    if (candidates.length === 0) {
      return {
        candidateCount: 0,
        matchedCount: 0,
        matchedRowsByItemId: new Map(),
      }
    }

    let snapshot = null
    try {
      snapshot = await fetchMondayBoardItemNames({
        boardId: designBoardId,
        boardUrl: normalizeText(mondayPreproductionBoardUrl, 400) || null,
        boardName: 'Pre-Production / Design AKF',
      })
    } catch (error) {
      warnings.push(`Pending design lookup failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)
      return {
        candidateCount: candidates.length,
        matchedCount: 0,
        matchedRowsByItemId: new Map(),
      }
    }

    const lookup = buildNameLookupFromMondayItems(snapshot.items)
    const matchedRowsByItemId = new Map()
    let matchedCount = 0

    candidates.forEach((row) => {
      const match = findNameLookupMatch(row, lookup)

      if (!match) {
        return
      }

      const matchedItemId = normalizeText(match?.id, 120)

      if (!matchedItemId) {
        return
      }

      row.in_design = true
      row.hazard_reason = null
      row.Monday_status = 'In Design'
      row.monday_item_id = row.monday_item_id || matchedItemId
      row.monday_board_id = designBoardId
      row.monday_board_name = snapshot.board?.name || row.monday_board_name

      if (!matchedRowsByItemId.has(matchedItemId)) {
        matchedRowsByItemId.set(matchedItemId, row)
      }

      matchedCount += 1
    })

    return {
      candidateCount: candidates.length,
      matchedCount,
      matchedRowsByItemId,
    }
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
        row.ship_to = normalizeText(detail?.shipTo, 500) || row.ship_to
        row.ship_notes = normalizeText(detail?.shipNotes, 2000) || row.ship_notes
        row.bol = normalizeText(detail?.bol, 200) || row.bol
        row.signed_bol = normalizeText(detail?.signedBol, 200) || row.signed_bol
        row.inspection_sheet = normalizeText(detail?.inspectionSheet, 200) || row.inspection_sheet
        row.po_number = normalizeText(detail?.poNumber, 120) || row.po_number
        row.monday_notes = normalizeText(detail?.notes, 2000) || row.monday_notes
        row.monday_description = normalizeText(detail?.description, 2000) || row.monday_description
        row.Monday_url = normalizeText(detail?.itemUrl, 500) || row.Monday_url
        const detailShippedAt = toIsoOrNull(detail?.shippedAt)
        if (detailShippedAt) {
          row.shipped_at = detailShippedAt
          row.shipped_at_inferred = false
        } else {
          row.shipped_at = toIsoOrNull(row.shipped_at) || refreshedAt
          if (typeof row.shipped_at_inferred !== 'boolean') {
            row.shipped_at_inferred = true
          }
        }
        row.Due_date = toIsoOrNull(detail?.dueDate)
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

        const progressStatusDetails = normalizeProgressStatusDetails(detail?.progressStatusDetails)
        if (progressStatusDetails.length > 0) {
          row.progress_status_details = progressStatusDetails
        }

        const sourceDrawingUrl = normalizeText(detail?.shopDrawingUrl, 800) || null
        if (sourceDrawingUrl) {
          row.Shop_drawing_source = sourceDrawingUrl
          row.Shop_drawing = row.Shop_drawing_cached || row.Shop_drawing_source || row.Shop_drawing
        }

        const sourceCutListUrl = normalizeText(detail?.cutListUrl, 800) || null
        if (sourceCutListUrl) {
          row.Cut_list_source = sourceCutListUrl
          row.Cut_list = row.Cut_list_cached || row.Cut_list_source || row.Cut_list
        }

        const sourceBolUrl = normalizeText(detail?.bolUrl, 800) || null
        if (sourceBolUrl) {
          row.BOL_source = sourceBolUrl
          row.BOL = row.BOL_cached || row.BOL_source || row.BOL
        }

        const sourceSignedBolUrl = normalizeText(detail?.signedBolUrl, 800) || null
        if (sourceSignedBolUrl) {
          row.Signed_BOL_source = sourceSignedBolUrl
          row.Signed_BOL = row.Signed_BOL_source || row.Signed_BOL
        }

        const sourceInspectionSheetUrl = normalizeText(detail?.inspectionSheetUrl, 800) || null
        if (sourceInspectionSheetUrl) {
          row.Inspection_sheet_source = sourceInspectionSheetUrl
          row.Inspection_sheet = row.Inspection_sheet_source || row.Inspection_sheet
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

  async function enforceShippedOrderProgressFloor({
    mergedRows,
    orderProgressCollection,
    refreshedAt,
    warnings,
  }) {
    const shippedRowsByJob = new Map()

    ;(Array.isArray(mergedRows) ? mergedRows : []).forEach((row) => {
      if (!row?.is_shipped) {
        return
      }

      const orderNumber = normalizeText(row?.order_number, 120)

      if (!orderNumber) {
        return
      }

      const normalizedJobName = normalizeOrderProgressJobName(orderNumber)

      if (!normalizedJobName) {
        return
      }

      const shippedDate = toIsoDateOnly(row?.shipped_at) || toIsoDateOnly(refreshedAt)

      if (!shippedDate) {
        return
      }

      const existing = shippedRowsByJob.get(normalizedJobName)

      if (!existing || shippedDate < existing.shippedDate) {
        shippedRowsByJob.set(normalizedJobName, {
          normalizedJobName,
          orderNumber,
          shippedDate,
        })
      }
    })

    if (shippedRowsByJob.size === 0) {
      return {
        shippedProgressTrackedOrderCount: 0,
        shippedProgressUpsertedCount: 0,
        shippedProgressCorrectedCount: 0,
      }
    }

    try {
      const upsertOperations = [...shippedRowsByJob.values()].map((row) => ({
        updateOne: {
          filter: {
            date: row.shippedDate,
            normalizedJobName: row.normalizedJobName,
          },
          update: {
            $set: {
              date: row.shippedDate,
              jobName: row.orderNumber,
              normalizedJobName: row.normalizedJobName,
              readyPercent: 100,
              updatedAt: refreshedAt,
            },
            $setOnInsert: {
              id: buildShippedProgressRecordId(row.normalizedJobName, row.shippedDate),
              createdAt: refreshedAt,
              isWarranty: false,
            },
          },
          upsert: true,
        },
      }))

      const upsertResult = await orderProgressCollection.bulkWrite(upsertOperations, { ordered: false })
      let shippedProgressCorrectedCount = 0

      for (const row of shippedRowsByJob.values()) {
        const correctionResult = await orderProgressCollection.updateMany(
          {
            normalizedJobName: row.normalizedJobName,
            date: { $gte: row.shippedDate },
            readyPercent: { $ne: 100 },
          },
          {
            $set: {
              readyPercent: 100,
              updatedAt: refreshedAt,
            },
          },
        )

        shippedProgressCorrectedCount += Number(correctionResult?.modifiedCount ?? 0)
      }

      return {
        shippedProgressTrackedOrderCount: shippedRowsByJob.size,
        shippedProgressUpsertedCount: Number(upsertResult?.upsertedCount ?? 0),
        shippedProgressCorrectedCount,
      }
    } catch (error) {
      warnings.push(`Shipped manager progress floor failed: ${normalizeText(error?.message, 400) || 'unknown error'}`)

      return {
        shippedProgressTrackedOrderCount: shippedRowsByJob.size,
        shippedProgressUpsertedCount: 0,
        shippedProgressCorrectedCount: 0,
      }
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

    const { orderProgressCollection, ordersUnifiedCollection } = await getCollections()

    const [orderProgressDocuments, existingNonShippedRows, existingShippedRows] = await Promise.all([
      orderProgressCollection
        .find({}, { projection: { _id: 0, id: 1, date: 1, jobName: 1, readyPercent: 1, updatedAt: 1 } })
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
      ordersUnifiedCollection.find({ is_shipped: { $ne: true } }).toArray(),
      ordersUnifiedCollection
        .find(
          { is_shipped: true },
          {
            projection: {
              _id: 0,
              orderKey: 1,
              shipped_at: 1,
              shipped_at_inferred: 1,
            },
          },
        )
        .toArray(),
    ])

    const existingShippedByOrderKey = new Map(
      (Array.isArray(existingShippedRows) ? existingShippedRows : [])
        .map((row) => [
          normalizeText(row?.orderKey, 200),
          {
            shippedAt: toIsoOrNull(row?.shipped_at),
            shippedAtInferred: toBooleanOrNull(row?.shipped_at_inferred),
          },
        ])
        .filter(([orderKey]) => Boolean(orderKey)),
    )

    const statusHistoryLookups = buildStatusHistoryLookups(orderProgressDocuments)
    const mergedByKey = new Map()

    const orderTrackOrdersForMerge = orderTrackOrders(orderTrackSnapshot).map((order) => ({
      id: order?.id,
      name: order?.name,
      jobNumber: order?.jobNumber,
      itemUrl: order?.itemUrl,
      statusLabel: order?.statusLabel,
      boardId: order?.boardId,
      boardName: order?.boardName,
      updatedAt: order?.updatedAt,
      shipTo: order?.shipTo,
      shipNotes: order?.shipNotes,
      bol: order?.bol,
      bolCachedUrl: order?.bolCachedUrl,
      bolUrl: order?.bolUrl,
      signedBol: order?.signedBol,
      signedBolUrl: order?.signedBolUrl,
      inspectionSheet: order?.inspectionSheet,
      inspectionSheetUrl: order?.inspectionSheetUrl,
      poNumber: order?.poNumber,
      notes: order?.notes,
      description: order?.description,
      orderDate: order?.orderDate,
      dueDate: order?.dueDate,
      effectiveDueDate: order?.effectiveDueDate,
      computedDueDate: order?.computedDueDate,
      leadTimeDays: order?.leadTimeDays,
      progressPercent: order?.progressPercent,
      progressStatusDetails: order?.progressStatusDetails,
      shippedAt: order?.shippedAt,
      movedToShippedAt: order?.movedToShippedAt,
      shopDrawingCachedUrl: order?.shopDrawingCachedUrl,
      shopDrawingUrl: order?.shopDrawingUrl,
      cutListCachedUrl: order?.cutListCachedUrl,
      cutListUrl: order?.cutListUrl,
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
    const staleQuickBooksOrderKeysToDelete = new Set()

    // Targeted design-board lookup for QB-only non-shipped rows.
    const designStats = await flagDesignBoardMatches(mergedByKey, warnings)
    const designDetailEnrichedCount = await enrichMatchedDesignRows({
      matchedRowsByItemId:
        designStats?.matchedRowsByItemId instanceof Map
          ? designStats.matchedRowsByItemId
          : new Map(),
      warnings,
    })

    // Canonical website orders are permanent. Reconcile their external Monday
    // rows into one record and retain the order when either linked item is
    // removed, surfacing the missing source as a hazard instead of deleting it.
    ;(Array.isArray(existingNonShippedRows) ? existingNonShippedRows : [])
      .filter((stored) => stored?.is_canonical_order === true)
      .forEach((stored) => {
        const canonicalRow = hydrateUnifiedRowFromStoredDocument(stored)
        if (!canonicalRow) {
          return
        }

        const primaryItemId = normalizeText(stored?.monday_primary_item_id, 120)
        const secondaryItemId = normalizeText(stored?.monday_secondary_item_id, 120)
        const matchingEntries = [...mergedByKey.entries()].filter(([, row]) => {
          const mondayItemId = normalizeText(row?.monday_item_id, 120)
          return row?.orderKey === canonicalRow.orderKey
            || (primaryItemId && mondayItemId === primaryItemId)
            || (secondaryItemId && mondayItemId === secondaryItemId)
        })
        const primaryActive = Boolean(primaryItemId && activeMondayItemIds.has(primaryItemId))
        const secondaryActive = Boolean(
          secondaryItemId && designStats.activeItemIds.has(secondaryItemId)
        )
        const reconciled = { ...canonicalRow }

        matchingEntries.forEach(([matchingKey, matchingRow]) => {
          Object.entries(matchingRow).forEach(([field, value]) => {
            if (value === null || value === undefined || value === '') {
              return
            }
            if (Array.isArray(value) && value.length === 0) {
              return
            }
            reconciled[field] = value
          })
          if (matchingKey !== canonicalRow.orderKey) {
            mergedByKey.delete(matchingKey)
          }
        })

        reconciled.orderKey = canonicalRow.orderKey
        reconciled.canonical_order_id = stored.canonical_order_id
        reconciled.is_canonical_order = true
        reconciled.has_crm_record = true
        reconciled.has_monday_record = primaryActive || secondaryActive
        reconciled.in_design = secondaryItemId ? true : Boolean(reconciled.in_design)

        if (secondaryActive) {
          reconciled.monday_item_id = secondaryItemId
          reconciled.monday_board_id = designBoardId
        } else if (primaryActive) {
          reconciled.monday_item_id = primaryItemId
          reconciled.monday_board_id = orderTrackBoardId
        } else {
          reconciled.monday_item_id = secondaryItemId || primaryItemId || reconciled.monday_item_id
        }

        if (secondaryItemId && !secondaryActive) {
          reconciled.hazard_reason = 'Design item not found in Monday.'
        } else if (!reconciled.has_monday_record) {
          reconciled.hazard_reason = 'Order was created from a quote but is missing from Monday.'
        } else if (!reconciled.has_quickbooks_record && quickBooksSucceeded) {
          reconciled.hazard_reason = 'Order Track item not found in QuickBooks projects.'
        } else {
          reconciled.hazard_reason = null
        }

        mergedByKey.set(canonicalRow.orderKey, reconciled)
      })

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
        if (quickBooksSucceeded && row.has_quickbooks_record) {
          staleQuickBooksOrderKeysToDelete.add(row.orderKey)
        }
        return
      }
      carryoverCandidates.push(row)
    })

    const designBoardId = normalizeText(mondayPreproductionBoardId, 120)
    const pendingManualPlacementRows = carryoverCandidates.filter((row) => isPendingManualPlacementRow(row, {
      orderTrackBoardId,
      designBoardId,
      shippedBoardId,
    }))
    const pendingManualPlacementOrderKeys = new Set(
      pendingManualPlacementRows
        .map((row) => normalizeText(row?.orderKey, 200))
        .filter(Boolean),
    )
    const pendingDesignStats = await flagPendingManualRowsOnDesignBoard({
      pendingRows: pendingManualPlacementRows,
      warnings,
    })
    const pendingDesignMatchedRowsByItemId =
      pendingDesignStats?.matchedRowsByItemId instanceof Map
        ? pendingDesignStats.matchedRowsByItemId
        : new Map()
    const pendingDesignMatchedOrderKeys = new Set(
      [...pendingDesignMatchedRowsByItemId.values()]
        .map((row) => normalizeText(row?.orderKey, 200))
        .filter(Boolean),
    )

    pendingDesignMatchedRowsByItemId.forEach((row) => {
      const orderKey = normalizeText(row?.orderKey, 200)

      if (!orderKey) {
        return
      }

      mergedByKey.set(orderKey, row)
    })

    const pendingDesignDetailEnrichedCount = await enrichMatchedDesignRows({
      matchedRowsByItemId: pendingDesignMatchedRowsByItemId,
      warnings,
    })

    const quickBooksOnlyCandidates = []
    mergedByKey.forEach((row) => {
      if (row.has_quickbooks_record && !row.has_monday_record && !row.is_shipped) {
        quickBooksOnlyCandidates.push(row)
      }
    })
    const rowsToCheckOnShipped = [
      ...quickBooksOnlyCandidates,
      ...carryoverCandidates.filter(
        (row) => !pendingDesignMatchedOrderKeys.has(normalizeText(row?.orderKey, 200)),
      ),
    ]
    const carryoverOrderKeys = new Set(carryoverCandidates.map((row) => row.orderKey))
    const { lookup: shippedLookup } = await checkShippedBoardForMissing(rowsToCheckOnShipped, warnings)

    let carryoverMarkedShippedCount = 0
    let carryoverHazardCount = 0
    let quickBooksOnlyMarkedShippedCount = 0
    const matchedRowsByItemId = new Map()
    const movedToShippedOutsideWebsiteRows = []

    rowsToCheckOnShipped.forEach((row) => {
      const match = shippedLookup ? findNameLookupMatch(row, shippedLookup) : null

      if (match) {
        const matchedItemId = normalizeText(match?.id, 120)
        const existingShipped = existingShippedByOrderKey.get(normalizeText(row.orderKey, 200))
        const isCarryoverCandidate = carryoverOrderKeys.has(row.orderKey)

        row.is_shipped = true
        row.Monday_status = 'Shipped'
        row.shipped_at = row.shipped_at || existingShipped?.shippedAt || refreshedAt
        row.shipped_at_inferred =
          typeof existingShipped?.shippedAtInferred === 'boolean'
            ? existingShipped.shippedAtInferred
            : true
        row.has_monday_record = true
        row.monday_item_id = row.monday_item_id || matchedItemId
        row.monday_board_id = normalizeText(mondayShippedBoardId, 120) || row.monday_board_id
        row.monday_board_name = row.monday_board_name || 'Shipped Orders'
        row.hazard_reason = null

        if (matchedItemId) {
          matchedRowsByItemId.set(matchedItemId, row)
        }

        if (isCarryoverCandidate && shouldFlagOrderAsMovedToShippedOutsideWebsite(row, orderTrackBoardId)) {
          movedToShippedOutsideWebsiteRows.push(row)
        }

        if (isCarryoverCandidate) {
          carryoverMarkedShippedCount += 1
        } else {
          quickBooksOnlyMarkedShippedCount += 1
        }
      } else if (carryoverOrderKeys.has(row.orderKey)) {
        const rowMondayItemId = normalizeText(row?.monday_item_id, 120)
        const rowMondayBoardId = normalizeText(row?.monday_board_id, 120)
        const wasRemovedFromDesign = Boolean(
          designStats.lookupSucceeded
          && row.in_design
          && rowMondayBoardId === designBoardId
          && rowMondayItemId
          && !designStats.activeItemIds.has(rowMondayItemId)
        )

        if (wasRemovedFromDesign) {
          staleQuickBooksOrderKeysToDelete.add(row.orderKey)
          mergedByKey.delete(row.orderKey)
          return
        }

        if (pendingManualPlacementOrderKeys.has(normalizeText(row?.orderKey, 200))) {
          row.in_design = true
          row.Monday_status = normalizeText(row?.Monday_status, 260) || 'Pending placement'
          row.hazard_reason = 'Pending: created in New Orders and not found yet in Design or Orders.'
          carryoverHazardCount += 1
          mergedByKey.set(row.orderKey, row)
          return
        }

        if (quickBooksSucceeded && row.has_quickbooks_record) {
          staleQuickBooksOrderKeysToDelete.add(row.orderKey)
          mergedByKey.delete(row.orderKey)
        } else {
          row.hazard_reason = 'Missing from Order Track and not found on the Shipped board.'
          carryoverHazardCount += 1
          mergedByKey.set(row.orderKey, row)
        }
        return
      }

      mergedByKey.set(row.orderKey, row)
    })

    const shippedDetailEnrichedCount = await enrichMatchedShippedRows({
      matchedRowsByItemId,
      refreshedAt,
      warnings,
    })

    const mondayMovedToShippedOutsideWebsiteOrders = [...new Map(
      movedToShippedOutsideWebsiteRows
        .map((row) => {
          const dedupeKey =
            normalizeText(row?.orderKey, 200)
            || normalizeText(row?.monday_item_id, 120)
            || normalizeText(row?.order_number, 120)

          if (!dedupeKey) {
            return null
          }

          return [
            dedupeKey,
            {
              orderKey: normalizeText(row?.orderKey, 200) || null,
              orderNumber: normalizeText(row?.order_number, 120) || null,
              orderName: normalizeText(row?.order_name, 260) || null,
              mondayItemId: normalizeText(row?.monday_item_id, 120) || null,
              mondayItemUrl: normalizeText(row?.Monday_url, 500) || null,
              shippedAt: toIsoOrNull(row?.shipped_at) || refreshedAt,
            },
          ]
        })
        .filter(Boolean),
    ).values()].slice(0, 100)
    const mondayMovedToShippedOutsideWebsiteCount = mondayMovedToShippedOutsideWebsiteOrders.length

    if (mondayMovedToShippedOutsideWebsiteCount > 0) {
      warnings.push(
        `${mondayMovedToShippedOutsideWebsiteCount} order(s) were moved from Order Track to Shipped in Monday outside the website shipping workflow.`,
      )
    }

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
      row.ship_to = normalizeText(row.ship_to, 500) || null
      row.ship_notes = normalizeText(row.ship_notes, 2000) || null
      row.bol = normalizeText(row.bol, 200) || null
      row.BOL_cached = normalizeText(row.BOL_cached, 800) || null
      row.BOL_source = normalizeText(row.BOL_source, 800) || null
      if (!row.BOL_cached && !row.BOL_source) {
        row.BOL_source = normalizeText(row.BOL, 800) || null
      }
      row.BOL = row.BOL_cached || row.BOL_source || null
      row.signed_bol = normalizeText(row.signed_bol, 200) || null
      row.Signed_BOL_source = normalizeText(row.Signed_BOL_source, 800) || null
      if (!row.Signed_BOL_source) {
        row.Signed_BOL_source = normalizeText(row.Signed_BOL, 800) || null
      }
      row.Signed_BOL = row.Signed_BOL_source || null
      row.inspection_sheet = normalizeText(row.inspection_sheet, 200) || null
      row.Inspection_sheet_source = normalizeText(row.Inspection_sheet_source, 800) || null
      if (!row.Inspection_sheet_source) {
        row.Inspection_sheet_source = normalizeText(row.Inspection_sheet, 800) || null
      }
      row.Inspection_sheet = row.Inspection_sheet_source || null
      row.Shop_drawing_cached = normalizeText(row.Shop_drawing_cached, 800) || null
      row.Shop_drawing_source = normalizeText(row.Shop_drawing_source, 800) || null
      if (!row.Shop_drawing_cached && !row.Shop_drawing_source) {
        row.Shop_drawing_source = normalizeText(row.Shop_drawing, 800) || null
      }
      row.Shop_drawing = row.Shop_drawing_cached || row.Shop_drawing_source || null
      row.Cut_list_cached = normalizeText(row.Cut_list_cached, 800) || null
      row.Cut_list_source = normalizeText(row.Cut_list_source, 800) || null
      if (!row.Cut_list_cached && !row.Cut_list_source) {
        row.Cut_list_source = normalizeText(row.Cut_list, 800) || null
      }
      row.Cut_list = row.Cut_list_cached || row.Cut_list_source || null
      row.shipped_at = toIsoOrNull(row.shipped_at)
      row.shipped_at_inferred = row.shipped_at
        ? toBooleanOrNull(row.shipped_at_inferred) ?? false
        : null

      // Hazard rules:
      //   - Order Track has it but QB doesn't  → real hazard (must be fixed)
      //   - QB has it but Order Track doesn't, and we found it in design → not a hazard
      //   - QB has it but Order Track doesn't, and design didn't match   → hazard
      //   - Monday Design rows missing from QB receive the same hazard as Orders
      //   - Canonical website orders survive missing external records
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

      row.source = hasMonday && hasQB
        ? 'merged'
        : hasQB
          ? 'quickbooks'
          : row.is_canonical_order
            ? 'website'
            : 'monday'
      row.lastSyncedAt = refreshedAt
      row.updatedAt = refreshedAt
      row.quickbooks_synced_at = quickBooksData?.generatedAt || null

      return row
    })

    const shippedProgressFloorStats = await enforceShippedOrderProgressFloor({
      mergedRows,
      orderProgressCollection,
      refreshedAt,
      warnings,
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
    }

    const staleQuickBooksOrderKeys = [...staleQuickBooksOrderKeysToDelete]
    let staleQuickBooksDeletedCount = 0

    if (staleQuickBooksOrderKeys.length > 0) {
      const deleteResult = await ordersUnifiedCollection.deleteMany({
        orderKey: { $in: staleQuickBooksOrderKeys },
      })
      staleQuickBooksDeletedCount = Number(deleteResult?.deletedCount ?? 0)
    }

    const summary = {
      refreshedAt,
      mergedOrderCount: mergedRows.length,
      orderTrackOrderCount: orderTrackOrders(orderTrackSnapshot).length,
      designBoardCandidateCount: designStats.candidateCount,
      designBoardMatchedCount: designStats.matchedCount,
      designBoardItemCount: designStats.boardItemCount,
      designDetailEnrichedCount,
      pendingDesignCandidateCount: pendingDesignStats.candidateCount,
      pendingDesignMatchedCount: pendingDesignStats.matchedCount,
      pendingDesignDetailEnrichedCount,
      carryoverCheckedCount: carryoverCandidates.length,
      carryoverMarkedShippedCount,
      carryoverHazardCount,
      shippedLookupCandidateCount: rowsToCheckOnShipped.length,
      quickBooksOnlyShippedCheckedCount: quickBooksOnlyCandidates.length,
      quickBooksOnlyMarkedShippedCount,
      shippedDetailEnrichedCount,
      mondayMovedToShippedOutsideWebsiteCount,
      mondayMovedToShippedOutsideWebsiteOrders,
      shippedProgressTrackedOrderCount: shippedProgressFloorStats.shippedProgressTrackedOrderCount,
      shippedProgressUpsertedCount: shippedProgressFloorStats.shippedProgressUpsertedCount,
      shippedProgressCorrectedCount: shippedProgressFloorStats.shippedProgressCorrectedCount,
      quickBooksProjectCount: Array.isArray(quickBooksData?.projects)
        ? quickBooksData.projects.length
        : 0,
      staleQuickBooksDeletedCount,
      quickBooksSyncedAt: quickBooksData?.generatedAt || null,
      warnings,
    }

    // Persist the refresh summary where the Orders page reads "last refreshed"
    // from, so scheduled refreshes update it the same way manual ones do.
    try {
      const { dashboardSnapshotsCollection } = await getCollections()

      await dashboardSnapshotsCollection.updateOne(
        { snapshotKey: 'orders_unified_refresh' },
        {
          $set: {
            snapshotKey: 'orders_unified_refresh',
            snapshot: summary,
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      )
    } catch (error) {
      warnings.push(
        `Refresh summary persistence failed: ${normalizeText(error?.message, 400) || 'unknown error'}`,
      )
    }

    return summary
  }

  function orderTrackOrders(snapshot) {
    return Array.isArray(snapshot?.orders) ? snapshot.orders : []
  }

  async function refreshOrdersUnifiedCollection() {
    if (inFlightRefresh) {
      return inFlightRefresh
    }
    const refreshPromise = runRefresh()
    inFlightRefresh = refreshPromise

    refreshPromise
      .finally(() => {
        if (inFlightRefresh === refreshPromise) {
          inFlightRefresh = null
        }
      })
      .catch(() => {
        // Swallow cleanup-chain rejection; caller receives refreshPromise.
      })

    return refreshPromise
  }

  return { refreshOrdersUnifiedCollection }
}
