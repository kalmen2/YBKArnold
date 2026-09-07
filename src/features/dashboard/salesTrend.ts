export type SalesTrendDay = {
  date: string
  total: number
  count: number
}

export type SalesTrendSnapshot = {
  generatedAt: string
  earliestDate: string | null
  /** Orders that cannot be placed on the timeline because they have no order date. */
  ordersMissingOrderDate?: number
  days: SalesTrendDay[]
}

export type SalesTrendMode = 'monthOverMonth' | 'monthVsLastYear' | 'yearOverYear'

export type SalesTrendSeries = {
  label: string
  values: (number | null)[]
  total: number
}

export type SalesTrendView = {
  mode: SalesTrendMode
  categories: string[]
  activePeriod: SalesTrendSeries
  comparisonPeriod: SalesTrendSeries
  /** Comparison total through the same point in its period, for a like-for-like read. */
  comparisonPaceTotal: number
  percentChange: number | null
  hasComparisonData: boolean
  /** Reads as "+12.3% vs. {comparisonNoun}". */
  comparisonNoun: string
  currentPeriodNote: string
  comparisonPeriodNote: string
}

export const SALES_TREND_MODE_OPTIONS: { value: SalesTrendMode, label: string }[] = [
  { value: 'monthOverMonth', label: 'Month over month' },
  { value: 'monthVsLastYear', label: 'Month vs. last year' },
  { value: 'yearOverYear', label: 'Year over year' },
]

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function dayKey(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function sumRange(totalsByDate: Map<string, number>, startKey: string, endKey: string): number {
  let total = 0

  totalsByDate.forEach((value, date) => {
    if (date >= startKey && date <= endKey) {
      total += value
    }
  })

  return roundMoney(total)
}

/**
 * Cumulative daily totals across one calendar month, padded to `categoryCount`
 * so both series in a comparison share an x-axis. Days past `cutoffKey` come
 * back as null so the line simply stops instead of flat-lining.
 */
function buildDailyCumulative(
  totalsByDate: Map<string, number>,
  year: number,
  monthIndex: number,
  cutoffKey: string,
  categoryCount: number,
): (number | null)[] {
  const monthLength = daysInMonth(year, monthIndex)
  const values: (number | null)[] = []
  let running = 0

  for (let day = 1; day <= categoryCount; day += 1) {
    if (day > monthLength) {
      values.push(null)
      continue
    }

    const key = dayKey(year, monthIndex, day)

    if (key > cutoffKey) {
      values.push(null)
      continue
    }

    running += totalsByDate.get(key) ?? 0
    values.push(roundMoney(running))
  }

  return values
}

/** Cumulative month-end totals across one calendar year, cut off at `cutoffKey`. */
function buildMonthlyCumulative(
  totalsByDate: Map<string, number>,
  year: number,
  cutoffKey: string,
): (number | null)[] {
  const values: (number | null)[] = []
  let running = 0

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthStart = dayKey(year, monthIndex, 1)

    if (monthStart > cutoffKey) {
      values.push(null)
      continue
    }

    const monthEnd = dayKey(year, monthIndex, daysInMonth(year, monthIndex))
    running += sumRange(totalsByDate, monthStart, monthEnd < cutoffKey ? monthEnd : cutoffKey)
    values.push(roundMoney(running))
  }

  return values
}

function toTotalsByDate(snapshot: SalesTrendSnapshot | undefined): Map<string, number> {
  const totalsByDate = new Map<string, number>()

  snapshot?.days?.forEach((day) => {
    if (typeof day?.date === 'string' && Number.isFinite(day?.total)) {
      totalsByDate.set(day.date, day.total)
    }
  })

  return totalsByDate
}

function hasAnyOrdersInRange(
  snapshot: SalesTrendSnapshot | undefined,
  startKey: string,
  endKey: string,
): boolean {
  return Boolean(
    snapshot?.days?.some((day) => day.date >= startKey && day.date <= endKey && day.count > 0),
  )
}

function percentChangeOf(current: number, baseline: number): number | null {
  if (baseline <= 0) {
    return null
  }

  return ((current - baseline) / baseline) * 100
}

/**
 * Turns the raw daily buckets into two cumulative series for the selected
 * comparison. The headline percentage is pace-matched — a partial month is
 * compared against the prior period through the same day, never against its
 * finished total.
 */
export function buildSalesTrendView(
  snapshot: SalesTrendSnapshot | undefined,
  mode: SalesTrendMode,
  today: Date = new Date(),
): SalesTrendView {
  const totalsByDate = toTotalsByDate(snapshot)
  const year = today.getFullYear()
  const monthIndex = today.getMonth()
  const dayOfMonth = today.getDate()
  const todayKey = dayKey(year, monthIndex, dayOfMonth)

  if (mode === 'yearOverYear') {
    const comparisonYear = year - 1
    const comparisonStart = dayKey(comparisonYear, 0, 1)
    const comparisonEnd = dayKey(comparisonYear, 11, 31)
    const comparisonPaceEnd = dayKey(
      comparisonYear,
      monthIndex,
      Math.min(dayOfMonth, daysInMonth(comparisonYear, monthIndex)),
    )

    const currentTotal = sumRange(totalsByDate, dayKey(year, 0, 1), todayKey)
    const comparisonTotal = sumRange(totalsByDate, comparisonStart, comparisonEnd)
    const comparisonPaceTotal = sumRange(totalsByDate, comparisonStart, comparisonPaceEnd)

    return {
      mode,
      categories: MONTH_LABELS,
      activePeriod: {
        label: String(year),
        values: buildMonthlyCumulative(totalsByDate, year, todayKey),
        total: currentTotal,
      },
      comparisonPeriod: {
        label: String(comparisonYear),
        values: buildMonthlyCumulative(totalsByDate, comparisonYear, comparisonEnd),
        total: comparisonTotal,
      },
      comparisonPaceTotal,
      percentChange: percentChangeOf(currentTotal, comparisonPaceTotal),
      hasComparisonData: hasAnyOrdersInRange(snapshot, comparisonStart, comparisonEnd),
      comparisonNoun: 'the same point last year',
      currentPeriodNote: 'year to date',
      comparisonPeriodNote: 'full year',
    }
  }

  // Month over month steps back one month (rolling into last December each
  // January); month vs. last year holds the month and steps back a year.
  const steppingBackAMonth = mode === 'monthOverMonth'
  const comparisonMonthIndex = steppingBackAMonth ? (monthIndex + 11) % 12 : monthIndex
  const comparisonYear = steppingBackAMonth
    ? (monthIndex === 0 ? year - 1 : year)
    : year - 1

  const currentMonthLength = daysInMonth(year, monthIndex)
  const comparisonMonthLength = daysInMonth(comparisonYear, comparisonMonthIndex)
  const categoryCount = Math.max(currentMonthLength, comparisonMonthLength)

  const currentStart = dayKey(year, monthIndex, 1)
  const comparisonStart = dayKey(comparisonYear, comparisonMonthIndex, 1)
  const comparisonEnd = dayKey(comparisonYear, comparisonMonthIndex, comparisonMonthLength)
  const comparisonPaceEnd = dayKey(
    comparisonYear,
    comparisonMonthIndex,
    Math.min(dayOfMonth, comparisonMonthLength),
  )

  const currentTotal = sumRange(totalsByDate, currentStart, todayKey)
  const comparisonTotal = sumRange(totalsByDate, comparisonStart, comparisonEnd)
  const comparisonPaceTotal = sumRange(totalsByDate, comparisonStart, comparisonPaceEnd)

  return {
    mode,
    categories: Array.from({ length: categoryCount }, (_, index) => String(index + 1)),
    activePeriod: {
      label: `${MONTH_LABELS[monthIndex]} ${year}`,
      values: buildDailyCumulative(totalsByDate, year, monthIndex, todayKey, categoryCount),
      total: currentTotal,
    },
    comparisonPeriod: {
      label: `${MONTH_LABELS[comparisonMonthIndex]} ${comparisonYear}`,
      values: buildDailyCumulative(
        totalsByDate,
        comparisonYear,
        comparisonMonthIndex,
        comparisonEnd,
        categoryCount,
      ),
      total: comparisonTotal,
    },
    comparisonPaceTotal,
    percentChange: percentChangeOf(currentTotal, comparisonPaceTotal),
    hasComparisonData: hasAnyOrdersInRange(snapshot, comparisonStart, comparisonEnd),
    comparisonNoun: mode === 'monthOverMonth'
      ? 'the same point last month'
      : 'the same point last year',
    currentPeriodNote: 'month to date',
    comparisonPeriodNote: 'full month',
  }
}
