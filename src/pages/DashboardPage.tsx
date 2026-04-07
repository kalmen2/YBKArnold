import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
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
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMondayDashboardSnapshot,
  type MondayDashboardSnapshot,
  fetchZendeskTicketSummary,
  type DashboardOrder,
  type ZendeskTicketSummarySnapshot,
} from '../features/dashboard/api'

type DrilldownKey =
  | 'lateOrders'
  | 'dueSoonOrders'
  | 'activeOrders'
  | 'completedOrders'
  | 'missingDueDateOrders'

type SummaryCard = {
  key: DrilldownKey
  label: string
  value: number
  helper: string
  icon: ReactNode
  color: string
}

type ZendeskSummaryCard = {
  key: 'newTickets' | 'inProgressTickets' | 'openTickets' | 'pendingTickets' | 'solvedTickets'
  label: string
  value: number
  helper: string
  icon: ReactNode
  color: string
}

const drilldownTitles: Record<DrilldownKey, string> = {
  lateOrders: 'Late Orders',
  dueSoonOrders: 'Due In Next 7 Days',
  activeOrders: 'Active Orders',
  completedOrders: 'Shipped Orders',
  missingDueDateOrders: 'Missing Due Date',
}

function formatDisplayDate(value: string | null) {
  if (!value) {
    return '—'
  }

  const parsed = new Date(`${value}T00:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function formatSyncTimestamp(value: string) {
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

function dueLabel(order: DashboardOrder) {
  if (order.isDone) {
    return 'Shipped'
  }

  if (typeof order.daysUntilDue !== 'number') {
    return 'No due date'
  }

  if (order.daysUntilDue < 0) {
    return `${Math.abs(order.daysUntilDue)}d late`
  }

  if (order.daysUntilDue === 0) {
    return 'Due today'
  }

  return `${order.daysUntilDue}d left`
}

function dueColor(order: DashboardOrder): 'error' | 'warning' | 'success' | 'default' {
  if (order.isDone) {
    return 'success'
  }

  if (order.isLate) {
    return 'error'
  }

  if (typeof order.daysUntilDue === 'number' && order.daysUntilDue <= 7) {
    return 'warning'
  }

  return 'default'
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<MondayDashboardSnapshot | null>(null)
  const [zendeskSnapshot, setZendeskSnapshot] = useState<ZendeskTicketSummarySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [zendeskErrorMessage, setZendeskErrorMessage] = useState<string | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<DrilldownKey | null>(null)

  const loadDashboard = useCallback(async (refreshRequested = false) => {
    setIsLoading(true)
    setErrorMessage(null)
    setZendeskErrorMessage(null)

    const [mondayResult, zendeskResult] = await Promise.allSettled([
      fetchMondayDashboardSnapshot({ refresh: refreshRequested }),
      fetchZendeskTicketSummary({ refresh: refreshRequested }),
    ])

    if (mondayResult.status === 'fulfilled') {
      setSnapshot(mondayResult.value)
    } else {
      setSnapshot(null)
      setErrorMessage(
        mondayResult.reason instanceof Error
          ? mondayResult.reason.message
          : 'Failed to load dashboard data.',
      )
    }

    if (zendeskResult.status === 'fulfilled') {
      setZendeskSnapshot(zendeskResult.value)
    } else {
      setZendeskSnapshot(null)
      setZendeskErrorMessage(
        zendeskResult.reason instanceof Error
          ? zendeskResult.reason.message
          : 'Failed to load Zendesk ticket summary.',
      )
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard(false)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadDashboard])

  const summaryCards = useMemo<SummaryCard[]>(() => {
    if (!snapshot) {
      return []
    }

    return [
      {
        key: 'lateOrders',
        label: 'Late Orders',
        value: snapshot.metrics.lateOrders,
        helper: 'Needs immediate action',
        icon: <ErrorOutlineRoundedIcon />,
        color: '#c62828',
      },
      {
        key: 'dueSoonOrders',
        label: 'Due This Week',
        value: snapshot.metrics.dueSoonOrders,
        helper: 'Upcoming within 7 days',
        icon: <ScheduleRoundedIcon />,
        color: '#ef6c00',
      },
      {
        key: 'activeOrders',
        label: 'In Progress',
        value: snapshot.metrics.activeOrders,
        helper: 'Open production workload',
        icon: <AccessTimeRoundedIcon />,
        color: '#1565c0',
      },
      {
        key: 'completedOrders',
        label: 'Shipped',
        value: snapshot.metrics.completedOrders,
        helper: 'Orders with Ship Date set',
        icon: <AssignmentTurnedInRoundedIcon />,
        color: '#2e7d32',
      },
      {
        key: 'missingDueDateOrders',
        label: 'Missing Due Date',
        value: snapshot.metrics.missingDueDateOrders,
        helper: 'Cannot forecast lateness yet',
        icon: <FactCheckRoundedIcon />,
        color: '#6a1b9a',
      },
    ]
  }, [snapshot])

  const zendeskSummaryCards = useMemo<ZendeskSummaryCard[]>(() => {
    if (!zendeskSnapshot) {
      return []
    }

    return [
      {
        key: 'newTickets',
        label: 'New',
        value: zendeskSnapshot.metrics.newTickets,
        helper: 'Brand new tickets',
        icon: <MarkEmailUnreadRoundedIcon />,
        color: '#1e88e5',
      },
      {
        key: 'inProgressTickets',
        label: 'In Process',
        value: zendeskSnapshot.metrics.inProgressTickets,
        helper: 'Tickets with status In Progress',
        icon: <EngineeringRoundedIcon />,
        color: '#5e35b1',
      },
      {
        key: 'openTickets',
        label: 'Open',
        value: zendeskSnapshot.metrics.openTickets,
        helper: 'Tickets with status open',
        icon: <AccessTimeRoundedIcon />,
        color: '#fb8c00',
      },
      {
        key: 'pendingTickets',
        label: 'Pending',
        value: zendeskSnapshot.metrics.pendingTickets,
        helper: 'Waiting for customer response',
        icon: <PendingActionsRoundedIcon />,
        color: '#8d6e63',
      },
      {
        key: 'solvedTickets',
        label: 'Solved',
        value: zendeskSnapshot.metrics.solvedTickets,
        helper: 'Done',
        icon: <TaskAltRoundedIcon />,
        color: '#2e7d32',
      },
    ]
  }, [zendeskSnapshot])

  const drilldownOrders = activeDrilldown && snapshot ? snapshot.details[activeDrilldown] : []

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
            Order Dashboard
          </Typography>
          {snapshot ? (
            <Typography color="text.secondary">
              {snapshot.board.name} • Last sync {formatSyncTimestamp(snapshot.generatedAt)}
            </Typography>
          ) : (
            <Typography color="text.secondary">Live monday.com board intelligence</Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1.25}>
          <Button
            variant="contained"
            onClick={() => void loadDashboard(true)}
            startIcon={<RefreshRoundedIcon />}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : null}

      {zendeskErrorMessage ? (
        <Alert severity="warning">{zendeskErrorMessage}</Alert>
      ) : null}

      {isLoading && !snapshot && !zendeskSnapshot ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading dashboard data...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {snapshot ? (
        <>
          <Paper variant="outlined" sx={{ p: 2.25 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
                gap={1}
              >
                <Typography variant="h6" fontWeight={700}>
                  Order Progress
                </Typography>

                {snapshot.board.url ? (
                  <Button
                    variant="outlined"
                    color="inherit"
                    href={snapshot.board.url}
                    target="_blank"
                    rel="noreferrer"
                    startIcon={<OpenInNewRoundedIcon />}
                  >
                    Open Board
                  </Button>
                ) : null}
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Orders from Monday board: {snapshot.board.name}
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(1, minmax(0, 1fr))',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(5, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                {summaryCards.map((card) => (
                  <Paper
                    key={card.key}
                    variant="outlined"
                    onClick={() => setActiveDrilldown(card.key)}
                    sx={{
                      p: 2,
                      borderLeft: `4px solid ${card.color}`,
                      cursor: 'pointer',
                      transition: 'transform 120ms ease, box-shadow 120ms ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: 3,
                      },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {card.label}
                        </Typography>
                        <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                          {card.value}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {card.helper}
                        </Typography>
                      </Box>
                      <Box sx={{ color: card.color }}>{card.icon}</Box>
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Stack>
          </Paper>

          <Dialog
            open={Boolean(activeDrilldown)}
            onClose={() => setActiveDrilldown(null)}
            maxWidth="lg"
            fullWidth
          >
            <DialogTitle>{activeDrilldown ? drilldownTitles[activeDrilldown] : 'Details'}</DialogTitle>
            <DialogContent>
              {drilldownOrders.length === 0 ? (
                <Typography color="text.secondary">No orders in this section.</Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Order</TableCell>
                        <TableCell>Group</TableCell>
                        <TableCell>Workflow</TableCell>
                        <TableCell>Lead-Time Due</TableCell>
                        <TableCell>Progress</TableCell>
                        <TableCell>Ship Date</TableCell>
                        <TableCell align="right">Link</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {drilldownOrders.map((order) => (
                        <TableRow key={order.id} hover>
                          <TableCell>
                            <Typography fontWeight={600}>{order.name}</Typography>
                          </TableCell>
                          <TableCell>{order.groupTitle}</TableCell>
                          <TableCell>
                            <Chip size="small" label={order.statusLabel || 'Unspecified'} />
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.2}>
                              <Typography variant="body2">
                                {formatDisplayDate(order.effectiveDueDate)}
                              </Typography>
                              <Chip
                                size="small"
                                label={dueLabel(order)}
                                color={dueColor(order)}
                                variant="outlined"
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {typeof order.progressPercent === 'number' ? `${order.progressPercent}%` : '—'}
                          </TableCell>
                          <TableCell>{formatDisplayDate(order.shippedAt)}</TableCell>
                          <TableCell align="right">
                            {order.itemUrl ? (
                              <Button
                                size="small"
                                href={order.itemUrl}
                                target="_blank"
                                rel="noreferrer"
                                endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 16 }} />}
                              >
                                Open
                              </Button>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                No link
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {zendeskSnapshot ? (
        <Paper variant="outlined" sx={{ p: 2.25 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', md: 'center' }}
              gap={1}
            >
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Tickets Progress
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Tickets from Zendesk helpdesk
                </Typography>
              </Box>

              {zendeskSnapshot.agentUrl ? (
                <Button
                  variant="outlined"
                  color="inherit"
                  href={zendeskSnapshot.agentUrl}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={<OpenInNewRoundedIcon />}
                >
                  Open Helpdesk
                </Button>
              ) : null}
            </Stack>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(1, minmax(0, 1fr))',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(5, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              {zendeskSummaryCards.map((card) => (
                <Paper
                  key={card.key}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderLeft: `4px solid ${card.color}`,
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {card.label}
                      </Typography>
                      <Typography variant="h4" fontWeight={800} lineHeight={1.1}>
                        {card.value}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {card.helper}
                      </Typography>
                    </Box>
                    <Box sx={{ color: card.color }}>{card.icon}</Box>
                  </Stack>
                </Paper>
              ))}
            </Box>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}