import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  fetchMondayDashboardSnapshot,
  type DashboardOrder,
} from '../features/dashboard/api'
import {
  createStage,
  createEntriesBulk,
  deleteEntry,
  deleteStage,
  fetchTimesheetState,
  upsertMissingWorkerReview,
  upsertOrderProgress,
  reorderStages,
  type TimesheetEntry,
  type TimesheetMissingWorkerReview,
  type TimesheetOrderProgress,
  type TimesheetStage,
  type TimesheetWorker,
  updateEntry,
} from '../features/timesheet/api'

type BulkWorkerRow = {
  id: string
  entryId: string
  workerId: string
  stageId: string
  jobName: string
  hours: string
  notes: string
}

type WorkerRangePreset = 'week' | 'month' | 'year' | 'custom'

type EntryEditForm = {
  date: string
  workerId: string
  stageId: string
  jobName: string
  hours: string
  notes: string
}

type MissingWorkerReview = {
  note: string
  approved: boolean
  approvedAt?: string
}

type ManagerProgressRow = {
  jobName: string
  totalHours: number
  workerCount: number
  workerHoursByWorker: Array<{
    workerId: string
    workerName: string
    hours: number
  }>
  savedReadyPercent: number
  editReadyPercent: number
  mondayOrderId: string | null
  mondayItemName: string | null
  shopDrawingUrl: string | null
  shopDrawingFileName: string | null
  shopDrawingCachedUrl: string | null
}

type TimesheetPageProps = {
  initialView?: 'timesheet' | 'manager-progress'
}

const WORKSHEET_TABLE_CONTAINER_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  maxHeight: { xs: 420, md: 560 },
} as const

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatHours(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return value.toFixed(2)
}

function compareDateDesc(left: string, right: string) {
  return new Date(right).getTime() - new Date(left).getTime()
}

function todayIsoDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysToIsoDate(baseIsoDate: string, days: number) {
  const [year, month, day] = baseIsoDate.split('-').map(Number)
  const value = new Date(year, month - 1, day)
  value.setDate(value.getDate() + days)

  const nextYear = value.getFullYear()
  const nextMonth = String(value.getMonth() + 1).padStart(2, '0')
  const nextDay = String(value.getDate()).padStart(2, '0')

  return `${nextYear}-${nextMonth}-${nextDay}`
}

function isDateInRange(dateValue: string, startDate?: string, endDate?: string) {
  if (startDate && dateValue < startDate) {
    return false
  }

  if (endDate && dateValue > endDate) {
    return false
  }

  return true
}

function fileNamePart(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'report'
}

function normalizeJobName(value: string) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function extractDigits(value: string) {
  const digits = String(value ?? '').replace(/\D+/g, '').trim()

  return digits || null
}

function exportRowsToXlsx(
  fileBaseName: string,
  rows: Array<Record<string, string | number>>,
) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  XLSX.writeFile(book, `${fileBaseName}.xlsx`)
}

function exportRowsToCsv(
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

function getEntryRate(entry: TimesheetEntry, workersById: Map<string, TimesheetWorker>) {
  const snapshotRate = Number(entry.payRate)

  if (Number.isFinite(snapshotRate) && snapshotRate > 0) {
    return snapshotRate
  }

  return workersById.get(entry.workerId)?.hourlyRate ?? 0
}

function buildExportRows(
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

function buildByJobExportRows(
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

function buildByStageExportRows(
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

function buildBulkRowsForDate(
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

function reorderStageList(
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

function createBulkRowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createEmptyBulkRowForWorker(workerId: string, stageId = ''): BulkWorkerRow {
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

function buildMissingReviewMap(
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

export default function TimesheetPage({ initialView = 'timesheet' }: TimesheetPageProps) {
  const navigate = useNavigate()
  const isManagerProgressView = initialView === 'manager-progress'
  const [activeTab, setActiveTab] = useState(0)
  const [workers, setWorkers] = useState<TimesheetWorker[]>([])
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [stages, setStages] = useState<TimesheetStage[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const [stagesDialogOpen, setStagesDialogOpen] = useState(false)
  const [managerSheetOpen, setManagerSheetOpen] = useState(false)
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false)
  const [selectedJobName, setSelectedJobName] = useState('')
  const [stageNameInput, setStageNameInput] = useState('')
  const [draggedStageId, setDraggedStageId] = useState('')
  const [isReorderingStages, setIsReorderingStages] = useState(false)
  const [bulkDate, setBulkDate] = useState(todayIsoDate())
  const [bulkRows, setBulkRows] = useState<BulkWorkerRow[]>([])

  const [dateViewStartDate, setDateViewStartDate] = useState(todayIsoDate())
  const [dateViewEndDate, setDateViewEndDate] = useState(todayIsoDate())
  const [editingEntryId, setEditingEntryId] = useState('')
  const [entryEditForm, setEntryEditForm] = useState<EntryEditForm>({
    date: todayIsoDate(),
    workerId: '',
    stageId: '',
    jobName: '',
    hours: '',
    notes: '',
  })

  const [workerViewWorkerId, setWorkerViewWorkerId] = useState('')
  const [byJobGrouping, setByJobGrouping] = useState<'job' | 'stage'>('job')
  const [jobDetailsGrouping, setJobDetailsGrouping] =
    useState<'entries' | 'stage'>('entries')
  const [orderProgress, setOrderProgress] = useState<TimesheetOrderProgress[]>([])
  const [managerProgressByJob, setManagerProgressByJob] = useState<Record<string, string>>({})
  const [isSavingManagerProgress, setIsSavingManagerProgress] = useState(false)
  const [mondayOrders, setMondayOrders] = useState<DashboardOrder[]>([])
  const [managerWorkersPopupRow, setManagerWorkersPopupRow] =
    useState<ManagerProgressRow | null>(null)
  const [shopDrawingPreviewRow, setShopDrawingPreviewRow] =
    useState<ManagerProgressRow | null>(null)
  const [isShopDrawingPreviewLoading, setIsShopDrawingPreviewLoading] =
    useState(false)
  const [missingWorkersDate, setMissingWorkersDate] = useState('')
  const [missingReviewByKey, setMissingReviewByKey] =
    useState<Record<string, MissingWorkerReview>>({})
  const [workerRangePreset, setWorkerRangePreset] =
    useState<WorkerRangePreset>('week')
  const [workerCustomStartDate, setWorkerCustomStartDate] = useState(todayIsoDate())
  const [workerCustomEndDate, setWorkerCustomEndDate] = useState(todayIsoDate())

  useEffect(() => {
    if (!isManagerProgressView) {
      return
    }

    setActiveTab(0)
    setManagerSheetOpen(true)
  }, [isManagerProgressView])

  const refreshState = useCallback(async () => {
    setIsLoading(true)

    try {
      const [timesheetResult, mondayResult] = await Promise.allSettled([
        fetchTimesheetState(),
        fetchMondayDashboardSnapshot(),
      ])

      if (timesheetResult.status !== 'fulfilled') {
        throw timesheetResult.reason
      }

      const payload = timesheetResult.value

      setWorkers(payload.workers)
      setEntries(payload.entries)
      setStages(payload.stages)
      setOrderProgress(payload.orderProgress ?? [])
      setMissingReviewByKey(
        buildMissingReviewMap(payload.missingWorkerReviews ?? []),
      )
      setWorkerViewWorkerId((current) => {
        if (current && payload.workers.some((worker) => worker.id === current)) {
          return current
        }

        return payload.workers[0]?.id ?? ''
      })

      if (mondayResult.status === 'fulfilled') {
        setMondayOrders(Array.isArray(mondayResult.value.orders) ? mondayResult.value.orders : [])
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load timesheet data from backend.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  const workersById = useMemo(
    () => new Map(workers.map((worker) => [worker.id, worker])),
    [workers],
  )

  const stagesById = useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage])),
    [stages],
  )

  const stageOrderById = useMemo(
    () => new Map(stages.map((stage, index) => [stage.id, index])),
    [stages],
  )

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((left, right) => {
        const byDate = compareDateDesc(left.date, right.date)

        if (byDate !== 0) {
          return byDate
        }

        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      }),
    [entries],
  )

  const totals = useMemo(() => {
    return sortedEntries.reduce(
      (accumulator, entry) => {
        const workerRate = getEntryRate(entry, workersById)
        const cost = entry.hours * workerRate

        return {
          totalHours: accumulator.totalHours + entry.hours,
          totalSpend: accumulator.totalSpend + cost,
        }
      },
      { totalHours: 0, totalSpend: 0 },
    )
  }, [sortedEntries, workersById])

  const byJobView = useMemo(() => {
    const dates = [...new Set(entries.map((entry) => entry.date))].sort()

    const jobsMap = new Map<
      string,
      {
        jobName: string
        perDate: Record<string, number>
        totalHours: number
        totalCost: number
      }
    >()

    entries.forEach((entry) => {
      if (!jobsMap.has(entry.jobName)) {
        jobsMap.set(entry.jobName, {
          jobName: entry.jobName,
          perDate: {},
          totalHours: 0,
          totalCost: 0,
        })
      }

      const row = jobsMap.get(entry.jobName)

      if (!row) {
        return
      }

      const workerRate = getEntryRate(entry, workersById)
      row.perDate[entry.date] = (row.perDate[entry.date] ?? 0) + entry.hours
      row.totalHours += entry.hours
      row.totalCost += entry.hours * workerRate
    })

    const rows = [...jobsMap.values()].sort(
      (left, right) => right.totalHours - left.totalHours,
    )

    return { dates, rows }
  }, [entries, workersById])

  const byStageView = useMemo(() => {
    const dates = [...new Set(entries.map((entry) => entry.date))].sort()

    const stagesMap = new Map<
      string,
      {
        stageName: string
        perDate: Record<string, number>
        totalHours: number
        totalCost: number
      }
    >()

    entries.forEach((entry) => {
      const stageName = entry.stageId
        ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage'
        : 'Unassigned'

      if (!stagesMap.has(stageName)) {
        stagesMap.set(stageName, {
          stageName,
          perDate: {},
          totalHours: 0,
          totalCost: 0,
        })
      }

      const row = stagesMap.get(stageName)

      if (!row) {
        return
      }

      const workerRate = getEntryRate(entry, workersById)
      row.perDate[entry.date] = (row.perDate[entry.date] ?? 0) + entry.hours
      row.totalHours += entry.hours
      row.totalCost += entry.hours * workerRate
    })

    const rows = [...stagesMap.values()].sort(
      (left, right) => right.totalHours - left.totalHours,
    )

    return { dates, rows }
  }, [entries, stagesById, workersById])

  const selectedJobSummary = useMemo(
    () => byJobView.rows.find((row) => row.jobName === selectedJobName) ?? null,
    [byJobView.rows, selectedJobName],
  )

  const selectedJobEntries = useMemo(() => {
    if (!selectedJobName) {
      return []
    }

    return sortedEntries.filter((entry) => entry.jobName === selectedJobName)
  }, [selectedJobName, sortedEntries])

  const selectedJobWorkerCount = useMemo(() => {
    const uniqueWorkers = new Set(selectedJobEntries.map((entry) => entry.workerId))
    return uniqueWorkers.size
  }, [selectedJobEntries])

  const selectedJobByStageRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string
        stageName: string
        stageOrder: number
        entries: TimesheetEntry[]
        totalHours: number
        totalCost: number
        workerIds: Set<string>
      }
    >()

    selectedJobEntries.forEach((entry) => {
      const stageName = entry.stageId
        ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage'
        : 'Unassigned'
      const stageKey = entry.stageId ? `stage:${entry.stageId}` : 'stage:unassigned'
      const stageOrder = entry.stageId
        ? stageOrderById.get(entry.stageId) ?? Number.MAX_SAFE_INTEGER
        : Number.MAX_SAFE_INTEGER - 1

      if (!grouped.has(stageKey)) {
        grouped.set(stageKey, {
          key: stageKey,
          stageName,
          stageOrder,
          entries: [],
          totalHours: 0,
          totalCost: 0,
          workerIds: new Set(),
        })
      }

      const row = grouped.get(stageKey)

      if (!row) {
        return
      }

      const rate = getEntryRate(entry, workersById)
      row.entries.push(entry)
      row.totalHours += entry.hours
      row.totalCost += entry.hours * rate
      row.workerIds.add(entry.workerId)
    })

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        workerCount: row.workerIds.size,
        entries: [...row.entries].sort((left, right) => {
          const leftWorkerName = workersById.get(left.workerId)?.fullName ?? ''
          const rightWorkerName = workersById.get(right.workerId)?.fullName ?? ''
          const byWorker = leftWorkerName.localeCompare(rightWorkerName)

          if (byWorker !== 0) {
            return byWorker
          }

          const byDate = left.date.localeCompare(right.date)

          if (byDate !== 0) {
            return byDate
          }

          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        }),
      }))
      .sort((left, right) => {
        if (left.stageOrder !== right.stageOrder) {
          return left.stageOrder - right.stageOrder
        }

        return left.stageName.localeCompare(right.stageName)
      })
  }, [selectedJobEntries, stageOrderById, stagesById, workersById])

  const workerDateRange = useMemo(() => {
    const end = todayIsoDate()

    if (workerRangePreset === 'week') {
      return { start: addDaysToIsoDate(end, -6), end }
    }

    if (workerRangePreset === 'month') {
      return { start: addDaysToIsoDate(end, -29), end }
    }

    if (workerRangePreset === 'year') {
      return { start: addDaysToIsoDate(end, -364), end }
    }

    const customStart = workerCustomStartDate || undefined
    const customEnd = workerCustomEndDate || undefined

    if (customStart && customEnd && customStart > customEnd) {
      return { start: customEnd, end: customStart }
    }

    return {
      start: customStart,
      end: customEnd,
    }
  }, [workerCustomEndDate, workerCustomStartDate, workerRangePreset])

  const workerFilteredEntries = useMemo(() => {
    if (!workerViewWorkerId) {
      return []
    }

    return sortedEntries.filter(
      (entry) =>
        entry.workerId === workerViewWorkerId &&
        isDateInRange(entry.date, workerDateRange.start, workerDateRange.end),
    )
  }, [sortedEntries, workerDateRange.end, workerDateRange.start, workerViewWorkerId])

  const workerTotals = useMemo(() => {
    return workerFilteredEntries.reduce(
      (accumulator, entry) => {
        const rate = getEntryRate(entry, workersById)
        accumulator.totalHours += entry.hours
        accumulator.totalCost += entry.hours * rate
        return accumulator
      },
      { totalHours: 0, totalCost: 0 },
    )
  }, [workerFilteredEntries, workersById])

  const workerByJobRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        jobName: string
        totalHours: number
        totalCost: number
      }
    >()

    workerFilteredEntries.forEach((entry) => {
      if (!grouped.has(entry.jobName)) {
        grouped.set(entry.jobName, {
          jobName: entry.jobName,
          totalHours: 0,
          totalCost: 0,
        })
      }

      const row = grouped.get(entry.jobName)

      if (!row) {
        return
      }

      const rate = getEntryRate(entry, workersById)
      row.totalHours += entry.hours
      row.totalCost += entry.hours * rate
    })

    return [...grouped.values()].sort((left, right) => right.totalHours - left.totalHours)
  }, [workerFilteredEntries, workersById])

  const bulkRowCountByWorkerId = useMemo(() => {
    const map = new Map<string, number>()

    bulkRows.forEach((row) => {
      map.set(row.workerId, (map.get(row.workerId) ?? 0) + 1)
    })

    return map
  }, [bulkRows])

  const selectedJobExportRows = useMemo(
    () => buildExportRows(selectedJobEntries, workersById, stagesById),
    [selectedJobEntries, stagesById, workersById],
  )

  const byJobExportRows = useMemo(
    () => buildByJobExportRows(byJobView.dates, byJobView.rows),
    [byJobView.dates, byJobView.rows],
  )

  const byStageExportRows = useMemo(
    () => buildByStageExportRows(byStageView.dates, byStageView.rows),
    [byStageView.dates, byStageView.rows],
  )

  const groupedViewExportRows = byJobGrouping === 'stage'
    ? byStageExportRows
    : byJobExportRows

  const workerExportRows = useMemo(
    () => buildExportRows(workerFilteredEntries, workersById, stagesById),
    [workerFilteredEntries, stagesById, workersById],
  )

  const dateViewRange = useMemo(() => {
    const start = dateViewStartDate || undefined
    const end = dateViewEndDate || undefined

    if (start && end && start > end) {
      return { start: end, end: start }
    }

    return { start, end }
  }, [dateViewEndDate, dateViewStartDate])

  const dateViewEntries = useMemo(() => {
    if (!dateViewRange.start && !dateViewRange.end) {
      return []
    }

    return sortedEntries.filter((entry) =>
      isDateInRange(entry.date, dateViewRange.start, dateViewRange.end),
    )
  }, [dateViewRange.end, dateViewRange.start, sortedEntries])

  const dateViewTotals = useMemo(() => {
    return dateViewEntries.reduce(
      (accumulator, entry) => {
        const rate = getEntryRate(entry, workersById)
        accumulator.totalHours += entry.hours
        accumulator.totalCost += entry.hours * rate
        return accumulator
      },
      { totalHours: 0, totalCost: 0 },
    )
  }, [dateViewEntries, workersById])

  const managerDayEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.date === bulkDate),
    [bulkDate, sortedEntries],
  )

  const orderProgressByDateJobKey = useMemo(() => {
    const map = new Map<string, TimesheetOrderProgress>()

    orderProgress.forEach((progress) => {
      const key = `${progress.date}:${normalizeJobName(progress.jobName)}`
      map.set(key, progress)
    })

    return map
  }, [orderProgress])

  const latestReadyPercentByJobKey = useMemo(() => {
    const map = new Map<string, number>()
    const latestDateByJobKey = new Map<string, string>()

    orderProgress.forEach((progress) => {
      const jobKey = normalizeJobName(progress.jobName)
      const existingDate = latestDateByJobKey.get(jobKey) ?? ''

      if (!existingDate || progress.date > existingDate) {
        latestDateByJobKey.set(jobKey, progress.date)
        map.set(jobKey, Number(progress.readyPercent))
      }
    })

    return map
  }, [orderProgress])

  const managerDayJobs = useMemo(() => {
    const jobNames = new Set<string>()

    managerDayEntries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    orderProgress.forEach((progress) => {
      if (progress.date !== bulkDate) {
        return
      }

      const jobName = String(progress.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    return [...jobNames].sort((left, right) => left.localeCompare(right))
  }, [bulkDate, managerDayEntries, orderProgress])

  const mondayOrderLookup = useMemo(() => {
    const byNormalizedKey = new Map<string, DashboardOrder>()
    const byDigits = new Map<string, DashboardOrder>()

    mondayOrders.forEach((order) => {
      const nameKey = normalizeJobName(order.name)

      if (nameKey && !byNormalizedKey.has(nameKey)) {
        byNormalizedKey.set(nameKey, order)
      }

      const idKey = normalizeJobName(order.id)

      if (idKey && !byNormalizedKey.has(idKey)) {
        byNormalizedKey.set(idKey, order)
      }

      const nameDigits = extractDigits(order.name)

      if (nameDigits && !byDigits.has(nameDigits)) {
        byDigits.set(nameDigits, order)
      }

      const idDigits = extractDigits(order.id)

      if (idDigits && !byDigits.has(idDigits)) {
        byDigits.set(idDigits, order)
      }
    })

    return {
      byNormalizedKey,
      byDigits,
    }
  }, [mondayOrders])

  const managerProgressRows = useMemo<ManagerProgressRow[]>(() => {
    const entriesByJobKey = new Map<
      string,
      {
        totalHours: number
        workerIds: Set<string>
        workerHoursById: Map<string, number>
      }
    >()

    managerDayEntries.forEach((entry) => {
      const jobKey = normalizeJobName(entry.jobName)

      if (!jobKey) {
        return
      }

      const existing = entriesByJobKey.get(jobKey) ?? {
        totalHours: 0,
        workerIds: new Set<string>(),
        workerHoursById: new Map<string, number>(),
      }

      existing.totalHours += entry.hours
      existing.workerIds.add(entry.workerId)
      existing.workerHoursById.set(
        entry.workerId,
        (existing.workerHoursById.get(entry.workerId) ?? 0) + entry.hours,
      )
      entriesByJobKey.set(jobKey, existing)
    })

    return managerDayJobs.map((jobName) => {
      const jobKey = normalizeJobName(jobName)
      const jobDigits = extractDigits(jobName)
      const matchedMondayOrder =
        mondayOrderLookup.byNormalizedKey.get(jobKey) ||
        (jobDigits ? mondayOrderLookup.byDigits.get(jobDigits) : null) ||
        null
      const totals = entriesByJobKey.get(jobKey)
      const progressKey = `${bulkDate}:${jobKey}`
      const savedProgress = orderProgressByDateJobKey.get(progressKey)
      const savedReadyPercent = savedProgress ? Number(savedProgress.readyPercent) : 0
      const rawDraft = String(managerProgressByJob[jobName] ?? '').trim()
      const parsedDraft = Number(rawDraft)
      const workerHoursByWorker = [...(totals?.workerHoursById.entries() ?? [])]
        .map(([workerId, hours]) => ({
          workerId,
          workerName: workersById.get(workerId)?.fullName ?? 'Unknown worker',
          hours,
        }))
        .sort((left, right) => right.hours - left.hours || left.workerName.localeCompare(right.workerName))
      const editReadyPercent =
        rawDraft === '' || !Number.isFinite(parsedDraft)
          ? savedReadyPercent
          : Math.min(100, Math.max(0, parsedDraft))

      return {
        jobName,
        totalHours: totals?.totalHours ?? 0,
        workerCount: workerHoursByWorker.length,
        workerHoursByWorker,
        savedReadyPercent,
        editReadyPercent,
        mondayOrderId: matchedMondayOrder?.id ?? null,
        mondayItemName: matchedMondayOrder?.name ?? null,
        shopDrawingUrl: matchedMondayOrder?.shopDrawingUrl ?? null,
        shopDrawingFileName: matchedMondayOrder?.shopDrawingFileName ?? null,
        shopDrawingCachedUrl: matchedMondayOrder?.shopDrawingCachedUrl ?? null,
      }
    })
  }, [
    bulkDate,
    managerDayEntries,
    managerDayJobs,
    managerProgressByJob,
    mondayOrderLookup.byDigits,
    mondayOrderLookup.byNormalizedKey,
    orderProgressByDateJobKey,
    workersById,
  ])

  const managerProgressSummary = useMemo(() => {
    if (managerProgressRows.length === 0) {
      return {
        averageReadyPercent: 0,
        completeCount: 0,
        inProgressCount: 0,
      }
    }

    const totalReady = managerProgressRows.reduce(
      (accumulator, row) => accumulator + row.editReadyPercent,
      0,
    )

    return {
      averageReadyPercent: totalReady / managerProgressRows.length,
      completeCount: managerProgressRows.filter((row) => row.editReadyPercent >= 100).length,
      inProgressCount: managerProgressRows.filter(
        (row) => row.editReadyPercent > 0 && row.editReadyPercent < 100,
      ).length,
    }
  }, [managerProgressRows])

  const selectedJobDateReadyRows = useMemo(() => {
    if (!selectedJobName) {
      return []
    }

    const dates = [...new Set(selectedJobEntries.map((entry) => entry.date))].sort()

    return dates.map((date) => {
      const key = `${date}:${normalizeJobName(selectedJobName)}`
      const progress = orderProgressByDateJobKey.get(key)

      return {
        date,
        readyPercent: progress ? Number(progress.readyPercent) : null,
      }
    })
  }, [orderProgressByDateJobKey, selectedJobEntries, selectedJobName])

  const dateViewReadyByDateRows = useMemo(() => {
    const jobsByDate = new Map<string, Set<string>>()

    dateViewEntries.forEach((entry) => {
      if (!jobsByDate.has(entry.date)) {
        jobsByDate.set(entry.date, new Set())
      }

      jobsByDate.get(entry.date)?.add(entry.jobName)
    })

    return [...jobsByDate.entries()]
      .sort(([left], [right]) => compareDateDesc(left, right))
      .map(([date, jobNames]) => {
        const rows = [...jobNames]
          .sort((left, right) => left.localeCompare(right))
          .map((jobName) => {
            const key = `${date}:${normalizeJobName(jobName)}`
            const progress = orderProgressByDateJobKey.get(key)

            return {
              jobName,
              readyPercent: progress ? Number(progress.readyPercent) : null,
            }
          })

        return {
          date,
          rows,
        }
      })
  }, [dateViewEntries, orderProgressByDateJobKey])

  const missingInfoDates = useMemo(() => {
    if (workers.length === 0) {
      return []
    }

    const submittedWorkerIdsByDate = new Map<string, Set<string>>()

    entries.forEach((entry) => {
      if (!submittedWorkerIdsByDate.has(entry.date)) {
        submittedWorkerIdsByDate.set(entry.date, new Set())
      }

      submittedWorkerIdsByDate.get(entry.date)?.add(entry.workerId)
    })

    return [...submittedWorkerIdsByDate.entries()]
      .filter(([, submittedWorkerIds]) => {
        return submittedWorkerIds.size > 0 && submittedWorkerIds.size < workers.length
      })
      .map(([date]) => date)
      .sort(compareDateDesc)
  }, [entries, workers.length])

  const missingWorkersDayEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.date === missingWorkersDate),
    [missingWorkersDate, sortedEntries],
  )

  const missingWorkersSubmittedIds = useMemo(
    () => new Set(missingWorkersDayEntries.map((entry) => entry.workerId)),
    [missingWorkersDayEntries],
  )

  const missingWorkersList = useMemo(
    () => workers.filter((worker) => !missingWorkersSubmittedIds.has(worker.id)),
    [missingWorkersSubmittedIds, workers],
  )

  useEffect(() => {
    if (missingInfoDates.length === 0) {
      if (missingWorkersDate) {
        setMissingWorkersDate('')
      }

      return
    }

    if (!missingInfoDates.includes(missingWorkersDate)) {
      setMissingWorkersDate(missingInfoDates[0])
    }
  }, [missingInfoDates, missingWorkersDate])

  useEffect(() => {
    const stageIds = new Set(stages.map((stage) => stage.id))

    setBulkRows(
      buildBulkRowsForDate(bulkDate, workers, entries).map((row) =>
        row.stageId && !stageIds.has(row.stageId)
          ? {
              ...row,
              stageId: '',
            }
          : row,
      ),
    )
  }, [bulkDate, entries, stages, workers])

  useEffect(() => {
    if (!editingEntryId) {
      return
    }

    if (entries.some((entry) => entry.id === editingEntryId)) {
      return
    }

    setEditingEntryId('')
  }, [editingEntryId, entries])

  useEffect(() => {
    if (!isManagerProgressView && managerSheetOpen && managerDayJobs.length === 0) {
      setManagerSheetOpen(false)
    }
  }, [isManagerProgressView, managerDayJobs.length, managerSheetOpen])

  useEffect(() => {
    if (!managerSheetOpen) {
      return
    }

    const nextDraftByJob: Record<string, string> = {}

    managerDayJobs.forEach((jobName) => {
      const key = `${bulkDate}:${normalizeJobName(jobName)}`
      const progress = orderProgressByDateJobKey.get(key)
      nextDraftByJob[jobName] = progress ? String(progress.readyPercent) : '0'
    })

    setManagerProgressByJob(nextDraftByJob)
  }, [bulkDate, managerDayJobs, managerSheetOpen, orderProgressByDateJobKey])

  const handleBulkRowChange = (
    rowId: string,
    field: keyof Omit<BulkWorkerRow, 'id' | 'workerId'>,
    value: string,
  ) => {
    setBulkRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: value,
            }
          : row,
      ),
    )
  }

  const handleAddBulkRowForWorker = (workerId: string, afterRowId: string) => {
    setBulkRows((current) => {
      const insertIndex = current.findIndex((row) => row.id === afterRowId)
      const sourceRow = insertIndex >= 0 ? current[insertIndex] : null
      const nextRow = createEmptyBulkRowForWorker(workerId, sourceRow?.stageId ?? '')

      if (insertIndex < 0) {
        return [...current, nextRow]
      }

      const nextRows = [...current]
      nextRows.splice(insertIndex + 1, 0, nextRow)
      return nextRows
    })
  }

  const handleRemoveBulkRowForWorker = async (rowId: string) => {
    setError('')
    setSuccess('')

    const row = bulkRows.find((entry) => entry.id === rowId)

    if (!row) {
      return
    }

    if (row.entryId) {
      const confirmed = window.confirm('Remove this submitted entry?')

      if (!confirmed) {
        return
      }

      try {
        await deleteEntry(row.entryId)

        if (editingEntryId === row.entryId) {
          setEditingEntryId('')
        }

        await refreshState()
        setSuccess('Entry removed.')
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Failed to remove entry.'
        setError(message)
      }

      return
    }

    setBulkRows((current) => {
      const activeRow = current.find((entry) => entry.id === rowId)

      if (!activeRow) {
        return current
      }

      const workerRows = current.filter((entry) => entry.workerId === activeRow.workerId)

      if (workerRows.length <= 1) {
        return current
      }

      return current.filter((entry) => entry.id !== rowId)
    })
  }

  const handleSaveDailySheet = async () => {
    setError('')
    setSuccess('')

    if (!bulkDate) {
      setError('Please choose a date for daily sheet.')
      return
    }

    if (workers.length === 0) {
      setError('Add workers first before saving daily sheet.')
      return
    }

    const createRows = [] as Array<{
      workerId: string
      stageId?: string
      jobName: string
      hours: number
      notes: string
    }>
    const updateRows = [] as Array<{
      entryId: string
      workerId: string
      stageId?: string
      jobName: string
      hours: number
      notes: string
    }>
    const invalidWorkers: string[] = []

    bulkRows.forEach((row) => {
      const hasInput = row.jobName.trim() || row.hours.trim() || row.notes.trim()

      if (!hasInput) {
        if (row.entryId) {
          const workerName = workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
          invalidWorkers.push(`${workerName} (cannot be blank)`)
        }

        return
      }

      const jobName = row.jobName.trim()
      const stageId = row.stageId.trim()
      const hours = Number(row.hours)

      if (!jobName || !Number.isFinite(hours) || hours <= 0) {
        const workerName = workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
        invalidWorkers.push(workerName)
        return
      }

      if (row.entryId) {
        updateRows.push({
          entryId: row.entryId,
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
        return
      }

      createRows.push({
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

    if (invalidWorkers.length > 0) {
      setError(`Some rows are invalid. Fix: ${invalidWorkers.join(', ')}`)
      return
    }

    if (createRows.length === 0 && updateRows.length === 0) {
      setError('No valid rows to save. Fill job and hours for at least one worker.')
      return
    }

    try {
      const updatePromises = updateRows.map((row) =>
        updateEntry(row.entryId, {
          date: bulkDate,
          workerId: row.workerId,
          stageId: row.stageId ?? '',
          jobName: row.jobName,
          hours: row.hours,
          notes: row.notes,
        }),
      )

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises)
      }

      let insertedCount = 0

      if (createRows.length > 0) {
        const response = await createEntriesBulk(bulkDate, createRows)
        insertedCount = response.insertedCount
      }

      await refreshState()

      const statusParts: string[] = []

      if (insertedCount > 0) {
        statusParts.push(`${insertedCount} added`)
      }

      if (updateRows.length > 0) {
        statusParts.push(`${updateRows.length} updated`)
      }

      setSuccess(
        statusParts.length > 0
          ? `Daily sheet saved: ${statusParts.join(', ')}.`
          : 'Daily sheet saved.',
      )
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to save daily sheet.'
      setError(message)
    }
  }

  const handleStartEditEntry = (entry: TimesheetEntry) => {
    setEditingEntryId(entry.id)
    setEntryEditForm({
      date: entry.date,
      workerId: entry.workerId,
      stageId: entry.stageId ?? '',
      jobName: entry.jobName,
      hours: String(entry.hours),
      notes: entry.notes,
    })
  }

  const handleEditEntryFieldChange = (field: keyof EntryEditForm, value: string) => {
    setEntryEditForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleCancelEditEntry = () => {
    setEditingEntryId('')
  }

  const handleSaveEditedEntry = async () => {
    setError('')
    setSuccess('')

    if (!editingEntryId) {
      setError('No entry selected for edit.')
      return
    }

    const date = entryEditForm.date.trim()
    const workerId = entryEditForm.workerId.trim()
    const stageId = entryEditForm.stageId.trim()
    const jobName = entryEditForm.jobName.trim()
    const notes = entryEditForm.notes.trim()
    const hours = Number(entryEditForm.hours)

    if (!date) {
      setError('Entry date is required.')
      return
    }

    if (!workerId) {
      setError('Worker is required for entry.')
      return
    }

    if (!jobName) {
      setError('Job name is required for entry.')
      return
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      setError('Hours must be a positive number.')
      return
    }

    try {
      await updateEntry(editingEntryId, {
        date,
        workerId,
        stageId,
        jobName,
        hours,
        notes,
      })

      setEditingEntryId('')
      await refreshState()
      setSuccess('Entry updated.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to update entry.'
      setError(message)
    }
  }

  const handleDeleteEntryRow = async (entryId: string) => {
    setError('')
    setSuccess('')

    const confirmed = window.confirm('Remove this entry?')

    if (!confirmed) {
      return
    }

    try {
      await deleteEntry(entryId)

      if (editingEntryId === entryId) {
        setEditingEntryId('')
      }

      await refreshState()
      setSuccess('Entry removed.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to remove entry.'
      setError(message)
    }
  }

  const handleAddStage = async () => {
    setError('')
    setSuccess('')

    const name = stageNameInput.trim()

    if (!name) {
      setError('Stage name is required.')
      return
    }

    try {
      await createStage({ name })
      setStageNameInput('')
      await refreshState()
      setSuccess('Stage added.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to add stage.'
      setError(message)
    }
  }

  const handleRemoveStage = async (stageId: string) => {
    setError('')
    setSuccess('')

    const confirmed = window.confirm('Remove this stage?')

    if (!confirmed) {
      return
    }

    try {
      await deleteStage(stageId)

      if (entryEditForm.stageId === stageId) {
        setEntryEditForm((current) => ({
          ...current,
          stageId: '',
        }))
      }

      await refreshState()
      setSuccess('Stage removed.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to remove stage.'
      setError(message)
    }
  }

  const handleStageDragStart = (stageId: string) => {
    if (isReorderingStages) {
      return
    }

    setDraggedStageId(stageId)
  }

  const handleStageDragEnd = () => {
    setDraggedStageId('')
  }

  const handleDropStage = async (targetStageId: string) => {
    if (!draggedStageId || draggedStageId === targetStageId || isReorderingStages) {
      return
    }

    const previousStages = stages
    const nextStages = reorderStageList(stages, draggedStageId, targetStageId)

    if (nextStages === previousStages) {
      setDraggedStageId('')
      return
    }

    setDraggedStageId('')
    setStages(nextStages)
    setError('')
    setSuccess('')
    setIsReorderingStages(true)

    try {
      await reorderStages(nextStages.map((stage) => stage.id))
      setSuccess('Stage order updated.')
    } catch (requestError) {
      setStages(previousStages)
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to reorder stages.'
      setError(message)
    } finally {
      setIsReorderingStages(false)
    }
  }

  const handleOpenShopDrawingPreview = useCallback((row: ManagerProgressRow) => {
    const cachedPreviewUrl = String(row.shopDrawingCachedUrl ?? '').trim()
    const mondayOrderId = String(row.mondayOrderId ?? '').trim()

    if (!cachedPreviewUrl && !mondayOrderId) {
      setError('This order is not linked to a Monday item yet.')
      return
    }

    setError('')
    setSuccess('')
    setIsShopDrawingPreviewLoading(true)
    setShopDrawingPreviewRow(row)
  }, [])

  const handleOpenManagerWorkersPopup = useCallback((row: ManagerProgressRow) => {
    if (row.workerHoursByWorker.length === 0) {
      return
    }

    setManagerWorkersPopupRow(row)
  }, [])

  const handleCloseManagerWorkersPopup = useCallback(() => {
    setManagerWorkersPopupRow(null)
  }, [])

  const closeManagerSheet = useCallback(() => {
    if (isManagerProgressView) {
      navigate('/timesheet')
      return
    }

    setManagerSheetOpen(false)
  }, [isManagerProgressView, navigate])

  const handleCloseShopDrawingPreview = useCallback(() => {
    setIsShopDrawingPreviewLoading(false)
    setShopDrawingPreviewRow(null)
  }, [])

  const shopDrawingPreviewSrc = useMemo(() => {
    const cachedPreviewUrl = String(shopDrawingPreviewRow?.shopDrawingCachedUrl ?? '').trim()

    if (cachedPreviewUrl) {
      return cachedPreviewUrl
    }

    if (!shopDrawingPreviewRow?.mondayOrderId) {
      return ''
    }

    const query = new URLSearchParams({
      orderId: shopDrawingPreviewRow.mondayOrderId,
      inline: '1',
    })

    return `/api/dashboard/monday/shop-drawing/download?${query.toString()}`
  }, [shopDrawingPreviewRow])

  const handleManagerProgressChange = (jobName: string, value: string) => {
    setManagerProgressByJob((current) => ({
      ...current,
      [jobName]: value,
    }))
  }

  const handleSaveManagerProgress = async () => {
    setError('')
    setSuccess('')

    if (!bulkDate) {
      setError('Date is required for manager progress.')
      return
    }

    if (managerDayJobs.length === 0) {
      setError('No orders found for this date.')
      return
    }

    const invalidJobs: string[] = []

    managerDayJobs.forEach((jobName) => {
      const rawValue = String(managerProgressByJob[jobName] ?? '').trim()
      const readyPercent = Number(rawValue)

      if (!rawValue || !Number.isFinite(readyPercent) || readyPercent < 0 || readyPercent > 100) {
        invalidJobs.push(jobName)
      }
    })

    if (invalidJobs.length > 0) {
      setError(`Enter ready % from 0 to 100 for: ${invalidJobs.join(', ')}`)
      return
    }

    setIsSavingManagerProgress(true)

    try {
      await Promise.all(
        managerDayJobs.map((jobName) =>
          upsertOrderProgress({
            date: bulkDate,
            jobName,
            readyPercent: Number(String(managerProgressByJob[jobName] ?? '').trim()),
          }),
        ),
      )

      await refreshState()
      setSuccess('Manager progress saved.')

      if (!isManagerProgressView) {
        setManagerSheetOpen(false)
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to save manager progress.'
      setError(message)
    } finally {
      setIsSavingManagerProgress(false)
    }
  }

  const getMissingReviewKey = (workerId: string) => {
    return `${missingWorkersDate}:${workerId}`
  }

  const updateMissingReviewState = (
    updater: (current: Record<string, MissingWorkerReview>) => Record<string, MissingWorkerReview>,
  ) => {
    setMissingReviewByKey((current) => updater(current))
  }

  const persistMissingWorkerReview = async (
    workerId: string,
    review: MissingWorkerReview,
    options?: {
      successMessage?: string
    },
  ) => {
    if (!missingWorkersDate) {
      return
    }

    try {
      const response = await upsertMissingWorkerReview({
        date: missingWorkersDate,
        workerId,
        note: String(review.note ?? '').trim(),
        approved: review.approved === true,
      })

      const persistedReview = response.review
      const persistedKey = `${persistedReview.date}:${persistedReview.workerId}`

      updateMissingReviewState((current) => ({
        ...current,
        [persistedKey]: {
          note: String(persistedReview.note ?? ''),
          approved: persistedReview.approved === true,
          ...(persistedReview.approvedAt
            ? {
                approvedAt: String(persistedReview.approvedAt),
              }
            : {}),
        },
      }))

      if (options?.successMessage) {
        setError('')
        setSuccess(options.successMessage)
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to save missing worker review.'
      setSuccess('')
      setError(message)
    }
  }

  const handleMissingWorkerNoteChange = (workerId: string, note: string) => {
    if (!missingWorkersDate) {
      return
    }

    const reviewKey = getMissingReviewKey(workerId)

    updateMissingReviewState((current) => ({
      ...current,
      [reviewKey]: {
        note,
        approved: current[reviewKey]?.approved ?? false,
        ...(current[reviewKey]?.approvedAt
          ? {
              approvedAt: current[reviewKey].approvedAt,
            }
          : {}),
      },
    }))
  }

  const handleSaveMissingWorkerNote = async (workerId: string) => {
    if (!missingWorkersDate) {
      return
    }

    const reviewKey = getMissingReviewKey(workerId)
    const review = missingReviewByKey[reviewKey] ?? {
      note: '',
      approved: false,
    }

    await persistMissingWorkerReview(workerId, review)
  }

  const handleApproveMissingWorker = async (worker: TimesheetWorker) => {
    if (!missingWorkersDate) {
      return
    }

    const reviewKey = getMissingReviewKey(worker.id)
    const note = (missingReviewByKey[reviewKey]?.note ?? '').trim()

    if (missingReviewByKey[reviewKey]?.approved) {
      return
    }

    if (!note) {
      setSuccess('')
      setError(`Add a note before approving ${worker.fullName}.`)
      return
    }

    const confirmed = window.confirm(
      `Approve missing info for ${worker.fullName} on ${missingWorkersDate}?`,
    )

    if (!confirmed) {
      return
    }

    await persistMissingWorkerReview(
      worker.id,
      {
        note,
        approved: true,
      },
      {
        successMessage: `Approved missing info for ${worker.fullName}.`,
      },
    )
  }

  const handleUnapproveMissingWorker = async (worker: TimesheetWorker) => {
    if (!missingWorkersDate) {
      return
    }

    const reviewKey = getMissingReviewKey(worker.id)

    if (!missingReviewByKey[reviewKey]?.approved) {
      return
    }

    const confirmed = window.confirm(
      `Unapprove missing info for ${worker.fullName} on ${missingWorkersDate}?`,
    )

    if (!confirmed) {
      return
    }

    await persistMissingWorkerReview(
      worker.id,
      {
        note: missingReviewByKey[reviewKey]?.note ?? '',
        approved: false,
      },
      {
        successMessage: `Unapproved missing info for ${worker.fullName}.`,
      },
    )
  }

  const openJobDetails = (jobName: string) => {
    setSelectedJobName(jobName)
    setJobDetailsGrouping('entries')
    setJobDetailsOpen(true)
  }

  const exportSelectedJobToXlsx = () => {
    if (selectedJobExportRows.length === 0) {
      setError('No rows to export for this job.')
      return
    }

    const fileBaseName = `job-${fileNamePart(selectedJobName)}-${todayIsoDate()}`
    exportRowsToXlsx(fileBaseName, selectedJobExportRows)
    setSuccess('Job exported to Excel.')
  }

  const exportSelectedJobToCsv = () => {
    if (selectedJobExportRows.length === 0) {
      setError('No rows to export for this job.')
      return
    }

    const fileBaseName = `job-${fileNamePart(selectedJobName)}-${todayIsoDate()}`
    exportRowsToCsv(fileBaseName, selectedJobExportRows)
    setSuccess('Job exported to CSV.')
  }

  const exportWorkerHistoryToXlsx = () => {
    if (workerExportRows.length === 0) {
      setError('No worker rows to export for this range.')
      return
    }

    const workerName = workersById.get(workerViewWorkerId)?.fullName ?? 'worker'
    const fileBaseName = `worker-${fileNamePart(workerName)}-${todayIsoDate()}`
    exportRowsToXlsx(fileBaseName, workerExportRows)
    setSuccess('Worker history exported to Excel.')
  }

  const exportWorkerHistoryToCsv = () => {
    if (workerExportRows.length === 0) {
      setError('No worker rows to export for this range.')
      return
    }

    const workerName = workersById.get(workerViewWorkerId)?.fullName ?? 'worker'
    const fileBaseName = `worker-${fileNamePart(workerName)}-${todayIsoDate()}`
    exportRowsToCsv(fileBaseName, workerExportRows)
    setSuccess('Worker history exported to CSV.')
  }

  const exportByJobToXlsx = () => {
    if (groupedViewExportRows.length === 0) {
      setError(
        byJobGrouping === 'stage'
          ? 'No rows to export in View By Stage.'
          : 'No rows to export in View By Job.',
      )
      return
    }

    const fileBaseName = byJobGrouping === 'stage'
      ? `view-by-stage-${todayIsoDate()}`
      : `view-by-job-${todayIsoDate()}`
    exportRowsToXlsx(fileBaseName, groupedViewExportRows)
    setSuccess(
      byJobGrouping === 'stage'
        ? 'View By Stage exported to Excel.'
        : 'View By Job exported to Excel.',
    )
  }

  const exportByJobToCsv = () => {
    if (groupedViewExportRows.length === 0) {
      setError(
        byJobGrouping === 'stage'
          ? 'No rows to export in View By Stage.'
          : 'No rows to export in View By Job.',
      )
      return
    }

    const fileBaseName = byJobGrouping === 'stage'
      ? `view-by-stage-${todayIsoDate()}`
      : `view-by-job-${todayIsoDate()}`
    exportRowsToCsv(fileBaseName, groupedViewExportRows)
    setSuccess(
      byJobGrouping === 'stage'
        ? 'View By Stage exported to CSV.'
        : 'View By Job exported to CSV.',
    )
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        gap={1.2}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Work Sheet
          </Typography>
          <Typography color="text.secondary">
            Daily bulk sheet, worker costs, and reporting by job or worker.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<CategoryRoundedIcon />}
          onClick={() => setStagesDialogOpen(true)}
        >
          Stages ({stages.length})
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      ) : null}

      {success ? (
        <Alert severity="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      ) : null}

      {isLoading ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading timesheet data...</Typography>
          </Stack>
        </Paper>
      ) : null}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Total hours logged
          </Typography>
          <Typography variant="h5" fontWeight={700}>
            {formatHours(totals.totalHours)} h
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Total spend based on hourly rates
          </Typography>
          <Typography variant="h5" fontWeight={700}>
            {formatCurrency(totals.totalSpend)}
          </Typography>
        </Paper>
      </Stack>

      <Paper variant="outlined">
        <Tabs
          value={activeTab}
          onChange={(_event, value) => setActiveTab(Number(value))}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Daily Sheet" />
          <Tab label="View By Job" />
          <Tab label="View By Worker" />
          <Tab label="View By Date" />
          <Tab label="Missing Worker Info" />
        </Tabs>

        <Divider />

        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          {activeTab === 0 ? (
            <Stack spacing={2}>
             

              <TextField
                type="date"
                label="Date"
                value={bulkDate}
                onChange={(event) => {
                  setBulkDate(event.target.value)
                  setEditingEntryId('')
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 220 }}
              />

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader sx={{ minWidth: 860 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bulkRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography color="text.secondary">
                            Add workers first, then fill this daily sheet.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      bulkRows.map((row) => {
                        const workerName =
                          workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
                        const workerNumber =
                          String(workersById.get(row.workerId)?.workerNumber ?? '').trim() || '----'

                        return (
                          <TableRow key={row.id} hover>
                            <TableCell>
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => handleAddBulkRowForWorker(row.workerId, row.id)}
                                  title="Add another line for this worker"
                                >
                                  <AddRoundedIcon fontSize="small" />
                                </IconButton>

                                {row.entryId || (
                                  bulkRowCountByWorkerId.get(row.workerId)
                                  && (bulkRowCountByWorkerId.get(row.workerId) ?? 0) > 1
                                ) ? (
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => void handleRemoveBulkRowForWorker(row.id)}
                                    title={row.entryId ? 'Remove this submitted entry' : 'Remove this extra line'}
                                  >
                                    <DeleteOutlineRoundedIcon fontSize="small" />
                                  </IconButton>
                                ) : null}

                                <Typography variant="body2">{workerNumber} - {workerName}</Typography>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ minWidth: 180 }}>
                              <TextField
                                select
                                size="small"
                                fullWidth
                                value={row.stageId}
                                onChange={(event) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'stageId',
                                    event.target.value,
                                  )
                                }
                              >
                                <MenuItem value="">No stage selected</MenuItem>

                                {stages.map((stage) => (
                                  <MenuItem key={stage.id} value={stage.id}>
                                    {stage.name}
                                  </MenuItem>
                                ))}
                              </TextField>
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                fullWidth
                                placeholder="Job Number"
                                value={row.jobName}
                                onChange={(event) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'jobName',
                                    event.target.value,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell align="right" sx={{ minWidth: 140 }}>
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ min: 0, step: 0.25 }}
                                placeholder="0"
                                value={row.hours}
                                onChange={(event) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'hours',
                                    event.target.value,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell sx={{ minWidth: 260 }}>
                              <TextField
                                size="small"
                                fullWidth
                                placeholder="Notes"
                                value={row.notes}
                                onChange={(event) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'notes',
                                    event.target.value,
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={handleSaveDailySheet}>
                  Save Daily Sheet
                </Button>

                {managerDayJobs.length > 0 ? (
                  <Button
                    variant="outlined"
                    startIcon={<OpenInNewRoundedIcon />}
                    onClick={() => setManagerSheetOpen(true)}
                  >
                    Manager Progress ({managerDayJobs.length})
                  </Button>
                ) : null}
              </Stack>

              <Typography variant="body2" color="text.secondary">
                {managerDayJobs.length > 0
                  ? `Entries for ${bulkDate} are loaded above. Use Manager Progress to save readiness percent by order for this date.`
                  : 'Use the table above to add first entries for this date.'}
              </Typography>
            </Stack>
          ) : null}

          {activeTab === 1 ? (
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="subtitle1" fontWeight={700}>
                  {byJobGrouping === 'stage' ? 'Hours By Stage And Date' : 'Hours By Job And Date'}
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Group by"
                    value={byJobGrouping}
                    onChange={(event) => setByJobGrouping(event.target.value as 'job' | 'stage')}
                    sx={{ minWidth: 170 }}
                  >
                    <MenuItem value="job">Job</MenuItem>
                    <MenuItem value="stage">Stage</MenuItem>
                  </TextField>

                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportByJobToXlsx}
                    disabled={groupedViewExportRows.length === 0}
                  >
                    Download XL
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportByJobToCsv}
                    disabled={groupedViewExportRows.length === 0}
                  >
                    Download CSV
                  </Button>
                </Stack>
              </Stack>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader sx={{ minWidth: 880 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{byJobGrouping === 'stage' ? 'Stage' : 'Job'}</TableCell>
                      {(byJobGrouping === 'stage' ? byStageView.dates : byJobView.dates).map((date) => (
                        <TableCell key={date} align="right">
                          {date}
                        </TableCell>
                      ))}
                      <TableCell align="right">Ready %</TableCell>
                      <TableCell align="right">Total hours</TableCell>
                      <TableCell align="right">Total cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(byJobGrouping === 'stage' ? byStageView.rows : byJobView.rows).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={(byJobGrouping === 'stage' ? byStageView.dates.length : byJobView.dates.length) + 4}
                        >
                          <Typography color="text.secondary">No entries yet.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : byJobGrouping === 'stage' ? (
                      byStageView.rows.map((row) => (
                        <TableRow key={row.stageName} hover>
                          <TableCell>{row.stageName}</TableCell>

                          {byStageView.dates.map((date) => (
                            <TableCell key={`${row.stageName}-${date}`} align="right">
                              {row.perDate[date] ? formatHours(row.perDate[date]) : '-'}
                            </TableCell>
                          ))}

                          <TableCell align="right">-</TableCell>

                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatHours(row.totalHours)}</Typography>
                          </TableCell>

                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatCurrency(row.totalCost)}</Typography>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      byJobView.rows.map((row) => (
                        <TableRow key={row.jobName} hover>
                          <TableCell>
                            <Button
                              variant="text"
                              endIcon={<OpenInNewRoundedIcon />}
                              onClick={() => openJobDetails(row.jobName)}
                            >
                              {row.jobName}
                            </Button>
                          </TableCell>

                          {byJobView.dates.map((date) => (
                            <TableCell key={`${row.jobName}-${date}`} align="right">
                              {row.perDate[date] ? formatHours(row.perDate[date]) : '-'}
                            </TableCell>
                          ))}

                          <TableCell align="right">
                            {Number.isFinite(latestReadyPercentByJobKey.get(normalizeJobName(row.jobName)) ?? NaN)
                              ? `${Number(latestReadyPercentByJobKey.get(normalizeJobName(row.jobName))).toFixed(1)}%`
                              : '-'}
                          </TableCell>

                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatHours(row.totalHours)}</Typography>
                          </TableCell>

                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatCurrency(row.totalCost)}</Typography>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ) : null}

          {activeTab === 2 ? (
            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={700}>
                Worker History
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  select
                  fullWidth
                  label="Worker"
                  value={workerViewWorkerId}
                  onChange={(event) => setWorkerViewWorkerId(event.target.value)}
                >
                  {workers.length === 0 ? (
                    <MenuItem disabled value="">
                      Add workers first
                    </MenuItem>
                  ) : null}

                  {workers.map((worker) => (
                    <MenuItem key={worker.id} value={worker.id}>
                      {(String(worker.workerNumber ?? '').trim() || '----')} - {worker.fullName}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  select
                  fullWidth
                  label="Range"
                  value={workerRangePreset}
                  onChange={(event) =>
                    setWorkerRangePreset(event.target.value as WorkerRangePreset)
                  }
                >
                  <MenuItem value="week">Last 7 days</MenuItem>
                  <MenuItem value="month">Last 30 days</MenuItem>
                  <MenuItem value="year">Last 365 days</MenuItem>
                  <MenuItem value="custom">Custom range</MenuItem>
                </TextField>

                {workerRangePreset === 'custom' ? (
                  <>
                    <TextField
                      fullWidth
                      type="date"
                      label="Start"
                      value={workerCustomStartDate}
                      onChange={(event) => setWorkerCustomStartDate(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />

                    <TextField
                      fullWidth
                      type="date"
                      label="End"
                      value={workerCustomEndDate}
                      onChange={(event) => setWorkerCustomEndDate(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </>
                ) : null}
              </Stack>

              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="body2" color="text.secondary">
                  Range: {workerDateRange.start ?? 'Any'} to {workerDateRange.end ?? 'Any'}
                </Typography>

                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportWorkerHistoryToXlsx}
                    disabled={workerExportRows.length === 0}
                  >
                    Download XL
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportWorkerHistoryToCsv}
                    disabled={workerExportRows.length === 0}
                  >
                    Download CSV
                  </Button>
                </Stack>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Hours in range
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(workerTotals.totalHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Cost in range
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatCurrency(workerTotals.totalCost)}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Entries in range
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {workerFilteredEntries.length}
                  </Typography>
                </Paper>
              </Stack>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workerByJobRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Typography color="text.secondary">No rows in selected range.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      workerByJobRows.map((row) => (
                        <TableRow key={row.jobName} hover>
                          <TableCell>{row.jobName}</TableCell>
                          <TableCell align="right">{formatHours(row.totalHours)}</TableCell>
                          <TableCell align="right">{formatCurrency(row.totalCost)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workerFilteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography color="text.secondary">No history rows in selected range.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      workerFilteredEntries.map((entry) => {
                        const rate = getEntryRate(entry, workersById)
                        const cost = entry.hours * rate

                        return (
                          <TableRow key={entry.id} hover>
                            <TableCell>{entry.date}</TableCell>
                            <TableCell>
                              {entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : '-'}
                            </TableCell>
                            <TableCell>{entry.jobName}</TableCell>
                            <TableCell align="right">{formatHours(entry.hours)}</TableCell>
                            <TableCell align="right">{formatCurrency(rate)}</TableCell>
                            <TableCell align="right">{formatCurrency(cost)}</TableCell>
                            <TableCell>{entry.notes || '-'}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ) : null}

          {activeTab === 3 ? (
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="subtitle1" fontWeight={700}>
                  Entries By Date
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    type="date"
                    label="Start Date"
                    value={dateViewStartDate}
                    onChange={(event) => {
                      setDateViewStartDate(event.target.value)
                      setEditingEntryId('')
                    }}
                    InputLabelProps={{ shrink: true }}
                    sx={{ maxWidth: 220 }}
                  />
                  <TextField
                    type="date"
                    label="End Date"
                    value={dateViewEndDate}
                    onChange={(event) => {
                      setDateViewEndDate(event.target.value)
                      setEditingEntryId('')
                    }}
                    InputLabelProps={{ shrink: true }}
                    sx={{ maxWidth: 220 }}
                  />
                </Stack>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Entries in selected dates
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {dateViewEntries.length}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total hours in selected dates
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(dateViewTotals.totalHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total cost in selected dates
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatCurrency(dateViewTotals.totalCost)}
                  </Typography>
                </Paper>
              </Stack>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader sx={{ minWidth: 1080 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell>Notes</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dateViewEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9}>
                          <Typography color="text.secondary">
                            No entries in the selected date range.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      dateViewEntries.map((entry) => {
                        const isEditing = editingEntryId === entry.id
                        const activeWorkerId = isEditing ? entryEditForm.workerId : entry.workerId
                        const rawHours = isEditing ? Number(entryEditForm.hours) : entry.hours
                        const hours = Number.isFinite(rawHours) ? rawHours : 0
                        const rate = isEditing
                          ? workersById.get(activeWorkerId)?.hourlyRate ?? 0
                          : getEntryRate(entry, workersById)
                        const cost = hours * rate

                        return (
                          <TableRow key={entry.id} hover>
                            <TableCell sx={{ minWidth: 150 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  type="date"
                                  value={entryEditForm.date}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('date', event.target.value)
                                  }
                                />
                              ) : (
                                entry.date
                              )}
                            </TableCell>

                            <TableCell sx={{ minWidth: 200 }}>
                              {isEditing ? (
                                <TextField
                                  select
                                  size="small"
                                  fullWidth
                                  value={entryEditForm.workerId}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('workerId', event.target.value)
                                  }
                                >
                                  {workers.map((worker) => (
                                    <MenuItem key={worker.id} value={worker.id}>
                                      {worker.fullName}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              ) : (
                                workersById.get(entry.workerId)?.fullName ?? 'Unknown worker'
                              )}
                            </TableCell>

                            <TableCell sx={{ minWidth: 180 }}>
                              {isEditing ? (
                                <TextField
                                  select
                                  size="small"
                                  fullWidth
                                  value={entryEditForm.stageId}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('stageId', event.target.value)
                                  }
                                >
                                  <MenuItem value="">No stage selected</MenuItem>

                                  {stages.map((stage) => (
                                    <MenuItem key={stage.id} value={stage.id}>
                                      {stage.name}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              ) : entry.stageId ? (
                                stagesById.get(entry.stageId)?.name ?? 'Unknown stage'
                              ) : (
                                '-'
                              )}
                            </TableCell>

                            <TableCell sx={{ minWidth: 180 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  fullWidth
                                  value={entryEditForm.jobName}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('jobName', event.target.value)
                                  }
                                />
                              ) : (
                                entry.jobName
                              )}
                            </TableCell>

                            <TableCell align="right" sx={{ minWidth: 120 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ min: 0, step: 0.25 }}
                                  value={entryEditForm.hours}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('hours', event.target.value)
                                  }
                                />
                              ) : (
                                formatHours(entry.hours)
                              )}
                            </TableCell>

                            <TableCell align="right">{formatCurrency(rate)}</TableCell>
                            <TableCell align="right">{formatCurrency(cost)}</TableCell>

                            <TableCell sx={{ minWidth: 220 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  fullWidth
                                  value={entryEditForm.notes}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('notes', event.target.value)
                                  }
                                />
                              ) : (
                                entry.notes || '-'
                              )}
                            </TableCell>

                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              {isEditing ? (
                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                  <Button
                                    size="small"
                                    variant="contained"
                                    onClick={() => void handleSaveEditedEntry()}
                                  >
                                    Save
                                  </Button>
                                  <Button size="small" onClick={handleCancelEditEntry}>
                                    Cancel
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    onClick={() => void handleDeleteEntryRow(entry.id)}
                                  >
                                    Remove
                                  </Button>
                                </Stack>
                              ) : (
                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                  <Button size="small" onClick={() => handleStartEditEntry(entry)}>
                                    Edit
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    startIcon={<DeleteOutlineRoundedIcon />}
                                    onClick={() => void handleDeleteEntryRow(entry.id)}
                                  >
                                    Remove
                                  </Button>
                                </Stack>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {dateViewReadyByDateRows.length > 0 ? (
                <Stack spacing={1.25}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Job Ready % By Date
                  </Typography>

                  {dateViewReadyByDateRows.map((dateRow) => (
                    <Paper key={dateRow.date} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {dateRow.date}
                        </Typography>

                        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Order</TableCell>
                                <TableCell align="right">Ready %</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {dateRow.rows.map((row) => (
                                <TableRow key={`${dateRow.date}:${row.jobName}`} hover>
                                  <TableCell>{row.jobName}</TableCell>
                                  <TableCell align="right">
                                    {row.readyPercent === null
                                      ? '-'
                                      : `${row.readyPercent.toFixed(1)}%`}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : null}

          {activeTab === 4 ? (
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="subtitle1" fontWeight={700}>
                  Missing Worker Info
                </Typography>

                <TextField
                  select
                  label="Dates with missing info"
                  value={missingWorkersDate}
                  onChange={(event) => setMissingWorkersDate(event.target.value)}
                  sx={{ minWidth: 260 }}
                >
                  {missingInfoDates.length === 0 ? (
                    <MenuItem value="" disabled>
                      No dates with missing info
                    </MenuItem>
                  ) : null}

                  {missingInfoDates.map((date) => (
                    <MenuItem key={date} value={date}>
                      {date}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              {workers.length === 0 ? (
                <Alert severity="info">
                  Add workers first to track missing submissions.
                </Alert>
              ) : null}

              {workers.length > 0 && missingInfoDates.length === 0 ? (
                <Alert severity="info">
                  There are currently no dates with missing worker submissions.
                </Alert>
              ) : null}

              {workers.length > 0 && missingInfoDates.length > 0 ? (
                <Stack spacing={1.5}>
                  <Alert severity="warning">
                    Work was logged on {missingWorkersDate}. Review and approve each missing worker follow-up.
                  </Alert>

                  <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Worker ID</TableCell>
                          <TableCell>Worker Name</TableCell>
                          <TableCell>Note</TableCell>
                          <TableCell align="right">Approve</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {missingWorkersList.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <Typography color="text.secondary">No missing workers for the selected date.</Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          missingWorkersList.map((worker) => {
                            const reviewKey = getMissingReviewKey(worker.id)
                            const review = missingReviewByKey[reviewKey]
                            const approved = review?.approved === true

                            return (
                              <TableRow key={worker.id} hover>
                                <TableCell>{String(worker.workerNumber ?? '').trim() || '----'}</TableCell>
                                <TableCell>{worker.fullName}</TableCell>
                                <TableCell sx={{ minWidth: 320 }}>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    placeholder="Add note"
                                    value={review?.note ?? ''}
                                    onChange={(event) =>
                                      handleMissingWorkerNoteChange(worker.id, event.target.value)
                                    }
                                    onBlur={() => {
                                      void handleSaveMissingWorkerNote(worker.id)
                                    }}
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Button
                                    size="small"
                                    variant={approved ? 'outlined' : 'contained'}
                                    color={approved ? 'warning' : 'primary'}
                                    onClick={() => {
                                      if (approved) {
                                        void handleUnapproveMissingWorker(worker)
                                        return
                                      }

                                      void handleApproveMissingWorker(worker)
                                    }}
                                  >
                                    {approved ? 'Unapprove' : 'Approve'}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Box>
      </Paper>

      <Dialog
        open={stagesDialogOpen}
        onClose={() => setStagesDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Stages</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={700}>
              Add Stage
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
              <TextField
                fullWidth
                label="Stage name"
                value={stageNameInput}
                onChange={(event) => setStageNameInput(event.target.value)}
              />
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={handleAddStage}
                sx={{ minWidth: 130 }}
              >
                Add
              </Button>
            </Stack>

            <Divider />

            <Typography variant="subtitle1" fontWeight={700}>
              Existing Stages
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Drag a stage row and drop it on another row to change the dropdown order.
            </Typography>

            <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={90}>Drag</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography color="text.secondary">No stages yet.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    stages.map((stage) => (
                      <TableRow
                        key={stage.id}
                        hover
                        draggable={!isReorderingStages}
                        onDragStart={() => handleStageDragStart(stage.id)}
                        onDragEnd={handleStageDragEnd}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => void handleDropStage(stage.id)}
                        sx={{
                          cursor: isReorderingStages ? 'progress' : 'grab',
                          opacity: draggedStageId === stage.id ? 0.55 : 1,
                        }}
                      >
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            Drag
                          </Typography>
                        </TableCell>
                        <TableCell>{stage.name}</TableCell>
                        <TableCell align="right">
                          <Button
                            color="error"
                            size="small"
                            startIcon={<DeleteOutlineRoundedIcon />}
                            onClick={() => void handleRemoveStage(stage.id)}
                            disabled={isReorderingStages}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStagesDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={managerSheetOpen}
        onClose={closeManagerSheet}
        fullWidth
        maxWidth="xl"
      >
        <DialogTitle>Manager Progress - {bulkDate || todayIsoDate()}</DialogTitle>
        <DialogContent dividers>
          {managerProgressRows.length === 0 ? (
            <Typography color="text.secondary">
              No orders found for the selected date.
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Orders on date
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerProgressRows.length}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Average ready
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerProgressSummary.averageReadyPercent.toFixed(1)}%
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Fully ready
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerProgressSummary.completeCount}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    In progress
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerProgressSummary.inProgressCount}
                  </Typography>
                </Paper>
              </Stack>

              <Typography variant="subtitle1" fontWeight={700}>
                Daily Order Progress
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Order Number</TableCell>
                      <TableCell>Item</TableCell>
                      <TableCell>Shop Drawing</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Current ready %</TableCell>
                      <TableCell align="right">Set ready %</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {managerProgressRows.map((row) => (
                      <TableRow key={row.jobName} hover>
                        <TableCell>{row.mondayOrderId || row.jobName}</TableCell>
                        <TableCell>
                          {row.mondayItemName ? (
                            row.mondayItemName
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Not available
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.shopDrawingCachedUrl || (row.shopDrawingUrl && row.mondayOrderId) ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              onClick={() => {
                                handleOpenShopDrawingPreview(row)
                              }}
                            >
                              Preview
                            </Button>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Not available
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{formatHours(row.totalHours)}</TableCell>
                        <TableCell align="right">
                          {row.workerCount > 0 ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => {
                                handleOpenManagerWorkersPopup(row)
                              }}
                              sx={{
                                color: 'primary.main',
                                fontWeight: 700,
                                minWidth: 0,
                                p: 0,
                                textDecoration: 'underline',
                                '&:hover': {
                                  textDecoration: 'underline',
                                  backgroundColor: 'transparent',
                                },
                              }}
                            >
                              {row.workerCount}
                            </Button>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              0
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">{row.savedReadyPercent.toFixed(1)}%</TableCell>
                        <TableCell align="right" sx={{ width: 180 }}>
                          <TextField
                            size="small"
                            type="number"
                            value={row.editReadyPercent.toString()}
                            onChange={(event) =>
                              handleManagerProgressChange(row.jobName, event.target.value)
                            }
                            inputProps={{ min: 0, max: 100, step: 1 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={() => void handleSaveManagerProgress()}
            disabled={isSavingManagerProgress || managerProgressRows.length === 0}
          >
            {isSavingManagerProgress ? 'Saving...' : 'Save'}
          </Button>
          <Button onClick={closeManagerSheet}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(managerWorkersPopupRow)}
        onClose={handleCloseManagerWorkersPopup}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {managerWorkersPopupRow
            ? `Workers - ${managerWorkersPopupRow.mondayOrderId || managerWorkersPopupRow.jobName}`
            : 'Workers'}
        </DialogTitle>
        <DialogContent dividers>
          {!managerWorkersPopupRow || managerWorkersPopupRow.workerHoursByWorker.length === 0 ? (
            <Typography color="text.secondary">No workers found for this order.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Worker</TableCell>
                  <TableCell align="right">Hours</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {managerWorkersPopupRow.workerHoursByWorker.map((workerRow) => (
                  <TableRow key={workerRow.workerId}>
                    <TableCell>{workerRow.workerName}</TableCell>
                    <TableCell align="right">{formatHours(workerRow.hours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseManagerWorkersPopup}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(shopDrawingPreviewRow)}
        onClose={handleCloseShopDrawingPreview}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>
          {shopDrawingPreviewRow
            ? `Shop Drawing Preview - ${shopDrawingPreviewRow.jobName}`
            : 'Shop Drawing Preview'}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {shopDrawingPreviewSrc ? (
            <Box sx={{ height: { xs: '72vh', md: '80vh' }, position: 'relative' }}>
              {isShopDrawingPreviewLoading ? (
                <Stack
                  spacing={1}
                  alignItems="center"
                  justifyContent="center"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    bgcolor: 'rgba(255, 255, 255, 0.85)',
                    zIndex: 1,
                  }}
                >
                  <CircularProgress size={28} />
                  <Typography variant="body2" color="text.secondary">
                    Loading preview...
                  </Typography>
                </Stack>
              ) : null}
              <iframe
                key={shopDrawingPreviewSrc}
                src={shopDrawingPreviewSrc}
                title="Shop Drawing Preview"
                onLoad={() => {
                  setIsShopDrawingPreviewLoading(false)
                }}
                onError={() => {
                  setIsShopDrawingPreviewLoading(false)
                  setError('Could not load shop drawing preview.')
                }}
                style={{ width: '100%', height: '100%', border: 0 }}
              />
            </Box>
          ) : (
            <Stack sx={{ p: 2 }}>
              <Typography color="text.secondary">No preview is available.</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseShopDrawingPreview}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={jobDetailsOpen}
        onClose={() => setJobDetailsOpen(false)}
        fullWidth
        maxWidth="xl"
      >
        <DialogTitle>{selectedJobName || 'Job Details'}</DialogTitle>
        <DialogContent dividers>
          {!selectedJobSummary ? (
            <Typography color="text.secondary">No details found for this job.</Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total hours
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(selectedJobSummary.totalHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total cost
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatCurrency(selectedJobSummary.totalCost)}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Workers on this job
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {selectedJobWorkerCount}
                  </Typography>
                </Paper>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  select
                  size="small"
                  label="View"
                  value={jobDetailsGrouping}
                  onChange={(event) =>
                    setJobDetailsGrouping(event.target.value as 'entries' | 'stage')
                  }
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="entries">All entries</MenuItem>
                  <MenuItem value="stage">Group by stage</MenuItem>
                </TextField>

                <Button
                  variant="outlined"
                  startIcon={<FileDownloadRoundedIcon />}
                  onClick={exportSelectedJobToXlsx}
                  disabled={selectedJobExportRows.length === 0}
                >
                  Download XL
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadRoundedIcon />}
                  onClick={exportSelectedJobToCsv}
                  disabled={selectedJobExportRows.length === 0}
                >
                  Download CSV
                </Button>
              </Stack>

              <Typography variant="subtitle1" fontWeight={700}>
                Ready Percent By Date
              </Typography>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell align="right">Ready %</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedJobDateReadyRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2}>
                          <Typography color="text.secondary">No dates found for this job.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedJobDateReadyRows.map((row) => (
                        <TableRow key={row.date} hover>
                          <TableCell>{row.date}</TableCell>
                          <TableCell align="right">
                            {row.readyPercent === null ? '-' : `${row.readyPercent.toFixed(1)}%`}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Typography variant="subtitle1" fontWeight={700}>
                {jobDetailsGrouping === 'stage'
                  ? 'Entries Grouped By Stage'
                  : 'All Entries For This Job'}
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    {jobDetailsGrouping === 'stage' ? (
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Worker</TableCell>
                        <TableCell align="right">Hours</TableCell>
                        <TableCell align="right">Rate</TableCell>
                        <TableCell align="right">Cost</TableCell>
                        <TableCell>Notes</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Worker</TableCell>
                        <TableCell>Stage</TableCell>
                        <TableCell align="right">Hours</TableCell>
                        <TableCell align="right">Rate</TableCell>
                        <TableCell align="right">Cost</TableCell>
                        <TableCell>Notes</TableCell>
                      </TableRow>
                    )}
                  </TableHead>
                  <TableBody>
                    {jobDetailsGrouping === 'stage' ? (
                      selectedJobByStageRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography color="text.secondary">No entry rows for this job.</Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedJobByStageRows.flatMap((group) => {
                          const groupRows = group.entries.map((entry) => {
                            const worker = workersById.get(entry.workerId)
                            const rate = getEntryRate(entry, workersById)
                            const cost = entry.hours * rate

                            return (
                              <TableRow key={entry.id} hover>
                                <TableCell>{entry.date}</TableCell>
                                <TableCell>{worker?.fullName ?? 'Unknown worker'}</TableCell>
                                <TableCell align="right">{formatHours(entry.hours)}</TableCell>
                                <TableCell align="right">{formatCurrency(rate)}</TableCell>
                                <TableCell align="right">{formatCurrency(cost)}</TableCell>
                                <TableCell>{entry.notes || '-'}</TableCell>
                              </TableRow>
                            )
                          })

                          return [
                            <TableRow key={`${group.key}-header`} sx={{ bgcolor: 'action.hover' }}>
                              <TableCell colSpan={6}>
                                <Typography variant="subtitle2" fontWeight={700}>
                                  {group.stageName}
                                </Typography>
                              </TableCell>
                            </TableRow>,
                            ...groupRows,
                            <TableRow key={`${group.key}-summary`} sx={{ bgcolor: 'action.selected' }}>
                              <TableCell colSpan={2}>
                                <Typography variant="body2" fontWeight={700}>
                                  {group.stageName} summary
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Typography fontWeight={700}>{formatHours(group.totalHours)}</Typography>
                              </TableCell>
                              <TableCell />
                              <TableCell align="right">
                                <Typography fontWeight={700}>{formatCurrency(group.totalCost)}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color="text.secondary">
                                  {group.workerCount} workers
                                </Typography>
                              </TableCell>
                            </TableRow>,
                          ]
                        })
                      )
                    ) : selectedJobEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography color="text.secondary">No entry rows for this job.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedJobEntries.map((entry) => {
                        const worker = workersById.get(entry.workerId)
                        const rate = getEntryRate(entry, workersById)
                        const cost = entry.hours * rate

                        return (
                          <TableRow key={entry.id} hover>
                            <TableCell>{entry.date}</TableCell>
                            <TableCell>{worker?.fullName ?? 'Unknown worker'}</TableCell>
                            <TableCell>
                              {entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : '-'}
                            </TableCell>
                            <TableCell align="right">{formatHours(entry.hours)}</TableCell>
                            <TableCell align="right">{formatCurrency(rate)}</TableCell>
                            <TableCell align="right">{formatCurrency(cost)}</TableCell>
                            <TableCell>{entry.notes || '-'}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJobDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
