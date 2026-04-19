import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import GroupRoundedIcon from '@mui/icons-material/GroupRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
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
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  createWorkersBulk,
  deleteWorker,
  fetchTimesheetState,
  type TimesheetWorker,
  updateWorker,
} from '../features/timesheet/api'

type CreateWorkerInput = {
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: number
}

type BulkWorkerDraftRow = {
  id: string
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: string
}

type WorkerEditForm = {
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: string
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function createEmptyBulkWorkerDraft(): BulkWorkerDraftRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fullName: '',
    role: '',
    email: '',
    phone: '',
    hourlyRate: '',
  }
}

export default function WorkersPage() {
  const { appUser } = useAuth()
  const canManageWorkers = appUser?.isAdmin === true
  const [workers, setWorkers] = useState<TimesheetWorker[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [bulkWorkerRows, setBulkWorkerRows] = useState<BulkWorkerDraftRow[]>([
    createEmptyBulkWorkerDraft(),
  ])
  const [editingWorkerId, setEditingWorkerId] = useState('')
  const [workerEditForm, setWorkerEditForm] = useState<WorkerEditForm>({
    fullName: '',
    role: '',
    email: '',
    phone: '',
    hourlyRate: '',
  })

  const refreshWorkers = useCallback(async (refreshRequested = false) => {
    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const payload = await fetchTimesheetState()
      setWorkers(payload.workers)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to load workers.'
      setError(message)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorkers(false)
  }, [refreshWorkers])

  useEffect(() => {
    if (!editingWorkerId) {
      return
    }

    if (!workers.some((worker) => worker.id === editingWorkerId)) {
      setEditingWorkerId('')
    }
  }, [editingWorkerId, workers])

  const handleBulkWorkerRowChange = (
    rowId: string,
    field: keyof Omit<BulkWorkerDraftRow, 'id'>,
    value: string,
  ) => {
    setBulkWorkerRows((current) =>
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

  const handleAddBulkWorkerRow = () => {
    setBulkWorkerRows((current) => [...current, createEmptyBulkWorkerDraft()])
  }

  const handleRemoveBulkWorkerRow = (rowId: string) => {
    setBulkWorkerRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId)
      return nextRows.length > 0 ? nextRows : [createEmptyBulkWorkerDraft()]
    })
  }

  const handleBulkAddWorkers = async () => {
    setError('')
    setSuccess('')

    if (!canManageWorkers) {
      setError('Only admin users can add workers.')
      return
    }

    const validWorkers: CreateWorkerInput[] = []
    const invalidRows: string[] = []
    let hasAnyInput = false

    bulkWorkerRows.forEach((row, index) => {
      const fullName = row.fullName.trim()
      const role = row.role.trim()
      const email = row.email.trim()
      const phone = row.phone.trim()
      const hourlyRateRaw = row.hourlyRate.trim()

      const hasInput = fullName || role || email || phone || hourlyRateRaw

      if (!hasInput) {
        return
      }

      hasAnyInput = true
      const hourlyRate = Number(hourlyRateRaw)

      if (!fullName || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        invalidRows.push(`Row ${index + 1}`)
        return
      }

      validWorkers.push({
        fullName,
        role,
        email,
        phone,
        hourlyRate,
      })
    })

    if (!hasAnyInput) {
      setError('Fill at least one row in the bulk worker table.')
      return
    }

    if (invalidRows.length > 0) {
      setError(`${invalidRows.join(', ')} invalid. Name and positive hourly rate are required.`)
      return
    }

    if (validWorkers.length === 0) {
      setError('No valid worker rows to submit.')
      return
    }

    try {
      const response = await createWorkersBulk(validWorkers)
      setBulkWorkerRows([createEmptyBulkWorkerDraft()])
      await refreshWorkers(true)
      setSuccess(`Workers added: ${response.insertedCount}`)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to add workers.'
      setError(message)
    }
  }

  const handleRemoveWorker = async (workerId: string) => {
    setError('')
    setSuccess('')

    if (!canManageWorkers) {
      setError('Only admin users can remove workers.')
      return
    }

    const confirmed = window.confirm('Remove this worker?')

    if (!confirmed) {
      return
    }

    try {
      await deleteWorker(workerId)
      await refreshWorkers(true)
      setSuccess('Worker removed.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to remove worker.'
      setError(message)
    }
  }

  const handleStartEditWorker = (worker: TimesheetWorker) => {
    if (!canManageWorkers) {
      setError('Only admin users can edit workers.')
      return
    }

    setError('')
    setSuccess('')
    setEditingWorkerId(worker.id)
    setWorkerEditForm({
      fullName: worker.fullName,
      role: worker.role,
      email: worker.email,
      phone: worker.phone,
      hourlyRate: String(worker.hourlyRate),
    })
  }

  const handleWorkerEditFieldChange = (field: keyof WorkerEditForm, value: string) => {
    setWorkerEditForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleCancelEditWorker = () => {
    setEditingWorkerId('')
  }

  const handleSaveEditedWorker = async () => {
    setError('')
    setSuccess('')

    if (!canManageWorkers) {
      setError('Only admin users can edit workers.')
      return
    }

    if (!editingWorkerId) {
      return
    }

    const fullName = workerEditForm.fullName.trim()
    const hourlyRate = Number(workerEditForm.hourlyRate.trim())

    if (!fullName) {
      setError('Worker name is required.')
      return
    }

    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      setError('Hourly rate must be a positive number.')
      return
    }

    try {
      await updateWorker(editingWorkerId, {
        fullName,
        role: workerEditForm.role.trim(),
        email: workerEditForm.email.trim(),
        phone: workerEditForm.phone.trim(),
        hourlyRate,
      })
      await refreshWorkers(true)
      setEditingWorkerId('')
      setSuccess('Worker updated. New pay rate applies only to new entries.')
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to update worker.'
      setError(message)
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        gap={1.2}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <GroupRoundedIcon color="primary" />
            <Typography variant="h4" fontWeight={700}>
              Workers
            </Typography>
          </Stack>
          <Typography color="text.secondary">
            Manage workers for Work Sheet. Worker IDs are system-generated 4 digits.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<RefreshRoundedIcon />}
          onClick={() => void refreshWorkers(true)}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
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
            <Typography color="text.secondary">Loading workers...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {!canManageWorkers ? (
        <Alert severity="info">
          You can view workers, but only admin users can add, edit, or remove workers.
        </Alert>
      ) : null}

      {canManageWorkers ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1" fontWeight={700}>
            Add Workers
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Fill rows below. Full name and hourly rate are required. Blank rows are ignored.
          </Typography>

          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <Table size="small" sx={{ minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell align="right">Rate / hour</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bulkWorkerRows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ minWidth: 200 }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Full name"
                        value={row.fullName}
                        onChange={(event) =>
                          handleBulkWorkerRowChange(row.id, 'fullName', event.target.value)
                        }
                      />
                    </TableCell>

                    <TableCell sx={{ minWidth: 160 }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Role"
                        value={row.role}
                        onChange={(event) =>
                          handleBulkWorkerRowChange(row.id, 'role', event.target.value)
                        }
                      />
                    </TableCell>

                    <TableCell sx={{ minWidth: 220 }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Email"
                        value={row.email}
                        onChange={(event) =>
                          handleBulkWorkerRowChange(row.id, 'email', event.target.value)
                        }
                      />
                    </TableCell>

                    <TableCell sx={{ minWidth: 180 }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Phone"
                        value={row.phone}
                        onChange={(event) =>
                          handleBulkWorkerRowChange(row.id, 'phone', event.target.value)
                        }
                      />
                    </TableCell>

                    <TableCell align="right" sx={{ minWidth: 140 }}>
                      <TextField
                        size="small"
                        fullWidth
                        type="number"
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="0"
                        value={row.hourlyRate}
                        onChange={(event) =>
                          handleBulkWorkerRowChange(row.id, 'hourlyRate', event.target.value)
                        }
                      />
                    </TableCell>

                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button
                        color="error"
                        size="small"
                        onClick={() => handleRemoveBulkWorkerRow(row.id)}
                        disabled={bulkWorkerRows.length === 1}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={handleAddBulkWorkerRow}
            >
              Add Row
            </Button>
            <Button variant="outlined" onClick={handleBulkAddWorkers}>
              Add Workers
            </Button>
          </Stack>
        </Stack>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={700}>
            Existing Workers
          </Typography>

          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell align="right">Rate / hour</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {workers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary">No workers yet.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  workers.map((worker) => {
                    const isEditing = editingWorkerId === worker.id

                    return (
                      <TableRow key={worker.id} hover>
                        <TableCell>{String(worker.workerNumber ?? '').trim() || '----'}</TableCell>

                        <TableCell sx={{ minWidth: 220 }}>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              value={workerEditForm.fullName}
                              onChange={(event) =>
                                handleWorkerEditFieldChange('fullName', event.target.value)
                              }
                            />
                          ) : (
                            worker.fullName
                          )}
                        </TableCell>

                        <TableCell sx={{ minWidth: 170 }}>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              value={workerEditForm.role}
                              onChange={(event) =>
                                handleWorkerEditFieldChange('role', event.target.value)
                              }
                            />
                          ) : (
                            worker.role || '-'
                          )}
                        </TableCell>

                        <TableCell sx={{ minWidth: 220 }}>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              value={workerEditForm.email}
                              onChange={(event) =>
                                handleWorkerEditFieldChange('email', event.target.value)
                              }
                            />
                          ) : (
                            worker.email || '-'
                          )}
                        </TableCell>

                        <TableCell sx={{ minWidth: 180 }}>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              value={workerEditForm.phone}
                              onChange={(event) =>
                                handleWorkerEditFieldChange('phone', event.target.value)
                              }
                            />
                          ) : (
                            worker.phone || '-'
                          )}
                        </TableCell>

                        <TableCell align="right" sx={{ minWidth: 150 }}>
                          {isEditing ? (
                            <TextField
                              size="small"
                              fullWidth
                              type="number"
                              inputProps={{ min: 0, step: 0.01 }}
                              value={workerEditForm.hourlyRate}
                              onChange={(event) =>
                                handleWorkerEditFieldChange('hourlyRate', event.target.value)
                              }
                            />
                          ) : (
                            formatCurrency(worker.hourlyRate)
                          )}
                        </TableCell>

                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {!canManageWorkers ? (
                            <Typography variant="body2" color="text.secondary">
                              View only
                            </Typography>
                          ) : isEditing ? (
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => void handleSaveEditedWorker()}
                              >
                                Save
                              </Button>
                              <Button size="small" onClick={handleCancelEditWorker}>
                                Cancel
                              </Button>
                            </Stack>
                          ) : (
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button size="small" onClick={() => handleStartEditWorker(worker)}>
                                Edit
                              </Button>
                              <Button
                                color="error"
                                size="small"
                                startIcon={<DeleteOutlineRoundedIcon />}
                                onClick={() => void handleRemoveWorker(worker.id)}
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
      </Paper>

      <Divider />
      <Typography variant="caption" color="text.secondary">
        Worker IDs are auto-generated and cannot be edited. Updating pay rate affects only new entries.
      </Typography>
    </Stack>
  )
}
