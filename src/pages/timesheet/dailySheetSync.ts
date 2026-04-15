import type {
  SyncDailyEntryRowInput,
  TimesheetEntry,
  TimesheetWorker,
} from '../../features/timesheet/api'
import type { BulkWorkerRow } from './utils'

export function buildDailySheetSyncRows(
  bulkRows: BulkWorkerRow[],
  workersById: Map<string, TimesheetWorker>,
) {
  const syncRows: SyncDailyEntryRowInput[] = []
  const invalidWorkerNames = new Set<string>()

  bulkRows.forEach((row) => {
    const hasInput = row.jobName.trim() || row.hours.trim() || row.notes.trim() || row.stageId.trim()

    if (!hasInput) {
      return
    }

    const jobName = row.jobName.trim()
    const stageId = row.stageId.trim()
    const hours = Number(row.hours)

    if (!jobName || !Number.isFinite(hours) || hours <= 0) {
      const workerName = workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
      invalidWorkerNames.add(workerName)
      return
    }

    syncRows.push({
      ...(row.entryId
        ? {
            entryId: row.entryId,
          }
        : {}),
      workerId: row.workerId,
      jobName,
      hours,
      notes: row.notes.trim(),
      ...(stageId
        ? {
            stageId,
          }
        : {}),
    })
  })

  return {
    invalidWorkers: [...invalidWorkerNames],
    syncRows,
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
