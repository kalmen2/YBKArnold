import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createSavedVisitorShortcut,
  createVisitorLog,
  deleteSavedVisitorShortcut,
  fetchRecentVisitorLogs,
  fetchSavedVisitorShortcuts,
  type VisitorVisitType,
} from '../features/visitors/api'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type DurationOption = {
  label: string
  minutes: number
}

type SavedVisitor = {
  id: string
  name: string
  company: string
  visitType: VisitorVisitType
  otherVisitType: string | null
}

const savedVisitorsLimit = 120
const recentWindowMinutes = 60
const recentLogsLimit = 120

const visitTypeOptions: Array<{ value: VisitorVisitType, label: string }> = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'vendor', label: 'Vendor / Supplier' },
  { value: 'service', label: 'Service / Repair' },
  { value: 'inspection', label: 'Inspection / Compliance' },
  { value: 'other', label: 'Other' },
]

const durationOptions: DurationOption[] = [
  { label: '5 minutes', minutes: 5 },
  { label: '50 minutes', minutes: 50 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
]

function visitTypeLabel(value: VisitorVisitType, otherVisitType?: string | null) {
  if (value === 'other') {
    const otherLabel = String(otherVisitType ?? '').trim()

    return otherLabel ? `Other: ${otherLabel}` : 'Other'
  }

  return visitTypeOptions.find((option) => option.value === value)?.label || 'Other'
}

export default function VisitorsPage() {
  const queryClient = useQueryClient()
  const [visitorName, setVisitorName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [visitType, setVisitType] = useState<VisitorVisitType>('delivery')
  const [otherVisitType, setOtherVisitType] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<number>(5)
  const [saveVisitorShortcut, setSaveVisitorShortcut] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const savedVisitorsQuery = useQuery({
    queryKey: QUERY_KEYS.visitorsSaved(savedVisitorsLimit),
    queryFn: () => fetchSavedVisitorShortcuts(savedVisitorsLimit),
    staleTime: 60 * 1000,
  })

  const recentLogsQuery = useQuery({
    queryKey: QUERY_KEYS.visitorsRecent(recentWindowMinutes, recentLogsLimit),
    queryFn: () => fetchRecentVisitorLogs(recentWindowMinutes, recentLogsLimit),
    staleTime: 20 * 1000,
  })

  const createVisitorLogMutation = useMutation({
    mutationFn: createVisitorLog,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.visitorsRecent(recentWindowMinutes, recentLogsLimit),
      })
    },
  })

  const createSavedVisitorShortcutMutation = useMutation({
    mutationFn: createSavedVisitorShortcut,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.visitorsSaved(savedVisitorsLimit),
      })
    },
  })

  const deleteSavedVisitorShortcutMutation = useMutation({
    mutationFn: deleteSavedVisitorShortcut,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.visitorsSaved(savedVisitorsLimit),
      })
    },
  })

  const savedVisitors = useMemo<SavedVisitor[]>(() => {
    const shortcuts = Array.isArray(savedVisitorsQuery.data?.shortcuts)
      ? savedVisitorsQuery.data.shortcuts
      : []

    return shortcuts.map((shortcut) => ({
      id: shortcut.id,
      name: shortcut.name,
      company: shortcut.company,
      visitType: shortcut.visitType,
      otherVisitType: shortcut.otherVisitType,
    }))
  }, [savedVisitorsQuery.data])

  const sortedLogs = useMemo(() => {
    const entries = Array.isArray(recentLogsQuery.data?.entries)
      ? recentLogsQuery.data.entries
      : []

    return [...entries].sort((left, right) => {
      const rightTime = Date.parse(String(right.createdAt ?? ''))
      const leftTime = Date.parse(String(left.createdAt ?? ''))

      return rightTime - leftTime
    })
  }, [recentLogsQuery.data])

  const combinedErrorMessage = errorMessage
    || (savedVisitorsQuery.error instanceof Error ? savedVisitorsQuery.error.message : null)
    || (recentLogsQuery.error instanceof Error ? recentLogsQuery.error.message : null)

  const isSavingEntry =
    createVisitorLogMutation.isPending
    || createSavedVisitorShortcutMutation.isPending

  const handleSubmitVisitor = () => {
    const normalizedName = visitorName.trim()
    const normalizedCompany = companyName.trim()
    const normalizedOtherVisitType = otherVisitType.trim()

    if (!normalizedName) {
      setErrorMessage('Visitor name is required.')
      setSuccessMessage(null)
      return
    }

    if (!normalizedCompany) {
      setErrorMessage('Company is required.')
      setSuccessMessage(null)
      return
    }

    if (visitType === 'other' && !normalizedOtherVisitType) {
      setErrorMessage('Please specify the visitor type.')
      setSuccessMessage(null)
      return
    }

    if (durationMinutes > 60) {
      setErrorMessage('Visit duration cannot be more than 1 hour.')
      setSuccessMessage(null)
      return
    }

    void createVisitorLogMutation
      .mutateAsync({
        name: normalizedName,
        company: normalizedCompany,
        visitType,
        otherVisitType: visitType === 'other' ? normalizedOtherVisitType : null,
        durationMinutes,
      })
      .then(async () => {
        if (saveVisitorShortcut) {
          try {
            await createSavedVisitorShortcutMutation.mutateAsync({
              name: normalizedName,
              company: normalizedCompany,
              visitType,
              otherVisitType: visitType === 'other' ? normalizedOtherVisitType : null,
            })
          } catch {
            setErrorMessage('Visitor entry was saved, but the shared saved-visitor shortcut failed to save.')
            setSuccessMessage('Visitor logged successfully.')
            return
          }
        }

        setErrorMessage(null)
        setSuccessMessage('Visitor logged successfully.')
        setVisitorName('')
        setCompanyName('')
        setVisitType('delivery')
        setOtherVisitType('')
        setDurationMinutes(5)
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Could not save visitor entry.')
        setSuccessMessage(null)
      })
  }

  const handleUseSavedVisitor = (visitor: SavedVisitor) => {
    setVisitorName(visitor.name)
    setCompanyName(visitor.company)
    setVisitType(visitor.visitType)
    setOtherVisitType(visitor.otherVisitType || '')
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  const handleDeleteSavedVisitor = (id: string) => {
    setErrorMessage(null)
    setSuccessMessage(null)

    void deleteSavedVisitorShortcutMutation
      .mutateAsync(id)
      .then(() => {
        setSuccessMessage('Saved visitor removed.')
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Could not remove saved visitor.')
      })
  }

  return (
    <Stack spacing={2.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderColor: '#A7C7E7',
          background: 'linear-gradient(135deg, #eff6ff 0%, #f8fbff 50%, #ffffff 100%)',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.75} alignItems={{ xs: 'flex-start', md: 'center' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '14px',
              bgcolor: '#0b3a75',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 8px 20px rgba(11,58,117,0.25)',
            }}
          >
            <ShieldRoundedIcon />
          </Box>

          <Box>
            <Typography variant="h4" fontWeight={800} sx={{ color: '#0d2d57' }}>
              Amtrust Visitor Access
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <StatusAlerts
        errorMessage={combinedErrorMessage}
        successMessage={successMessage}
      />

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={1}
          >
            <Typography variant="h6" fontWeight={700}>New Visitor Entry</Typography>

            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                setErrorMessage(null)
                setSuccessMessage(null)
                void Promise.all([recentLogsQuery.refetch(), savedVisitorsQuery.refetch()])
              }}
              disabled={recentLogsQuery.isFetching || savedVisitorsQuery.isFetching}
            >
              Refresh
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <TextField
              label="Visitor Name"
              value={visitorName}
              onChange={(event) => setVisitorName(event.target.value)}
              fullWidth
            />
            <TextField
              label="Company"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <FormControl fullWidth>
              <InputLabel id="visitor-type-label">Visitor Type</InputLabel>
              <Select
                labelId="visitor-type-label"
                label="Visitor Type"
                value={visitType}
                onChange={(event) => setVisitType(event.target.value as VisitorVisitType)}
              >
                {visitTypeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {visitType === 'other' ? (
              <TextField
                label="Other Visitor Type"
                value={otherVisitType}
                onChange={(event) => setOtherVisitType(event.target.value)}
                fullWidth
              />
            ) : null}

            <FormControl fullWidth>
              <InputLabel id="visitor-duration-label">Allowed Time</InputLabel>
              <Select
                labelId="visitor-duration-label"
                label="Allowed Time"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
              >
                {durationOptions.map((option) => (
                  <MenuItem key={option.minutes} value={option.minutes}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="flex-end" spacing={1}>
            <FormControlLabel
              control={(
                <Switch
                  checked={saveVisitorShortcut}
                  onChange={(_event, checked) => setSaveVisitorShortcut(checked)}
                />
              )}
              label="Save this visitor for all users"
            />
          </Stack>

          <Box>
            <Button
              variant="contained"
              onClick={handleSubmitVisitor}
              disabled={isSavingEntry}
            >
              {isSavingEntry ? 'Saving...' : 'Save Visitor Entry'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Stack spacing={1.25}>
          <Typography variant="h6" fontWeight={700}>Saved Visitors</Typography>

          {savedVisitorsQuery.isLoading ? (
            <Typography color="text.secondary">Loading saved visitors...</Typography>
          ) : savedVisitors.length === 0 ? (
            <Typography color="text.secondary">No saved visitors yet.</Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {savedVisitors.map((visitor) => (
                <Chip
                  key={visitor.id}
                  label={`${visitor.name} • ${visitor.company}`}
                  onClick={() => handleUseSavedVisitor(visitor)}
                  disabled={deleteSavedVisitorShortcutMutation.isPending}
                  onDelete={() => handleDeleteSavedVisitor(visitor.id)}
                  deleteIcon={<DeleteOutlineRoundedIcon />}
                  variant="outlined"
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 540 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Company</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Time Allowed</TableCell>
              <TableCell>Checked In</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recentLogsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">Loading recent visitors...</Typography>
                </TableCell>
              </TableRow>
            ) : sortedLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">
                    No visitor entries yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedLogs.map((entry) => {
                const isActive = Date.parse(String(entry.expiresAt ?? '')) > Date.now()

                return (
                  <TableRow key={entry.id} hover>
                    <TableCell>{entry.name}</TableCell>
                    <TableCell>{entry.company}</TableCell>
                    <TableCell>{visitTypeLabel(entry.visitType, entry.otherVisitType)}</TableCell>
                    <TableCell>{entry.durationMinutes} min</TableCell>
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
      </TableContainer>
    </Stack>
  )
}
