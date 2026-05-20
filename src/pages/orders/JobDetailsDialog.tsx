import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tabs,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  fetchOrdersJobDetails,
  postOrdersOrderNumberContactAdmin,
  postOrdersOrderNumberUpdate,
  type OrdersJobDetailEntry,
  ordersJobDetailsQueryKey,
  type OrdersJobDetailsResponse,
  type OrdersOverviewOrder,
} from '../../features/orders/api'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { resolveBolUrl } from './bolUrl'
import { resolveCutListUrl } from './cutListUrl'
import { formatProgress } from './utils'

export type JobDetailsMode = 'details' | 'history'

type JobDetailsDialogProps = {
  open: boolean
  mode: JobDetailsMode | null
  order: OrdersOverviewOrder | null
  onOpenBolDocument: (order: OrdersOverviewOrder) => void
  onClose: () => void
}

type JobDetailsTab = 'hours' | 'shipping' | 'info'

const ORDER_NUMBER_CHANGE_LINKED_MESSAGE =
  'Sorry, this cannot be done because of its linked. If it needs to be done, contact admin.'

function isLinkedOrderNumberChangeMessage(message: string | null | undefined) {
  return String(message ?? '').trim() === ORDER_NUMBER_CHANGE_LINKED_MESSAGE
}

function formatStageLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

  if (!normalized) {
    return 'Unspecified'
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}

export function JobDetailsDialog({
  open,
  mode,
  order,
  onOpenBolDocument,
  onClose,
}: JobDetailsDialogProps) {
  const queryClient = useQueryClient()
  const enabled = open && Boolean(order?.mondayItemId || order?.jobNumber || order?.orderName)
  const [detailsTab, setDetailsTab] = useState<JobDetailsTab>('info')
  const [orderNumberDraft, setOrderNumberDraft] = useState('')
  const [orderNumberEditError, setOrderNumberEditError] = useState<string | null>(null)
  const [orderNumberEditSuccess, setOrderNumberEditSuccess] = useState<string | null>(null)
  const [orderNumberEditWarning, setOrderNumberEditWarning] = useState<string | null>(null)
  const [isOrderNumberEditing, setIsOrderNumberEditing] = useState(false)
  const [isSavingOrderNumber, setIsSavingOrderNumber] = useState(false)
  const [canContactAdminForOrderNumber, setCanContactAdminForOrderNumber] = useState(false)
  const [isContactingAdminForOrderNumber, setIsContactingAdminForOrderNumber] = useState(false)

  const detailsQuery = useQuery<OrdersJobDetailsResponse>({
    queryKey: ordersJobDetailsQueryKey({
      mondayItemId: order?.mondayItemId ?? '',
      jobNumber: order?.jobNumber ?? '',
      orderName: order?.orderName ?? '',
    }),
    queryFn: () => fetchOrdersJobDetails({
      mondayItemId: order?.mondayItemId,
      jobNumber: order?.jobNumber,
      orderName: order?.orderName,
    }),
    enabled,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (!open || mode !== 'details') {
      return
    }

    setDetailsTab('info')
  }, [mode, open, order?.id])

  useEffect(() => {
    if (!open || mode !== 'details') {
      return
    }

    setOrderNumberDraft(String(order?.orderNumber ?? '').trim())
    setOrderNumberEditError(null)
    setOrderNumberEditSuccess(null)
    setOrderNumberEditWarning(null)
    setIsOrderNumberEditing(false)
    setCanContactAdminForOrderNumber(false)
  }, [mode, open, order?.id, order?.orderNumber])

  const label = order?.orderNumber || order?.jobNumber || 'Job'
  const errorMessage = detailsQuery.error instanceof Error ? detailsQuery.error.message : null
  const managerHistory = Array.isArray(detailsQuery.data?.managerHistory)
    ? detailsQuery.data.managerHistory
    : []
  const detailsEntries = Array.isArray(detailsQuery.data?.entries)
    ? detailsQuery.data.entries
    : []

  const historyByDate = new Map<string, typeof managerHistory>()
  managerHistory.forEach((row) => {
    const normalizedDate = String(row.date ?? '').trim().slice(0, 10) || 'unknown'
    const rowsForDate = historyByDate.get(normalizedDate)
    if (rowsForDate) {
      rowsForDate.push(row)
      return
    }
    historyByDate.set(normalizedDate, [row])
  })

  const managerReadyByDate = new Map<string, number | null>()
  historyByDate.forEach((rowsForDate, dateKey) => {
    let latestReadyPercent: number | null = null
    let latestUpdatedAtTime = Number.NEGATIVE_INFINITY

    rowsForDate.forEach((row) => {
      const readyPercent = Number(row.readyPercent)

      if (!Number.isFinite(readyPercent)) {
        return
      }

      const updatedAt = String(row.updatedAt ?? '').trim()
      const updatedAtTime = updatedAt ? Date.parse(updatedAt) : Number.NEGATIVE_INFINITY

      if (latestReadyPercent === null || updatedAtTime >= latestUpdatedAtTime) {
        latestReadyPercent = readyPercent
        latestUpdatedAtTime = updatedAtTime
      }
    })

    managerReadyByDate.set(dateKey, latestReadyPercent)
  })

  const hoursByDate = new Map<string, {
    dayTotalHours: number
    workerHours: Map<string, number>
    entries: OrdersJobDetailEntry[]
  }>()
  detailsEntries.forEach((entry) => {
    const normalizedDate = String(entry.date ?? '').trim().slice(0, 10) || 'unknown'
    const parsedHours = Number(entry.totalHours)
    const totalHours = Number.isFinite(parsedHours) ? parsedHours : 0
    const workerLabel = String(entry.workerName ?? '').trim() || 'Unknown worker'

    let bucket = hoursByDate.get(normalizedDate)
    if (!bucket) {
      bucket = {
        dayTotalHours: 0,
        workerHours: new Map<string, number>(),
        entries: [],
      }
      hoursByDate.set(normalizedDate, bucket)
    }

    bucket.dayTotalHours += totalHours
    bucket.entries.push(entry)
    const currentWorkerHours = bucket.workerHours.get(workerLabel) ?? 0
    bucket.workerHours.set(workerLabel, currentWorkerHours + totalHours)
  })

  const dateKeys = Array.from(new Set([
    ...historyByDate.keys(),
    ...hoursByDate.keys(),
  ]))

  const sortedDateKeys = [...dateKeys].sort((a, b) => {
    if (a === 'unknown') {
      return 1
    }
    if (b === 'unknown') {
      return -1
    }
    if (a === b) {
      return 0
    }
    return a > b ? -1 : 1
  })

  const chronologicalDates = [...dateKeys].filter((key) => key !== 'unknown').sort()
  const cumulativeHoursByDate = new Map<string, number>()
  let runningTotalHours = 0
  chronologicalDates.forEach((dateKey) => {
    runningTotalHours += hoursByDate.get(dateKey)?.dayTotalHours ?? 0
    cumulativeHoursByDate.set(dateKey, runningTotalHours)
  })

  const sortedHoursDateKeys = Array.from(hoursByDate.keys()).sort((a, b) => {
    if (a === 'unknown') {
      return 1
    }
    if (b === 'unknown') {
      return -1
    }
    if (a === b) {
      return 0
    }
    return a > b ? -1 : 1
  })

  const workerRows = [...(detailsQuery.data?.workers ?? [])].sort((a, b) => b.totalHours - a.totalHours)
  const maxWorkerHours = workerRows.reduce((maxValue, worker) => Math.max(maxValue, worker.totalHours), 0)

  const stageHoursByLabel = new Map<string, number>()
  detailsEntries.forEach((entry) => {
    const stageLabel = formatStageLabel(entry.stageName)
    const parsedTotalHours = Number(entry.totalHours)
    const totalHours = Number.isFinite(parsedTotalHours) ? parsedTotalHours : 0
    stageHoursByLabel.set(stageLabel, (stageHoursByLabel.get(stageLabel) ?? 0) + totalHours)
  })

  const stageRows = Array.from(stageHoursByLabel.entries())
    .map(([stageLabel, totalHours]) => ({ stageLabel, totalHours }))
    .sort((a, b) => b.totalHours - a.totalHours)
  const maxStageHours = stageRows.reduce((maxValue, stageRow) => Math.max(maxValue, stageRow.totalHours), 0)

  const shipTo = String(order?.shipTo ?? '').trim()
  const shipNotes = String(order?.shipNotes ?? '').trim()
  const description = String(order?.description ?? '').trim()
  const notes = String(order?.notes ?? '').trim()
  const bolUrl = resolveBolUrl(order)
  const cutListUrl = resolveCutListUrl(order)
  const hasBolText = Boolean(String(order?.bol ?? '').trim())
  const hasMondayItemId = Boolean(String(order?.mondayItemId ?? '').trim())
  const canOpenBolDocument = Boolean(bolUrl || (hasBolText && hasMondayItemId))
  const hasMondayRecord = Boolean(order?.hasMondayRecord)
  const canEditOrderNumber = hasMondayRecord && Boolean(String(order?.mondayItemId ?? '').trim())

  const handleStartOrderNumberEdit = () => {
    if (!canEditOrderNumber || isSavingOrderNumber || isContactingAdminForOrderNumber) {
      return
    }

    const shouldContinue = window.confirm('Edit this order number?')

    if (!shouldContinue) {
      return
    }

    setOrderNumberEditError(null)
    setOrderNumberEditSuccess(null)
    setOrderNumberEditWarning(null)
    setCanContactAdminForOrderNumber(false)
    setIsOrderNumberEditing(true)
  }

  const handleCancelOrderNumberEdit = () => {
    setOrderNumberDraft(String(order?.orderNumber ?? '').trim())
    setOrderNumberEditError(null)
    setOrderNumberEditWarning(null)
    setCanContactAdminForOrderNumber(false)
    setIsOrderNumberEditing(false)
  }

  const handleSaveOrderNumber = async () => {
    if (!order) {
      return
    }

    if (!isOrderNumberEditing) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const requestedOrderNumber = String(orderNumberDraft ?? '').trim()
    const currentOrderNumber = String(order.orderNumber ?? '').trim()

    if (!mondayItemId) {
      setOrderNumberEditError('Monday item id is missing for this order.')
      return
    }

    if (!requestedOrderNumber) {
      setOrderNumberEditError('Order number is required.')
      return
    }

    setIsSavingOrderNumber(true)
    setOrderNumberEditError(null)
    setOrderNumberEditSuccess(null)
    setOrderNumberEditWarning(null)
    setCanContactAdminForOrderNumber(false)

    try {
      const response = await postOrdersOrderNumberUpdate({
        mondayItemId,
        orderNumber: requestedOrderNumber,
        currentOrderNumber,
      })

      setOrderNumberDraft(response.order.orderNumber)
      setOrderNumberEditSuccess(
        `Order number updated: ${response.order.previousOrderNumber} -> ${response.order.orderNumber}`,
      )
      setOrderNumberEditWarning(response.warning ?? null)
      setCanContactAdminForOrderNumber(false)
      setIsOrderNumberEditing(false)

      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not update order number.'

      setOrderNumberEditError(message)
      setCanContactAdminForOrderNumber(isLinkedOrderNumberChangeMessage(message))
    } finally {
      setIsSavingOrderNumber(false)
    }
  }

  const handleContactAdminForOrderNumber = async () => {
    if (!order) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const requestedOrderNumber = String(orderNumberDraft ?? '').trim()
    const currentOrderNumber = String(order.orderNumber ?? '').trim()

    if (!mondayItemId) {
      setOrderNumberEditError('Monday item id is missing for this order.')
      return
    }

    if (!requestedOrderNumber) {
      setOrderNumberEditError('Order number is required.')
      return
    }

    setIsContactingAdminForOrderNumber(true)
    setOrderNumberEditError(null)

    try {
      await postOrdersOrderNumberContactAdmin({
        mondayItemId,
        requestedOrderNumber,
        currentOrderNumber,
      })

      setOrderNumberEditSuccess('Admin was notified about this order number change request.')
      setCanContactAdminForOrderNumber(false)
    } catch (error) {
      setOrderNumberEditError(
        error instanceof Error
          ? error.message
          : 'Could not notify admin right now.',
      )
    } finally {
      setIsContactingAdminForOrderNumber(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          height: { xs: '90vh', md: '82vh' },
          maxHeight: { xs: '90vh', md: '82vh' },
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          pb: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={0.35}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              fontSize: { xs: '1.2rem', md: '1.4rem' },
              lineHeight: 1.2,
            }}
          >
            {mode === 'history' ? 'Manager Status History' : 'Order Details'}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent
        sx={{
          overflowY: 'auto',
          pt: 1.5,
          pb: 1.25,
        }}
      >
        {mode === 'history' ? (
          detailsQuery.isLoading ? (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Loading details...</Typography>
            </Stack>
          ) : errorMessage ? (
            <Alert severity="error">{errorMessage}</Alert>
          ) : !detailsQuery.data ? (
            <Alert severity="info">No details available.</Alert>
          ) : (
          sortedDateKeys.length === 0 ? (
            <Alert severity="info">No manager status history found for this job yet.</Alert>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 0.75 }}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={`Days tracked: ${sortedDateKeys.length}`}
                  variant="outlined"
                />
                <Chip
                  label={`Total hours overall: ${detailsQuery.data.summary.totalHours.toFixed(2)}`}
                  color="primary"
                  variant="outlined"
                />
              </Stack>

              {sortedDateKeys.map((dateKey, index) => {
                const historyRows = historyByDate.get(dateKey) ?? []
                const dayHoursBucket = hoursByDate.get(dateKey)
                const dayHours = dayHoursBucket?.dayTotalHours ?? 0
                const cumulativeHours = dateKey === 'unknown'
                  ? detailsQuery.data.summary.totalHours
                  : (cumulativeHoursByDate.get(dateKey) ?? detailsQuery.data.summary.totalHours)
                const workerBreakdown = dayHoursBucket
                  ? Array.from(dayHoursBucket.workerHours.entries()).sort((a, b) => b[1] - a[1])
                  : []
                const dateLabel = dateKey === 'unknown' ? 'Unknown date' : formatDate(dateKey)

                return (
                  <Accordion key={dateKey} defaultExpanded={index === 0} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                        <Typography variant="subtitle2" fontWeight={800}>{dateLabel}</Typography>
                        <Chip size="small" label={`Updates: ${historyRows.length}`} variant="outlined" />
                        <Chip size="small" label={`Day hours: ${dayHours.toFixed(2)}`} color="primary" variant="outlined" />
                        <Chip size="small" label={`Total through day: ${cumulativeHours.toFixed(2)}`} variant="outlined" />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0.5 }}>
                      {historyRows.length === 0 ? (
                        <Alert severity="info" sx={{ mb: workerBreakdown.length > 0 ? 1 : 0 }}>
                          No manager status updates saved for this day.
                        </Alert>
                      ) : (
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Ready %</TableCell>
                                <TableCell>Updated</TableCell>
                                <TableCell>Job Name</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {historyRows.map((row) => (
                                <TableRow key={`${row.id || 'history'}-${row.updatedAt || 'na'}`} hover>
                                  <TableCell>{formatProgress(row.readyPercent)}</TableCell>
                                  <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                                  <TableCell>{row.jobName || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}

                      {workerBreakdown.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No worker hour entries found for this day.
                        </Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Worker</TableCell>
                                <TableCell>Hours Worked</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {workerBreakdown.map(([workerName, hours]) => (
                                <TableRow key={`${dateKey}-${workerName}`} hover>
                                  <TableCell>{workerName}</TableCell>
                                  <TableCell>{hours.toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Stack>
          )
          )
        ) : (
          <Stack spacing={1.75} sx={{ pt: 0.5 }}>
            <Tabs
              value={detailsTab}
              onChange={(_event, value: JobDetailsTab) => {
                setDetailsTab(value)
              }}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: 44,
                borderBottom: '1px solid',
                borderColor: 'divider',
                pb: 0.25,
                '& .MuiTab-root': {
                  minHeight: 44,
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: { xs: 14, md: 15 },
                  px: 1.5,
                  py: 0.75,
                },
                '& .MuiTabs-indicator': {
                  height: 3,
                  borderRadius: 2,
                },
              }}
            >
              <Tab value="info" label="Info" />
              <Tab value="hours" label="Hours" />
              <Tab value="shipping" label="Shipping" />
            </Tabs>

            {detailsTab === 'hours' ? (
              detailsQuery.isLoading ? (
                <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                  <Typography color="text.secondary">Loading hours...</Typography>
                </Stack>
              ) : errorMessage ? (
                <Alert severity="error">{errorMessage}</Alert>
              ) : !detailsQuery.data ? (
                <Alert severity="info">No hours data available.</Alert>
              ) : (
                <Stack spacing={2.1}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip
                      label={`Total hours: ${detailsQuery.data.summary.totalHours.toFixed(2)}`}
                      color="primary"
                      variant="outlined"
                    />
                    <Chip label={`Workers: ${detailsQuery.data.summary.workerCount}`} variant="outlined" />
                    <Chip label={`Entries: ${detailsQuery.data.summary.entryCount}`} variant="outlined" />
                    <Chip
                      label={`Labor: ${formatCurrency(detailsQuery.data.summary.totalLaborCost, 2)}`}
                      variant="outlined"
                    />
                  </Stack>

                  <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 } }}>
                    <Stack spacing={1.15}>
                      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1rem', md: '1.12rem' } }}>
                        Total Chart
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total hours by worker and by stage (including cut and stitching when logged).
                      </Typography>

                      {workerRows.length === 0 ? (
                        <Alert severity="info">No worker activity found for this job yet.</Alert>
                      ) : (
                        <Stack spacing={1.35}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            By worker
                          </Typography>

                          {workerRows.map((worker) => {
                            const ratio = maxWorkerHours > 0
                              ? (worker.totalHours / maxWorkerHours) * 100
                              : 0

                            return (
                              <Box
                                key={worker.workerId}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 220px) minmax(180px, 1fr) auto' },
                                  gap: 1,
                                  alignItems: 'center',
                                }}
                              >
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  {worker.workerName}
                                </Typography>

                                <LinearProgress
                                  variant="determinate"
                                  value={Math.max(0, Math.min(100, ratio))}
                                  sx={{
                                    height: 10,
                                    borderRadius: 999,
                                    bgcolor: 'action.hover',
                                  }}
                                />

                                <Typography variant="body2" sx={{ fontWeight: 700, textAlign: { xs: 'left', sm: 'right' } }}>
                                  {worker.totalHours.toFixed(2)} hrs
                                </Typography>
                              </Box>
                            )
                          })}
                        </Stack>
                      )}

                      <Stack spacing={1.35}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          By stage
                        </Typography>

                        {stageRows.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            No stage labels found in timesheet entries yet.
                          </Typography>
                        ) : (
                          stageRows.map((stageRow) => {
                            const ratio = maxStageHours > 0
                              ? (stageRow.totalHours / maxStageHours) * 100
                              : 0

                            return (
                              <Box
                                key={stageRow.stageLabel}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 220px) minmax(180px, 1fr) auto' },
                                  gap: 1,
                                  alignItems: 'center',
                                }}
                              >
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  {stageRow.stageLabel}
                                </Typography>

                                <LinearProgress
                                  variant="determinate"
                                  value={Math.max(0, Math.min(100, ratio))}
                                  sx={{
                                    height: 10,
                                    borderRadius: 999,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                      bgcolor: 'secondary.main',
                                    },
                                  }}
                                />

                                <Typography variant="body2" sx={{ fontWeight: 700, textAlign: { xs: 'left', sm: 'right' } }}>
                                  {stageRow.totalHours.toFixed(2)} hrs
                                </Typography>
                              </Box>
                            )
                          })
                        )}
                      </Stack>
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 } }}>
                    <Stack spacing={1.15}>
                      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1rem', md: '1.12rem' } }}>
                        Per Date
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Every date is a dropdown. Open a date to see the worker totals and every entry for that day.
                      </Typography>

                      {sortedHoursDateKeys.length === 0 ? (
                        <Alert severity="info">No timesheet entries found for this job.</Alert>
                      ) : (
                        sortedHoursDateKeys.map((dateKey, index) => {
                          const dateBucket = hoursByDate.get(dateKey)
                          const dayTotalHours = dateBucket?.dayTotalHours ?? 0
                          const dayEntries = dateBucket?.entries ?? []
                          const managerReadyPercent = managerReadyByDate.get(dateKey) ?? null
                          const cumulativeHours = dateKey === 'unknown'
                            ? detailsQuery.data.summary.totalHours
                            : (cumulativeHoursByDate.get(dateKey) ?? detailsQuery.data.summary.totalHours)
                          const dateLabel = dateKey === 'unknown' ? 'Unknown date' : formatDate(dateKey)

                          const workersByDay = new Map<string, {
                            workerName: string
                            regularHours: number
                            overtimeHours: number
                            totalHours: number
                            laborCost: number
                          }>()

                          dayEntries.forEach((entry) => {
                            const workerName = String(entry.workerName ?? '').trim() || 'Unknown worker'
                            const regularHours = Number.isFinite(Number(entry.regularHours)) ? Number(entry.regularHours) : 0
                            const overtimeHours = Number.isFinite(Number(entry.overtimeHours)) ? Number(entry.overtimeHours) : 0
                            const totalHours = Number.isFinite(Number(entry.totalHours)) ? Number(entry.totalHours) : 0
                            const laborCost = Number.isFinite(Number(entry.laborCost)) ? Number(entry.laborCost) : 0
                            const existing = workersByDay.get(workerName)

                            if (existing) {
                              existing.regularHours += regularHours
                              existing.overtimeHours += overtimeHours
                              existing.totalHours += totalHours
                              existing.laborCost += laborCost
                              return
                            }

                            workersByDay.set(workerName, {
                              workerName,
                              regularHours,
                              overtimeHours,
                              totalHours,
                              laborCost,
                            })
                          })

                          const workerRowsForDay = Array.from(workersByDay.values())
                            .sort((a, b) => b.totalHours - a.totalHours)

                          return (
                            <Accordion key={dateKey} defaultExpanded={index === 0} disableGutters>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                    {dateLabel}
                                  </Typography>
                                  <Chip size="small" label={`Entries: ${dayEntries.length}`} variant="outlined" />
                                  <Chip size="small" label={`Workers: ${workerRowsForDay.length}`} variant="outlined" />
                                  <Chip size="small" label={`Day hours: ${dayTotalHours.toFixed(2)}`} color="primary" variant="outlined" />
                                  <Chip
                                    size="small"
                                    label={`Ready: ${formatProgress(managerReadyPercent)}`}
                                    color={managerReadyPercent !== null ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                  <Chip size="small" label={`Total through day: ${cumulativeHours.toFixed(2)}`} variant="outlined" />
                                </Stack>
                              </AccordionSummary>
                              <AccordionDetails sx={{ pt: 0.5 }}>
                                {workerRowsForDay.length === 0 ? (
                                  <Typography variant="body2" color="text.secondary" sx={{ mb: dayEntries.length > 0 ? 1 : 0 }}>
                                    No worker totals available for this date.
                                  </Typography>
                                ) : (
                                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Worker</TableCell>
                                          <TableCell>Regular Hours</TableCell>
                                          <TableCell>Overtime Hours</TableCell>
                                          <TableCell>Total Hours</TableCell>
                                          <TableCell>Labor Cost</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {workerRowsForDay.map((workerRow) => (
                                          <TableRow key={`${dateKey}-${workerRow.workerName}`} hover>
                                            <TableCell>{workerRow.workerName}</TableCell>
                                            <TableCell>{workerRow.regularHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.overtimeHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.totalHours.toFixed(2)}</TableCell>
                                            <TableCell>{formatCurrency(workerRow.laborCost, 2)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                )}

                                <TableContainer component={Paper} variant="outlined">
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Worker</TableCell>
                                        <TableCell>Stage</TableCell>
                                        <TableCell>Regular</TableCell>
                                        <TableCell>OT</TableCell>
                                        <TableCell>Total</TableCell>
                                        <TableCell>Rate</TableCell>
                                        <TableCell>Labor Cost</TableCell>
                                        <TableCell>Notes</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {dayEntries.length === 0 ? (
                                        <TableRow>
                                          <TableCell colSpan={8} align="center">
                                            <Typography color="text.secondary" sx={{ py: 2 }}>
                                              No timesheet entries found for this date.
                                            </Typography>
                                          </TableCell>
                                        </TableRow>
                                      ) : (
                                        dayEntries.map((entry) => (
                                          <TableRow key={entry.id} hover>
                                            <TableCell>{entry.workerName}</TableCell>
                                            <TableCell>{formatStageLabel(entry.stageName)}</TableCell>
                                            <TableCell>{entry.regularHours.toFixed(2)}</TableCell>
                                            <TableCell>{entry.overtimeHours.toFixed(2)}</TableCell>
                                            <TableCell>{entry.totalHours.toFixed(2)}</TableCell>
                                            <TableCell>{formatCurrency(entry.rate, 2)}</TableCell>
                                            <TableCell>{formatCurrency(entry.laborCost, 2)}</TableCell>
                                            <TableCell>{entry.notes || '—'}</TableCell>
                                          </TableRow>
                                        ))
                                      )}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </AccordionDetails>
                            </Accordion>
                          )
                        })
                      )}
                    </Stack>
                  </Paper>
                </Stack>
              )
            ) : null}

            {detailsTab === 'shipping' ? (
              <Stack spacing={1.25}>
                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Shipping Address
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {shipTo || '—'}
                    </Typography>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      <Chip
                        label={order?.isShipped ? 'Shipped' : 'Not shipped'}
                        color={order?.isShipped ? 'success' : 'default'}
                        variant="outlined"
                        size="small"
                      />
                      <Chip
                        label={`Shipped at: ${order?.shippedAt ? formatDate(order.shippedAt) : '—'}`}
                        variant="outlined"
                        size="small"
                      />
                    </Stack>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Shipping Notes
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {shipNotes || '—'}
                    </Typography>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Bill Of Lading
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {canOpenBolDocument ? 'BOL' : '—'}
                    </Typography>

                    <Box
                      sx={{
                        display: 'flex',
                        gap: 0.75,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Button
                        size="medium"
                        variant="contained"
                        disabled={!canOpenBolDocument || !order}
                        onClick={() => {
                          if (!order) {
                            return
                          }

                          if (bolUrl) {
                            window.open(bolUrl, '_blank', 'noopener,noreferrer')
                            return
                          }

                          onOpenBolDocument(order)
                        }}
                      >
                        Open BOL
                      </Button>
                    </Box>
                  </Stack>
                </Paper>
              </Stack>
            ) : null}

            {detailsTab === 'info' ? (
              <Stack spacing={1.25}>
                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Order Number
                    </Typography>

                    {orderNumberEditError ? (
                      <Alert severity="error">{orderNumberEditError}</Alert>
                    ) : null}

                    {orderNumberEditSuccess ? (
                      <Alert severity="success">{orderNumberEditSuccess}</Alert>
                    ) : null}

                    {orderNumberEditWarning ? (
                      <Alert severity="warning">{orderNumberEditWarning}</Alert>
                    ) : null}

                    <Typography variant="body2" color="text.secondary">
                      Click Edit to unlock this field. You will be asked to confirm first.
                    </Typography>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        label="Order number"
                        value={orderNumberDraft}
                        onChange={(event) => setOrderNumberDraft(event.target.value)}
                        disabled={
                          !canEditOrderNumber
                          || !isOrderNumberEditing
                          || isSavingOrderNumber
                          || isContactingAdminForOrderNumber
                        }
                        fullWidth
                      />

                      {isOrderNumberEditing ? (
                        <>
                          <Button
                            variant="outlined"
                            onClick={handleCancelOrderNumberEdit}
                            disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
                            sx={{ minWidth: 120 }}
                          >
                            Cancel
                          </Button>

                          <Button
                            variant="contained"
                            onClick={() => {
                              void handleSaveOrderNumber()
                            }}
                            disabled={!canEditOrderNumber || isSavingOrderNumber || isContactingAdminForOrderNumber}
                            startIcon={isSavingOrderNumber ? <CircularProgress size={14} /> : null}
                            sx={{ minWidth: 120 }}
                          >
                            Save
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outlined"
                          onClick={handleStartOrderNumberEdit}
                          disabled={!canEditOrderNumber || isSavingOrderNumber || isContactingAdminForOrderNumber}
                          sx={{ minWidth: 120 }}
                        >
                          Edit
                        </Button>
                      )}
                    </Stack>

                    {!canEditOrderNumber ? (
                      <Typography variant="caption" color="text.secondary">
                        Only Monday-linked orders can be edited.
                      </Typography>
                    ) : null}

                    {isOrderNumberEditing && canContactAdminForOrderNumber ? (
                      <Box>
                        <Button
                          color="warning"
                          variant="outlined"
                          onClick={() => {
                            void handleContactAdminForOrderNumber()
                          }}
                          disabled={isSavingOrderNumber || isContactingAdminForOrderNumber}
                          startIcon={isContactingAdminForOrderNumber ? <CircularProgress size={14} /> : null}
                        >
                          Contact Admin
                        </Button>
                      </Box>
                    ) : null}
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Description
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {description || '—'}
                    </Typography>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Notes
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {notes || '—'}
                    </Typography>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Cut List
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {cutListUrl ? 'Cut list' : '—'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      This link opens the latest cut list from the backend source.
                    </Typography>
                    <Box
                      sx={{
                        display: 'flex',
                        gap: 0.75,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Button
                        size="medium"
                        variant="contained"
                        component="a"
                        href={cutListUrl || undefined}
                        target="_blank"
                        rel="noreferrer"
                        disabled={!cutListUrl}
                      >
                        Open Cut List
                      </Button>
                    </Box>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={`PO: ${order?.poNumber || '—'}`} size="small" variant="outlined" />
                    <Chip label={`Order date: ${order?.orderDate ? formatDate(order.orderDate) : '—'}`} size="small" variant="outlined" />
                  </Stack>
                </Paper>
              </Stack>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          px: 2.5,
          py: 1.1,
        }}
      >
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
