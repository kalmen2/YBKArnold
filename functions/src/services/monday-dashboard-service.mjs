export function createMondayDashboardService({
  columnOverrides = {},
  mondayBoardUrl,
  normalizeLookupValue,
}) {
  const progressStatusConfig = [
    { key: 'design', titleKeywords: ['design'], weight: 13 },
    { key: 'baseForm', titleKeywords: ['base/form', 'base form'], weight: 13 },
    { key: 'build', titleKeywords: ['build'], weight: 13 },
    { key: 'sandOrLam', titleKeywords: ['sand or lam', 'sand', 'lam'], weight: 13 },
    { key: 'sealer', titleKeywords: ['sealer'], weight: 12 },
    { key: 'lacquer', titleKeywords: ['lacquer'], weight: 12 },
    { key: 'ready', titleKeywords: ['ready'], weight: 12 },
    { key: 'invoiced', titleKeywords: ['invoiced'], weight: 12 },
  ]

  function detectMondayColumns(items) {
    const sampleItems = items.slice(0, 50)
    const columns = []
    const seen = new Set()

    sampleItems.forEach((item) => {
      const values = Array.isArray(item?.column_values) ? item.column_values : []

      values.forEach((value) => {
        const id = String(value?.id ?? '')

        if (!id || seen.has(id)) {
          return
        }

        seen.add(id)
        columns.push({
          id,
          title: String(value?.column?.title ?? ''),
          type: String(value?.type ?? ''),
        })
      })
    })

    const statusColumnId = pickColumnId(
      columns,
      ['design', 'stage', 'state'],
      ['status', 'color'],
    )
    const shipDateColumnId =
      normalizeColumnOverrideId(columnOverrides.shipDateColumnId) ||
      pickColumnId(
      columns,
      ['ship date', 'date shipped', 'shipped'],
      ['date', 'timeline'],
      )
    const leadTimeColumnId =
      normalizeColumnOverrideId(columnOverrides.leadTimeColumnId) ||
      pickColumnId(
      columns,
      ['lead time', 'leadtime', 'lead', 'production time'],
      ['numbers', 'numeric', 'text', 'long-text', 'date', 'timeline'],
      )
    const orderDateKeywords = [
      'order date',
      'ordered',
      'po date',
      'purchase order date',
      'received',
      'start',
    ]
    // Business rules for this board:
    // - PO Date is the order start date.
    // - Lead Time is the ready/due date when available.
    const orderDateColumnId =
      normalizeColumnOverrideId(columnOverrides.orderDateColumnId) ||
      pickColumnIdByExactTitle(columns, 'po date') ||
      pickColumnIdByExactTitle(columns, 'purchase order date') ||
      pickColumnId(columns, orderDateKeywords, ['date', 'timeline'])
    let dueDateColumnId =
      normalizeColumnOverrideId(columnOverrides.dueDateColumnId) ||
      pickColumnIdByExactTitle(columns, 'lead time') ||
      pickColumnIdByExactTitle(columns, 'ready by') ||
      pickColumnIdByExactTitle(columns, 'need by') ||
      pickColumnId(
        columns,
        ['lead time', 'leadtime', 'ready by', 'need by', 'due', 'delivery', 'target', 'eta'],
        ['date', 'timeline'],
      )
    const shopDrawingColumnId = pickColumnId(
      columns,
      ['shop drawing', 'shop drawings', 'drawing', 'drawings'],
      ['file', 'link', 'text', 'long-text'],
    )

    if (orderDateColumnId && orderDateColumnId === dueDateColumnId) {
      dueDateColumnId = leadTimeColumnId && leadTimeColumnId !== orderDateColumnId
        ? leadTimeColumnId
        : null
    }

    const progressColumnId = pickColumnId(
      columns,
      ['progress', 'percent complete', 'completion'],
      ['numbers', 'numeric', 'progress', 'formula'],
      ['date', 'timeline'],
    )
    const progressStatusColumns = progressStatusConfig
      .map((config) => ({
        key: config.key,
        weight: config.weight,
        columnId: pickColumnId(columns, config.titleKeywords, ['status', 'color']),
      }))
      .filter((entry) => Boolean(entry.columnId) && entry.weight > 0)
    const ackColumnId = pickColumnIdByExactTitle(columns, 'ack')

    return {
      statusColumnId,
      shipDateColumnId,
      leadTimeColumnId,
      dueDateColumnId,
      shopDrawingColumnId,
      orderDateColumnId,
      progressColumnId,
      progressStatusColumns,
      ackColumnId,
    }
  }

  function pickColumnIdByExactTitle(columns, title) {
    const normalizedTitle = normalizeLookupValue(title)
    const match = columns.find(
      (column) => normalizeLookupValue(column?.title) === normalizedTitle,
    )

    return match ? String(match.id ?? '').trim() || null : null
  }

  function normalizeColumnOverrideId(value) {
    const normalized = String(value ?? '').trim()
    return normalized || null
  }

  function pickColumnId(columns, keywords, preferredTypes = [], disallowedTypes = []) {
    const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
      .map((keyword) => normalizeLookupValue(keyword))
      .filter(Boolean)
    let bestId = null
    let bestScore = 0

    columns.forEach((column) => {
      if (disallowedTypes.includes(column.type)) {
        return
      }

      const haystack = normalizeLookupValue(`${column.title} ${column.id}`)

      let score = 0

      normalizedKeywords.forEach((normalizedKeyword) => {
        if (haystack.includes(normalizedKeyword)) {
          score += normalizedKeyword.length + 3
        }
      })

      if (preferredTypes.includes(column.type)) {
        score += 4
      }

      if (score > bestScore) {
        bestScore = score
        bestId = column.id
      }
    })

    if (bestScore < 6) {
      return null
    }

    return bestId
  }

  function normalizeMondayOrder(item, columnMap, options = {}) {
    const columnValues = Array.isArray(item?.column_values) ? item.column_values : []
    const statusColumn =
      findColumnById(columnValues, columnMap.statusColumnId) ||
      findColumnByKeywords(columnValues, ['design', 'stage'])
    const shipDateColumn =
      findColumnById(columnValues, columnMap.shipDateColumnId) ||
      findColumnByKeywords(columnValues, ['ship date', 'shipped'])
    const leadTimeColumn =
      findColumnById(columnValues, columnMap.leadTimeColumnId) ||
      findColumnByKeywords(columnValues, ['lead'])
    const dueDateColumn =
      findColumnById(columnValues, columnMap.dueDateColumnId) ||
      findColumnByKeywords(columnValues, ['lead time', 'due', 'ready by', 'need by', 'eta'])
    const shopDrawingColumn =
      findColumnById(columnValues, columnMap.shopDrawingColumnId) ||
      findColumnByKeywords(columnValues, ['shop drawing', 'drawing'])
    const orderDateColumn =
      findColumnById(columnValues, columnMap.orderDateColumnId) ||
      findColumnByKeywords(columnValues, ['order date', 'ordered', 'po date', 'purchase order date'])
    const progressColumn =
      findColumnById(columnValues, columnMap.progressColumnId) ||
      findColumnByKeywords(columnValues, ['progress'])
    const acknowledgmentColumn = findColumnById(columnValues, columnMap.ackColumnId)

    const stageLabel = readTextFromColumn(statusColumn) || 'Unspecified'
    const leadTimeDays = parseLeadTimeDays(
      readTextFromColumn(leadTimeColumn),
      leadTimeColumn?.value,
    )
    const shippedAt = parseDateFromColumn(shipDateColumn)
    const leadTimeDate = parseDateFromColumn(leadTimeColumn)
    const directDueDate = parseDateFromColumn(dueDateColumn) || leadTimeDate
    const orderDate = parseDateFromColumn(orderDateColumn) || parseDateValue(item?.created_at)
    const computedDueDate =
      !directDueDate && orderDate && Number.isFinite(leadTimeDays)
        ? addDaysToIsoDate(orderDate, Number(leadTimeDays))
        : null
    const effectiveDueDate = directDueDate || computedDueDate
    const daysUntilDue = effectiveDueDate
      ? differenceInDaysFromToday(effectiveDueDate)
      : null
    const progressPercentFromColumn = parseProgressPercent(progressColumn)
    const progressPercent =
      progressPercentFromColumn !== null
        ? progressPercentFromColumn
        : calculateProgressPercent(columnValues, columnMap.progressStatusColumns)
    const isDone = Boolean(shippedAt)
    const statusLabel = buildWorkflowStatusLabel({ isDone, progressPercent, stageLabel })
    const shopDrawing = parseShopDrawing(shopDrawingColumn)
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
      leadTimeDays,
      progressPercent,
      orderDate,
      shippedAt,
      dueDate: directDueDate,
      computedDueDate,
      effectiveDueDate,
      daysUntilDue,
      isDone,
      isLate,
      daysLate,
      updatedAt: parseDateValue(item?.updated_at),
      itemUrl: buildMondayItemUrl(item?.id, options?.boardUrl),
      shopDrawingUrl: shopDrawing.url,
      shopDrawingFileName: shopDrawing.fileName,
    }
  }

  function findColumnById(columnValues, columnId) {
    if (!columnId) {
      return null
    }

    return columnValues.find((columnValue) => columnValue?.id === columnId) ?? null
  }

  function findColumnByKeywords(columnValues, keywords) {
    const normalizedKeywords = keywords.map((keyword) => normalizeLookupValue(keyword))

    return (
      columnValues.find((columnValue) => {
        const haystack = normalizeLookupValue(
          `${columnValue?.column?.title ?? ''} ${columnValue?.id ?? ''}`,
        )

        return normalizedKeywords.some((keyword) => haystack.includes(keyword))
      }) ?? null
    )
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

    return ''
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
