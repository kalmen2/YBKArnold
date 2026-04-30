export function createMondayDashboardService({
  mondayBoardUrl,
  mondayProgressStatusConfig = [],
  normalizeLookupValue,
}) {
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
    const readyColumnId = pickColumnId(columns, ['ready'], ['status', 'color'])
    const shipDateColumnId = pickColumnId(
      columns,
      ['ship date', 'date shipped', 'shipped'],
      ['date', 'timeline'],
    )
    const leadTimeColumnId = pickColumnId(
      columns,
      ['lead time', 'leadtime', 'lead', 'production time'],
      ['numbers', 'numeric', 'text', 'long-text'],
      ['date', 'timeline'],
    )
    const dueDateColumnId = pickColumnId(
      columns,
      ['ready by', 'need by', 'due', 'ship', 'delivery', 'target', 'eta', 'lead time'],
      ['date', 'timeline'],
    )
    const shopDrawingColumnId = pickColumnId(
      columns,
      ['shop drawing', 'shop drawings', 'drawing', 'drawings'],
      ['file', 'link', 'text', 'long-text'],
    )
    const invoiceNumberColumnId = pickColumnId(
      columns,
      ['invoice #', 'invoice number', 'invoice no', 'invoice'],
      ['numbers', 'numeric', 'text', 'long-text'],
    )
    const paidInFullColumnId = pickColumnId(
      columns,
      ['paid in full', 'payment status', 'paid status', 'paid'],
      ['status', 'color', 'text', 'long-text', 'numbers', 'numeric'],
    )
    const amountOwedColumnId = pickColumnId(
      columns,
      [
        'amount owed',
        'amount due',
        'balance due',
        'remaining balance',
        'unpaid balance',
        'open balance',
      ],
      ['numbers', 'numeric', 'text', 'long-text', 'formula'],
    )
    const poAmountColumnId = pickColumnId(
      columns,
      [
        'po amount',
        'purchase order amount',
        'po total',
        'purchase order total',
      ],
      ['numbers', 'numeric', 'text', 'long-text', 'formula'],
    )
    let orderDateColumnId = pickColumnId(
      columns,
      ['order date', 'ordered', 'po date', 'received', 'start'],
      ['date', 'timeline'],
    )

    if (orderDateColumnId && orderDateColumnId === dueDateColumnId) {
      orderDateColumnId = null
    }

    const progressStatusColumns = mondayProgressStatusConfig
      .map((config) => ({
        key: config.key,
        weight: config.weight,
        columnId: pickColumnId(columns, config.titleKeywords, ['status', 'color']),
      }))
      .filter((entry) => Boolean(entry.columnId) && entry.weight >= 0)

    return {
      statusColumnId,
      readyColumnId,
      shipDateColumnId,
      leadTimeColumnId,
      dueDateColumnId,
      shopDrawingColumnId,
      invoiceNumberColumnId,
      paidInFullColumnId,
      amountOwedColumnId,
      poAmountColumnId,
      orderDateColumnId,
      progressStatusColumns,
    }
  }

  function pickColumnId(columns, keywords, preferredTypes = [], disallowedTypes = []) {
    let bestId = null
    let bestScore = 0

    columns.forEach((column) => {
      if (disallowedTypes.includes(column.type)) {
        return
      }

      const haystack = normalizeLookupValue(`${column.title} ${column.id}`)
      let score = 0

      keywords.forEach((keyword) => {
        const normalizedKeyword = normalizeLookupValue(keyword)

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

  function normalizeMondayOrder(item, columnMap) {
    const columnValues = Array.isArray(item?.column_values) ? item.column_values : []
    const statusColumn =
      findColumnById(columnValues, columnMap.statusColumnId) ||
      findColumnByKeywords(columnValues, ['design', 'stage'])
    const readyColumn =
      findColumnById(columnValues, columnMap.readyColumnId) ||
      findColumnByKeywords(columnValues, ['ready'])
    const shipDateColumn =
      findColumnById(columnValues, columnMap.shipDateColumnId) ||
      findColumnByKeywords(columnValues, ['ship date', 'shipped'])
    const leadTimeColumn =
      findColumnById(columnValues, columnMap.leadTimeColumnId) ||
      findColumnByKeywords(columnValues, ['lead'])
    const dueDateColumn =
      findColumnById(columnValues, columnMap.dueDateColumnId) ||
      findColumnByKeywords(columnValues, ['due', 'ready', 'ship'])
    const shopDrawingColumn =
      findColumnById(columnValues, columnMap.shopDrawingColumnId) ||
      findColumnByKeywords(columnValues, ['shop drawing', 'drawing'])
    const invoiceNumberColumn =
      findColumnById(columnValues, columnMap.invoiceNumberColumnId) ||
      findColumnByKeywords(columnValues, ['invoice #', 'invoice number', 'invoice no', 'invoice'])
    const paidInFullColumn =
      findColumnById(columnValues, columnMap.paidInFullColumnId) ||
      findColumnByKeywords(columnValues, ['paid in full', 'payment status', 'paid status', 'paid'])
    const amountOwedColumn =
      findColumnById(columnValues, columnMap.amountOwedColumnId) ||
      findColumnByKeywords(
        columnValues,
        ['amount owed', 'amount due', 'balance due', 'remaining balance', 'unpaid balance'],
      )
    const poAmountColumn =
      findColumnById(columnValues, columnMap.poAmountColumnId) ||
      findColumnByKeywords(
        columnValues,
        ['po amount', 'purchase order amount', 'po total', 'purchase order total'],
      )
    const orderDateColumn =
      findColumnById(columnValues, columnMap.orderDateColumnId) ||
      findColumnByKeywords(columnValues, ['order date', 'ordered'])

    const stageLabel = readTextFromColumn(statusColumn) || 'Unspecified'
    const readyLabel = readTextFromColumn(readyColumn)
    const leadTimeDays = parseLeadTimeDays(
      readTextFromColumn(leadTimeColumn),
      leadTimeColumn?.value,
    )
    const shippedAt = parseDateFromColumn(shipDateColumn)
    const directDueDate = parseDateFromColumn(dueDateColumn)
    const orderDate = parseDateFromColumn(orderDateColumn) || parseDateValue(item?.created_at)
    const computedDueDate =
      orderDate && Number.isFinite(leadTimeDays)
        ? addDaysToIsoDate(orderDate, Number(leadTimeDays))
        : null
    const effectiveDueDate = directDueDate || computedDueDate
    const daysUntilDue = effectiveDueDate
      ? differenceInDaysFromToday(effectiveDueDate)
      : null
    const progressPercent = calculateProgressPercent(
      columnValues,
      columnMap.progressStatusColumns,
    )
    const isReady = isCompletedStatus(readyLabel)
    const isDone = Boolean(shippedAt)
    const statusLabel = buildWorkflowStatusLabel({
      isDone,
      isReady,
      progressPercent,
      stageLabel,
    })
    const shopDrawing = parseShopDrawing(shopDrawingColumn)
    const invoiceNumber = parseInvoiceNumber(invoiceNumberColumn)
    const amountOwed = parseCurrencyAmountFromColumn(amountOwedColumn)
    const poAmount = parseCurrencyAmountFromColumn(poAmountColumn)
    const paidInFull = parsePaidInFullStatus(paidInFullColumn, amountOwed)
    const isLate = !isDone && typeof daysUntilDue === 'number' ? daysUntilDue < 0 : false
    const daysLate = isLate && typeof daysUntilDue === 'number' ? Math.abs(daysUntilDue) : 0

    return {
      id: String(item?.id ?? ''),
      name: String(item?.name ?? 'Untitled order'),
      groupTitle: String(item?.group?.title ?? 'Ungrouped'),
      statusLabel,
      stageLabel,
      readyLabel,
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
      itemUrl: buildMondayItemUrl(item?.id),
      shopDrawingUrl: shopDrawing.url,
      shopDrawingFileName: shopDrawing.fileName,
      invoiceNumber,
      paidInFull,
      amountOwed,
      poAmount,
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

  function buildWorkflowStatusLabel({ isDone, isReady, progressPercent, stageLabel }) {
    if (isDone) {
      return 'Shipped'
    }

    if (isReady) {
      return 'Ready / Not Shipped'
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

  function parseInvoiceNumber(columnValue) {
    const value = String(readTextFromColumn(columnValue) ?? '').trim()

    if (!value || value === '-' || /^n\/a$/i.test(value) || /^none$/i.test(value)) {
      return null
    }

    if (/^no invoice$/i.test(value)) {
      return null
    }

    return value
  }

  function parsePaidInFullStatus(columnValue, amountOwed) {
    if (Number.isFinite(amountOwed)) {
      if (Number(amountOwed) > 0) {
        return false
      }

      if (Number(amountOwed) === 0) {
        return true
      }
    }

    const normalizedValue = normalizeLookupValue(readTextFromColumn(columnValue))

    if (!normalizedValue) {
      return null
    }

    const indicatesNotPaid = [
      'not paid',
      'unpaid',
      'partial',
      'partially',
      'balance',
      'owed',
      'remaining',
      'open',
      'due',
    ].some((keyword) => normalizedValue.includes(keyword))

    if (indicatesNotPaid) {
      return false
    }

    const indicatesPaid = [
      'paid in full',
      'paid',
      'settled',
      'complete',
      'completed',
      'closed',
      'yes',
    ].some((keyword) => normalizedValue.includes(keyword))

    if (indicatesPaid) {
      return true
    }

    return null
  }

  function parseCurrencyAmountFromColumn(columnValue) {
    if (!columnValue) {
      return null
    }

    const textAmount = parseNumberishValue(columnValue.text)

    if (textAmount !== null) {
      return textAmount
    }

    const parsedValue = parseJsonValue(columnValue.value)

    if (!parsedValue || typeof parsedValue !== 'object') {
      return null
    }

    return parseAmountFromUnknown(parsedValue)
  }

  function parseAmountFromUnknown(value, depth = 0, hasAmountHint = false) {
    if (depth > 8 || value == null) {
      return null
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value === 'string') {
      return hasAmountHint ? parseNumberishValue(value) : null
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = parseAmountFromUnknown(entry, depth + 1, hasAmountHint)

        if (parsed !== null) {
          return parsed
        }
      }

      return null
    }

    if (typeof value !== 'object') {
      return null
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = normalizeLookupValue(key)
      const nestedHasAmountHint = hasAmountHint
        || [
          'number',
          'value',
          'amount',
          'balance',
          'total',
          'price',
          'owed',
          'remaining',
          'due',
        ].some((keyword) => normalizedKey.includes(keyword))

      const parsed = parseAmountFromUnknown(nestedValue, depth + 1, nestedHasAmountHint)

      if (parsed !== null) {
        return parsed
      }
    }

    return null
  }

  function parseNumberishValue(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    if (typeof value !== 'string') {
      return null
    }

    const trimmed = value.trim()

    if (!trimmed) {
      return null
    }

    const normalized = trimmed
      .replace(/[$,]/g, '')
      .replace(/\s+/g, ' ')
    const wrappedNegative = /^\((.+)\)$/.test(normalized)
    const candidate = wrappedNegative
      ? `-${normalized.replace(/^\((.+)\)$/, '$1')}`
      : normalized
    const numberMatch = candidate.match(/-?\d+(\.\d+)?/)

    if (!numberMatch) {
      return null
    }

    const parsed = Number(numberMatch[0])

    return Number.isFinite(parsed) ? parsed : null
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
      'paid in full',
    ].some((keyword) => normalized.includes(keyword))
  }

  function buildMondayItemUrl(itemId) {
    if (!mondayBoardUrl || !itemId) {
      return null
    }

    return `${mondayBoardUrl.replace(/\/+$/, '')}/pulses/${String(itemId)}`
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
