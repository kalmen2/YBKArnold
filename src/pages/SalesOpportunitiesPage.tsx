import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import {
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
  Link,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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
  fetchCrmDealers,
  fetchCrmOrders,
  fetchCrmQuotes,
  removeCrmQuote,
  updateCrmQuote,
  type CrmDealer,
  type CrmQuoteDocument,
  type CrmQuoteLineItem,
  type CrmOpportunityStage,
  type CrmOrder,
  type CrmQuote,
} from '../features/crm/api'
import { resolveQuoteAgeDays } from '../features/crm/utils'
import { resolveFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { formatCurrency } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

const DEFAULT_OPPORTUNITY_TITLE_PREFIX = 'Opportunity '

type OpportunityLineItemFormState = {
  itemNumber: string
  description: string
  qty: string
  unitPrice: string
  extPrice: string
}

type OpportunityFormState = {
  quoteNumber: string
  title: string
  opportunityDateInput: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  salesRep: string
  leadTime: string
  paymentTerms: string
  subtotal: string
  freight: string
  freightDescription: string
  notes: string
  lineItems: OpportunityLineItemFormState[]
  quoteDocumentUrl: string
  quoteDocumentName: string
}

type OpportunityDetailsFormState = {
  quoteNumber: string
  title: string
  opportunityDateInput: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  salesRep: string
  leadTime: string
  paymentTerms: string
  subtotal: string
  freight: string
  freightDescription: string
  notes: string
  lineItems: OpportunityLineItemFormState[]
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

type LineItemsEditorProps = {
  lineItems: OpportunityLineItemFormState[]
  canEdit: boolean
  onAddLineItem: () => void
  onUpdateLineItem: (index: number, field: keyof OpportunityLineItemFormState, value: string) => void
  onRemoveLineItem: (index: number) => void
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
    id: 'order_placement',
    label: '4. Order Placement',
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

function createEmptyLineItemFormState(): OpportunityLineItemFormState {
  return {
    itemNumber: '',
    description: '',
    qty: '',
    unitPrice: '',
    extPrice: '',
  }
}

function isBlankLineItem(lineItem: OpportunityLineItemFormState) {
  return !lineItem.itemNumber.trim()
    && !lineItem.description.trim()
    && !lineItem.qty.trim()
    && !lineItem.unitPrice.trim()
    && !lineItem.extPrice.trim()
}

function toOptionalNumber(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function toOptionalInteger(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed < 0 || Math.floor(parsed) !== parsed) {
    return null
  }

  return parsed
}

function normalizeLineItemsForPayload(lineItems: OpportunityLineItemFormState[]): CrmQuoteLineItem[] {
  const normalized: CrmQuoteLineItem[] = []

  for (const lineItem of lineItems) {
    if (isBlankLineItem(lineItem)) {
      continue
    }

    normalized.push({
      itemNumber: toOptionalInteger(lineItem.itemNumber) ?? 0,
      description: lineItem.description.trim() || null,
      qty: toOptionalNumber(lineItem.qty),
      unitPrice: toOptionalNumber(lineItem.unitPrice),
      extPrice: toOptionalNumber(lineItem.extPrice),
    })
  }

  return normalized
}

function mapLineItemToFormState(lineItem: CrmQuoteLineItem): OpportunityLineItemFormState {
  return {
    itemNumber: String(lineItem.itemNumber ?? '').trim(),
    description: String(lineItem.description ?? '').trim(),
    qty: lineItem.qty === null || lineItem.qty === undefined ? '' : String(lineItem.qty),
    unitPrice: lineItem.unitPrice === null || lineItem.unitPrice === undefined ? '' : String(lineItem.unitPrice),
    extPrice: lineItem.extPrice === null || lineItem.extPrice === undefined ? '' : String(lineItem.extPrice),
  }
}

function mapQuoteLineItemsToFormState(lineItems: CrmQuoteLineItem[] | null | undefined) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return [createEmptyLineItemFormState()]
  }

  return lineItems.map(mapLineItemToFormState)
}

function calculateLineItemsTotal(lineItems: CrmQuoteLineItem[]) {
  return Number(
    lineItems
      .reduce((sum, lineItem) => sum + Number(lineItem.extPrice || 0), 0)
      .toFixed(2),
  )
}

function resolveQuotePricing(
  lineItems: OpportunityLineItemFormState[],
  subtotalInput: string,
  freightInput: string,
  fallbackTotal = 0,
) {
  const normalizedLineItems = normalizeLineItemsForPayload(lineItems)
  const lineItemsTotal = calculateLineItemsTotal(normalizedLineItems)
  const subtotal = toOptionalNumber(subtotalInput)
  const freight = toOptionalNumber(freightInput)
  const baseSubtotal = subtotal ?? lineItemsTotal
  const computedTotal = Number((baseSubtotal + (freight ?? 0)).toFixed(2))

  return {
    normalizedLineItems,
    lineItemsTotal,
    subtotal,
    freight,
    totalAmount: Number.isFinite(computedTotal)
      ? computedTotal
      : Number(fallbackTotal || 0),
  }
}

function isGeneratedOpportunityTitle(title: string, quoteNumber: string) {
  const normalizedTitle = normalizeMatchValue(title)
  const generatedTitle = normalizeMatchValue(`${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${quoteNumber}`)

  return Boolean(generatedTitle) && normalizedTitle === generatedTitle
}

function getMissingSendProposalFields(quote: CrmQuote) {
  const missing: string[] = []
  const quoteNumber = String(quote.quoteNumber || '').trim()
  const title = String(quote.title || '').trim()

  if (!quoteNumber) {
    missing.push('Quote Number')
  }

  if (!title || isGeneratedOpportunityTitle(title, quoteNumber)) {
    missing.push('Project Name')
  }

  if (!String(quote.opportunityDate || '').trim()) {
    missing.push('Quote Date')
  }

  if (!String(quote.companyName || '').trim()) {
    missing.push('Company Name')
  }

  if (!String(quote.contactName || '').trim()) {
    missing.push('Contact Name')
  }

  if (!String(quote.contactEmail || '').trim()) {
    missing.push('Contact Email')
  }

  if (!String(quote.contactPhone || '').trim()) {
    missing.push('Contact Phone')
  }

  if (!String(quote.salesRep || '').trim()) {
    missing.push('Sales Rep')
  }

  if (!String(quote.leadTime || '').trim()) {
    missing.push('Lead Time')
  }

  if (!String(quote.paymentTerms || '').trim()) {
    missing.push('Payment Terms')
  }

  const lineItems = Array.isArray(quote.lineItems) ? quote.lineItems : []

  if (lineItems.length === 0) {
    missing.push('Line Items')
  } else {
    const hasIncompleteLineItems = lineItems.some((lineItem) => {
      const itemNumber = Number(lineItem.itemNumber)
      const hasItemNumber = Number.isFinite(itemNumber) && itemNumber > 0
      const hasDescription = Boolean(String(lineItem.description || '').trim())
      const hasQty = lineItem.qty !== null && Number.isFinite(Number(lineItem.qty))
      const hasUnitPrice = lineItem.unitPrice !== null && Number.isFinite(Number(lineItem.unitPrice))
      const hasExtPrice = lineItem.extPrice !== null && Number.isFinite(Number(lineItem.extPrice))

      return !hasItemNumber || !hasDescription || !hasQty || !hasUnitPrice || !hasExtPrice
    })

    if (hasIncompleteLineItems) {
      missing.push('Complete Line Items')
    }
  }

  return missing
}

function createEmptyOpportunityForm(): OpportunityFormState {
  return {
    quoteNumber: '',
    title: '',
    opportunityDateInput: getTodayEasternDateInputValue(),
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    salesRep: '',
    leadTime: '',
    paymentTerms: '',
    subtotal: '',
    freight: '',
    freightDescription: '',
    notes: '',
    lineItems: [createEmptyLineItemFormState()],
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
    opportunityDateInput: resolveDateInputFromIso(quote.opportunityDate),
    companyName: String(quote.companyName || ''),
    contactName: String(quote.contactName || ''),
    contactEmail: String(quote.contactEmail || ''),
    contactPhone: String(quote.contactPhone || ''),
    salesRep: String(quote.salesRep || ''),
    leadTime: String(quote.leadTime || ''),
    paymentTerms: String(quote.paymentTerms || ''),
    subtotal: quote.subtotal === null || quote.subtotal === undefined ? '' : String(quote.subtotal),
    freight: quote.freight === null || quote.freight === undefined ? '' : String(quote.freight),
    freightDescription: String(quote.freightDescription || ''),
    notes: String(quote.notes || ''),
    lineItems: mapQuoteLineItemsToFormState(quote.lineItems),
  }
}

function normalizeMatchValue(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function resolveQuoteDocuments(quote: CrmQuote | null | undefined): CrmQuoteDocument[] {
  if (!quote) {
    return []
  }

  const fromArray = Array.isArray(quote.documents)
    ? quote.documents
      .map((entry) => ({
        url: String(entry?.url ?? '').trim(),
        name: String(entry?.name ?? '').trim() || null,
      }))
      .filter((entry) => Boolean(entry.url))
    : []

  if (fromArray.length > 0) {
    return fromArray
  }

  const legacyDocumentUrl = String(quote.documentUrl ?? '').trim()

  if (!legacyDocumentUrl) {
    return []
  }

  return [{
    url: legacyDocumentUrl,
    name: String(quote.documentName ?? '').trim() || null,
  }]
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
    return 'proposal_submission'
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

function LineItemsEditor({
  lineItems,
  canEdit,
  onAddLineItem,
  onUpdateLineItem,
  onRemoveLineItem,
}: LineItemsEditorProps) {
  const lineItemsTotal = calculateLineItemsTotal(normalizeLineItemsForPayload(lineItems))

  return (
    <Stack spacing={0.9}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Line Items
          </Typography>
          <Chip size="small" label={`${lineItems.length} row${lineItems.length === 1 ? '' : 's'}`} sx={{ height: 20, fontSize: 11 }} />
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Total: {formatCurrency(lineItemsTotal, 2)}
          </Typography>
        </Stack>

        <Button size="small" variant="outlined" onClick={onAddLineItem} disabled={!canEdit}>
          Add line item
        </Button>
      </Stack>

      <Box
        sx={{
          border: 1,
          borderColor: alpha('#0f4c81', 0.2),
          borderRadius: 1.5,
          backgroundColor: '#ffffff',
          overflowX: 'auto',
        }}
      >
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 92, fontWeight: 700 }}>Item</TableCell>
              <TableCell sx={{ minWidth: 220, fontWeight: 700 }}>Description</TableCell>
              <TableCell sx={{ width: 90, fontWeight: 700 }}>Qty</TableCell>
              <TableCell sx={{ width: 125, fontWeight: 700 }}>Unit Price</TableCell>
              <TableCell sx={{ width: 135, fontWeight: 700 }}>Ext Price</TableCell>
              <TableCell align="center" sx={{ width: 60, fontWeight: 700 }}>Del</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lineItems.map((lineItem, index) => (
              <TableRow key={`line-item-${index}`} hover>
                <TableCell>
                  <TextField
                    variant="standard"
                    size="small"
                    type="number"
                    value={lineItem.itemNumber}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'itemNumber', event.target.value)
                    }}
                    disabled={!canEdit}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    size="small"
                    value={lineItem.description}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'description', event.target.value)
                    }}
                    disabled={!canEdit}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    size="small"
                    type="number"
                    value={lineItem.qty}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'qty', event.target.value)
                    }}
                    disabled={!canEdit}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    size="small"
                    type="text"
                    value={lineItem.unitPrice}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'unitPrice', event.target.value)
                    }}
                    disabled={!canEdit}
                    inputProps={{ inputMode: 'decimal' }}
                    placeholder="0.00"
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    variant="standard"
                    size="small"
                    type="text"
                    value={lineItem.extPrice}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'extPrice', event.target.value)
                    }}
                    disabled={!canEdit}
                    inputProps={{ inputMode: 'decimal' }}
                    placeholder="0.00"
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell align="center">
                  <IconButton
                    size="small"
                    color="error"
                    disabled={!canEdit || lineItems.length === 1}
                    onClick={() => {
                      onRemoveLineItem(index)
                    }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  )
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
        p: 1.1,
        borderRadius: 1.4,
        borderColor: alpha('#0f4c81', 0.22),
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 2px rgba(15, 76, 129, 0.08)',
        cursor: 'pointer',
        transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 6px 20px rgba(15, 76, 129, 0.16)',
          borderColor: alpha('#0f4c81', 0.4),
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
              width: 52,
              height: 52,
              flexShrink: 0,
              bgcolor: alpha('#0f4c81', 0.18),
              color: '#0f4c81',
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {dealerInitial}
          </Avatar>

          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {quote.quoteNumber || quote.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
              {dealerName}
            </Typography>
            <Typography variant="caption" sx={{ color: '#0f4c81', fontWeight: 700 }}>
              {formatCurrency(Number(quote.totalAmount || 0), 2)}
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

  const resolveDealerName = useCallback((quote: CrmQuote) => String(
    dealersBySourceId.get(quote.dealerSourceId)?.name
      || quote.companyName
      || quote.dealerName
      || quote.dealerSourceId
      || '',
  ).trim(), [dealersBySourceId])

  const resolveSalesRepLabel = useCallback((quote: CrmQuote) => String(quote.salesRep ?? '').trim() || '(Unassigned)', [])

  const dealerNameOptions = useMemo(
    () => [...new Set(rows.map((quote) => resolveDealerName(quote)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [rows, resolveDealerName],
  )

  const salesRepOptions = useMemo(
    () => [...new Set(rows.map((quote) => resolveSalesRepLabel(quote)).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [rows, resolveSalesRepLabel],
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
    resolveDealerName,
    resolveSalesRepLabel,
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
        width: '100%',
        minWidth: 0,
        borderRadius: 2,
        borderColor: alpha(stage.headerColor, 0.36),
        boxShadow: '0 6px 20px rgba(15, 35, 63, 0.08)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1.1,
          py: 0.9,
          background: `linear-gradient(135deg, ${stage.headerColor} 0%, ${alpha(stage.headerColor, 0.86)} 100%)`,
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

      <Box sx={{ px: 1, py: 0.8, backgroundColor: alpha(stage.panelColor, 0.78), borderBottom: 1, borderColor: '#d5dfeb' }}>
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
          p: 0.8,
          minHeight: 580,
          maxHeight: '72vh',
          overflowY: 'auto',
          backgroundColor: alpha(stage.panelColor, 0.5),
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
  const [showAddDetails, setShowAddDetails] = useState(false)
  const [formState, setFormState] = useState<OpportunityFormState>(createEmptyOpportunityForm)
  const [isSavingOpportunity, setIsSavingOpportunity] = useState(false)
  const [isUploadingQuoteDocument, setIsUploadingQuoteDocument] = useState(false)
  const [isUploadingSelectedOpportunityDocument, setIsUploadingSelectedOpportunityDocument] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [opportunityDetailsFormState, setOpportunityDetailsFormState] = useState<OpportunityDetailsFormState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')

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

  const isLoading = dealersQuery.isLoading
    || quotesQuery.isLoading
    || ordersQuery.isLoading
  const isRefreshing = (
    dealersQuery.isFetching
    || quotesQuery.isFetching
    || ordersQuery.isFetching
  ) && !isLoading

  const queryError = [dealersQuery.error, quotesQuery.error, ordersQuery.error]
    .find((entry) => entry instanceof Error)

  const canManage = Boolean(appUser?.uid)

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

  const dealersBySourceId = useMemo(
    () => new Map(dealers.map((dealer) => [dealer.sourceId, dealer])),
    [dealers],
  )

  const activeQuotes = useMemo(
    () => quotes.filter((quote) => quote.status !== 'rejected' && quote.status !== 'cancelled'),
    [quotes],
  )

  const filteredActiveQuotes = useMemo(() => {
    const term = globalSearch.trim().toLowerCase()

    if (!term) {
      return activeQuotes
    }

    return activeQuotes.filter((quote) => {
      const quoteNum = normalizeMatchValue(quote.quoteNumber)
      const title = normalizeMatchValue(quote.title)
      const companyName = normalizeMatchValue(quote.companyName)
      const dealerName = normalizeMatchValue(quote.dealerName)

      return (
        quoteNum.includes(term)
        || title.includes(term)
        || companyName.includes(term)
        || dealerName.includes(term)
      )
    })
  }, [activeQuotes, globalSearch])

  const stageBuckets = useMemo(() => {
    const base: Record<CrmOpportunityStage, CrmQuote[]> = {
      concept: [],
      proposal_submission: [],
      revision: [],
      order_placement: [],
    }

    for (const quote of filteredActiveQuotes) {
      const stage = resolveOpportunityStage(quote)
      base[stage].push(quote)
    }

    for (const stage of stageDefinitions) {
      base[stage.id].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    }

    return base
  }, [filteredActiveQuotes])

  const selectedOpportunityDealerName = useMemo(() => {
    if (!selectedOpportunity) {
      return ''
    }

    return dealersBySourceId.get(selectedOpportunity.dealerSourceId)?.name
      || selectedOpportunity.companyName
      || selectedOpportunity.dealerName
      || selectedOpportunity.dealerSourceId
      || ''
  }, [dealersBySourceId, selectedOpportunity])

  const selectedOpportunityStage = useMemo(
    () => (selectedOpportunity ? resolveOpportunityStage(selectedOpportunity) : null),
    [selectedOpportunity],
  )

  const selectedOpportunityDocuments = useMemo(
    () => resolveQuoteDocuments(selectedOpportunity),
    [selectedOpportunity],
  )

  const canUploadQuoteDocument = Boolean(formState.quoteNumber.trim())

  const addPricingPreview = useMemo(() => {
    const pricing = resolveQuotePricing(formState.lineItems, formState.subtotal, formState.freight)
    return {
      subtotal: pricing.subtotal ?? pricing.lineItemsTotal,
      freight: pricing.freight ?? 0,
      totalAmount: pricing.totalAmount,
    }
  }, [formState.freight, formState.lineItems, formState.subtotal])

  const detailsPricingPreview = useMemo(() => {
    if (!opportunityDetailsFormState) {
      return null
    }

    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.subtotal,
      opportunityDetailsFormState.freight,
      Number(selectedOpportunity?.totalAmount || 0),
    )

    return {
      subtotal: pricing.subtotal ?? pricing.lineItemsTotal,
      freight: pricing.freight ?? 0,
      totalAmount: pricing.totalAmount,
    }
  }, [opportunityDetailsFormState, selectedOpportunity?.totalAmount])

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
    ])
  }, [dealersQuery, ordersQuery, quotesQuery])

  const uploadQuoteDocumentFile = useCallback(async (file: File) => {
    const maxFileSize = 15 * 1024 * 1024
    const normalizedQuoteNumber = formState.quoteNumber.trim()

    if (file.size > maxFileSize) {
      throw new Error('File must be 15 MB or smaller.')
    }

    if (!normalizedQuoteNumber) {
      throw new Error('Enter quote number before uploading the quote document.')
    }

    const companySegment = sanitizeStoragePathSegment(formState.companyName.trim() || 'company', 'company')
    const quoteSegment = sanitizeStoragePathSegment(normalizedQuoteNumber, 'opportunity')
    const extension = resolveFileExtension(file)
    const fileStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const filePath = `crm/opportunities/${companySegment}/${quoteSegment}-quote-${fileStamp}${extension}`
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
  }, [formState.companyName, formState.quoteNumber])

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
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload quote document.')
    } finally {
      setIsUploadingQuoteDocument(false)
    }
  }, [uploadQuoteDocumentFile])

  const uploadSelectedOpportunityDocumentFile = useCallback(async (quote: CrmQuote, file: File) => {
    const maxFileSize = 15 * 1024 * 1024

    if (file.size > maxFileSize) {
      throw new Error('File must be 15 MB or smaller.')
    }

    const companySegment = sanitizeStoragePathSegment(
      String(quote.companyName || quote.dealerName || 'company').trim() || 'company',
      'company',
    )
    const quoteLabel = String(quote.quoteNumber ?? '').trim() || quote.id
    const quoteSegment = sanitizeStoragePathSegment(quoteLabel, 'opportunity')
    const extension = resolveFileExtension(file)
    const fileStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const filePath = `crm/opportunities/${companySegment}/${quoteSegment}-quote-${fileStamp}${extension}`
    const fileRef = storageRef(firebaseStorage, filePath)

    await uploadBytes(
      fileRef,
      file,
      file.type ? { contentType: file.type } : undefined,
    )

    const downloadUrl = await getDownloadURL(fileRef)

    return {
      url: downloadUrl,
      name: file.name,
    }
  }, [])

  const handleSelectedOpportunityDocumentUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !selectedOpportunity) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsUploadingSelectedOpportunityDocument(true)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      const nextDocument = await uploadSelectedOpportunityDocumentFile(selectedOpportunity, file)
      const nextDocuments = [...selectedOpportunityDocuments, nextDocument]
      const payload = await updateCrmQuote(selectedOpportunity.id, {
        documents: nextDocuments,
      })

      await invalidateOpportunityData()
      setSelectedOpportunity(payload.quote)
      setSuccessMessage('Document added to opportunity.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add document.')
    } finally {
      setIsUploadingSelectedOpportunityDocument(false)
      setBusyQuoteId(null)
    }
  }, [invalidateOpportunityData, selectedOpportunity, selectedOpportunityDocuments, uploadSelectedOpportunityDocumentFile])

  const handleRemoveSelectedOpportunityDocument = useCallback(async (documentUrl: string) => {
    if (!selectedOpportunity) {
      return
    }

    const confirmed = window.confirm('Remove this document from the opportunity?')

    if (!confirmed) {
      return
    }

    const nextDocuments = selectedOpportunityDocuments.filter((entry) => entry.url !== documentUrl)

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      const payload = await updateCrmQuote(selectedOpportunity.id, {
        documents: nextDocuments,
      })

      await invalidateOpportunityData()
      setSelectedOpportunity(payload.quote)
      setSuccessMessage('Document removed from opportunity.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove document.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [invalidateOpportunityData, selectedOpportunity, selectedOpportunityDocuments])

  const handleOpenDialog = useCallback(() => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setFormState(createEmptyOpportunityForm())
    setShowAddDetails(false)
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
    if (isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument) {
      return
    }

    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
  }, [isSavingOpportunityDetails, isUploadingSelectedOpportunityDocument])

  const handleAddFormLineItem = useCallback(() => {
    setFormState((current) => ({
      ...current,
      lineItems: [...current.lineItems, createEmptyLineItemFormState()],
    }))
  }, [])

  const handleRemoveFormLineItem = useCallback((index: number) => {
    setFormState((current) => {
      const nextLineItems = current.lineItems.filter((_entry, entryIndex) => entryIndex !== index)

      return {
        ...current,
        lineItems: nextLineItems.length > 0 ? nextLineItems : [createEmptyLineItemFormState()],
      }
    })
  }, [])

  const handleUpdateFormLineItem = useCallback(
    (index: number, field: keyof OpportunityLineItemFormState, value: string) => {
      setFormState((current) => ({
        ...current,
        lineItems: current.lineItems.map((entry, entryIndex) => (
          entryIndex === index
            ? {
              ...entry,
              [field]: value,
            }
            : entry
        )),
      }))
    },
    [],
  )

  const handleAddDetailsLineItem = useCallback(() => {
    setOpportunityDetailsFormState((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        lineItems: [...current.lineItems, createEmptyLineItemFormState()],
      }
    })
  }, [])

  const handleRemoveDetailsLineItem = useCallback((index: number) => {
    setOpportunityDetailsFormState((current) => {
      if (!current) {
        return current
      }

      const nextLineItems = current.lineItems.filter((_entry, entryIndex) => entryIndex !== index)

      return {
        ...current,
        lineItems: nextLineItems.length > 0 ? nextLineItems : [createEmptyLineItemFormState()],
      }
    })
  }, [])

  const handleUpdateDetailsLineItem = useCallback(
    (index: number, field: keyof OpportunityLineItemFormState, value: string) => {
      setOpportunityDetailsFormState((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          lineItems: current.lineItems.map((entry, entryIndex) => (
            entryIndex === index
              ? {
                ...entry,
                [field]: value,
              }
              : entry
          )),
        }
      })
    },
    [],
  )

  const handleCreateOpportunity = useCallback(async () => {
    const quoteNumber = formState.quoteNumber.trim()
    const opportunityDateInput = formState.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(formState.lineItems, formState.subtotal, formState.freight)
    const lineItems = pricing.normalizedLineItems
    const totalAmount = pricing.totalAmount

    // A concept now only needs a quote number; the rest is filled in later from
    // the Excel quote sync. Optional details are validated only when provided.
    if (!quoteNumber) {
      setErrorMessage('Quote number is required.')
      return
    }

    const isDuplicateQuoteNumber = quotes.some(
      (entry) => normalizeMatchValue(entry.quoteNumber) === normalizeMatchValue(quoteNumber),
    )

    if (isDuplicateQuoteNumber) {
      setErrorMessage(`Quote number ${quoteNumber} already exists. Open that opportunity instead.`)
      return
    }

    if (opportunityDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date must be a valid date.')
      return
    }

    const title = formState.title.trim() || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${quoteNumber}`

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunity(true)

    try {
      const quoteDocumentUrl = formState.quoteDocumentUrl.trim()
      const quoteDocumentName = formState.quoteDocumentName.trim()

      await createCrmQuote({
        quoteNumber,
        title,
        companyName: formState.companyName.trim() || null,
        contactName: formState.contactName.trim() || null,
        contactEmail: formState.contactEmail.trim() || null,
        contactPhone: formState.contactPhone.trim() || null,
        salesRep: formState.salesRep.trim() || null,
        leadTime: formState.leadTime.trim() || null,
        paymentTerms: formState.paymentTerms.trim() || null,
        subtotal: pricing.subtotal,
        freight: pricing.freight,
        freightDescription: formState.freightDescription.trim() || null,
        status: 'draft',
        opportunityStage: 'concept',
        opportunityDate: opportunityDateInput || null,
        lineItems,
        totalAmount,
        notes: formState.notes.trim() || null,
        documents: quoteDocumentUrl
          ? [{
            url: quoteDocumentUrl,
            name: quoteDocumentName || null,
          }]
          : [],
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
    formState.companyName,
    formState.contactEmail,
    formState.contactName,
    formState.contactPhone,
    formState.freight,
    formState.freightDescription,
    formState.leadTime,
    formState.lineItems,
    formState.notes,
    formState.opportunityDateInput,
    formState.paymentTerms,
    formState.quoteDocumentName,
    formState.quoteDocumentUrl,
    formState.quoteNumber,
    formState.salesRep,
    formState.subtotal,
    formState.title,
    invalidateOpportunityData,
    quotes,
  ])

  const updateStage = useCallback(async (quote: CrmQuote, nextStage: CrmOpportunityStage, patch: Partial<CrmQuote> = {}) => {
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
  }, [invalidateOpportunityData])

  const handleMoveBack = useCallback(async (quote: CrmQuote) => {
    const stage = resolveOpportunityStage(quote)

    if (stage === 'proposal_submission') {
      await updateStage(quote, 'concept', { status: 'draft' })
      return
    }

    if (stage === 'revision') {
      await updateStage(quote, 'proposal_submission', { status: 'draft' })
    }
  }, [updateStage])

  const handleAdvanceStage = useCallback(async (quote: CrmQuote) => {
    const stage = resolveOpportunityStage(quote)

    if (stage === 'concept') {
      const missingFields = getMissingSendProposalFields(quote)

      if (missingFields.length > 0) {
        setErrorMessage(`Cannot send proposal. Missing required details: ${missingFields.join(', ')}. Open details and complete them first.`)
        return
      }

      await updateStage(quote, 'proposal_submission', {
        status: 'sent',
        sentAt: new Date().toISOString(),
      })
    }
  }, [updateStage])

  const handleMarkNeedsRevision = useCallback(async (quote: CrmQuote) => {
    await updateStage(quote, 'revision', { status: 'draft' })
  }, [updateStage])

  const handleSendRevision = useCallback(async (quote: CrmQuote) => {
    const nextRevisionCount = Math.max(0, Number(quote.revisionCount || 0)) + 1

    await updateStage(quote, 'proposal_submission', {
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
  }, [createOrderFromQuote, invalidateOpportunityData, orders])

  const handleDeleteQuote = useCallback(async (quote: CrmQuote) => {
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
  }, [invalidateOpportunityData])

  const handleSaveOpportunityDetails = useCallback(async () => {
    if (!selectedOpportunity || !opportunityDetailsFormState) {
      return
    }

    const quoteNumber = opportunityDetailsFormState.quoteNumber.trim()
    const opportunityDateInput = opportunityDetailsFormState.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.subtotal,
      opportunityDetailsFormState.freight,
      Number(selectedOpportunity.totalAmount || 0),
    )
    const lineItems = pricing.normalizedLineItems
    const totalAmount = pricing.totalAmount
    const title = opportunityDetailsFormState.title.trim()
      || selectedOpportunity.title
      || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${quoteNumber}`

    if (!quoteNumber) {
      setErrorMessage('Quote number is required.')
      return
    }

    if (!title) {
      setErrorMessage('Opportunity title is required.')
      return
    }

    if (opportunityDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date must be a valid date.')
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
        companyName: opportunityDetailsFormState.companyName.trim() || null,
        contactName: opportunityDetailsFormState.contactName.trim() || null,
        contactEmail: opportunityDetailsFormState.contactEmail.trim() || null,
        contactPhone: opportunityDetailsFormState.contactPhone.trim() || null,
        salesRep: opportunityDetailsFormState.salesRep.trim() || null,
        leadTime: opportunityDetailsFormState.leadTime.trim() || null,
        paymentTerms: opportunityDetailsFormState.paymentTerms.trim() || null,
        subtotal: pricing.subtotal,
        freight: pricing.freight,
        freightDescription: opportunityDetailsFormState.freightDescription.trim() || null,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        totalAmount,
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
  }, [invalidateOpportunityData, opportunityDetailsFormState, selectedOpportunity])

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
              Concept - Proposal - Revision - Order Placement.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center">
            <TextField
              size="small"
              placeholder="Search by quote #, project, or company..."
              value={globalSearch}
              onChange={(event) => {
                setGlobalSearch(event.target.value)
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 260 }}
            />
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

      </Paper>

      <Box sx={{ pb: 0.5 }}>
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
            alignItems: 'start',
          }}
        >
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
              onSendRevision={handleSendRevision}
              onMarkApproved={handleMarkApproved}
              onDeleteQuote={handleDeleteQuote}
              onOpenDetails={handleOpenOpportunityDetails}
            />
          ))}
        </Box>
      </Box>

      <Dialog open={isDialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Add Opportunity</DialogTitle>
        <DialogContent>
          <Stack spacing={1.3} sx={{ mt: 0.5 }}>
            <TextField
              label="Quote Number"
              required
              autoFocus
              value={formState.quoteNumber}
              onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  quoteNumber: event.target.value,
                }))
              }}
              helperText="Enter the quote number to start a Concept. The rest fills in automatically when you sync from the Excel quote."
            />

            <Button
              variant="text"
              size="small"
              onClick={() => {
                setShowAddDetails((current) => !current)
              }}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              {showAddDetails ? 'Hide details' : 'Expand details (manual entry)'}
            </Button>

            {showAddDetails ? (
              <Stack spacing={1.3}>
                <TextField
                  label="Project Name"
                  value={formState.title}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }}
                  placeholder="Project name from the quote"
                />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                  <TextField
                    label="Quote Date"
                    type="date"
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
                  />

                  <TextField
                    label="Company Name"
                    value={formState.companyName}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        companyName: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                  <TextField
                    label="Contact Name"
                    value={formState.contactName}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        contactName: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />

                  <TextField
                    label="Contact Email"
                    value={formState.contactEmail}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        contactEmail: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                  <TextField
                    label="Contact Phone"
                    value={formState.contactPhone}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        contactPhone: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />

                  <TextField
                    label="Sales Rep"
                    value={formState.salesRep}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        salesRep: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                  <TextField
                    label="Lead Time"
                    value={formState.leadTime}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        leadTime: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />

                  <TextField
                    label="Payment Terms"
                    value={formState.paymentTerms}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        paymentTerms: event.target.value,
                      }))
                    }}
                    sx={{ flex: 1 }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                  <TextField
                    label="Sub Net Total"
                    value={formState.subtotal}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        subtotal: event.target.value,
                      }))
                    }}
                    type="text"
                    inputProps={{ inputMode: 'decimal' }}
                    placeholder="0.00"
                    sx={{ flex: 1 }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                  />

                  <TextField
                    label="Freight"
                    value={formState.freight}
                    onChange={(event) => {
                      setFormState((current) => ({
                        ...current,
                        freight: event.target.value,
                      }))
                    }}
                    type="text"
                    inputProps={{ inputMode: 'decimal' }}
                    placeholder="0.00"
                    sx={{ flex: 1 }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                  />
                </Stack>

                <TextField
                  label="Freight Description"
                  value={formState.freightDescription}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      freightDescription: event.target.value,
                    }))
                  }}
                  placeholder="Dock delivery, destination, or freight notes"
                />

                <Paper
                  variant="outlined"
                  sx={{
                    px: 1,
                    py: 0.8,
                    borderRadius: 1,
                    borderColor: alpha('#0f4c81', 0.2),
                    backgroundColor: alpha('#0f4c81', 0.04),
                  }}
                >
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      Sub Net: {formatCurrency(addPricingPreview.subtotal, 2)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      Freight: {formatCurrency(addPricingPreview.freight, 2)}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#0f4c81' }}>
                      Total: {formatCurrency(addPricingPreview.totalAmount, 2)}
                    </Typography>
                  </Stack>
                </Paper>

                <LineItemsEditor
                  lineItems={formState.lineItems}
                  canEdit
                  onAddLineItem={handleAddFormLineItem}
                  onUpdateLineItem={handleUpdateFormLineItem}
                  onRemoveLineItem={handleRemoveFormLineItem}
                />

                <Stack spacing={0.8}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Quote Document (optional)
                  </Typography>

                  <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Button
                      component="label"
                      size="small"
                      variant="outlined"
                      startIcon={<FileUploadRoundedIcon fontSize="small" />}
                      disabled={!canUploadQuoteDocument || isUploadingQuoteDocument || isSavingOpportunity}
                    >
                      {isUploadingQuoteDocument ? 'Uploading...' : (formState.quoteDocumentUrl ? 'Replace Document' : 'Upload Document')}
                      <input
                        hidden
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                        onChange={handleQuoteDocumentUpload}
                      />
                    </Button>

                    {formState.quoteDocumentUrl ? (
                      <Button
                        size="small"
                        component={Link}
                        href={formState.quoteDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Document
                      </Button>
                    ) : null}
                  </Stack>

                  {!canUploadQuoteDocument ? (
                    <Typography variant="caption" color="text.secondary">
                      Enter quote number before uploading a document.
                    </Typography>
                  ) : null}

                  {formState.quoteDocumentUrl ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        px: 1,
                        py: 0.7,
                        borderRadius: 1,
                        borderColor: alpha('#0f4c81', 0.25),
                        backgroundColor: alpha('#0f4c81', 0.04),
                      }}
                    >
                      <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                        <Typography variant="body2" sx={{ minWidth: 0 }} noWrap>
                          {formState.quoteDocumentName || 'Uploaded quote document'}
                        </Typography>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            setFormState((current) => ({
                              ...current,
                              quoteDocumentUrl: '',
                              quoteDocumentName: '',
                            }))
                          }}
                          disabled={isSavingOpportunity || isUploadingQuoteDocument}
                        >
                          Remove
                        </Button>
                      </Stack>
                    </Paper>
                  ) : null}
                </Stack>

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
              </Stack>
            ) : null}
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
                  label="Project Name"
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
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField
                  label="Quote Date"
                  type="date"
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
                  label="Company Name"
                  value={opportunityDetailsFormState.companyName}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        companyName: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField
                  label="Contact Name"
                  value={opportunityDetailsFormState.contactName}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        contactName: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Contact Email"
                  value={opportunityDetailsFormState.contactEmail}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        contactEmail: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Contact Phone"
                  value={opportunityDetailsFormState.contactPhone}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        contactPhone: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField
                  label="Sales Rep"
                  value={opportunityDetailsFormState.salesRep}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        salesRep: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Lead Time"
                  value={opportunityDetailsFormState.leadTime}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        leadTime: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />

                <TextField
                  label="Payment Terms"
                  value={opportunityDetailsFormState.paymentTerms}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        paymentTerms: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField
                  label="Sub Net Total"
                  value={opportunityDetailsFormState.subtotal}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        subtotal: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  type="text"
                  inputProps={{ inputMode: 'decimal' }}
                  placeholder="0.00"
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                />

                <TextField
                  label="Freight"
                  value={opportunityDetailsFormState.freight}
                  onChange={(event) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current) {
                        return current
                      }

                      return {
                        ...current,
                        freight: event.target.value,
                      }
                    })
                  }}
                  disabled={!canManage}
                  type="text"
                  inputProps={{ inputMode: 'decimal' }}
                  placeholder="0.00"
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                />
              </Stack>

              <TextField
                label="Freight Description"
                value={opportunityDetailsFormState.freightDescription}
                onChange={(event) => {
                  setOpportunityDetailsFormState((current) => {
                    if (!current) {
                      return current
                    }

                    return {
                      ...current,
                      freightDescription: event.target.value,
                    }
                  })
                }}
                disabled={!canManage}
                placeholder="Dock delivery, destination, or freight notes"
              />

              {detailsPricingPreview ? (
                <Paper
                  variant="outlined"
                  sx={{
                    px: 1,
                    py: 0.8,
                    borderRadius: 1,
                    borderColor: alpha('#0f4c81', 0.2),
                    backgroundColor: alpha('#0f4c81', 0.04),
                  }}
                >
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      Sub Net: {formatCurrency(detailsPricingPreview.subtotal, 2)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      Freight: {formatCurrency(detailsPricingPreview.freight, 2)}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#0f4c81' }}>
                      Total: {formatCurrency(detailsPricingPreview.totalAmount, 2)}
                    </Typography>
                  </Stack>
                </Paper>
              ) : null}

              <LineItemsEditor
                lineItems={opportunityDetailsFormState.lineItems}
                canEdit={canManage}
                onAddLineItem={handleAddDetailsLineItem}
                onUpdateLineItem={handleUpdateDetailsLineItem}
                onRemoveLineItem={handleRemoveDetailsLineItem}
              />

              <Stack spacing={0.8}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Documents
                </Typography>

                <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button
                    component="label"
                    size="small"
                    variant="outlined"
                    startIcon={<FileUploadRoundedIcon fontSize="small" />}
                    disabled={!canManage || isUploadingSelectedOpportunityDocument || isSavingOpportunityDetails}
                  >
                    {isUploadingSelectedOpportunityDocument ? 'Uploading...' : 'Upload Document'}
                    <input
                      hidden
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                      onChange={handleSelectedOpportunityDocumentUpload}
                    />
                  </Button>

                  <Typography variant="caption" color="text.secondary">
                    Add proposal, spec sheet, or signed file.
                  </Typography>
                </Stack>

                {selectedOpportunityDocuments.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No documents attached.
                  </Typography>
                ) : (
                  <Stack spacing={0.6}>
                    {selectedOpportunityDocuments.map((document) => (
                      <Paper
                        key={document.url}
                        variant="outlined"
                        sx={{
                          px: 1,
                          py: 0.7,
                          borderRadius: 1,
                          borderColor: alpha('#0f4c81', 0.2),
                        }}
                      >
                        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                          <Link
                            href={document.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            underline="hover"
                            sx={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {document.name || 'Open document'}
                          </Link>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canManage || busyQuoteId === selectedOpportunity.id}
                            onClick={() => {
                              void handleRemoveSelectedOpportunityDocument(document.url)
                            }}
                          >
                            <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Stack>

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
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseOpportunityDetails}
            disabled={isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument}
          >
            Close
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleSaveOpportunityDetails()
            }}
            disabled={
              !canManage
              || isSavingOpportunityDetails
              || isUploadingSelectedOpportunityDocument
              || !opportunityDetailsFormState
            }
          >
            {isSavingOpportunityDetails ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
