import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
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
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { fetchAdminVisitorsHistory } from '../features/visitors/api'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

const usersLimit = 120
const entriesPerUser = 120

function roleLabel(role: string | null | undefined, isOwner: boolean) {
  if (isOwner) {
    return 'Owner'
  }

  if (role === 'admin') {
    return 'Admin'
  }

  if (role === 'manager') {
    return 'Manager'
  }

  if (role === 'sales_rep') {
    return 'Sales Rep'
  }

  return 'Standard'
}

function visitTypeLabel(visitType: string | null | undefined, otherVisitType?: string | null) {
  const normalizedType = String(visitType ?? '').trim().toLowerCase()
  const normalizedOtherType = String(otherVisitType ?? '').trim()

  if (normalizedType === 'delivery') {
    return 'Delivery'
  }

  if (normalizedType === 'vendor') {
    return 'Vendor / Supplier'
  }

  if (normalizedType === 'service') {
    return 'Service / Repair'
  }

  if (normalizedType === 'inspection') {
    return 'Inspection / Compliance'
  }

  if (normalizedType === 'other') {
    return normalizedOtherType ? `Other: ${normalizedOtherType}` : 'Other'
  }

  return 'Other'
}

export default function AdminVisitorsPage() {
  const { appUser } = useAuth()
  const [search, setSearch] = useState('')
  const [expandedUids, setExpandedUids] = useState<string[]>([])

  const normalizedSearch = search.trim().toLowerCase()

  const historyQuery = useQuery({
    queryKey: QUERY_KEYS.adminVisitorsHistory(
      normalizedSearch,
      '',
      usersLimit,
      entriesPerUser,
    ),
    queryFn: () => fetchAdminVisitorsHistory({
      search: normalizedSearch || undefined,
      usersLimit,
      entriesPerUser,
    }),
    enabled: Boolean(appUser?.isAdmin),
    staleTime: 60 * 1000,
  })

  const users = Array.isArray(historyQuery.data?.users)
    ? historyQuery.data.users
    : []

  const totals = useMemo(() => {
    return users.reduce(
      (accumulator, user) => {
        return {
          totalHours: accumulator.totalHours + (Number(user.totalHours) || 0),
          totalEntries: accumulator.totalEntries + (Number(user.totalEntries) || 0),
          activeEntries: accumulator.activeEntries + (Number(user.activeEntries) || 0),
        }
      },
      {
        totalHours: 0,
        totalEntries: 0,
        activeEntries: 0,
      },
    )
  }, [users])

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  const errorMessage = historyQuery.error instanceof Error
    ? historyQuery.error.message
    : null

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.25 } }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
              <PeopleAltRoundedIcon color="primary" />
              <Box>
                <Typography variant="h6" fontWeight={700}>Visitors by User</Typography>
                <Typography color="text.secondary">
                  Full visitor history grouped by user with expandable entry details.
                </Typography>
              </Box>
            </Stack>

            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                void historyQuery.refetch()
              }}
              disabled={historyQuery.isFetching}
            >
              Refresh
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
            <Chip label={`Users: ${users.length}`} variant="outlined" />
            <Chip label={`Total hours: ${totals.totalHours.toFixed(2)}`} variant="outlined" />
            <Chip label={`Total entries: ${totals.totalEntries}`} variant="outlined" />
            <Chip label={`Active now: ${totals.activeEntries}`} variant="outlined" color={totals.activeEntries > 0 ? 'warning' : 'default'} />
          </Stack>

          <TextField
            label="Search users"
            placeholder="Name, email, role, or uid"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
            size="small"
            fullWidth
          />
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />

      {historyQuery.isLoading ? (
        <LoadingPanel loading message="Loading visitor history..." />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 680 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 60 }} />
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Total Hours</TableCell>
                <TableCell align="right">Total Entries</TableCell>
                <TableCell align="right">Active Now</TableCell>
                <TableCell>Last Visit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography color="text.secondary">
                      No visitor history found.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const isExpanded = expandedUids.includes(user.uid)
                  const labelName = user.displayName || user.email || user.uid

                  return (
                    <Fragment key={user.uid}>
                      <TableRow hover>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => {
                              setExpandedUids((current) => {
                                return isExpanded
                                  ? current.filter((uid) => uid !== user.uid)
                                  : [...current, user.uid]
                              })
                            }}
                          >
                            {isExpanded ? <KeyboardArrowUpRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography fontWeight={600}>{labelName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {user.email || user.uid}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{roleLabel(user.role, user.isOwner)}</TableCell>
                        <TableCell align="right">{Number(user.totalHours).toFixed(2)}</TableCell>
                        <TableCell align="right">{user.totalEntries}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            label={String(user.activeEntries)}
                            color={user.activeEntries > 0 ? 'warning' : 'default'}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{formatDateTime(user.lastVisitAt)}</TableCell>
                      </TableRow>

                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 0, borderBottom: isExpanded ? undefined : 0 }}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 1.5 }}>
                              <Table size="small" sx={{ mb: 0.75 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Visitor</TableCell>
                                    <TableCell>Company</TableCell>
                                    <TableCell>Type</TableCell>
                                    <TableCell align="right">Duration</TableCell>
                                    <TableCell>Checked In</TableCell>
                                    <TableCell>Expires</TableCell>
                                    <TableCell>Status</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {user.entries.length === 0 ? (
                                    <TableRow>
                                      <TableCell colSpan={7}>
                                        <Typography color="text.secondary">
                                          No entries for this user.
                                        </Typography>
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    user.entries.map((entry) => {
                                      const isActive = Date.parse(String(entry.expiresAt ?? '')) > Date.now()

                                      return (
                                        <TableRow key={entry.id} hover>
                                          <TableCell>{entry.name}</TableCell>
                                          <TableCell>{entry.company}</TableCell>
                                          <TableCell>{visitTypeLabel(entry.visitType, entry.otherVisitType)}</TableCell>
                                          <TableCell align="right">{entry.durationMinutes} min</TableCell>
                                          <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                                          <TableCell>{formatDateTime(entry.expiresAt)}</TableCell>
                                          <TableCell>
                                            <Chip
                                              size="small"
                                              label={isActive ? 'Inside' : 'Expired'}
                                              color={isActive ? 'warning' : 'default'}
                                              variant="outlined"
                                            />
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })
                                  )}
                                </TableBody>
                              </Table>
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}
