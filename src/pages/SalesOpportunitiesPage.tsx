import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmOrder,
  createCrmQuote,
  fetchCrmContacts,
  fetchCrmDealers,
  fetchCrmOrders,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  removeCrmQuote,
  updateCrmQuote,
  type CrmContact,
  type CrmDealer,
  type CrmOpportunityStage,
  type CrmOrder,
  type CrmQuote,
  type CrmSalesRep,
} from '../features/crm/api'
import { formatCurrency } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type OpportunityFormState = {
  dealerSourceId: string
  contactSourceId: string
  salesRep: string
  opportunityDateInput: string
  quoteNumber: string
  title: string
  amountInput: string
  notes: string
  quoteDocumentUrl: string
  quoteDocumentName: string
}

type OpportunityDetailsFormState = {
  quoteNumber: string
  title: string
  salesRep: string
  opportunityDateInput: string
  amountInput: string
  notes: string
}

type StageDefinition = {
  id: CrmOpportunityStage
  label: string
  probability: number
  description: string
  headerColor: string
  panelColor: string
}

type OpportunityCardProps = {
  quote: CrmQuote
  dealerName: string
  dealerPictureUrl: string | null
  ageDays: number
  stage: CrmOpportunityStage
  canManage: boolean
  isBusy: boolean
  onMoveBack: (quote: CrmQuote) => void
  onAdvanceStage: (quote: CrmQuote) => void
  onMarkNeedsRevision: (quote: CrmQuote) => void
  onMarkWaitingResponse: (quote: CrmQuote) => void
  onSendRevision: (quote: CrmQuote) => void
  onMarkApproved: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
}

type StageColumnProps = {
  stage: StageDefinition
  rows: CrmQuote[]
  dealersBySourceId: Map<string, CrmDealer>
  canManage: boolean
  busyQuoteId: string | null
  onMoveBack: (quote: CrmQuote) => void
  onAdvanceStage: (quote: CrmQuote) => void
  onMarkNeedsRevision: (quote: CrmQuote) => void
  onMarkWaitingResponse: (quote: CrmQuote) => void
  onSendRevision: (quote: CrmQuote) => void
  onMarkApproved: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
}

type StageSortMode = 'value_desc' | 'value_asc' | 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc'

type StageAmountCondition = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

type StageColumnFilters = {
  selectedDealerNames: string[]
  selectedSalesReps: string[]
  nameContains: string
  amountCondition: StageAmountCondition
  amountValue: string
  amountValueMax: string
}

const stageDefinitions: StageDefinition[] = [
  {
    id: 'concept',
    label: '1. Concept',
    probability: 10,
    description: 'Send concept/picture and align on direction.',
    headerColor: '#0b5f93',
    panelColor: '#eef5fb',
  },
  {
    id: 'proposal_submission',
    label: '2. Proposal Submitted',
    probability: 20,
    description: 'Final quote has been sent to customer.',
    headerColor: '#0a6c99',
    panelColor: '#edf7fb',
  },
  {
    id: 'revision',
    label: '3. Revision',
    probability: 30,
    description: 'Customer requested updates to quote.',
    headerColor: '#1d6ea5',
    panelColor: '#eef3fb',
  },
  {
    id: 'waiting_response',
    label: '4. Waiting Response',
    probability: 35,
    description: 'Quote is out; waiting on customer decision.',
    headerColor: '#3f6597',
    panelColor: '#eef1f8',
  },
  {
    id: 'order_placement',
    label: '5. Order Placement',
    probability: 95,
    description: 'Approved and converted to order workflow.',
    headerColor: '#2f7b57',
    panelColor: '#edf8f2',
  },
]

const stageById = new Map(stageDefinitions.map((stage) => [stage.id, stage]))

function getTodayEasternDateInputValue() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value || '1970'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'

  return `${year}-${month}-${day}`
}

function createEmptyOpportunityForm(): OpportunityFormState {
  return {
    dealerSourceId: '',
    contactSourceId: '',
    salesRep: '',
    opportunityDateInput: getTodayEasternDateInputValue(),
    quoteNumber: '',
    title: '',
    amountInput: '',
    notes: '',
    quoteDocumentUrl: '',
    quoteDocumentName: '',
  }
}

function resolveDateInputFromIso(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  const dateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/)

  if (dateMatch?.[1]) {
    return dateMatch[1]
  }

  return getTodayEasternDateInputValue()
}

function createOpportunityDetailsFormState(quote: CrmQuote): OpportunityDetailsFormState {
  return {
    quoteNumber: String(quote.quoteNumber || ''),
    title: String(quote.title || ''),
    salesRep: String(quote.salesRep || ''),
    opportunityDateInput: resolveDateInputFromIso(quote.opportunityDate),
    amountInput: String(Number(quote.totalAmount || 0)),
    notes: String(quote.notes || ''),
  }
}

function sanitizeStoragePathSegment(value: string, fallback = 'item') {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

function resolveFileExtension(file: File) {
  const normalizedName = String(file.name || '').toLowerCase()
  const extensionMatch = normalizedName.match(/\.[a-z0-9]{2,8}$/)

  if (extensionMatch) {
    return extensionMatch[0]
  }

  return '.bin'
}

function parseNonNegativeAmount(value: string) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function normalizeMatchValue(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function resolveContactName(contact: CrmContact) {
  if (contact.name && contact.name.trim()) {
    return contact.name.trim()
  }

  const firstName = String(contact.firstName ?? '').trim()
  const lastName = String(contact.lastName ?? '').trim()
  const fullName = `${firstName} ${lastName}`.trim()

  return fullName || ''
}

function resolveQuoteAgeDays(quote: CrmQuote) {
  const timestamp = new Date(quote.createdAt || quote.updatedAt)

  if (Number.isNaN(timestamp.getTime())) {
    return 0
  }

  const diffMs = Date.now() - timestamp.getTime()

  if (diffMs <= 0) {
    return 0
  }

  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}

function resolveOpportunityStage(quote: CrmQuote): CrmOpportunityStage {
  const explicitStage = normalizeMatchValue(quote.opportunityStage)

  if (stageById.has(explicitStage as CrmOpportunityStage)) {
    return explicitStage as CrmOpportunityStage
  }

  if (quote.status === 'accepted') {
    return 'order_placement'
  }

  if (quote.status === 'sent') {
    return 'waiting_response'
  }

  return 'concept'
}

function createEmptyStageColumnFilters(): StageColumnFilters {
  return {
    selectedDealerNames: [],
    selectedSalesReps: [],
    nameContains: '',
    amountCondition: 'any',
    amountValue: '',
    amountValueMax: '',
  }
}

function OpportunityCard({
  quote,
  dealerName,
  dealerPictureUrl,
  ageDays,
  stage,
  canManage,
  isBusy,
  onMoveBack,
  onAdvanceStage,
  onMarkNeedsRevision,
  onMarkWaitingResponse,
  onSendRevision,
  onMarkApproved,
  onDeleteQuote,
  onOpenDetails,
}: OpportunityCardProps) {
  const dealerInitial = String(dealerName).trim().charAt(0).toUpperCase() || 'D'

  const preventCardClick = (event: MouseEvent) => {
    event.stopPropagation()
  }

  return (
    <Paper
      variant="outlined"
      onClick={() => {
        onOpenDetails(quote)
      }}
      sx={{
        p: 1,
        borderRadius: 1,
        borderColor: '#a8bfd7',
        backgroundColor: '#f4f8fc',
        cursor: 'pointer',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: 2,
        },
      }}
    >
      <Stack spacing={0.9}>
        <Stack direction="row" spacing={0.9} alignItems="flex-start">
          <Avatar
            src={dealerPictureUrl || undefined}
            alt={dealerName}
            variant="rounded"
            sx={{
              width: 56,
              height: 56,
              flexShrink: 0,
              bgcolor: alpha('#0f4c81', 0.18),
              color: '#0f4c81',
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            {dealerInitial}
          </Avatar>

          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {quote.quoteNumber || quote.title}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1, color: '#1f3552' }}>
              {formatCurrency(quote.totalAmount, 2)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
              {dealerName}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ pt: 0.1 }}>
            {ageDays > 30 ? (
              <Chip size="small" label={`${ageDays}d`} color="warning" sx={{ height: 19, fontSize: 10 }} />
            ) : (
              <Chip size="small" label={`${ageDays}d`} sx={{ height: 19, fontSize: 10 }} />
            )}

            {canManage ? (
              <Tooltip title="Delete quote">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={isBusy}
                    onClick={(event) => {
                      preventCardClick(event)
                      onDeleteQuote(quote)
                    }}
                    sx={{ p: 0.25 }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </Stack>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          Click card to view and edit details.
        </Typography>

        {canManage ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap onClick={preventCardClick}>
            {stage !== 'concept' && stage !== 'order_placement' ? (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 12 }} />}
                disabled={isBusy}
                onClick={() => {
                  onMoveBack(quote)
                }}
                sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
              >
                Back
              </Button>
            ) : null}

            {stage === 'concept' ? (
              <Button
                size="small"
                variant="contained"
                disabled={isBusy}
                onClick={() => {
                  onAdvanceStage(quote)
                }}
                endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 12 }} />}
                sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
              >
                Send Proposal
              </Button>
            ) : null}

            {stage === 'proposal_submission' ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={isBusy}
                  onClick={() => {
                    onMarkNeedsRevision(quote)
                  }}
                  sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
                >
                  Needs Revision
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={isBusy}
                  onClick={() => {
                    onMarkWaitingResponse(quote)
                  }}
                  sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
                >
                  Waiting Response
                </Button>
              </>
            ) : null}

            {stage === 'revision' ? (
              <Button
                size="small"
                variant="contained"
                disabled={isBusy}
                onClick={() => {
                  onSendRevision(quote)
                }}
                sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
              >
                Send Revision
              </Button>
            ) : null}

            {stage === 'waiting_response' ? (
              <>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleRoundedIcon sx={{ fontSize: 12 }} />}
                  disabled={isBusy}
                  onClick={() => {
                    onMarkApproved(quote)
                  }}
                  sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
                >
                  Approved
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={isBusy}
                  onClick={() => {
                    onDeleteQuote(quote)
                  }}
                  sx={{ minHeight: 24, px: 0.8, fontSize: 11, textTransform: 'none' }}
                >
                  Not Approved
                </Button>
              </>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )
}

function StageColumn({
  stage,
  rows,
  dealersBySourceId,
  canManage,
  busyQuoteId,
  onMoveBack,
  onAdvanceStage,
  onMarkNeedsRevision,
  onMarkWaitingResponse,
  onSendRevision,
  onMarkApproved,
  onDeleteQuote,
  onOpenDetails,
}: StageColumnProps) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [sortSubmenuAnchorEl, setSortSubmenuAnchorEl] = useState<HTMLElement | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [sortMode, setSortMode] = useState<StageSortMode>('date_desc')
  const [activeFilters, setActiveFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)
  const [draftFilters, setDraftFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)

  const isMenuOpen = Boolean(menuAnchorEl)
  const isSortSubmenuOpen = Boolean(sortSubmenuAnchorEl) && isMenuOpen

  const resolveDealerName = (quote: CrmQuote) => String(
    dealersBySourceId.get(quote.dealerSourceId)?.name
      || quote.dealerName
      || quote.dealerSourceId
      || '',
  ).trim()

  const resolveSalesRepLabel = (quote: CrmQuote) => String(quote.salesRep ?? '').trim() || '(Unassigned)'

  const dealerNameOptions = useMemo(
    () => [...new Set(rows.map((quote) => resolveDealerName(quote)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [dealersBySourceId, rows],
  )

  const salesRepOptions = useMemo(
    () => [...new Set(rows.map((quote) => resolveSalesRepLabel(quote)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [rows],
  )

  const amountConditionIsActive = useMemo(() => {
    const amountCondition = activeFilters.amountCondition

    if (amountCondition === 'any') {
      return false
    }

    const amountValue = Number(activeFilters.amountValue)
    const hasAmountValue = activeFilters.amountValue.trim() !== '' && Number.isFinite(amountValue)

    if (amountCondition === 'between') {
      const amountValueMax = Number(activeFilters.amountValueMax)
      const hasAmountValueMax = activeFilters.amountValueMax.trim() !== '' && Number.isFinite(amountValueMax)
      return hasAmountValue && hasAmountValueMax
    }

    return hasAmountValue
  }, [activeFilters.amountCondition, activeFilters.amountValue, activeFilters.amountValueMax])

  const activeFilterCount = useMemo(() => {
    let count = 0

    if (activeFilters.selectedDealerNames.length > 0) {
      count += 1
    }

    if (activeFilters.selectedSalesReps.length > 0) {
      count += 1
    }

    if (activeFilters.nameContains.trim() !== '') {
      count += 1
    }

    if (amountConditionIsActive) {
      count += 1
    }

    return count
  }, [activeFilters.nameContains, activeFilters.selectedDealerNames.length, activeFilters.selectedSalesReps.length, amountConditionIsActive])

  const visibleRows = useMemo(() => {
    const normalizedNameContains = activeFilters.nameContains.trim().toLowerCase()
    const selectedDealerNames = new Set(activeFilters.selectedDealerNames)
    const selectedSalesReps = new Set(activeFilters.selectedSalesReps)

    const amountCondition = activeFilters.amountCondition
    const amountValue = Number(activeFilters.amountValue)
    const amountValueMax = Number(activeFilters.amountValueMax)
    const hasAmountValue = activeFilters.amountValue.trim() !== '' && Number.isFinite(amountValue)
    const hasAmountValueMax = activeFilters.amountValueMax.trim() !== '' && Number.isFinite(amountValueMax)

    const filteredRows = rows.filter((quote) => {
      const dealerName = resolveDealerName(quote)
      const normalizedDealerName = dealerName.toLowerCase()
      const quoteLabel = String(quote.quoteNumber || quote.title || '').toLowerCase()
      const quoteTitle = String(quote.title || '').toLowerCase()
      const salesRep = resolveSalesRepLabel(quote)
      const amount = Number(quote.totalAmount || 0)

      if (selectedDealerNames.size > 0 && !selectedDealerNames.has(dealerName)) {
        return false
      }

      if (selectedSalesReps.size > 0 && !selectedSalesReps.has(salesRep)) {
        return false
      }

      if (normalizedNameContains) {
        const searchableText = `${quoteLabel} ${quoteTitle} ${normalizedDealerName}`

        if (!searchableText.includes(normalizedNameContains)) {
          return false
        }
      }

      if (amountCondition === 'gt' && hasAmountValue && !(amount > amountValue)) {
        return false
      }

      if (amountCondition === 'gte' && hasAmountValue && !(amount >= amountValue)) {
        return false
      }

      if (amountCondition === 'lt' && hasAmountValue && !(amount < amountValue)) {
        return false
      }

      if (amountCondition === 'lte' && hasAmountValue && !(amount <= amountValue)) {
        return false
      }

      if (amountCondition === 'between' && hasAmountValue && hasAmountValueMax) {
        const lowerBound = Math.min(amountValue, amountValueMax)
        const upperBound = Math.max(amountValue, amountValueMax)

        if (amount < lowerBound || amount > upperBound) {
          return false
        }
      }

      return true
    })

    const nextRows = [...filteredRows]

    const getAlphaKey = (quote: CrmQuote) => {
      const dealerName = resolveDealerName(quote).toLowerCase()
      const quoteLabel = String(quote.quoteNumber || quote.title || '').toLowerCase()

      return `${dealerName} ${quoteLabel}`
    }

    if (sortMode === 'value_desc') {
      nextRows.sort((left, right) => Number(right.totalAmount || 0) - Number(left.totalAmount || 0))
    } else if (sortMode === 'value_asc') {
      nextRows.sort((left, right) => Number(left.totalAmount || 0) - Number(right.totalAmount || 0))
    } else if (sortMode === 'date_asc') {
      nextRows.sort((left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime())
    } else if (sortMode === 'alpha_asc') {
      nextRows.sort((left, right) => getAlphaKey(left).localeCompare(getAlphaKey(right)))
    } else if (sortMode === 'alpha_desc') {
      nextRows.sort((left, right) => getAlphaKey(right).localeCompare(getAlphaKey(left)))
    } else {
      nextRows.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    }

    return nextRows
  }, [
    activeFilters.amountCondition,
    activeFilters.amountValue,
    activeFilters.amountValueMax,
    activeFilters.nameContains,
    activeFilters.selectedDealerNames,
    activeFilters.selectedSalesReps,
    rows,
    sortMode,
  ])

  const handleSelectSortMode = (nextSortMode: StageSortMode) => {
    setSortMode(nextSortMode)
    setSortSubmenuAnchorEl(null)
    setMenuAnchorEl(null)
  }

  const totalAmount = visibleRows.reduce((sum, quote) => sum + Number(quote.totalAmount || 0), 0)

  return (
    <Paper
      variant="outlined"
      sx={{
        width: 320,
        minWidth: 320,
        borderRadius: 1,
        borderColor: alpha(stage.headerColor, 0.45),
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1,
          py: 0.8,
          backgroundColor: stage.headerColor,
          color: '#ffffff',
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {stage.label}
          </Typography>
          <IconButton
            size="small"
            onClick={(event) => {
              setMenuAnchorEl(event.currentTarget)
            }}
            sx={{
              color: '#ffffff',
              border: `1px solid ${alpha('#ffffff', 0.55)}`,
              backgroundColor: alpha('#ffffff', 0.15),
              p: 0.35,
            }}
          >
            <MoreVertRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.4, opacity: 0.92 }}>
          {stage.description}
        </Typography>
        {activeFilterCount > 0 ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.2, opacity: 0.92 }}>
            {activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}
          </Typography>
        ) : null}
        <Menu
          anchorEl={menuAnchorEl}
          open={isMenuOpen}
          onClose={() => {
            setSortSubmenuAnchorEl(null)
            setMenuAnchorEl(null)
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onMouseEnter={(event) => {
              setSortSubmenuAnchorEl(event.currentTarget)
            }}
            onClick={() => {
              setSortSubmenuAnchorEl((current) => current || menuAnchorEl)
            }}
            sx={{ minWidth: 170, display: 'flex', justifyContent: 'space-between', gap: 1.5 }}
          >
            Sort
            <ChevronRightRoundedIcon fontSize="small" />
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDraftFilters(activeFilters)
              setIsFilterDialogOpen(true)
              setSortSubmenuAnchorEl(null)
              setMenuAnchorEl(null)
            }}
          >
            Filter...
          </MenuItem>
          <MenuItem
            disabled={activeFilterCount === 0}
            onClick={() => {
              const emptyFilters = createEmptyStageColumnFilters()
              setDraftFilters(emptyFilters)
              setActiveFilters(emptyFilters)
              setSortSubmenuAnchorEl(null)
              setMenuAnchorEl(null)
            }}
          >
            Clear filters
          </MenuItem>
        </Menu>
        <Menu
          anchorEl={sortSubmenuAnchorEl}
          open={isSortSubmenuOpen}
          onClose={() => {
            setSortSubmenuAnchorEl(null)
          }}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          MenuListProps={{
            onMouseLeave: () => {
              setSortSubmenuAnchorEl(null)
            },
          }}
        >
          <MenuItem
            selected={sortMode === 'value_desc'}
            onClick={() => {
              handleSelectSortMode('value_desc')
            }}
          >
            Sort by value (high to low)
          </MenuItem>
          <MenuItem
            selected={sortMode === 'value_asc'}
            onClick={() => {
              handleSelectSortMode('value_asc')
            }}
          >
            Sort by value (low to high)
          </MenuItem>
          <MenuItem
            selected={sortMode === 'date_desc'}
            onClick={() => {
              handleSelectSortMode('date_desc')
            }}
          >
            Sort by date (newest)
          </MenuItem>
          <MenuItem
            selected={sortMode === 'date_asc'}
            onClick={() => {
              handleSelectSortMode('date_asc')
            }}
          >
            Sort by date (oldest)
          </MenuItem>
          <MenuItem
            selected={sortMode === 'alpha_asc'}
            onClick={() => {
              handleSelectSortMode('alpha_asc')
            }}
          >
            Sort A-Z
          </MenuItem>
          <MenuItem
            selected={sortMode === 'alpha_desc'}
            onClick={() => {
              handleSelectSortMode('alpha_desc')
            }}
          >
            Sort Z-A
          </MenuItem>
        </Menu>
      </Box>

      <Box sx={{ px: 1, py: 0.8, backgroundColor: alpha(stage.panelColor, 0.92), borderBottom: 1, borderColor: '#c9d7e6' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            {visibleRows.length} items
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            {formatCurrency(totalAmount, 2)}
          </Typography>
        </Stack>
      </Box>

      <Stack
        spacing={0.75}
        sx={{
          p: 0.75,
          minHeight: 580,
          maxHeight: '72vh',
          overflowY: 'auto',
          backgroundColor: stage.panelColor,
        }}
      >
        {visibleRows.length === 0 ? (
          <Paper
            variant="outlined"
            sx={{
              p: 1.1,
              borderRadius: 1,
              borderStyle: 'dashed',
              borderColor: alpha(stage.headerColor, 0.4),
              backgroundColor: alpha('#ffffff', 0.8),
            }}
          >
            <Typography variant="caption" color="text.secondary">
              No opportunities in this stage.
            </Typography>
          </Paper>
        ) : (
          visibleRows.map((quote) => {
            const dealer = dealersBySourceId.get(quote.dealerSourceId)
            const dealerName = dealer?.name || quote.dealerName || quote.dealerSourceId
            const dealerPictureUrl = String(dealer?.pictureUrl ?? '').trim() || null
            const ageDays = resolveQuoteAgeDays(quote)

            return (
              <OpportunityCard
                key={quote.id}
                quote={quote}
                dealerName={dealerName}
                dealerPictureUrl={dealerPictureUrl}
                ageDays={ageDays}
                stage={stage.id}
                canManage={canManage}
                isBusy={busyQuoteId === quote.id}
                onMoveBack={onMoveBack}
                onAdvanceStage={onAdvanceStage}
                onMarkNeedsRevision={onMarkNeedsRevision}
                onMarkWaitingResponse={onMarkWaitingResponse}
                onSendRevision={onSendRevision}
                onMarkApproved={onMarkApproved}
                onDeleteQuote={onDeleteQuote}
                onOpenDetails={onOpenDetails}
              />
            )
          })
        )}
      </Stack>

      <Dialog
        open={isFilterDialogOpen}
        onClose={() => {
          setIsFilterDialogOpen(false)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{stage.label} Filter</DialogTitle>
        <DialogContent>
          <Stack spacing={1.3} sx={{ mt: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Filter by values
            </Typography>

            <Autocomplete
              multiple
              disableCloseOnSelect
              options={dealerNameOptions}
              value={draftFilters.selectedDealerNames}
              onChange={(_event, values) => {
                setDraftFilters((current) => ({
                  ...current,
                  selectedDealerNames: values,
                }))
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Dealer names"
                  placeholder="Select one or more dealers"
                />
              )}
              renderOption={(props, option, { selected }) => (
                <li {...props}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 0.75, p: 0.25 }} />
                  {option}
                </li>
              )}
            />

            <Autocomplete
              multiple
              disableCloseOnSelect
              options={salesRepOptions}
              value={draftFilters.selectedSalesReps}
              onChange={(_event, values) => {
                setDraftFilters((current) => ({
                  ...current,
                  selectedSalesReps: values,
                }))
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Sales reps"
                  placeholder="Select one or more sales reps"
                />
              )}
              renderOption={(props, option, { selected }) => (
                <li {...props}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 0.75, p: 0.25 }} />
                  {option}
                </li>
              )}
            />

            <Box sx={{ borderTop: 1, borderColor: 'divider', my: 0.2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Filter by condition
            </Typography>

            <TextField
              label="Name contains"
              placeholder="Quote number, title, or dealer"
              value={draftFilters.nameContains}
              onChange={(event) => {
                setDraftFilters((current) => ({
                  ...current,
                  nameContains: event.target.value,
                }))
              }}
            />

            <TextField
              select
              label="Amount condition"
              value={draftFilters.amountCondition}
              onChange={(event) => {
                setDraftFilters((current) => ({
                  ...current,
                  amountCondition: event.target.value as StageAmountCondition,
                }))
              }}
            >
              <MenuItem value="any">Any amount</MenuItem>
              <MenuItem value="gt">Greater than</MenuItem>
              <MenuItem value="gte">Greater than or equal</MenuItem>
              <MenuItem value="lt">Less than</MenuItem>
              <MenuItem value="lte">Less than or equal</MenuItem>
              <MenuItem value="between">Between</MenuItem>
            </TextField>

            {draftFilters.amountCondition !== 'any' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label={draftFilters.amountCondition === 'between' ? 'Amount from' : 'Amount'}
                  placeholder="0"
                  type="number"
                  value={draftFilters.amountValue}
                  onChange={(event) => {
                    setDraftFilters((current) => ({
                      ...current,
                      amountValue: event.target.value,
                    }))
                  }}
                  sx={{ flex: 1 }}
                />
                {draftFilters.amountCondition === 'between' ? (
                  <TextField
                    label="Amount to"
                    placeholder="100000"
                    type="number"
                    value={draftFilters.amountValueMax}
                    onChange={(event) => {
                      setDraftFilters((current) => ({
                        ...current,
                        amountValueMax: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setIsFilterDialogOpen(false)
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              const emptyFilters = createEmptyStageColumnFilters()
              setDraftFilters(emptyFilters)
              setActiveFilters(emptyFilters)
              setIsFilterDialogOpen(false)
            }}
          >
            Clear
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const selectedDealerNames = [...new Set(
                draftFilters.selectedDealerNames
                  .map((value) => value.trim())
                  .filter(Boolean),
              )]
              const selectedSalesReps = [...new Set(
                draftFilters.selectedSalesReps
                  .map((value) => value.trim())
                  .filter(Boolean),
              )]

              setActiveFilters({
                selectedDealerNames,
                selectedSalesReps,
                nameContains: draftFilters.nameContains.trim(),
                amountCondition: draftFilters.amountCondition,
                amountValue: draftFilters.amountValue.trim(),
                amountValueMax: draftFilters.amountValueMax.trim(),
              })
              setIsFilterDialogOpen(false)
            }}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}

export default function SalesOpportunitiesPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [formState, setFormState] = useState<OpportunityFormState>(createEmptyOpportunityForm)
  const [isSavingOpportunity, setIsSavingOpportunity] = useState(false)
  const [isUploadingQuoteDocument, setIsUploadingQuoteDocument] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [opportunityDetailsFormState, setOpportunityDetailsFormState] = useState<OpportunityDetailsFormState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const dealersQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesDealers,
    queryFn: () => fetchCrmDealers({ limit: 2500, includeArchived: false }),
    staleTime: 5 * 60 * 1000,
  })

  const quotesQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesQuotes,
    queryFn: () => fetchCrmQuotes({ limit: 700, status: 'all' }),
    staleTime: 60 * 1000,
  })

  const ordersQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesOrders,
    queryFn: () => fetchCrmOrders({ limit: 700, status: 'all' }),
    staleTime: 60 * 1000,
  })

  const salesRepsQuery = useQuery({
    queryKey: QUERY_KEYS.crmSalesReps,
    queryFn: () => fetchCrmSalesReps(),
    staleTime: 5 * 60 * 1000,
  })

  const contactsQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunityContacts(formState.dealerSourceId || 'none'),
    queryFn: () => fetchCrmContacts({
      dealerSourceId: formState.dealerSourceId,
      limit: 800,
      offset: 0,
      includeArchived: false,
    }),
    enabled: Boolean(formState.dealerSourceId),
    staleTime: 2 * 60 * 1000,
  })

  const isLoading = dealersQuery.isLoading
    || quotesQuery.isLoading
    || ordersQuery.isLoading
    || salesRepsQuery.isLoading
  const isRefreshing = (
    dealersQuery.isFetching
    || quotesQuery.isFetching
    || ordersQuery.isFetching
    || salesRepsQuery.isFetching
  ) && !isLoading

  const queryError = [dealersQuery.error, quotesQuery.error, ordersQuery.error, salesRepsQuery.error, contactsQuery.error]
    .find((entry) => entry instanceof Error)

  const canManage = Boolean(appUser?.isAdmin)

  const dealers = useMemo(
    () => (Array.isArray(dealersQuery.data?.dealers) ? dealersQuery.data.dealers : [])
      .filter((dealer) => dealer.isArchived !== true),
    [dealersQuery.data?.dealers],
  )

  const quotes = useMemo(
    () => (Array.isArray(quotesQuery.data?.quotes) ? quotesQuery.data.quotes : []),
    [quotesQuery.data?.quotes],
  )

  const orders = useMemo(
    () => (Array.isArray(ordersQuery.data?.orders) ? ordersQuery.data.orders : []),
    [ordersQuery.data?.orders],
  )

  const salesReps = useMemo(
    () => {
      const raw = Array.isArray(salesRepsQuery.data?.salesReps) ? salesRepsQuery.data.salesReps : []
      return [...raw].sort((left, right) => left.name.localeCompare(right.name))
    },
    [salesRepsQuery.data?.salesReps],
  )

  const contacts = useMemo(
    () => (Array.isArray(contactsQuery.data?.contacts) ? contactsQuery.data.contacts : []),
    [contactsQuery.data?.contacts],
  )

  const dealersBySourceId = useMemo(
    () => new Map(dealers.map((dealer) => [dealer.sourceId, dealer])),
    [dealers],
  )

  const activeQuotes = useMemo(
    () => quotes.filter((quote) => quote.status !== 'rejected' && quote.status !== 'cancelled'),
    [quotes],
  )

  const stageBuckets = useMemo(() => {
    const base: Record<CrmOpportunityStage, CrmQuote[]> = {
      concept: [],
      proposal_submission: [],
      revision: [],
      waiting_response: [],
      order_placement: [],
    }

    for (const quote of activeQuotes) {
      const stage = resolveOpportunityStage(quote)
      base[stage].push(quote)
    }

    for (const stage of stageDefinitions) {
      base[stage.id].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    }

    return base
  }, [activeQuotes])

  const selectedDealer = useMemo(
    () => dealers.find((dealer) => dealer.sourceId === formState.dealerSourceId) || null,
    [dealers, formState.dealerSourceId],
  )

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.sourceId === formState.contactSourceId) || null,
    [contacts, formState.contactSourceId],
  )

  const selectedSalesRep = useMemo(
    () => salesReps.find((salesRep) => salesRep.name === formState.salesRep) || null,
    [formState.salesRep, salesReps],
  )

  const selectedOpportunityDealerName = useMemo(() => {
    if (!selectedOpportunity) {
      return ''
    }

    return dealersBySourceId.get(selectedOpportunity.dealerSourceId)?.name
      || selectedOpportunity.dealerName
      || selectedOpportunity.dealerSourceId
  }, [dealersBySourceId, selectedOpportunity])

  const selectedOpportunityStage = useMemo(
    () => (selectedOpportunity ? resolveOpportunityStage(selectedOpportunity) : null),
    [selectedOpportunity],
  )

  const selectedOpportunitySalesRep = useMemo(
    () => salesReps.find((salesRep) => salesRep.name === opportunityDetailsFormState?.salesRep) || null,
    [opportunityDetailsFormState?.salesRep, salesReps],
  )

  const canUploadQuoteDocument = Boolean(
    formState.dealerSourceId.trim() && formState.quoteNumber.trim(),
  )

  const invalidateOpportunityData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesOrders }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmPageBootstrap }),
    ])
  }, [queryClient])

  const handleRefresh = useCallback(async () => {
    setErrorMessage(null)

    await Promise.all([
      dealersQuery.refetch(),
      quotesQuery.refetch(),
      ordersQuery.refetch(),
      salesRepsQuery.refetch(),
    ])
  }, [dealersQuery, ordersQuery, quotesQuery, salesRepsQuery])

  const uploadQuoteDocumentFile = useCallback(async (file: File) => {
    const maxFileSize = 15 * 1024 * 1024
    const normalizedDealerSourceId = formState.dealerSourceId.trim()
    const normalizedQuoteNumber = formState.quoteNumber.trim()

    if (file.size > maxFileSize) {
      throw new Error('File must be 15 MB or smaller.')
    }

    if (!normalizedDealerSourceId) {
      throw new Error('Select a dealer before uploading the quote document.')
    }

    if (!normalizedQuoteNumber) {
      throw new Error('Enter quote number before uploading the quote document.')
    }

    const dealerSegment = sanitizeStoragePathSegment(normalizedDealerSourceId, 'dealer')
    const quoteSegment = sanitizeStoragePathSegment(normalizedQuoteNumber, 'opportunity')
    const extension = resolveFileExtension(file)
    const fileStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const filePath = `crm/opportunities/${dealerSegment}/${quoteSegment}-quote-${fileStamp}${extension}`
    const fileRef = storageRef(firebaseStorage, filePath)

    await uploadBytes(
      fileRef,
      file,
      file.type ? { contentType: file.type } : undefined,
    )

    const downloadUrl = await getDownloadURL(fileRef)

    setFormState((current) => ({
      ...current,
      quoteDocumentUrl: downloadUrl,
      quoteDocumentName: file.name,
    }))
  }, [formState.dealerSourceId, formState.quoteNumber])

  const handleQuoteDocumentUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsUploadingQuoteDocument(true)

    try {
      await uploadQuoteDocumentFile(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload quote document.'

      if (/storage\/unauthorized/i.test(message)) {
        setErrorMessage('Upload permission denied. Select Dealer and Quote Number first, then try again. If it still fails, your Firebase Storage rules need CRM opportunities write access.')
      } else {
        setErrorMessage(message)
      }
    } finally {
      setIsUploadingQuoteDocument(false)
    }
  }, [uploadQuoteDocumentFile])

  const handleOpenDialog = useCallback(() => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setFormState(createEmptyOpportunityForm())
    setIsDialogOpen(true)
  }, [])

  const handleOpenOpportunityDetails = useCallback((quote: CrmQuote) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setSelectedOpportunity(quote)
    setOpportunityDetailsFormState(createOpportunityDetailsFormState(quote))
  }, [])

  const handleCloseDialog = useCallback(() => {
    if (isSavingOpportunity || isUploadingQuoteDocument) {
      return
    }

    setIsDialogOpen(false)
  }, [isSavingOpportunity, isUploadingQuoteDocument])

  const handleCloseOpportunityDetails = useCallback(() => {
    if (isSavingOpportunityDetails) {
      return
    }

    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
  }, [isSavingOpportunityDetails])

  const handleCreateOpportunity = useCallback(async () => {
    if (!canManage) {
      setErrorMessage('Only admins can create opportunities.')
      return
    }

    const quoteNumber = formState.quoteNumber.trim()
    const salesRep = formState.salesRep.trim()
    const opportunityDateInput = formState.opportunityDateInput.trim()
    const amount = parseNonNegativeAmount(formState.amountInput)

    if (!formState.dealerSourceId) {
      setErrorMessage('Dealer is required.')
      return
    }

    if (!quoteNumber) {
      setErrorMessage('Quote number is required.')
      return
    }

    if (!salesRep) {
      setErrorMessage('Sales rep is required.')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date is required.')
      return
    }

    const isKnownSalesRep = salesReps.some((entry) => entry.name === salesRep)

    if (!isKnownSalesRep) {
      setErrorMessage('Select a sales rep from the list.')
      return
    }

    if (amount === null) {
      setErrorMessage('Amount must be a non-negative number.')
      return
    }

    const selectedContactName = selectedContact ? resolveContactName(selectedContact) : ''
    const fallbackContactName = formState.contactSourceId ? (selectedContactName || null) : null
    const title = formState.title.trim() || `Opportunity ${quoteNumber}`

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunity(true)

    try {
      await createCrmQuote({
        dealerSourceId: formState.dealerSourceId,
        contactSourceId: formState.contactSourceId || null,
        contactName: fallbackContactName,
        salesRep,
        quoteNumber,
        title,
        status: 'draft',
        opportunityStage: 'concept',
        opportunityDate: opportunityDateInput,
        totalAmount: amount,
        notes: formState.notes.trim() || null,
        documentUrl: formState.quoteDocumentUrl || null,
        documentName: formState.quoteDocumentName || null,
        revisionCount: 0,
      })

      await invalidateOpportunityData()

      setSuccessMessage('Opportunity created in Concept stage.')
      setFormState(createEmptyOpportunityForm())
      setIsDialogOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create opportunity.')
    } finally {
      setIsSavingOpportunity(false)
    }
  }, [
    canManage,
    formState.amountInput,
    formState.contactSourceId,
    formState.dealerSourceId,
    formState.notes,
    formState.opportunityDateInput,
    formState.quoteDocumentName,
    formState.quoteDocumentUrl,
    formState.quoteNumber,
    formState.salesRep,
    formState.title,
    invalidateOpportunityData,
    salesReps,
    selectedContact,
  ])

  const updateStage = useCallback(async (quote: CrmQuote, nextStage: CrmOpportunityStage, patch: Partial<CrmQuote> = {}) => {
    if (!canManage) {
      setErrorMessage('Only admins can update opportunities.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(quote.id)

    try {
      await updateCrmQuote(quote.id, {
        opportunityStage: nextStage,
        ...patch,
      })

      await invalidateOpportunityData()
      setSuccessMessage(`Moved to ${stageById.get(nextStage)?.label || nextStage}.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to move opportunity stage.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [canManage, invalidateOpportunityData])

  const handleMoveBack = useCallback(async (quote: CrmQuote) => {
    const stage = resolveOpportunityStage(quote)

    if (stage === 'proposal_submission') {
      await updateStage(quote, 'concept', { status: 'draft' })
      return
    }

    if (stage === 'revision') {
      await updateStage(quote, 'proposal_submission', { status: 'draft' })
      return
    }

    if (stage === 'waiting_response') {
      await updateStage(quote, 'revision', { status: 'draft' })
    }
  }, [updateStage])

  const handleAdvanceStage = useCallback(async (quote: CrmQuote) => {
    const stage = resolveOpportunityStage(quote)

    if (stage === 'concept') {
      await updateStage(quote, 'proposal_submission', {
        status: 'sent',
        sentAt: new Date().toISOString(),
      })
    }
  }, [updateStage])

  const handleMarkNeedsRevision = useCallback(async (quote: CrmQuote) => {
    await updateStage(quote, 'revision', { status: 'draft' })
  }, [updateStage])

  const handleMarkWaitingResponse = useCallback(async (quote: CrmQuote) => {
    await updateStage(quote, 'waiting_response', {
      status: 'sent',
      sentAt: new Date().toISOString(),
    })
  }, [updateStage])

  const handleSendRevision = useCallback(async (quote: CrmQuote) => {
    const nextRevisionCount = Math.max(0, Number(quote.revisionCount || 0)) + 1

    await updateStage(quote, 'waiting_response', {
      status: 'sent',
      sentAt: new Date().toISOString(),
      revisionCount: nextRevisionCount,
    })
  }, [updateStage])

  const createOrderFromQuote = useCallback(async (quote: CrmQuote, existingOrders: CrmOrder[]) => {
    const quoteNumber = String(quote.quoteNumber || '').trim()
    const orderNumbers = new Set(existingOrders.map((order) => normalizeMatchValue(order.orderNumber)).filter(Boolean))
    let nextOrderNumber = quoteNumber || `OP-${quote.id.slice(0, 8).toUpperCase()}`

    if (orderNumbers.has(normalizeMatchValue(nextOrderNumber))) {
      nextOrderNumber = `${nextOrderNumber}-${Date.now().toString().slice(-4)}`
    }

    const now = new Date().toISOString()

    await createCrmOrder({
      dealerSourceId: quote.dealerSourceId,
      title: quote.title,
      orderNumber: nextOrderNumber,
      status: 'pending',
      progressPercent: 5,
      orderValue: Number(quote.totalAmount || 0),
      currency: quote.currency || 'USD',
      notes: `Created from opportunity ${quote.quoteNumber || quote.id}`,
    })

    await updateCrmQuote(quote.id, {
      opportunityStage: 'order_placement',
      status: 'accepted',
      acceptedAt: now,
    })
  }, [])

  const handleMarkApproved = useCallback(async (quote: CrmQuote) => {
    if (!canManage) {
      setErrorMessage('Only admins can approve opportunities.')
      return
    }

    const confirmed = window.confirm(`Mark ${quote.quoteNumber || quote.title} as approved and convert to order?`)

    if (!confirmed) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(quote.id)

    try {
      await createOrderFromQuote(quote, orders)
      await invalidateOpportunityData()
      setSuccessMessage('Opportunity approved and converted to order placement.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to convert opportunity to order.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [canManage, createOrderFromQuote, invalidateOpportunityData, orders])

  const handleDeleteQuote = useCallback(async (quote: CrmQuote) => {
    if (!canManage) {
      setErrorMessage('Only admins can delete opportunities.')
      return
    }

    const confirmed = window.confirm(`Delete ${quote.quoteNumber || quote.title}? This cannot be undone.`)

    if (!confirmed) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(quote.id)

    try {
      await removeCrmQuote(quote.id)
      await invalidateOpportunityData()
      setSuccessMessage('Opportunity deleted.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete opportunity.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [canManage, invalidateOpportunityData])

  const handleSaveOpportunityDetails = useCallback(async () => {
    if (!selectedOpportunity || !opportunityDetailsFormState) {
      return
    }

    if (!canManage) {
      setErrorMessage('Only admins can edit opportunities.')
      return
    }

    const quoteNumber = opportunityDetailsFormState.quoteNumber.trim()
    const title = opportunityDetailsFormState.title.trim() || selectedOpportunity.title
    const salesRep = opportunityDetailsFormState.salesRep.trim()
    const opportunityDateInput = opportunityDetailsFormState.opportunityDateInput.trim()
    const amount = parseNonNegativeAmount(opportunityDetailsFormState.amountInput)

    if (!title) {
      setErrorMessage('Opportunity title is required.')
      return
    }

    if (!salesRep) {
      setErrorMessage('Sales rep is required.')
      return
    }

    if (!salesReps.some((entry) => entry.name === salesRep)) {
      setErrorMessage('Select a sales rep from the list.')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date is required.')
      return
    }

    if (amount === null) {
      setErrorMessage('Amount must be a non-negative number.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunityDetails(true)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      await updateCrmQuote(selectedOpportunity.id, {
        quoteNumber: quoteNumber || null,
        title,
        salesRep,
        opportunityDate: opportunityDateInput,
        totalAmount: amount,
        notes: opportunityDetailsFormState.notes.trim() || null,
      })

      await invalidateOpportunityData()
      setSuccessMessage('Opportunity updated.')
      setSelectedOpportunity(null)
      setOpportunityDetailsFormState(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update opportunity.')
    } finally {
      setIsSavingOpportunityDetails(false)
      setBusyQuoteId(null)
    }
  }, [canManage, invalidateOpportunityData, opportunityDetailsFormState, salesReps, selectedOpportunity])

  if (isLoading) {
    return <LoadingPanel loading message="Fetching pipeline opportunities..." />
  }

  return (
    <Stack spacing={1.75}>
      <StatusAlerts
        errorMessage={errorMessage || (queryError instanceof Error ? queryError.message : null)}
        successMessage={successMessage}
      />

      <Paper
        variant="outlined"
        sx={{
          p: 1.4,
          borderRadius: 1.5,
          background: `linear-gradient(130deg, ${alpha('#0f4c81', 0.09)} 0%, ${alpha('#ffffff', 0.96)} 50%, ${alpha('#14532d', 0.07)} 100%)`,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Stack spacing={0.25}>
            <Stack direction="row" spacing={0.8} alignItems="center">
              <WorkspacesRoundedIcon sx={{ color: '#0f4c81' }} />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Sales Opportunities Pipeline
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Concept - Proposal - Revision - Waiting Response - Order Placement.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.75}>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              onClick={() => {
                void handleRefresh()
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>

            <Button
              variant="contained"
              startIcon={<AddRoundedIcon fontSize="small" />}
              onClick={handleOpenDialog}
              disabled={!canManage}
            >
              Add Opportunity
            </Button>
          </Stack>
        </Stack>

        {!canManage ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            You can view the pipeline, but only admins can move stages or add/delete opportunities.
          </Alert>
        ) : null}
      </Paper>

      <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Stack direction="row" spacing={1} sx={{ minWidth: 1620 }}>
          {stageDefinitions.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              rows={stageBuckets[stage.id]}
              dealersBySourceId={dealersBySourceId}
              canManage={canManage}
              busyQuoteId={busyQuoteId}
              onMoveBack={handleMoveBack}
              onAdvanceStage={handleAdvanceStage}
              onMarkNeedsRevision={handleMarkNeedsRevision}
              onMarkWaitingResponse={handleMarkWaitingResponse}
              onSendRevision={handleSendRevision}
              onMarkApproved={handleMarkApproved}
              onDeleteQuote={handleDeleteQuote}
              onOpenDetails={handleOpenOpportunityDetails}
            />
          ))}
        </Stack>
      </Box>

      <Dialog open={isDialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Add Opportunity</DialogTitle>
        <DialogContent>
          <Stack spacing={1.3} sx={{ mt: 0.5 }}>
            <Autocomplete
              options={dealers}
              value={selectedDealer}
              onChange={(_event, dealer) => {
                const dealerSalesRep = String(dealer?.salesRep ?? '').trim()
                const matchedSalesRep = salesReps.find((entry) => entry.name === dealerSalesRep)

                setFormState((current) => ({
                  ...current,
                  dealerSourceId: dealer?.sourceId || '',
                  contactSourceId: '',
                  salesRep: matchedSalesRep?.name || '',
                }))
              }}
              getOptionLabel={(dealer) => `${dealer.name || dealer.sourceId} (${dealer.sourceId})`}
              isOptionEqualToValue={(left, right) => left.sourceId === right.sourceId}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Dealer"
                  placeholder="Type dealer name or source ID"
                  required
                />
              )}
            />

            <Autocomplete
              options={contacts}
              value={selectedContact}
              onChange={(_event, contact) => {
                setFormState((current) => ({
                  ...current,
                  contactSourceId: contact?.sourceId || '',
                }))
              }}
              disabled={!formState.dealerSourceId}
              getOptionLabel={(contact) => {
                const name = resolveContactName(contact)
                return name ? `${name} (${contact.sourceId})` : contact.sourceId
              }}
              isOptionEqualToValue={(left, right) => left.sourceId === right.sourceId}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Contact (optional)"
                  placeholder={formState.dealerSourceId ? 'Pick dealer contact' : 'Choose dealer first'}
                />
              )}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
              <Autocomplete
                options={salesReps}
                value={selectedSalesRep}
                onChange={(_event, salesRep: CrmSalesRep | null) => {
                  setFormState((current) => ({
                    ...current,
                    salesRep: salesRep?.name || '',
                  }))
                }}
                getOptionLabel={(salesRep) => {
                  const company = String(salesRep.companyName ?? '').trim()
                  return company ? `${salesRep.name} (${company})` : salesRep.name
                }}
                isOptionEqualToValue={(left, right) => left.id === right.id}
                noOptionsText="No sales reps found"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Sales Rep"
                    placeholder="Select sales rep"
                    required
                  />
                )}
                sx={{ flex: 1 }}
              />

              <TextField
                label="Quote Number"
                required
                value={formState.quoteNumber}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    quoteNumber: event.target.value,
                  }))
                }}
                sx={{ flex: 1 }}
              />

              <TextField
                label="Opportunity Date"
                type="date"
                required
                value={formState.opportunityDateInput}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    opportunityDateInput: event.target.value,
                  }))
                }}
                sx={{ flex: 1 }}
                InputLabelProps={{
                  shrink: true,
                }}
                helperText="Defaults to today (US Eastern)"
              />

              <TextField
                label="Amount"
                value={formState.amountInput}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    amountInput: event.target.value,
                  }))
                }}
                placeholder="0.00"
                sx={{ flex: 1 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                }}
              />
            </Stack>

            <TextField
              label="Opportunity Title"
              value={formState.title}
              onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }}
              placeholder="Optional (auto-generated if left empty)"
            />

            <TextField
              label="Notes"
              value={formState.notes}
              onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }}
              multiline
              minRows={3}
              placeholder="Optional notes"
            />

            <Paper
              variant="outlined"
              sx={{
                p: 1.1,
                borderRadius: 1.1,
                borderColor: alpha('#14532d', 0.24),
                backgroundColor: alpha('#14532d', 0.04),
              }}
            >
              <Stack spacing={0.8}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Quote Document (optional)
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<CloudUploadRoundedIcon fontSize="small" />}
                    disabled={isUploadingQuoteDocument || !canUploadQuoteDocument}
                  >
                    {isUploadingQuoteDocument ? 'Uploading...' : 'Upload Quote Document'}
                    <input hidden type="file" onChange={handleQuoteDocumentUpload} />
                  </Button>

                  {!canUploadQuoteDocument ? (
                    <Typography variant="body2" color="text.secondary">
                      Select Dealer and Quote Number first.
                    </Typography>
                  ) : null}

                  {formState.quoteDocumentUrl ? (
                    <Button
                      color="inherit"
                      href={formState.quoteDocumentUrl}
                      target="_blank"
                      rel="noreferrer"
                      endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
                    >
                      {formState.quoteDocumentName || 'Open document'}
                    </Button>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No quote document uploaded yet.
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Paper>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={handleCloseDialog}
            disabled={isSavingOpportunity || isUploadingQuoteDocument}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            startIcon={<AddRoundedIcon fontSize="small" />}
            disabled={
              isSavingOpportunity
              || isUploadingQuoteDocument
              || !canManage
            }
            onClick={() => {
              void handleCreateOpportunity()
            }}
          >
            {isSavingOpportunity ? 'Creating...' : 'Create Opportunity'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedOpportunity && opportunityDetailsFormState)}
        onClose={handleCloseOpportunityDetails}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Opportunity Details</DialogTitle>
        <DialogContent>
          {selectedOpportunity && opportunityDetailsFormState ? (
            <Stack spacing={1.3} sx={{ mt: 0.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField
                  label="Dealer"
                  value={selectedOpportunityDealerName}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Stage"
                  value={selectedOpportunityStage ? (stageById.get(selectedOpportunityStage)?.label || selectedOpportunityStage) : ''}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <Autocomplete
                  options={salesReps}
                  value={selectedOpportunitySalesRep}
                  onChange={(_event, salesRep: CrmSalesRep | null) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        salesRep: salesRep?.name || '',
                      }
                    })
                  }}
                  getOptionLabel={(salesRep) => {
                    const company = String(salesRep.companyName ?? '').trim()
                    return company ? `${salesRep.name} (${company})` : salesRep.name
                  }}
                  isOptionEqualToValue={(left, right) => left.id === right.id}
                  noOptionsText="No sales reps found"
                  disabled={!canManage}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Sales Rep"
                      placeholder="Select sales rep"
                      required
                    />
                  )}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Quote Number"
                  value={opportunityDetailsFormState.quoteNumber}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        quoteNumber: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Opportunity Date"
                  type="date"
                  required
                  value={opportunityDetailsFormState.opportunityDateInput}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        opportunityDateInput: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                  InputLabelProps={{
                    shrink: true,
                  }}
                />

                <TextField
                  label="Amount"
                  value={opportunityDetailsFormState.amountInput}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        amountInput: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  placeholder="0.00"
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                />
              </Stack>

              <TextField
                label="Opportunity Title"
                value={opportunityDetailsFormState.title}
                onChange={(event) => {
                  setOpportunityDetailsFormState((current) => {
                    if (!current) {
                      return current
                    }

                    return {
                      ...current,
                      title: event.target.value,
                    }
                  })
                }}
                disabled={!canManage}
              />

              <TextField
                label="Notes"
                value={opportunityDetailsFormState.notes}
                onChange={(event) => {
                  setOpportunityDetailsFormState((current) => {
                    if (!current) {
                      return current
                    }

                    return {
                      ...current,
                      notes: event.target.value,
                    }
                  })
                }}
                disabled={!canManage}
                multiline
                minRows={3}
              />

              <Paper
                variant="outlined"
                sx={{
                  p: 1.1,
                  borderRadius: 1.1,
                  borderColor: alpha('#14532d', 0.24),
                  backgroundColor: alpha('#14532d', 0.04),
                }}
              >
                <Stack spacing={0.8}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Documents
                  </Typography>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
                    {selectedOpportunity.documentUrl ? (
                      <Button
                        color="inherit"
                        href={selectedOpportunity.documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
                      >
                        {selectedOpportunity.documentName || 'Open quote document'}
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No quote document attached.
                      </Typography>
                    )}

                    {selectedOpportunity.conceptImageUrl ? (
                      <Button
                        color="inherit"
                        href={selectedOpportunity.conceptImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        startIcon={<ImageRoundedIcon sx={{ fontSize: 14 }} />}
                        endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
                      >
                        {selectedOpportunity.conceptImageName || 'Open concept image'}
                      </Button>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No concept image attached.
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseOpportunityDetails}
            disabled={isSavingOpportunityDetails}
          >
            Close
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleSaveOpportunityDetails()
            }}
            disabled={!canManage || isSavingOpportunityDetails || !opportunityDetailsFormState}
          >
            {isSavingOpportunityDetails ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
