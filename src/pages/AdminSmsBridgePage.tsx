import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
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
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { fetchAdminSmsBridgeLogs, type SmsBridgeLog } from '../features/sms-bridge/api'
import { formatDateTimeWithSeconds, formatStatusLabel } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

const logsLimit = 150

function statusChipColor(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const normalizedStatus = String(status ?? '').trim().toLowerCase()

  if (normalizedStatus === 'replied') {
    return 'success'
  }

  if (normalizedStatus === 'waiting_reply') {
    return 'info'
  }

  if (normalizedStatus === 'timeout') {
    return 'warning'
  }

  if (normalizedStatus === 'failed') {
    return 'error'
  }

  return 'default'
}

function fallbackText(value: string | null | undefined, emptyLabel = '-') {
  const normalized = String(value ?? '').trim()
  return normalized || emptyLabel
}

function sortLogsByCreatedAt(logs: SmsBridgeLog[]) {
  return [...logs].sort((left, right) => {
    const leftTimestamp = Date.parse(String(left.createdAt ?? ''))
    const rightTimestamp = Date.parse(String(right.createdAt ?? ''))

    if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
      return rightTimestamp - leftTimestamp
    }

    if (Number.isFinite(rightTimestamp)) {
      return 1
    }

    if (Number.isFinite(leftTimestamp)) {
      return -1
    }

    return String(right.id ?? '').localeCompare(String(left.id ?? ''))
  })
}

export default function AdminSmsBridgePage() {
  const logsQuery = useQuery({
    queryKey: QUERY_KEYS.adminSmsBridgeLogs(logsLimit),
    queryFn: () => fetchAdminSmsBridgeLogs(logsLimit),
    staleTime: 30 * 1000,
  })

  const logs = useMemo(() => {
    return sortLogsByCreatedAt(logsQuery.data?.logs ?? [])
  }, [logsQuery.data?.logs])

  const errorMessage = logsQuery.error instanceof Error
    ? logsQuery.error.message
    : null

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Stack direction="row" spacing={1.2} alignItems="center">
            <ChatBubbleOutlineRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={700}>
                SMS Bridge Logs
              </Typography>
              <Typography color="text.secondary">
                Incoming Twilio SMS requests, Telegram relay messages, and returned SMS replies.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={`${logs.length} logs`}
              color="primary"
              variant="outlined"
              size="small"
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                void logsQuery.refetch()
              }}
              disabled={logsQuery.isFetching}
            >
              {logsQuery.isFetching ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />

      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        {logsQuery.isLoading ? (
          <LoadingPanel loading message="Loading SMS bridge logs..." />
        ) : logs.length === 0 ? (
          <Typography color="text.secondary">No SMS bridge logs yet.</Typography>
        ) : (
          <TableContainer sx={{ maxHeight: { xs: 460, md: 620 } }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 170 }}>Received</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>Status</TableCell>
                  <TableCell sx={{ minWidth: 150 }}>From</TableCell>
                  <TableCell sx={{ minWidth: 300 }}>Incoming SMS</TableCell>
                  <TableCell sx={{ minWidth: 320 }}>Telegram Reply</TableCell>
                  <TableCell sx={{ minWidth: 170 }}>Reply Sender</TableCell>
                  <TableCell sx={{ minWidth: 240 }}>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>{formatDateTimeWithSeconds(log.createdAt)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={statusChipColor(log.status)}
                        label={formatStatusLabel(log.status || 'unknown')}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {fallbackText(log.fromPhone)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {fallbackText(log.inboundText)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {fallbackText(log.telegramReplyText)}
                      </Typography>
                    </TableCell>
                    <TableCell>{fallbackText(log.telegramReplyFrom)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color={log.errorMessage ? 'error.main' : 'text.secondary'}>
                        {fallbackText(log.errorMessage)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  )
}
