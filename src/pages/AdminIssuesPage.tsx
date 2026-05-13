import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchTimesheetBootstrap,
  type TimesheetWebsiteIssueDuplicateMondayLink,
  type TimesheetWebsiteIssueHazard,
  type TimesheetWebsiteIssueMissingShopDrawing,
  type TimesheetWebsiteIssueUnmappedJob,
} from '../features/timesheet/api'
import { QUERY_KEYS } from '../lib/queryKeys'

type UnifiedIssueRow = {
  id: string
  source: string
  issueType: string
  reference: string
  details: string
}

export default function AdminIssuesPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()

  const issuesQuery = useQuery({
    queryKey: QUERY_KEYS.adminIssues,
    queryFn: () => fetchTimesheetBootstrap(),
    staleTime: 2 * 60 * 1000,
  })

  const isLoading = issuesQuery.isLoading
  const isRefreshing = issuesQuery.isFetching && !issuesQuery.isLoading
  const errorMessage = issuesQuery.error instanceof Error
    ? issuesQuery.error.message
    : null

  const websiteIssues = issuesQuery.data?.websiteIssues ?? null
  const issueCounts = useMemo(() => {
    const counts = websiteIssues?.counts

    if (!counts) {
      return {
        total: 0,
        hazard: 0,
        duplicateMondayLinks: 0,
        unmappedTimesheetJobs: 0,
        missingShopDrawings: 0,
      }
    }

    return {
      total: Number(counts.total ?? 0),
      hazard: Number(counts.hazard ?? 0),
      duplicateMondayLinks: Number(counts.duplicateMondayLinks ?? 0),
      unmappedTimesheetJobs: Number(counts.unmappedTimesheetJobs ?? 0),
      missingShopDrawings: Number(counts.missingShopDrawings ?? 0),
    }
  }, [websiteIssues])

  const issueRows = useMemo<UnifiedIssueRow[]>(() => {
    const rows: UnifiedIssueRow[] = []
    const hazards = Array.isArray(websiteIssues?.hazards)
      ? websiteIssues.hazards
      : []
    const missingShopDrawings = Array.isArray(websiteIssues?.missingShopDrawings)
      ? websiteIssues.missingShopDrawings
      : []
    const unmappedTimesheetJobs = Array.isArray(websiteIssues?.unmappedTimesheetJobs)
      ? websiteIssues.unmappedTimesheetJobs
      : []
    const duplicateMondayLinks = Array.isArray(websiteIssues?.duplicateMondayLinks)
      ? websiteIssues.duplicateMondayLinks
      : []

    hazards.forEach((row: TimesheetWebsiteIssueHazard, index) => {
      rows.push({
        id: `hazard:${row.orderNumber || '-'}:${index}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Hazard Row',
        reference: row.orderNumber || row.orderName || '-',
        details: String(row.hazardReason ?? '').trim() || 'Hazard flagged in unified data',
      })
    })

    missingShopDrawings.forEach((row: TimesheetWebsiteIssueMissingShopDrawing, index) => {
      rows.push({
        id: `missing-drawing:${row.orderNumber || '-'}:${index}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Missing Shop Drawing',
        reference: row.orderNumber || row.orderName || row.mondayItemId || '-',
        details: row.mondayItemId
          ? `Monday item ${row.mondayItemId} has no drawing.`
          : 'No shop drawing linked.',
      })
    })

    unmappedTimesheetJobs.forEach((row: TimesheetWebsiteIssueUnmappedJob) => {
      rows.push({
        id: `unmapped:${row.jobName}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Unmapped Timesheet Job',
        reference: row.jobName,
        details: `Entries: ${row.entryCount}, Ready % rows: ${row.progressCount}`,
      })
    })

    duplicateMondayLinks.forEach((row: TimesheetWebsiteIssueDuplicateMondayLink) => {
      rows.push({
        id: `dup-link:${row.mondayItemId}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Duplicate Monday Link',
        reference: row.mondayItemId,
        details: row.orderNumbers.length > 0
          ? `Linked order numbers: ${row.orderNumbers.join(', ')}`
          : `Duplicate link count: ${row.count}`,
      })
    })

    return rows
  }, [websiteIssues])

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Stack direction="row" spacing={1.2} alignItems="center">
              <ReportProblemRoundedIcon color="primary" />
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Admin Issues
                </Typography>
                <Typography color="text.secondary">
                  One issues box for current and future issue types.
                </Typography>
              </Box>
            </Stack>

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isRefreshing || isLoading}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminIssues })
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>

          <StatusAlerts errorMessage={errorMessage} />

          {isLoading ? (
            <LoadingPanel loading={isLoading} message="Loading issues..." contained={false} size={18} />
          ) : null}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Typography variant="subtitle1" fontWeight={700}>
                  Issues Box
                </Typography>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip color="error" label={`Total ${issueCounts.total}`} />
                  <Chip label={`Hazards ${issueCounts.hazard}`} />
                  <Chip label={`Missing drawings ${issueCounts.missingShopDrawings}`} />
                  <Chip label={`Unmapped jobs ${issueCounts.unmappedTimesheetJobs}`} />
                  <Chip label={`Duplicate links ${issueCounts.duplicateMondayLinks}`} />
                </Stack>
              </Stack>

              <Typography variant="body2" color="text.secondary">
                Current stream: Timesheet / Orders Integrity. Additional issue streams can be added into this same box later.
              </Typography>

              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, maxHeight: 560 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Source</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Reference</TableCell>
                      <TableCell>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {issueRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography color="text.secondary">
                            No issues found right now.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      issueRows.map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell>{row.source}</TableCell>
                          <TableCell>{row.issueType}</TableCell>
                          <TableCell>{row.reference}</TableCell>
                          <TableCell>{row.details}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Typography variant="caption" color="text.secondary">
                Generated: {websiteIssues?.generatedAt ? new Date(websiteIssues.generatedAt).toLocaleString('en-US') : 'Not available'}
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      </Paper>
    </Stack>
  )
}
