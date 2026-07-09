import { buildDetectedColumnsForBoard } from '../orders/monday-board-map.mjs'

export function createMondayDashboardService({
  columnOverrides = {},
  mondayBoardUrl,
  normalizeLookupValue,
}) {
  // Columns resolve exclusively from the exact IDs in monday-board-map.mjs.
  // An unmapped board fails loudly instead of guessing from column titles:
  // update the map when boards change.
  function detectMondayColumns(_items, boardId = null) {
    const mappedColumns = buildDetectedColumnsForBoard(boardId, columnOverrides)

    if (mappedColumns) {
      return mappedColumns
    }

    throw {
      status: 500,
      message: `Monday board ${boardId || '(unknown)'} is not in monday-board-map.mjs. Add its columns to the map to sync it.`,
    }
  }

  function normalizeMondayOrder(item, columnMap, options = {}) {
    const columnValues = Array.isArray(item?.column_values) ? item.column_values : []
    const statusColumn =
      findColumnById(columnValues, columnMap.statusColumnId)
    const shipDateColumn =
      findColumnById(columnValues, columnMap.shipDateColumnId)
    const leadTimeColumn =
      findColumnById(columnValues, columnMap.leadTimeColumnId)
    const dueDateColumn =
      findColumnById(columnValues, columnMap.dueDateColumnId)
    const shopDrawingColumn =
      findColumnById(columnValues, columnMap.shopDrawingColumnId)
    const cutListColumn =
      findColumnById(columnValues, columnMap.cutListColumnId)
    const shipToColumn =
      findColumnById(columnValues, columnMap.shipToColumnId)
    const shipNotesColumn =
      findColumnById(columnValues, columnMap.shipNotesColumnId)
    const bolColumn =
      findColumnById(columnValues, columnMap.bolColumnId)
    const signedBolColumn =
      findColumnById(columnValues, columnMap.signedBolColumnId)
    const inspectionSheetColumn =
      findColumnById(columnValues, columnMap.inspectionSheetColumnId)
    const poNumberColumn =
      findColumnById(columnValues, columnMap.poNumberColumnId)
    const notesColumn =
      findColumnById(columnValues, columnMap.notesColumnId)
    const descriptionColumn =
      findColumnById(columnValues, columnMap.descriptionColumnId)
    const orderDateColumn =
      findColumnById(columnValues, columnMap.orderDateColumnId)
    const progressColumn =
      findColumnById(columnValues, columnMap.progressColumnId)
    const acknowledgmentColumn = findColumnById(columnValues, columnMap.ackColumnId)

    const stageLabel = readTextFromColumn(statusColumn) || 'Unspecified'
    const rawLeadTimeDays = parseLeadTimeDays(
      readTextFromColumn(leadTimeColumn),
      leadTimeColumn?.value,
    )
    const shippedAt = parseDateFromColumn(shipDateColumn)
    const rawDueDate = parseDateFromColumn(dueDateColumn)
    const orderDate = parseDateFromColumn(orderDateColumn) || parseDateValue(item?.created_at)
    const progressPercentFromColumn = parseProgressPercent(progressColumn)
    const progressPercent =
      progressPercentFromColumn !== null
        ? progressPercentFromColumn
        : calculateProgressPercent(columnValues, columnMap.progressStatusColumns)
    const progressStatusDetails = buildProgressStatusDetails(
      columnValues,
      columnMap.progressStatusColumns,
    )
    const readyLabel = String(
      progressStatusDetails.find((entry) => entry.key === 'ready')?.status ?? '',
    ).trim() || null
    const isDone = Boolean(shippedAt)
    const isProductionStarted = resolveProductionStartedFromProgressDetails(progressStatusDetails)
    const scheduleEligible = isDone || isProductionStarted
    const leadTimeDays = scheduleEligible ? rawLeadTimeDays : null
    const directDueDate = scheduleEligible ? rawDueDate : null
    const computedDueDate = null
    const effectiveDueDate = directDueDate || computedDueDate
    const daysUntilDue = effectiveDueDate
      ? differenceInDaysFromToday(effectiveDueDate)
      : null
    const statusLabel = buildWorkflowStatusLabel({ isDone, progressPercent, stageLabel })
    const shopDrawing = parseShopDrawing(shopDrawingColumn)
    const cutList = parseShopDrawing(cutListColumn)
    const shipTo = readTextFromColumn(shipToColumn) || null
    const shipNotes = readTextFromColumn(shipNotesColumn) || null
    const bolDocument = parseShopDrawing(bolColumn)
    const signedBolDocument = parseShopDrawing(signedBolColumn)
    const inspectionSheetDocument = parseShopDrawing(inspectionSheetColumn)
    const bol = readTextFromColumn(bolColumn) || null
    const signedBol = readTextFromColumn(signedBolColumn) || null
    const inspectionSheet = readTextFromColumn(inspectionSheetColumn) || null
    const poNumber = readTextFromColumn(poNumberColumn) || null
    const notes = readTextFromColumn(notesColumn) || null
    const description = readTextFromColumn(descriptionColumn) || null
    const jobNumber = String(acknowledgmentColumn?.text ?? '').trim() || null
    const isLate = !isDone && typeof daysUntilDue === 'number' ? daysUntilDue < 0 : false
    const daysLate = isLate && typeof daysUntilDue === 'number' ? Math.abs(daysUntilDue) : 0

    return {
      id: String(item?.id ?? ''),
      name: String(item?.name ?? 'Untitled order'),
      jobNumber,
      groupTitle: String(item?.group?.title ?? 'Ungrouped'),
      statusLabel,
      stageLabel,
      readyLabel,
      leadTimeDays,
      progressPercent,
      progressStatusDetails,
      orderDate,
      shippedAt,
      dueDate: directDueDate,
      computedDueDate,
      effectiveDueDate,
      daysUntilDue,
      isDone,
      isProductionStarted,
      isLate,
      daysLate,
      updatedAt: parseDateValue(item?.updated_at),
      itemUrl: buildMondayItemUrl(item?.id, options?.boardUrl),
      shipTo,
      shipNotes,
      bol,
      bolUrl: bolDocument.url,
      bolFileName: bolDocument.fileName,
      signedBol,
      signedBolUrl: signedBolDocument.url,
      signedBolFileName: signedBolDocument.fileName,
      inspectionSheet,
      inspectionSheetUrl: inspectionSheetDocument.url,
      inspectionSheetFileName: inspectionSheetDocument.fileName,
      poNumber,
      notes,
      description,
      shopDrawingUrl: shopDrawing.url,
      shopDrawingFileName: shopDrawing.fileName,
      cutListUrl: cutList.url,
      cutListFileName: cutList.fileName,
    }
  }

  function buildProgressStatusDetails(columnValues, progressStatusColumns) {
    const configuredColumns = Array.isArray(progressStatusColumns)
      ? progressStatusColumns
      : []

    return configuredColumns.map((entry) => {
      const value = findColumnById(columnValues, entry?.columnId)
      const status = readTextFromColumn(value)

      return {
        key: String(entry?.key ?? '').trim() || null,
        label: String(entry?.label ?? '').trim() || null,
        weight: Number.isFinite(Number(entry?.weight)) ? Number(entry.weight) : 0,
        columnId: String(entry?.columnId ?? '').trim() || null,
        status: status || null,
      }
    })
  }

  function normalizeProgressStageKey(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim()
  }

  function normalizeProgressStageStatus(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')

    if (!normalized) {
      return null
    }

    if (normalized === 'working on it' || normalized === 'working') {
      return 'working'
    }

    if (normalized === 'done' || normalized === 'ready') {
      return 'done'
    }

    if (normalized === 'stuck' || normalized === 'stock') {
      return 'stuck'
    }

    return null
  }

  function resolveProductionStartedFromProgressDetails(progressStatusDetails) {
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

  function findColumnById(columnValues, columnId) {
    if (!columnId) {
      return null
    }

    return columnValues.find((columnValue) => columnValue?.id === columnId) ?? null
  }

  function parseJsonValue(rawValue) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null
    }

    try {
      return JSON.parse(rawValue)
    } catch {
      return null
    }
  }

  function readTextFromColumn(columnValue) {
    if (!columnValue) {
      return ''
    }

    const textValue = String(columnValue.text ?? '').trim()

    if (textValue) {
      return textValue
    }

    const parsed = parseJsonValue(columnValue.value)

    if (typeof parsed?.label === 'string') {
      return parsed.label
    }

    if (typeof parsed?.text === 'string') {
      return parsed.text
    }

    for (const candidate of [
      parsed?.display_value,
      parsed?.displayValue,
      parsed?.name,
      parsed?.title,
      parsed?.value,
    ]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    for (const key of ['selected_values', 'labels', 'texts', 'values']) {
      const listText = readTextFromStructuredList(parsed?.[key])

      if (listText) {
        return listText
      }
    }

    return ''
  }

  function readTextFromStructuredList(value) {
    if (!Array.isArray(value)) {
      return ''
    }

    const parts = value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim()
        }

        if (!entry || typeof entry !== 'object') {
          return ''
        }

        for (const candidate of [entry?.label, entry?.text, entry?.name, entry?.title, entry?.value]) {
          if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
          }
        }

        return ''
      })
      .filter(Boolean)

    return parts.join(', ')
  }

  function parseShopDrawing(columnValue) {
    if (!columnValue) {
      return {
        url: null,
        fileName: null,
      }
    }

    const parsedValue = parseJsonValue(columnValue.value)
    const urls = [
      ...extractUrlsFromUnknown(columnValue.text),
      ...extractUrlsFromUnknown(parsedValue),
    ]
    const preferredUrl = pickPreferredShopDrawingUrl(urls)
    const explicitFileName = readShopDrawingFileName(parsedValue)
    const derivedFileName = deriveFileNameFromUrl(preferredUrl)

    return {
      url: preferredUrl,
      fileName: normalizeShopDrawingFileName(explicitFileName || derivedFileName),
    }
  }

  function extractUrlsFromUnknown(value, depth = 0) {
    if (depth > 6 || value == null) {
      return []
    }

    if (typeof value === 'string') {
      return extractUrlsFromString(value)
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => extractUrlsFromUnknown(entry, depth + 1))
    }

    if (typeof value === 'object') {
      return Object.values(value).flatMap((entry) =>
        extractUrlsFromUnknown(entry, depth + 1),
      )
    }

    return []
  }

  function extractUrlsFromString(rawValue) {
    const normalizedValue = String(rawValue ?? '').replace(/\\\//g, '/').trim()

    if (!normalizedValue) {
      return []
    }

    const matches = normalizedValue.match(/https?:\/\/[^\s"'<>]+/gi) ?? []

    return matches
      .map((match) => normalizeUrlCandidate(match))
      .filter(Boolean)
  }

  function normalizeUrlCandidate(value) {
    const normalized = String(value ?? '')
      .trim()
      .replace(/\\\//g, '/')
      .replace(/[),.;]+$/g, '')

    if (!normalized) {
      return null
    }

    try {
      const parsedUrl = new URL(normalized)

      if (!/^https?:$/i.test(parsedUrl.protocol)) {
        return null
      }

      return parsedUrl.toString()
    } catch {
      return null
    }
  }

  function pickPreferredShopDrawingUrl(urls) {
    const uniqueUrls = [...new Set(urls.filter(Boolean))]

    if (uniqueUrls.length === 0) {
      return null
    }

    const pdfUrl = uniqueUrls.find((url) => /\.pdf(?:$|[?#])/i.test(url))

    return pdfUrl ?? uniqueUrls[0]
  }

  function readShopDrawingFileName(parsedValue) {
    if (!parsedValue || typeof parsedValue !== 'object') {
      return null
    }

    const fileCandidates = Array.isArray(parsedValue.files) ? parsedValue.files : []

    for (const candidate of fileCandidates) {
      const fileName = normalizeShopDrawingFileName(
        candidate?.name ||
          candidate?.file_name ||
          candidate?.filename ||
          candidate?.title,
      )

      if (fileName) {
        return fileName
      }
    }

    return null
  }

  function deriveFileNameFromUrl(url) {
    if (!url) {
      return null
    }

    try {
      const parsedUrl = new URL(url)
      const segment = parsedUrl.pathname.split('/').pop() ?? ''
      const decoded = decodeURIComponent(segment).trim()

      return decoded || null
    } catch {
      return null
    }
  }

  function normalizeShopDrawingFileName(value) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    const safeValue = normalized.replace(/[\\/:*?"<>|]+/g, '-').trim()

    return safeValue || null
  }

  function parseProgressPercent(columnValue) {
    if (!columnValue) {
      return null
    }

    const text = readTextFromColumn(columnValue)
    const direct = parseProgressFromString(text)

    if (direct !== null) {
      return direct
    }

    const parsed = parseJsonValue(columnValue.value)

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const fromKnownKeys = extractProgressFromKnownShape(parsed)

    if (fromKnownKeys !== null) {
      return fromKnownKeys
    }

    const fromNested = extractProgressFromNestedUnknown(parsed)

    if (fromNested !== null) {
      return fromNested
    }

    return null
  }

  function extractProgressFromKnownShape(parsed) {
    for (const candidate of [
      parsed.percentage,
      parsed.percent,
      parsed.progress,
      parsed.completion,
      parsed.progress_value,
      parsed.done_percentage,
      parsed.number,
      parsed.value,
    ]) {
      const fromCandidate = parseProgressFromNumberishCandidate(candidate)

      if (fromCandidate !== null) {
        return fromCandidate
      }
    }

    const batteryValue = parsed?.battery_value

    if (batteryValue && typeof batteryValue === 'object') {
      for (const candidate of [
        batteryValue.percentage,
        batteryValue.percent,
        batteryValue.progress,
        batteryValue.value,
        batteryValue.number,
      ]) {
        const fromBattery = parseProgressFromNumberishCandidate(candidate)

        if (fromBattery !== null) {
          return fromBattery
        }
      }
    }

    const groupedStatus = parsed?.grouped_statuses

    if (groupedStatus && typeof groupedStatus === 'object') {
      for (const candidate of Object.values(groupedStatus)) {
        const fromGrouped = parseProgressFromNumberishCandidate(candidate)

        if (fromGrouped !== null) {
          return fromGrouped
        }
      }
    }

    return null
  }

  function extractProgressFromNestedUnknown(value, depth = 0, keyHint = '') {
    if (depth > 8 || value == null) {
      return null
    }

    if (typeof value === 'number') {
      if (!isProgressHintKey(keyHint)) {
        return null
      }

      return normalizeProgressNumber(value)
    }

    if (typeof value === 'string') {
      if (!isProgressHintKey(keyHint)) {
        return null
      }

      return parseProgressFromString(value)
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = extractProgressFromNestedUnknown(entry, depth + 1, keyHint)

        if (parsed !== null) {
          return parsed
        }
      }

      return null
    }

    if (typeof value !== 'object') {
      return null
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const parsed = extractProgressFromNestedUnknown(nestedValue, depth + 1, nestedKey)

      if (parsed !== null) {
        return parsed
      }
    }

    return null
  }

  function isProgressHintKey(key) {
    const normalized = normalizeLookupValue(key)

    if (!normalized) {
      return false
    }

    return /(percent|percentage|progress|completion|battery|done)/.test(normalized)
  }

  function parseProgressFromNumberishCandidate(candidate) {
    if (typeof candidate === 'number') {
      return normalizeProgressNumber(candidate)
    }

    return parseProgressFromString(candidate)
  }

  function normalizeProgressNumber(value) {
    if (!Number.isFinite(value)) {
      return null
    }

    if (value < 0 || value > 100) {
      return null
    }

    return Math.round(value)
  }

  function parseProgressFromString(value) {
    if (typeof value !== 'string') {
      return null
    }

    const normalized = value.trim()

    if (!normalized) {
      return null
    }

    const fractionMatch = normalized.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)

    if (fractionMatch?.[1] && fractionMatch?.[2]) {
      const numerator = Number(fractionMatch[1])
      const denominator = Number(fractionMatch[2])

      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
        const ratio = (numerator / denominator) * 100

        if (ratio >= 0 && ratio <= 100) {
          return Math.round(ratio)
        }
      }
    }

    const match = normalized.match(/-?\d+(\.\d+)?/)

    if (!match) {
      return null
    }

    const parsed = Number(match[0])

    if (!Number.isFinite(parsed)) {
      return null
    }

    return normalizeProgressNumber(parsed)
  }

  function calculateProgressPercent(columnValues, progressStatusColumns) {
    const usableColumns = Array.isArray(progressStatusColumns)
      ? progressStatusColumns.filter((column) => Number(column.weight) > 0 && column.columnId)
      : []

    if (usableColumns.length === 0) {
      return null
    }

    const totalWeight = usableColumns.reduce(
      (total, column) => total + Number(column.weight),
      0,
    )

    if (totalWeight <= 0) {
      return null
    }

    let earnedWeight = 0

    usableColumns.forEach((column) => {
      const value = findColumnById(columnValues, column.columnId)
      const label = readTextFromColumn(value)

      if (isCompletedStatus(label)) {
        earnedWeight += Number(column.weight)
      }
    })

    return Math.round((earnedWeight / totalWeight) * 100)
  }

  function isCompletedStatus(statusLabel) {
    const normalized = normalizeLookupValue(statusLabel)

    if (!normalized) {
      return false
    }

    if (normalized.includes('not ready')) {
      return false
    }

    return [
      'completed',
      'complete',
      'closed',
      'delivered',
      'shipped',
      'done',
      'ready',
      'paid in full',
    ].some((keyword) => normalized.includes(keyword))
  }

  function buildWorkflowStatusLabel({ isDone, progressPercent, stageLabel }) {
    if (isDone) {
      return 'Shipped'
    }

    if (typeof progressPercent === 'number') {
      return `In Progress (${progressPercent}%)`
    }

    if (stageLabel && stageLabel !== 'Unspecified') {
      return `In ${stageLabel}`
    }

    return 'Not Started'
  }

  function parseLeadTimeDays(textValue, rawValue) {
    const parsed = parseJsonValue(rawValue)
    const candidates = [
      String(textValue ?? '').trim(),
      typeof parsed?.number === 'number' ? String(parsed.number) : '',
      typeof parsed?.number === 'string' ? parsed.number : '',
      typeof parsed?.text === 'string' ? parsed.text : '',
    ].filter(Boolean)

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase().trim()

      if (/\d{4}-\d{2}-\d{2}/.test(normalized)) {
        continue
      }

      const hasUnit = /(day|week|month|wk|mo)/.test(normalized)
      const isNumericOnly = /^-?\d+(\.\d+)?$/.test(normalized)

      if (!hasUnit && !isNumericOnly) {
        continue
      }

      const match = candidate.match(/-?\d+(\.\d+)?/)

      if (!match) {
        continue
      }

      let days = Number(match[0])

      if (!Number.isFinite(days) || days <= 0) {
        continue
      }

      if (normalized.includes('week')) {
        days *= 7
      } else if (normalized.includes('month')) {
        days *= 30
      }

      if (!hasUnit && days > 365) {
        continue
      }

      if (days > 3650) {
        continue
      }

      return Math.round(days)
    }

    return null
  }

  function parseDateFromColumn(columnValue) {
    if (!columnValue) {
      return null
    }

    const textDate = parseDateValue(columnValue.text)

    if (textDate) {
      return textDate
    }

    const parsed = parseJsonValue(columnValue.value)

    const parsedCandidates = [parsed?.date, parsed?.to, parsed?.from]

    for (const candidate of parsedCandidates) {
      const dateValue = parseDateValue(candidate)

      if (dateValue) {
        return dateValue
      }
    }

    return null
  }

  function parseDateValue(value) {
    const raw = String(value ?? '').trim()

    if (!raw) {
      return null
    }

    const isoDateMatch = raw.match(/\d{4}-\d{2}-\d{2}/)

    if (isoDateMatch) {
      return isoDateMatch[0]
    }

    const parsedDate = new Date(raw)

    if (Number.isNaN(parsedDate.getTime())) {
      return null
    }

    return formatIsoDate(parsedDate)
  }

  function formatIsoDate(value) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
  }

  function addDaysToIsoDate(isoDate, days) {
    const [year, month, day] = isoDate.split('-').map(Number)
    const targetDate = new Date(year, month - 1, day)
    targetDate.setDate(targetDate.getDate() + days)

    return formatIsoDate(targetDate)
  }

  function differenceInDaysFromToday(isoDate) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [year, month, day] = isoDate.split('-').map(Number)
    const compareDate = new Date(year, month - 1, day)
    compareDate.setHours(0, 0, 0, 0)

    return Math.round((compareDate.getTime() - today.getTime()) / 86400000)
  }

  function buildMondayItemUrl(itemId, boardUrlOverride = null) {
    const baseBoardUrl = String(boardUrlOverride ?? mondayBoardUrl ?? '').trim()

    if (!baseBoardUrl || !itemId) {
      return null
    }

    return `${baseBoardUrl.replace(/\/+$/, '')}/pulses/${String(itemId)}`
  }

  function buildBucketCounts(orders, key) {
    const bucketMap = new Map()

    orders.forEach((order) => {
      const value = String(order[key] ?? '').trim() || 'Unspecified'
      bucketMap.set(value, (bucketMap.get(value) ?? 0) + 1)
    })

    return [...bucketMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
  }

  function compareOrdersByUrgency(left, right) {
    const leftRank = left.isLate
      ? 0
      : left.isDone
        ? 3
        : left.effectiveDueDate
          ? 1
          : 2
    const rightRank = right.isLate
      ? 0
      : right.isDone
        ? 3
        : right.effectiveDueDate
          ? 1
          : 2

    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    if (leftRank === 0) {
      return right.daysLate - left.daysLate
    }

    if (leftRank === 1) {
      return Number(left.daysUntilDue ?? 0) - Number(right.daysUntilDue ?? 0)
    }

    return left.name.localeCompare(right.name)
  }

  return {
    buildBucketCounts,
    compareOrdersByUrgency,
    detectMondayColumns,
    normalizeMondayOrder,
  }
}
