import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { AppAuthRole, AppAuthUser } from '../auth/types'

type ListUsersResponse = {
  users: AppAuthUser[]
  ownerEmail?: string
}

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

export default function AdminUsersPage() {
  const { appUser, getIdToken, ownerEmail: authOwnerEmail } = useAuth()
  const [users, setUsers] = useState<AppAuthUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeUserId, setActiveUserId] = useState<string | null>(null)

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
        const payload = await requestWithAuth<ListUsersResponse>('/api/auth/users')
        setUsers(Array.isArray(payload.users) ? payload.users : [])
      } catch (error) {
        setUsers([])
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
    async (targetUid: string, role: AppAuthRole) => {
      setErrorMessage(null)
      setActionMessage(null)
      setActiveUserId(targetUid)

      try {
        const payload = await requestWithAuth<{ user: AppAuthUser }>(
          `/api/auth/users/${targetUid}/approval`,
          {
            method: 'PATCH',
            body: JSON.stringify({ role }),
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
          <Typography variant="body2" color="text.secondary">
            Owner account is fixed to {authOwnerEmail} and always stays Admin.
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
                <TableCell>Last Login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {users.map((user) => {
                const isSaving = activeUserId === user.uid
                const canAssignStandard = !user.isOwner

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
                          disabled={isSaving}
                          onClick={() => void handleApprove(user.uid, 'admin')}
                          startIcon={<AdminPanelSettingsRoundedIcon />}
                        >
                          Admin
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
    </Stack>
  )
}
