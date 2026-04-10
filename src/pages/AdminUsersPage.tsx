import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { AppAuthRole, AppAuthUser } from '../auth/types'

type ListUsersResponse = {
  users: AppAuthUser[]
  ownerEmail?: string
}

type AdminWorkerOption = {
  id: string
  workerNumber: string | null
  fullName: string
  role: string
  email: string
}

type ListWorkersResponse = {
  workers: AdminWorkerOption[]
}

const newJerseyTimeZone = 'America/New_York'
const utcTimeZone = 'UTC'

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Unknown'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function approvalLabel(user: AppAuthUser) {
  return user.isApproved ? 'Approved' : 'Pending'
}

function approvalColor(user: AppAuthUser) {
  return user.isApproved ? 'success' : 'warning'
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTimeZoneLabel(timeZone: string | null | undefined) {
  if (timeZone === newJerseyTimeZone) {
    return 'New Jersey (ET)'
  }

  return 'UTC'
}

function resolveUserTimeZone(user: AppAuthUser) {
  const normalized = String(user.accessTimeZone ?? '').trim()

  return normalized || utcTimeZone
}

function formatLoginHours(user: AppAuthUser) {
  if (!user.hasLoginHoursRestriction || user.accessStartHourUtc === null || user.accessEndHourUtc === null) {
    return 'Any time'
  }

  const timeZone = resolveUserTimeZone(user)

  return `${formatHour(user.accessStartHourUtc)} - ${formatHour(user.accessEndHourUtc)} ${formatTimeZoneLabel(timeZone)}`
}

function formatLinkedWorkerLabel(user: AppAuthUser) {
  if (!user.linkedWorkerId) {
    return 'Not linked'
  }

  const workerNumber = String(user.linkedWorkerNumber ?? '').trim() || '----'
  const workerName = String(user.linkedWorkerName ?? '').trim() || 'Unknown worker'

  return `${workerNumber} • ${workerName}`
}

const hourOptions = Array.from({ length: 24 }, (_, index) => index)

export default function AdminUsersPage() {
  const { appUser, getIdToken } = useAuth()
  const [users, setUsers] = useState<AppAuthUser[]>([])
  const [workerOptions, setWorkerOptions] = useState<AdminWorkerOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  const [promotionTarget, setPromotionTarget] = useState<AppAuthUser | null>(null)
  const [promotionConfirmationText, setPromotionConfirmationText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AppAuthUser | null>(null)
  const [hoursTarget, setHoursTarget] = useState<AppAuthUser | null>(null)
  const [hoursRestricted, setHoursRestricted] = useState(false)
  const [hoursStart, setHoursStart] = useState<number | null>(null)
  const [hoursEnd, setHoursEnd] = useState<number | null>(null)
  const [hoursTimeZone, setHoursTimeZone] = useState<string>(newJerseyTimeZone)
  const [workerLinkTarget, setWorkerLinkTarget] = useState<AppAuthUser | null>(null)
  const [workerLinkWorkerId, setWorkerLinkWorkerId] = useState('')

  const requestWithAuth = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      const idToken = await getIdToken()
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...(options.headers ?? {}),
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Request failed.',
        )
      }

      return payload as T
    },
    [getIdToken],
  )

  const loadUsers = useCallback(
    async (refreshRequested = false) => {
      setErrorMessage(null)

      if (refreshRequested) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }

      try {
        const [usersPayload, workersPayload] = await Promise.all([
          requestWithAuth<ListUsersResponse>('/api/auth/users'),
          requestWithAuth<ListWorkersResponse>('/api/auth/workers'),
        ])

        setUsers(Array.isArray(usersPayload.users) ? usersPayload.users : [])
        setWorkerOptions(Array.isArray(workersPayload.workers) ? workersPayload.workers : [])
      } catch (error) {
        setUsers([])
        setWorkerOptions([])
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to load users.',
        )
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [requestWithAuth],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadUsers(false)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadUsers])

  const handleApprove = useCallback(
    async (targetUid: string, role: AppAuthRole, confirmAdminPromotion = false) => {
      setErrorMessage(null)
      setActionMessage(null)
      setActiveUserId(targetUid)

      try {
        const payload = await requestWithAuth<{ user: AppAuthUser }>(
          `/api/auth/users/${targetUid}/approval`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              role,
              confirmAdminPromotion,
            }),
          },
        )

        setUsers((currentUsers) => {
          const nextUsers = currentUsers.map((user) =>
            user.uid === payload.user.uid ? payload.user : user,
          )

          return nextUsers
        })

        setActionMessage(
          role === 'admin'
            ? 'User approved as Admin.'
            : 'User approved as Standard.',
        )
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Approval failed.',
        )
      } finally {
        setActiveUserId(null)
      }
    },
    [requestWithAuth],
  )

  const handleSaveHours = useCallback(async () => {
    if (!hoursTarget) {
      return
    }

    if (hoursRestricted && (hoursStart === null || hoursEnd === null || hoursStart === hoursEnd)) {
      setErrorMessage('Choose a valid start and end hour for restricted access.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(hoursTarget.uid)

    try {
      const payload = await requestWithAuth<{ user: AppAuthUser }>(
        `/api/auth/users/${hoursTarget.uid}/access-hours`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            startHourUtc: hoursRestricted ? hoursStart : null,
            endHourUtc: hoursRestricted ? hoursEnd : null,
            timeZone: hoursTimeZone,
          }),
        },
      )

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.uid === payload.user.uid ? payload.user : user,
        ),
      )
      setActionMessage('Login hour access updated.')
      setHoursTarget(null)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not update login hours.',
      )
    } finally {
      setActiveUserId(null)
    }
  }, [hoursEnd, hoursRestricted, hoursStart, hoursTarget, hoursTimeZone, requestWithAuth])

  const handleUnapprove = useCallback(async (targetUid: string) => {
    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(targetUid)

    try {
      const payload = await requestWithAuth<{ user: AppAuthUser }>(
        `/api/auth/users/${targetUid}/unapprove`,
        {
          method: 'PATCH',
        },
      )

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.uid === payload.user.uid ? payload.user : user,
        ),
      )
      setActionMessage('User moved back to pending approval.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not unapprove user.',
      )
    } finally {
      setActiveUserId(null)
    }
  }, [requestWithAuth])

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(deleteTarget.uid)

    try {
      const payload = await requestWithAuth<{ ok: boolean, uid: string }>(
        `/api/auth/users/${deleteTarget.uid}`,
        {
          method: 'DELETE',
        },
      )

      if (payload.ok) {
        setUsers((currentUsers) => currentUsers.filter((user) => user.uid !== payload.uid))
        setDeleteTarget(null)
        setActionMessage('User deleted successfully.')
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not delete user.',
      )
    } finally {
      setActiveUserId(null)
    }
  }, [deleteTarget, requestWithAuth])

  const openHoursEditor = useCallback((user: AppAuthUser) => {
    setHoursTarget(user)
    setHoursRestricted(user.hasLoginHoursRestriction)
    setHoursStart(user.accessStartHourUtc)
    setHoursEnd(user.accessEndHourUtc)
    setHoursTimeZone(String(user.accessTimeZone ?? '').trim() || newJerseyTimeZone)
  }, [])

  const openWorkerLinkDialog = useCallback((user: AppAuthUser) => {
    setWorkerLinkTarget(user)
    setWorkerLinkWorkerId(user.linkedWorkerId ?? '')
  }, [])

  const handleSaveWorkerLink = useCallback(async () => {
    if (!workerLinkTarget) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(workerLinkTarget.uid)

    try {
      const payload = await requestWithAuth<{ user: AppAuthUser }>(
        `/api/auth/users/${workerLinkTarget.uid}/worker-link`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            workerId: workerLinkWorkerId || null,
          }),
        },
      )

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.uid === payload.user.uid ? payload.user : user,
        ),
      )
      setActionMessage(workerLinkWorkerId ? 'Worker login linked successfully.' : 'Worker login unlinked.')
      setWorkerLinkTarget(null)
      setWorkerLinkWorkerId('')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not update worker login link.',
      )
    } finally {
      setActiveUserId(null)
    }
  }, [requestWithAuth, workerLinkTarget, workerLinkWorkerId])

  const closePromotionDialog = useCallback(() => {
    setPromotionTarget(null)
    setPromotionConfirmationText('')
  }, [])

  const canConfirmPromotion = useMemo(() => {
    if (!promotionTarget) {
      return false
    }

    return promotionConfirmationText.trim().toLowerCase() === promotionTarget.email.trim().toLowerCase()
  }, [promotionConfirmationText, promotionTarget])

  const pendingCount = useMemo(
    () => users.filter((user) => !user.isApproved).length,
    [users],
  )

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Admin Users
          </Typography>
          <Typography color="text.secondary">
            Approve website users and assign roles. Pending accounts: {pendingCount}
          </Typography>
          
        </Box>

        <Button
          variant="contained"
          onClick={() => void loadUsers(true)}
          startIcon={<RefreshRoundedIcon />}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>

    

      {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

      {isLoading ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading users...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {!isLoading && users.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            No users have signed in yet.
          </Typography>
        </Paper>
      ) : null}

      {!isLoading && users.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Login Hours</TableCell>
                <TableCell>Worker Login</TableCell>
                <TableCell>Last Login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {users.map((user) => {
                const isSaving = activeUserId === user.uid
                const canAssignStandard = !user.isOwner
                const canEditHours = !user.isAdmin
                const canDeleteUser = !user.isOwner && user.uid !== appUser.uid

                return (
                  <TableRow key={user.uid} hover>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography variant="body2">{user.email}</Typography>
                        {user.isOwner ? (
                          <Chip
                            label="Owner"
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        ) : null}
                      </Stack>
                    </TableCell>

                    <TableCell>{user.displayName ?? 'Unknown'}</TableCell>

                    <TableCell>
                      <Chip
                        label={approvalLabel(user)}
                        size="small"
                        color={approvalColor(user)}
                        variant="outlined"
                      />
                    </TableCell>

                    <TableCell>
                      <Chip
                        label={user.role === 'admin' ? 'Admin' : 'Standard'}
                        size="small"
                        color={user.role === 'admin' ? 'secondary' : 'default'}
                        icon={
                          user.role === 'admin' ? (
                            <ShieldRoundedIcon fontSize="small" />
                          ) : (
                            <CheckRoundedIcon fontSize="small" />
                          )
                        }
                      />
                    </TableCell>

                    <TableCell>
                      <Chip
                        label={formatLoginHours(user)}
                        size="small"
                        variant="outlined"
                        color={user.hasLoginHoursRestriction ? 'warning' : 'default'}
                      />
                    </TableCell>

                    <TableCell>
                      <Chip
                        label={formatLinkedWorkerLabel(user)}
                        size="small"
                        variant="outlined"
                        color={user.linkedWorkerId ? 'primary' : 'default'}
                      />
                    </TableCell>

                    <TableCell>{formatDateTime(user.lastLoginAt)}</TableCell>

                    <TableCell align="right">
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={0.75}
                        justifyContent="flex-end"
                      >
                        <Button
                          size="small"
                          variant={
                            user.isApproved && user.role === 'standard'
                              ? 'contained'
                              : 'outlined'
                          }
                          disabled={isSaving || !canAssignStandard}
                          onClick={() => void handleApprove(user.uid, 'standard')}
                          startIcon={<CheckRoundedIcon />}
                        >
                          Standard
                        </Button>

                        <Button
                          size="small"
                          variant={
                            user.isApproved && user.role === 'admin'
                              ? 'contained'
                              : 'outlined'
                          }
                          color="secondary"
                          disabled={isSaving || user.isOwner}
                          onClick={() => {
                            const requiresConfirmation = !(user.isApproved && user.role === 'admin')

                            if (requiresConfirmation) {
                              setPromotionTarget(user)
                              setPromotionConfirmationText('')
                              return
                            }

                            void handleApprove(user.uid, 'admin', true)
                          }}
                          startIcon={<AdminPanelSettingsRoundedIcon />}
                        >
                          {user.isApproved && user.role === 'admin' ? 'Admin' : 'Make Admin'}
                        </Button>

                        {canEditHours ? (
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={isSaving}
                            onClick={() => openHoursEditor(user)}
                            startIcon={<ScheduleRoundedIcon />}
                          >
                            Hours
                          </Button>
                        ) : null}

                        <Button
                          size="small"
                          variant="outlined"
                          disabled={isSaving || user.isOwner}
                          onClick={() => {
                            openWorkerLinkDialog(user)
                          }}
                        >
                          Assign Worker
                        </Button>

                        <Button
                          size="small"
                          color="warning"
                          variant="outlined"
                          disabled={isSaving || user.isOwner || !user.isApproved}
                          onClick={() => {
                            void handleUnapprove(user.uid)
                          }}
                        >
                          Unapprove
                        </Button>

                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          disabled={isSaving || !canDeleteUser}
                          onClick={() => {
                            setDeleteTarget(user)
                          }}
                          startIcon={<DeleteForeverRoundedIcon />}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <Dialog open={Boolean(promotionTarget)} onClose={closePromotionDialog} fullWidth maxWidth="sm">
        <DialogTitle>Confirm Admin Promotion</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              Admin users can approve users, view all logs, and manage restricted hours.
              Double-check before continuing.
            </Alert>

            <Typography variant="body2" color="text.secondary">
              Type <strong>{promotionTarget?.email}</strong> to confirm admin promotion.
            </Typography>

            <TextField
              fullWidth
              label="Confirm user email"
              value={promotionConfirmationText}
              onChange={(event) => setPromotionConfirmationText(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePromotionDialog}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!promotionTarget || !canConfirmPromotion || activeUserId === promotionTarget.uid}
            onClick={() => {
              if (!promotionTarget) {
                return
              }

              void handleApprove(promotionTarget.uid, 'admin', true).then(() => {
                closePromotionDialog()
              })
            }}
          >
            Confirm Admin Promotion
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            <Alert severity="warning">
              This will remove the user from the admin list and delete their activity logs.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Are you sure you want to delete <strong>{deleteTarget?.email}</strong>?
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!deleteTarget || activeUserId === deleteTarget.uid}
            onClick={() => {
              void handleDeleteUser()
            }}
          >
            Delete User
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(hoursTarget)} onClose={() => setHoursTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Set Login Hours</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {hoursTarget?.email}
            </Typography>

            <TextField
              select
              fullWidth
              label="Access Mode"
              value={hoursRestricted ? 'restricted' : 'anytime'}
              onChange={(event) => {
                const restricted = event.target.value === 'restricted'
                setHoursRestricted(restricted)

                if (!restricted) {
                  setHoursStart(null)
                  setHoursEnd(null)
                } else {
                  setHoursStart((current) => (current === null ? 8 : current))
                  setHoursEnd((current) => (current === null ? 17 : current))
                  setHoursTimeZone((current) => current || newJerseyTimeZone)
                }
              }}
            >
              <MenuItem value="anytime">Any time (no restrictions)</MenuItem>
              <MenuItem value="restricted">Restricted by time window</MenuItem>
            </TextField>

            {hoursRestricted ? (
              <>
                <TextField
                  select
                  fullWidth
                  label="Time Zone"
                  value={hoursTimeZone}
                  onChange={(event) => {
                    setHoursTimeZone(event.target.value)
                  }}
                >
                  <MenuItem value={newJerseyTimeZone}>New Jersey (ET)</MenuItem>
                  <MenuItem value={utcTimeZone}>UTC</MenuItem>
                </TextField>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <TextField
                    select
                    fullWidth
                    label={`Start Hour (${formatTimeZoneLabel(hoursTimeZone)})`}
                    value={hoursStart ?? ''}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10)
                      setHoursStart(Number.isFinite(nextValue) ? nextValue : null)
                    }}
                  >
                    {hourOptions.map((hour) => (
                      <MenuItem key={`start-${hour}`} value={hour}>
                        {formatHour(hour)}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    fullWidth
                    label={`End Hour (${formatTimeZoneLabel(hoursTimeZone)})`}
                    value={hoursEnd ?? ''}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10)
                      setHoursEnd(Number.isFinite(nextValue) ? nextValue : null)
                    }}
                  >
                    {hourOptions.map((hour) => (
                      <MenuItem key={`end-${hour}`} value={hour}>
                        {formatHour(hour)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </>
            ) : null}

            {hoursRestricted && (hoursStart === hoursEnd) ? (
              <Alert severity="warning">Start and end hour cannot be the same.</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHoursTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              !hoursTarget
              || activeUserId === hoursTarget.uid
              || (hoursRestricted && (hoursStart === null || hoursEnd === null || hoursStart === hoursEnd))
            }
            onClick={() => {
              void handleSaveHours()
            }}
          >
            Save Hours
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(workerLinkTarget)}
        onClose={() => {
          if (!activeUserId) {
            setWorkerLinkTarget(null)
            setWorkerLinkWorkerId('')
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Assign Worker Login</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {workerLinkTarget?.email}
            </Typography>

            <TextField
              select
              fullWidth
              label="Worker"
              value={workerLinkWorkerId}
              onChange={(event) => {
                setWorkerLinkWorkerId(event.target.value)
              }}
            >
              <MenuItem value="">Not linked</MenuItem>
              {workerOptions.map((worker) => {
                const workerNumber = String(worker.workerNumber ?? '').trim() || '----'
                return (
                  <MenuItem key={worker.id} value={worker.id}>
                    {workerNumber} - {worker.fullName}
                  </MenuItem>
                )
              })}
            </TextField>

            <Typography variant="caption" color="text.secondary">
              Worker IDs are system generated (4 digits) and cannot be edited.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setWorkerLinkTarget(null)
              setWorkerLinkWorkerId('')
            }}
            disabled={Boolean(activeUserId)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleSaveWorkerLink()
            }}
            disabled={!workerLinkTarget || activeUserId === workerLinkTarget.uid}
          >
            Save Link
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
