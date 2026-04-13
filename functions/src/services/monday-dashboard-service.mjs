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
