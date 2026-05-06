import {
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
          managerHistory.length === 0 ? (
            <Alert severity="info">No manager status history found for this job yet.</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 0.5, maxHeight: '60vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Ready %</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell>Job Name</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {managerHistory.map((row) => (
                    <TableRow key={`${row.id || 'history'}-${row.date || 'na'}-${row.updatedAt || 'na'}`} hover>
                      <TableCell>{row.date ? formatDate(row.date) : '—'}</TableCell>
                      <TableCell>{formatProgress(row.readyPercent)}</TableCell>
                      <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                      <TableCell>{row.jobName || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
