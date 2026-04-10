import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
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
import * as XLSX from 'xlsx'
import {
  createStage,
  createEntriesBulk,
  deleteEntry,
  deleteStage,
  fetchTimesheetState,
  reorderStages,
  type TimesheetEntry,
  type TimesheetStage,
  type TimesheetWorker,
  updateEntry,
} from '../features/timesheet/api'

type BulkWorkerRow = {
  id: string
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
  return new Date().toISOString().slice(0, 10)
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

function buildExportRows(
  entries: TimesheetEntry[],
  workersById: Map<string, TimesheetWorker>,
  stagesById: Map<string, TimesheetStage>,
) {
  return entries.map((entry) => {
    const worker = workersById.get(entry.workerId)
    const stageName = entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : 'Unassigned'
    const rate = worker?.hourlyRate ?? 0

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

function syncBulkRowsWithWorkers(
  currentRows: BulkWorkerRow[],
  workers: TimesheetWorker[],
) {
  const workerIds = new Set(workers.map((worker) => worker.id))
  const existingRows = currentRows.filter((row) => workerIds.has(row.workerId))
  const workerIdsWithRows = new Set(existingRows.map((row) => row.workerId))
  const missingRows = workers
    .filter((worker) => !workerIdsWithRows.has(worker.id))
    .map((worker) => createEmptyBulkRowForWorker(worker.id))

  return [...existingRows, ...missingRows]
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
    workerId,
    stageId,
    jobName: '',
    hours: '',
    notes: '',
  }
}

export default function TimesheetPage() {
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
  const [workerRangePreset, setWorkerRangePreset] =
    useState<WorkerRangePreset>('week')
  const [workerCustomStartDate, setWorkerCustomStartDate] = useState(todayIsoDate())
  const [workerCustomEndDate, setWorkerCustomEndDate] = useState(todayIsoDate())

  const refreshState = useCallback(async () => {
    setIsLoading(true)

    try {
      const payload = await fetchTimesheetState()

      setWorkers(payload.workers)
      setEntries(payload.entries)
      setStages(payload.stages)
      const stageIds = new Set(payload.stages.map((stage) => stage.id))
      setBulkRows((current) =>
        syncBulkRowsWithWorkers(current, payload.workers).map((row) =>
          row.stageId && !stageIds.has(row.stageId)
            ? {
                ...row,
                stageId: '',
              }
            : row,
        ),
      )
      setWorkerViewWorkerId((current) => {
        if (current && payload.workers.some((worker) => worker.id === current)) {
          return current
        }

        return payload.workers[0]?.id ?? ''
      })
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
        const workerRate = workersById.get(entry.workerId)?.hourlyRate ?? 0
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

      const workerRate = workersById.get(entry.workerId)?.hourlyRate ?? 0
      row.perDate[entry.date] = (row.perDate[entry.date] ?? 0) + entry.hours
      row.totalHours += entry.hours
      row.totalCost += entry.hours * workerRate
    })

    const rows = [...jobsMap.values()].sort(
      (left, right) => right.totalHours - left.totalHours,
    )

    return { dates, rows }
  }, [entries, workersById])

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
    const worker = workersById.get(workerViewWorkerId)
    const rate = worker?.hourlyRate ?? 0

    return workerFilteredEntries.reduce(
      (accumulator, entry) => {
        accumulator.totalHours += entry.hours
        accumulator.totalCost += entry.hours * rate
        return accumulator
      },
      { totalHours: 0, totalCost: 0 },
    )
  }, [workerFilteredEntries, workerViewWorkerId, workersById])

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

      const rate = workersById.get(entry.workerId)?.hourlyRate ?? 0
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
        const rate = workersById.get(entry.workerId)?.hourlyRate ?? 0
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

  const managerDayTotals = useMemo(() => {
    return managerDayEntries.reduce(
      (accumulator, entry) => {
        const rate = workersById.get(entry.workerId)?.hourlyRate ?? 0
        accumulator.totalHours += entry.hours
        accumulator.totalCost += entry.hours * rate
        return accumulator
      },
      { totalHours: 0, totalCost: 0 },
    )
  }, [managerDayEntries, workersById])

  const managerDayWorkerCount = useMemo(
    () => new Set(managerDayEntries.map((entry) => entry.workerId)).size,
    [managerDayEntries],
  )

  const managerDayByJobRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        jobName: string
        totalHours: number
        totalCost: number
        workerIds: Set<string>
      }
    >()

    managerDayEntries.forEach((entry) => {
      if (!grouped.has(entry.jobName)) {
        grouped.set(entry.jobName, {
          jobName: entry.jobName,
          totalHours: 0,
          totalCost: 0,
          workerIds: new Set(),
        })
      }

      const row = grouped.get(entry.jobName)

      if (!row) {
        return
      }

      const rate = workersById.get(entry.workerId)?.hourlyRate ?? 0
      row.totalHours += entry.hours
      row.totalCost += entry.hours * rate
      row.workerIds.add(entry.workerId)
    })

    return [...grouped.values()]
      .map((row) => ({
        jobName: row.jobName,
        totalHours: row.totalHours,
        totalCost: row.totalCost,
        workerCount: row.workerIds.size,
      }))
      .sort((left, right) => right.totalHours - left.totalHours)
  }, [managerDayEntries, workersById])

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
    if (managerSheetOpen && managerDayEntries.length === 0) {
      setManagerSheetOpen(false)
    }
  }, [managerDayEntries.length, managerSheetOpen])

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

  const handleRemoveBulkRowForWorker = (rowId: string) => {
    setBulkRows((current) => {
      const row = current.find((entry) => entry.id === rowId)

      if (!row) {
        return current
      }

      const workerRows = current.filter((entry) => entry.workerId === row.workerId)

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

    const rows = [] as Array<{
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

      rows.push({
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

    if (rows.length === 0) {
      setError('No valid rows to save. Fill job and hours for at least one worker.')
      return
    }

    try {
      const response = await createEntriesBulk(bulkDate, rows)
      setBulkRows((current) =>
        current.map((row) => ({
          ...row,
          jobName: '',
          hours: '',
          notes: '',
        })),
      )

      await refreshState()
      setSuccess(`Daily sheet saved. ${response.insertedCount} entries added.`)
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

  const openJobDetails = (jobName: string) => {
    setSelectedJobName(jobName)
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
    if (byJobExportRows.length === 0) {
      setError('No rows to export in View By Job.')
      return
    }

    const fileBaseName = `view-by-job-${todayIsoDate()}`
    exportRowsToXlsx(fileBaseName, byJobExportRows)
    setSuccess('View By Job exported to Excel.')
  }

  const exportByJobToCsv = () => {
    if (byJobExportRows.length === 0) {
      setError('No rows to export in View By Job.')
      return
    }

    const fileBaseName = `view-by-job-${todayIsoDate()}`
    exportRowsToCsv(fileBaseName, byJobExportRows)
    setSuccess('View By Job exported to CSV.')
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
        </Tabs>

        <Divider />

        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          {activeTab === 0 ? (
            <Stack spacing={2}>
             

              <TextField
                type="date"
                label="Date"
                value={bulkDate}
                onChange={(event) => setBulkDate(event.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 220 }}
              />

              <TableContainer
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  maxHeight: { xs: 420, md: 560 },
                }}
              >
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

                                {bulkRowCountByWorkerId.get(row.workerId) &&
                                (bulkRowCountByWorkerId.get(row.workerId) ?? 0) > 1 ? (
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => handleRemoveBulkRowForWorker(row.id)}
                                    title="Remove this extra line"
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

                {managerDayEntries.length > 0 ? (
                  <Button
                    variant="outlined"
                    startIcon={<OpenInNewRoundedIcon />}
                    onClick={() => setManagerSheetOpen(true)}
                  >
                    Manager Sheet ({managerDayEntries.length})
                  </Button>
                ) : null}
              </Stack>

              <Typography variant="body2" color="text.secondary">
                {managerDayEntries.length > 0
                  ? `Entries found for ${bulkDate}. Open Manager Sheet to review all orders for this date.`
                  : 'Manager Sheet appears after entries are submitted for the selected date.'}
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
                  Hours By Job And Date
                </Typography>

                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportByJobToXlsx}
                    disabled={byJobExportRows.length === 0}
                  >
                    Download XL
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadRoundedIcon />}
                    onClick={exportByJobToCsv}
                    disabled={byJobExportRows.length === 0}
                  >
                    Download CSV
                  </Button>
                </Stack>
              </Stack>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small" sx={{ minWidth: 880 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Job</TableCell>
                      {byJobView.dates.map((date) => (
                        <TableCell key={date} align="right">
                          {date}
                        </TableCell>
                      ))}
                      <TableCell align="right">Total hours</TableCell>
                      <TableCell align="right">Total cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {byJobView.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={byJobView.dates.length + 3}>
                          <Typography color="text.secondary">No entries yet.</Typography>
                        </TableCell>
                      </TableRow>
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

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
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

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
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
                        const worker = workersById.get(entry.workerId)
                        const rate = worker?.hourlyRate ?? 0
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

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small" sx={{ minWidth: 1080 }}>
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
                        const rate = workersById.get(activeWorkerId)?.hourlyRate ?? 0
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
        onClose={() => setManagerSheetOpen(false)}
        fullWidth
        maxWidth="xl"
      >
        <DialogTitle>Manager Sheet - {bulkDate || todayIsoDate()}</DialogTitle>
        <DialogContent dividers>
          {managerDayEntries.length === 0 ? (
            <Typography color="text.secondary">
              No submitted entries found for the selected date.
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Orders worked
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerDayByJobRows.length}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Workers submitted
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {managerDayWorkerCount}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total hours
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(managerDayTotals.totalHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Total cost
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatCurrency(managerDayTotals.totalCost)}
                  </Typography>
                </Paper>
              </Stack>

              <Typography variant="subtitle1" fontWeight={700}>
                Orders Worked On {bulkDate}
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Order</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {managerDayByJobRows.map((row) => (
                      <TableRow key={row.jobName} hover>
                        <TableCell>{row.jobName}</TableCell>
                        <TableCell align="right">{row.workerCount}</TableCell>
                        <TableCell align="right">{formatHours(row.totalHours)}</TableCell>
                        <TableCell align="right">{formatCurrency(row.totalCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Typography variant="subtitle1" fontWeight={700}>
                Submitted Rows
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Order</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {managerDayEntries.map((entry) => {
                      const worker = workersById.get(entry.workerId)
                      const rate = worker?.hourlyRate ?? 0
                      const cost = entry.hours * rate

                      return (
                        <TableRow key={entry.id} hover>
                          <TableCell>{worker?.fullName ?? 'Unknown worker'}</TableCell>
                          <TableCell>
                            {entry.stageId
                              ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage'
                              : '-'}
                          </TableCell>
                          <TableCell>{entry.jobName}</TableCell>
                          <TableCell align="right">{formatHours(entry.hours)}</TableCell>
                          <TableCell align="right">{formatCurrency(rate)}</TableCell>
                          <TableCell align="right">{formatCurrency(cost)}</TableCell>
                          <TableCell>{entry.notes || '-'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManagerSheetOpen(false)}>Close</Button>
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
                All Entries For This Job
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedJobEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography color="text.secondary">No entry rows for this job.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedJobEntries.map((entry) => {
                        const worker = workersById.get(entry.workerId)
                        const rate = worker?.hourlyRate ?? 0
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
