import type {
  SyncDailyEntryRowInput,
  TimesheetEntry,
  TimesheetWorker,
} from '../../features/timesheet/api'
import type { BulkWorkerRow } from './utils'

type TimelineEntry = {
  date: string
  totalHours: number
  rowId: string | null
}

function resolvePayrollWeekStart(isoDate: string) {
  const [year, month, day] = String(isoDate ?? '').split('-').map(Number)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !year || !month || !day) {
    return null
  }

  const date = new Date(year, month - 1, day)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  // Payroll week runs Thursday -> Wednesday.
  const dayOfWeek = date.getDay()
  const daysSinceThursday = (dayOfWeek - 4 + 7) % 7
  date.setDate(date.getDate() - daysSinceThursday)

  return date
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildDailySheetSyncRows(
  bulkRows: BulkWorkerRow[],
  workersById: Map<string, TimesheetWorker>,
  entries: TimesheetEntry[],
  targetDate: string,
) {
  const syncRows: Array<SyncDailyEntryRowInput & { sourceRowId: string }> = []
  const invalidWorkerNames = new Set<string>()
  const overtimeByRowId = new Map<string, number>()
  const weekTotalHoursByWorkerId = new Map<string, number>()
  const weekOvertimeHoursByWorkerId = new Map<string, number>()

  const weekStartDate = resolvePayrollWeekStart(targetDate)
  const weekStartIso = weekStartDate ? toIsoDate(weekStartDate) : ''
  const weekEndIso = weekStartDate
    ? toIsoDate(new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 6))
    : ''

  const workerWeekTimeline = new Map<string, TimelineEntry[]>()

  if (weekStartIso && weekEndIso) {
    entries.forEach((entry) => {
      if (!entry?.workerId || !entry?.date) {
        return
      }

      if (entry.date < weekStartIso || entry.date > weekEndIso || entry.date === targetDate) {
        return
      }

      const regularHours = Number(entry.hours)
      const overtimeHours = Number(entry.overtimeHours ?? 0)
      const totalHours = (Number.isFinite(regularHours) ? Math.max(0, regularHours) : 0)
        + (Number.isFinite(overtimeHours) ? Math.max(0, overtimeHours) : 0)

      if (totalHours <= 0) {
        return
      }

      if (!workerWeekTimeline.has(entry.workerId)) {
        workerWeekTimeline.set(entry.workerId, [])
      }

      workerWeekTimeline.get(entry.workerId)?.push({
        date: entry.date,
        totalHours,
        rowId: null,
      })
    })
  }

  bulkRows.forEach((row) => {
    const hasInput =
      row.jobName.trim()
      || row.hours.trim()
      || row.notes.trim()
      || row.stageId.trim()

    if (!hasInput) {
      return
    }

    const jobName = row.jobName.trim()
    const stageId = row.stageId.trim()
    const enteredHours = Number(row.hours)
    const normalizedHours = Number.isFinite(enteredHours) ? enteredHours : NaN

    if (
      !jobName
      || !Number.isFinite(normalizedHours)
      || normalizedHours <= 0
    ) {
      const workerName = workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
      invalidWorkerNames.add(workerName)
      return
    }

    if (!workerWeekTimeline.has(row.workerId)) {
      workerWeekTimeline.set(row.workerId, [])
    }

    workerWeekTimeline.get(row.workerId)?.push({
      date: targetDate,
      totalHours: normalizedHours,
      rowId: row.id,
    })

    syncRows.push({
      sourceRowId: row.id,
      ...(row.entryId
        ? {
            entryId: row.entryId,
          }
        : {}),
      workerId: row.workerId,
      jobName,
      hours: normalizedHours,
      overtimeHours: 0,
      notes: row.notes.trim(),
      ...(stageId
        ? {
            stageId,
          }
        : {}),
    })
  })

  if (weekStartIso && weekEndIso) {
    workerWeekTimeline.forEach((timelineEntries, workerId) => {
      const sortedTimeline = [...timelineEntries].sort((left, right) => left.date.localeCompare(right.date))

      let cumulativeHours = 0
      let workerWeekTotalHours = 0
      let workerWeekOvertimeHours = 0

      sortedTimeline.forEach((timelineEntry) => {
        const regularHours = Math.min(timelineEntry.totalHours, Math.max(0, 40 - cumulativeHours))
        const overtimeHours = Math.max(0, timelineEntry.totalHours - regularHours)

        cumulativeHours += timelineEntry.totalHours
        workerWeekTotalHours += timelineEntry.totalHours
        workerWeekOvertimeHours += overtimeHours

        if (timelineEntry.rowId) {
          overtimeByRowId.set(timelineEntry.rowId, overtimeHours)
        }
      })

      if (workerWeekTotalHours > 0) {
        weekTotalHoursByWorkerId.set(workerId, workerWeekTotalHours)
      }

      if (workerWeekOvertimeHours > 0) {
        weekOvertimeHoursByWorkerId.set(workerId, workerWeekOvertimeHours)
      }
    })
  }

  const syncRowsWithAutoOvertime: SyncDailyEntryRowInput[] = syncRows.map((row) => {
    const overtimeHours = overtimeByRowId.get(row.sourceRowId) ?? 0
    const regularHours = Math.max(0, Number(row.hours) - overtimeHours)

    return {
      ...(row.entryId
        ? {
            entryId: row.entryId,
          }
        : {}),
      workerId: row.workerId,
      ...(row.stageId
        ? {
            stageId: row.stageId,
          }
        : {}),
      jobName: row.jobName,
      hours: regularHours,
      overtimeHours,
      notes: row.notes,
    }
  })

  return {
    invalidWorkers: [...invalidWorkerNames],
    syncRows: syncRowsWithAutoOvertime,
    overtimeByRowId,
    weekTotalHoursByWorkerId,
    weekOvertimeHoursByWorkerId,
    weekStartIso,
    weekEndIso,
  }
}

export function hasEntriesForDate(entries: TimesheetEntry[], date: string) {
  return entries.some((entry) => entry.date === date)
}

export function formatDailySheetSaveMessage(summary: {
  insertedCount: number
  updatedCount: number
  deletedCount: number
}) {
  const statusParts: string[] = []

  if (summary.insertedCount > 0) {
    statusParts.push(`${summary.insertedCount} added`)
  }

  if (summary.updatedCount > 0) {
    statusParts.push(`${summary.updatedCount} updated`)
  }

  if (summary.deletedCount > 0) {
    statusParts.push(`${summary.deletedCount} removed`)
  }

  if (statusParts.length === 0) {
    return 'Daily sheet saved.'
  }

  return `Daily sheet saved: ${statusParts.join(', ')}.`
}
