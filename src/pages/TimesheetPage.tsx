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
  Popover,
  Snackbar,
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
import {
  fetchMondayDashboardSnapshot,
  type DashboardOrder,
} from '../features/dashboard/api'
import {
  fetchQuickBooksOverview,
  type QuickBooksProjectSummary,
} from '../features/quickbooks/api'
import { useAuth } from '../auth/useAuth'
import {
  createStage,
  deleteEntry,
  deleteStage,
  fetchTimesheetState,
  upsertMissingWorkerReview,
  upsertOrderProgress,
  reorderStages,
  syncDailyEntries,
  type TimesheetEntry,
  type TimesheetOrderProgress,
  type TimesheetStage,
  type TimesheetWorker,
  updateEntry,
} from '../features/timesheet/api'
import {
  OVERTIME_RATE_MULTIPLIER,
  addDaysToIsoDate,
  buildBulkRowsForDate,
  buildByJobExportRows,
  buildByStageExportRows,
  buildExportRows,
  buildMissingReviewMap,
  compareDateDesc,
  createEmptyBulkRowForWorker,
  exportRowsToCsv,
  exportRowsToXlsx,
  extractDigits,
  fileNamePart,
  formatCurrency,
  formatHours,
  formatManagerDateLabel,
  formatMonthKeyLabel,
  getEntryCost,
  getEntryOvertimeHours,
  getEntryRate,
  getEntryTotalHours,
  isDateInRange,
  monthKeyFromIsoDate,
  normalizeJobName,
  reorderStageList,
  todayIsoDate,
  type BulkWorkerRow,
  type MissingWorkerReview,
} from './timesheet/utils'
import {
  buildDailySheetSyncRows,
  formatDailySheetSaveMessage,
  hasEntriesForDate,
} from './timesheet/dailySheetSync'

type WorkerRangePreset = 'week' | 'month' | 'year' | 'custom'

type EntryEditForm = {
  date: string
  workerId: string
  stageId: string
  jobName: string
  hours: string
  overtimeHours: string
  notes: string
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
  initialView?: 'timesheet' | 'reports'
}

type QuickBooksJobMetrics = {
  purchaseOrderAmount: number
  billAmount: number
  invoiceAmount: number
  paymentAmount: number
}

const WORKSHEET_TABLE_CONTAINER_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  maxHeight: { xs: 420, md: 560 },
} as const

export default function TimesheetPage({ initialView = 'timesheet' }: TimesheetPageProps) {
  const { appUser } = useAuth()
  const canAccessManagerSheet = appUser?.isManager === true || appUser?.isAdmin === true
  const isReportsView = initialView === 'reports'
  const [worksheetTab, setWorksheetTab] = useState(0)
  const [reportsTab, setReportsTab] = useState(0)
  const [workers, setWorkers] = useState<TimesheetWorker[]>([])
  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [stages, setStages] = useState<TimesheetStage[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [toastState, setToastState] = useState<{
    open: boolean
    severity: 'success' | 'error'
    message: string
  }>({
    open: false,
    severity: 'success',
    message: '',
  })
  const [isLoading, setIsLoading] = useState(true)

  const [stagesDialogOpen, setStagesDialogOpen] = useState(false)
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false)
  const [selectedJobName, setSelectedJobName] = useState('')
  const [stageNameInput, setStageNameInput] = useState('')
  const [draggedStageId, setDraggedStageId] = useState('')
  const [isReorderingStages, setIsReorderingStages] = useState(false)
  const [bulkDate, setBulkDate] = useState(todayIsoDate())
  const [managerSelectedMonth, setManagerSelectedMonth] = useState('')
  const [managerSelectedDate, setManagerSelectedDate] = useState('')
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
    overtimeHours: '',
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
  const [quickBooksProjects, setQuickBooksProjects] = useState<QuickBooksProjectSummary[]>([])
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
  const [profitInfoAnchorEl, setProfitInfoAnchorEl] = useState<HTMLElement | null>(null)
  const [profitInfoPopup, setProfitInfoPopup] = useState<{
    jobName: string
    status: 'red' | 'yellow'
    currentProfit: number
    projectedProfitAfterFullBilling: number
    remainingToBillAmount: number
  } | null>(null)
  const [readyInfoAnchorEl, setReadyInfoAnchorEl] = useState<HTMLElement | null>(null)
  const [readyInfoPopup, setReadyInfoPopup] = useState<{
    jobName: string
    requiredReadyDate: string | null
    lastWrittenDate: string | null
  } | null>(null)

  const handleCloseProfitInfoPopup = useCallback(() => {
    setProfitInfoAnchorEl(null)
    setProfitInfoPopup(null)
  }, [])

  const handleCloseReadyInfoPopup = useCallback(() => {
    setReadyInfoAnchorEl(null)
    setReadyInfoPopup(null)
  }, [])

  const splitQuickBooksProjectLabel = useCallback((projectName: string, fallbackProjectId: string) => {
    const normalizedName = String(projectName || '').trim()

    if (!normalizedName) {
      return {
        projectNumber: fallbackProjectId || '',
      }
    }

    const hasColonSeparator = normalizedName.includes(':')
    const hasHyphenSeparator = normalizedName.includes(' - ')
    const segments = hasColonSeparator
      ? normalizedName.split(':').map((segment) => segment.trim()).filter(Boolean)
      : hasHyphenSeparator
        ? normalizedName.split(' - ').map((segment) => segment.trim()).filter(Boolean)
        : [normalizedName]

    if (segments.length <= 1) {
      return {
        projectNumber: segments[0] || fallbackProjectId || '',
      }
    }

    return {
      projectNumber: segments[segments.length - 1] || fallbackProjectId || '',
    }
  }, [])

  useEffect(() => {
    if (!canAccessManagerSheet && worksheetTab === 1) {
      setWorksheetTab(0)
    }
  }, [canAccessManagerSheet, worksheetTab])

  const refreshState = useCallback(async () => {
    setIsLoading(true)

    try {
      const payload = await fetchTimesheetState()

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
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load timesheet data from backend.'
      setError(message)
    } finally {
      setIsLoading(false)
    }

    // Monday snapshot loads in background — doesn't block the page
    fetchMondayDashboardSnapshot()
      .then((result) => {
        setMondayOrders(Array.isArray(result.orders) ? result.orders : [])
      })
      .catch(() => {})

    if (!canAccessManagerSheet) {
      setQuickBooksProjects([])
      return
    }

    fetchQuickBooksOverview()
      .then((result) => {
        setQuickBooksProjects(Array.isArray(result.projects) ? result.projects : [])
      })
      .catch(() => {
        setQuickBooksProjects([])
      })
  }, [canAccessManagerSheet])

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
        const totalHours = getEntryTotalHours(entry)
        const cost = getEntryCost(entry, workersById)

        return {
          totalHours: accumulator.totalHours + totalHours,
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

      const totalHours = getEntryTotalHours(entry)
      row.perDate[entry.date] = (row.perDate[entry.date] ?? 0) + totalHours
      row.totalHours += totalHours
      row.totalCost += getEntryCost(entry, workersById)
    })

    const rows = [...jobsMap.values()].sort(
      (left, right) => right.totalHours - left.totalHours,
    )

    return { dates, rows }
  }, [entries, workersById])

  const quickBooksMetricsByJobKey = useMemo(() => {
    const map = new Map<string, QuickBooksJobMetrics>()

    quickBooksProjects.forEach((project) => {
      const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId)
      const jobKey = normalizeJobName(splitLabel.projectNumber)

      if (!jobKey) {
        return
      }

      const purchaseOrderAmount = Number(project.purchaseOrderAmount)
      const billAmount = Number(project.billAmount)
      const invoiceAmount = Number(project.invoiceAmount)
      const paymentAmount = Number(project.paymentAmount)
      const normalizedPurchaseOrderAmount = Number.isFinite(purchaseOrderAmount)
        ? purchaseOrderAmount
        : 0
      const normalizedBillAmount = Number.isFinite(billAmount)
        ? billAmount
        : 0
      const normalizedInvoiceAmount = Number.isFinite(invoiceAmount)
        ? invoiceAmount
        : 0
      const normalizedPaymentAmount = Number.isFinite(paymentAmount)
        ? paymentAmount
        : 0
      const existing = map.get(jobKey) ?? {
        purchaseOrderAmount: 0,
        billAmount: 0,
        invoiceAmount: 0,
        paymentAmount: 0,
      }

      const nextPurchaseOrderAmount = existing.purchaseOrderAmount + normalizedPurchaseOrderAmount
      const nextBillAmount = existing.billAmount + normalizedBillAmount
      const nextInvoiceAmount = existing.invoiceAmount + normalizedInvoiceAmount
      const nextPaymentAmount = existing.paymentAmount + normalizedPaymentAmount

      map.set(jobKey, {
        purchaseOrderAmount: Number(nextPurchaseOrderAmount.toFixed(2)),
        billAmount: Number(nextBillAmount.toFixed(2)),
        invoiceAmount: Number(nextInvoiceAmount.toFixed(2)),
        paymentAmount: Number(nextPaymentAmount.toFixed(2)),
      })
    })

    return map
  }, [quickBooksProjects, splitQuickBooksProjectLabel])

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

      const totalHours = getEntryTotalHours(entry)
      row.perDate[entry.date] = (row.perDate[entry.date] ?? 0) + totalHours
      row.totalHours += totalHours
      row.totalCost += getEntryCost(entry, workersById)
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

      row.entries.push(entry)
      row.totalHours += getEntryTotalHours(entry)
      row.totalCost += getEntryCost(entry, workersById)
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
        accumulator.totalHours += getEntryTotalHours(entry)
        accumulator.totalCost += getEntryCost(entry, workersById)
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

      row.totalHours += getEntryTotalHours(entry)
      row.totalCost += getEntryCost(entry, workersById)
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
        accumulator.totalHours += getEntryTotalHours(entry)
        accumulator.totalCost += getEntryCost(entry, workersById)
        return accumulator
      },
      { totalHours: 0, totalCost: 0 },
    )
  }, [dateViewEntries, workersById])

  const managerAvailableDates = useMemo(() => {
    const dates = new Set<string>()

    entries.forEach((entry) => {
      const date = String(entry.date ?? '').trim()

      if (date) {
        dates.add(date)
      }
    })

    orderProgress.forEach((progress) => {
      const date = String(progress.date ?? '').trim()

      if (date) {
        dates.add(date)
      }
    })

    return [...dates].sort(compareDateDesc)
  }, [entries, orderProgress])

  const managerDatesByMonth = useMemo(() => {
    const map = new Map<string, string[]>()

    managerAvailableDates.forEach((date) => {
      const monthKey = monthKeyFromIsoDate(date)

      if (!monthKey) {
        return
      }

      if (!map.has(monthKey)) {
        map.set(monthKey, [])
      }

      map.get(monthKey)?.push(date)
    })

    return map
  }, [managerAvailableDates])

  const managerMonthOptions = useMemo(
    () => [...managerDatesByMonth.keys()].sort((left, right) => right.localeCompare(left)),
    [managerDatesByMonth],
  )

  const managerDatesInSelectedMonth = useMemo(
    () => managerDatesByMonth.get(managerSelectedMonth) ?? [],
    [managerDatesByMonth, managerSelectedMonth],
  )

  const managerDayEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.date === managerSelectedDate),
    [managerSelectedDate, sortedEntries],
  )

  const orderProgressByDateJobKey = useMemo(() => {
    const map = new Map<string, TimesheetOrderProgress>()

    orderProgress.forEach((progress) => {
      const key = `${progress.date}:${normalizeJobName(progress.jobName)}`
      map.set(key, progress)
    })

    return map
  }, [orderProgress])

  const latestReadyByJobKey = useMemo(() => {
    const map = new Map<string, { readyPercent: number; date: string }>()

    orderProgress.forEach((progress) => {
      const jobKey = normalizeJobName(progress.jobName)
      const progressDate = String(progress.date ?? '').trim()

      if (!jobKey || !progressDate) {
        return
      }

      const existing = map.get(jobKey)

      if (!existing || progressDate > existing.date) {
        map.set(jobKey, {
          readyPercent: Number(progress.readyPercent),
          date: progressDate,
        })
      }
    })

    return map
  }, [orderProgress])

  const latestDueWorksheetDateByJobKey = useMemo(() => {
    const map = new Map<string, string>()
    const yesterdayIsoDate = addDaysToIsoDate(todayIsoDate(), -1)

    entries.forEach((entry) => {
      const jobKey = normalizeJobName(entry.jobName)
      const entryDate = String(entry.date ?? '').trim()

      if (!jobKey || !entryDate || entryDate > yesterdayIsoDate) {
        return
      }

      const existingDate = map.get(jobKey) ?? ''

      if (!existingDate || entryDate > existingDate) {
        map.set(jobKey, entryDate)
      }
    })

    return map
  }, [entries])

  const managerDayJobs = useMemo(() => {
    const jobNames = new Set<string>()

    managerDayEntries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    orderProgress.forEach((progress) => {
      if (progress.date !== managerSelectedDate) {
        return
      }

      const jobName = String(progress.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    return [...jobNames].sort((left, right) => left.localeCompare(right))
  }, [managerDayEntries, managerSelectedDate, orderProgress])

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

      const totalHours = getEntryTotalHours(entry)
      existing.totalHours += totalHours
      existing.workerIds.add(entry.workerId)
      existing.workerHoursById.set(
        entry.workerId,
        (existing.workerHoursById.get(entry.workerId) ?? 0) + totalHours,
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
      const progressKey = `${managerSelectedDate}:${jobKey}`
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
    managerDayEntries,
    managerDayJobs,
    managerProgressByJob,
    managerSelectedDate,
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
    if (managerAvailableDates.length === 0) {
      if (managerSelectedMonth) {
        setManagerSelectedMonth('')
      }

      if (managerSelectedDate) {
        setManagerSelectedDate('')
      }

      return
    }

    const fallbackDate = managerAvailableDates[0]
    const nextCandidateDate = managerAvailableDates.includes(managerSelectedDate)
      ? managerSelectedDate
      : fallbackDate
    const impliedMonth = monthKeyFromIsoDate(nextCandidateDate)
    const nextMonth = managerMonthOptions.includes(managerSelectedMonth)
      ? managerSelectedMonth
      : impliedMonth
    const datesInMonth = managerDatesByMonth.get(nextMonth) ?? []
    const nextDate = datesInMonth.includes(nextCandidateDate)
      ? nextCandidateDate
      : (datesInMonth[0] ?? fallbackDate)

    if (managerSelectedMonth !== nextMonth) {
      setManagerSelectedMonth(nextMonth)
    }

    if (managerSelectedDate !== nextDate) {
      setManagerSelectedDate(nextDate)
    }
  }, [
    managerAvailableDates,
    managerDatesByMonth,
    managerMonthOptions,
    managerSelectedDate,
    managerSelectedMonth,
  ])

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
    if (!success) {
      return
    }

    setToastState({
      open: true,
      severity: 'success',
      message: success,
    })
  }, [success])

  useEffect(() => {
    if (!error) {
      return
    }

    setToastState({
      open: true,
      severity: 'error',
      message: error,
    })
  }, [error])

  useEffect(() => {
    const nextDraftByJob: Record<string, string> = {}

    managerDayJobs.forEach((jobName) => {
      const key = `${managerSelectedDate}:${normalizeJobName(jobName)}`
      const progress = orderProgressByDateJobKey.get(key)
      nextDraftByJob[jobName] = progress ? String(progress.readyPercent) : '0'
    })

    setManagerProgressByJob(nextDraftByJob)
  }, [managerDayJobs, managerSelectedDate, orderProgressByDateJobKey])

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

    const { invalidWorkers, syncRows } = buildDailySheetSyncRows(
      bulkRows,
      workersById,
    )

    if (invalidWorkers.length > 0) {
      setError(`Some rows are invalid. Fix: ${invalidWorkers.join(', ')}`)
      return
    }

    if (syncRows.length === 0 && !hasEntriesForDate(entries, bulkDate)) {
      setError('No valid rows to save. Fill job and regular or overtime hours for at least one worker.')
      return
    }

    try {
      const response = await syncDailyEntries(bulkDate, syncRows)

      await refreshState()
      setSuccess(formatDailySheetSaveMessage(response))
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
      overtimeHours: String(entry.overtimeHours ?? ''),
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
    const overtimeHours = Number(entryEditForm.overtimeHours)

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

    if (!Number.isFinite(hours) || hours < 0 || !Number.isFinite(overtimeHours) || overtimeHours < 0) {
      setError('Regular and overtime hours must be non-negative numbers.')
      return
    }

    if (hours <= 0 && overtimeHours <= 0) {
      setError('Regular hours or overtime hours must be greater than zero.')
      return
    }

    try {
      await updateEntry(editingEntryId, {
        date,
        workerId,
        stageId,
        jobName,
        hours,
        overtimeHours,
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

  const handleCloseToast = useCallback(() => {
    setToastState((current) => ({
      ...current,
      open: false,
    }))
  }, [])

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

  const handleSelectManagerMonth = useCallback((nextMonth: string) => {
    setManagerSelectedMonth(nextMonth)

    const monthDates = managerDatesByMonth.get(nextMonth) ?? []

    if (monthDates.length > 0) {
      setManagerSelectedDate(monthDates[0])
    }
  }, [managerDatesByMonth])

  const handleSelectManagerDate = useCallback((nextDate: string) => {
    setManagerSelectedDate(nextDate)

    const nextMonth = monthKeyFromIsoDate(nextDate)

    if (nextMonth && nextMonth !== managerSelectedMonth) {
      setManagerSelectedMonth(nextMonth)
    }
  }, [managerSelectedMonth])

  const handleManagerProgressChange = (jobName: string, value: string) => {
    setManagerProgressByJob((current) => ({
      ...current,
      [jobName]: value,
    }))
  }

  const handleSaveManagerProgress = async () => {
    setError('')
    setSuccess('')

    if (!managerSelectedDate) {
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
            date: managerSelectedDate,
            jobName,
            readyPercent: Number(String(managerProgressByJob[jobName] ?? '').trim()),
          }),
        ),
      )

      await refreshState()
      setSuccess(`Manager progress saved for ${managerSelectedDate}.`)
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
    <Stack spacing={isReportsView ? 1.5 : 2.5}>
      {!isReportsView ? (
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
              Daily bulk sheet and worksheet management.
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
      ) : null}

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

      <Paper variant="outlined">
        <Tabs
          value={isReportsView ? reportsTab : worksheetTab}
          variant="scrollable"
          scrollButtons="auto"
        >
          {isReportsView ? (
            <>
              <Tab label="Summary" value={0} onClick={() => setReportsTab(0)} />
              <Tab label="View By Job" value={1} onClick={() => setReportsTab(1)} />
              <Tab label="View By Worker" value={2} onClick={() => setReportsTab(2)} />
              <Tab label="View By Date" value={3} onClick={() => setReportsTab(3)} />
            </>
          ) : (
            <>
              <Tab label="Daily Sheet" value={0} onClick={() => setWorksheetTab(0)} />
              {canAccessManagerSheet ? (
                <Tab label="Manager Progress" value={1} onClick={() => setWorksheetTab(1)} />
              ) : null}
              <Tab label="Missing Worker Info" value={2} onClick={() => setWorksheetTab(2)} />
            </>
          )}
        </Tabs>

        <Divider />

        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          {!isReportsView && worksheetTab === 0 ? (
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
                <Table size="small" stickyHeader sx={{ minWidth: 980 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Overtime</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bulkRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6}>
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
                            <TableCell align="right" sx={{ minWidth: 140 }}>
                              <TextField
                                size="small"
                                fullWidth
                                type="number"
                                inputProps={{ min: 0, step: 0.25 }}
                                placeholder="0"
                                value={row.overtimeHours}
                                onChange={(event) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'overtimeHours',
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
              </Stack>

              <Typography variant="body2" color="text.secondary">
                {!canAccessManagerSheet
                  ? 'Manager Progress tab is available for manager or admin accounts only.'
                  : 'Use the Manager Progress tab to update ready percentages by date.'}
              </Typography>
            </Stack>
          ) : null}

          {!isReportsView && canAccessManagerSheet && worksheetTab === 1 ? (
            <Stack spacing={2}>
              {managerAvailableDates.length === 0 ? (
                <Typography color="text.secondary">
                  No manager progress dates are available yet. Add worksheet entries first.
                </Typography>
              ) : (
                <>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', md: 'center' }}
                    useFlexGap
                    flexWrap="wrap"
                  >
                    <TextField
                      select
                      size="small"
                      label="Month"
                      value={managerSelectedMonth}
                      onChange={(event) => handleSelectManagerMonth(event.target.value)}
                      sx={{ minWidth: 220 }}
                    >
                      {managerMonthOptions.map((month) => (
                        <MenuItem key={month} value={month}>
                          {formatMonthKeyLabel(month)}
                        </MenuItem>
                      ))}
                    </TextField>

                    <TextField
                      select
                      size="small"
                      label="Date"
                      value={managerSelectedDate}
                      onChange={(event) => handleSelectManagerDate(event.target.value)}
                      sx={{ minWidth: 240 }}
                    >
                      {managerDatesInSelectedMonth.map((dateValue) => (
                        <MenuItem key={dateValue} value={dateValue}>
                          {formatManagerDateLabel(dateValue)}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>

                  {managerProgressRows.length === 0 ? (
                    <Typography color="text.secondary">
                      No orders found for {managerSelectedDate || 'the selected date'}.
                    </Typography>
                  ) : (
                    <>
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

                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          variant="contained"
                          onClick={() => void handleSaveManagerProgress()}
                          disabled={isSavingManagerProgress || managerProgressRows.length === 0}
                        >
                          {isSavingManagerProgress ? 'Saving...' : 'Save'}
                        </Button>
                      </Stack>

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
                    </>
                  )}
                </>
              )}
            </Stack>
          ) : null}

          {isReportsView && reportsTab === 0 ? (
            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={700}>
                Report Summary
              </Typography>

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
            </Stack>
          ) : null}

          {isReportsView && reportsTab === 1 ? (
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="subtitle1" fontWeight={700}>
                  {byJobGrouping === 'stage' ? 'Hours By Stage And Date' : 'Hours By Job'}
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
                      {byJobGrouping === 'stage'
                        ? byStageView.dates.map((date) => (
                          <TableCell key={date} align="right">
                            {date}
                          </TableCell>
                        ))
                        : null}
                      {byJobGrouping === 'stage' ? (
                        <>
                          <TableCell align="right">Total hours</TableCell>
                          <TableCell align="right">Total cost</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell align="right">PO Amount</TableCell>
                          <TableCell align="right">Bills Amount</TableCell>
                          <TableCell align="right">Invoice Amount</TableCell>
                          <TableCell align="right">Paid?</TableCell>
                          <TableCell align="right">Profit</TableCell>
                          <TableCell align="right">Ready %</TableCell>
                          <TableCell align="right">Total hours</TableCell>
                          <TableCell align="right">Total cost</TableCell>
                        </>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(byJobGrouping === 'stage' ? byStageView.rows : byJobView.rows).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={
                            byJobGrouping === 'stage'
                              ? byStageView.dates.length + 3
                              : 9
                          }
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

                          {(() => {
                            const jobKey = normalizeJobName(row.jobName)
                            const jobMetrics = quickBooksMetricsByJobKey.get(jobKey)
                            const purchaseOrderAmount = jobMetrics?.purchaseOrderAmount ?? 0
                            const billAmount = jobMetrics?.billAmount ?? 0
                            const invoiceAmount = jobMetrics?.invoiceAmount ?? 0
                            const paymentAmount = jobMetrics?.paymentAmount ?? 0
                            const latestReady = latestReadyByJobKey.get(jobKey)
                            const latestReadyPercent = latestReady?.readyPercent ?? null
                            const lastWrittenDate = latestReady?.date ?? null
                            const requiredReadyDate = latestDueWorksheetDateByJobKey.get(jobKey) ?? null
                            const hasRequiredReadyUpdate = requiredReadyDate
                              ? orderProgressByDateJobKey.has(`${requiredReadyDate}:${jobKey}`)
                              : true
                            const readyColor: 'error.main' | 'success.main' =
                              hasRequiredReadyUpdate
                                ? 'success.main'
                                : 'error.main'
                            const hasInvoice = invoiceAmount > 0
                            const isPaid = hasInvoice && paymentAmount + 0.01 >= invoiceAmount
                            const isFullyBilled = Math.abs(purchaseOrderAmount - billAmount) <= 0.01
                            const profitAmount = invoiceAmount - billAmount - row.totalCost
                            const projectedProfitAfterFullBilling =
                              invoiceAmount - purchaseOrderAmount - row.totalCost
                            const remainingToBillAmount = Math.max(0, purchaseOrderAmount - billAmount)
                            const profitStatus: 'red' | 'yellow' | 'green' =
                              isFullyBilled
                                ? (isPaid ? 'green' : 'yellow')
                                : 'red'
                            const profitColor: 'error.main' | 'warning.main' | 'success.main' =
                              isFullyBilled
                                ? (isPaid ? 'success.main' : 'warning.main')
                                : 'error.main'

                            return (
                              <>
                                <TableCell align="right">
                                  <Typography fontWeight={700}>
                                    {formatCurrency(purchaseOrderAmount)}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography fontWeight={700}>
                                    {formatCurrency(billAmount)}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography fontWeight={700}>
                                    {hasInvoice ? formatCurrency(invoiceAmount) : '-'}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography
                                    fontWeight={700}
                                    color={
                                      !hasInvoice
                                        ? 'text.secondary'
                                        : isPaid
                                          ? 'success.main'
                                          : paymentAmount > 0
                                            ? 'warning.main'
                                            : 'error.main'
                                    }
                                  >
                                    {!hasInvoice
                                      ? '-'
                                      : isPaid
                                        ? 'Yes'
                                        : paymentAmount > 0
                                          ? `Partial (${formatCurrency(paymentAmount)})`
                                          : 'No'}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography
                                    fontWeight={700}
                                    color={profitColor}
                                    onClick={
                                      profitStatus === 'green'
                                        ? undefined
                                        : (event) => {
                                          setProfitInfoAnchorEl(event.currentTarget)
                                          setProfitInfoPopup({
                                            jobName: row.jobName,
                                            status: profitStatus,
                                            currentProfit: Number(profitAmount.toFixed(2)),
                                            projectedProfitAfterFullBilling: Number(
                                              projectedProfitAfterFullBilling.toFixed(2),
                                            ),
                                            remainingToBillAmount: Number(
                                              remainingToBillAmount.toFixed(2),
                                            ),
                                          })
                                        }
                                    }
                                    sx={
                                      profitStatus === 'green'
                                        ? undefined
                                        : {
                                          cursor: 'pointer',
                                          textDecoration: 'underline',
                                          textUnderlineOffset: '2px',
                                        }
                                    }
                                  >
                                    {formatCurrency(profitAmount)}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography
                                    fontWeight={700}
                                    color={readyColor}
                                    onClick={
                                      hasRequiredReadyUpdate
                                        ? undefined
                                        : (event) => {
                                          setReadyInfoAnchorEl(event.currentTarget)
                                          setReadyInfoPopup({
                                            jobName: row.jobName,
                                            requiredReadyDate,
                                            lastWrittenDate,
                                          })
                                        }
                                    }
                                    sx={
                                      hasRequiredReadyUpdate
                                        ? undefined
                                        : {
                                          cursor: 'pointer',
                                          textDecoration: 'underline',
                                          textUnderlineOffset: '2px',
                                        }
                                    }
                                  >
                                    {Number.isFinite(latestReadyPercent ?? NaN)
                                      ? `${Number(latestReadyPercent).toFixed(1)}%`
                                      : '-'}
                                  </Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography fontWeight={700}>{formatHours(row.totalHours)}</Typography>
                                </TableCell>

                                <TableCell align="right">
                                  <Typography fontWeight={700}>{formatCurrency(row.totalCost)}</Typography>
                                </TableCell>
                              </>
                            )
                          })()}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ) : null}

          {isReportsView && reportsTab === 2 ? (
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
                        const cost = getEntryCost(entry, workersById)

                        return (
                          <TableRow key={entry.id} hover>
                            <TableCell>{entry.date}</TableCell>
                            <TableCell>
                              {entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : '-'}
                            </TableCell>
                            <TableCell>{entry.jobName}</TableCell>
                            <TableCell align="right">{formatHours(getEntryTotalHours(entry))}</TableCell>
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

          {isReportsView && reportsTab === 3 ? (
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
                <Table size="small" stickyHeader sx={{ minWidth: 1200 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Worker</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Job</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Overtime</TableCell>
                      <TableCell align="right">Rate</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell>Notes</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dateViewEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <Typography color="text.secondary">
                            No entries in the selected date range.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      dateViewEntries.map((entry) => {
                        const isEditing = editingEntryId === entry.id
                        const activeWorkerId = isEditing ? entryEditForm.workerId : entry.workerId
                        const rawRegularHours = isEditing ? Number(entryEditForm.hours) : Number(entry.hours)
                        const regularHours = Number.isFinite(rawRegularHours) ? rawRegularHours : 0
                        const rawOvertimeHours = isEditing
                          ? Number(entryEditForm.overtimeHours)
                          : Number(entry.overtimeHours ?? 0)
                        const overtimeHours = Number.isFinite(rawOvertimeHours) ? rawOvertimeHours : 0
                        const totalHours = regularHours + overtimeHours
                        const rate = isEditing
                          ? workersById.get(activeWorkerId)?.hourlyRate ?? 0
                          : getEntryRate(entry, workersById)
                        const cost = (regularHours * rate) + (overtimeHours * rate * OVERTIME_RATE_MULTIPLIER)

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
                                formatHours(totalHours)
                              )}
                            </TableCell>

                            <TableCell align="right" sx={{ minWidth: 120 }}>
                              {isEditing ? (
                                <TextField
                                  size="small"
                                  type="number"
                                  inputProps={{ min: 0, step: 0.25 }}
                                  value={entryEditForm.overtimeHours}
                                  onChange={(event) =>
                                    handleEditEntryFieldChange('overtimeHours', event.target.value)
                                  }
                                />
                              ) : (
                                formatHours(getEntryOvertimeHours(entry))
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

          <Popover
            open={Boolean(profitInfoAnchorEl) && Boolean(profitInfoPopup)}
            anchorEl={profitInfoAnchorEl}
            onClose={handleCloseProfitInfoPopup}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          >
            <Stack spacing={0.8} sx={{ p: 1.5, maxWidth: 360 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {profitInfoPopup?.jobName ? `${profitInfoPopup.jobName} Profit` : 'Profit'}
              </Typography>

              {profitInfoPopup?.status === 'red' ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Red means not all PO amount has been billed yet.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Remaining to bill: {formatCurrency(profitInfoPopup.remainingToBillAmount)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Current profit: {formatCurrency(profitInfoPopup.currentProfit)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Profit after full PO billing: {formatCurrency(profitInfoPopup.projectedProfitAfterFullBilling)}
                  </Typography>
                </>
              ) : profitInfoPopup?.status === 'yellow' ? (
                <Typography variant="body2" color="text.secondary">
                  Yellow means billing is complete, but payment is still pending.
                </Typography>
              ) : null}
            </Stack>
          </Popover>

          <Popover
            open={Boolean(readyInfoAnchorEl) && Boolean(readyInfoPopup)}
            anchorEl={readyInfoAnchorEl}
            onClose={handleCloseReadyInfoPopup}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          >
            <Stack spacing={0.8} sx={{ p: 1.5, maxWidth: 360 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {readyInfoPopup?.jobName ? `${readyInfoPopup.jobName} Ready %` : 'Ready %'}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Red means the manager has not updated Ready % for the latest worksheet date that now requires an update.
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Latest worksheet date requiring update:{' '}
                {readyInfoPopup?.requiredReadyDate
                  ? formatManagerDateLabel(readyInfoPopup.requiredReadyDate)
                  : 'Not available'}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Last Ready % written:{' '}
                {readyInfoPopup?.lastWrittenDate
                  ? formatManagerDateLabel(readyInfoPopup.lastWrittenDate)
                  : 'Never'}
              </Typography>
            </Stack>
          </Popover>

          {!isReportsView && worksheetTab === 2 ? (
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
                            const cost = getEntryCost(entry, workersById)

                            return (
                              <TableRow key={entry.id} hover>
                                <TableCell>{entry.date}</TableCell>
                                <TableCell>{worker?.fullName ?? 'Unknown worker'}</TableCell>
                                <TableCell align="right">{formatHours(getEntryTotalHours(entry))}</TableCell>
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
                        const cost = getEntryCost(entry, workersById)

                        return (
                          <TableRow key={entry.id} hover>
                            <TableCell>{entry.date}</TableCell>
                            <TableCell>{worker?.fullName ?? 'Unknown worker'}</TableCell>
                            <TableCell>
                              {entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : '-'}
                            </TableCell>
                            <TableCell align="right">{formatHours(getEntryTotalHours(entry))}</TableCell>
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

      <Snackbar
        open={toastState.open}
        autoHideDuration={3500}
        onClose={handleCloseToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={handleCloseToast}
          severity={toastState.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toastState.message}
        </Alert>
      </Snackbar>
    </Stack>
  )
}
