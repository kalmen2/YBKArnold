import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
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
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { useCallback, useMemo, useState } from 'react'
import { useDataLoader } from '../hooks/useDataLoader'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { apiRequest } from '../features/api-client'
import type { AppAuthRole, AppAuthUser } from '../auth/types'
import {
  approvalColor,
  approvalLabel,
  formatDateTime,
  formatLoginHours,
  roleColor,
  roleLabel,
} from '../lib/formatters'

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

type ClientAccessMode = 'web_and_app' | 'web_only' | 'app_only'

const newJerseyTimeZone = 'America/New_York'
const utcTimeZone = 'UTC'

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTimeZoneLabel(timeZone: string | null | undefined) {
  if (timeZone === newJerseyTimeZone) {
    return 'New Jersey (ET)'
  }

  return 'UTC'
}

function formatLinkedWorkerLabel(user: AppAuthUser) {
  if (!user.linkedWorkerId) {
    return 'Not linked'
  }

  const workerNumber = String(user.linkedWorkerNumber ?? '').trim() || '----'
  const workerName = String(user.linkedWorkerName ?? '').trim() || 'Unknown worker'

  return `${workerNumber} • ${workerName}`
}

function formatClientAccessLabel(mode: ClientAccessMode) {
  if (mode === 'app_only') {
    return 'App only'
  }

  if (mode === 'web_only') {
    return 'Website only'
  }

  return 'Web + App'
}

const hourOptions = Array.from({ length: 24 }, (_, index) => index)

export default function AdminUsersPage() {
  const { appUser } = useAuth()
  const [users, setUsers] = useState<AppAuthUser[]>([])
  const [workerOptions, setWorkerOptions] = useState<AdminWorkerOption[]>([])
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
  const [workerApproveTarget, setWorkerApproveTarget] = useState<AppAuthUser | null>(null)
  const [workerApproveWorkerId, setWorkerApproveWorkerId] = useState('')
  const [actionsAnchorEl, setActionsAnchorEl] = useState<HTMLElement | null>(null)
  const [actionsTarget, setActionsTarget] = useState<AppAuthUser | null>(null)


  const { isLoading, isRefreshing, errorMessage, load: loadUsers, setErrorMessage } = useDataLoader({
    fetcher: useCallback(async () => {
      const [usersPayload, workersPayload] = await Promise.all([
        apiRequest<ListUsersResponse>('/api/auth/users'),
        apiRequest<ListWorkersResponse>('/api/auth/workers'),
      ])
      return { users: usersPayload.users, workers: workersPayload.workers }
    }, []),
    onSuccess: useCallback(({ users, workers }: { users: AppAuthUser[]; workers: AdminWorkerOption[] }) => {
      setUsers(Array.isArray(users) ? users : [])
      setWorkerOptions(Array.isArray(workers) ? workers : [])
    }, []),
    onError: useCallback(() => {
      setUsers([])
      setWorkerOptions([])
    }, []),
    fallbackErrorMessage: 'Failed to load users.',
  })

  const handleApprove = useCallback(
    async (targetUid: string, role: AppAuthRole, confirmAdminPromotion = false) => {
      setErrorMessage(null)
      setActionMessage(null)
      setActiveUserId(targetUid)

      try {
        const payload = await apiRequest<{ user: AppAuthUser }>(
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
            : role === 'manager'
              ? 'User approved as Manager.'
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
    [setErrorMessage],
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
      const payload = await apiRequest<{ user: AppAuthUser }>(
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
  }, [hoursEnd, hoursRestricted, hoursStart, hoursTarget, hoursTimeZone, setErrorMessage])

  const handleSetClientAccess = useCallback(
    async (targetUid: string, mode: ClientAccessMode) => {
      setErrorMessage(null)
      setActionMessage(null)
      setActiveUserId(targetUid)

      try {
        const payload = await apiRequest<{ user: AppAuthUser }>(
          `/api/auth/users/${targetUid}/client-access`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              mode,
            }),
          },
        )

        setUsers((currentUsers) =>
          currentUsers.map((user) =>
            user.uid === payload.user.uid ? payload.user : user,
          ),
        )
        setActionMessage(
          mode === 'app_only'
            ? 'Access set to app only.'
            : mode === 'web_only'
              ? 'Access set to website only.'
              : 'Access set to web + app.',
        )
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Could not update client access.',
        )
      } finally {
        setActiveUserId(null)
      }
    },
    [setErrorMessage],
  )

  const openRowActions = useCallback((anchorElement: HTMLElement, user: AppAuthUser) => {
    setActionsAnchorEl(anchorElement)
    setActionsTarget(user)
  }, [])

  const closeRowActions = useCallback(() => {
    setActionsAnchorEl(null)
    setActionsTarget(null)
  }, [])

  const handleUnapprove = useCallback(async (targetUid: string) => {
    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(targetUid)

    try {
      const payload = await apiRequest<{ user: AppAuthUser }>(
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
  }, [setErrorMessage])

  const handleDeleteUser = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(deleteTarget.uid)

    try {
      const payload = await apiRequest<{ ok: boolean, uid: string }>(
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
  }, [deleteTarget, setErrorMessage])

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
      const payload = await apiRequest<{ user: AppAuthUser }>(
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
  }, [workerLinkTarget, workerLinkWorkerId, setErrorMessage])

  const closePromotionDialog = useCallback(() => {
    setPromotionTarget(null)
    setPromotionConfirmationText('')
  }, [])

  const handleApproveAsWorker = useCallback(async () => {
    if (!workerApproveTarget) {
      return
    }

    const selectedWorkerId = String(workerApproveWorkerId ?? '').trim()

    if (!selectedWorkerId) {
      setErrorMessage('Select a worker before approving as worker login.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setActiveUserId(workerApproveTarget.uid)

    try {
      await apiRequest<{ user: AppAuthUser }>(
        `/api/auth/users/${workerApproveTarget.uid}/approval`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            role: 'standard',
          }),
        },
      )

      const linkPayload = await apiRequest<{ user: AppAuthUser }>(
        `/api/auth/users/${workerApproveTarget.uid}/worker-link`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            workerId: selectedWorkerId,
          }),
        },
      )

      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.uid === linkPayload.user.uid ? linkPayload.user : user,
        ),
      )
      setActionMessage('User approved as worker login.')
      setWorkerApproveTarget(null)
      setWorkerApproveWorkerId('')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not approve user as worker.',
      )
    } finally {
      setActiveUserId(null)
    }
  }, [workerApproveTarget, workerApproveWorkerId, setErrorMessage])

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

  const actionsMenuOpen = Boolean(actionsAnchorEl && actionsTarget)
  const actionsTargetIsSaving = actionsTarget ? activeUserId === actionsTarget.uid : false
  const actionsTargetCanAssignStandard = Boolean(actionsTarget && !actionsTarget.isOwner)
  const actionsTargetCanEditHours = Boolean(actionsTarget && !actionsTarget.isAdmin)
  const actionsTargetCanDelete = Boolean(
    actionsTarget
    && !actionsTarget.isOwner
    && actionsTarget.uid !== appUser?.uid,
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
            Manage all users in one list. Pending accounts: {pendingCount}
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

      <StatusAlerts errorMessage={errorMessage} successMessage={actionMessage} />
      <LoadingPanel loading={isLoading} message="Loading users..." padding={4} />

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
                <TableCell>Client Access</TableCell>
                <TableCell>Last Login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {users.map((user) => {
                const isSaving = activeUserId === user.uid

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
                        label={roleLabel(user.role)}
                        size="small"
                        color={roleColor(user.role)}
                        icon={
                          user.role === 'admin' ? (
                            <ShieldRoundedIcon fontSize="small" />
                          ) : user.role === 'manager' ? (
                            <ManageAccountsRoundedIcon fontSize="small" />
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

                    <TableCell>
                      <Chip
                        label={formatClientAccessLabel(user.clientAccessMode)}
                        size="small"
                        variant="outlined"
                        color={user.clientAccessMode === 'web_and_app' ? 'success' : 'warning'}
                      />
                    </TableCell>

                    <TableCell>{formatDateTime(user.lastLoginAt)}</TableCell>

                    <TableCell align="right">
                      <IconButton
                        size="small"
                        disabled={isSaving}
                        onClick={(event) => openRowActions(event.currentTarget, user)}
                        aria-label="Open user actions"
                      >
                        <MoreVertRoundedIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <Menu
        anchorEl={actionsAnchorEl}
        open={actionsMenuOpen}
        onClose={closeRowActions}
      >
        <MenuItem disabled>
          {actionsTarget?.email ?? 'User actions'}
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || !actionsTargetCanAssignStandard}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleApprove(actionsTarget.uid, 'standard')
          }}
        >
          Set Standard
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || !actionsTargetCanAssignStandard}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleApprove(actionsTarget.uid, 'manager')
          }}
        >
          {actionsTarget?.isApproved && actionsTarget.role === 'manager' ? 'Manager' : 'Set Manager'}
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || Boolean(actionsTarget?.isOwner)}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            const requiresConfirmation = !(
              actionsTarget.isApproved
              && actionsTarget.role === 'admin'
            )

            if (requiresConfirmation) {
              setPromotionTarget(actionsTarget)
              setPromotionConfirmationText('')
              return
            }

            void handleApprove(actionsTarget.uid, 'admin', true)
          }}
        >
          {actionsTarget?.isApproved && actionsTarget.role === 'admin' ? 'Admin' : 'Make Admin'}
        </MenuItem>

        <MenuItem
          disabled={
            actionsTargetIsSaving
            || Boolean(actionsTarget?.isOwner)
            || Boolean(actionsTarget?.isAdmin)
            || actionsTarget?.role === 'manager'
          }
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            setWorkerApproveTarget(actionsTarget)
            setWorkerApproveWorkerId(actionsTarget.linkedWorkerId ?? '')
          }}
        >
          Approve Worker
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || Boolean(actionsTarget?.isOwner)}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            openWorkerLinkDialog(actionsTarget)
          }}
        >
          Assign Worker
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || !actionsTargetCanEditHours}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            openHoursEditor(actionsTarget)
          }}
        >
          Set Login Hours
        </MenuItem>

        <MenuItem
          disabled={
            actionsTargetIsSaving
            || Boolean(actionsTarget?.isOwner)
            || actionsTarget?.clientAccessMode === 'web_only'
          }
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleSetClientAccess(actionsTarget.uid, 'web_only')
          }}
        >
          Set Website Only Access
        </MenuItem>

        <MenuItem
          disabled={
            actionsTargetIsSaving
            || Boolean(actionsTarget?.isOwner)
            || actionsTarget?.clientAccessMode === 'app_only'
          }
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleSetClientAccess(actionsTarget.uid, 'app_only')
          }}
        >
          Set App Only Access
        </MenuItem>

        <MenuItem
          disabled={
            actionsTargetIsSaving
            || Boolean(actionsTarget?.isOwner)
            || actionsTarget?.clientAccessMode === 'web_and_app'
          }
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleSetClientAccess(actionsTarget.uid, 'web_and_app')
          }}
        >
          Set Web + App Access
        </MenuItem>

        <MenuItem
          disabled={
            actionsTargetIsSaving
            || Boolean(actionsTarget?.isOwner)
            || !actionsTarget?.isApproved
          }
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            void handleUnapprove(actionsTarget.uid)
          }}
        >
          Unapprove
        </MenuItem>

        <MenuItem
          disabled={actionsTargetIsSaving || !actionsTargetCanDelete}
          onClick={() => {
            if (!actionsTarget) {
              return
            }

            closeRowActions()
            setDeleteTarget(actionsTarget)
          }}
        >
          Delete
        </MenuItem>
      </Menu>

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
        open={Boolean(workerApproveTarget)}
        onClose={() => {
          if (!activeUserId) {
            setWorkerApproveTarget(null)
            setWorkerApproveWorkerId('')
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Approve As Worker Login</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Approving as worker will set the user role to Standard and require a linked worker.
            </Alert>

            <Typography variant="body2" color="text.secondary">
              {workerApproveTarget?.email}
            </Typography>

            <TextField
              select
              fullWidth
              label="Worker"
              value={workerApproveWorkerId}
              onChange={(event) => {
                setWorkerApproveWorkerId(event.target.value)
              }}
            >
              <MenuItem value="" disabled>Select worker</MenuItem>
              {workerOptions.map((worker) => {
                const workerNumber = String(worker.workerNumber ?? '').trim() || '----'
                return (
                  <MenuItem key={worker.id} value={worker.id}>
                    {workerNumber} - {worker.fullName}
                  </MenuItem>
                )
              })}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setWorkerApproveTarget(null)
              setWorkerApproveWorkerId('')
            }}
            disabled={Boolean(activeUserId)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!workerApproveTarget || !workerApproveWorkerId || activeUserId === workerApproveTarget.uid}
            onClick={() => {
              void handleApproveAsWorker()
            }}
          >
            Approve As Worker
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
