import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PriceCheckRoundedIcon from '@mui/icons-material/PriceCheckRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RuleRoundedIcon from '@mui/icons-material/RuleRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  commitCrmImport,
  createCrmOrder,
  createCrmQuote,
  fetchCrmConflicts,
  fetchCrmDealers,
  fetchCrmImports,
  fetchCrmOrders,
  fetchCrmOverview,
  fetchCrmQuotes,
  previewCrmImport,
  updateCrmOrder,
  updateCrmQuote,
  type CrmConflictGroup,
  type CrmConflictRecord,
  type CrmDealer,
  type CrmImportPreviewResponse,
  type CrmImportRunRecord,
  type CrmOrder,
  type CrmOrderStatus,
  type CrmOverviewResponse,
  type CrmQuote,
  type CrmQuoteStatus,
} from '../features/crm/api'

const importConfirmPhrase = 'I_UNDERSTAND_IMPORT_OVERWRITES'
const quoteStatusOptions: CrmQuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'cancelled']
const orderStatusOptions: CrmOrderStatus[] = [
  'draft',
  'pending',
  'in_progress',
  'on_hold',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
]

type OverviewCardProps = {
  title: string
  value: string
  helper: string
  icon?: ReactNode
}

type ConflictSectionProps = {
  title: string
  groups: CrmConflictGroup[]
  emptyText: string
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatStatusLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function parseNonNegativeAmount(input: string) {
  const parsed = Number(input)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function parsePercentInRange(input: string) {
  const parsed = Number(input)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function OverviewCard({ title, value, helper, icon }: OverviewCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minHeight: 132 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon ?? null}
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
        </Stack>

        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          {value}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {helper}
        </Typography>
      </Stack>
    </Paper>
  )
}

function ConflictSection({ title, groups, emptyText }: ConflictSectionProps) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>

      {groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Key</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Count</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Sample IDs</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={`${title}-${group.key}`}>
                <TableCell sx={{ maxWidth: 280, wordBreak: 'break-word' }}>{group.key}</TableCell>
                <TableCell>{group.count}</TableCell>
                <TableCell sx={{ maxWidth: 420, wordBreak: 'break-word' }}>
                  {group.sourceIds.join(', ')}
                  {group.hasMoreSourceIds ? ' ...' : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  )
}

export default function CrmPage() {
  const { appUser, getIdToken } = useAuth()

  const [overview, setOverview] = useState<CrmOverviewResponse | null>(null)
  const [dealers, setDealers] = useState<CrmDealer[]>([])
  const [quotes, setQuotes] = useState<CrmQuote[]>([])
  const [orders, setOrders] = useState<CrmOrder[]>([])
  const [importRuns, setImportRuns] = useState<CrmImportRunRecord[]>([])
  const [openConflicts, setOpenConflicts] = useState<CrmConflictRecord[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCommittingImport, setIsCommittingImport] = useState(false)
  const [isSavingQuote, setIsSavingQuote] = useState(false)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [updatingQuoteId, setUpdatingQuoteId] = useState<string | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [selectedFileSize, setSelectedFileSize] = useState<number | null>(null)
  const [importPayload, setImportPayload] = useState<unknown | null>(null)
  const [previewResult, setPreviewResult] = useState<CrmImportPreviewResponse | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const [quoteDealerSourceId, setQuoteDealerSourceId] = useState('')
  const [quoteTitle, setQuoteTitle] = useState('')
  const [quoteNumber, setQuoteNumber] = useState('')
  const [quoteAmountInput, setQuoteAmountInput] = useState('')
  const [quoteStatus, setQuoteStatus] = useState<CrmQuoteStatus>('sent')

  const [orderDealerSourceId, setOrderDealerSourceId] = useState('')
  const [orderTitle, setOrderTitle] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [orderValueInput, setOrderValueInput] = useState('')
  const [orderStatus, setOrderStatus] = useState<CrmOrderStatus>('pending')
  const [orderProgressInput, setOrderProgressInput] = useState('')

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const activeDealers = useMemo(
    () => dealers.filter((dealer) => dealer.isArchived !== true),
    [dealers],
  )

  const loadCrmPageData = useCallback(async (refreshRequested = false) => {
    setErrorMessage(null)

    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const idToken = await getIdToken()
      const [
        overviewPayload,
        importsPayload,
        conflictsPayload,
        dealersPayload,
        quotesPayload,
        ordersPayload,
      ] = await Promise.all([
        fetchCrmOverview(idToken),
        fetchCrmImports(idToken, 12),
        fetchCrmConflicts(idToken, 'open', 120),
        fetchCrmDealers(idToken, 2500, false),
        fetchCrmQuotes(idToken, { limit: 200 }),
        fetchCrmOrders(idToken, { limit: 200 }),
      ])

      setOverview(overviewPayload)
      setImportRuns(Array.isArray(importsPayload.imports) ? importsPayload.imports : [])
      setOpenConflicts(Array.isArray(conflictsPayload.conflicts) ? conflictsPayload.conflicts : [])
      setDealers(Array.isArray(dealersPayload.dealers) ? dealersPayload.dealers : [])
      setQuotes(Array.isArray(quotesPayload.quotes) ? quotesPayload.quotes : [])
      setOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [])
    } catch (error) {
      setOverview(null)
      setDealers([])
      setQuotes([])
      setOrders([])
      setImportRuns([])
      setOpenConflicts([])
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load CRM data.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [getIdToken])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCrmPageData(false)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadCrmPageData])

  const handleImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)

      setSelectedFileName(file.name)
      setSelectedFileSize(file.size)
      setImportPayload(parsed)
      setPreviewResult(null)
      setConfirmText('')
      setActionMessage('JSON loaded successfully. Run preview before committing import.')
    } catch (error) {
      setSelectedFileName(file.name)
      setSelectedFileSize(file.size)
      setImportPayload(null)
      setPreviewResult(null)
      setConfirmText('')
      setErrorMessage(error instanceof Error ? error.message : 'The selected file is not valid JSON.')
    }
  }, [])

  const handleRunPreview = useCallback(async () => {
    if (!importPayload) {
      setErrorMessage('Select a JSON export file before running preview.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setIsPreviewing(true)

    try {
      const idToken = await getIdToken()
      const preview = await previewCrmImport(idToken, importPayload)
      setPreviewResult(preview)
      setActionMessage('Preview completed. Review conflicts and validation warnings before import commit.')
    } catch (error) {
      setPreviewResult(null)
      setErrorMessage(error instanceof Error ? error.message : 'Preview failed.')
    } finally {
      setIsPreviewing(false)
    }
  }, [getIdToken, importPayload])

  const handleCommitImport = useCallback(async () => {
    if (!importPayload || !previewResult) {
      setErrorMessage('Run preview first, then commit.')
      return
    }

    if (confirmText !== importConfirmPhrase) {
      setErrorMessage(`Type ${importConfirmPhrase} exactly before committing import.`)
      return
    }

    const confirmed = window.confirm(
      'This will upsert CRM dealers and contacts and create a new conflict queue. Continue?',
    )

    if (!confirmed) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setIsCommittingImport(true)

    try {
      const idToken = await getIdToken()
      const result = await commitCrmImport(
        idToken,
        importPayload,
        confirmText,
        previewResult.importFingerprint,
      )

      setActionMessage(
        `Import committed at ${formatDateTime(result.importRun.importedAt)}. Accounts upserted: ${result.importRun.writeSummary.accountUpsertedCount}. Contacts upserted: ${result.importRun.writeSummary.contactUpsertedCount}.`,
      )

      await loadCrmPageData(true)
      setConfirmText('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Import commit failed.')
    } finally {
      setIsCommittingImport(false)
    }
  }, [confirmText, getIdToken, importPayload, loadCrmPageData, previewResult])

  const handleCreateQuote = useCallback(async () => {
    const normalizedTitle = quoteTitle.trim()
    const amount = parseNonNegativeAmount(quoteAmountInput)

    if (!quoteDealerSourceId) {
      setErrorMessage('Select a dealer before creating a quote.')
      return
    }

    if (!normalizedTitle) {
      setErrorMessage('Quote title is required.')
      return
    }

    if (amount === null) {
      setErrorMessage('Quote amount must be a non-negative number.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setIsSavingQuote(true)

    try {
      const idToken = await getIdToken()

      await createCrmQuote(idToken, {
        dealerSourceId: quoteDealerSourceId,
        title: normalizedTitle,
        quoteNumber: quoteNumber.trim() || null,
        status: quoteStatus,
        totalAmount: amount,
      })

      setActionMessage('Quote created successfully.')
      setQuoteTitle('')
      setQuoteNumber('')
      setQuoteAmountInput('')
      setQuoteStatus('sent')
      await loadCrmPageData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create quote.')
    } finally {
      setIsSavingQuote(false)
    }
  }, [getIdToken, loadCrmPageData, quoteAmountInput, quoteDealerSourceId, quoteNumber, quoteStatus, quoteTitle])

  const handleQuoteStatusUpdate = useCallback(async (quoteId: string, nextStatus: CrmQuoteStatus) => {
    setErrorMessage(null)
    setActionMessage(null)
    setUpdatingQuoteId(quoteId)

    try {
      const idToken = await getIdToken()
      await updateCrmQuote(idToken, quoteId, {
        status: nextStatus,
      })

      setActionMessage(`Quote status updated to ${formatStatusLabel(nextStatus)}.`)
      await loadCrmPageData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update quote status.')
    } finally {
      setUpdatingQuoteId(null)
    }
  }, [getIdToken, loadCrmPageData])

  const handleCreateOrder = useCallback(async () => {
    const normalizedTitle = orderTitle.trim()
    const value = parseNonNegativeAmount(orderValueInput)
    const progress = orderProgressInput.trim()
      ? parsePercentInRange(orderProgressInput)
      : null

    if (!orderDealerSourceId) {
      setErrorMessage('Select a dealer before creating an order.')
      return
    }

    if (!normalizedTitle) {
      setErrorMessage('Order title is required.')
      return
    }

    if (value === null) {
      setErrorMessage('Order value must be a non-negative number.')
      return
    }

    if (orderProgressInput.trim() && progress === null) {
      setErrorMessage('Order progress must be between 0 and 100.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setIsSavingOrder(true)

    try {
      const idToken = await getIdToken()

      await createCrmOrder(idToken, {
        dealerSourceId: orderDealerSourceId,
        title: normalizedTitle,
        orderNumber: orderNumber.trim() || null,
        status: orderStatus,
        progressPercent: progress,
        orderValue: value,
      })

      setActionMessage('Order created successfully.')
      setOrderTitle('')
      setOrderNumber('')
      setOrderValueInput('')
      setOrderProgressInput('')
      setOrderStatus('pending')
      await loadCrmPageData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create order.')
    } finally {
      setIsSavingOrder(false)
    }
  }, [getIdToken, loadCrmPageData, orderDealerSourceId, orderNumber, orderProgressInput, orderStatus, orderTitle, orderValueInput])

  const handleOrderStatusUpdate = useCallback(async (orderId: string, nextStatus: CrmOrderStatus) => {
    setErrorMessage(null)
    setActionMessage(null)
    setUpdatingOrderId(orderId)

    try {
      const idToken = await getIdToken()
      await updateCrmOrder(idToken, orderId, {
        status: nextStatus,
      })

      setActionMessage(`Order status updated to ${formatStatusLabel(nextStatus)}.`)
      await loadCrmPageData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update order status.')
    } finally {
      setUpdatingOrderId(null)
    }
  }, [getIdToken, loadCrmPageData])

  const handleOrderProgressUpdate = useCallback(async (order: CrmOrder) => {
    const promptValue = window.prompt('Set order progress (0-100):', String(order.progressPercent ?? 0))

    if (promptValue === null) {
      return
    }

    const nextProgress = parsePercentInRange(promptValue)

    if (nextProgress === null) {
      setErrorMessage('Order progress must be between 0 and 100.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setUpdatingOrderId(order.id)

    try {
      const idToken = await getIdToken()
      await updateCrmOrder(idToken, order.id, {
        progressPercent: nextProgress,
      })

      setActionMessage('Order progress updated.')
      await loadCrmPageData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update order progress.')
    } finally {
      setUpdatingOrderId(null)
    }
  }, [getIdToken, loadCrmPageData])

  const topDealersByAcceptedValue = useMemo(() => {
    return overview?.quotes.topDealersByAcceptedValue ?? []
  }, [overview?.quotes.topDealersByAcceptedValue])

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={0.5}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              CRM Control Center
            </Typography>
            <Typography color="text.secondary">
              Safe import workflow, quote acceptance tracking, and dealer order progress in one place.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Import is preview-first. Quote and order actions update dealer performance metrics automatically.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/admin/crm/dealers" variant="outlined" size="small">
              Dealers
            </Button>
            <Button component={RouterLink} to="/admin/crm/contacts" variant="outlined" size="small">
              Contacts
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoading || isRefreshing}
              onClick={() => {
                void loadCrmPageData(true)
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

      {isLoading ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1.2} alignItems="center">
            <CircularProgress size={18} />
            <Typography color="text.secondary">Loading CRM module...</Typography>
          </Stack>
        </Paper>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            <OverviewCard
              title="Dealers"
              value={String(overview?.dealers.totalAccounts ?? 0)}
              helper={`Contacts: ${overview?.dealers.totalContacts ?? 0}`}
              icon={<GroupsRoundedIcon color="primary" />}
            />
            <OverviewCard
              title="Open Conflict Queue"
              value={String(overview?.dealers.openConflictCount ?? 0)}
              helper="Manual review required before merges"
              icon={<RuleRoundedIcon color="warning" />}
            />
            <OverviewCard
              title="Quote Acceptance"
              value={`${(overview?.quotes.acceptanceRate ?? 0).toFixed(2)}%`}
              helper={`Accepted ${overview?.quotes.acceptedQuotes ?? 0} of ${overview?.quotes.totalQuotes ?? 0}`}
              icon={<FactCheckRoundedIcon color="success" />}
            />
            <OverviewCard
              title="Accepted Quote Value"
              value={formatCurrency(overview?.quotes.acceptedValue ?? 0)}
              helper={`Total quoted value ${formatCurrency(overview?.quotes.quotedValue ?? 0)}`}
              icon={<PriceCheckRoundedIcon color="success" />}
            />
            <OverviewCard
              title="Orders Tracked"
              value={String(overview?.orders.totalOrders ?? 0)}
              helper="Dealer order progress foundation"
              icon={<AssessmentRoundedIcon color="info" />}
            />
            <OverviewCard
              title="Latest Import"
              value={overview?.dealers.latestImport ? formatDateTime(overview.dealers.latestImport.importedAt) : 'None'}
              helper={overview?.dealers.latestImport?.importedByEmail ?? 'No import committed yet'}
              icon={<UploadFileRoundedIcon color="secondary" />}
            />
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Import JSON (Preview Then Commit)
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                <Button variant="outlined" component="label" startIcon={<CloudUploadRoundedIcon />}>
                  Select JSON Export
                  <input
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                      void handleImportFileChange(event)
                    }}
                  />
                </Button>

                <Typography variant="body2" color="text.secondary">
                  {selectedFileName
                    ? `${selectedFileName} (${selectedFileSize ? `${(selectedFileSize / (1024 * 1024)).toFixed(2)} MB` : 'size unknown'})`
                    : 'No file selected'}
                </Typography>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Button
                  variant="contained"
                  onClick={() => {
                    void handleRunPreview()
                  }}
                  disabled={!importPayload || isPreviewing || isCommittingImport}
                >
                  {isPreviewing ? 'Running Preview...' : 'Run Safety Preview'}
                </Button>

                <TextField
                  fullWidth
                  size="small"
                  label="Required Confirmation Text"
                  value={confirmText}
                  onChange={(event) => {
                    setConfirmText(event.target.value)
                  }}
                  helperText={`Type exactly: ${importConfirmPhrase}`}
                />

                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => {
                    void handleCommitImport()
                  }}
                  disabled={!previewResult || isCommittingImport || isPreviewing}
                >
                  {isCommittingImport ? 'Committing...' : 'Commit Import'}
                </Button>
              </Stack>

              {previewResult ? (
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <Alert severity="info">
                    Preview fingerprint: {previewResult.importFingerprint}
                  </Alert>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        md: 'repeat(3, minmax(0, 1fr))',
                      },
                      gap: 1.5,
                    }}
                  >
                    <OverviewCard
                      title="Accounts"
                      value={String(previewResult.summary.counts.accounts)}
                      helper={`Archived: ${previewResult.summary.counts.archivedAccounts}`}
                    />
                    <OverviewCard
                      title="Contacts"
                      value={String(previewResult.summary.counts.contacts)}
                      helper={`Linked ${previewResult.summary.counts.linkedContacts} / Unlinked ${previewResult.summary.counts.unlinkedContacts}`}
                    />
                    <OverviewCard
                      title="Conflict Groups"
                      value={String(previewResult.conflictGroupCounts.totalConflictGroups)}
                      helper="No auto-merge is performed"
                    />
                  </Box>

                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Validation Warnings
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Skipped accounts missing source ID: {previewResult.summary.validation.skippedAccountsMissingSourceId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Skipped accounts missing name: {previewResult.summary.validation.skippedAccountsMissingName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Skipped contacts missing source ID: {previewResult.summary.validation.skippedContactsMissingSourceId}
                    </Typography>
                  </Stack>

                  <ConflictSection
                    title="Account Name Duplicates"
                    groups={previewResult.conflicts.accountNameDuplicates}
                    emptyText="No account name duplicates detected."
                  />

                  <ConflictSection
                    title="Account Email Duplicates"
                    groups={previewResult.conflicts.accountEmailDuplicates}
                    emptyText="No account email duplicates detected."
                  />

                  <ConflictSection
                    title="Contact Email Duplicates"
                    groups={previewResult.conflicts.contactEmailDuplicates}
                    emptyText="No contact email duplicates detected."
                  />

                  <ConflictSection
                    title="Unlinked Email Overlaps"
                    groups={previewResult.conflicts.unlinkedEmailOverlaps}
                    emptyText="No overlaps between unlinked and linked contacts."
                  />
                </Stack>
              ) : null}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <PriceCheckRoundedIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Quote Pipeline
                </Typography>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(5, minmax(0, 1fr))',
                  },
                  gap: 1.25,
                }}
              >
                <FormControl size="small" fullWidth>
                  <InputLabel id="quote-dealer-label">Dealer</InputLabel>
                  <Select
                    labelId="quote-dealer-label"
                    label="Dealer"
                    value={quoteDealerSourceId}
                    onChange={(event) => {
                      setQuoteDealerSourceId(event.target.value)
                    }}
                  >
                    {activeDealers.map((dealer) => (
                      <MenuItem key={dealer.sourceId} value={dealer.sourceId}>
                        {dealer.name || dealer.sourceId}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  size="small"
                  label="Quote Title"
                  value={quoteTitle}
                  onChange={(event) => {
                    setQuoteTitle(event.target.value)
                  }}
                />

                <TextField
                  size="small"
                  label="Quote #"
                  value={quoteNumber}
                  onChange={(event) => {
                    setQuoteNumber(event.target.value)
                  }}
                />

                <TextField
                  size="small"
                  label="Amount"
                  value={quoteAmountInput}
                  onChange={(event) => {
                    setQuoteAmountInput(event.target.value)
                  }}
                />

                <FormControl size="small" fullWidth>
                  <InputLabel id="quote-status-label">Status</InputLabel>
                  <Select
                    labelId="quote-status-label"
                    label="Status"
                    value={quoteStatus}
                    onChange={(event) => {
                      setQuoteStatus(event.target.value as CrmQuoteStatus)
                    }}
                  >
                    {quoteStatusOptions.map((status) => (
                      <MenuItem key={status} value={status}>
                        {formatStatusLabel(status)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Button
                variant="contained"
                startIcon={<AddCircleOutlineRoundedIcon />}
                disabled={isSavingQuote}
                onClick={() => {
                  void handleCreateQuote()
                }}
                sx={{ alignSelf: 'flex-start' }}
              >
                {isSavingQuote ? 'Saving Quote...' : 'Create Quote'}
              </Button>

              {quotes.length === 0 ? (
                <Typography color="text.secondary">No quotes yet.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Quote</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Dealer</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Amount</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {quotes.slice(0, 80).map((quote) => {
                      const isUpdating = updatingQuoteId === quote.id

                      return (
                        <TableRow key={quote.id}>
                          <TableCell>
                            <Stack spacing={0.3}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {quote.quoteNumber || 'No quote #'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {quote.title}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>{quote.dealerName}</TableCell>
                          <TableCell>{formatStatusLabel(quote.status)}</TableCell>
                          <TableCell>{formatCurrency(quote.totalAmount)}</TableCell>
                          <TableCell>{formatDateTime(quote.updatedAt)}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.75}>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={isUpdating || quote.status === 'sent'}
                                onClick={() => {
                                  void handleQuoteStatusUpdate(quote.id, 'sent')
                                }}
                              >
                                Mark Sent
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="success"
                                startIcon={<CheckCircleRoundedIcon />}
                                disabled={isUpdating || quote.status === 'accepted'}
                                onClick={() => {
                                  void handleQuoteStatusUpdate(quote.id, 'accepted')
                                }}
                              >
                                Accept
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                disabled={isUpdating || quote.status === 'rejected'}
                                onClick={() => {
                                  void handleQuoteStatusUpdate(quote.id, 'rejected')
                                }}
                              >
                                Reject
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      )
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <LocalShippingRoundedIcon color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                          Dealer Order Progress
                        </Typography>
                      </Stack>

                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: '1fr',
                            md: 'repeat(6, minmax(0, 1fr))',
                          },
                          gap: 1.25,
                        }}
                      >
                        <FormControl size="small" fullWidth>
                          <InputLabel id="order-dealer-label">Dealer</InputLabel>
                          <Select
                            labelId="order-dealer-label"
                            label="Dealer"
                            value={orderDealerSourceId}
                            onChange={(event) => {
                              setOrderDealerSourceId(event.target.value)
                            }}
                          >
                            {activeDealers.map((dealer) => (
                              <MenuItem key={dealer.sourceId} value={dealer.sourceId}>
                                {dealer.name || dealer.sourceId}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <TextField
                          size="small"
                          label="Order Title"
                          value={orderTitle}
                          onChange={(event) => {
                            setOrderTitle(event.target.value)
                          }}
                        />

                        <TextField
                          size="small"
                          label="Order #"
                          value={orderNumber}
                          onChange={(event) => {
                            setOrderNumber(event.target.value)
                          }}
                        />

                        <TextField
                          size="small"
                          label="Order Value"
                          value={orderValueInput}
                          onChange={(event) => {
                            setOrderValueInput(event.target.value)
                          }}
                        />

                        <FormControl size="small" fullWidth>
                          <InputLabel id="order-status-label">Status</InputLabel>
                          <Select
                            labelId="order-status-label"
                            label="Status"
                            value={orderStatus}
                            onChange={(event) => {
                              setOrderStatus(event.target.value as CrmOrderStatus)
                            }}
                          >
                            {orderStatusOptions.map((status) => (
                              <MenuItem key={status} value={status}>
                                {formatStatusLabel(status)}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <TextField
                          size="small"
                          label="Progress % (optional)"
                          value={orderProgressInput}
                          onChange={(event) => {
                            setOrderProgressInput(event.target.value)
                          }}
                        />
                      </Box>

                      <Button
                        variant="contained"
                        startIcon={<AddCircleOutlineRoundedIcon />}
                        disabled={isSavingOrder}
                        onClick={() => {
                          void handleCreateOrder()
                        }}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {isSavingOrder ? 'Saving Order...' : 'Create Order'}
                      </Button>

                      {orders.length === 0 ? (
                        <Typography color="text.secondary">No orders yet.</Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 700 }}>Order</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Dealer</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Progress</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Value</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {orders.slice(0, 80).map((order) => {
                              const isUpdating = updatingOrderId === order.id

                              return (
                                <TableRow key={order.id}>
                                  <TableCell>
                                    <Stack spacing={0.3}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {order.orderNumber || 'No order #'}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {order.title}
                                      </Typography>
                                    </Stack>
                                  </TableCell>
                                  <TableCell>{order.dealerName}</TableCell>
                                  <TableCell>{formatStatusLabel(order.status)}</TableCell>
                                  <TableCell>{order.progressPercent.toFixed(2)}%</TableCell>
                                  <TableCell>{formatCurrency(order.orderValue)}</TableCell>
                                  <TableCell>{formatDateTime(order.updatedAt)}</TableCell>
                                  <TableCell>
                                    <Stack direction="row" spacing={0.75}>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        disabled={isUpdating || order.status === 'in_progress'}
                                        onClick={() => {
                                          void handleOrderStatusUpdate(order.id, 'in_progress')
                                        }}
                                      >
                                        In Progress
                                      </Button>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        disabled={isUpdating || order.status === 'ready_to_ship'}
                                        onClick={() => {
                                          void handleOrderStatusUpdate(order.id, 'ready_to_ship')
                                        }}
                                      >
                                        Ready
                                      </Button>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        disabled={isUpdating || order.status === 'shipped'}
                                        startIcon={<LocalShippingRoundedIcon />}
                                        onClick={() => {
                                          void handleOrderStatusUpdate(order.id, 'shipped')
                                        }}
                                      >
                                        Shipped
                                      </Button>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        color="success"
                                        disabled={isUpdating || order.status === 'delivered'}
                                        startIcon={<CheckCircleRoundedIcon />}
                                        onClick={() => {
                                          void handleOrderStatusUpdate(order.id, 'delivered')
                                        }}
                                      >
                                        Delivered
                                      </Button>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        disabled={isUpdating}
                                        onClick={() => {
                                          void handleOrderProgressUpdate(order)
                                        }}
                                      >
                                        Set %
                                      </Button>
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                              )
                     })}
                   </TableBody>
                 </Table>
               )}
             </Stack>
           </Paper>
 
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Top Dealers By Accepted Quote Value
              </Typography>

              {topDealersByAcceptedValue.length === 0 ? (
                <Typography color="text.secondary">No quote revenue data yet.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Dealer</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Source ID</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Accepted Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {topDealersByAcceptedValue.map((dealer) => (
                      <TableRow key={dealer.dealerSourceId}>
                        <TableCell>{dealer.dealerName}</TableCell>
                        <TableCell sx={{ maxWidth: 250, wordBreak: 'break-word' }}>
                          {dealer.dealerSourceId}
                        </TableCell>
                        <TableCell>{formatCurrency(dealer.acceptedValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Recent Imports
              </Typography>

              {importRuns.length === 0 ? (
                <Typography color="text.secondary">No imports found.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Imported At</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>By</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Accounts</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Contacts</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Conflict Groups</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>{formatDateTime(run.importedAt)}</TableCell>
                        <TableCell>{run.importedByEmail ?? 'Unknown'}</TableCell>
                        <TableCell>{run.summary?.counts?.accounts ?? 0}</TableCell>
                        <TableCell>{run.summary?.counts?.contacts ?? 0}</TableCell>
                        <TableCell>{run.conflictGroupCounts?.totalConflictGroups ?? 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Open Conflict Queue
              </Typography>

              {openConflicts.length === 0 ? (
                <Typography color="text.secondary">No open conflicts.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Entity</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Key</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Count</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {openConflicts.map((conflict) => (
                      <TableRow key={conflict.id}>
                        <TableCell>{formatDateTime(conflict.createdAt)}</TableCell>
                        <TableCell>{conflict.conflictType}</TableCell>
                        <TableCell>{conflict.entityType}</TableCell>
                        <TableCell sx={{ maxWidth: 320, wordBreak: 'break-word' }}>{conflict.conflictKey}</TableCell>
                        <TableCell>{conflict.sourceCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Paper>
         </>
       )}
     </Stack>
   )
 }
