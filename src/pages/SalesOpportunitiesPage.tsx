import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import {
  Autocomplete,
  Avatar,
  Badge,
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmDealer,
  createCrmOrder,
  createCrmQuote,
  createCrmQuoteChatMessage,
  fetchCrmDealers,
  fetchCrmExcelQuoteLookup,
  fetchCrmOrders,
  fetchCrmQuoteChats,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  removeCrmQuoteChatMessage,
  removeCrmQuote,
  updateCrmQuote,
  type CrmDealer,
  type CrmExcelQuoteLookupResponse,
  type CrmExcelQuoteSyncInput,
  type CrmQuoteDocument,
  type CrmQuoteLineItem,
  type CrmOpportunityStage,
  type CrmOrder,
  type CrmQuote,
  type CrmQuoteChatMessage,
} from '../features/crm/api'
import { parseExcelQuoteForSync } from '../features/crm/excelQuoteParser'
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
  dealerSourceId: string
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
  dealerSourceId: string
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
  documents: CrmQuoteDocument[]
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
  chatMessageCount: number
  ageDays: number
  stage: CrmOpportunityStage
  canManage: boolean
  isBusy: boolean
  onAdvanceStage: (quote: CrmQuote) => void
  onMarkApproved: (quote: CrmQuote) => void
  onDeclineQuote: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
  onOpenChat: (quote: CrmQuote) => void
}

type StageColumnProps = {
  stage: StageDefinition
  rows: CrmQuote[]
  dealersBySourceId: Map<string, CrmDealer>
  canManage: boolean
  busyQuoteId: string | null
  onAdvanceStage: (quote: CrmQuote) => void
  onMarkApproved: (quote: CrmQuote) => void
  onDeclineQuote: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
  onOpenChat: (quote: CrmQuote) => void
}

type StageSortMode = 'value_desc' | 'value_asc' | 'date_desc' | 'date_asc' | 'alpha_asc' | 'alpha_desc'

type StageAmountCondition = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

type ExcelSyncProjectTypeOption = 'Reception Desk' | 'Courtroom' | 'Conference Table' | 'Other'
type ExcelSyncAccountMode = 'existing' | 'create'

type UsStateOption = {
  code: string
  label: string
}

type StageColumnFilters = {
  selectedDealerNames: string[]
  selectedSalesReps: string[]
  nameContains: string
  amountCondition: StageAmountCondition
  amountValue: string
  amountValueMax: string
}

type OpportunityDetailsSaveMode = 'save' | 'decline' | 'convert_to_order'
type OpportunityDetailsTab = 'details' | 'chat'

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
]

const stageById = new Map(stageDefinitions.map((stage) => [stage.id, stage]))

const excelSyncProjectTypeOptions: ExcelSyncProjectTypeOption[] = [
  'Reception Desk',
  'Courtroom',
  'Conference Table',
  'Other',
]

const usStateOptions: UsStateOption[] = [
  { code: 'AL', label: 'AL - Alabama' },
  { code: 'AK', label: 'AK - Alaska' },
  { code: 'AZ', label: 'AZ - Arizona' },
  { code: 'AR', label: 'AR - Arkansas' },
  { code: 'CA', label: 'CA - California' },
  { code: 'CO', label: 'CO - Colorado' },
  { code: 'CT', label: 'CT - Connecticut' },
  { code: 'DE', label: 'DE - Delaware' },
  { code: 'FL', label: 'FL - Florida' },
  { code: 'GA', label: 'GA - Georgia' },
  { code: 'HI', label: 'HI - Hawaii' },
  { code: 'ID', label: 'ID - Idaho' },
  { code: 'IL', label: 'IL - Illinois' },
  { code: 'IN', label: 'IN - Indiana' },
  { code: 'IA', label: 'IA - Iowa' },
  { code: 'KS', label: 'KS - Kansas' },
  { code: 'KY', label: 'KY - Kentucky' },
  { code: 'LA', label: 'LA - Louisiana' },
  { code: 'ME', label: 'ME - Maine' },
  { code: 'MD', label: 'MD - Maryland' },
  { code: 'MA', label: 'MA - Massachusetts' },
  { code: 'MI', label: 'MI - Michigan' },
  { code: 'MN', label: 'MN - Minnesota' },
  { code: 'MS', label: 'MS - Mississippi' },
  { code: 'MO', label: 'MO - Missouri' },
  { code: 'MT', label: 'MT - Montana' },
  { code: 'NE', label: 'NE - Nebraska' },
  { code: 'NV', label: 'NV - Nevada' },
  { code: 'NH', label: 'NH - New Hampshire' },
  { code: 'NJ', label: 'NJ - New Jersey' },
  { code: 'NM', label: 'NM - New Mexico' },
  { code: 'NY', label: 'NY - New York' },
  { code: 'NC', label: 'NC - North Carolina' },
  { code: 'ND', label: 'ND - North Dakota' },
  { code: 'OH', label: 'OH - Ohio' },
  { code: 'OK', label: 'OK - Oklahoma' },
  { code: 'OR', label: 'OR - Oregon' },
  { code: 'PA', label: 'PA - Pennsylvania' },
  { code: 'RI', label: 'RI - Rhode Island' },
  { code: 'SC', label: 'SC - South Carolina' },
  { code: 'SD', label: 'SD - South Dakota' },
  { code: 'TN', label: 'TN - Tennessee' },
  { code: 'TX', label: 'TX - Texas' },
  { code: 'UT', label: 'UT - Utah' },
  { code: 'VT', label: 'VT - Vermont' },
  { code: 'VA', label: 'VA - Virginia' },
  { code: 'WA', label: 'WA - Washington' },
  { code: 'WV', label: 'WV - West Virginia' },
  { code: 'WI', label: 'WI - Wisconsin' },
  { code: 'WY', label: 'WY - Wyoming' },
]

const usStateOptionByCode = new Map(usStateOptions.map((entry) => [entry.code, entry] as const))
const usStateCodeSet = new Set(usStateOptions.map((entry) => entry.code))
const usStateCodeByNormalizedName = new Map(
  usStateOptions
    .map((entry) => {
      const stateName = entry.label.includes(' - ')
        ? entry.label.split(' - ').slice(1).join(' - ').trim()
        : entry.label.trim()
      const normalizedStateName = stateName
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      return [normalizedStateName, entry.code] as const
    })
    .filter(([stateName]) => Boolean(stateName)),
)
const usStateCodeByCompactName = new Map(
  [...usStateCodeByNormalizedName.entries()].map(([stateName, code]) => [stateName.replace(/\s+/g, ''), code] as const),
)

function resolveUsStateCodeFromInput(value: string | null | undefined) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return ''
  }

  const uppercaseValue = rawValue.toUpperCase()
  const compactLetters = uppercaseValue.replace(/[^A-Z]/g, '')

  if (compactLetters.length === 2 && usStateCodeSet.has(compactLetters)) {
    return compactLetters
  }

  const codeTokenMatches = uppercaseValue.match(/\b[A-Z]{2}\b/g) ?? []

  for (const token of codeTokenMatches) {
    if (usStateCodeSet.has(token)) {
      return token
    }
  }

  const normalizedName = rawValue
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalizedName) {
    return ''
  }

  const directNameCode = usStateCodeByNormalizedName.get(normalizedName)

  if (directNameCode) {
    return directNameCode
  }

  return usStateCodeByCompactName.get(normalizedName.replace(/\s+/g, '')) || ''
}

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
    dealerSourceId: '',
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
    dealerSourceId: String(quote.dealerSourceId || ''),
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
    documents: resolveQuoteDocuments(quote),
  }
}

function mergeExcelSyncIntoDetailsFormState(
  baseState: OpportunityDetailsFormState,
  syncInput: CrmExcelQuoteSyncInput,
  options: {
    dealerSourceId?: string
    companyName?: string
  } = {},
): OpportunityDetailsFormState {
  const nextQuoteNumber = String(syncInput.quoteNumber ?? '').trim()
  const nextTitle = String(syncInput.title ?? '').trim()
  const nextCompanyName = String(syncInput.companyName ?? '').trim()
  const nextContactName = String(syncInput.contactName ?? '').trim()
  const nextContactEmail = String(syncInput.contactEmail ?? '').trim()
  const nextContactPhone = String(syncInput.contactPhone ?? '').trim()
  const nextSalesRep = String(syncInput.salesRep ?? '').trim()
  const nextLeadTime = String(syncInput.leadTime ?? '').trim()
  const nextPaymentTerms = String(syncInput.paymentTerms ?? '').trim()
  const nextFreightDescription = String(syncInput.freightDescription ?? '').trim()
  const nextDateInput = syncInput.opportunityDate
    ? resolveDateInputFromIso(syncInput.opportunityDate)
    : baseState.opportunityDateInput

  const nextLineItems = Array.isArray(syncInput.lineItems) && syncInput.lineItems.length > 0
    ? mapQuoteLineItemsToFormState(syncInput.lineItems)
    : baseState.lineItems

  return {
    ...baseState,
    dealerSourceId: String(options.dealerSourceId ?? '').trim() || baseState.dealerSourceId,
    quoteNumber: nextQuoteNumber || baseState.quoteNumber,
    title: nextTitle || baseState.title,
    opportunityDateInput: nextDateInput,
    companyName: String(options.companyName ?? '').trim() || nextCompanyName || baseState.companyName,
    contactName: nextContactName || baseState.contactName,
    contactEmail: nextContactEmail || baseState.contactEmail,
    contactPhone: nextContactPhone || baseState.contactPhone,
    salesRep: nextSalesRep || baseState.salesRep,
    leadTime: nextLeadTime || baseState.leadTime,
    paymentTerms: nextPaymentTerms || baseState.paymentTerms,
    subtotal: syncInput.subtotal === null || syncInput.subtotal === undefined
      ? baseState.subtotal
      : String(syncInput.subtotal),
    freight: syncInput.freight === null || syncInput.freight === undefined
      ? baseState.freight
      : String(syncInput.freight),
    freightDescription: nextFreightDescription || baseState.freightDescription,
    lineItems: nextLineItems,
  }
}

function serializeOpportunityDetailsFormState(state: OpportunityDetailsFormState | null): string {
  if (!state) {
    return ''
  }

  return JSON.stringify(state)
}

function serializeOpportunityFormState(state: OpportunityFormState | null): string {
  if (!state) {
    return ''
  }

  return JSON.stringify(state)
}

function formatQuoteChatTimestamp(value: string | null | undefined) {
  const parsed = new Date(String(value || '').trim())

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown time'
  }

  return parsed.toLocaleString()
}

function resolveQuoteChatAuthorLabel(message: CrmQuoteChatMessage) {
  return String(
    message.createdByName
    || message.createdByEmail
    || message.createdByUid
    || 'Unknown sender',
  ).trim()
}

function normalizeMatchValue(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeDealerLookupKey(value: string | null | undefined) {
  return normalizeMatchValue(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDealerLookupCompact(value: string | null | undefined) {
  return normalizeDealerLookupKey(value).replace(/\s+/g, '')
}

const dealerNameStopWords = new Set([
  'and',
  'the',
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'co',
  'company',
  'corp',
  'corporation',
  'group',
  'lp',
  'plc',
  'pc',
])

function toDealerMatchTokens(value: string | null | undefined) {
  return normalizeDealerLookupKey(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function normalizeDealerMatchCore(value: string | null | undefined) {
  const tokens = toDealerMatchTokens(value)
    .filter((token) => token.length > 1 && !dealerNameStopWords.has(token))

  return tokens.join(' ')
}

function resolveDealerNameMatchScore(candidateName: string, dealerName: string) {
  const candidateKey = normalizeDealerLookupKey(candidateName)
  const dealerKey = normalizeDealerLookupKey(dealerName)
  const candidateCompact = normalizeDealerLookupCompact(candidateName)
  const dealerCompact = normalizeDealerLookupCompact(dealerName)

  if (!candidateKey || !dealerKey) {
    return 0
  }

  if (candidateKey === dealerKey) {
    return 120
  }

  const candidateCore = normalizeDealerMatchCore(candidateName)
  const dealerCore = normalizeDealerMatchCore(dealerName)
  const candidateCoreCompact = normalizeDealerLookupCompact(candidateCore)
  const dealerCoreCompact = normalizeDealerLookupCompact(dealerCore)

  if (candidateCompact && dealerCompact && candidateCompact === dealerCompact) {
    return 118
  }

  if (candidateCore && dealerCore && candidateCore === dealerCore) {
    return 115
  }

  if (
    candidateCoreCompact
    && dealerCoreCompact
    && candidateCoreCompact === dealerCoreCompact
  ) {
    return 112
  }

  if (
    (candidateCompact.length >= 4 && dealerCompact.includes(candidateCompact))
    || (dealerCompact.length >= 4 && candidateCompact.includes(dealerCompact))
  ) {
    return 108
  }

  if (
    (candidateCoreCompact.length >= 4 && dealerCoreCompact.includes(candidateCoreCompact))
    || (dealerCoreCompact.length >= 4 && candidateCoreCompact.includes(dealerCoreCompact))
  ) {
    return 100
  }

  if (
    (candidateKey.length >= 4 && dealerKey.includes(candidateKey))
    || (dealerKey.length >= 4 && candidateKey.includes(dealerKey))
  ) {
    return 105
  }

  if (
    candidateCore
    && dealerCore
    && ((candidateCore.length >= 4 && dealerCore.includes(candidateCore))
      || (dealerCore.length >= 4 && candidateCore.includes(dealerCore)))
  ) {
    return 95
  }

  const candidateTokens = [...new Set(toDealerMatchTokens(candidateCore || candidateName))]
  const dealerTokens = [...new Set(toDealerMatchTokens(dealerCore || dealerName))]

  if (candidateTokens.length === 0 || dealerTokens.length === 0) {
    return 0
  }

  let overlapCount = 0

  for (const token of candidateTokens) {
    if (dealerTokens.includes(token)) {
      overlapCount += 1
    }
  }

  if (overlapCount > 0) {
    const minTokenCount = Math.min(candidateTokens.length, dealerTokens.length)
    const overlapRatio = overlapCount / minTokenCount

    if (overlapCount >= 2 && overlapRatio >= 0.6) {
      return 70 + overlapCount
    }

    if (overlapCount === 1 && (candidateTokens.length === 1 || dealerTokens.length === 1)) {
      const matchedToken = candidateTokens.find((token) => dealerTokens.includes(token)) || ''

      if (matchedToken.length >= 5) {
        return 58
      }
    }
  }

  let fuzzyOverlapCount = 0

  for (const token of candidateTokens) {
    if (token.length < 3) {
      continue
    }

    const hasFuzzyTokenMatch = dealerTokens.some((dealerToken) => {
      if (dealerToken.length < 3) {
        return false
      }

      return dealerToken.includes(token) || token.includes(dealerToken)
    })

    if (hasFuzzyTokenMatch) {
      fuzzyOverlapCount += 1
    }
  }

  if (fuzzyOverlapCount === 0) {
    return 0
  }

  const fuzzyMinTokenCount = Math.min(candidateTokens.length, dealerTokens.length)
  const fuzzyOverlapRatio = fuzzyOverlapCount / fuzzyMinTokenCount

  if (fuzzyOverlapCount >= 2 && fuzzyOverlapRatio >= 0.6) {
    return 66 + fuzzyOverlapCount
  }

  if (fuzzyOverlapCount === 1 && (candidateTokens.length === 1 || dealerTokens.length === 1)) {
    const fuzzyToken = candidateTokens.find((token) => token.length >= 4 && dealerTokens.some((dealerToken) => dealerToken.includes(token) || token.includes(dealerToken))) || ''

    if (fuzzyToken.length >= 4) {
      return 56
    }
  }

  return 0
}

function findMatchingDealersByName(dealers: CrmDealer[], candidateName: string) {
  const matchRows = dealers
    .map((dealer) => ({
      dealer,
      score: resolveDealerNameMatchScore(candidateName, String(dealer.name || dealer.sourceId || '')),
    }))
    .filter((entry) => entry.score > 0)

  matchRows.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return resolveDealerSelectionLabel(left.dealer).localeCompare(resolveDealerSelectionLabel(right.dealer))
  })

  return matchRows.map((entry) => entry.dealer)
}

function resolveDealerSelectionLabel(dealer: CrmDealer) {
  const name = String(dealer.name || dealer.sourceId || '').trim() || dealer.sourceId
  const city = String(dealer.city || '').trim()
  const state = String(dealer.state || '').trim().toUpperCase()
  const location = [city, state].filter(Boolean).join(', ')
  const sourceId = String(dealer.sourceId || '').trim()

  if (location && sourceId) {
    return `${name} - ${location} - ${sourceId}`
  }

  if (location) {
    return `${name} - ${location}`
  }

  if (sourceId) {
    return `${name} - ${sourceId}`
  }

  return name
}

function resolveMatchingOption(preferredValue: string | null | undefined, options: string[]) {
  const normalizedPreferred = normalizeMatchValue(preferredValue)

  if (!normalizedPreferred) {
    return ''
  }

  return options.find((option) => normalizeMatchValue(option) === normalizedPreferred) || ''
}

function resolveDefaultExcelProjectType(value: string | null | undefined): ExcelSyncProjectTypeOption | '' {
  const normalized = normalizeMatchValue(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return ''
  }

  if (normalized.includes('reception desk') || normalized.includes('reception')) {
    return 'Reception Desk'
  }

  if (normalized.includes('courtroom') || normalized.includes('court room')) {
    return 'Courtroom'
  }

  if (
    normalized.includes('conference table')
    || (normalized.includes('conference') && normalized.includes('table'))
    || normalized === 'conference'
    || normalized === 'table'
  ) {
    return 'Conference Table'
  }

  // "Other" is never auto-selected; it must be picked manually.
  return ''
}

function isExcelSyncProjectTypeOption(value: string): value is ExcelSyncProjectTypeOption {
  return excelSyncProjectTypeOptions.includes(value as ExcelSyncProjectTypeOption)
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
  chatMessageCount,
  ageDays,
  stage,
  canManage,
  isBusy,
  onAdvanceStage,
  onMarkApproved,
  onDeclineQuote,
  onDeleteQuote,
  onOpenDetails,
  onOpenChat,
}: OpportunityCardProps) {
  const dealerInitial = String(dealerName).trim().charAt(0).toUpperCase() || 'D'
  const normalizedChatMessageCount = Number.isFinite(Number(chatMessageCount))
    ? Math.max(0, Number(chatMessageCount))
    : 0
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const suppressCardOpenUntilRef = useRef(0)
  const isMenuOpen = Boolean(menuAnchorEl)

  const closeMenu = () => {
    suppressCardOpenUntilRef.current = Date.now() + 280
    setMenuAnchorEl(null)
  }

  const preventCardClick = (event: MouseEvent) => {
    event.stopPropagation()
  }

  return (
    <Paper
      variant="outlined"
      onMouseDown={() => {
        if (isMenuOpen) {
          suppressCardOpenUntilRef.current = Date.now() + 280
        }
      }}
      onClick={(event) => {
        if (Date.now() < suppressCardOpenUntilRef.current) {
          event.stopPropagation()
          return
        }

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

            <IconButton
              size="small"
              disabled={isBusy}
              onClick={(event) => {
                preventCardClick(event)
                onOpenChat(quote)
              }}
              sx={{ p: 0.15, color: '#0f4c81' }}
              title="Open quote chat"
              aria-label="Open quote chat"
            >
              <Badge
                color="primary"
                badgeContent={normalizedChatMessageCount > 0 ? normalizedChatMessageCount : undefined}
                max={99}
              >
                <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 20 }} />
              </Badge>
            </IconButton>

            {canManage && stage === 'proposal_submission' ? (
              <IconButton
                size="medium"
                disabled={isBusy}
                onClick={(event) => {
                  preventCardClick(event)
                  setMenuAnchorEl(event.currentTarget)
                }}
                sx={{ p: 0.15 }}
              >
                <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            ) : null}
          </Stack>
        </Stack>

        {canManage ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap onClick={preventCardClick}>
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
          </Stack>
        ) : null}

        {canManage ? (
          <Stack direction="row" justifyContent="flex-end" onClick={preventCardClick}>
            <Tooltip title="Delete quote">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={isBusy}
                  onClick={() => {
                    onDeleteQuote(quote)
                  }}
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ) : null}

        <Menu
          anchorEl={menuAnchorEl}
          open={isMenuOpen}
          onClose={() => {
            closeMenu()
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onClick={() => {
              closeMenu()
              onDeclineQuote(quote)
            }}
          >
            Declined
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeMenu()
              onMarkApproved(quote)
            }}
          >
            Convert to order
          </MenuItem>
        </Menu>
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
  onAdvanceStage,
  onMarkApproved,
  onDeclineQuote,
  onDeleteQuote,
  onOpenDetails,
  onOpenChat,
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
                chatMessageCount={Math.max(0, Number(quote.chatMessageCount || 0))}
                ageDays={ageDays}
                stage={stage.id}
                canManage={canManage}
                isBusy={busyQuoteId === quote.id}
                onAdvanceStage={onAdvanceStage}
                onMarkApproved={onMarkApproved}
                onDeclineQuote={onDeclineQuote}
                onDeleteQuote={onDeleteQuote}
                onOpenDetails={onOpenDetails}
                onOpenChat={onOpenChat}
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
  const [isAddDialogDraftFromExcelSync, setIsAddDialogDraftFromExcelSync] = useState(false)
  const [addDialogInitialSnapshot, setAddDialogInitialSnapshot] = useState(() => serializeOpportunityFormState(createEmptyOpportunityForm()))
  const [isSyncingExcelQuote, setIsSyncingExcelQuote] = useState(false)
  const [isExcelAccountDialogOpen, setIsExcelAccountDialogOpen] = useState(false)
  const [isExcelSyncDialogOpen, setIsExcelSyncDialogOpen] = useState(false)
  const [isExcelMissingConceptDialogOpen, setIsExcelMissingConceptDialogOpen] = useState(false)
  const [excelSyncAllowCreateWhenMissingConcept, setExcelSyncAllowCreateWhenMissingConcept] = useState(false)
  const [excelSyncDraft, setExcelSyncDraft] = useState<CrmExcelQuoteSyncInput | null>(null)
  const [excelSyncLookupResult, setExcelSyncLookupResult] = useState<CrmExcelQuoteLookupResponse | null>(null)
  const [excelSyncSourceFileName, setExcelSyncSourceFileName] = useState('')
  const [excelSyncQuoteNumberInput, setExcelSyncQuoteNumberInput] = useState('')
  const [excelSyncSalesRepInput, setExcelSyncSalesRepInput] = useState('')
  const [excelSyncRawSalesRep, setExcelSyncRawSalesRep] = useState('')
  const [excelSyncDealerStateCode, setExcelSyncDealerStateCode] = useState('')
  const [excelSyncProjectTypeInput, setExcelSyncProjectTypeInput] = useState('')
  const [excelSyncAccountMode, setExcelSyncAccountMode] = useState<ExcelSyncAccountMode>('existing')
  const [excelSyncDealerSourceIdInput, setExcelSyncDealerSourceIdInput] = useState('')
  const [excelSyncNewDealerNameInput, setExcelSyncNewDealerNameInput] = useState('')
  const [excelSyncResolvedDealerSourceId, setExcelSyncResolvedDealerSourceId] = useState('')
  const [excelSyncResolvedDealerName, setExcelSyncResolvedDealerName] = useState('')
  const [excelSyncDialogError, setExcelSyncDialogError] = useState<string | null>(null)
  const [isSavingOpportunity, setIsSavingOpportunity] = useState(false)
  const [isUploadingQuoteDocument, setIsUploadingQuoteDocument] = useState(false)
  const [isUploadingSelectedOpportunityDocument, setIsUploadingSelectedOpportunityDocument] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [selectedOpportunityDetailsTab, setSelectedOpportunityDetailsTab] = useState<OpportunityDetailsTab>('details')
  const [opportunityDetailsFormState, setOpportunityDetailsFormState] = useState<OpportunityDetailsFormState | null>(null)
  const [opportunityDetailsInitialSnapshot, setOpportunityDetailsInitialSnapshot] = useState('')
  const [selectedOpportunityChatDraft, setSelectedOpportunityChatDraft] = useState('')
  const [isSendingSelectedOpportunityChat, setIsSendingSelectedOpportunityChat] = useState(false)
  const [deletingSelectedOpportunityChatMessageId, setDeletingSelectedOpportunityChatMessageId] = useState('')
  const [pendingExcelSyncPromotionQuoteId, setPendingExcelSyncPromotionQuoteId] = useState<string | null>(null)
  const [detailsActionMenuAnchorEl, setDetailsActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const selectedOpportunityId = selectedOpportunity?.id ?? ''

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

  const selectedOpportunityChatsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuoteChats(selectedOpportunityId),
    queryFn: () => fetchCrmQuoteChats(selectedOpportunityId, {
      limit: 250,
      offset: 0,
    }),
    enabled: Boolean(selectedOpportunityId),
    staleTime: 20 * 1000,
  })

  const isLoading = dealersQuery.isLoading
    || quotesQuery.isLoading
    || ordersQuery.isLoading
  const isRefreshing = (
    dealersQuery.isFetching
    || quotesQuery.isFetching
    || ordersQuery.isFetching
  ) && !isLoading

  const queryError = [dealersQuery.error, quotesQuery.error, ordersQuery.error, salesRepsQuery.error]
    .find((entry) => entry instanceof Error)

  const currentUserUid = String(appUser?.uid ?? '').trim()
  const currentUserEmail = String(appUser?.email ?? '').trim().toLowerCase()
  const isCurrentUserAdmin = appUser?.isAdmin === true
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

  const excelSyncSalesRepOptions = useMemo(() => {
    const dynamicSalesReps = Array.isArray(salesRepsQuery.data?.salesReps)
      ? salesRepsQuery.data.salesReps
        .map((entry) => String(entry?.name ?? '').trim())
        .filter(Boolean)
      : []

    const uniqueSalesReps = [...new Set([
      'House',
      ...dynamicSalesReps,
    ])]

    return uniqueSalesReps.sort((left, right) => {
      const leftIsHouse = normalizeMatchValue(left) === 'house'
      const rightIsHouse = normalizeMatchValue(right) === 'house'

      if (leftIsHouse && !rightIsHouse) {
        return -1
      }

      if (!leftIsHouse && rightIsHouse) {
        return 1
      }

      return left.localeCompare(right)
    })
  }, [salesRepsQuery.data?.salesReps])

  const unrecognizedExcelSalesRep = useMemo(() => {
    const rawValue = excelSyncRawSalesRep.trim()

    if (!rawValue) {
      return ''
    }

    const matched = resolveMatchingOption(rawValue, excelSyncSalesRepOptions)
    return matched ? '' : rawValue
  }, [excelSyncRawSalesRep, excelSyncSalesRepOptions])

  const dealersBySourceId = useMemo(
    () => new Map(dealers.map((dealer) => [dealer.sourceId, dealer])),
    [dealers],
  )

  const excelSyncAccountCandidateName = useMemo(
    () => String(excelSyncDraft?.companyName ?? '').trim(),
    [excelSyncDraft?.companyName],
  )

  const excelSyncDetectedAccountMatches = useMemo(() => {
    if (!excelSyncAccountCandidateName) {
      return []
    }

    return findMatchingDealersByName(dealers, excelSyncAccountCandidateName)
  }, [dealers, excelSyncAccountCandidateName])

  const excelSyncDealerOptions = useMemo(() => {
    const matchedSourceIdSet = new Set(excelSyncDetectedAccountMatches.map((dealer) => dealer.sourceId))

    return [...dealers].sort((left, right) => {
      const leftIsMatched = matchedSourceIdSet.has(left.sourceId)
      const rightIsMatched = matchedSourceIdSet.has(right.sourceId)

      if (leftIsMatched && !rightIsMatched) {
        return -1
      }

      if (!leftIsMatched && rightIsMatched) {
        return 1
      }

      return resolveDealerSelectionLabel(left).localeCompare(resolveDealerSelectionLabel(right))
    })
  }, [dealers, excelSyncDetectedAccountMatches])

  const selectedExcelSyncDealer = useMemo(
    () => dealersBySourceId.get(excelSyncDealerSourceIdInput) ?? null,
    [dealersBySourceId, excelSyncDealerSourceIdInput],
  )

  const activeQuotes = useMemo(
    () => quotes.filter(
      (quote) => quote.status !== 'rejected' && quote.status !== 'cancelled' && quote.status !== 'accepted',
    ),
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

    const stagedDealerSourceId = String(opportunityDetailsFormState?.dealerSourceId || '').trim()
    const stagedDealerName = stagedDealerSourceId
      ? dealersBySourceId.get(stagedDealerSourceId)?.name
      : ''

    if (stagedDealerName) {
      return stagedDealerName
    }

    return dealersBySourceId.get(selectedOpportunity.dealerSourceId)?.name
      || String(opportunityDetailsFormState?.companyName || '').trim()
      || selectedOpportunity.companyName
      || selectedOpportunity.dealerName
      || stagedDealerSourceId
      || selectedOpportunity.dealerSourceId
      || ''
  }, [dealersBySourceId, opportunityDetailsFormState?.companyName, opportunityDetailsFormState?.dealerSourceId, selectedOpportunity])

  const selectedOpportunityStage = useMemo(
    () => (selectedOpportunity ? resolveOpportunityStage(selectedOpportunity) : null),
    [selectedOpportunity],
  )

  const isDetailsActionMenuOpen = Boolean(detailsActionMenuAnchorEl)
  const canUseProposalDetailsActions = Boolean(
    canManage
    && selectedOpportunity
    && opportunityDetailsFormState
    && selectedOpportunityStage === 'proposal_submission',
  )

  const isOpportunityDetailsDirty = useMemo(
    () => serializeOpportunityDetailsFormState(opportunityDetailsFormState) !== opportunityDetailsInitialSnapshot,
    [opportunityDetailsFormState, opportunityDetailsInitialSnapshot],
  )

  const selectedOpportunityDocuments = useMemo(
    () => (opportunityDetailsFormState?.documents ?? []),
    [opportunityDetailsFormState],
  )

  const selectedOpportunityChatMessages = useMemo(
    () => (Array.isArray(selectedOpportunityChatsQuery.data?.messages)
      ? selectedOpportunityChatsQuery.data.messages
      : []),
    [selectedOpportunityChatsQuery.data?.messages],
  )

  const selectedOpportunityChatCount = selectedOpportunityChatMessages.length

  const selectedOpportunityChatErrorMessage = selectedOpportunityChatsQuery.error instanceof Error
    ? selectedOpportunityChatsQuery.error.message
    : null

  const isAddDialogDirty = useMemo(
    () => serializeOpportunityFormState(formState) !== addDialogInitialSnapshot,
    [addDialogInitialSnapshot, formState],
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

  const resetExcelSyncDialog = useCallback(() => {
    setIsExcelMissingConceptDialogOpen(false)
    setIsExcelAccountDialogOpen(false)
    setIsExcelSyncDialogOpen(false)
    setExcelSyncAllowCreateWhenMissingConcept(false)
    setExcelSyncDraft(null)
    setExcelSyncLookupResult(null)
    setExcelSyncSourceFileName('')
    setExcelSyncQuoteNumberInput('')
    setExcelSyncSalesRepInput('')
    setExcelSyncRawSalesRep('')
    setExcelSyncDealerStateCode('')
    setExcelSyncProjectTypeInput('')
    setExcelSyncAccountMode('existing')
    setExcelSyncDealerSourceIdInput('')
    setExcelSyncNewDealerNameInput('')
    setExcelSyncResolvedDealerSourceId('')
    setExcelSyncResolvedDealerName('')
    setExcelSyncDialogError(null)
  }, [])

  useEffect(() => {
    if (!isExcelSyncDialogOpen) {
      return
    }

    if (excelSyncSalesRepInput.trim()) {
      return
    }

    if (!excelSyncRawSalesRep.trim()) {
      return
    }

    const matchedSalesRep = resolveMatchingOption(excelSyncRawSalesRep, excelSyncSalesRepOptions)

    if (matchedSalesRep) {
      setExcelSyncSalesRepInput(matchedSalesRep)
    }
  }, [
    excelSyncRawSalesRep,
    excelSyncSalesRepInput,
    excelSyncSalesRepOptions,
    isExcelSyncDialogOpen,
  ])

  useEffect(() => {
    if (!isExcelAccountDialogOpen || excelSyncAccountMode !== 'existing') {
      return
    }

    if (excelSyncDealerSourceIdInput.trim()) {
      return
    }

    if (excelSyncDetectedAccountMatches.length !== 1) {
      return
    }

    setExcelSyncDealerSourceIdInput(excelSyncDetectedAccountMatches[0].sourceId)
  }, [
    excelSyncAccountMode,
    excelSyncDealerSourceIdInput,
    excelSyncDetectedAccountMatches,
    isExcelAccountDialogOpen,
  ])

  useEffect(() => {
    if (!isExcelAccountDialogOpen || excelSyncAccountMode !== 'create') {
      return
    }

    if (excelSyncNewDealerNameInput.trim()) {
      return
    }

    if (!excelSyncAccountCandidateName) {
      return
    }

    setExcelSyncNewDealerNameInput(excelSyncAccountCandidateName)
  }, [
    excelSyncAccountCandidateName,
    excelSyncAccountMode,
    excelSyncNewDealerNameInput,
    isExcelAccountDialogOpen,
  ])

  const handleRefresh = useCallback(async () => {
    setErrorMessage(null)

    await Promise.all([
      dealersQuery.refetch(),
      quotesQuery.refetch(),
      ordersQuery.refetch(),
    ])
  }, [dealersQuery, ordersQuery, quotesQuery])

  const handleExcelQuoteSyncUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSyncingExcelQuote(true)

    try {
      const excelPayload = await parseExcelQuoteForSync(file)
      const quoteNumberFromExcel = String(excelPayload.quoteNumber ?? '').trim()

      const lookupResult = await fetchCrmExcelQuoteLookup(quoteNumberFromExcel)
      const isMissingFromConcept = !lookupResult.found
      setExcelSyncLookupResult(lookupResult)

      const salesRepFromExcel = String(excelPayload.salesRep ?? '').trim()
      const defaultSalesRep = resolveMatchingOption(salesRepFromExcel, excelSyncSalesRepOptions)
      const accountNameFromExcel = String(excelPayload.companyName ?? '').trim()
      const matchedDealers = accountNameFromExcel
        ? findMatchingDealersByName(dealers, accountNameFromExcel)
        : []

      setExcelSyncDraft(excelPayload)
      setExcelSyncSourceFileName(file.name)
      setExcelSyncQuoteNumberInput(quoteNumberFromExcel)
      setExcelSyncRawSalesRep(salesRepFromExcel)
      setExcelSyncSalesRepInput(defaultSalesRep)
      setExcelSyncDealerStateCode('')
      setExcelSyncProjectTypeInput(resolveDefaultExcelProjectType(excelPayload.projectType))
      setExcelSyncNewDealerNameInput(accountNameFromExcel)
      setExcelSyncResolvedDealerSourceId('')
      setExcelSyncResolvedDealerName('')

      if (matchedDealers.length === 1) {
        setExcelSyncAccountMode('existing')
        setExcelSyncDealerSourceIdInput(matchedDealers[0].sourceId)
      } else if (matchedDealers.length > 1) {
        setExcelSyncAccountMode('existing')
        setExcelSyncDealerSourceIdInput('')
      } else if (accountNameFromExcel) {
        setExcelSyncAccountMode('create')
        setExcelSyncDealerSourceIdInput('')
      } else {
        setExcelSyncAccountMode('existing')
        setExcelSyncDealerSourceIdInput('')
      }

      setExcelSyncDialogError(null)

      if (isMissingFromConcept) {
        setExcelSyncAllowCreateWhenMissingConcept(true)
        setIsExcelMissingConceptDialogOpen(true)
      } else {
        setExcelSyncAllowCreateWhenMissingConcept(false)
        setIsExcelAccountDialogOpen(true)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to sync quote file.')
    } finally {
      setIsSyncingExcelQuote(false)
    }
  }, [dealers, excelSyncSalesRepOptions])

  const handleCancelExcelSyncDialog = useCallback(() => {
    if (isSyncingExcelQuote) {
      return
    }

    resetExcelSyncDialog()
  }, [isSyncingExcelQuote, resetExcelSyncDialog])

  const handleRequestCloseExcelSyncDialog = useCallback(() => {
    if (isSyncingExcelQuote) {
      return
    }

    const confirmedDiscard = window.confirm('Are you sure you want to leave without saving?')

    if (!confirmedDiscard) {
      return
    }

    resetExcelSyncDialog()
  }, [isSyncingExcelQuote, resetExcelSyncDialog])

  const handleConfirmExcelAccountDialog = useCallback(async () => {
    if (!excelSyncDraft) {
      return
    }

    const selectedDealerSourceId = excelSyncDealerSourceIdInput.trim()
    const newDealerName = excelSyncNewDealerNameInput.trim()

    if (excelSyncAccountMode === 'existing') {
      if (!selectedDealerSourceId) {
        setExcelSyncDialogError('Select an Account from the detected matches or search results before continuing.')
        return
      }

      const selectedDealer = dealersBySourceId.get(selectedDealerSourceId)
      const selectedDealerStateCode = resolveUsStateCodeFromInput(selectedDealer?.state)

      setExcelSyncResolvedDealerSourceId(selectedDealerSourceId)
      setExcelSyncResolvedDealerName(String(selectedDealer?.name || selectedDealerSourceId).trim())
      setExcelSyncDealerStateCode(selectedDealerStateCode)
      setExcelSyncDialogError(null)
      setIsExcelAccountDialogOpen(false)
      setIsExcelSyncDialogOpen(true)
      return
    }

    if (!newDealerName) {
      setExcelSyncDialogError('Enter a new Account Name before continuing.')
      return
    }

    setExcelSyncDialogError(null)
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSyncingExcelQuote(true)

    try {
      const createdDealerResponse = await createCrmDealer({
        name: newDealerName,
        accountType: 'dealer',
      })
      const createdDealer = createdDealerResponse?.dealer
      const createdDealerSourceId = String(createdDealer?.sourceId ?? '').trim()
      const createdDealerName = String(createdDealer?.name ?? '').trim() || newDealerName
      const createdDealerStateCode = resolveUsStateCodeFromInput(createdDealer?.state)

      if (!createdDealerSourceId) {
        throw new Error('Created account did not return a source id.')
      }

      setExcelSyncDealerSourceIdInput(createdDealerSourceId)
      setExcelSyncResolvedDealerSourceId(createdDealerSourceId)
      setExcelSyncResolvedDealerName(createdDealerName)
      setExcelSyncDealerStateCode(createdDealerStateCode)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesDealers }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDealers }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmPageBootstrap }),
      ])

      setIsExcelAccountDialogOpen(false)
      setIsExcelSyncDialogOpen(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create account.')
    } finally {
      setIsSyncingExcelQuote(false)
    }
  }, [
    dealersBySourceId,
    excelSyncAccountMode,
    excelSyncDealerSourceIdInput,
    excelSyncDraft,
    excelSyncNewDealerNameInput,
    queryClient,
  ])

  const handleBackToExcelAccountDialog = useCallback(() => {
    if (isSyncingExcelQuote) {
      return
    }

    setExcelSyncDialogError(null)
    setIsExcelSyncDialogOpen(false)
    setIsExcelAccountDialogOpen(true)
  }, [isSyncingExcelQuote])

  const handleConfirmExcelQuoteSync = useCallback(async () => {
    if (!excelSyncDraft) {
      return
    }

    const quoteNumber = excelSyncQuoteNumberInput.trim()

    if (!quoteNumber) {
      setExcelSyncDialogError('Quote number is required.')
      return
    }

    const selectedSalesRep = resolveMatchingOption(excelSyncSalesRepInput, excelSyncSalesRepOptions)

    if (!selectedSalesRep) {
      setExcelSyncDialogError('Select a Sales Rep from the dropdown before syncing.')
      return
    }

    const dealerStateCode = excelSyncDealerStateCode.trim().toUpperCase()

    if (!usStateCodeSet.has(dealerStateCode)) {
      setExcelSyncDialogError('Select a valid Dealer State from the dropdown before syncing.')
      return
    }

    const projectTypeInput = excelSyncProjectTypeInput.trim()

    if (!isExcelSyncProjectTypeOption(projectTypeInput)) {
      setExcelSyncDialogError('Select a Project Type from the dropdown before syncing.')
      return
    }

    const resolvedDealerSourceId = excelSyncResolvedDealerSourceId.trim()

    if (!resolvedDealerSourceId) {
      setExcelSyncDialogError('Select an Account in step 1 before syncing.')
      return
    }

    setExcelSyncDialogError(null)
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSyncingExcelQuote(true)

    try {
      const dealerFromMap = dealersBySourceId.get(resolvedDealerSourceId)
      const resolvedCompanyName = String(
        excelSyncResolvedDealerName
        || dealerFromMap?.name
        || excelSyncDraft.companyName
        || '',
      ).trim()

      const syncInput: CrmExcelQuoteSyncInput = {
        ...excelSyncDraft,
        allowCreateWhenMissingConcept: excelSyncAllowCreateWhenMissingConcept,
        quoteNumber,
        salesRep: selectedSalesRep,
        dealerState: dealerStateCode,
        projectType: projectTypeInput,
      }

      if (resolvedCompanyName) {
        syncInput.companyName = resolvedCompanyName
      }

      const lookupQuoteId = String(excelSyncLookupResult?.id || '').trim()
      const normalizedQuoteNumber = normalizeMatchValue(quoteNumber)

      const targetQuote = (
        (lookupQuoteId ? quotes.find((entry) => entry.id === lookupQuoteId) : null)
        || quotes.find((entry) => normalizeMatchValue(entry.quoteNumber) === normalizedQuoteNumber)
        || null
      )

      if (targetQuote) {
        const baseFormState = createOpportunityDetailsFormState(targetQuote)
        const stagedFormState = mergeExcelSyncIntoDetailsFormState(baseFormState, syncInput, {
          dealerSourceId: resolvedDealerSourceId,
          companyName: resolvedCompanyName,
        })
        const targetStage = resolveOpportunityStage(targetQuote)

        setSelectedOpportunity(targetQuote)
        setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(baseFormState))
        setOpportunityDetailsFormState(stagedFormState)
        setPendingExcelSyncPromotionQuoteId(targetStage === 'concept' ? targetQuote.id : null)
        resetExcelSyncDialog()
        setSuccessMessage(
          targetStage === 'concept'
            ? `Excel data loaded for ${quoteNumber}. Review and click Save Changes to move it to Proposal Submitted.`
            : `Excel data loaded for ${quoteNumber}. Review and click Save Changes to apply.`,
        )
        return
      }

      if (excelSyncAllowCreateWhenMissingConcept) {
        const baseFormState = createEmptyOpportunityForm()
        const stagedLineItems = Array.isArray(syncInput.lineItems) && syncInput.lineItems.length > 0
          ? mapQuoteLineItemsToFormState(syncInput.lineItems)
          : baseFormState.lineItems

        setFormState({
          ...baseFormState,
          dealerSourceId: resolvedDealerSourceId,
          quoteNumber,
          title: String(syncInput.title ?? '').trim(),
          opportunityDateInput: syncInput.opportunityDate
            ? resolveDateInputFromIso(syncInput.opportunityDate)
            : baseFormState.opportunityDateInput,
          companyName: resolvedCompanyName || String(syncInput.companyName ?? '').trim(),
          contactName: String(syncInput.contactName ?? '').trim(),
          contactEmail: String(syncInput.contactEmail ?? '').trim(),
          contactPhone: String(syncInput.contactPhone ?? '').trim(),
          salesRep: selectedSalesRep,
          leadTime: String(syncInput.leadTime ?? '').trim(),
          paymentTerms: String(syncInput.paymentTerms ?? '').trim(),
          subtotal: syncInput.subtotal === null || syncInput.subtotal === undefined
            ? ''
            : String(syncInput.subtotal),
          freight: syncInput.freight === null || syncInput.freight === undefined
            ? ''
            : String(syncInput.freight),
          freightDescription: String(syncInput.freightDescription ?? '').trim(),
          lineItems: stagedLineItems,
          quoteDocumentUrl: '',
          quoteDocumentName: '',
        })
        setPendingExcelSyncPromotionQuoteId(null)
        setIsAddDialogDraftFromExcelSync(true)
        setAddDialogInitialSnapshot(serializeOpportunityFormState(baseFormState))
        setShowAddDetails(true)
        setIsDialogOpen(true)
        resetExcelSyncDialog()
        setSuccessMessage(`Excel data loaded for ${quoteNumber}. Review and click Create In Proposal Submitted to save.`)
        return
      }

      setErrorMessage('Could not find a matching concept opportunity for this quote. Use Continue for missing concept to stage a new opportunity draft.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to sync quote file.')
    } finally {
      setIsSyncingExcelQuote(false)
    }
  }, [
    dealersBySourceId,
    excelSyncDealerStateCode,
    excelSyncDraft,
    excelSyncLookupResult,
    excelSyncAllowCreateWhenMissingConcept,
    excelSyncProjectTypeInput,
    excelSyncQuoteNumberInput,
    excelSyncResolvedDealerName,
    excelSyncResolvedDealerSourceId,
    excelSyncSalesRepInput,
    excelSyncSalesRepOptions,
    quotes,
    resetExcelSyncDialog,
  ])

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

    try {
      const nextDocument = await uploadSelectedOpportunityDocumentFile(selectedOpportunity, file)
      setOpportunityDetailsFormState((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          documents: [...current.documents, nextDocument],
        }
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add document.')
    } finally {
      setIsUploadingSelectedOpportunityDocument(false)
    }
  }, [selectedOpportunity, uploadSelectedOpportunityDocumentFile])

  const handleRemoveSelectedOpportunityDocument = useCallback(async (documentUrl: string) => {
    const confirmed = window.confirm('Remove this document from the opportunity?')

    if (!confirmed) {
      return
    }

    setOpportunityDetailsFormState((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        documents: current.documents.filter((entry) => entry.url !== documentUrl),
      }
    })
  }, [])

  const handleSendSelectedOpportunityChat = useCallback(async () => {
    const nextMessage = selectedOpportunityChatDraft.trim()

    if (!selectedOpportunityId || !nextMessage) {
      return
    }

    if (!canManage) {
      setErrorMessage('You do not have permission to post quote chat messages.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSendingSelectedOpportunityChat(true)

    try {
      await createCrmQuoteChatMessage(selectedOpportunityId, nextMessage)
      setSelectedOpportunityChatDraft('')
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(selectedOpportunityId) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send quote chat message.')
    } finally {
      setIsSendingSelectedOpportunityChat(false)
    }
  }, [
    canManage,
    queryClient,
    selectedOpportunityChatDraft,
    selectedOpportunityId,
  ])

  const canManageSelectedOpportunityChatMessage = useCallback((message: CrmQuoteChatMessage) => {
    if (isCurrentUserAdmin) {
      return true
    }

    const createdByUid = String(message.createdByUid ?? '').trim()
    const createdByEmail = String(message.createdByEmail ?? '').trim().toLowerCase()

    return Boolean(
      (currentUserUid && createdByUid && currentUserUid === createdByUid)
      || (currentUserEmail && createdByEmail && currentUserEmail === createdByEmail),
    )
  }, [currentUserEmail, currentUserUid, isCurrentUserAdmin])

  const handleDeleteSelectedOpportunityChatMessage = useCallback(async (messageId: string) => {
    if (!selectedOpportunityId || !messageId) {
      return
    }

    if (!window.confirm('Delete this chat message?')) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setDeletingSelectedOpportunityChatMessageId(messageId)

    try {
      await removeCrmQuoteChatMessage(selectedOpportunityId, messageId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(selectedOpportunityId) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete quote chat message.')
    } finally {
      setDeletingSelectedOpportunityChatMessageId('')
    }
  }, [queryClient, selectedOpportunityId])

  const handleOpenDialog = useCallback(() => {
    const emptyFormState = createEmptyOpportunityForm()

    setErrorMessage(null)
    setSuccessMessage(null)
    setFormState(emptyFormState)
    setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
    setIsAddDialogDraftFromExcelSync(false)
    setPendingExcelSyncPromotionQuoteId(null)
    setShowAddDetails(false)
    setIsDialogOpen(true)
  }, [])

  const handleOpenOpportunityDetails = useCallback((quote: CrmQuote, initialTab: OpportunityDetailsTab = 'details') => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setDetailsActionMenuAnchorEl(null)
    const nextFormState = createOpportunityDetailsFormState(quote)
    setSelectedOpportunityChatDraft('')
    setDeletingSelectedOpportunityChatMessageId('')
    setSelectedOpportunityDetailsTab(initialTab)
    setSelectedOpportunity(quote)
    setOpportunityDetailsFormState(nextFormState)
    setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
    setPendingExcelSyncPromotionQuoteId(null)
  }, [])

  const handleOpenOpportunityChat = useCallback((quote: CrmQuote) => {
    handleOpenOpportunityDetails(quote, 'chat')
  }, [handleOpenOpportunityDetails])

  const handleCloseDialog = useCallback(() => {
    if (isSavingOpportunity || isUploadingQuoteDocument) {
      return
    }

    if (isAddDialogDirty) {
      const confirmedDiscard = window.confirm('Are you sure you want to leave without saving?')

      if (!confirmedDiscard) {
        return
      }
    }

    const emptyFormState = createEmptyOpportunityForm()

    setFormState(emptyFormState)
    setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
    setIsAddDialogDraftFromExcelSync(false)
    setIsDialogOpen(false)
    setShowAddDetails(false)
  }, [isAddDialogDirty, isSavingOpportunity, isUploadingQuoteDocument])

  const handleCloseOpportunityDetails = useCallback(() => {
    if (isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat) {
      return
    }

    if (isOpportunityDetailsDirty) {
      const confirmedDiscard = window.confirm('Are you sure you want to leave without saving?')

      if (!confirmedDiscard) {
        return
      }
    }

    setDetailsActionMenuAnchorEl(null)
    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
    setOpportunityDetailsInitialSnapshot('')
    setSelectedOpportunityDetailsTab('details')
    setSelectedOpportunityChatDraft('')
    setPendingExcelSyncPromotionQuoteId(null)
  }, [
    isSendingSelectedOpportunityChat,
    isOpportunityDetailsDirty,
    isSavingOpportunityDetails,
    isUploadingSelectedOpportunityDocument,
  ])

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
    const targetStage: CrmOpportunityStage = isAddDialogDraftFromExcelSync ? 'proposal_submission' : 'concept'
    const targetStatus = isAddDialogDraftFromExcelSync ? 'sent' : 'draft'
    const sentAt = isAddDialogDraftFromExcelSync ? new Date().toISOString() : null

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunity(true)

    try {
      const quoteDocumentUrl = formState.quoteDocumentUrl.trim()
      const quoteDocumentName = formState.quoteDocumentName.trim()

      await createCrmQuote({
        dealerSourceId: formState.dealerSourceId.trim() || null,
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
        status: targetStatus,
        opportunityStage: targetStage,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        totalAmount,
        sentAt,
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

      const emptyFormState = createEmptyOpportunityForm()

      setSuccessMessage(
        isAddDialogDraftFromExcelSync
          ? 'Opportunity created in Proposal Submitted stage.'
          : 'Opportunity created in Concept stage.',
      )
      setFormState(emptyFormState)
      setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
      setIsAddDialogDraftFromExcelSync(false)
      setPendingExcelSyncPromotionQuoteId(null)
      setShowAddDetails(false)
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
    formState.dealerSourceId,
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
    isAddDialogDraftFromExcelSync,
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

  const handleDeclineQuote = useCallback(async (quote: CrmQuote) => {
    const confirmed = window.confirm(`Mark ${quote.quoteNumber || quote.title} as declined?`)

    if (!confirmed) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(quote.id)

    try {
      await updateCrmQuote(quote.id, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      })
      await invalidateOpportunityData()
      setSuccessMessage('Opportunity marked as declined.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to mark opportunity as declined.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [invalidateOpportunityData])

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

  const handleSaveOpportunityDetails = useCallback(async (mode: OpportunityDetailsSaveMode = 'save') => {
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

    const quoteLabel = quoteNumber || selectedOpportunity.quoteNumber || selectedOpportunity.title

    if (mode === 'decline') {
      const confirmedDecline = window.confirm(`Mark ${quoteLabel} as declined?`)

      if (!confirmedDecline) {
        return
      }
    }

    if (mode === 'convert_to_order') {
      const confirmedConvert = window.confirm(`Convert ${quoteLabel} to order placement?`)

      if (!confirmedConvert) {
        return
      }
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunityDetails(true)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      const selectedDealerSourceId = opportunityDetailsFormState.dealerSourceId.trim()
      const detailsPayload = {
        ...(selectedDealerSourceId ? { dealerSourceId: selectedDealerSourceId } : {}),
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
        documents: opportunityDetailsFormState.documents,
        totalAmount,
        notes: opportunityDetailsFormState.notes.trim() || null,
      }

      if (mode === 'save') {
        const selectedOpportunityStage = resolveOpportunityStage(selectedOpportunity)
        const shouldPromoteFromExcelSync = (
          pendingExcelSyncPromotionQuoteId === selectedOpportunity.id
          && selectedOpportunityStage === 'concept'
        )

        if (shouldPromoteFromExcelSync) {
          await updateCrmQuote(selectedOpportunity.id, {
            ...detailsPayload,
            opportunityStage: 'proposal_submission',
            status: 'sent',
            sentAt: new Date().toISOString(),
          })
          setSuccessMessage('Opportunity updated and moved to Proposal Submitted.')
        } else if (selectedOpportunityStage === 'proposal_submission') {
          await updateCrmQuote(selectedOpportunity.id, {
            ...detailsPayload,
            opportunityStage: 'revision',
            status: 'draft',
          })
          setSuccessMessage('Opportunity updated and moved to Revision.')
        } else {
          await updateCrmQuote(selectedOpportunity.id, detailsPayload)
          setSuccessMessage('Opportunity updated.')
        }
      } else if (mode === 'decline') {
        await updateCrmQuote(selectedOpportunity.id, {
          ...detailsPayload,
          status: 'rejected',
          rejectedAt: new Date().toISOString(),
        })
        setSuccessMessage('Opportunity updated and marked as declined.')
      } else {
        await updateCrmQuote(selectedOpportunity.id, detailsPayload)

        const quoteForOrder: CrmQuote = {
          ...selectedOpportunity,
          ...detailsPayload,
          title,
          totalAmount,
          quoteNumber: quoteNumber || null,
        }

        await createOrderFromQuote(quoteForOrder, orders)
        setSuccessMessage('Opportunity updated and converted to order placement.')
      }

      await invalidateOpportunityData()
      setDetailsActionMenuAnchorEl(null)
        setPendingExcelSyncPromotionQuoteId(null)
      setSelectedOpportunity(null)
      setOpportunityDetailsFormState(null)
      setOpportunityDetailsInitialSnapshot('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update opportunity.')
    } finally {
      setIsSavingOpportunityDetails(false)
      setBusyQuoteId(null)
    }
  }, [
    createOrderFromQuote,
    invalidateOpportunityData,
    opportunityDetailsFormState,
    orders,
    pendingExcelSyncPromotionQuoteId,
    selectedOpportunity,
  ])

  if (isLoading) {
    return <LoadingPanel loading message="Fetching pipeline opportunities..." />
  }

  return (
    <Stack spacing={1.75}>
      <StatusAlerts
        errorMessage={errorMessage || (queryError instanceof Error ? queryError.message : null)}
        successMessage={successMessage}
      />

      <Dialog
        open={isExcelMissingConceptDialogOpen}
        onClose={handleRequestCloseExcelSyncDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Quote Not Found In Concept</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 0.6 }}>
            <Typography variant="body2">
              Quote number <strong>{excelSyncQuoteNumberInput || 'N/A'}</strong> was not found in Concept.
            </Typography>
            <Typography variant="body2">
              Are you sure you want to continue and create it directly from this uploaded file?
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={resetExcelSyncDialog}
            disabled={isSyncingExcelQuote}
          >
            No
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setIsExcelMissingConceptDialogOpen(false)
              setIsExcelAccountDialogOpen(true)
            }}
            disabled={isSyncingExcelQuote}
          >
            Yes, Continue
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isExcelAccountDialogOpen}
        onClose={handleRequestCloseExcelSyncDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Step 1: Match Account</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ mt: 0.6 }}>
            <Typography variant="body2">
              Detected account from Excel: <strong>{excelSyncAccountCandidateName || 'No company name detected'}</strong>
            </Typography>

            {excelSyncDetectedAccountMatches.length > 0 ? (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Matching accounts detected. Click the correct one.
                </Typography>
                <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                  {excelSyncDetectedAccountMatches.map((dealer) => {
                    const isSelected = excelSyncDealerSourceIdInput === dealer.sourceId

                    return (
                      <Chip
                        key={dealer.sourceId}
                        clickable
                        color={isSelected ? 'primary' : 'default'}
                        variant={isSelected ? 'filled' : 'outlined'}
                        label={resolveDealerSelectionLabel(dealer)}
                        onClick={() => {
                          setExcelSyncAccountMode('existing')
                          setExcelSyncDealerSourceIdInput(dealer.sourceId)
                        }}
                        sx={{ maxWidth: '100%' }}
                      />
                    )
                  })}
                </Stack>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                No direct account name match found. Select one manually or create a new account.
              </Typography>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
              <Chip
                clickable
                color={excelSyncAccountMode === 'existing' ? 'primary' : 'default'}
                variant={excelSyncAccountMode === 'existing' ? 'filled' : 'outlined'}
                label="Select Existing Account"
                onClick={() => {
                  setExcelSyncAccountMode('existing')
                }}
              />
              <Chip
                clickable
                color={excelSyncAccountMode === 'create' ? 'primary' : 'default'}
                variant={excelSyncAccountMode === 'create' ? 'filled' : 'outlined'}
                label="Create New Account"
                onClick={() => {
                  setExcelSyncAccountMode('create')

                  if (!excelSyncNewDealerNameInput.trim()) {
                    setExcelSyncNewDealerNameInput(excelSyncAccountCandidateName)
                  }
                }}
              />
            </Stack>

            {excelSyncAccountMode === 'existing' ? (
              <Autocomplete
                options={excelSyncDealerOptions}
                value={selectedExcelSyncDealer}
                onChange={(_event, value) => {
                  setExcelSyncDealerSourceIdInput(value?.sourceId || '')
                }}
                isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                getOptionLabel={(option) => resolveDealerSelectionLabel(option)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Account"
                    required
                    error={excelSyncDialogError === 'Select an Account from the detected matches or search results before continuing.'}
                    helperText="Choose from detected matches above or search all accounts."
                  />
                )}
              />
            ) : (
              <TextField
                label="New Account Name"
                required
                value={excelSyncNewDealerNameInput}
                onChange={(event) => {
                  setExcelSyncNewDealerNameInput(event.target.value)
                }}
                error={excelSyncDialogError === 'Enter a new Account Name before continuing.'}
                helperText="Creates a new account now with just the account name."
              />
            )}

            {excelSyncDialogError ? (
              <Typography variant="caption" color="error">
                {excelSyncDialogError}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCancelExcelSyncDialog}
            disabled={isSyncingExcelQuote}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleConfirmExcelAccountDialog()
            }}
            disabled={!canManage || !excelSyncDraft || isSyncingExcelQuote}
          >
            {isSyncingExcelQuote ? 'Saving Account...' : 'Continue'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isExcelSyncDialogOpen}
        onClose={handleRequestCloseExcelSyncDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Step 2: Review Quote Sync</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ mt: 0.6 }}>
            {excelSyncAllowCreateWhenMissingConcept ? (
              <Typography variant="caption" color="warning.main">
                This quote will be created directly from the uploaded file because it was not found in Concept.
              </Typography>
            ) : null}

            {excelSyncSourceFileName ? (
              <Typography variant="caption" color="text.secondary">
                File: {excelSyncSourceFileName}
              </Typography>
            ) : null}

            <Stack spacing={0.55}>
              <TextField
                label="Linked Account"
                value={excelSyncResolvedDealerName || excelSyncResolvedDealerSourceId}
                InputProps={{ readOnly: true }}
                helperText="Selected in step 1."
              />
              <Button
                size="small"
                onClick={handleBackToExcelAccountDialog}
                disabled={isSyncingExcelQuote}
                sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
              >
                Change account
              </Button>
            </Stack>

            <TextField
              label="Quote Number"
              required
              autoFocus
              value={excelSyncQuoteNumberInput}
              onChange={(event) => {
                setExcelSyncQuoteNumberInput(event.target.value)
              }}
              error={excelSyncDialogError === 'Quote number is required.'}
              helperText="Loaded from uploaded file and editable before sync."
            />

            <Autocomplete
              options={excelSyncSalesRepOptions}
              value={excelSyncSalesRepInput || null}
              onChange={(_event, value) => {
                setExcelSyncSalesRepInput(value || '')
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Sales Rep"
                  required
                  error={
                    excelSyncDialogError === 'Select a Sales Rep from the dropdown before syncing.'
                    || (Boolean(unrecognizedExcelSalesRep) && !excelSyncSalesRepInput.trim())
                  }
                  helperText={
                    Boolean(unrecognizedExcelSalesRep) && !excelSyncSalesRepInput.trim()
                      ? `Uploaded value "${unrecognizedExcelSalesRep}" was not recognized. Pick one from this dropdown.`
                      : 'Choose one of your Sales Reps or House.'
                  }
                />
              )}
            />

            <Autocomplete
              options={usStateOptions}
              value={usStateOptionByCode.get(excelSyncDealerStateCode) || null}
              onChange={(_event, value) => {
                setExcelSyncDealerStateCode(value?.code || '')
              }}
              isOptionEqualToValue={(option, value) => option.code === value.code}
              getOptionLabel={(option) => option.label}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Dealer State"
                  required
                  error={excelSyncDialogError === 'Select a valid Dealer State from the dropdown before syncing.'}
                  helperText="Defaults from linked account when available. You can change it here."
                />
              )}
            />

            <Autocomplete
              options={excelSyncProjectTypeOptions}
              value={isExcelSyncProjectTypeOption(excelSyncProjectTypeInput) ? excelSyncProjectTypeInput : null}
              onChange={(_event, value) => {
                setExcelSyncProjectTypeInput(value || '')
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Project Type"
                  required
                  error={excelSyncDialogError === 'Select a Project Type from the dropdown before syncing.'}
                  helperText={'Auto-fills when Excel title clearly matches. "Other" is manual-only.'}
                />
              )}
            />

            {excelSyncDialogError ? (
              <Typography variant="caption" color="error">
                {excelSyncDialogError}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCancelExcelSyncDialog}
            disabled={isSyncingExcelQuote}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleConfirmExcelQuoteSync()
            }}
            disabled={!canManage || !excelSyncDraft || isSyncingExcelQuote}
          >
            {isSyncingExcelQuote ? 'Syncing Excel...' : 'Sync Now'}
          </Button>
        </DialogActions>
      </Dialog>

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
              Concept - Proposal - Revision.
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
              component="label"
              variant="outlined"
              color="inherit"
              startIcon={<FileUploadRoundedIcon fontSize="small" />}
              disabled={!canManage || isSyncingExcelQuote}
            >
              {isSyncingExcelQuote ? 'Syncing File...' : 'Sync Quote File'}
              <input
                hidden
                type="file"
                accept=".xls,.xlsx,.xlsm,.ods,.csv"
                onChange={handleExcelQuoteSyncUpload}
              />
            </Button>
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
            gap: 1.1,
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
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
              onAdvanceStage={handleAdvanceStage}
              onMarkApproved={handleMarkApproved}
              onDeclineQuote={handleDeclineQuote}
              onDeleteQuote={handleDeleteQuote}
              onOpenDetails={handleOpenOpportunityDetails}
              onOpenChat={handleOpenOpportunityChat}
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
              helperText={
                isAddDialogDraftFromExcelSync
                  ? 'This synced quote will save directly to Proposal Submitted.'
                  : 'Enter the quote number to start a Concept. The rest fills in automatically when you sync from the Excel quote.'
              }
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
            {isSavingOpportunity
              ? 'Creating...'
              : (isAddDialogDraftFromExcelSync ? 'Create In Proposal Submitted' : 'Create Opportunity')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedOpportunity && opportunityDetailsFormState)}
        onClose={handleCloseOpportunityDetails}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2.5,
            overflow: 'hidden',
            minHeight: { md: '84vh' },
            maxHeight: '92vh',
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            py: 1.6,
            px: 2,
            color: '#0b2239',
            background: `linear-gradient(135deg, ${alpha('#0f4c81', 0.16)} 0%, ${alpha('#0f4c81', 0.08)} 100%)`,
          }}
        >
          <Stack spacing={0.15}>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.1 }}>
              Opportunity Details
            </Typography>
            <Typography variant="caption" sx={{ color: alpha('#0b2239', 0.78) }}>
              Make updates and click Save Changes to keep them.
            </Typography>
          </Stack>
          {canUseProposalDetailsActions ? (
            <IconButton
              size="medium"
              disabled={isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat}
              onClick={(event) => {
                setDetailsActionMenuAnchorEl(event.currentTarget)
              }}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
            </IconButton>
          ) : null}
        </DialogTitle>
        <Menu
          anchorEl={detailsActionMenuAnchorEl}
          open={isDetailsActionMenuOpen}
          onClose={() => {
            setDetailsActionMenuAnchorEl(null)
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            disabled={!canUseProposalDetailsActions || isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat}
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              void handleSaveOpportunityDetails('decline')
            }}
          >
            Declined
          </MenuItem>
          <MenuItem
            disabled={!canUseProposalDetailsActions || isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat}
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              void handleSaveOpportunityDetails('convert_to_order')
            }}
          >
            Convert to order
          </MenuItem>
          <MenuItem
            disabled={!canUseProposalDetailsActions || isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat}
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              void handleSaveOpportunityDetails('save')
            }}
          >
            Save
          </MenuItem>
        </Menu>
        <DialogContent
          dividers
          sx={{
            px: { xs: 1.5, sm: 2.2 },
            py: 1.5,
            backgroundColor: '#f5f8fc',
          }}
        >
          {selectedOpportunity && opportunityDetailsFormState ? (
            <Stack spacing={2} sx={{ mt: 0.2 }}>
              <Tabs
                value={selectedOpportunityDetailsTab}
                onChange={(_event, nextValue: OpportunityDetailsTab) => {
                  setSelectedOpportunityDetailsTab(nextValue)
                }}
                variant="fullWidth"
                sx={{
                  minHeight: 40,
                  '& .MuiTab-root': {
                    minHeight: 40,
                    textTransform: 'none',
                    fontWeight: 700,
                  },
                }}
              >
                <Tab value="details" label="Details" />
                <Tab
                  value="chat"
                  label={selectedOpportunityChatCount > 0 ? `Chat (${selectedOpportunityChatCount})` : 'Chat'}
                />
              </Tabs>

              {selectedOpportunityDetailsTab === 'details' ? (
                <>
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
                <Box
                  sx={{
                    px: 1.2,
                    py: 1,
                    borderRadius: 1,
                    border: `1px solid ${alpha('#0f4c81', 0.2)}`,
                    backgroundColor: '#ffffff',
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
                </Box>
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
                      <Box
                        key={document.url}
                        sx={{
                          px: 1,
                          py: 0.45,
                          borderBottom: `1px solid ${alpha('#0f4c81', 0.18)}`,
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
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>

                </>
              ) : null}

              {selectedOpportunityDetailsTab === 'chat' ? (

              <Stack spacing={0.8}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Quote Chat
                </Typography>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    borderColor: alpha('#0f4c81', 0.22),
                    backgroundColor: '#ffffff',
                    maxHeight: 260,
                    overflowY: 'auto',
                  }}
                >
                  {selectedOpportunityChatsQuery.isLoading ? (
                    <Typography variant="caption" color="text.secondary">
                      Loading chat...
                    </Typography>
                  ) : selectedOpportunityChatMessages.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No messages yet.
                    </Typography>
                  ) : (
                    <Stack spacing={0.7}>
                      {selectedOpportunityChatMessages.map((message) => {
                        const canDeleteMessage = canManageSelectedOpportunityChatMessage(message)
                        const isDeletingMessage = deletingSelectedOpportunityChatMessageId === message.id

                        return (
                          <Box
                            key={message.id}
                            sx={{
                              px: 0.8,
                              py: 0.65,
                              borderRadius: 0.9,
                              border: `1px solid ${alpha('#0f4c81', 0.16)}`,
                              backgroundColor: alpha('#0f4c81', 0.03),
                            }}
                          >
                            <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.2 }}>
                                {resolveQuoteChatAuthorLabel(message)} • {formatQuoteChatTimestamp(message.createdAt)}
                              </Typography>

                              {canDeleteMessage ? (
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                  disabled={isDeletingMessage}
                                  onClick={() => {
                                    void handleDeleteSelectedOpportunityChatMessage(message.id)
                                  }}
                                >
                                  {isDeletingMessage ? 'Deleting...' : 'Delete'}
                                </Button>
                              ) : null}
                            </Stack>

                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                              {String(message.message || '').trim()}
                            </Typography>
                          </Box>
                        )
                      })}
                    </Stack>
                  )}
                </Paper>

                {selectedOpportunityChatErrorMessage ? (
                  <Typography variant="caption" color="error">
                    {selectedOpportunityChatErrorMessage}
                  </Typography>
                ) : null}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
                  <TextField
                    label="New message"
                    value={selectedOpportunityChatDraft}
                    onChange={(event) => {
                      setSelectedOpportunityChatDraft(event.target.value)
                    }}
                    disabled={!canManage || isSendingSelectedOpportunityChat}
                    multiline
                    minRows={2}
                    placeholder="Add a note that stays with this quote"
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => {
                      void handleSendSelectedOpportunityChat()
                    }}
                    disabled={
                      !canManage
                      || isSendingSelectedOpportunityChat
                      || selectedOpportunityChatDraft.trim().length === 0
                    }
                  >
                    {isSendingSelectedOpportunityChat ? 'Sending...' : 'Send'}
                  </Button>
                </Stack>
              </Stack>

              ) : null}

              {selectedOpportunityDetailsTab === 'details' ? (
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
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseOpportunityDetails}
            disabled={isSavingOpportunityDetails || isUploadingSelectedOpportunityDocument || isSendingSelectedOpportunityChat}
          >
            Close Without Saving
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleSaveOpportunityDetails('save')
            }}
            disabled={
              !canManage
              || isSavingOpportunityDetails
              || isUploadingSelectedOpportunityDocument
              || isSendingSelectedOpportunityChat
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
