import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import {
  fetchOrdersJobDetails,
  ordersJobDetailsQueryKey,
  type OrdersJobDetailsResponse,
  type OrdersOverviewOrder,
} from '../../features/orders/api'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/formatters'
import { formatProgress } from './utils'

export type JobDetailsMode = 'details' | 'history'

type JobDetailsDialogProps = {
  open: boolean
  mode: JobDetailsMode | null
  order: OrdersOverviewOrder | null
  onClose: () => void
}

export function JobDetailsDialog({ open, mode, order, onClose }: JobDetailsDialogProps) {
  const enabled = open && Boolean(order?.mondayItemId || order?.jobNumber || order?.orderName)

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

  const hoursByDate = new Map<string, { dayTotalHours: number; workerHours: Map<string, number> }>()
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
      }
      hoursByDate.set(normalizedDate, bucket)
    }

    bucket.dayTotalHours += totalHours
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={mode === 'details' ? 'xl' : 'md'}
    >
      <DialogTitle>
        {mode === 'history'
          ? `Manager Status History - ${label}`
          : `Order Details - ${label}`}
      </DialogTitle>
      <DialogContent>
        {detailsQuery.isLoading ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading details...</Typography>
          </Stack>
        ) : errorMessage ? (
          <Alert severity="error">{errorMessage}</Alert>
        ) : !detailsQuery.data ? (
          <Alert severity="info">No details available.</Alert>
        ) : mode === 'history' ? (
          sortedDateKeys.length === 0 ? (
            <Alert severity="info">No manager status history found for this job yet.</Alert>
          ) : (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
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
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
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

            {detailsQuery.data.workers.length === 0 ? (
              <Alert severity="info">No worker activity found for this job yet.</Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
                <Table size="small" stickyHeader>
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
                    {detailsQuery.data.workers.map((worker) => (
                      <TableRow key={worker.workerId} hover>
                        <TableCell>{worker.workerName}</TableCell>
                        <TableCell>{worker.totalRegularHours.toFixed(2)}</TableCell>
                        <TableCell>{worker.totalOvertimeHours.toFixed(2)}</TableCell>
                        <TableCell>{worker.totalHours.toFixed(2)}</TableCell>
                        <TableCell>{formatCurrency(worker.totalLaborCost, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '56vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
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
                  {detailsQuery.data.entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center">
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          No timesheet entries found for this job.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    detailsQuery.data.entries.map((entry) => (
                      <TableRow key={entry.id} hover>
                        <TableCell>{formatDate(entry.date)}</TableCell>
                        <TableCell>{entry.workerName}</TableCell>
                        <TableCell>{entry.stageName || '—'}</TableCell>
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
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
