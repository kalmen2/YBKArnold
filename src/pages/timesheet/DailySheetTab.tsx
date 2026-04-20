import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Button,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import type { BulkWorkerRow } from './utils'
import type { TimesheetStage, TimesheetWorker } from '../../features/timesheet/api'

const WORKSHEET_TABLE_CONTAINER_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  maxHeight: { xs: 420, md: 560 },
} as const

type DailySheetTabProps = {
  bulkDate: string
  setBulkDate: (date: string) => void
  bulkRows: BulkWorkerRow[]
  workersById: Map<string, TimesheetWorker>
  stages: TimesheetStage[]
  bulkRowCountByWorkerId: Map<string, number>
  canAccessManagerSheet: boolean
  onBulkRowChange: (rowId: string, field: keyof Omit<BulkWorkerRow, 'id' | 'workerId'>, value: string) => void
  onAddBulkRowForWorker: (workerId: string, afterRowId: string) => void
  onRemoveBulkRowForWorker: (rowId: string) => Promise<void>
  onSaveDailySheet: () => Promise<void>
}

export default function DailySheetTab({
  bulkDate,
  setBulkDate,
  bulkRows,
  workersById,
  stages,
  bulkRowCountByWorkerId,
  canAccessManagerSheet,
  onBulkRowChange,
  onAddBulkRowForWorker,
  onRemoveBulkRowForWorker,
  onSaveDailySheet,
}: DailySheetTabProps) {
  return (
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
              <TableCell align="right">Overtime</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bulkRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">Add workers first, then fill this daily sheet.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              bulkRows.map((row) => {
                const workerName = workersById.get(row.workerId)?.fullName ?? 'Unknown worker'
                const workerNumber = String(workersById.get(row.workerId)?.workerNumber ?? '').trim() || '----'

                return (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => onAddBulkRowForWorker(row.workerId, row.id)}
                          title="Add another line for this worker"
                        >
                          <AddRoundedIcon fontSize="small" />
                        </IconButton>

                        {row.entryId || (bulkRowCountByWorkerId.get(row.workerId) ?? 0) > 1 ? (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => void onRemoveBulkRowForWorker(row.id)}
                            title={row.entryId ? 'Remove this submitted entry' : 'Remove this extra line'}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        ) : null}

                        <Typography variant="body2">
                          {workerNumber} - {workerName}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={row.stageId}
                        onChange={(event) => onBulkRowChange(row.id, 'stageId', event.target.value)}
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
                        onChange={(event) => onBulkRowChange(row.id, 'jobName', event.target.value)}
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
                        onChange={(event) => onBulkRowChange(row.id, 'hours', event.target.value)}
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
                        onChange={(event) => onBulkRowChange(row.id, 'overtimeHours', event.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Notes"
                        value={row.notes}
                        onChange={(event) => onBulkRowChange(row.id, 'notes', event.target.value)}
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
        <Button variant="contained" onClick={onSaveDailySheet}>
          Save Daily Sheet
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {!canAccessManagerSheet
          ? 'Manager Progress tab is available for manager or admin accounts only.'
          : 'Use the Manager Progress tab to update ready percentages by date.'}
      </Typography>
    </Stack>
  )
}
