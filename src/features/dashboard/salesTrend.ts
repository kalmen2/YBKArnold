export type SalesTrendDay = {
  date: string
  total: number
  count: number
  /** Portion of the day's total booked by the previous owner. */
  priorOwnerTotal?: number
}

export type SalesTrendSnapshot = {
  generatedAt: string
  earliestDate: string | null
  latestDate?: string | null
  /** Orders that cannot be placed on the timeline because they have no order date. */
  ordersMissingOrderDate?: number
  days: SalesTrendDay[]
}

/** A month (monthIndex set) or a whole year (monthIndex null). */
export type SalesTrendPeriod = {
  year: number
  monthIndex: number | null
}

export type SalesTrendSelection = {
  primary: SalesTrendPeriod
  comparison: SalesTrendPeriod
}

export type SalesTrendSeries = {
  label: string
  values: (number | null)[]
  total: number
  /** True when the whole period sits before the handover — the previous owner's. */
  isPriorOwner: boolean
  /** True when the period has not finished yet. */
  isInProgress: boolean
}

export type SalesTrendView = {
  granularity: 'month' | 'year'
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

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** The business changed hands on this date. */
export const HANDOVER_DATE_KEY = '2026-03-08'

// The Monday boards before 2024 had no order-value column, so those years hold
// hundreds of orders worth exactly nothing. Offering them would only ever draw
// a flat line at zero, so the comparison starts where the money starts.
export const EARLIEST_COMPARABLE_YEAR = 2024

export type SalesTrendPresetKey =
  | 'thisVsLastMonth'
  | 'thisMonthVsLastYear'
  | 'thisVsLastYear'

export const SALES_TREND_PRESETS: { value: SalesTrendPresetKey, label: string }[] = [
  { value: 'thisVsLastMonth', label: 'This month vs last month' },
  { value: 'thisMonthVsLastYear', label: 'This month vs a year ago' },
  { value: 'thisVsLastYear', label: 'This year vs last year' },
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

export function periodsAreEqual(left: SalesTrendPeriod, right: SalesTrendPeriod): boolean {
  return left.year === right.year && left.monthIndex === right.monthIndex
}

export function formatPeriodLabel(period: SalesTrendPeriod): string {
  return period.monthIndex === null
    ? String(period.year)
    : `${MONTH_LABELS[period.monthIndex]} ${period.year}`
}

/** Resolve a preset into the two periods it selects, relative to `today`. */
export function resolvePreset(preset: SalesTrendPresetKey, today: Date = new Date()): SalesTrendSelection {
  const year = today.getFullYear()
  const monthIndex = today.getMonth()

  if (preset === 'thisVsLastYear') {
    return {
      primary: { year, monthIndex: null },
      comparison: { year: year - 1, monthIndex: null },
    }
  }

  if (preset === 'thisMonthVsLastYear') {
    return {
      primary: { year, monthIndex },
      comparison: { year: year - 1, monthIndex },
    }
  }

  return {
    primary: { year, monthIndex },
    comparison: monthIndex === 0
      ? { year: year - 1, monthIndex: 11 }
      : { year, monthIndex: monthIndex - 1 },
  }
}

/** The preset a selection corresponds to, or null when it is a custom pick. */
export function matchPreset(
  selection: SalesTrendSelection,
  today: Date = new Date(),
): SalesTrendPresetKey | null {
  for (const preset of SALES_TREND_PRESETS) {
    const resolved = resolvePreset(preset.value, today)

    if (
      periodsAreEqual(resolved.primary, selection.primary)
      && periodsAreEqual(resolved.comparison, selection.comparison)
    ) {
      return preset.value
    }
  }

  return null
}

function periodBounds(period: SalesTrendPeriod): { start: string, end: string } {
  if (period.monthIndex === null) {
    return { start: dayKey(period.year, 0, 1), end: dayKey(period.year, 11, 31) }
  }

  return {
    start: dayKey(period.year, period.monthIndex, 1),
    end: dayKey(period.year, period.monthIndex, daysInMonth(period.year, period.monthIndex)),
  }
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

/** Years that can be compared, newest first. Never earlier than 2024. */
export function availableYears(snapshot: SalesTrendSnapshot | undefined, today: Date = new Date()): number[] {
  const thisYear = today.getFullYear()
  const earliestInData = snapshot?.earliestDate
    ? Number(snapshot.earliestDate.slice(0, 4))
    : EARLIEST_COMPARABLE_YEAR
  const from = Math.max(
    EARLIEST_COMPARABLE_YEAR,
    Number.isFinite(earliestInData) ? earliestInData : EARLIEST_COMPARABLE_YEAR,
  )
  const years: number[] = []

  for (let year = thisYear; year >= from; year -= 1) {
    years.push(year)
  }

  return years
}

/**
 * Turns the raw daily buckets into two cumulative series for the chosen pair of
 * periods. Any month or year can be compared against any other.
 *
 * The headline percentage is pace-matched: while the primary period is still
 * running it is compared against the other period through the same point, never
 * against its finished total.
 */
export function buildSalesTrendView(
  snapshot: SalesTrendSnapshot | undefined,
  selection: SalesTrendSelection,
  today: Date = new Date(),
): SalesTrendView {
  const totalsByDate = toTotalsByDate(snapshot)
  const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate())

  const { primary, comparison } = selection
  const granularity: 'month' | 'year' = primary.monthIndex === null ? 'year' : 'month'

  const primaryBounds = periodBounds(primary)
  const comparisonBounds = periodBounds(comparison)

  // A period still running is cut off at today; a finished one runs to its end.
  const primaryCutoff = primaryBounds.end > todayKey ? todayKey : primaryBounds.end
  const comparisonCutoff = comparisonBounds.end > todayKey ? todayKey : comparisonBounds.end
  const primaryInProgress = primaryBounds.end > todayKey && primaryBounds.start <= todayKey

  // How far through the primary period we are, mapped onto the comparison so
  // a part-finished month is never measured against a full one.
  let comparisonPaceEnd = comparisonCutoff

  if (primaryInProgress) {
    if (granularity === 'year') {
      const monthIndex = today.getMonth()
      comparisonPaceEnd = dayKey(
        comparison.year,
        monthIndex,
        Math.min(today.getDate(), daysInMonth(comparison.year, monthIndex)),
      )
    } else if (comparison.monthIndex !== null) {
      comparisonPaceEnd = dayKey(
        comparison.year,
        comparison.monthIndex,
        Math.min(today.getDate(), daysInMonth(comparison.year, comparison.monthIndex)),
      )
    }

    if (comparisonPaceEnd > comparisonCutoff) {
      comparisonPaceEnd = comparisonCutoff
    }
  }

  const primaryTotal = sumRange(totalsByDate, primaryBounds.start, primaryCutoff)
  const comparisonTotal = sumRange(totalsByDate, comparisonBounds.start, comparisonCutoff)
  const comparisonPaceTotal = sumRange(totalsByDate, comparisonBounds.start, comparisonPaceEnd)

  const primarySeries: SalesTrendSeries = {
    label: formatPeriodLabel(primary),
    values: [],
    total: primaryTotal,
    isPriorOwner: primaryBounds.end < HANDOVER_DATE_KEY,
    isInProgress: primaryInProgress,
  }
  const comparisonSeries: SalesTrendSeries = {
    label: formatPeriodLabel(comparison),
    values: [],
    total: comparisonTotal,
    isPriorOwner: comparisonBounds.end < HANDOVER_DATE_KEY,
    isInProgress: comparisonBounds.end > todayKey && comparisonBounds.start <= todayKey,
  }

  let categories: string[]

  if (granularity === 'year') {
    categories = MONTH_LABELS
    primarySeries.values = buildMonthlyCumulative(totalsByDate, primary.year, primaryCutoff)
    comparisonSeries.values = buildMonthlyCumulative(totalsByDate, comparison.year, comparisonCutoff)
  } else {
    const primaryMonthIndex = primary.monthIndex ?? 0
    const comparisonMonthIndex = comparison.monthIndex ?? primaryMonthIndex
    const categoryCount = Math.max(
      daysInMonth(primary.year, primaryMonthIndex),
      daysInMonth(comparison.year, comparisonMonthIndex),
    )

    categories = Array.from({ length: categoryCount }, (_, index) => String(index + 1))
    primarySeries.values = buildDailyCumulative(
      totalsByDate, primary.year, primaryMonthIndex, primaryCutoff, categoryCount,
    )
    comparisonSeries.values = buildDailyCumulative(
      totalsByDate, comparison.year, comparisonMonthIndex, comparisonCutoff, categoryCount,
    )
  }

  const periodNoun = granularity === 'year' ? 'year' : 'month'

  return {
    granularity,
    categories,
    activePeriod: primarySeries,
    comparisonPeriod: comparisonSeries,
    comparisonPaceTotal,
    percentChange: percentChangeOf(primaryTotal, comparisonPaceTotal),
    hasComparisonData: hasAnyOrdersInRange(snapshot, comparisonBounds.start, comparisonBounds.end),
    comparisonNoun: primaryInProgress
      ? `${comparisonSeries.label} at the same point`
      : comparisonSeries.label,
    currentPeriodNote: primaryInProgress ? `${periodNoun} to date` : `full ${periodNoun}`,
    comparisonPeriodNote: comparisonSeries.isInProgress ? `${periodNoun} to date` : `full ${periodNoun}`,
  }
}
