import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMondayDashboardSnapshot,
  type DashboardOrder,
  type MondayDashboardSnapshot,
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

function buildPriorityOrders(snapshot: MondayDashboardSnapshot | null) {
  if (!snapshot) {
    return []
  }

  const uniqueById = new Map<string, DashboardOrder>()

  snapshot.details.lateOrders.slice(0, 8).forEach((order) => {
    uniqueById.set(order.id, order)
  })

  snapshot.details.dueSoonOrders.slice(0, 8).forEach((order) => {
    if (!uniqueById.has(order.id)) {
      uniqueById.set(order.id, order)
    }
  })

  return [...uniqueById.values()].sort((left, right) => {
    if (left.isLate !== right.isLate) {
      return left.isLate ? -1 : 1
    }

    const leftDue = typeof left.daysUntilDue === 'number' ? left.daysUntilDue : Number.POSITIVE_INFINITY
    const rightDue = typeof right.daysUntilDue === 'number' ? right.daysUntilDue : Number.POSITIVE_INFINITY

    return leftDue - rightDue
  })
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<MondayDashboardSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<DrilldownKey | null>(null)

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const nextSnapshot = await fetchMondayDashboardSnapshot()
      setSnapshot(nextSnapshot)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load dashboard data.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
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

  const drilldownOrders = activeDrilldown && snapshot ? snapshot.details[activeDrilldown] : []
  const priorityOrders = useMemo(() => buildPriorityOrders(snapshot), [snapshot])

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
          {snapshot?.board.url ? (
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

          <Button
            variant="contained"
            onClick={() => void loadDashboard()}
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

      {isLoading && !snapshot ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading monday board summary...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {snapshot ? (
        <>
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

          <Paper variant="outlined" sx={{ p: 2.25 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={700}>
                Critical Orders
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Orders flagged as late or due in the next seven days based on lead-time dates.
              </Typography>

              {priorityOrders.length === 0 ? (
                <Alert severity="success">No urgent orders right now.</Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Order</TableCell>
                        <TableCell>Workflow</TableCell>
                        <TableCell>Lead-Time Due</TableCell>
                        <TableCell>Progress</TableCell>
                        <TableCell>Ship Date</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {priorityOrders.slice(0, 12).map((order) => (
                        <TableRow key={order.id} hover>
                          <TableCell>
                            <Stack spacing={0.25}>
                              <Typography fontWeight={600}>{order.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {order.groupTitle}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ minWidth: 200 }}>
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
            </Stack>
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(1, minmax(0, 1fr))',
                lg: 'repeat(2, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Stack spacing={1.25}>
                <Typography variant="h6" fontWeight={700}>
                  Status Breakdown
                </Typography>
                {snapshot.buckets.byStatus.length === 0 ? (
                  <Typography color="text.secondary">No statuses found on this board.</Typography>
                ) : (
                  snapshot.buckets.byStatus.map((entry) => {
                    const pct = snapshot.metrics.totalOrders
                      ? (entry.count / snapshot.metrics.totalOrders) * 100
                      : 0

                    return (
                      <Stack key={entry.label} spacing={0.6}>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="body2" fontWeight={600}>
                            {entry.label}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {entry.count}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{ height: 8, borderRadius: 8 }}
                        />
                      </Stack>
                    )
                  })
                )}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Stack spacing={1.25}>
                <Typography variant="h6" fontWeight={700}>
                  Production Notes
                </Typography>
                <Stack spacing={1}>
                  <Tooltip title="Shipped means Ship Date is filled. Ready alone is not considered shipped.">
                    <Chip
                      icon={<AccessTimeRoundedIcon />}
                      label={`Shipped count: ${snapshot.metrics.completedOrders}`}
                      variant="outlined"
                    />
                  </Tooltip>
                  <Chip
                    icon={<ErrorOutlineRoundedIcon />}
                    color="error"
                    variant="outlined"
                    label={`Late now: ${snapshot.metrics.lateOrders}`}
                  />
                  <Chip
                    icon={<ScheduleRoundedIcon />}
                    color="warning"
                    variant="outlined"
                    label={`Due this week: ${snapshot.metrics.dueSoonOrders}`}
                  />
                </Stack>

                <Divider />

                <Typography variant="body2" color="text.secondary">
                  Suggestions:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  1. Keep due-date columns filled on each order so late alerts stay accurate.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  2. Lead Time is treated as the due date for readiness and lateness.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  3. Progress uses weighted status columns: Design/Base/Form/Build/Sand/Sealer/Lacquer/Ready/Invoiced.
                </Typography>
              </Stack>
            </Paper>
          </Box>

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
    </Stack>
  )
}