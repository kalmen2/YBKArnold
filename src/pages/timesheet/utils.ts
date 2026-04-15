import * as XLSX from 'xlsx'
import type {
  TimesheetEntry,
  TimesheetMissingWorkerReview,
  TimesheetStage,
  TimesheetWorker,
} from '../../features/timesheet/api'

export type BulkWorkerRow = {
  id: string
  entryId: string
  workerId: string
  stageId: string
  jobName: string
  hours: string
  notes: string
}

export type MissingWorkerReview = {
  note: string
  approved: boolean
  approvedAt?: string
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatHours(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2)
}

export function compareDateDesc(left: string, right: string) {
  return new Date(right).getTime() - new Date(left).getTime()
}

export function todayIsoDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function addDaysToIsoDate(baseIsoDate: string, days: number) {
  const [year, month, day] = baseIsoDate.split('-').map(Number)
  const value = new Date(year, month - 1, day)
  value.setDate(value.getDate() + days)

  const nextYear = value.getFullYear()
  const nextMonth = String(value.getMonth() + 1).padStart(2, '0')
  const nextDay = String(value.getDate()).padStart(2, '0')

  return `${nextYear}-${nextMonth}-${nextDay}`
}

export function monthKeyFromIsoDate(isoDate: string) {
  const [year = '', month = ''] = String(isoDate ?? '').split('-')

  if (!year || !month) {
    return ''
  }

  return `${year}-${month}`
}

export function formatMonthKeyLabel(monthKey: string) {
  const [year, month] = String(monthKey ?? '').split('-').map(Number)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !year || !month) {
    return monthKey
  }

  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function formatManagerDateLabel(isoDate: string) {
  const [year, month, day] = String(isoDate ?? '').split('-').map(Number)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !year || !month || !day) {
    return isoDate
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function isDateInRange(dateValue: string, startDate?: string, endDate?: string) {
  if (startDate && dateValue < startDate) {
    return false
  }

  if (endDate && dateValue > endDate) {
    return false
  }

  return true
}

export function fileNamePart(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'report'
}

export function normalizeJobName(value: string) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function extractDigits(value: string) {
  const digits = String(value ?? '').replace(/\D+/g, '').trim()

  return digits || null
}

export function exportRowsToXlsx(
  fileBaseName: string,
  rows: Array<Record<string, string | number>>,
) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  XLSX.writeFile(book, `${fileBaseName}.xlsx`)
}

export function exportRowsToCsv(
  fileBaseName: string,
  rows: Array<Record<string, string | number>>,
) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(sheet)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `${fileBaseName}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function getEntryRate(entry: TimesheetEntry, workersById: Map<string, TimesheetWorker>) {
  const snapshotRate = Number(entry.payRate)

  if (Number.isFinite(snapshotRate) && snapshotRate > 0) {
    return snapshotRate
  }

  return workersById.get(entry.workerId)?.hourlyRate ?? 0
}

export function buildExportRows(
  entries: TimesheetEntry[],
  workersById: Map<string, TimesheetWorker>,
  stagesById: Map<string, TimesheetStage>,
) {
  return entries.map((entry) => {
    const worker = workersById.get(entry.workerId)
    const stageName = entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : 'Unassigned'
    const rate = getEntryRate(entry, workersById)

    return {
      Date: entry.date,
      Worker: worker?.fullName ?? 'Unknown worker',
      Stage: stageName,
      Job: entry.jobName,
      Hours: Number(formatHours(entry.hours)),
      Rate: Number(rate.toFixed(2)),
      Cost: Number((entry.hours * rate).toFixed(2)),
      Notes: entry.notes,
    }
  })
}

export function buildByJobExportRows(
  dates: string[],
  rows: Array<{
    jobName: string
    perDate: Record<string, number>
    totalHours: number
    totalCost: number
  }>,
) {
  return rows.map((row) => {
    const exportRow: Record<string, string | number> = {
      Job: row.jobName,
    }

    dates.forEach((date) => {
      exportRow[date] = Number((row.perDate[date] ?? 0).toFixed(2))
    })

    exportRow['Total Hours'] = Number(row.totalHours.toFixed(2))
    exportRow['Total Cost'] = Number(row.totalCost.toFixed(2))

    return exportRow
  })
}

export function buildByStageExportRows(
  dates: string[],
  rows: Array<{
    stageName: string
    perDate: Record<string, number>
    totalHours: number
    totalCost: number
  }>,
) {
  return rows.map((row) => {
    const exportRow: Record<string, string | number> = {
      Stage: row.stageName,
    }

    dates.forEach((date) => {
      exportRow[date] = Number((row.perDate[date] ?? 0).toFixed(2))
    })

    exportRow['Total Hours'] = Number(row.totalHours.toFixed(2))
    exportRow['Total Cost'] = Number(row.totalCost.toFixed(2))

    return exportRow
  })
}

function createBulkRowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createEmptyBulkRowForWorker(workerId: string, stageId = ''): BulkWorkerRow {
  return {
    id: createBulkRowId(),
    entryId: '',
    workerId,
    stageId,
    jobName: '',
    hours: '',
    notes: '',
  }
}

export function buildBulkRowsForDate(
  date: string,
  workers: TimesheetWorker[],
  entries: TimesheetEntry[],
) {
  const entriesByWorker = new Map<string, TimesheetEntry[]>()

  entries.forEach((entry) => {
    if (entry.date !== date) {
      return
    }

    if (!entriesByWorker.has(entry.workerId)) {
      entriesByWorker.set(entry.workerId, [])
    }

    entriesByWorker.get(entry.workerId)?.push(entry)
  })

  return workers.flatMap((worker) => {
    const workerEntries = [...(entriesByWorker.get(worker.id) ?? [])].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )

    if (workerEntries.length === 0) {
      return [createEmptyBulkRowForWorker(worker.id)]
    }

    return workerEntries.map((entry) => ({
      id: `entry-${entry.id}`,
      entryId: entry.id,
      workerId: worker.id,
      stageId: entry.stageId ?? '',
      jobName: entry.jobName,
      hours: String(entry.hours),
      notes: entry.notes,
    }))
  })
}

export function reorderStageList(
  currentStages: TimesheetStage[],
  sourceStageId: string,
  targetStageId: string,
) {
  const sourceIndex = currentStages.findIndex((stage) => stage.id === sourceStageId)
  const targetIndex = currentStages.findIndex((stage) => stage.id === targetStageId)

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return currentStages
  }

  const nextStages = [...currentStages]
  const [movedStage] = nextStages.splice(sourceIndex, 1)
  nextStages.splice(targetIndex, 0, movedStage)

  return nextStages
}

export function buildMissingReviewMap(
  reviews: TimesheetMissingWorkerReview[],
) {
  const next: Record<string, MissingWorkerReview> = {}

  reviews.forEach((review) => {
    const key = `${String(review.date ?? '').trim()}:${String(review.workerId ?? '').trim()}`

    if (!key || key === ':') {
      return
    }

    next[key] = {
      note: String(review.note ?? ''),
      approved: review.approved === true,
      ...(review.approvedAt
        ? {
            approvedAt: String(review.approvedAt),
          }
        : {}),
    }
  })

  return next
}
