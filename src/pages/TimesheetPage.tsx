import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '../lib/queryKeys'
import {
  type DashboardOrder,
} from '../features/dashboard/api'
import {
  fetchQuickBooksOverview,
  type QuickBooksProjectSummary,
} from '../features/quickbooks/api'
import { splitQuickBooksProjectLabel } from '../features/quickbooks/utils'
import { useAuth } from '../auth/useAuth'
import { apiFetch } from '../features/api-client'
import {
  createStage,
  deleteEntry,
  deleteStage,
  fetchTimesheetBootstrap,
  reportTimesheetOrderMismatch,
  upsertMissingWorkerReview,
  upsertOrderProgress,
  reorderStages,
  syncDailyEntries,
  type SyncDailyEntryRowInput,
  type TimesheetEntry,
  type TimesheetOrderProgress,
  type TimesheetStage,
  type TimesheetUnifiedOrder,
  type TimesheetWorker,
} from '../features/timesheet/api'
import {
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
  formatMissingInfoDateLabel,
  formatMonthKeyLabel,
  getEntryCost,
  getEntryOvertimeHours,
  getEntryRate,
  getEntryRegularHours,
  getEntryTotalHours,
  isDateInRange,
  monthKeyFromIsoDate,
  normalizeJobName,
  reorderStageList,
  todayIsoDate,
  type BulkWorkerRow,
  type MissingWorkerReview,
} from './timesheet/utils'
import QuickBooksPage from './QuickBooksPage'
import WorkersPage from './WorkersPage'

type WorkerRangePreset = 'week' | 'month' | 'year' | 'all' | 'custom'
type ReportRangeMode = 'month' | 'custom'

type DateReportWorkerRow = {
  workerId: string
  workerName: string
  totalHours: number
  totalCost: number
}

type DateReportReadyRow = {
  date: string
  readyPercent: number | null
}

type DateReportOrderRow = {
  monthKey: string
  jobName: string
  totalHours: number
  totalLaborCost: number
  warrantyLaborCostInRangeAmount: number
  totalLaborCostToRangeEnd: number
  totalBillsToRangeEndAmount: number
  totalDirectExpensesToRangeEndAmount: number
  pendingPurchaseOrderToRangeEndAmount: number
  costBaseToRangeEndAmount: number
  workerRows: DateReportWorkerRow[]
  readyRows: DateReportReadyRow[]
  latestReadyPercent: number
  previousReadyPercent: number
  progressDeltaPercent: number
  invoiceCount: number
  contractAmount: number
  orderAmountDisplay: number
  recognizedRevenueAmount: number
  recognizedLaborCostAmount: number
  recognizedWarrantyLaborCostAmount: number
  recognizedBillsCostAmount: number
  recognizedDirectExpenseCostAmount: number
  recognizedPendingPOCostAmount: number
  recognizedCostAmount: number
  recognizedProfitAmount: number
  cashReceivedInRangeAmount: number
  cashGapVsRecognizedRevenueAmount: number
}

type NonOrderSpendCategory = 'general' | 'companyPurchase' | 'payroll'

type NonOrderSpendRow = {
  category: NonOrderSpendCategory
  label: string
  billedAmount: number
}

type GeneralExpenseComponentRow = {
  id:
    | 'qbGeneralBills'
    | 'qbCompanyPurchaseBills'
    | 'qbUnassignedBills'
    | 'websitePayrollGeneralJobZero'
    | 'websitePayrollGeneralUnmapped'
    | 'quickBooksPayrollExtra'
  label: string
  amount: number
  note?: string
}

type ReportSummaryBreakdownKey =
  | 'recognizedRevenue'
  | 'recognizedCost'
  | 'projectProfit'
  | 'generalExpense'
  | 'netStanding'

type ReportSummaryBreakdownRow = {
  label: string
  amount: number
  note?: string
}

type ReportSummaryBreakdownBillRow = {
  id: string
  date: string
  document: string
  source: string
  project: string
  totalAmount: number
  paidAmount: number
  unpaidAmount: number
  includedAmount: number
}

type ReportSummaryBreakdownView = 'byJob' | 'bills'

type ReportSummaryBreakdownSection = {
  title: string
  rows: ReportSummaryBreakdownRow[]
  emptyText: string
}

type ReportSummaryBreakdown = {
  title: string
  totalLabel: string
  totalAmount: number
  formula: string
  components: ReportSummaryBreakdownRow[]
  sections: ReportSummaryBreakdownSection[]
  billRows?: ReportSummaryBreakdownBillRow[]
  billsEmptyText?: string
  includedAmountLabel?: string
  billsScopeNote?: string
}

type ManagerProgressRow = {
  jobName: string
  displayOrderNumber: string
  totalHours: number
  workerCount: number
  matchSource: 'unified' | 'orders_track' | 'shipped_orders' | 'none'
  isShippedFallback: boolean
  hazardReason: string | null
  readyPercentLocked: boolean
  workerHoursByWorker: Array<{
    workerId: string
    workerName: string
    hours: number
  }>
  currentReadyPercent: number | null
  currentReadyDate: string | null
  currentReadyMissingDate: string | null
  savedReadyPercent: number
  editReadyPercent: number
  savedIsWarranty: boolean
  editIsWarranty: boolean
  savedNotes: string
  editNotes: string
  bench: string
  editBench: string
  mondayOrderId: string | null
  mondayBoardId: string | null
  mondayItemName: string | null
  shopDrawingUrl: string | null
  shopDrawingFileName: string | null
  shopDrawingCachedUrl: string | null
}

type MissingManagerInfoRow = {
  date: string
  jobName: string
  displayOrderNumber: string
  totalHours: number
  workerCount: number
  matchSource: 'unified' | 'orders_track' | 'shipped_orders' | 'none'
  isShippedFallback: boolean
  hazardReason: string | null
  mondayOrderId: string | null
  mondayItemName: string | null
  shopDrawingUrl: string | null
  shopDrawingFileName: string | null
  shopDrawingCachedUrl: string | null
}

type ManagerOrderMatch = {
  displayOrderNumber: string
  matchSource: 'unified' | 'orders_track' | 'shipped_orders' | 'none'
  isShippedFallback: boolean
  hazardReason: string | null
  mondayOrderId: string | null
  mondayBoardId: string | null
  bench: string
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
  estimateCount: number
  estimateAmount: number
  billAmount: number
  invoiceCount: number
  invoiceAmount: number
  paymentAmount: number
}

type QuickBooksProjectLookup = {
  jobKey: string
  nonOrderCategory: NonOrderSpendCategory | null
}

const QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG: Array<{
  category: NonOrderSpendCategory
  label: string
  matchers: string[]
}> = [
  {
    category: 'general',
    label: 'General',
    matchers: ['general expense', 'general', 'repair', 'customer stock'],
  },
  {
    category: 'companyPurchase',
    label: 'Company Purchase',
    matchers: ['company purchase'],
  },
  {
    category: 'payroll',
    label: 'Payroll',
    matchers: ['payroll'],
  },
]

const WORKSHEET_TABLE_CONTAINER_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  maxHeight: { xs: 420, md: 560 },
} as const

const REPORT_VIEW_BY_JOB_TABLE_CONTAINER_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  maxHeight: { xs: '72vh', md: 'calc(100vh - 220px)' },
} as const

const REPORT_SUMMARY_CARD_SX = {
  p: 2,
  flex: 1,
} as const

type DailySyncTimelineEntry = {
  date: string
  totalHours: number
  rowId: string | null
}

function resolvePayrollWeekStartForSync(isoDate: string) {
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

function toIsoDateFromDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildDailySheetSyncRows(
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

  const weekStartDate = resolvePayrollWeekStartForSync(targetDate)
  const weekStartIso = weekStartDate ? toIsoDateFromDate(weekStartDate) : ''
  const weekEndIso = weekStartDate
    ? toIsoDateFromDate(new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 6))
    : ''

  const workerWeekTimeline = new Map<string, DailySyncTimelineEntry[]>()

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
    const normalizedHours = Number.isFinite(enteredHours) ? enteredHours : Number.NaN

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

function hasEntriesForDate(entries: TimesheetEntry[], date: string) {
  return entries.some((entry) => entry.date === date)
}

function formatDailySheetSaveMessage(summary: {
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

function toIsoDateOnly(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized
  }

  const parsed = new Date(normalized)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizeMatcherValue(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resolveNonOrderSpendCategory(...candidates: Array<string | null | undefined>) {
  const normalizedCandidates = candidates
    .map((value) => normalizeMatcherValue(value))
    .filter(Boolean)

  if (normalizedCandidates.length === 0) {
    return null
  }

  const matched = QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG.find((config) => (
    normalizedCandidates.some((candidate) => (
      config.matchers.some((matcher) => {
        const normalizedMatcher = normalizeMatcherValue(matcher)
        return candidate === normalizedMatcher || candidate.includes(normalizedMatcher)
      })
    ))
  ))

  return matched?.category ?? null
}

function resolveQuickBooksJobKeyFromDetailRow(
  input: {
    projectId?: string | null
    projectName?: string | null
  },
  lookupByProjectId: Map<string, QuickBooksProjectLookup>,
) {
  const projectLookup = input.projectId
    ? lookupByProjectId.get(input.projectId)
    : null
  const fallbackProjectNumber = splitQuickBooksProjectLabel(
    input.projectName ?? '',
    input.projectId ?? '',
    { fallbackProjectNumber: input.projectId ?? '' },
  ).projectNumber
  const jobKey = projectLookup?.jobKey || normalizeJobName(fallbackProjectNumber)

  return jobKey || null
}

function resolveMonthRange(monthKey: string) {
  const match = String(monthKey ?? '').trim().match(/^(\d{4})-(\d{2})$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }

  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  return { start, end }
}

function resolveLatestReadyPercentOnOrBefore(rows: DateReportReadyRow[], date: string) {
  let latest: number | null = null

  rows.forEach((row) => {
    if (row.readyPercent === null || row.date > date) {
      return
    }

    latest = row.readyPercent
  })

  return latest
}

function isGeneralJobReference(value: string | null | undefined) {
  const digits = extractDigits(String(value ?? ''))
  return Boolean(digits && /^0+$/.test(digits))
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function TimesheetPage({ initialView = 'timesheet' }: TimesheetPageProps) {
  const { appUser } = useAuth()
  const canAccessManagerSheet =
    appUser?.isManager === true
    || appUser?.isAdmin === true
    || appUser?.isOwner === true
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
  const [unknownOrderNumbersPending, setUnknownOrderNumbersPending] = useState<string[]>([])
  const [managerContactConfirmed, setManagerContactConfirmed] = useState(false)

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

  const [monthReportMonth, setMonthReportMonth] = useState(monthKeyFromIsoDate(todayIsoDate()))
  const [reportRangeMode, setReportRangeMode] = useState<ReportRangeMode>('month')
  const [customReportStartDate, setCustomReportStartDate] = useState(todayIsoDate())
  const [customReportEndDate, setCustomReportEndDate] = useState(todayIsoDate())
  const [dateReportLaborRow, setDateReportLaborRow] = useState<DateReportOrderRow | null>(null)
  const [dateReportBillsCostsRow, setDateReportBillsCostsRow] = useState<DateReportOrderRow | null>(null)
  const [dateReportReadyRow, setDateReportReadyRow] = useState<DateReportOrderRow | null>(null)
  const [activeReportSummaryBreakdown, setActiveReportSummaryBreakdown] =
    useState<ReportSummaryBreakdownKey | null>(null)
  const [reportSummaryBreakdownView, setReportSummaryBreakdownView] =
    useState<ReportSummaryBreakdownView>('byJob')

  const [workerViewWorkerId, setWorkerViewWorkerId] = useState('')
  const [byJobGrouping, setByJobGrouping] = useState<'job' | 'stage'>('job')
  const [jobDetailsGrouping, setJobDetailsGrouping] =
    useState<'entries' | 'stage'>('entries')
  const [orderProgress, setOrderProgress] = useState<TimesheetOrderProgress[]>([])
  const [managerProgressByJob, setManagerProgressByJob] = useState<Record<string, string>>({})
  const [managerWarrantyByJob, setManagerWarrantyByJob] = useState<Record<string, boolean>>({})
  const [managerNotesByJob, setManagerNotesByJob] = useState<Record<string, string>>({})
  const [managerBenchByJob, setManagerBenchByJob] = useState<Record<string, string>>({})
  const [expandedManagerJobs, setExpandedManagerJobs] = useState<Set<string>>(() => new Set())
  const [isSavingManagerProgress, setIsSavingManagerProgress] = useState(false)
  const [mondayOrders, setMondayOrders] = useState<DashboardOrder[]>([])
  const [unifiedOrders, setUnifiedOrders] = useState<TimesheetUnifiedOrder[]>([])

  const quickBooksQuery = useQuery({
    queryKey: QUERY_KEYS.quickbooksOverviewFull,
    queryFn: () => fetchQuickBooksOverview({ full: true }),
    staleTime: 3 * 60 * 1000,
    enabled: canAccessManagerSheet && isReportsView,
  })
  const quickBooksProjects = useMemo<QuickBooksProjectSummary[]>(
    () => quickBooksQuery.data?.projects ?? [],
    [quickBooksQuery.data],
  )
  const [shopDrawingPreviewRow, setShopDrawingPreviewRow] =
    useState<ManagerProgressRow | null>(null)
  const [isShopDrawingPreviewLoading, setIsShopDrawingPreviewLoading] =
    useState(false)
  const [shopDrawingPreviewSrc, setShopDrawingPreviewSrc] = useState('')
  const shopDrawingPreviewObjectUrlRef = useRef<string | null>(null)
  const [missingWorkersDate, setMissingWorkersDate] = useState('')
  const [missingManagerDialogOpen, setMissingManagerDialogOpen] = useState(false)
  const [missingManagerSelectedDate, setMissingManagerSelectedDate] = useState('')
  const [missingManagerProgressByKey, setMissingManagerProgressByKey] = useState<Record<string, string>>({})
  const [missingReviewByKey, setMissingReviewByKey] =
    useState<Record<string, MissingWorkerReview>>({})
  const [workerRangePreset, setWorkerRangePreset] =
    useState<WorkerRangePreset>('all')
  const [workerCustomStartDate, setWorkerCustomStartDate] = useState(todayIsoDate())
  const [workerCustomEndDate, setWorkerCustomEndDate] = useState(todayIsoDate())
  const [workerPrintMenuAnchorEl, setWorkerPrintMenuAnchorEl] = useState<HTMLElement | null>(null)
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

  const clearShopDrawingPreviewObjectUrl = useCallback(() => {
    if (shopDrawingPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(shopDrawingPreviewObjectUrlRef.current)
      shopDrawingPreviewObjectUrlRef.current = null
    }
  }, [])

  const handleCloseDateReportLaborPopup = useCallback(() => {
    setDateReportLaborRow(null)
  }, [])

  const handleCloseDateReportBillsCostsPopup = useCallback(() => {
    setDateReportBillsCostsRow(null)
  }, [])

  const handleCloseDateReportReadyPopup = useCallback(() => {
    setDateReportReadyRow(null)
  }, [])

  const handleOpenReportSummaryBreakdown = useCallback((key: ReportSummaryBreakdownKey) => {
    setActiveReportSummaryBreakdown(key)
    setReportSummaryBreakdownView('byJob')
  }, [])

  const handleCloseReportSummaryBreakdown = useCallback(() => {
    setActiveReportSummaryBreakdown(null)
    setReportSummaryBreakdownView('byJob')
  }, [])

  useEffect(() => {
    if (!canAccessManagerSheet && worksheetTab === 1) {
      setWorksheetTab(0)
    }
  }, [canAccessManagerSheet, worksheetTab])

  const queryClient = useQueryClient()

  const bootstrapQuery = useQuery({
    queryKey: QUERY_KEYS.timesheetBootstrap,
    queryFn: () => fetchTimesheetBootstrap(),
    staleTime: 3 * 60 * 1000,
  })

  useEffect(() => {
    const payload = bootstrapQuery.data
    if (!payload) return
    setWorkers(payload.workers)
    setEntries(payload.entries)
    setStages(payload.stages)
    setOrderProgress(payload.orderProgress ?? [])
    setMondayOrders(Array.isArray(payload.mondaySnapshot?.orders) ? payload.mondaySnapshot.orders : [])
    setUnifiedOrders(Array.isArray(payload.unifiedOrders) ? payload.unifiedOrders : [])
    setMissingReviewByKey(buildMissingReviewMap(payload.missingWorkerReviews ?? []))
    setWorkerViewWorkerId((current) => {
      if (current && payload.workers.some((worker) => worker.id === current)) {
        return current
      }
      return payload.workers[0]?.id ?? ''
    })
    setIsLoading(false)
  }, [bootstrapQuery.data])

  useEffect(() => {
    if (bootstrapQuery.error instanceof Error) {
      setError(bootstrapQuery.error.message)
      setIsLoading(false)
    }
  }, [bootstrapQuery.error])

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

  const quickBooksProjectLookupById = useMemo(() => {
    const map = new Map<string, QuickBooksProjectLookup>()

    quickBooksProjects.forEach((project) => {
      const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId, {
        fallbackProjectNumber: project.projectId || '',
      })
      const jobKey = normalizeJobName(splitLabel.projectNumber)

      if (!project.projectId || !jobKey) {
        return
      }

      map.set(project.projectId, {
        jobKey,
        nonOrderCategory: resolveNonOrderSpendCategory(project.projectName, splitLabel.projectNumber),
      })
    })

    return map
  }, [quickBooksProjects])

  const quickBooksMetricsByJobKey = useMemo(() => {
    const map = new Map<string, QuickBooksJobMetrics>()

    quickBooksProjects.forEach((project) => {
      const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId, {
        fallbackProjectNumber: project.projectId || '',
      })
      const jobKey = normalizeJobName(splitLabel.projectNumber)

      if (!jobKey) {
        return
      }

      const purchaseOrderAmount = Number(project.purchaseOrderAmount)
      const estimateCount = Number(project.estimateCount)
      const estimateAmount = Number(project.estimateAmount)
      const billAmount = Number(project.billAmount)
      const invoiceCount = Number(project.invoiceCount)
      const invoiceAmount = Number(project.invoiceAmount)
      const paymentAmount = Number(project.paymentAmount)
      const normalizedPurchaseOrderAmount = Number.isFinite(purchaseOrderAmount)
        ? purchaseOrderAmount
        : 0
      const normalizedEstimateCount = Number.isFinite(estimateCount)
        ? estimateCount
        : 0
      const normalizedEstimateAmount = Number.isFinite(estimateAmount)
        ? estimateAmount
        : 0
      const normalizedBillAmount = Number.isFinite(billAmount)
        ? billAmount
        : 0
      const normalizedInvoiceCount = Number.isFinite(invoiceCount)
        ? invoiceCount
        : 0
      const normalizedInvoiceAmount = Number.isFinite(invoiceAmount)
        ? invoiceAmount
        : 0
      const normalizedPaymentAmount = Number.isFinite(paymentAmount)
        ? paymentAmount
        : 0
      const existing = map.get(jobKey) ?? {
        purchaseOrderAmount: 0,
        estimateCount: 0,
        estimateAmount: 0,
        billAmount: 0,
        invoiceCount: 0,
        invoiceAmount: 0,
        paymentAmount: 0,
      }

      const nextPurchaseOrderAmount = existing.purchaseOrderAmount + normalizedPurchaseOrderAmount
      const nextEstimateCount = existing.estimateCount + normalizedEstimateCount
      const nextEstimateAmount = existing.estimateAmount + normalizedEstimateAmount
      const nextBillAmount = existing.billAmount + normalizedBillAmount
      const nextInvoiceCount = existing.invoiceCount + normalizedInvoiceCount
      const nextInvoiceAmount = existing.invoiceAmount + normalizedInvoiceAmount
      const nextPaymentAmount = existing.paymentAmount + normalizedPaymentAmount

      map.set(jobKey, {
        purchaseOrderAmount: Number(nextPurchaseOrderAmount.toFixed(2)),
        estimateCount: nextEstimateCount,
        estimateAmount: Number(nextEstimateAmount.toFixed(2)),
        billAmount: Number(nextBillAmount.toFixed(2)),
        invoiceCount: nextInvoiceCount,
        invoiceAmount: Number(nextInvoiceAmount.toFixed(2)),
        paymentAmount: Number(nextPaymentAmount.toFixed(2)),
      })
    })

    return map
  }, [quickBooksProjects])

  const reportJobDisplayNameByJobKey = useMemo(() => {
    const map = new Map<string, string>()

    entries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (!jobName) {
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (!map.has(jobKey)) {
        map.set(jobKey, jobName)
      }
    })

    orderProgress.forEach((progress) => {
      const jobName = String(progress.jobName ?? '').trim()

      if (!jobName) {
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (!map.has(jobKey)) {
        map.set(jobKey, jobName)
      }
    })

    quickBooksProjects.forEach((project) => {
      const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId, {
        fallbackProjectNumber: project.projectId || '',
      })
      const projectNumber = String(splitLabel.projectNumber || '').trim()

      if (!projectNumber) {
        return
      }

      const jobKey = normalizeJobName(projectNumber)

      if (jobKey && !map.has(jobKey)) {
        map.set(jobKey, projectNumber)
      }
    })

    return map
  }, [entries, orderProgress, quickBooksProjects])

  const reportSpecificJobKeys = useMemo(() => {
    const keys = new Set<string>()

    quickBooksProjects.forEach((project) => {
      const splitLabel = splitQuickBooksProjectLabel(project.projectName, project.projectId, {
        fallbackProjectNumber: project.projectId || '',
      })
      const projectNumber = String(splitLabel.projectNumber || '').trim()
      const jobKey = normalizeJobName(projectNumber)

      if (!jobKey || isGeneralJobReference(projectNumber)) {
        return
      }

      const nonOrderCategory = resolveNonOrderSpendCategory(project.projectName, projectNumber)

      if (!nonOrderCategory) {
        keys.add(jobKey)
      }
    })

    orderProgress.forEach((progress) => {
      const jobName = String(progress.jobName ?? '').trim()
      const jobKey = normalizeJobName(jobName)

      if (!jobKey || isGeneralJobReference(jobName)) {
        return
      }

      keys.add(jobKey)
    })

    return keys
  }, [orderProgress, quickBooksProjects])

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
    if (workerRangePreset === 'all') {
      return {
        start: undefined,
        end: undefined,
      }
    }

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

  const workerAllEntries = useMemo(() => {
    if (!workerViewWorkerId) {
      return []
    }

    return sortedEntries.filter((entry) => entry.workerId === workerViewWorkerId)
  }, [sortedEntries, workerViewWorkerId])

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

  const selectedWorkerHoursBreakdown = useMemo(() => {
    const resolvePayrollWeekStartIso = (dateValue: string) => {
      const normalizedIsoDate = String(dateValue ?? '').trim().slice(0, 10)

      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedIsoDate)) {
        return ''
      }

      const [year, month, day] = normalizedIsoDate.split('-').map(Number)

      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !year || !month || !day) {
        return ''
      }

      const date = new Date(year, month - 1, day)

      if (Number.isNaN(date.getTime())) {
        return ''
      }

      // Payroll week runs Thursday -> Wednesday.
      const dayOfWeek = date.getDay()
      const daysSinceThursday = (dayOfWeek - 4 + 7) % 7
      date.setDate(date.getDate() - daysSinceThursday)

      const startYear = date.getFullYear()
      const startMonth = String(date.getMonth() + 1).padStart(2, '0')
      const startDay = String(date.getDate()).padStart(2, '0')
      return `${startYear}-${startMonth}-${startDay}`
    }

    const entriesByPayrollWeek = new Map<string, Array<{
      date: string
      createdAt: string
      totalHours: number
      inRange: boolean
    }>>()
    let parsedWeekEntriesCount = 0

    workerAllEntries.forEach((entry) => {
      const weekKey = resolvePayrollWeekStartIso(entry.date)

      if (!weekKey) {
        return
      }

      if (!entriesByPayrollWeek.has(weekKey)) {
        entriesByPayrollWeek.set(weekKey, [])
      }

      entriesByPayrollWeek.get(weekKey)?.push({
        date: entry.date,
        createdAt: entry.createdAt,
        totalHours: getEntryTotalHours(entry),
        inRange: isDateInRange(entry.date, workerDateRange.start, workerDateRange.end),
      })
      parsedWeekEntriesCount += 1
    })

    let regularHours = 0
    let overtimeHours = 0

    entriesByPayrollWeek.forEach((weekEntries) => {
      const sortedWeekEntries = [...weekEntries].sort((left, right) => {
        const byDate = left.date.localeCompare(right.date)

        if (byDate !== 0) {
          return byDate
        }

        const leftCreatedAt = new Date(left.createdAt).getTime()
        const rightCreatedAt = new Date(right.createdAt).getTime()
        const normalizedLeftCreatedAt = Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0
        const normalizedRightCreatedAt = Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0

        return normalizedLeftCreatedAt - normalizedRightCreatedAt
      })

      let weeklyRunningHours = 0

      sortedWeekEntries.forEach((weekEntry) => {
        const entryRegularHours = Math.min(weekEntry.totalHours, Math.max(0, 40 - weeklyRunningHours))
        const entryOvertimeHours = Math.max(0, weekEntry.totalHours - entryRegularHours)

        weeklyRunningHours += weekEntry.totalHours

        if (!weekEntry.inRange) {
          return
        }

        regularHours += entryRegularHours
        overtimeHours += entryOvertimeHours
      })
    })

    if (parsedWeekEntriesCount === 0 && workerFilteredEntries.length > 0) {
      return workerFilteredEntries.reduce(
        (accumulator, entry) => {
          accumulator.regularHours += getEntryRegularHours(entry)
          accumulator.overtimeHours += getEntryOvertimeHours(entry)

          return accumulator
        },
        {
          regularHours: 0,
          overtimeHours: 0,
        },
      )
    }

    return {
      regularHours,
      overtimeHours,
    }
  }, [workerAllEntries, workerDateRange.end, workerDateRange.start, workerFilteredEntries])

  const workerReportRows = useMemo(() => {
    const rowsByWorkerId = new Map<string, {
      workerId: string
      workerName: string
      totalHours: number
      totalCost: number
      jobNames: Set<string>
      progressContributionPercent: number
    }>()

    workers.forEach((worker) => {
      rowsByWorkerId.set(worker.id, {
        workerId: worker.id,
        workerName: worker.fullName,
        totalHours: 0,
        totalCost: 0,
        jobNames: new Set<string>(),
        progressContributionPercent: 0,
      })
    })

    const entriesInRange = sortedEntries.filter((entry) =>
      isDateInRange(entry.date, workerDateRange.start, workerDateRange.end),
    )
    const jobHoursByWorker = new Map<string, Map<string, number>>()
    const totalHoursByJob = new Map<string, number>()

    entriesInRange.forEach((entry) => {
      const workerName = workersById.get(entry.workerId)?.fullName ?? 'Unknown worker'
      const existingWorkerRow = rowsByWorkerId.get(entry.workerId) ?? {
        workerId: entry.workerId,
        workerName,
        totalHours: 0,
        totalCost: 0,
        jobNames: new Set<string>(),
        progressContributionPercent: 0,
      }
      const totalHours = getEntryTotalHours(entry)
      const totalCost = getEntryCost(entry, workersById)
      const jobKey = normalizeJobName(entry.jobName)

      existingWorkerRow.totalHours += totalHours
      existingWorkerRow.totalCost += totalCost
      if (entry.jobName) {
        existingWorkerRow.jobNames.add(entry.jobName)
      }
      rowsByWorkerId.set(entry.workerId, existingWorkerRow)

      if (!jobKey || totalHours <= 0) {
        return
      }

      const workerHours = jobHoursByWorker.get(jobKey) ?? new Map<string, number>()
      workerHours.set(entry.workerId, (workerHours.get(entry.workerId) ?? 0) + totalHours)
      jobHoursByWorker.set(jobKey, workerHours)
      totalHoursByJob.set(jobKey, (totalHoursByJob.get(jobKey) ?? 0) + totalHours)
    })

    const rangeEndDate = workerDateRange.end || todayIsoDate()

    totalHoursByJob.forEach((_jobHours, jobKey) => {
      const readyRows = orderProgress
        .filter((progress) => {
          const progressJobKey = normalizeJobName(progress.jobName)
          const progressDate = String(progress.date ?? '').trim()

          return progressJobKey === jobKey
            && Boolean(progressDate)
            && progressDate <= rangeEndDate
        })
        .map((progress) => {
          const progressDate = String(progress.date ?? '').trim()
          const rawReadyPercent = Number(progress.readyPercent)

          return {
            date: progressDate,
            readyPercent: Number.isFinite(rawReadyPercent)
              ? Math.min(100, Math.max(0, rawReadyPercent))
              : null,
          }
        })
        .sort((left, right) => left.date.localeCompare(right.date))

      const previousReadyPercent = workerDateRange.start
        ? (resolveLatestReadyPercentOnOrBefore(
          readyRows,
          addDaysToIsoDate(workerDateRange.start, -1),
        ) ?? 0)
        : 0
      const latestReadyPercent = resolveLatestReadyPercentOnOrBefore(
        readyRows,
        rangeEndDate,
      ) ?? previousReadyPercent
      const progressDeltaPercent = Math.max(
        0,
        Number((latestReadyPercent - previousReadyPercent).toFixed(2)),
      )

      if (progressDeltaPercent <= 0) {
        return
      }

      const totalJobHours = totalHoursByJob.get(jobKey) ?? 0

      if (totalJobHours <= 0) {
        return
      }

      const workerHours = jobHoursByWorker.get(jobKey)

      if (!workerHours) {
        return
      }

      workerHours.forEach((hours, workerId) => {
        const workerRow = rowsByWorkerId.get(workerId)

        if (!workerRow || hours <= 0) {
          return
        }

        workerRow.progressContributionPercent += progressDeltaPercent * (hours / totalJobHours)
        rowsByWorkerId.set(workerId, workerRow)
      })
    })

    return [...rowsByWorkerId.values()]
      .map((row) => ({
        ...row,
        progressContributionPercent: Number(row.progressContributionPercent.toFixed(2)),
      }))
      .filter((row) => row.totalHours > 0 || row.totalCost > 0 || row.jobNames.size > 0)
      .sort((left, right) => {
        if (right.totalHours !== left.totalHours) {
          return right.totalHours - left.totalHours
        }

        return left.workerName.localeCompare(right.workerName)
      })
  }, [orderProgress, sortedEntries, workerDateRange.end, workerDateRange.start, workers, workersById])

  useEffect(() => {
    if (workerReportRows.length === 0) {
      return
    }

    if (!workerReportRows.some((row) => row.workerId === workerViewWorkerId)) {
      setWorkerViewWorkerId(workerReportRows[0].workerId)
    }
  }, [workerReportRows, workerViewWorkerId])

  const selectedWorkerReportRow = useMemo(
    () => workerReportRows.find((row) => row.workerId === workerViewWorkerId) ?? null,
    [workerReportRows, workerViewWorkerId],
  )

  const bulkRowCountByWorkerId = useMemo(() => {
    const map = new Map<string, number>()

    bulkRows.forEach((row) => {
      map.set(row.workerId, (map.get(row.workerId) ?? 0) + 1)
    })

    return map
  }, [bulkRows])

  const dailySheetPreview = useMemo(
    () => buildDailySheetSyncRows(bulkRows, workersById, entries, bulkDate),
    [bulkRows, workersById, entries, bulkDate],
  )

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

  const reportMonthOptions = useMemo(() => {
    const monthKeys = new Set<string>()

    entries.forEach((entry) => {
      const monthKey = monthKeyFromIsoDate(entry.date)
      if (monthKey) {
        monthKeys.add(monthKey)
      }
    })

    orderProgress.forEach((progress) => {
      const monthKey = monthKeyFromIsoDate(progress.date)
      if (monthKey) {
        monthKeys.add(monthKey)
      }
    })

    const currentMonth = monthKeyFromIsoDate(todayIsoDate())
    if (currentMonth) {
      monthKeys.add(currentMonth)
    }

    return [...monthKeys].sort((left, right) => right.localeCompare(left))
  }, [entries, orderProgress])

  useEffect(() => {
    if (reportMonthOptions.length === 0) {
      return
    }

    if (!reportMonthOptions.includes(monthReportMonth)) {
      setMonthReportMonth(reportMonthOptions[0])
    }
  }, [monthReportMonth, reportMonthOptions])

  const monthReportRange = useMemo(
    () => resolveMonthRange(monthReportMonth),
    [monthReportMonth],
  )

  const reportDateRange = useMemo(() => {
    if (reportRangeMode === 'month') {
      return monthReportRange
    }

    const fallbackMonthRange = monthReportRange
    const rawStartDate = (customReportStartDate || fallbackMonthRange?.start || '').trim()
    const rawEndDate = (customReportEndDate || fallbackMonthRange?.end || '').trim()

    if (!rawStartDate || !rawEndDate) {
      return null
    }

    if (rawStartDate <= rawEndDate) {
      return {
        start: rawStartDate,
        end: rawEndDate,
      }
    }

    return {
      start: rawEndDate,
      end: rawStartDate,
    }
  }, [customReportEndDate, customReportStartDate, monthReportRange, reportRangeMode])

  const reportDateRangeLabel = useMemo(() => {
    if (!reportDateRange) {
      return 'No range selected'
    }

    if (reportDateRange.start === reportDateRange.end) {
      return reportDateRange.start
    }

    return `${reportDateRange.start} to ${reportDateRange.end}`
  }, [reportDateRange])

  const reportRangeEntries = useMemo(() => {
    if (!reportDateRange) {
      return []
    }

    return sortedEntries.filter((entry) =>
      isDateInRange(entry.date, reportDateRange.start, reportDateRange.end),
    )
  }, [reportDateRange, sortedEntries])

  const websitePayrollInRange = useMemo(() => {
    const bySpecificJobKey = new Map<string, number>()
    let totalAmount = 0
    let generalJobZeroAmount = 0
    let generalUnmappedAmount = 0

    if (!reportDateRange) {
      return {
        totalAmount: 0,
        generalJobZeroAmount: 0,
        generalUnmappedAmount: 0,
        bySpecificJobKey,
      }
    }

    sortedEntries.forEach((entry) => {
      if (!isDateInRange(String(entry.date ?? ''), reportDateRange.start, reportDateRange.end)) {
        return
      }

      const laborCost = getEntryCost(entry, workersById)

      if (!Number.isFinite(laborCost) || laborCost <= 0) {
        return
      }

      totalAmount += laborCost

      const jobName = String(entry.jobName ?? '').trim()

      if (!jobName || isGeneralJobReference(jobName)) {
        generalJobZeroAmount += laborCost
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (reportSpecificJobKeys.has(jobKey)) {
        const current = bySpecificJobKey.get(jobKey) ?? 0
        bySpecificJobKey.set(jobKey, current + laborCost)
        return
      }

      generalUnmappedAmount += laborCost
    })

    const normalizedBySpecificJobKey = new Map<string, number>()

    bySpecificJobKey.forEach((amount, jobKey) => {
      normalizedBySpecificJobKey.set(jobKey, Number(amount.toFixed(2)))
    })

    return {
      totalAmount: Number(totalAmount.toFixed(2)),
      generalJobZeroAmount: Number(generalJobZeroAmount.toFixed(2)),
      generalUnmappedAmount: Number(generalUnmappedAmount.toFixed(2)),
      bySpecificJobKey: normalizedBySpecificJobKey,
    }
  }, [reportDateRange, reportSpecificJobKeys, sortedEntries, workersById])

  const warrantyDateJobKeySet = useMemo(() => {
    const set = new Set<string>()

    orderProgress.forEach((progress) => {
      if (progress.isWarranty !== true) {
        return
      }

      const jobKey = normalizeJobName(progress.jobName)
      const date = String(progress.date ?? '').trim()

      if (!jobKey || !date) {
        return
      }

      set.add(`${date}:${jobKey}`)
    })

    return set
  }, [orderProgress])

  const warrantyLaborCostInReportRangeByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    if (!reportDateRange) {
      return map
    }

    reportRangeEntries.forEach((entry) => {
      const date = String(entry.date ?? '').trim()
      const jobName = String(entry.jobName ?? '').trim()

      if (!date || !jobName || isGeneralJobReference(jobName)) {
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (!reportSpecificJobKeys.has(jobKey) || !warrantyDateJobKeySet.has(`${date}:${jobKey}`)) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      const nextAmount = currentAmount + getEntryCost(entry, workersById)

      map.set(jobKey, Number(nextAmount.toFixed(2)))
    })

    return map
  }, [reportDateRange, reportRangeEntries, reportSpecificJobKeys, warrantyDateJobKeySet, workersById])

  const laborCostAllProjectByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    sortedEntries.forEach((entry) => {
      const date = String(entry.date ?? '').trim()
      const jobName = String(entry.jobName ?? '').trim()

      if (!date || !jobName || isGeneralJobReference(jobName)) {
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (!reportSpecificJobKeys.has(jobKey)) {
        return
      }

      if (warrantyDateJobKeySet.has(`${date}:${jobKey}`)) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      const nextAmount = currentAmount + getEntryCost(entry, workersById)

      map.set(jobKey, Number(nextAmount.toFixed(2)))
    })

    return map
  }, [reportSpecificJobKeys, sortedEntries, warrantyDateJobKeySet, workersById])

  const quickBooksPaymentsByReportRangeJobKey = useMemo(() => {
    const map = new Map<string, number>()

    if (!reportDateRange) {
      return map
    }

    const paymentRows = quickBooksQuery.data?.details?.payments ?? []

    paymentRows.forEach((paymentRow) => {
      if (!isDateInRange(String(paymentRow.txnDate ?? ''), reportDateRange.start, reportDateRange.end)) {
        return
      }

      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: paymentRow.projectId,
          projectName: paymentRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const totalAmount = Number(paymentRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      if (normalizedTotalAmount <= 0) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      map.set(jobKey, Number((currentAmount + normalizedTotalAmount).toFixed(2)))
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.payments, reportDateRange, reportSpecificJobKeys])

  const quickBooksBillsInReportRangeByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    if (!reportDateRange) {
      return map
    }

    const billRows = quickBooksQuery.data?.details?.bills ?? []

    billRows.forEach((billRow) => {
      if (!isDateInRange(String(billRow.txnDate ?? ''), reportDateRange.start, reportDateRange.end)) {
        return
      }

      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: billRow.projectId,
          projectName: billRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const totalAmount = Number(billRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      if (normalizedTotalAmount === 0) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      map.set(jobKey, Number((currentAmount + normalizedTotalAmount).toFixed(2)))
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.bills, reportDateRange, reportSpecificJobKeys])

  const quickBooksBillsAllProjectByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    const billRows = quickBooksQuery.data?.details?.bills ?? []

    billRows.forEach((billRow) => {
      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: billRow.projectId,
          projectName: billRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const totalAmount = Number(billRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      if (normalizedTotalAmount === 0) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      map.set(jobKey, Number((currentAmount + normalizedTotalAmount).toFixed(2)))
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.bills, reportSpecificJobKeys])

  const quickBooksDirectExpensesInReportRangeByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    if (!reportDateRange) {
      return map
    }

    const directExpenseRows = quickBooksQuery.data?.details?.directExpenses ?? []

    directExpenseRows.forEach((directExpenseRow) => {
      if (!isDateInRange(String(directExpenseRow.txnDate ?? ''), reportDateRange.start, reportDateRange.end)) {
        return
      }

      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: directExpenseRow.projectId,
          projectName: directExpenseRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const totalAmount = Number(directExpenseRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      if (normalizedTotalAmount === 0) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      map.set(jobKey, Number((currentAmount + normalizedTotalAmount).toFixed(2)))
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.directExpenses, reportDateRange, reportSpecificJobKeys])

  const quickBooksDirectExpensesAllProjectByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    const directExpenseRows = quickBooksQuery.data?.details?.directExpenses ?? []

    directExpenseRows.forEach((directExpenseRow) => {
      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: directExpenseRow.projectId,
          projectName: directExpenseRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const totalAmount = Number(directExpenseRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      if (normalizedTotalAmount === 0) {
        return
      }

      const currentAmount = map.get(jobKey) ?? 0
      map.set(jobKey, Number((currentAmount + normalizedTotalAmount).toFixed(2)))
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.directExpenses, reportSpecificJobKeys])

  const quickBooksBilledPurchaseOrderIdsAllProjectByJobKey = useMemo(() => {
    const map = new Map<string, Set<string>>()

    const billRows = quickBooksQuery.data?.details?.bills ?? []

    billRows.forEach((billRow) => {
      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: billRow.projectId,
          projectName: billRow.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const linkedIds = Array.isArray(billRow.linkedPurchaseOrderIds)
        ? billRow.linkedPurchaseOrderIds
        : []

      if (linkedIds.length === 0) {
        return
      }

      const existing = map.get(jobKey) ?? new Set<string>()
      linkedIds.forEach((id) => existing.add(id))
      map.set(jobKey, existing)
    })

    return map
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.bills, reportSpecificJobKeys])

  const quickBooksPendingPurchaseOrdersAllProjectByJobKey = useMemo(() => {
    const map = new Map<string, number>()

    const poLines = quickBooksQuery.data?.details?.purchaseOrderLines ?? []

    poLines.forEach((poLine) => {
      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: poLine.projectId,
          projectName: poLine.projectName,
        },
        quickBooksProjectLookupById,
      )

      if (!jobKey || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      const poId = poLine.id

      if (poId && quickBooksBilledPurchaseOrderIdsAllProjectByJobKey.get(jobKey)?.has(poId)) {
        return
      }

      const amount = Number(poLine.totalAmount)

      if (!Number.isFinite(amount) || amount === 0) {
        return
      }

      const current = map.get(jobKey) ?? 0
      map.set(jobKey, Number((current + amount).toFixed(2)))
    })

    return map
  }, [
    quickBooksBilledPurchaseOrderIdsAllProjectByJobKey,
    quickBooksProjectLookupById,
    quickBooksQuery.data?.details?.purchaseOrderLines,
    reportSpecificJobKeys,
  ])

  const reportNonOrderSpendRows = useMemo<NonOrderSpendRow[]>(() => {
    const rollupByCategory = new Map<NonOrderSpendCategory, { billedAmount: number }>()

    QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG.forEach((config) => {
      rollupByCategory.set(config.category, { billedAmount: 0 })
    })

    if (!reportDateRange) {
      return QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG.map((config) => ({
        category: config.category,
        label: config.label,
        billedAmount: 0,
      }))
    }

    const billRows = quickBooksQuery.data?.details?.bills ?? []

    billRows.forEach((billRow) => {
      if (!isDateInRange(String(billRow.txnDate ?? ''), reportDateRange.start, reportDateRange.end)) {
        return
      }

      const projectLookup = billRow.projectId
        ? quickBooksProjectLookupById.get(billRow.projectId)
        : null
      const fallbackProjectNumber = splitQuickBooksProjectLabel(
        billRow.projectName ?? '',
        billRow.projectId ?? '',
        { fallbackProjectNumber: billRow.projectId ?? '' },
      ).projectNumber
      const nonOrderCategory = projectLookup?.nonOrderCategory
        ?? resolveNonOrderSpendCategory(billRow.projectName, fallbackProjectNumber)

      if (!nonOrderCategory) {
        return
      }

      const bucket = rollupByCategory.get(nonOrderCategory)

      if (!bucket) {
        return
      }

      const totalAmount = Number(billRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

      bucket.billedAmount += normalizedTotalAmount
    })

    return QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG.map((config) => {
      const bucket = rollupByCategory.get(config.category) ?? { billedAmount: 0 }

      return {
        category: config.category,
        label: config.label,
        billedAmount: Number(bucket.billedAmount.toFixed(2)),
      }
    })
  }, [quickBooksProjectLookupById, quickBooksQuery.data?.details?.bills, reportDateRange])

  const quickBooksUnassignedBillsInRange = useMemo(() => {
    if (!reportDateRange) {
      return {
        rowCount: 0,
        totalAmount: 0,
      }
    }

    const billRows = quickBooksQuery.data?.details?.bills ?? []
    let rowCount = 0
    let totalAmount = 0

    billRows.forEach((billRow) => {
      const billDate = String(billRow.txnDate ?? '').trim()

      if (!isDateInRange(billDate, reportDateRange.start, reportDateRange.end)) {
        return
      }

      const jobKey = resolveQuickBooksJobKeyFromDetailRow(
        {
          projectId: billRow.projectId,
          projectName: billRow.projectName,
        },
        quickBooksProjectLookupById,
      )
      const fallbackProjectNumber = splitQuickBooksProjectLabel(
        billRow.projectName ?? '',
        billRow.projectId ?? '',
        { fallbackProjectNumber: billRow.projectId ?? '' },
      ).projectNumber
      const nonOrderCategory = resolveNonOrderSpendCategory(billRow.projectName, fallbackProjectNumber)

      if ((jobKey && reportSpecificJobKeys.has(jobKey)) || nonOrderCategory) {
        return
      }

      const totalAmountValue = Number(billRow.totalAmount)
      const normalizedTotalAmount = Number.isFinite(totalAmountValue) ? totalAmountValue : 0

      if (normalizedTotalAmount === 0) {
        return
      }

      rowCount += 1
      totalAmount += normalizedTotalAmount
    })

    return {
      rowCount,
      totalAmount: Number(totalAmount.toFixed(2)),
    }
  }, [
    quickBooksProjectLookupById,
    quickBooksQuery.data?.details?.bills,
    reportDateRange,
    reportSpecificJobKeys,
  ])

  const reportGeneralExpenseRows = useMemo<GeneralExpenseComponentRow[]>(() => {
    const quickBooksGeneralBills = reportNonOrderSpendRows.find((row) => row.category === 'general')?.billedAmount ?? 0
    const quickBooksCompanyPurchaseBills = reportNonOrderSpendRows.find((row) => row.category === 'companyPurchase')?.billedAmount ?? 0
    const quickBooksPayrollBilled = reportNonOrderSpendRows.find((row) => row.category === 'payroll')?.billedAmount ?? 0
    const quickBooksPayrollExtra = Math.max(0, quickBooksPayrollBilled - websitePayrollInRange.totalAmount)

    return [
      {
        id: 'qbGeneralBills',
        label: 'QuickBooks general bills',
        amount: Number(quickBooksGeneralBills.toFixed(2)),
      },
      {
        id: 'qbCompanyPurchaseBills',
        label: 'QuickBooks company purchase bills',
        amount: Number(quickBooksCompanyPurchaseBills.toFixed(2)),
      },
      {
        id: 'qbUnassignedBills',
        label: 'QuickBooks bills missing project assignment',
        amount: Number(quickBooksUnassignedBillsInRange.totalAmount.toFixed(2)),
        note: quickBooksUnassignedBillsInRange.rowCount > 0
          ? `${quickBooksUnassignedBillsInRange.rowCount} bill rows in selected range are missing project assignment.`
          : undefined,
      },
      {
        id: 'websitePayrollGeneralJobZero',
        label: 'Website payroll (job 0 / general)',
        amount: Number(websitePayrollInRange.generalJobZeroAmount.toFixed(2)),
      },
      {
        id: 'websitePayrollGeneralUnmapped',
        label: 'Website payroll (not mapped to specific job)',
        amount: Number(websitePayrollInRange.generalUnmappedAmount.toFixed(2)),
      },
      {
        id: 'quickBooksPayrollExtra',
        label: 'QuickBooks payroll extra over website payroll',
        amount: Number(quickBooksPayrollExtra.toFixed(2)),
        note: `QB payroll in range ${formatCurrency(quickBooksPayrollBilled)} - website payroll in range ${formatCurrency(websitePayrollInRange.totalAmount)}`,
      },
    ]
  }, [quickBooksUnassignedBillsInRange, reportNonOrderSpendRows, websitePayrollInRange])

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

  const latestWorkedDateBeforeSelectedByJobKey = useMemo(() => {
    const map = new Map<string, string>()

    entries.forEach((entry) => {
      const entryDate = String(entry.date ?? '').trim()
      const jobName = String(entry.jobName ?? '').trim()
      const jobKey = normalizeJobName(jobName)

      if (!entryDate || !jobKey || /^0+$/.test(jobName) || entryDate >= managerSelectedDate) {
        return
      }

      const existingDate = map.get(jobKey)

      if (!existingDate || entryDate > existingDate) {
        map.set(jobKey, entryDate)
      }
    })

    return map
  }, [entries, managerSelectedDate])

  const mondayOrderLookup = useMemo(() => {
    const primaryByNormalizedKey = new Map<string, DashboardOrder>()
    const primaryByDigits = new Map<string, DashboardOrder>()
    const shippedByNormalizedKey = new Map<string, DashboardOrder>()
    const shippedByDigits = new Map<string, DashboardOrder>()

    mondayOrders.forEach((order) => {
      const isShippedSource = order.mondaySourceBoardType === 'shipped_orders'
      const targetByNormalizedKey = isShippedSource ? shippedByNormalizedKey : primaryByNormalizedKey
      const targetByDigits = isShippedSource ? shippedByDigits : primaryByDigits
      const nameKey = normalizeJobName(order.name)

      if (nameKey && !targetByNormalizedKey.has(nameKey)) {
        targetByNormalizedKey.set(nameKey, order)
      }

      const idKey = normalizeJobName(order.id)

      if (idKey && !targetByNormalizedKey.has(idKey)) {
        targetByNormalizedKey.set(idKey, order)
      }

      const nameDigits = extractDigits(order.name)

      if (nameDigits && !targetByDigits.has(nameDigits)) {
        targetByDigits.set(nameDigits, order)
      }

      const idDigits = extractDigits(order.id)

      if (idDigits && !targetByDigits.has(idDigits)) {
        targetByDigits.set(idDigits, order)
      }
    })

    return {
      primaryByNormalizedKey,
      primaryByDigits,
      shippedByNormalizedKey,
      shippedByDigits,
    }
  }, [mondayOrders])

  const timesheetOrderNumberOptions = useMemo(() => {
    const options = new Set<string>(['0'])

    mondayOrders.forEach((order) => {
      const orderNumber =
        String(order.orderNumber ?? '').trim()
        || String(order.name ?? '').trim()

      if (orderNumber) {
        options.add(orderNumber)
      }
    })

    return [...options].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
    )
  }, [mondayOrders])

  const isKnownTimesheetOrderNumber = useCallback((jobName: string) => {
    const trimmedJobName = String(jobName ?? '').trim()
    const jobKey = normalizeJobName(trimmedJobName)
    const jobDigits = extractDigits(trimmedJobName)

    if (!trimmedJobName || (jobDigits && /^0+$/.test(jobDigits))) {
      return true
    }

    return Boolean(
      mondayOrderLookup.primaryByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.primaryByDigits.get(jobDigits) : null)
      || mondayOrderLookup.shippedByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.shippedByDigits.get(jobDigits) : null),
    )
  }, [mondayOrderLookup])

  const unifiedOrderLookup = useMemo(() => {
    const byNormalizedKey = new Map<string, TimesheetUnifiedOrder>()
    const byDigits = new Map<string, TimesheetUnifiedOrder>()

    const hasDrawing = (order: TimesheetUnifiedOrder | undefined | null) => Boolean(
      String(order?.shopDrawingCachedUrl ?? order?.shopDrawingUrl ?? '').trim(),
    )

    const shouldReplace = (
      existingOrder: TimesheetUnifiedOrder | undefined,
      candidateOrder: TimesheetUnifiedOrder,
    ) => {
      if (!existingOrder) {
        return true
      }

      const existingHasDrawing = hasDrawing(existingOrder)
      const candidateHasDrawing = hasDrawing(candidateOrder)

      if (candidateHasDrawing && !existingHasDrawing) {
        return true
      }

      if (candidateOrder.hasMondayRecord && !existingOrder.hasMondayRecord) {
        return true
      }

      return false
    }

    const register = (
      map: Map<string, TimesheetUnifiedOrder>,
      key: string | null,
      order: TimesheetUnifiedOrder,
    ) => {
      if (!key) {
        return
      }

      if (shouldReplace(map.get(key), order)) {
        map.set(key, order)
      }
    }

    unifiedOrders.forEach((order) => {
      const orderNumberKey = normalizeJobName(order.orderNumber ?? '')
      const orderNameKey = normalizeJobName(order.orderName ?? '')
      const mondayItemKey = normalizeJobName(order.mondayItemId ?? '')

      register(byNormalizedKey, orderNumberKey, order)
      register(byNormalizedKey, orderNameKey, order)
      register(byNormalizedKey, mondayItemKey, order)

      const orderNumberDigits = extractDigits(order.orderNumber ?? '')
      const orderNameDigits = extractDigits(order.orderName ?? '')
      const mondayItemDigits = extractDigits(order.mondayItemId ?? '')

      register(byDigits, orderNumberDigits, order)
      register(byDigits, orderNameDigits, order)
      register(byDigits, mondayItemDigits, order)
    })

    return {
      byNormalizedKey,
      byDigits,
    }
  }, [unifiedOrders])

  const resolveManagerOrderMatch = useCallback((jobName: string): ManagerOrderMatch => {
    const jobKey = normalizeJobName(jobName)
    const jobDigits = extractDigits(jobName)
    const unifiedMatchedOrder =
      unifiedOrderLookup.byNormalizedKey.get(jobKey)
      || (jobDigits ? unifiedOrderLookup.byDigits.get(jobDigits) : null)
      || null
    const primaryMatchedMondayOrder =
      mondayOrderLookup.primaryByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.primaryByDigits.get(jobDigits) : null)
      || null
    const shippedMatchedMondayOrder =
      mondayOrderLookup.shippedByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.shippedByDigits.get(jobDigits) : null)
      || null
    const primaryMatchedDrawingUrl = String(
      primaryMatchedMondayOrder?.shopDrawingCachedUrl
      || primaryMatchedMondayOrder?.shopDrawingUrl
      || '',
    ).trim()
    const matchedMondayOrder = primaryMatchedDrawingUrl
      ? primaryMatchedMondayOrder
      : shippedMatchedMondayOrder || primaryMatchedMondayOrder
    const matchSource: ManagerOrderMatch['matchSource'] = unifiedMatchedOrder
      ? 'unified'
      : matchedMondayOrder
        ? matchedMondayOrder.mondaySourceBoardType === 'shipped_orders'
          ? 'shipped_orders'
          : 'orders_track'
        : 'none'
    const resolvedShopDrawingUrl =
      unifiedMatchedOrder?.shopDrawingUrl
      || matchedMondayOrder?.shopDrawingUrl
      || null
    const resolvedShopDrawingCachedUrl =
      unifiedMatchedOrder?.shopDrawingCachedUrl
      || matchedMondayOrder?.shopDrawingCachedUrl
      || null
    const displayOrderNumber =
      String(unifiedMatchedOrder?.orderNumber ?? '').trim()
      || String(jobName ?? '').trim()

    return {
      displayOrderNumber,
      matchSource,
      isShippedFallback: matchSource === 'shipped_orders',
      hazardReason: unifiedMatchedOrder?.hazardReason ?? null,
      mondayOrderId: unifiedMatchedOrder?.mondayItemId || matchedMondayOrder?.id || null,
      mondayBoardId:
        unifiedMatchedOrder?.mondayBoardId
        || matchedMondayOrder?.boardId
        || null,
      bench: String(unifiedMatchedOrder?.bench ?? matchedMondayOrder?.bench ?? '').trim(),
      mondayItemName: unifiedMatchedOrder?.orderName || matchedMondayOrder?.name || null,
      shopDrawingUrl: resolvedShopDrawingUrl,
      shopDrawingFileName:
        unifiedMatchedOrder?.shopDrawingFileName || matchedMondayOrder?.shopDrawingFileName || null,
      shopDrawingCachedUrl: resolvedShopDrawingCachedUrl,
    }
  }, [
    mondayOrderLookup.primaryByDigits,
    mondayOrderLookup.primaryByNormalizedKey,
    mondayOrderLookup.shippedByDigits,
    mondayOrderLookup.shippedByNormalizedKey,
    unifiedOrderLookup.byDigits,
    unifiedOrderLookup.byNormalizedKey,
  ])

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
      const orderMatch = resolveManagerOrderMatch(jobName)
      const totals = entriesByJobKey.get(jobKey)
      const progressKey = `${managerSelectedDate}:${jobKey}`
      const savedProgress = orderProgressByDateJobKey.get(progressKey)
      const savedReadyPercent = savedProgress ? Number(savedProgress.readyPercent) : 0
      const savedIsWarranty = savedProgress?.isWarranty === true
      const savedNotes = String(savedProgress?.notes ?? '').trim()
      const latestWorkedDate = latestWorkedDateBeforeSelectedByJobKey.get(jobKey) ?? null
      const latestWorkedProgress = latestWorkedDate
        ? orderProgressByDateJobKey.get(`${latestWorkedDate}:${jobKey}`)
        : null
      const currentReadyPercent = Number.isFinite(Number(latestWorkedProgress?.readyPercent))
        ? Math.min(100, Math.max(0, Number(latestWorkedProgress?.readyPercent)))
        : null
      const currentReadyMissingDate = latestWorkedDate && !latestWorkedProgress
        ? latestWorkedDate
        : null
      const readyPercentLocked = /^0+$/.test(String(jobName ?? '').trim())
      const rawDraft = String(managerProgressByJob[jobName] ?? '').trim()
      const parsedDraft = Number(rawDraft)
      const workerHoursByWorker = [...(totals?.workerHoursById.entries() ?? [])]
        .map(([workerId, hours]) => ({
          workerId,
          workerName: workersById.get(workerId)?.fullName ?? 'Unknown worker',
          hours,
        }))
        .sort((left, right) => right.hours - left.hours || left.workerName.localeCompare(right.workerName))
      const draftWarranty = managerWarrantyByJob[jobName]
      const editReadyPercent = readyPercentLocked
        ? 0
        : rawDraft === '' || !Number.isFinite(parsedDraft)
          ? savedReadyPercent
          : Math.min(100, Math.max(0, parsedDraft))
      const editIsWarranty = readyPercentLocked
        ? false
        : draftWarranty === undefined
          ? savedIsWarranty
          : draftWarranty
      const editNotes = managerNotesByJob[jobName] ?? savedNotes
      const editBench = managerBenchByJob[jobName] ?? orderMatch.bench

      return {
        jobName,
        displayOrderNumber: orderMatch.displayOrderNumber,
        totalHours: totals?.totalHours ?? 0,
        workerCount: workerHoursByWorker.length,
        matchSource: orderMatch.matchSource,
        isShippedFallback: orderMatch.isShippedFallback,
        hazardReason: orderMatch.hazardReason,
        readyPercentLocked,
        workerHoursByWorker,
        currentReadyPercent,
        currentReadyDate: latestWorkedDate,
        currentReadyMissingDate,
        savedReadyPercent,
        editReadyPercent,
        savedIsWarranty,
        editIsWarranty,
        savedNotes,
        editNotes,
        bench: orderMatch.bench,
        editBench,
        mondayOrderId: orderMatch.mondayOrderId,
        mondayBoardId: orderMatch.mondayBoardId,
        mondayItemName: orderMatch.mondayItemName,
        shopDrawingUrl: orderMatch.shopDrawingUrl,
        shopDrawingFileName: orderMatch.shopDrawingFileName,
        shopDrawingCachedUrl: orderMatch.shopDrawingCachedUrl,
      }
    })
  }, [
    managerDayEntries,
    managerDayJobs,
    latestWorkedDateBeforeSelectedByJobKey,
    managerProgressByJob,
    managerNotesByJob,
    managerBenchByJob,
    managerWarrantyByJob,
    managerSelectedDate,
    orderProgressByDateJobKey,
    resolveManagerOrderMatch,
    workersById,
  ])

  const managerProgressSummary = useMemo(() => {
    const editableRows = managerProgressRows.filter((row) => !row.readyPercentLocked)

    if (editableRows.length === 0) {
      return {
        averageReadyPercent: 0,
        completeCount: 0,
        inProgressCount: 0,
      }
    }

    const totalReady = editableRows.reduce(
      (accumulator, row) => accumulator + row.editReadyPercent,
      0,
    )

    return {
      averageReadyPercent: totalReady / editableRows.length,
      completeCount: editableRows.filter((row) => row.editReadyPercent >= 100).length,
      inProgressCount: editableRows.filter(
        (row) => row.editReadyPercent > 0 && row.editReadyPercent < 100,
      ).length,
    }
  }, [managerProgressRows])

  const selectedJobPostShippedSummary = useMemo(() => {
    const fullJobTotals = selectedJobEntries.reduce(
      (accumulator, entry) => ({
        totalHours: accumulator.totalHours + getEntryTotalHours(entry),
        totalCost: accumulator.totalCost + getEntryCost(entry, workersById),
      }),
      {
        totalHours: 0,
        totalCost: 0,
      },
    )

    if (!selectedJobName) {
      return {
        sourceLabel: null,
        matchedOrderId: null,
        shippedSinceDate: null,
        beforeTotals: {
          totalHours: 0,
          totalCost: 0,
        },
        afterTotals: {
          totalHours: 0,
          totalCost: 0,
        },
      }
    }

    const jobKey = normalizeJobName(selectedJobName)
    const jobDigits = extractDigits(selectedJobName)
    const primaryMatch =
      mondayOrderLookup.primaryByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.primaryByDigits.get(jobDigits) : null)
      || null
    const shippedMatch =
      mondayOrderLookup.shippedByNormalizedKey.get(jobKey)
      || (jobDigits ? mondayOrderLookup.shippedByDigits.get(jobDigits) : null)
      || null
    const matchedOrder = shippedMatch || primaryMatch
    const shippedSinceDate = toIsoDateOnly(
      shippedMatch?.movedToShippedAt
      || primaryMatch?.movedToShippedAt
      || shippedMatch?.shippedAt
      || primaryMatch?.shippedAt,
    )

    if (!matchedOrder || !shippedSinceDate) {
      return {
        sourceLabel: null,
        matchedOrderId: matchedOrder?.id ?? null,
        shippedSinceDate,
        beforeTotals: fullJobTotals,
        afterTotals: {
          totalHours: 0,
          totalCost: 0,
        },
      }
    }

    const totals = selectedJobEntries.reduce(
      (accumulator, entry) => {
        const entryDate = String(entry.date ?? '').trim()
        const entryHours = getEntryTotalHours(entry)
        const entryCost = getEntryCost(entry, workersById)

        if (entryDate && entryDate > shippedSinceDate) {
          return {
            beforeTotals: accumulator.beforeTotals,
            afterTotals: {
              totalHours: accumulator.afterTotals.totalHours + entryHours,
              totalCost: accumulator.afterTotals.totalCost + entryCost,
            },
          }
        }

        return {
          beforeTotals: {
            totalHours: accumulator.beforeTotals.totalHours + entryHours,
            totalCost: accumulator.beforeTotals.totalCost + entryCost,
          },
          afterTotals: accumulator.afterTotals,
        }
      },
      {
        beforeTotals: {
          totalHours: 0,
          totalCost: 0,
        },
        afterTotals: {
          totalHours: 0,
          totalCost: 0,
        },
      },
    )

    return {
      sourceLabel: shippedMatch ? 'Shipped Orders board' : 'Orders Track (shipped)',
      matchedOrderId: matchedOrder.id ?? null,
      shippedSinceDate,
      beforeTotals: totals.beforeTotals,
      afterTotals: totals.afterTotals,
    }
  }, [
    mondayOrderLookup.primaryByDigits,
    mondayOrderLookup.primaryByNormalizedKey,
    mondayOrderLookup.shippedByDigits,
    mondayOrderLookup.shippedByNormalizedKey,
    selectedJobEntries,
    selectedJobName,
    workersById,
  ])

  const selectedJobDateReadyRows = useMemo(() => {
    if (!selectedJobName) {
      return []
    }

    const totalHoursByDate = new Map<string, number>()

    selectedJobEntries.forEach((entry) => {
      totalHoursByDate.set(
        entry.date,
        (totalHoursByDate.get(entry.date) ?? 0) + getEntryTotalHours(entry),
      )
    })

    const dates = [...new Set(selectedJobEntries.map((entry) => entry.date))].sort()

    return dates.map((date) => {
      const key = `${date}:${normalizeJobName(selectedJobName)}`
      const progress = orderProgressByDateJobKey.get(key)

      return {
        date,
        totalHours: totalHoursByDate.get(date) ?? 0,
        readyPercent: progress ? Number(progress.readyPercent) : null,
      }
    })
  }, [orderProgressByDateJobKey, selectedJobEntries, selectedJobName])

  const dateReportRows = useMemo<DateReportOrderRow[]>(() => {
    if (!reportDateRange) {
      return []
    }

    const groupedByJob = new Map<
      string,
      {
        jobName: string
        totalHours: number
        totalLaborCost: number
        workerRowsById: Map<string, DateReportWorkerRow>
      }
    >()

    const ensureGroupedByJobRow = (jobKey: string, preferredJobName?: string) => {
      if (!jobKey || groupedByJob.has(jobKey)) {
        return
      }

      const normalizedPreferredName = String(preferredJobName ?? '').trim()
      const fallbackJobName = reportJobDisplayNameByJobKey.get(jobKey) ?? jobKey

      groupedByJob.set(jobKey, {
        jobName: normalizedPreferredName || fallbackJobName,
        totalHours: 0,
        totalLaborCost: 0,
        workerRowsById: new Map<string, DateReportWorkerRow>(),
      })
    }

    reportRangeEntries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (!jobName || isGeneralJobReference(jobName)) {
        return
      }

      const jobKey = normalizeJobName(jobName) || jobName

      if (!reportSpecificJobKeys.has(jobKey)) {
        return
      }

      ensureGroupedByJobRow(jobKey, jobName)

      const row = groupedByJob.get(jobKey)

      if (!row) {
        return
      }

      const totalHours = getEntryTotalHours(entry)
      const totalCost = getEntryCost(entry, workersById)
      const workerName = workersById.get(entry.workerId)?.fullName ?? 'Unknown worker'
      const existingWorkerRow = row.workerRowsById.get(entry.workerId) ?? {
        workerId: entry.workerId,
        workerName,
        totalHours: 0,
        totalCost: 0,
      }

      row.totalHours += totalHours
      row.totalLaborCost += totalCost
      existingWorkerRow.totalHours += totalHours
      existingWorkerRow.totalCost += totalCost
      row.workerRowsById.set(entry.workerId, existingWorkerRow)
    })

    orderProgress.forEach((progress) => {
      const progressDate = String(progress.date ?? '').trim()

      if (!isDateInRange(progressDate, reportDateRange.start, reportDateRange.end)) {
        return
      }

      const jobName = String(progress.jobName ?? '').trim()
      const jobKey = normalizeJobName(jobName)

      if (!jobKey || isGeneralJobReference(jobName) || !reportSpecificJobKeys.has(jobKey)) {
        return
      }

      ensureGroupedByJobRow(jobKey, jobName)
    })

    quickBooksBillsInReportRangeByJobKey.forEach((_amount, jobKey) => {
      if (reportSpecificJobKeys.has(jobKey)) {
        ensureGroupedByJobRow(jobKey)
      }
    })

    quickBooksDirectExpensesInReportRangeByJobKey.forEach((_amount, jobKey) => {
      if (reportSpecificJobKeys.has(jobKey)) {
        ensureGroupedByJobRow(jobKey)
      }
    })

    quickBooksPaymentsByReportRangeJobKey.forEach((_amount, jobKey) => {
      if (reportSpecificJobKeys.has(jobKey)) {
        ensureGroupedByJobRow(jobKey)
      }
    })

    return [...groupedByJob.entries()]
      .map(([groupedJobKey, jobRow]) => {
        const normalizedJobKey = normalizeJobName(jobRow.jobName) || groupedJobKey

        if (!normalizedJobKey) {
          return null
        }

        const metrics = quickBooksMetricsByJobKey.get(normalizedJobKey)
        const cashReceivedInRangeAmount = Number(
          (quickBooksPaymentsByReportRangeJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const totalBillsToRangeEndAmount = Number(
          (quickBooksBillsAllProjectByJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const totalDirectExpensesToRangeEndAmount = Number(
          (quickBooksDirectExpensesAllProjectByJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const totalLaborCostToRangeEnd = Number(
          (laborCostAllProjectByJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const warrantyLaborCostInRangeAmount = Number(
          (warrantyLaborCostInReportRangeByJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const pendingPurchaseOrderToRangeEndAmount = Number(
          (quickBooksPendingPurchaseOrdersAllProjectByJobKey.get(normalizedJobKey) ?? 0).toFixed(2),
        )
        const costBaseToRangeEndAmount = Number(
          (
            totalLaborCostToRangeEnd
            + totalBillsToRangeEndAmount
            + totalDirectExpensesToRangeEndAmount
            + pendingPurchaseOrderToRangeEndAmount
          ).toFixed(2),
        )
        const readyRows = orderProgress
          .filter((progress) => {
            const progressJobKey = normalizeJobName(progress.jobName)
            const progressDate = String(progress.date ?? '').trim()

            return progressJobKey === normalizedJobKey
              && Boolean(progressDate)
              && progressDate <= reportDateRange.end
          })
          .map((progress) => {
            const progressDate = String(progress.date ?? '').trim()
            const rawReadyPercent = Number(progress.readyPercent)

            return {
              date: progressDate,
              readyPercent: Number.isFinite(rawReadyPercent)
                ? Math.min(100, Math.max(0, rawReadyPercent))
                : null,
            }
          })
          .sort((left, right) => left.date.localeCompare(right.date))

        const previousReadyPercent = resolveLatestReadyPercentOnOrBefore(
          readyRows,
          addDaysToIsoDate(reportDateRange.start, -1),
        ) ?? 0
        const latestReadyPercent = resolveLatestReadyPercentOnOrBefore(
          readyRows,
          reportDateRange.end,
        ) ?? previousReadyPercent
        const progressDeltaPercent = Number(
          (latestReadyPercent - previousReadyPercent).toFixed(1),
        )

        const invoiceCount = Number(metrics?.invoiceCount ?? 0)
        const invoiceAmount = Number(metrics?.invoiceAmount ?? 0)
        const estimateAmount = Number(metrics?.estimateAmount ?? 0)
        const contractAmount =
          invoiceCount > 0 ? invoiceAmount : estimateAmount
        const orderAmountDisplay = invoiceCount > 0 ? invoiceAmount : estimateAmount
        const recognizedRevenueAmount = Number(
          ((contractAmount * progressDeltaPercent) / 100).toFixed(2),
        )
        const recognizedLaborCostAmount = Number(
          ((totalLaborCostToRangeEnd * progressDeltaPercent) / 100).toFixed(2),
        )
        const recognizedWarrantyLaborCostAmount = Number(
          warrantyLaborCostInRangeAmount.toFixed(2),
        )
        const recognizedBillsCostAmount = Number(
          ((totalBillsToRangeEndAmount * progressDeltaPercent) / 100).toFixed(2),
        )
        const recognizedDirectExpenseCostAmount = Number(
          ((totalDirectExpensesToRangeEndAmount * progressDeltaPercent) / 100).toFixed(2),
        )
        const recognizedPendingPOCostAmount = Number(
          ((pendingPurchaseOrderToRangeEndAmount * progressDeltaPercent) / 100).toFixed(2),
        )
        const recognizedCostAmount = Number(
          (
            recognizedLaborCostAmount
            + recognizedWarrantyLaborCostAmount
            + recognizedBillsCostAmount
            + recognizedDirectExpenseCostAmount
            + recognizedPendingPOCostAmount
          ).toFixed(2),
        )
        const recognizedProfitAmount = Number(
          (recognizedRevenueAmount - recognizedCostAmount).toFixed(2),
        )
        const cashGapVsRecognizedRevenueAmount = Number(
          (cashReceivedInRangeAmount - recognizedRevenueAmount).toFixed(2),
        )
        const workerRows = [...jobRow.workerRowsById.values()].sort(
          (left, right) =>
            right.totalHours - left.totalHours
            || right.totalCost - left.totalCost
            || left.workerName.localeCompare(right.workerName),
        )

        return {
          monthKey: monthKeyFromIsoDate(reportDateRange.start) || monthReportMonth,
          jobName: jobRow.jobName,
          totalHours: jobRow.totalHours,
          totalLaborCost: jobRow.totalLaborCost,
          warrantyLaborCostInRangeAmount,
          totalLaborCostToRangeEnd,
          workerRows,
          readyRows,
          latestReadyPercent,
          previousReadyPercent,
          progressDeltaPercent,
          invoiceCount,
          contractAmount,
          orderAmountDisplay,
          totalBillsToRangeEndAmount,
          totalDirectExpensesToRangeEndAmount,
          pendingPurchaseOrderToRangeEndAmount,
          costBaseToRangeEndAmount,
          recognizedRevenueAmount,
          recognizedLaborCostAmount,
          recognizedWarrantyLaborCostAmount,
          recognizedBillsCostAmount,
          recognizedDirectExpenseCostAmount,
          recognizedPendingPOCostAmount,
          recognizedCostAmount,
          recognizedProfitAmount,
          cashReceivedInRangeAmount,
          cashGapVsRecognizedRevenueAmount,
        }
      })
      .filter((row): row is DateReportOrderRow => row !== null && row.totalHours > 0)
      .sort((left, right) => {
        const absoluteRevenueDiff = Math.abs(right.recognizedRevenueAmount) - Math.abs(left.recognizedRevenueAmount)

        if (absoluteRevenueDiff !== 0) {
          return absoluteRevenueDiff
        }

        const absoluteProfitDiff = Math.abs(right.recognizedProfitAmount) - Math.abs(left.recognizedProfitAmount)

        if (absoluteProfitDiff !== 0) {
          return absoluteProfitDiff
        }

        return left.jobName.localeCompare(right.jobName)
      })
  }, [
    laborCostAllProjectByJobKey,
    monthReportMonth,
    orderProgress,
    quickBooksBillsInReportRangeByJobKey,
    quickBooksBillsAllProjectByJobKey,
    quickBooksDirectExpensesInReportRangeByJobKey,
    quickBooksDirectExpensesAllProjectByJobKey,
    quickBooksMetricsByJobKey,
    quickBooksPaymentsByReportRangeJobKey,
    quickBooksPendingPurchaseOrdersAllProjectByJobKey,
    reportJobDisplayNameByJobKey,
    reportDateRange,
    reportRangeEntries,
    reportSpecificJobKeys,
    warrantyLaborCostInReportRangeByJobKey,
    workersById,
  ])

  useEffect(() => {
    if (!isReportsView || reportsTab !== 3) {
      return
    }

    const sampleRow = dateReportRows[0] ?? null

    console.log('[MonthReportDebug] quickBooks overview state', {
      canAccessManagerSheet,
      appUserRole: appUser?.role ?? null,
      appUserApproved: appUser?.isApproved ?? false,
      appUserOwner: appUser?.isOwner ?? false,
      queryEnabled: canAccessManagerSheet && isReportsView,
      queryStatus: quickBooksQuery.status,
      queryFetchStatus: quickBooksQuery.fetchStatus,
      queryIsFetching: quickBooksQuery.isFetching,
      queryIsLoading: quickBooksQuery.isLoading,
      queryIsError: quickBooksQuery.isError,
      quickBooksProjectsCount: quickBooksProjects.length,
      dateReportRowsCount: dateReportRows.length,
      sampleRow: sampleRow
        ? {
            jobName: sampleRow.jobName,
            orderAmountDisplay: sampleRow.orderAmountDisplay,
            contractAmount: sampleRow.contractAmount,
            progressDeltaPercent: sampleRow.progressDeltaPercent,
          }
        : null,
    })

    if (quickBooksQuery.error) {
      console.log('[MonthReportDebug] quickBooks overview error', quickBooksQuery.error)
    }
  }, [
    appUser?.isApproved,
    appUser?.isOwner,
    appUser?.role,
    canAccessManagerSheet,
    dateReportRows,
    isReportsView,
    quickBooksProjects.length,
    quickBooksQuery.error,
    quickBooksQuery.fetchStatus,
    quickBooksQuery.isError,
    quickBooksQuery.isFetching,
    quickBooksQuery.isLoading,
    quickBooksQuery.status,
    reportsTab,
  ])

  const reportSummaryTotals = useMemo(() => {
    const totalRecognizedRevenue = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedRevenueAmount,
      0,
    )
    const totalRecognizedLaborCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedLaborCostAmount,
      0,
    )
    const totalRecognizedWarrantyLaborCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedWarrantyLaborCostAmount,
      0,
    )
    const totalRecognizedBillsCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedBillsCostAmount,
      0,
    )
    const totalRecognizedDirectExpenseCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedDirectExpenseCostAmount,
      0,
    )
    const totalRecognizedPendingPOCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedPendingPOCostAmount,
      0,
    )
    const totalRecognizedCost = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedCostAmount,
      0,
    )
    const totalOrderCostBase = dateReportRows.reduce(
      (sum, row) => sum + row.costBaseToRangeEndAmount,
      0,
    )
    const totalRecognizedProfit = dateReportRows.reduce(
      (sum, row) => sum + row.recognizedProfitAmount,
      0,
    )
    const totalCashReceivedInRange = dateReportRows.reduce(
      (sum, row) => sum + row.cashReceivedInRangeAmount,
      0,
    )
    const totalGeneralExpense = reportGeneralExpenseRows.reduce(
      (sum, row) => sum + row.amount,
      0,
    )
    const totalNetStanding = totalRecognizedProfit - totalGeneralExpense
    const totalCashGapVsRecognizedRevenue = totalCashReceivedInRange - totalRecognizedRevenue

    return {
      totalRecognizedRevenue: Number(totalRecognizedRevenue.toFixed(2)),
      totalRecognizedLaborCost: Number(totalRecognizedLaborCost.toFixed(2)),
      totalRecognizedWarrantyLaborCost: Number(totalRecognizedWarrantyLaborCost.toFixed(2)),
      totalRecognizedBillsCost: Number(totalRecognizedBillsCost.toFixed(2)),
      totalRecognizedDirectExpenseCost: Number(totalRecognizedDirectExpenseCost.toFixed(2)),
      totalRecognizedPendingPOCost: Number(totalRecognizedPendingPOCost.toFixed(2)),
      totalRecognizedCost: Number(totalRecognizedCost.toFixed(2)),
      totalOrderCostBase: Number(totalOrderCostBase.toFixed(2)),
      totalRecognizedProfit: Number(totalRecognizedProfit.toFixed(2)),
      totalGeneralExpense: Number(totalGeneralExpense.toFixed(2)),
      totalNetStanding: Number(totalNetStanding.toFixed(2)),
      totalCashReceivedInRange: Number(totalCashReceivedInRange.toFixed(2)),
      totalCashGapVsRecognizedRevenue: Number(totalCashGapVsRecognizedRevenue.toFixed(2)),
    }
  }, [dateReportRows, reportGeneralExpenseRows])

  const reportSummaryBreakdowns = useMemo<Record<ReportSummaryBreakdownKey, ReportSummaryBreakdown>>(() => {
    const compareBreakdownRows = (
      left: ReportSummaryBreakdownRow,
      right: ReportSummaryBreakdownRow,
    ) => {
      const absoluteDiff = Math.abs(right.amount) - Math.abs(left.amount)

      if (absoluteDiff !== 0) {
        return absoluteDiff
      }

      return left.label.localeCompare(right.label)
    }

    const recognizedRevenueByOrderRows = dateReportRows
      .filter((row) => row.recognizedRevenueAmount !== 0)
      .map((row) => ({
        label: row.jobName,
        amount: Number(row.recognizedRevenueAmount.toFixed(2)),
        note: `${row.progressDeltaPercent.toFixed(1)}% of ${formatCurrency(row.contractAmount)}`,
      }))
      .sort(compareBreakdownRows)

    const recognizedCostByOrderRows = dateReportRows
      .filter((row) => row.recognizedCostAmount !== 0)
      .map((row) => ({
        label: row.jobName,
        amount: Number(row.recognizedCostAmount.toFixed(2)),
        note: `${row.progressDeltaPercent.toFixed(1)}% of project-wide non-warranty cost base ${formatCurrency(row.costBaseToRangeEndAmount)} (labor ${formatCurrency(row.totalLaborCostToRangeEnd)} + bills ${formatCurrency(row.totalBillsToRangeEndAmount)} + direct expenses ${formatCurrency(row.totalDirectExpensesToRangeEndAmount)} + pending POs ${formatCurrency(row.pendingPurchaseOrderToRangeEndAmount)}) + warranty labor in selected range ${formatCurrency(row.recognizedWarrantyLaborCostAmount)}`,
      }))
      .sort(compareBreakdownRows)

    const recognizedProfitByOrderRows = dateReportRows
      .filter((row) => row.recognizedProfitAmount !== 0)
      .map((row) => ({
        label: row.jobName,
        amount: Number(row.recognizedProfitAmount.toFixed(2)),
        note: `Recognized revenue ${formatCurrency(row.recognizedRevenueAmount)} - recognized cost ${formatCurrency(row.recognizedCostAmount)}`,
      }))
      .sort(compareBreakdownRows)

    const generalExpenseRows = reportGeneralExpenseRows
      .filter((row) => row.amount > 0)
      .map((row) => ({
        label: row.label,
        amount: Number(row.amount.toFixed(2)),
        note: row.note,
      }))
      .sort(compareBreakdownRows)

    const orderJobNameByKey = new Map<string, string>()
    const progressDeltaByJobKey = new Map<string, number>()

    dateReportRows.forEach((row) => {
      const jobKey = normalizeJobName(row.jobName)

      if (!jobKey) {
        return
      }

      orderJobNameByKey.set(jobKey, row.jobName)
      progressDeltaByJobKey.set(jobKey, row.progressDeltaPercent)
    })

    const nonOrderLabelByCategory = new Map<NonOrderSpendCategory, string>(
      QUICKBOOKS_NON_ORDER_CATEGORY_CONFIG.map((config) => [config.category, config.label]),
    )

    const billRows = quickBooksQuery.data?.details?.bills ?? []
    const directExpenseRows = quickBooksQuery.data?.details?.directExpenses ?? []

    type BaseBreakdownBillRow = {
      id: string
      date: string
      document: string
      source: string
      project: string
      totalAmount: number
      paidAmount: number
      unpaidAmount: number
      includeInRecognizedCostAmount: number
      includeInGeneralExpenseAmount: number
    }

    const baseBreakdownBillRows: BaseBreakdownBillRow[] = [
      ...billRows.map((billRow, index) => {
        const totalAmount = Number(billRow.totalAmount)
        const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

        if (normalizedTotalAmount === 0) {
          return null
        }

        const balanceAmount = Number(billRow.balanceAmount)
        const normalizedBalanceAmount = Number.isFinite(balanceAmount)
          ? Math.max(0, balanceAmount)
          : 0
        const paidAmount = Math.max(0, normalizedTotalAmount - normalizedBalanceAmount)
        const date = String(billRow.txnDate ?? '').trim()
        const projectLabel = splitQuickBooksProjectLabel(
          billRow.projectName ?? '',
          billRow.projectId ?? '',
          { fallbackProjectNumber: billRow.projectId ?? '' },
        ).projectNumber
          || String(billRow.projectName ?? '').trim()
          || String(billRow.projectId ?? '').trim()
          || '-'
        const jobKey = resolveQuickBooksJobKeyFromDetailRow(
          {
            projectId: billRow.projectId,
            projectName: billRow.projectName,
          },
          quickBooksProjectLookupById,
        )
        const orderJobName = jobKey ? orderJobNameByKey.get(jobKey) : null
        const progressDeltaPercent = jobKey ? (progressDeltaByJobKey.get(jobKey) ?? 0) : 0
        const nonOrderCategory = resolveNonOrderSpendCategory(billRow.projectName, projectLabel)
        const isInRange = Boolean(
          reportDateRange
          && date
          && isDateInRange(date, reportDateRange.start, reportDateRange.end),
        )
        const isSpecificProjectBill = Boolean(jobKey && reportSpecificJobKeys.has(jobKey))
        const isUnassignedBillInRange = isInRange
          && !isSpecificProjectBill
          && !nonOrderCategory
        const includeInRecognizedCostAmount = orderJobName
          ? Number(((normalizedTotalAmount * progressDeltaPercent) / 100).toFixed(2))
          : 0
        const includeInGeneralExpenseAmount = isInRange
          && (
            nonOrderCategory === 'general'
            || nonOrderCategory === 'companyPurchase'
            || isUnassignedBillInRange
          )
          ? Number(normalizedTotalAmount.toFixed(2))
          : 0

        if (includeInRecognizedCostAmount === 0 && includeInGeneralExpenseAmount === 0) {
          return null
        }

        const source = orderJobName
          ? orderJobName
          : isUnassignedBillInRange
            ? 'Unassigned (missing project)'
            : `${nonOrderLabelByCategory.get(nonOrderCategory as NonOrderSpendCategory) ?? 'Non-order'} (non-order)`
        const documentLabel = String(billRow.docNumber ?? billRow.id ?? '').trim() || '-'

        return {
          id: `${billRow.id ?? 'no-id'}:${documentLabel}:${date || 'no-date'}:${index}`,
          date,
          document: documentLabel,
          source,
          project: projectLabel,
          totalAmount: Number(normalizedTotalAmount.toFixed(2)),
          paidAmount: Number(paidAmount.toFixed(2)),
          unpaidAmount: Number(normalizedBalanceAmount.toFixed(2)),
          includeInRecognizedCostAmount,
          includeInGeneralExpenseAmount,
        }
      }),
      ...directExpenseRows.map((directExpenseRow, index) => {
        const totalAmount = Number(directExpenseRow.totalAmount)
        const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

        if (normalizedTotalAmount === 0) {
          return null
        }

        const date = String(directExpenseRow.txnDate ?? '').trim()
        const projectLabel = splitQuickBooksProjectLabel(
          directExpenseRow.projectName ?? '',
          directExpenseRow.projectId ?? '',
          { fallbackProjectNumber: directExpenseRow.projectId ?? '' },
        ).projectNumber
          || String(directExpenseRow.projectName ?? '').trim()
          || String(directExpenseRow.projectId ?? '').trim()
          || '-'
        const jobKey = resolveQuickBooksJobKeyFromDetailRow(
          {
            projectId: directExpenseRow.projectId,
            projectName: directExpenseRow.projectName,
          },
          quickBooksProjectLookupById,
        )
        const orderJobName = jobKey ? orderJobNameByKey.get(jobKey) : null
        const progressDeltaPercent = jobKey ? (progressDeltaByJobKey.get(jobKey) ?? 0) : 0
          const includeInRecognizedCostAmount = orderJobName
          ? Number(((normalizedTotalAmount * progressDeltaPercent) / 100).toFixed(2))
          : 0

        if (includeInRecognizedCostAmount === 0) {
          return null
        }

        const documentLabel = String(directExpenseRow.docNumber ?? directExpenseRow.id ?? '').trim() || '-'

        return {
          id: `direct-expense:${directExpenseRow.id ?? 'no-id'}:${documentLabel}:${date || 'no-date'}:${index}`,
          date,
          document: documentLabel,
          source: 'Direct expense',
          project: projectLabel,
          totalAmount: Number(normalizedTotalAmount.toFixed(2)),
          paidAmount: Number(normalizedTotalAmount.toFixed(2)),
          unpaidAmount: 0,
          includeInRecognizedCostAmount,
          includeInGeneralExpenseAmount: 0,
        }
      }),
    ].filter((row): row is BaseBreakdownBillRow => Boolean(row))

    const sortBreakdownBillRows = (
      left: ReportSummaryBreakdownBillRow,
      right: ReportSummaryBreakdownBillRow,
    ) => {
      const absoluteDiff = Math.abs(right.includedAmount) - Math.abs(left.includedAmount)

      if (absoluteDiff !== 0) {
        return absoluteDiff
      }

      const leftDate = left.date || ''
      const rightDate = right.date || ''

      if (rightDate !== leftDate) {
        return rightDate.localeCompare(leftDate)
      }

      return left.source.localeCompare(right.source)
    }

    const recognizedCostBillRows: ReportSummaryBreakdownBillRow[] = baseBreakdownBillRows
      .filter((row) => row.includeInRecognizedCostAmount !== 0)
      .map((row) => ({
        id: row.id,
        date: row.date,
        document: row.document,
        source: row.source,
        project: row.project,
        totalAmount: row.totalAmount,
        paidAmount: row.paidAmount,
        unpaidAmount: row.unpaidAmount,
        includedAmount: Number(row.includeInRecognizedCostAmount.toFixed(2)),
      }))
      .sort(sortBreakdownBillRows)

    const generalExpenseBillRows: ReportSummaryBreakdownBillRow[] = baseBreakdownBillRows
      .filter((row) => row.includeInGeneralExpenseAmount > 0)
      .map((row) => ({
        id: row.id,
        date: row.date,
        document: row.document,
        source: row.source,
        project: row.project,
        totalAmount: row.totalAmount,
        paidAmount: row.paidAmount,
        unpaidAmount: row.unpaidAmount,
        includedAmount: Number(row.includeInGeneralExpenseAmount.toFixed(2)),
      }))
      .sort(sortBreakdownBillRows)

    return {
      recognizedRevenue: {
        title: 'Gross earned breakdown',
        totalLabel: 'Gross earned',
        totalAmount: reportSummaryTotals.totalRecognizedRevenue,
        formula: 'Formula: sum of (progress delta in range x order amount) by project.',
        components: [
          {
            label: 'Gross earned',
            amount: reportSummaryTotals.totalRecognizedRevenue,
          },
          {
            label: 'Cash received in range',
            amount: reportSummaryTotals.totalCashReceivedInRange,
            note: 'Cash is shown as a separate view and is not mixed into recognition profit.',
          },
          {
            label: 'Cash gap vs recognized revenue',
            amount: reportSummaryTotals.totalCashGapVsRecognizedRevenue,
            note: 'Positive means collections are ahead. Negative means collections are behind.',
          },
        ],
        sections: [
          {
            title: 'Gross earned by order',
            rows: recognizedRevenueByOrderRows,
            emptyText: 'No recognized revenue rows found in this range.',
          },
        ],
      },
      recognizedCost: {
        title: 'Total cost breakdown',
        totalLabel: 'Total cost',
        totalAmount: reportSummaryTotals.totalRecognizedCost,
        formula: 'Formula: progress-based labor + progress-based bills + progress-based direct expenses + progress-based pending POs + warranty labor (cost-only in selected range).',
        components: [
          {
            label: 'Labor (progress-based)',
            amount: reportSummaryTotals.totalRecognizedLaborCost,
          },
          {
            label: 'Warranty labor (cost-only)',
            amount: reportSummaryTotals.totalRecognizedWarrantyLaborCost,
          },
          {
            label: 'Bills',
            amount: reportSummaryTotals.totalRecognizedBillsCost,
          },
          {
            label: 'Direct expenses',
            amount: reportSummaryTotals.totalRecognizedDirectExpenseCost,
          },
          {
            label: 'Pending POs',
            amount: reportSummaryTotals.totalRecognizedPendingPOCost,
          },
          {
            label: 'Total cost',
            amount: reportSummaryTotals.totalRecognizedCost,
          },
        ],
        sections: [
          {
            title: 'Total cost by order',
            rows: recognizedCostByOrderRows,
            emptyText: 'No recognized cost rows found in this range.',
          },
        ],
        billRows: recognizedCostBillRows,
        billsEmptyText: 'No bill or direct-expense rows contributed to total cost.',
        includedAmountLabel: 'Included in total cost',
        billsScopeNote: 'Included amount is project bill/direct-expense amount x progress delta for each project. Posting date is not limited to the selected range.',
      },
      projectProfit: {
        title: 'Project profit breakdown',
        totalLabel: 'Project profit',
        totalAmount: reportSummaryTotals.totalRecognizedProfit,
        formula: 'Formula: gross earned - total cost.',
        components: [
          {
            label: 'Gross earned',
            amount: reportSummaryTotals.totalRecognizedRevenue,
          },
          {
            label: 'Total cost',
            amount: Number((-reportSummaryTotals.totalRecognizedCost).toFixed(2)),
          },
          {
            label: 'Project profit',
            amount: reportSummaryTotals.totalRecognizedProfit,
          },
        ],
        sections: [
          {
            title: 'Project profit by order',
            rows: recognizedProfitByOrderRows,
            emptyText: 'No project profit rows found in this range.',
          },
        ],
      },
      generalExpense: {
        title: 'General overhead breakdown',
        totalLabel: 'General overhead',
        totalAmount: reportSummaryTotals.totalGeneralExpense,
        formula: 'Formula: QB general/company purchase bills + QB bills missing project assignment + website payroll (job 0 and unmapped) + QB payroll extra over website payroll.',
        components: [
          ...generalExpenseRows,
        ],
        sections: [
          {
            title: 'General overhead components',
            rows: generalExpenseRows,
            emptyText: 'No general expense components found in this range.',
          },
        ],
        billRows: generalExpenseBillRows,
        billsEmptyText: 'No QuickBooks general/company-purchase/unassigned bill rows found in this range.',
        includedAmountLabel: 'Included in general overhead',
        billsScopeNote: 'This bill list covers QuickBooks general, company purchase, and missing-project bill rows. Payroll extra is shown in components.',
      },
      netStanding: {
        title: 'Net profit breakdown',
        totalLabel: 'Net profit',
        totalAmount: reportSummaryTotals.totalNetStanding,
        formula: 'Formula: project profit - general overhead.',
        components: [
          {
            label: 'Project profit',
            amount: reportSummaryTotals.totalRecognizedProfit,
          },
          {
            label: 'Less general overhead',
            amount: Number((-reportSummaryTotals.totalGeneralExpense).toFixed(2)),
          },
        ],
        sections: [
          {
            title: 'Project profit by order',
            rows: recognizedProfitByOrderRows,
            emptyText: 'No recognized profit rows found in this range.',
          },
          {
            title: 'General overhead components',
            rows: generalExpenseRows.map((row) => ({
              ...row,
              amount: Number((-row.amount).toFixed(2)),
            })),
            emptyText: 'No general expense components found in this range.',
          },
        ],
      },
    }
  }, [
    dateReportRows,
    quickBooksProjectLookupById,
    quickBooksQuery.data?.details?.bills,
    quickBooksQuery.data?.details?.directExpenses,
    reportDateRange,
    reportGeneralExpenseRows,
    reportSpecificJobKeys,
    reportSummaryTotals,
  ])

  const selectedReportSummaryBreakdown = activeReportSummaryBreakdown
    ? reportSummaryBreakdowns[activeReportSummaryBreakdown]
    : null
  const canShowReportSummaryBillRows = Boolean(selectedReportSummaryBreakdown?.billRows)
  const isReportSummaryBillsView = canShowReportSummaryBillRows
    && reportSummaryBreakdownView === 'bills'
  const dateReportReadyRowsInSelectedRange = useMemo(() => {
    if (!dateReportReadyRow || !reportDateRange) {
      return []
    }

    return dateReportReadyRow.readyRows.filter((readyRow) =>
      isDateInRange(readyRow.date, reportDateRange.start, reportDateRange.end),
    )
  }, [dateReportReadyRow, reportDateRange])

  const monthReportExportRows = useMemo(() => {
    if (!reportDateRange) {
      return []
    }

    const projectRows = dateReportRows.map((row) => ({
      rowType: 'Project',
      range: reportDateRangeLabel,
      project: row.jobName,
      hoursInRange: Number(row.totalHours.toFixed(2)),
      websiteLaborInRange: row.totalLaborCost,
      warrantyLaborInRange: row.warrantyLaborCostInRangeAmount,
      qbBillsToEnd: row.totalBillsToRangeEndAmount,
      qbDirectExpensesToEnd: row.totalDirectExpensesToRangeEndAmount,
      pendingPOsToEnd: row.pendingPurchaseOrderToRangeEndAmount,
      projectWideCostBase: row.costBaseToRangeEndAmount,
      progressPrevPercent: row.previousReadyPercent,
      progressEndPercent: row.latestReadyPercent,
      progressDeltaPercent: row.progressDeltaPercent,
      contractValue: row.contractAmount,
      recognizedRevenue: row.recognizedRevenueAmount,
      recognizedLaborCost: row.recognizedLaborCostAmount,
      recognizedWarrantyLaborCost: row.recognizedWarrantyLaborCostAmount,
      recognizedBillsCost: row.recognizedBillsCostAmount,
      recognizedDirectExpenseCost: row.recognizedDirectExpenseCostAmount,
      recognizedPendingPOCost: row.recognizedPendingPOCostAmount,
      recognizedCost: row.recognizedCostAmount,
      recognizedProfit: row.recognizedProfitAmount,
      cashReceivedInRange: row.cashReceivedInRangeAmount,
    }))

    const generalRows = reportGeneralExpenseRows
      .filter((row) => row.amount > 0)
      .map((row) => ({
        rowType: 'General expense',
        range: reportDateRangeLabel,
        project: row.label,
        generalExpenseAmount: row.amount,
        netMonthlyStandingImpact: Number((-row.amount).toFixed(2)),
      }))

    const summaryRow = {
      rowType: 'Summary',
      range: reportDateRangeLabel,
      recognizedProjectRevenueTotal: reportSummaryTotals.totalRecognizedRevenue,
      recognizedProjectCostTotal: reportSummaryTotals.totalRecognizedCost,
      recognizedProjectProfitTotal: reportSummaryTotals.totalRecognizedProfit,
      generalMonthlyExpenseTotal: reportSummaryTotals.totalGeneralExpense,
      netMonthlyStandingTotal: reportSummaryTotals.totalNetStanding,
      cashGapVsRecognizedRevenueTotal: reportSummaryTotals.totalCashGapVsRecognizedRevenue,
    }

    return [...projectRows, ...generalRows, summaryRow]
  }, [
    dateReportRows,
    reportDateRange,
    reportDateRangeLabel,
    reportGeneralExpenseRows,
    reportSummaryTotals,
  ])

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

  const missingManagerInfoByDate = useMemo(() => {
    const entriesByDateJobKey = new Map<string, {
      date: string
      jobName: string
      totalHours: number
      workerIds: Set<string>
    }>()

    entries.forEach((entry) => {
      const date = String(entry.date ?? '').trim()
      const jobName = String(entry.jobName ?? '').trim()
      const normalizedJobName = normalizeJobName(jobName)

      if (!date || !jobName || !normalizedJobName || /^0+$/.test(jobName)) {
        return
      }

      const key = `${date}:${normalizedJobName}`
      const current = entriesByDateJobKey.get(key) ?? {
        date,
        jobName,
        totalHours: 0,
        workerIds: new Set<string>(),
      }

      current.totalHours += getEntryTotalHours(entry)
      current.workerIds.add(entry.workerId)
      entriesByDateJobKey.set(key, current)
    })

    const missingByDate = new Map<string, MissingManagerInfoRow[]>()

    entriesByDateJobKey.forEach((entryGroup, key) => {
      if (orderProgressByDateJobKey.has(key)) {
        return
      }
      const orderMatch = resolveManagerOrderMatch(entryGroup.jobName)

      const currentDateRows = missingByDate.get(entryGroup.date) ?? []
      currentDateRows.push({
        date: entryGroup.date,
        jobName: entryGroup.jobName,
        displayOrderNumber: orderMatch.displayOrderNumber,
        totalHours: entryGroup.totalHours,
        workerCount: entryGroup.workerIds.size,
        matchSource: orderMatch.matchSource,
        isShippedFallback: orderMatch.isShippedFallback,
        hazardReason: orderMatch.hazardReason,
        mondayOrderId: orderMatch.mondayOrderId,
        mondayItemName: orderMatch.mondayItemName,
        shopDrawingUrl: orderMatch.shopDrawingUrl,
        shopDrawingFileName: orderMatch.shopDrawingFileName,
        shopDrawingCachedUrl: orderMatch.shopDrawingCachedUrl,
      })
      missingByDate.set(entryGroup.date, currentDateRows)
    })

    missingByDate.forEach((rows) => {
      rows.sort(
        (left, right) => right.totalHours - left.totalHours || left.jobName.localeCompare(right.jobName),
      )
    })

    return missingByDate
  }, [
    entries,
    orderProgressByDateJobKey,
    resolveManagerOrderMatch,
  ])

  const missingManagerInfoDates = useMemo(
    () => [...missingManagerInfoByDate.keys()].sort(compareDateDesc),
    [missingManagerInfoByDate],
  )

  const missingManagerRows = useMemo<MissingManagerInfoRow[]>(
    () =>
      missingManagerInfoDates.flatMap((date) => {
        const rows = missingManagerInfoByDate.get(date) ?? []
        return rows
      }),
    [missingManagerInfoByDate, missingManagerInfoDates],
  )

  const missingManagerRowsForSelectedDate = useMemo(
    () => missingManagerInfoByDate.get(missingManagerSelectedDate) ?? [],
    [missingManagerInfoByDate, missingManagerSelectedDate],
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
    if (missingManagerInfoDates.length === 0) {
      if (missingManagerSelectedDate) {
        setMissingManagerSelectedDate('')
      }
      return
    }

    if (!missingManagerInfoDates.includes(missingManagerSelectedDate)) {
      setMissingManagerSelectedDate(missingManagerInfoDates[0])
    }
  }, [missingManagerInfoDates, missingManagerSelectedDate])

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
    const nextWarrantyByJob: Record<string, boolean> = {}
    const nextNotesByJob: Record<string, string> = {}
    const nextBenchByJob: Record<string, string> = {}

    managerDayJobs.forEach((jobName) => {
      const key = `${managerSelectedDate}:${normalizeJobName(jobName)}`
      const progress = orderProgressByDateJobKey.get(key)
      const readyPercentLocked = /^0+$/.test(String(jobName ?? '').trim())

      nextDraftByJob[jobName] = readyPercentLocked
        ? ''
        : progress
          ? String(progress.readyPercent)
          : '0'
      nextWarrantyByJob[jobName] = readyPercentLocked
        ? false
        : progress?.isWarranty === true
      nextNotesByJob[jobName] = String(progress?.notes ?? '')
      nextBenchByJob[jobName] = resolveManagerOrderMatch(jobName).bench
    })

    setManagerProgressByJob(nextDraftByJob)
    setManagerWarrantyByJob(nextWarrantyByJob)
    setManagerNotesByJob(nextNotesByJob)
    setManagerBenchByJob(nextBenchByJob)
    setExpandedManagerJobs(new Set())
  }, [managerDayJobs, managerSelectedDate, orderProgressByDateJobKey, resolveManagerOrderMatch])

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

        await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })
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

  const handleSaveDailySheet = async (managerExceptionConfirmed = false) => {
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

    const {
      invalidWorkers,
      syncRows,
      weekOvertimeHoursByWorkerId,
      weekStartIso,
      weekEndIso,
    } = dailySheetPreview

    if (invalidWorkers.length > 0) {
      setError(`Some rows are invalid. Fix: ${invalidWorkers.join(', ')}`)
      return
    }

    if (syncRows.length === 0 && !hasEntriesForDate(entries, bulkDate)) {
      setError('No valid rows to save. Fill job and hours for at least one worker.')
      return
    }

    const findUnmatchedOrderNumbers = (rows: SyncDailyEntryRowInput[]) => {
      const unmatchedOrderNumbers = new Set<string>()

      rows.forEach((row) => {
        const jobName = String(row.jobName ?? '').trim()
        const jobKey = normalizeJobName(jobName)
        const jobDigits = extractDigits(jobName)
        const isGeneralJob = Boolean(jobDigits && /^0+$/.test(jobDigits))

        if (!jobKey || isGeneralJob) {
          return
        }

        const primaryMatch =
          mondayOrderLookup.primaryByNormalizedKey.get(jobKey)
          || (jobDigits ? mondayOrderLookup.primaryByDigits.get(jobDigits) : null)
          || null
        const shippedMatch =
          mondayOrderLookup.shippedByNormalizedKey.get(jobKey)
          || (jobDigits ? mondayOrderLookup.shippedByDigits.get(jobDigits) : null)
          || null

        if (!primaryMatch && !shippedMatch) {
          unmatchedOrderNumbers.add(jobDigits || jobName)
        }
      })

      return [...unmatchedOrderNumbers].sort((left, right) => left.localeCompare(right))
    }

    const unmatchedOrderNumbers = findUnmatchedOrderNumbers(syncRows)

    if (unmatchedOrderNumbers.length > 0 && !managerExceptionConfirmed) {
      setUnknownOrderNumbersPending(unmatchedOrderNumbers)
      setManagerContactConfirmed(false)
      return
    }

    setUnknownOrderNumbersPending([])
    setManagerContactConfirmed(false)

    try {
      const response = await syncDailyEntries(bulkDate, syncRows)

      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })

      let mismatchAlertFailed = false

      if (unmatchedOrderNumbers.length > 0) {
        try {
          await reportTimesheetOrderMismatch({
            date: bulkDate,
            orderNumbers: unmatchedOrderNumbers,
          })
        } catch (notificationError) {
          mismatchAlertFailed = true
          console.error('Could not create timesheet mismatch alert.', notificationError)
        }
      }

      const baseMessage = formatDailySheetSaveMessage(response)
      const workersWithOvertime = [...weekOvertimeHoursByWorkerId.entries()]
        .filter(([, overtimeHours]) => overtimeHours > 0)
        .map(([workerId, overtimeHours]) => {
          const workerName = workersById.get(workerId)?.fullName ?? 'Unknown worker'
          return `${workerName} (${formatHours(overtimeHours)}h OT)`
        })

      const overtimeNotice = workersWithOvertime.length > 0 && weekStartIso && weekEndIso
        ? ` Overtime (${weekStartIso} to ${weekEndIso}): ${workersWithOvertime.join(', ')}.`
        : ''

      if (unmatchedOrderNumbers.length > 0) {
        setSuccess(
          mismatchAlertFailed
            ? `${baseMessage}${overtimeNotice} Unmatched orders were saved, but admin notification failed.`
            : `${baseMessage}${overtimeNotice} Unmatched orders were saved and admin was notified.`,
        )
        return
      }

      setSuccess(`${baseMessage}${overtimeNotice}`)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to save daily sheet.'
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
      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })
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

      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })
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

  useEffect(() => {
    return () => {
      clearShopDrawingPreviewObjectUrl()
    }
  }, [clearShopDrawingPreviewObjectUrl])

  const handleOpenShopDrawingPreview = useCallback(async (row: ManagerProgressRow) => {
    const cachedPreviewUrl = String(row.shopDrawingCachedUrl ?? '').trim()
    const mondayOrderId = String(row.mondayOrderId ?? '').trim()

    if (!cachedPreviewUrl && !mondayOrderId) {
      setError('This order is not linked to a Monday item yet.')
      return
    }

    setError('')
    setSuccess('')
    clearShopDrawingPreviewObjectUrl()
    setShopDrawingPreviewSrc('')
    setIsShopDrawingPreviewLoading(true)
    setShopDrawingPreviewRow(row)

    if (cachedPreviewUrl) {
      setShopDrawingPreviewSrc(cachedPreviewUrl)
      return
    }

    try {
      const query = new URLSearchParams({
        orderId: mondayOrderId,
      })
      const response = await apiFetch(`/api/dashboard/monday/shop-drawing/download?${query.toString()}`)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      shopDrawingPreviewObjectUrlRef.current = objectUrl
      setShopDrawingPreviewSrc(objectUrl)
    } catch (requestError) {
      setIsShopDrawingPreviewLoading(false)
      setShopDrawingPreviewRow(null)
      setShopDrawingPreviewSrc('')
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load shop drawing preview.',
      )
    }
  }, [clearShopDrawingPreviewObjectUrl])

  const handleCloseToast = useCallback(() => {
    setToastState((current) => ({
      ...current,
      open: false,
    }))
  }, [])

  const handleCloseShopDrawingPreview = useCallback(() => {
    clearShopDrawingPreviewObjectUrl()
    setIsShopDrawingPreviewLoading(false)
    setShopDrawingPreviewSrc('')
    setShopDrawingPreviewRow(null)
  }, [clearShopDrawingPreviewObjectUrl])

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

  const handleManagerWarrantyChange = (jobName: string, isWarranty: boolean) => {
    setManagerWarrantyByJob((current) => ({
      ...current,
      [jobName]: isWarranty,
    }))
  }

  const handleManagerNotesChange = (jobName: string, notes: string) => {
    setManagerNotesByJob((current) => ({ ...current, [jobName]: notes }))
  }

  const handleManagerBenchChange = (jobName: string, bench: string) => {
    setManagerBenchByJob((current) => ({ ...current, [jobName]: bench }))
  }

  const toggleManagerWorkers = (jobName: string) => {
    setExpandedManagerJobs((current) => {
      const next = new Set(current)
      if (next.has(jobName)) next.delete(jobName)
      else next.add(jobName)
      return next
    })
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

    const editableRows = managerProgressRows.filter((row) => !row.readyPercentLocked)

    if (editableRows.length === 0) {
      setSuccess('No editable ready % rows for this date.')
      return
    }

    const invalidJobs: string[] = []

    editableRows.forEach((row) => {
      const jobName = row.jobName
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
        editableRows.map((row) =>
          upsertOrderProgress({
            date: managerSelectedDate,
            jobName: row.jobName,
            readyPercent: Number(String(managerProgressByJob[row.jobName] ?? '').trim()),
            isWarranty: row.editIsWarranty,
            notes: row.editNotes,
            bench: row.editBench,
            mondayItemId: row.mondayOrderId,
          }),
        ),
      )

      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })
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

  const buildMissingManagerProgressKey = (date: string, jobName: string) => {
    return `${date}:${normalizeJobName(jobName)}`
  }

  const handleMissingManagerProgressChange = (
    date: string,
    jobName: string,
    value: string,
  ) => {
    const progressKey = buildMissingManagerProgressKey(date, jobName)

    setMissingManagerProgressByKey((current) => ({
      ...current,
      [progressKey]: value,
    }))
  }

  const handleAddMissingManagerInfo = async (row: MissingManagerInfoRow) => {
    const targetDate = String(missingManagerSelectedDate ?? '').trim() || row.date

    if (!targetDate) {
      setError('Date is required before adding manager info.')
      return
    }

    const progressKey = buildMissingManagerProgressKey(targetDate, row.jobName)
    const rawValue = String(missingManagerProgressByKey[progressKey] ?? '0').trim()
    const readyPercent = Number(rawValue)

    if (!rawValue || !Number.isFinite(readyPercent) || readyPercent < 0 || readyPercent > 100) {
      setError(`Enter ready % from 0 to 100 for ${row.jobName}.`)
      return
    }

    setError('')
    setSuccess('')

    try {
      await upsertOrderProgress({
        date: targetDate,
        jobName: row.jobName,
        readyPercent,
      })

      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.timesheetBootstrap })
      setSuccess(`Added manager info for ${row.jobName} on ${targetDate}.`)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to add manager info.'
      setError(message)
    }
  }

  const handleOpenMissingManagerShopDrawingPreview = (row: MissingManagerInfoRow) => {
    void handleOpenShopDrawingPreview({
      jobName: row.jobName,
      displayOrderNumber: row.displayOrderNumber,
      totalHours: row.totalHours,
      workerCount: row.workerCount,
      matchSource: row.matchSource,
      isShippedFallback: row.isShippedFallback,
      hazardReason: row.hazardReason,
      readyPercentLocked: false,
      workerHoursByWorker: [],
      currentReadyPercent: null,
      currentReadyDate: null,
      currentReadyMissingDate: null,
      savedReadyPercent: 0,
      editReadyPercent: 0,
      savedNotes: '',
      editNotes: '',
      bench: '',
      editBench: '',
      savedIsWarranty: false,
      editIsWarranty: false,
      mondayOrderId: row.mondayOrderId,
      mondayBoardId: null,
      mondayItemName: row.mondayItemName,
      shopDrawingUrl: row.shopDrawingUrl,
      shopDrawingFileName: row.shopDrawingFileName,
      shopDrawingCachedUrl: row.shopDrawingCachedUrl,
    })
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

  const exportMonthReportToXlsx = () => {
    if (monthReportExportRows.length === 0) {
      setError('No monthly report rows to export for this range.')
      return
    }

    const scopeToken = reportRangeMode === 'month'
      ? fileNamePart(monthReportMonth)
      : fileNamePart(reportDateRangeLabel)
    const fileBaseName = `view-by-month-${scopeToken}-${todayIsoDate()}`

    exportRowsToXlsx(fileBaseName, monthReportExportRows)
    setSuccess('View By Month exported to Excel.')
  }

  const exportMonthReportToCsv = () => {
    if (monthReportExportRows.length === 0) {
      setError('No monthly report rows to export for this range.')
      return
    }

    const scopeToken = reportRangeMode === 'month'
      ? fileNamePart(monthReportMonth)
      : fileNamePart(reportDateRangeLabel)
    const fileBaseName = `view-by-month-${scopeToken}-${todayIsoDate()}`

    exportRowsToCsv(fileBaseName, monthReportExportRows)
    setSuccess('View By Month exported to CSV.')
  }

  const printMonthReport = () => {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      setError('Print is not available in this environment.')
      return
    }

    window.print()
    setSuccess('Print dialog opened for View By Month.')
  }

  const openWorkerPrintWindow = useCallback((
    title: string,
    rows: TimesheetEntry[],
  ) => {
    if (typeof window === 'undefined') {
      setError('Print is not available in this environment.')
      return false
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer')

    if (!printWindow) {
      setError('Popup blocked. Please allow popups to print this report.')
      return false
    }

    const rowsHtml = rows
      .map((entry) => {
        const workerName = workersById.get(entry.workerId)?.fullName ?? 'Unknown worker'
        const stageName = entry.stageId ? stagesById.get(entry.stageId)?.name ?? 'Unknown stage' : '-'
        const hours = formatHours(getEntryTotalHours(entry))
        const rate = formatCurrency(getEntryRate(entry, workersById))
        const cost = formatCurrency(getEntryCost(entry, workersById))
        const notes = entry.notes?.trim() || '-'

        return `
          <tr>
            <td>${escapeHtml(String(entry.date ?? ''))}</td>
            <td>${escapeHtml(workerName)}</td>
            <td>${escapeHtml(stageName)}</td>
            <td>${escapeHtml(String(entry.jobName ?? '-'))}</td>
            <td class="right">${escapeHtml(hours)}</td>
            <td class="right">${escapeHtml(rate)}</td>
            <td class="right">${escapeHtml(cost)}</td>
            <td>${escapeHtml(notes)}</td>
          </tr>
        `
      })
      .join('')

    const html = `
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 16px; color: #1f2937; }
            h1 { margin: 0 0 4px; font-size: 20px; }
            p { margin: 0 0 12px; color: #4b5563; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; vertical-align: top; }
            th { background: #f3f4f6; text-align: left; }
            .right { text-align: right; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          <p>Generated: ${escapeHtml(new Date().toLocaleString())}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Worker</th>
                <th>Stage</th>
                <th>Job</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()

    return true
  }, [stagesById, workersById])

  const handleOpenWorkerPrintMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setWorkerPrintMenuAnchorEl(event.currentTarget)
  }, [])

  const handleCloseWorkerPrintMenu = useCallback(() => {
    setWorkerPrintMenuAnchorEl(null)
  }, [])

  const handlePrintWorkerReport = useCallback((scope: 'selected' | 'all') => {
    const startDate = workerDateRange.start ?? 'Any'
    const endDate = workerDateRange.end ?? 'Any'
    const rangeLabel = `${startDate} to ${endDate}`

    if (scope === 'selected') {
      if (!workerViewWorkerId) {
        setError('Select a worker first.')
        return
      }

      const workerName = workersById.get(workerViewWorkerId)?.fullName ?? 'Selected worker'

      if (workerFilteredEntries.length === 0) {
        setError('No rows available for this worker in the selected range.')
        return
      }

      const printed = openWorkerPrintWindow(
        `Worker Report - ${workerName} (${rangeLabel})`,
        workerFilteredEntries,
      )

      if (printed) {
        setSuccess(`Print dialog opened for ${workerName}.`)
      }

      handleCloseWorkerPrintMenu()
      return
    }

    const allRowsInRange = sortedEntries.filter((entry) =>
      isDateInRange(entry.date, workerDateRange.start, workerDateRange.end),
    )

    if (allRowsInRange.length === 0) {
      setError('No rows available in the selected range.')
      return
    }

    const printed = openWorkerPrintWindow(
      `Worker Report - All Workers (${rangeLabel})`,
      allRowsInRange,
    )

    if (printed) {
      setSuccess('Print dialog opened for all workers in selected range.')
    }

    handleCloseWorkerPrintMenu()
  }, [
    handleCloseWorkerPrintMenu,
    openWorkerPrintWindow,
    sortedEntries,
    workerDateRange.end,
    workerDateRange.start,
    workerFilteredEntries,
    workerViewWorkerId,
    workersById,
  ])

  return (
    <Stack spacing={isReportsView ? 1.5 : 2.5}>
      {!isReportsView ? (
        <Stack
          direction="row"
          justifyContent="flex-end"
          alignItems="center"
          gap={1.2}
        >
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
              <Tab label="View By Month" value={3} onClick={() => setReportsTab(3)} />
            </>
          ) : (
            <>
              <Tab label="Daily Sheet" value={0} onClick={() => setWorksheetTab(0)} />
              {canAccessManagerSheet ? (
                <Tab label="Manager Progress" value={1} onClick={() => setWorksheetTab(1)} />
              ) : null}
              <Tab label="Missing Info" value={2} onClick={() => setWorksheetTab(2)} />
              <Tab label="Workers" value={3} onClick={() => setWorksheetTab(3)} />
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
                      <TableCell>OT Status</TableCell>
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
                        const hasUnknownOrderNumber =
                          Boolean(String(row.jobName ?? '').trim())
                          && !isKnownTimesheetOrderNumber(row.jobName)

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
                            <TableCell sx={{ minWidth: 220 }}>
                              <Autocomplete
                                freeSolo
                                size="small"
                                options={timesheetOrderNumberOptions}
                                value={row.jobName}
                                inputValue={row.jobName}
                                autoHighlight
                                openOnFocus
                                clearOnBlur={false}
                                onChange={(_event, value) =>
                                  handleBulkRowChange(
                                    row.id,
                                    'jobName',
                                    String(value ?? ''),
                                  )
                                }
                                onInputChange={(_event, value) =>
                                  handleBulkRowChange(row.id, 'jobName', value)
                                }
                                noOptionsText="No matching order number"
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    fullWidth
                                    placeholder="Search order number"
                                    error={hasUnknownOrderNumber}
                                    helperText={
                                      hasUnknownOrderNumber
                                        ? 'Not in the current order list. Manager confirmation is required to save.'
                                        : 'Start typing to narrow the order list.'
                                    }
                                  />
                                )}
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
                            <TableCell sx={{ minWidth: 180 }}>
                              {(() => {
                                const overtimeHours = dailySheetPreview.overtimeByRowId.get(row.id) ?? 0
                                const weekOvertimeHours = dailySheetPreview.weekOvertimeHoursByWorkerId.get(row.workerId) ?? 0
                                const weekTotalHours = dailySheetPreview.weekTotalHoursByWorkerId.get(row.workerId) ?? 0

                                if (overtimeHours <= 0) {
                                  return (
                                    <Typography variant="body2" color="text.secondary">
                                      Regular
                                    </Typography>
                                  )
                                }

                                return (
                                  <Stack spacing={0.2}>
                                    <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 700 }}>
                                      Overtime: {formatHours(overtimeHours)}h
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'error.main' }}>
                                      Week total {formatHours(weekTotalHours)}h, OT {formatHours(weekOvertimeHours)}h
                                    </Typography>
                                  </Stack>
                                )
                              })()}
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
                <Button
                  variant="contained"
                  onClick={() => {
                    void handleSaveDailySheet(false)
                  }}
                >
                  Save Daily Sheet
                </Button>
              </Stack>

              <Typography variant="body2" color="text.secondary">
                {!canAccessManagerSheet
                  ? 'Manager Progress tab is available for manager or admin accounts only.'
                  : 'Use the Manager Progress tab to update ready percentages by date.'}
              </Typography>

              <Typography variant="caption" color="text.secondary">
                Overtime is auto-calculated each payroll week (Thursday to Wednesday). Enter only total hours.
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

                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        justifyContent="flex-end"
                      >
                        <Button
                          variant="outlined"
                          startIcon={
                            expandedManagerJobs.size === managerProgressRows.length
                              ? <UnfoldLessRoundedIcon />
                              : <UnfoldMoreRoundedIcon />
                          }
                          onClick={() => {
                            setExpandedManagerJobs((current) => (
                              current.size === managerProgressRows.length
                                ? new Set()
                                : new Set(managerProgressRows.map((row) => row.jobName))
                            ))
                          }}
                        >
                          {expandedManagerJobs.size === managerProgressRows.length
                            ? 'Collapse workers'
                            : 'Expand workers'}
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => setMissingManagerDialogOpen(true)}
                          disabled={missingManagerRows.length === 0}
                        >
                          {`Missing Manager Info (${missingManagerRows.length})`}
                        </Button>
                        <Button
                          variant="contained"
                          onClick={() => void handleSaveManagerProgress()}
                          disabled={isSavingManagerProgress || managerProgressRows.length === 0}
                        >
                          {isSavingManagerProgress ? 'Saving...' : 'Save'}
                        </Button>
                      </Stack>

                      <Typography variant="body2" color="text.secondary">
                        Yellow rows are fallback matches from the Shipped Orders board. Order number 0 is a general line and does not accept ready % updates.
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
                              <TableCell>Bench</TableCell>
                              <TableCell align="right">Current ready %</TableCell>
                              <TableCell align="right">Set ready %</TableCell>
                              <TableCell>Notes</TableCell>
                              <TableCell align="center">Warranty</TableCell>
                              <TableCell align="center">Expand</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {managerProgressRows.map((row) => {
                              const workersExpanded = expandedManagerJobs.has(row.jobName)

                              return (
                                <Fragment key={row.jobName}>
                                  <TableRow
                                    hover
                                    sx={
                                      row.isShippedFallback
                                        ? {
                                          backgroundColor: 'rgba(245, 158, 11, 0.16)',
                                          '&:hover': {
                                            backgroundColor: 'rgba(245, 158, 11, 0.22)',
                                          },
                                        }
                                        : undefined
                                    }
                                  >
                                <TableCell>{row.displayOrderNumber || row.jobName}</TableCell>
                                <TableCell>
                                  {row.mondayItemName ? (
                                    <Stack spacing={0.3}>
                                      <Typography variant="body2">{row.mondayItemName}</Typography>
                                      {row.isShippedFallback ? (
                                        <Typography variant="caption" color="warning.dark" fontWeight={700}>
                                          From shipped board
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  ) : (
                                    <Stack spacing={0.3}>
                                      <Typography variant="body2" color="text.secondary">
                                        Not available
                                      </Typography>
                                      {row.isShippedFallback ? (
                                        <Typography variant="caption" color="warning.dark" fontWeight={700}>
                                          From shipped board
                                        </Typography>
                                      ) : null}
                                    </Stack>
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
                                      onClick={() => toggleManagerWorkers(row.jobName)}
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
                                <TableCell sx={{ minWidth: 190 }}>
                                  {row.readyPercentLocked ? (
                                    <Typography variant="body2" color="text.secondary">N/A</Typography>
                                  ) : (
                                    <Autocomplete
                                      freeSolo
                                      size="small"
                                      options={workers.map((worker) => worker.fullName)}
                                      value={row.editBench}
                                      onInputChange={(_event, value) => {
                                        handleManagerBenchChange(row.jobName, value)
                                      }}
                                      renderInput={(params) => (
                                        <TextField {...params} placeholder="Worker name" />
                                      )}
                                    />
                                  )}
                                </TableCell>
                                <TableCell align="right">
                                  {row.readyPercentLocked
                                    ? (
                                      <Typography variant="body2" color="text.secondary">
                                        N/A
                                      </Typography>
                                    )
                                    : row.currentReadyMissingDate
                                      ? (
                                        <Stack spacing={0.2} alignItems="flex-end">
                                          <Typography variant="body2" color="error.main" fontWeight={700}>
                                            Missing
                                          </Typography>
                                          <Typography variant="caption" color="error.main">
                                            {formatManagerDateLabel(row.currentReadyMissingDate)}
                                          </Typography>
                                        </Stack>
                                      )
                                      : row.currentReadyPercent === null
                                        ? '-'
                                        : (
                                          <Stack spacing={0.2} alignItems="flex-end">
                                            <Typography variant="body2">
                                              {`${row.currentReadyPercent.toFixed(1)}%`}
                                            </Typography>
                                            {row.currentReadyDate ? (
                                              <Typography variant="caption" color="text.secondary">
                                                {formatManagerDateLabel(row.currentReadyDate)}
                                              </Typography>
                                            ) : null}
                                          </Stack>
                                        )}
                                </TableCell>
                                <TableCell align="right" sx={{ width: 180 }}>
                                  {row.readyPercentLocked ? (
                                    <Typography variant="body2" color="text.secondary">
                                      N/A
                                    </Typography>
                                  ) : (
                                    <TextField
                                      size="small"
                                      type="number"
                                      value={row.editReadyPercent.toString()}
                                      onChange={(event) =>
                                        handleManagerProgressChange(row.jobName, event.target.value)
                                      }
                                      inputProps={{ min: 0, max: 100, step: 1 }}
                                    />
                                  )}
                                </TableCell>

                                <TableCell sx={{ minWidth: 240 }}>
                                  {row.readyPercentLocked ? (
                                    <Typography variant="body2" color="text.secondary">N/A</Typography>
                                  ) : (
                                    <TextField
                                      size="small"
                                      value={row.editNotes}
                                      placeholder="What was built or next steps"
                                      multiline
                                      minRows={1}
                                      maxRows={4}
                                      fullWidth
                                      onChange={(event) => {
                                        handleManagerNotesChange(row.jobName, event.target.value)
                                      }}
                                    />
                                  )}
                                </TableCell>

                                <TableCell align="center" sx={{ width: 120 }}>
                                  {row.readyPercentLocked ? (
                                    <Typography variant="body2" color="text.secondary">
                                      N/A
                                    </Typography>
                                  ) : (
                                    <Checkbox
                                      checked={row.editIsWarranty}
                                      onChange={(event) =>
                                        handleManagerWarrantyChange(row.jobName, event.target.checked)
                                      }
                                    />
                                  )}
                                </TableCell>
                                <TableCell align="center" sx={{ width: 76 }}>
                                  <IconButton
                                    size="small"
                                    disabled={row.workerCount === 0}
                                    aria-label={workersExpanded ? 'Collapse workers' : 'Expand workers'}
                                    onClick={() => toggleManagerWorkers(row.jobName)}
                                  >
                                    {workersExpanded
                                      ? <ExpandLessRoundedIcon />
                                      : <ExpandMoreRoundedIcon />}
                                  </IconButton>
                                </TableCell>
                                  </TableRow>

                                  {workersExpanded ? (
                                    <TableRow>
                                      <TableCell
                                        colSpan={11}
                                        sx={{
                                          py: 1.25,
                                          backgroundColor: 'rgba(15, 23, 42, 0.025)',
                                        }}
                                      >
                                        <Stack spacing={0.65}>
                                          <Typography variant="caption" color="text.secondary" fontWeight={800}>
                                            WORKERS ON THIS ORDER
                                          </Typography>
                                          {row.workerHoursByWorker.map((workerRow) => (
                                            <Stack
                                              key={`${row.jobName}:${workerRow.workerId}`}
                                              direction="row"
                                              justifyContent="space-between"
                                              alignItems="center"
                                              sx={{
                                                maxWidth: 520,
                                                px: 1.25,
                                                py: 0.65,
                                                borderRadius: 1,
                                                bgcolor: 'background.paper',
                                                border: '1px solid',
                                                borderColor: 'divider',
                                              }}
                                            >
                                              <Typography variant="body2" fontWeight={700}>
                                                {workerRow.workerName}
                                              </Typography>
                                              <Typography variant="body2" color="text.secondary">
                                                {formatHours(workerRow.hours)} h
                                              </Typography>
                                            </Stack>
                                          ))}
                                        </Stack>
                                      </TableCell>
                                    </TableRow>
                                  ) : null}
                                </Fragment>
                              )
                            })}
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
            <Stack spacing={2.25}>
              <QuickBooksPage />

              <Paper variant="outlined" sx={{ p: 2.25 }}>
                <Stack spacing={1.5}>
                  <Typography variant="h6" fontWeight={700}>
                    Report Summary Extras
                  </Typography>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(1, minmax(0, 1fr))',
                        md: 'repeat(2, minmax(0, 1fr))',
                      },
                      gap: 1.5,
                    }}
                  >
                    <Paper variant="outlined" sx={{ ...REPORT_SUMMARY_CARD_SX, borderLeft: '4px solid #1565c0' }}>
                      <Typography variant="body2" color="text.secondary">
                        Total hours logged
                      </Typography>
                      <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                        {formatHours(totals.totalHours)} h
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Includes all entries (before and after shipped).
                      </Typography>
                    </Paper>

                    <Paper variant="outlined" sx={{ ...REPORT_SUMMARY_CARD_SX, borderLeft: '4px solid #2e7d32' }}>
                      <Typography variant="body2" color="text.secondary">
                        Total cost for logged hours
                      </Typography>
                      <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                        {formatCurrency(totals.totalSpend)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Includes overtime labor at 1.5x rate.
                      </Typography>
                    </Paper>
                  </Box>
                </Stack>
              </Paper>
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

              <TableContainer sx={REPORT_VIEW_BY_JOB_TABLE_CONTAINER_SX}>
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
                Worker Report
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
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
                  <MenuItem value="all">All time (default)</MenuItem>
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

              <Typography variant="body2" color="text.secondary">
                Range: {workerDateRange.start ?? 'Any'} to {workerDateRange.end ?? 'Any'}
              </Typography>

              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', md: 'center' }}
                gap={1.2}
              >
                <TextField
                  select
                  fullWidth
                  label="Selected worker"
                  value={workerViewWorkerId}
                  onChange={(event) => setWorkerViewWorkerId(event.target.value)}
                >
                  {workerReportRows.length === 0 ? (
                    <MenuItem disabled value="">
                      No workers in selected range
                    </MenuItem>
                  ) : null}

                  {workerReportRows.map((workerRow) => (
                    <MenuItem key={workerRow.workerId} value={workerRow.workerId}>
                      {workerRow.workerName}
                    </MenuItem>
                  ))}
                </TextField>

                <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                  <Button
                    variant="outlined"
                    startIcon={<PrintRoundedIcon />}
                    onClick={handleOpenWorkerPrintMenu}
                  >
                    Print report
                  </Button>

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

              <Menu
                anchorEl={workerPrintMenuAnchorEl}
                open={Boolean(workerPrintMenuAnchorEl)}
                onClose={handleCloseWorkerPrintMenu}
              >
                <MenuItem onClick={() => handlePrintWorkerReport('selected')}>
                  Print report for user
                </MenuItem>
                <MenuItem onClick={() => handlePrintWorkerReport('all')}>
                  Print all
                </MenuItem>
              </Menu>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Worker</TableCell>
                      <TableCell>What was done (jobs)</TableCell>
                      <TableCell align="right">Hours in range</TableCell>
                      <TableCell align="right">Labor cost in range</TableCell>
                      <TableCell align="right">Progress made</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workerReportRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography color="text.secondary">
                            No worker activity in selected range.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      workerReportRows.map((row) => {
                        const jobsPreview = [...row.jobNames]
                          .sort((left, right) => left.localeCompare(right))
                          .slice(0, 4)
                        const hasMoreJobs = row.jobNames.size > jobsPreview.length

                        return (
                          <TableRow
                            key={row.workerId}
                            hover
                            selected={row.workerId === workerViewWorkerId}
                            onClick={() => setWorkerViewWorkerId(row.workerId)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>{row.workerName}</TableCell>
                            <TableCell>
                              {jobsPreview.length > 0
                                ? `${jobsPreview.join(', ')}${hasMoreJobs ? ', ...' : ''}`
                                : '-'}
                            </TableCell>
                            <TableCell align="right">{formatHours(row.totalHours)}</TableCell>
                            <TableCell align="right">{formatCurrency(row.totalCost)}</TableCell>
                            <TableCell align="right">
                              <Typography
                                fontWeight={700}
                                color={row.progressContributionPercent > 0 ? 'success.main' : 'text.secondary'}
                              >
                                {`${row.progressContributionPercent.toFixed(1)}%`}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1.2}
              >
                <Typography variant="body2" color="text.secondary">
                  Selected worker details
                </Typography>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Hours in range
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(selectedWorkerReportRow?.totalHours ?? 0)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Regular hours
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatHours(selectedWorkerHoursBreakdown.regularHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Overtime hours
                  </Typography>
                  <Typography variant="h6" fontWeight={700} color={selectedWorkerHoursBreakdown.overtimeHours > 0 ? 'error.main' : 'text.primary'}>
                    {formatHours(selectedWorkerHoursBreakdown.overtimeHours)} h
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Cost in range
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {formatCurrency(selectedWorkerReportRow?.totalCost ?? 0)}
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

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Progress made
                  </Typography>
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    color={(selectedWorkerReportRow?.progressContributionPercent ?? 0) > 0
                      ? 'success.main'
                      : 'text.primary'}
                  >
                    {`${(selectedWorkerReportRow?.progressContributionPercent ?? 0).toFixed(1)}%`}
                  </Typography>
                </Paper>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    md: 'repeat(2, minmax(0, 1fr))',
                  },
                  gap: 1.25,
                }}
              >
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
              </Box>
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
                  Financial Report (Month Or Specific Dates)
                </Typography>

                <Stack spacing={1} sx={{ width: { xs: '100%', md: 'auto' } }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      select
                      label="Report type"
                      value={reportRangeMode}
                      onChange={(event) => setReportRangeMode(event.target.value as ReportRangeMode)}
                      sx={{ minWidth: 170 }}
                    >
                      <MenuItem value="month">By month</MenuItem>
                      <MenuItem value="custom">Specific dates</MenuItem>
                    </TextField>

                    {reportRangeMode === 'month' ? (
                      <TextField
                        select
                        label="Month"
                        value={monthReportMonth}
                        onChange={(event) => setMonthReportMonth(event.target.value)}
                        sx={{ maxWidth: 220 }}
                      >
                        {reportMonthOptions.length === 0 ? (
                          <MenuItem value="" disabled>
                            No months available
                          </MenuItem>
                        ) : null}

                        {reportMonthOptions.map((monthKey) => (
                          <MenuItem key={monthKey} value={monthKey}>
                            {formatMonthKeyLabel(monthKey)}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <>
                        <TextField
                          type="date"
                          label="Start date"
                          value={customReportStartDate}
                          onChange={(event) => setCustomReportStartDate(event.target.value)}
                          InputLabelProps={{ shrink: true }}
                          sx={{ minWidth: 180 }}
                        />

                        <TextField
                          type="date"
                          label="End date"
                          value={customReportEndDate}
                          onChange={(event) => setCustomReportEndDate(event.target.value)}
                          InputLabelProps={{ shrink: true }}
                          sx={{ minWidth: 180 }}
                        />
                      </>
                    )}
                  </Stack>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
                    <Button
                      variant="outlined"
                      startIcon={<FileDownloadRoundedIcon />}
                      onClick={exportMonthReportToXlsx}
                      disabled={monthReportExportRows.length === 0}
                    >
                      Download XL
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={<FileDownloadRoundedIcon />}
                      onClick={exportMonthReportToCsv}
                      disabled={monthReportExportRows.length === 0}
                    >
                      Download CSV
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={<PrintRoundedIcon />}
                      onClick={printMonthReport}
                    >
                      Print
                    </Button>
                  </Stack>
                </Stack>
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Selected range: {reportDateRangeLabel}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Gross earned is progress-based. Cost uses project-wide posted costs plus warranty labor marked in the selected range.
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    md: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(5, minmax(0, 1fr))',
                  },
                  gap: 1.25,
                }}
              >
                <Paper
                  variant="outlined"
                  onClick={() => handleOpenReportSummaryBreakdown('generalExpense')}
                  sx={{
                    ...REPORT_SUMMARY_CARD_SX,
                    borderLeft: '4px solid #2e7d32',
                    cursor: 'pointer',
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    General Overhead
                  </Typography>
                  <Typography variant="h5" fontWeight={800}>
                    {formatCurrency(reportSummaryTotals.totalGeneralExpense)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Includes QB general/company purchase/unassigned + payroll adjustments.
                  </Typography>
                </Paper>

                <Paper
                  variant="outlined"
                  onClick={() => handleOpenReportSummaryBreakdown('recognizedRevenue')}
                  sx={{
                    ...REPORT_SUMMARY_CARD_SX,
                    borderLeft: '4px solid #0d47a1',
                    cursor: 'pointer',
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Gross Earned
                  </Typography>
                  <Typography variant="h5" fontWeight={800}>
                    {formatCurrency(reportSummaryTotals.totalRecognizedRevenue)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Order amount x progress delta across all orders.
                  </Typography>
                </Paper>

                <Paper
                  variant="outlined"
                  onClick={() => handleOpenReportSummaryBreakdown('recognizedCost')}
                  sx={{
                    ...REPORT_SUMMARY_CARD_SX,
                    borderLeft: '4px solid #6d4c41',
                    cursor: 'pointer',
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Total Cost
                  </Typography>
                  <Typography variant="h5" fontWeight={800}>
                    {formatCurrency(reportSummaryTotals.totalRecognizedCost)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Progress-based cost base plus warranty labor marked for this range.
                  </Typography>
                </Paper>

                <Paper
                  variant="outlined"
                  onClick={() => handleOpenReportSummaryBreakdown('projectProfit')}
                  sx={{
                    ...REPORT_SUMMARY_CARD_SX,
                    borderLeft: '4px solid #1b5e20',
                    cursor: 'pointer',
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Project Profit
                  </Typography>
                  <Typography variant="h5" fontWeight={800}>
                    {formatCurrency(reportSummaryTotals.totalRecognizedProfit)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Gross earned minus total cost.
                  </Typography>
                </Paper>

                <Paper
                  variant="outlined"
                  onClick={() => handleOpenReportSummaryBreakdown('netStanding')}
                  sx={{
                    ...REPORT_SUMMARY_CARD_SX,
                    borderLeft: reportSummaryTotals.totalNetStanding >= 0
                      ? '4px solid #2e7d32'
                      : '4px solid #c62828',
                    cursor: 'pointer',
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&:hover': {
                      boxShadow: 3,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Net Profit
                  </Typography>
                  <Typography
                    variant="h5"
                    fontWeight={800}
                    color={reportSummaryTotals.totalNetStanding >= 0 ? 'success.main' : 'error.main'}
                  >
                    {formatCurrency(reportSummaryTotals.totalNetStanding)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Project profit minus general overhead.
                  </Typography>
                </Paper>
              </Box>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table
                  size="small"
                  stickyHeader
                  sx={{
                    minWidth: 1320,
                    '& .MuiTableCell-root': {
                      py: 0.8,
                    },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>Order</TableCell>
                      <TableCell align="right">Labor</TableCell>
                      <TableCell align="right">Bills &amp; Costs</TableCell>
                      <TableCell align="right">Ready %</TableCell>
                      <TableCell align="right">Order Amount</TableCell>
                      <TableCell align="right">Earned</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">Profit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dateReportRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <Typography color="text.secondary">
                            No orders found for the selected range.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      dateReportRows.map((row) => {
                        const fullBillsAmount = Number(row.totalBillsToRangeEndAmount.toFixed(2))
                        const projectedLaborAmount = row.progressDeltaPercent > 0
                          ? Number((row.totalLaborCost / (row.progressDeltaPercent / 100)).toFixed(2))
                          : null
                        const displayCostAmount = projectedLaborAmount === null
                          ? null
                          : Number((fullBillsAmount + projectedLaborAmount).toFixed(2))

                        const laborDisplayValue = projectedLaborAmount === null
                          ? 'No Projection'
                          : formatCurrency(projectedLaborAmount)
                        const costDisplayValue = displayCostAmount === null
                          ? 'No Projection'
                          : formatCurrency(displayCostAmount)

                        const laborDisplayColor = projectedLaborAmount === null
                          ? 'error.main'
                          : row.progressDeltaPercent !== 100
                            ? 'warning.main'
                            : 'primary.main'
                        const costDisplayColor = displayCostAmount === null
                          ? 'error.main'
                          : 'text.primary'

                        const billsAndCostsAmount = Number(fullBillsAmount.toFixed(2))

                        return (
                          <TableRow key={row.jobName} hover>
                            <TableCell sx={{ minWidth: 200 }}>{row.jobName}</TableCell>

                            <TableCell align="right">
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => setDateReportLaborRow(row)}
                                sx={{
                                  color: laborDisplayColor,
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
                                {laborDisplayValue}
                              </Button>
                            </TableCell>

                            <TableCell align="right">
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => setDateReportBillsCostsRow(row)}
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
                                {formatCurrency(billsAndCostsAmount)}
                              </Button>
                            </TableCell>

                            <TableCell align="right">
                              <Button
                                variant="text"
                                size="small"
                                onClick={() => setDateReportReadyRow(row)}
                                sx={{
                                  color:
                                    row.progressDeltaPercent > 0
                                      ? 'success.main'
                                      : row.progressDeltaPercent < 0
                                        ? 'error.main'
                                        : 'text.secondary',
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
                                {`${row.progressDeltaPercent.toFixed(1)}%`}
                              </Button>
                            </TableCell>

                            <TableCell align="right">
                              <Typography fontWeight={700}>
                                {row.invoiceCount <= 0 && row.orderAmountDisplay === 0
                                  ? '-'
                                  : formatCurrency(row.orderAmountDisplay)}
                              </Typography>
                            </TableCell>

                            <TableCell align="right">
                              <Typography fontWeight={700} color={row.recognizedRevenueAmount >= 0 ? 'success.main' : 'error.main'}>
                                {formatCurrency(row.recognizedRevenueAmount)}
                              </Typography>
                            </TableCell>

                            <TableCell align="right">
                              <Typography fontWeight={700} color={costDisplayColor}>
                                {costDisplayValue}
                              </Typography>
                            </TableCell>

                            <TableCell align="right">
                              <Typography fontWeight={700} color={row.recognizedProfitAmount >= 0 ? 'success.main' : 'error.main'}>
                                {formatCurrency(row.recognizedProfitAmount)}
                              </Typography>
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
                  Missing Info
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
                      {formatMissingInfoDateLabel(date)}
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

          {!isReportsView && worksheetTab === 3 ? (
            <WorkersPage />
          ) : null}
        </Box>
      </Paper>

      <Dialog
        open={unknownOrderNumbersPending.length > 0}
        onClose={() => {
          setUnknownOrderNumbersPending([])
          setManagerContactConfirmed(false)
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <WarningAmberRoundedIcon color="warning" />
            <Typography component="span" variant="h6" fontWeight={800}>
              Order Number Not Found
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="warning">
              The following order number{unknownOrderNumbersPending.length === 1 ? ' is' : 's are'} not
              on the current Orders Track or Shipped Orders page.
            </Alert>

            <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
              {unknownOrderNumbersPending.map((orderNumber) => (
                <Box
                  key={orderNumber}
                  sx={{
                    px: 1.2,
                    py: 0.65,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'warning.main',
                    bgcolor: 'warning.50',
                    color: 'warning.dark',
                    fontWeight: 800,
                  }}
                >
                  {orderNumber}
                </Box>
              ))}
            </Stack>

            <Typography variant="body2">
              Check the number carefully. If this is a valid exception, you must speak with a manager
              before saving it. An admin will be notified after it is submitted.
            </Typography>

            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Checkbox
                checked={managerContactConfirmed}
                onChange={(event) => setManagerContactConfirmed(event.target.checked)}
                inputProps={{ 'aria-label': 'Confirm manager approval' }}
              />
              <Box sx={{ pt: 0.7 }}>
                <Typography variant="body2" fontWeight={700}>
                  I confirm that I spoke with a manager about this order number.
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setUnknownOrderNumbersPending([])
              setManagerContactConfirmed(false)
            }}
          >
            Go Back
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!managerContactConfirmed}
            onClick={() => {
              void handleSaveDailySheet(true)
            }}
          >
            Confirm and Save
          </Button>
        </DialogActions>
      </Dialog>

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
        open={missingManagerDialogOpen}
        onClose={() => setMissingManagerDialogOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Missing Manager Info</DialogTitle>
        <DialogContent dividers>
          {missingManagerRows.length === 0 ? (
            <Typography color="text.secondary">
              No missing manager updates right now.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
              >
                <TextField
                  select
                  label="Missing dates"
                  size="small"
                  value={missingManagerSelectedDate}
                  onChange={(event) => setMissingManagerSelectedDate(event.target.value)}
                  sx={{ minWidth: 260 }}
                >
                  {missingManagerInfoDates.map((date) => (
                    <MenuItem key={date} value={date}>
                      {formatMissingInfoDateLabel(date)}
                    </MenuItem>
                  ))}
                </TextField>

                <Button
                  variant="outlined"
                  disabled={!missingManagerSelectedDate}
                  onClick={() => {
                    if (missingManagerSelectedDate) {
                      handleSelectManagerDate(missingManagerSelectedDate)
                    }
                    setMissingManagerDialogOpen(false)
                  }}
                >
                  Open Selected Day in Manager Progress
                </Button>
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Date: {missingManagerSelectedDate ? formatMissingInfoDateLabel(missingManagerSelectedDate) : 'None selected'}
              </Typography>

              <TableContainer sx={WORKSHEET_TABLE_CONTAINER_SX}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Order Number</TableCell>
                      <TableCell>Item</TableCell>
                      <TableCell>Shop Drawing</TableCell>
                      <TableCell align="right">Total Hours</TableCell>
                      <TableCell align="right">Workers</TableCell>
                      <TableCell align="right">Set Ready %</TableCell>
                      <TableCell align="right">Add</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {missingManagerRowsForSelectedDate.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography color="text.secondary">No missing orders for the selected date.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      missingManagerRowsForSelectedDate.map((row) => {
                        const progressKey = buildMissingManagerProgressKey(row.date, row.jobName)
                        const draftReadyPercent = String(missingManagerProgressByKey[progressKey] ?? '0')

                        return (
                          <TableRow key={`${row.date}:${row.jobName}`} hover>
                            <TableCell>{row.displayOrderNumber || row.jobName}</TableCell>
                            <TableCell>
                              {row.mondayItemName ? (
                                <Stack spacing={0.3}>
                                  <Typography variant="body2">{row.mondayItemName}</Typography>
                                  {row.isShippedFallback ? (
                                    <Typography variant="caption" color="warning.dark" fontWeight={700}>
                                      From shipped board
                                    </Typography>
                                  ) : null}
                                </Stack>
                              ) : (
                                <Typography variant="body2" color="text.secondary">Not available</Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.shopDrawingCachedUrl || (row.shopDrawingUrl && row.mondayOrderId) ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<VisibilityRoundedIcon fontSize="small" />}
                                  onClick={() => {
                                    handleOpenMissingManagerShopDrawingPreview(row)
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
                            <TableCell align="right">{formatHours(row.totalHours)} h</TableCell>
                            <TableCell align="right">{row.workerCount}</TableCell>
                            <TableCell align="right" sx={{ width: 150 }}>
                              <TextField
                                size="small"
                                type="number"
                                value={draftReadyPercent}
                                onChange={(event) => {
                                  handleMissingManagerProgressChange(row.date, row.jobName, event.target.value)
                                }}
                                inputProps={{ min: 0, max: 100, step: 1 }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => {
                                  void handleAddMissingManagerInfo(row)
                                }}
                              >
                                Add
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
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMissingManagerDialogOpen(false)}>Close</Button>
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
            {isShopDrawingPreviewLoading && !shopDrawingPreviewSrc ? (
              <Stack
                spacing={1}
                alignItems="center"
                justifyContent="center"
                sx={{
                  height: { xs: '56vh', md: '64vh' },
                  p: 2,
                }}
              >
                <CircularProgress size={28} />
                <Typography variant="body2" color="text.secondary">
                  Loading preview...
                </Typography>
              </Stack>
            ) : shopDrawingPreviewSrc ? (
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

                <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Labor split before/after shipped
                  </Typography>
                  <TableContainer sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Period</TableCell>
                          <TableCell align="right">Hours</TableCell>
                          <TableCell align="right">Labor cost</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>Before shipped</TableCell>
                          <TableCell align="right">
                            {formatHours(selectedJobPostShippedSummary.beforeTotals.totalHours)} h
                          </TableCell>
                          <TableCell align="right">
                            {formatCurrency(selectedJobPostShippedSummary.beforeTotals.totalCost)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>After shipped</TableCell>
                          <TableCell align="right">
                            {formatHours(selectedJobPostShippedSummary.afterTotals.totalHours)} h
                          </TableCell>
                          <TableCell align="right">
                            {formatCurrency(selectedJobPostShippedSummary.afterTotals.totalCost)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700}>Total</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatHours(selectedJobSummary.totalHours)} h</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight={700}>{formatCurrency(selectedJobSummary.totalCost)}</Typography>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Labor cost includes overtime at 1.5x.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Shipped date: {selectedJobPostShippedSummary.shippedSinceDate ?? '-'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Matched order: {selectedJobPostShippedSummary.matchedOrderId ?? '-'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Source: {selectedJobPostShippedSummary.sourceLabel ?? '-'}
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
                      <TableCell align="right">Total hours</TableCell>
                      <TableCell align="right">Ready %</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedJobDateReadyRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Typography color="text.secondary">No dates found for this job.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedJobDateReadyRows.map((row) => (
                        <TableRow key={row.date} hover>
                          <TableCell>{row.date}</TableCell>
                          <TableCell align="right">{formatHours(row.totalHours)}</TableCell>
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

      <Dialog
        open={Boolean(selectedReportSummaryBreakdown)}
        onClose={handleCloseReportSummaryBreakdown}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {selectedReportSummaryBreakdown?.title ?? 'Report Breakdown'}
        </DialogTitle>
        <DialogContent dividers>
          {!selectedReportSummaryBreakdown ? null : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {selectedReportSummaryBreakdown.formula}
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Component</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedReportSummaryBreakdown.components.map((row) => (
                      <TableRow key={`component-${row.label}`} hover>
                        <TableCell>{row.label}</TableCell>
                        <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow sx={{ bgcolor: 'action.selected' }}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700}>
                          {selectedReportSummaryBreakdown.totalLabel}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={700}>
                          {formatCurrency(selectedReportSummaryBreakdown.totalAmount)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>

              {canShowReportSummaryBillRows ? (
                <Tabs
                  value={reportSummaryBreakdownView}
                  onChange={(_event, nextValue) => {
                    setReportSummaryBreakdownView(nextValue as ReportSummaryBreakdownView)
                  }}
                >
                  <Tab value="byJob" label="By job" />
                  <Tab value="bills" label="Bills list" />
                </Tabs>
              ) : null}

              {isReportSummaryBillsView ? (
                <Stack spacing={1.2}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedReportSummaryBreakdown.billsScopeNote ?? 'Bill-by-bill list for this total.'}
                  </Typography>

                  {!selectedReportSummaryBreakdown.billRows
                  || selectedReportSummaryBreakdown.billRows.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {selectedReportSummaryBreakdown.billsEmptyText ?? 'No bill rows found.'}
                    </Typography>
                  ) : (
                    <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, maxHeight: 420 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Bill</TableCell>
                            <TableCell>Project</TableCell>
                            <TableCell>Order/Category</TableCell>
                            <TableCell align="right">Bill Amount</TableCell>
                            <TableCell align="right">Paid</TableCell>
                            <TableCell align="right">Unpaid</TableCell>
                            <TableCell align="right">
                              {selectedReportSummaryBreakdown.includedAmountLabel ?? 'Included'}
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {selectedReportSummaryBreakdown.billRows.map((row) => (
                            <TableRow key={row.id} hover>
                              <TableCell>{row.date || '-'}</TableCell>
                              <TableCell>{row.document}</TableCell>
                              <TableCell>{row.project}</TableCell>
                              <TableCell>{row.source}</TableCell>
                              <TableCell align="right">{formatCurrency(row.totalAmount)}</TableCell>
                              <TableCell align="right">{formatCurrency(row.paidAmount)}</TableCell>
                              <TableCell align="right">{formatCurrency(row.unpaidAmount)}</TableCell>
                              <TableCell align="right">
                                <Typography fontWeight={700}>{formatCurrency(row.includedAmount)}</Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Stack>
              ) : (
                selectedReportSummaryBreakdown.sections.map((section) => (
                  <Stack key={section.title} spacing={1}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {section.title}
                    </Typography>

                    {section.rows.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {section.emptyText}
                      </Typography>
                    ) : (
                      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Source</TableCell>
                              <TableCell>Details</TableCell>
                              <TableCell align="right">Amount</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {section.rows.map((row) => (
                              <TableRow key={`${section.title}-${row.label}`} hover>
                                <TableCell>{row.label}</TableCell>
                                <TableCell>
                                  <Typography variant="body2" color="text.secondary">
                                    {row.note ?? '-'}
                                  </Typography>
                                </TableCell>
                                <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Stack>
                ))
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseReportSummaryBreakdown}>Close</Button>
        </DialogActions>
      </Dialog>

        <Dialog
          open={Boolean(dateReportLaborRow)}
          onClose={handleCloseDateReportLaborPopup}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            {dateReportLaborRow
              ? `Labor Breakdown - ${dateReportLaborRow.jobName}`
              : 'Labor Breakdown'}
          </DialogTitle>
          <DialogContent dividers>
            {!dateReportLaborRow || dateReportLaborRow.workerRows.length === 0 ? (
              <Typography color="text.secondary">No labor rows found for this order.</Typography>
            ) : (
              <Stack spacing={1.5}>
                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Worker</TableCell>
                        <TableCell align="right">Hours</TableCell>
                        <TableCell align="right">Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dateReportLaborRow.workerRows.map((workerRow) => (
                        <TableRow key={workerRow.workerId} hover>
                          <TableCell>{workerRow.workerName}</TableCell>
                          <TableCell align="right">{formatHours(workerRow.totalHours)}</TableCell>
                          <TableCell align="right">{formatCurrency(workerRow.totalCost)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: 'action.selected' }}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            Total
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight={700}>{formatHours(dateReportLaborRow.totalHours)}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight={700}>{formatCurrency(dateReportLaborRow.totalLaborCost)}</Typography>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDateReportLaborPopup}>Close</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(dateReportBillsCostsRow)}
          onClose={handleCloseDateReportBillsCostsPopup}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            {dateReportBillsCostsRow
              ? `Bills & Costs Breakdown - ${dateReportBillsCostsRow.jobName}`
              : 'Bills & Costs Breakdown'}
          </DialogTitle>
          <DialogContent dividers>
            {!dateReportBillsCostsRow ? (
              <Typography color="text.secondary">No cost rows found for this order.</Typography>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  Itemized recognized non-labor costs for this order using project-wide posted costs.
                </Typography>

                <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Component</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow hover>
                        <TableCell>Bills</TableCell>
                        <TableCell align="right">
                          {formatCurrency(dateReportBillsCostsRow.recognizedBillsCostAmount)}
                        </TableCell>
                      </TableRow>
                      <TableRow hover>
                        <TableCell>Direct expenses</TableCell>
                        <TableCell align="right">
                          {formatCurrency(dateReportBillsCostsRow.recognizedDirectExpenseCostAmount)}
                        </TableCell>
                      </TableRow>
                      <TableRow hover>
                        <TableCell>Pending POs</TableCell>
                        <TableCell align="right">
                          {formatCurrency(dateReportBillsCostsRow.recognizedPendingPOCostAmount)}
                        </TableCell>
                      </TableRow>
                      <TableRow sx={{ bgcolor: 'action.selected' }}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            Total bills & costs
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight={700}>
                            {formatCurrency(
                              Number(
                                (
                                  dateReportBillsCostsRow.recognizedBillsCostAmount
                                  + dateReportBillsCostsRow.recognizedDirectExpenseCostAmount
                                  + dateReportBillsCostsRow.recognizedPendingPOCostAmount
                                ).toFixed(2),
                              ),
                            )}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDateReportBillsCostsPopup}>Close</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(dateReportReadyRow)}
          onClose={handleCloseDateReportReadyPopup}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>
            {dateReportReadyRow
              ? `Ready % Entries In Range - ${dateReportReadyRow.jobName}`
              : 'Ready % Entries In Range'}
          </DialogTitle>
          <DialogContent dividers>
            {!dateReportReadyRow || dateReportReadyRowsInSelectedRange.length === 0 ? (
              <Typography color="text.secondary">No manager ready % entries found in the selected range.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Ready %</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dateReportReadyRowsInSelectedRange.map((readyRow) => (
                    <TableRow key={`${dateReportReadyRow.jobName}:${readyRow.date}`} hover>
                      <TableCell>{readyRow.date}</TableCell>
                      <TableCell align="right">
                        {readyRow.readyPercent === null
                          ? '-'
                          : `${readyRow.readyPercent.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDateReportReadyPopup}>Close</Button>
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
