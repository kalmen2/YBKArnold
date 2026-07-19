import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
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
  Alert,
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
  FormControlLabel,
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
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmDealer,
  convertCrmQuoteToOrder,
  createCrmQuote,
  createCrmQuoteChatMessage,
  fetchCrmConvertOrderBoards,
  fetchCrmDealers,
  fetchCrmExcelQuoteLookup,
  fetchCrmQuoteChats,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  removeCrmQuoteChatMessage,
  removeCrmQuote,
  syncCrmQuoteFromExcel,
  updateCrmQuote,
  type CrmDealer,
  type CrmConvertOrderBoardOption,
  type CrmExcelQuoteLookupResponse,
  type CrmExcelQuoteSyncInput,
  type CrmQuoteDocument,
  type CrmQuoteLineItem,
  type CrmOpportunityStage,
  type CrmQuote,
  type CrmQuoteChatMessage,
} from '../features/crm/api'
import { parseExcelQuoteForSync } from '../features/crm/excelQuoteParser'
import { resolveQuoteAgeDays } from '../features/crm/utils'
import { resolveFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { formatCurrency } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

const DEFAULT_OPPORTUNITY_TITLE_PREFIX = 'Opportunity '
const DEFAULT_NEW_ORDERS_2026_BOARD_ID = '18393945685'
const DEFAULT_DESIGN_AKF_BOARD_ID = '1064270065'

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

type OpportunityConvertOrderFormState = {
  primaryBoardId: string
  secondaryBoardId: string
  poDate: string
  poNumber: string
  leadTimeDate: string
  shipTo: string
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

type StageSortMode =
  | 'date_oldest_to_newest'
  | 'date_newest_to_oldest'
  | 'quote_number_oldest_to_newest'
  | 'quote_number_asc'
  | 'quote_number_desc'

type StageAmountCondition = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

type ExcelSyncProjectTypeOption = 'Reception Desk' | 'Courtroom' | 'Conference Table' | 'Libraries' | 'Other'
type ExcelSyncAccountMode = 'existing' | 'create' | 'none'
type ExcelSyncLaunchMode = 'excel_file' | 'folder_scan'

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

type OpportunityDetailsSaveMode = 'save' | 'decline'
type QuoteSidebarFolderKey =
  | 'client_doc'
  | 'renderings'
  | 'vendor_quotes'
  | 'quotes'
  | 'site_visits'
  | 'shop_drawings'
  | 'admin'
  | 'product_picture'
  | 'service_call'
  | 'material_estimate'
  | 'cut_list'

type QuoteSidebarFolderDefinition = {
  key: QuoteSidebarFolderKey
  label: string
}

type OpportunityDetailsTab = 'details' | 'chat' | QuoteSidebarFolderKey

type FolderScanQueueEntry = {
  id: string
  file: File
  folderKey: QuoteSidebarFolderKey
  folderLabel: string
  relativePath: string
  documentName: string
  selected: boolean
  duplicateBlocked: boolean
  duplicateReason: string | null
}

type FolderScanSidebarKey = 'all' | QuoteSidebarFolderKey

type FolderScanSidebarSection = {
  key: FolderScanSidebarKey
  label: string
  totalCount: number
  selectedCount: number
  blockedCount: number
}

type FolderScanUploadSummary = {
  uploadedCount: number
  attemptedCount: number
  failedCount: number
}

type FolderScanNestedSection = {
  path: string
  totalCount: number
  selectedCount: number
}

type QuoteNestedFolderGroup = {
  path: string
  documents: CrmQuoteDocument[]
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
]

const stageById = new Map(stageDefinitions.map((stage) => [stage.id, stage]))

const excelSyncProjectTypeOptions: ExcelSyncProjectTypeOption[] = [
  'Reception Desk',
  'Courtroom',
  'Conference Table',
  'Libraries',
  'Other',
]

const quoteSidebarFolders: QuoteSidebarFolderDefinition[] = [
  { key: 'client_doc', label: 'Client Doc' },
  { key: 'renderings', label: 'Renderings' },
  { key: 'vendor_quotes', label: 'Vendor Quotes' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'site_visits', label: 'Site Visits' },
  { key: 'shop_drawings', label: 'Shop Drawings' },
  { key: 'admin', label: 'Admin' },
  { key: 'product_picture', label: 'Product Picture' },
  { key: 'service_call', label: 'Service Call' },
  { key: 'material_estimate', label: 'Material Estimate' },
  { key: 'cut_list', label: 'Cut List' },
]

const quoteSidebarFolderByKey = new Map(quoteSidebarFolders.map((entry) => [entry.key, entry] as const))
const quoteSidebarFolderKeySet = new Set<QuoteSidebarFolderKey>(quoteSidebarFolders.map((entry) => entry.key))
const quoteSidebarFolderAliases: Record<QuoteSidebarFolderKey, string[]> = {
  client_doc: ['client doc', 'client docs', 'client', 'customer doc', 'customer docs'],
  renderings: ['renderings', 'rendering', 'renders'],
  vendor_quotes: ['vendor quotes', 'vendor quote', 'vendor'],
  quotes: ['quotes', 'quote'],
  site_visits: ['site visits', 'site visit', 'site'],
  shop_drawings: ['shop drawings', 'shop drawing', 'shop'],
  admin: ['admin', 'administration'],
  product_picture: ['product picture', 'product pictures', 'product photo', 'product photos', 'pictures'],
  service_call: ['service call', 'service calls', 'service'],
  material_estimate: ['material estimate', 'material estimates', 'materials', 'material'],
  cut_list: ['cut list', 'cut lists'],
}
const excelDocumentExtensions = new Set(['xls', 'xlsx', 'xlsm', 'ods', 'csv'])
const imagePreviewDocumentExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const officePreviewDocumentExtensions = new Set(['xls', 'xlsx', 'xlsm', 'csv', 'ods'])

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

function createEmptyConvertOrderForm(
  primaryBoardId = DEFAULT_NEW_ORDERS_2026_BOARD_ID,
  secondaryBoardId = DEFAULT_DESIGN_AKF_BOARD_ID,
): OpportunityConvertOrderFormState {
  return {
    primaryBoardId,
    secondaryBoardId,
    poDate: getTodayEasternDateInputValue(),
    poNumber: '',
    leadTimeDate: '',
    shipTo: '',
    notes: '',
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

function parseOpportunityLikeDate(value: string | null | undefined) {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return null
  }

  const isoDateMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (isoDateMatch) {
    const year = Number(isoDateMatch[1])
    const month = Number(isoDateMatch[2])
    const day = Number(isoDateMatch[3])
    const parsedDate = new Date(year, month - 1, day)

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
  }

  const parsedDate = new Date(normalizedValue)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function formatOpportunityLikeDate(value: string | null | undefined) {
  const parsedDate = parseOpportunityLikeDate(value)

  if (!parsedDate) {
    return 'N/A'
  }

  return parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function parseQuoteChatRefreshRequest(rawMessage: string): {
  messageText: string
  refreshRequested: boolean
} {
  const input = String(rawMessage || '')
  const refreshPattern = /(?:^|\s)(?:\/refresh|@refresh)[.,!?]?(?=\s|$)/gi
  const refreshRequested = refreshPattern.test(input)
  const messageText = input
    .replace(/(?:^|\s)(?:\/refresh|@refresh)[.,!?]?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    messageText,
    refreshRequested,
  }
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

function resolveQuoteNumberSortValue(quote: CrmQuote) {
  return String(quote.quoteNumber || quote.title || quote.id || '').trim()
}

function compareQuotesByQuoteNumber(left: CrmQuote, right: CrmQuote) {
  const leftValue = resolveQuoteNumberSortValue(left)
  const rightValue = resolveQuoteNumberSortValue(right)
  const sortResult = leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: 'base',
  })

  if (sortResult !== 0) {
    return sortResult
  }

  return String(left.id || '').localeCompare(String(right.id || ''))
}

function resolveQuoteDateSortTimestamp(quote: CrmQuote): number | null {
  const opportunityDate = parseOpportunityLikeDate(quote.opportunityDate)

  if (opportunityDate) {
    return opportunityDate.getTime()
  }

  return null
}

function compareQuotesByDate(left: CrmQuote, right: CrmQuote, direction: 'asc' | 'desc') {
  const leftTimestamp = resolveQuoteDateSortTimestamp(left)
  const rightTimestamp = resolveQuoteDateSortTimestamp(right)

  if (leftTimestamp === null && rightTimestamp === null) {
    return compareQuotesByQuoteNumber(left, right)
  }

  if (leftTimestamp === null) {
    return 1
  }

  if (rightTimestamp === null) {
    return -1
  }

  if (leftTimestamp !== rightTimestamp) {
    return direction === 'asc'
      ? leftTimestamp - rightTimestamp
      : rightTimestamp - leftTimestamp
  }

  return compareQuotesByQuoteNumber(left, right)
}

function normalizeFolderComparableValue(value: string | null | undefined) {
  return normalizeMatchValue(value)
    .replace(/^\d+\s*[-.)]\s*/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFolderComparableCompactValue(value: string | null | undefined) {
  return normalizeFolderComparableValue(value).replace(/\s+/g, '')
}

function folderComparableMatches(normalizedValue: string, candidateValue: string | null | undefined) {
  const normalizedCandidate = normalizeFolderComparableValue(candidateValue)

  if (!normalizedCandidate) {
    return false
  }

  if (normalizedCandidate === normalizedValue) {
    return true
  }

  const compactValue = normalizeFolderComparableCompactValue(normalizedValue)
  const compactCandidate = normalizeFolderComparableCompactValue(normalizedCandidate)

  if (!compactCandidate) {
    return false
  }

  if (compactCandidate === compactValue) {
    return true
  }

  if (compactCandidate.length < 4) {
    return false
  }

  return compactValue.startsWith(compactCandidate) || compactValue.endsWith(compactCandidate)
}

function resolveQuoteSidebarFolderKey(value: string | null | undefined): QuoteSidebarFolderKey | null {
  const normalizedValue = normalizeFolderComparableValue(value)

  if (!normalizedValue) {
    return null
  }

  for (const folder of quoteSidebarFolders) {
    if (folderComparableMatches(normalizedValue, folder.label)) {
      return folder.key
    }

    const aliases = quoteSidebarFolderAliases[folder.key] ?? []

    for (const alias of aliases) {
      if (folderComparableMatches(normalizedValue, alias)) {
        return folder.key
      }
    }
  }

  return null
}

function resolveQuoteSidebarFolderKeyFromRelativePath(relativePath: string | null | undefined): QuoteSidebarFolderKey | null {
  const normalizedPath = String(relativePath ?? '').trim()

  if (!normalizedPath) {
    return null
  }

  const segments = normalizedPath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  for (const segment of segments) {
    const folderKey = resolveQuoteSidebarFolderKey(segment)

    if (folderKey) {
      return folderKey
    }
  }

  return null
}

function parseDocumentNameMetadata(name: string | null | undefined): {
  folderKey: QuoteSidebarFolderKey | null
  plainName: string
} {
  const normalizedName = String(name ?? '').trim()

  if (!normalizedName) {
    return {
      folderKey: null,
      plainName: '',
    }
  }

  const prefixedMatch = normalizedName.match(/^\[([^\]]+)\]\s*(.+)$/)

  if (!prefixedMatch) {
    return {
      folderKey: null,
      plainName: normalizedName,
    }
  }

  const folderKey = resolveQuoteSidebarFolderKey(prefixedMatch[1])

  if (!folderKey) {
    return {
      folderKey: null,
      plainName: normalizedName,
    }
  }

  return {
    folderKey,
    plainName: String(prefixedMatch[2] ?? '').trim() || normalizedName,
  }
}

function buildDocumentNameWithFolder(folderLabel: string, fileName: string): string {
  const normalizedLabel = String(folderLabel ?? '').trim()
  const normalizedFileName = String(fileName ?? '').trim()

  if (!normalizedLabel || !normalizedFileName) {
    return normalizedFileName || normalizedLabel
  }

  return `[${normalizedLabel}] ${normalizedFileName}`
}

function resolveDocumentDisplayName(document: CrmQuoteDocument): string {
  const parsed = parseDocumentNameMetadata(document.name)

  if (parsed.plainName) {
    return parsed.plainName
  }

  const fallbackName = String(document.name ?? '').trim()

  if (fallbackName) {
    return fallbackName
  }

  return 'Open document'
}

function resolveDocumentPathSegments(document: CrmQuoteDocument): string[] {
  return resolveDocumentDisplayName(document)
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function resolveDocumentPathSegmentsForFolder(
  document: CrmQuoteDocument,
  folderKey: QuoteSidebarFolderKey | null | undefined,
): string[] {
  const segments = resolveDocumentPathSegments(document)

  if (!folderKey || segments.length === 0) {
    return segments
  }

  const firstSegmentFolderKey = resolveQuoteSidebarFolderKey(segments[0])

  if (firstSegmentFolderKey && firstSegmentFolderKey === folderKey) {
    return segments.slice(1)
  }

  return segments
}

function resolveDocumentNestedFolderPath(
  document: CrmQuoteDocument,
  folderKey: QuoteSidebarFolderKey | null | undefined = null,
): string | null {
  const segments = resolveDocumentPathSegmentsForFolder(document, folderKey)

  if (segments.length <= 1) {
    return null
  }

  return segments.slice(0, -1).join('/')
}

function resolveDocumentLeafName(
  document: CrmQuoteDocument,
  folderKey: QuoteSidebarFolderKey | null | undefined = null,
): string {
  const segments = resolveDocumentPathSegmentsForFolder(document, folderKey)

  if (segments.length === 0) {
    return resolveDocumentDisplayName(document)
  }

  return segments[segments.length - 1]
}

function buildQuoteNestedFolderGroups(
  documents: CrmQuoteDocument[],
  folderKey: QuoteSidebarFolderKey | null | undefined = null,
): QuoteNestedFolderGroup[] {
  const grouped = new Map<string, CrmQuoteDocument[]>()

  for (const document of documents) {
    const nestedFolderPath = resolveDocumentNestedFolderPath(document, folderKey)

    if (!nestedFolderPath) {
      continue
    }

    const existing = grouped.get(nestedFolderPath) ?? []
    grouped.set(nestedFolderPath, [...existing, document])
  }

  return Array.from(grouped.entries())
    .map(([path, folderDocuments]) => ({
      path,
      documents: [...folderDocuments].sort((left, right) => (
        resolveDocumentDisplayName(left).localeCompare(resolveDocumentDisplayName(right))
      )),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function resolveDocumentTypeLabel(document: CrmQuoteDocument): string {
  const displayName = resolveDocumentDisplayName(document)
  const extensionMatch = displayName.toLowerCase().match(/\.([a-z0-9]{2,8})$/)

  if (!extensionMatch) {
    return 'FILE'
  }

  return extensionMatch[1].toUpperCase()
}

function resolveDocumentFileExtension(document: CrmQuoteDocument): string {
  const displayName = resolveDocumentDisplayName(document)
  const extensionMatch = displayName.toLowerCase().match(/\.([a-z0-9]{2,8})$/)
  return extensionMatch?.[1] ?? ''
}

function resolveDocumentPreviewKind(document: CrmQuoteDocument): 'image' | 'pdf' | 'office' | 'file' {
  const extension = resolveDocumentFileExtension(document)

  if (!extension) {
    return 'file'
  }

  if (imagePreviewDocumentExtensions.has(extension)) {
    return 'image'
  }

  if (extension === 'pdf') {
    return 'pdf'
  }

  if (officePreviewDocumentExtensions.has(extension)) {
    return 'office'
  }

  return 'file'
}

function resolveDocumentPreviewSource(
  document: CrmQuoteDocument,
  previewKind: 'image' | 'pdf' | 'office' | 'file',
): string | null {
  const url = String(document.url ?? '').trim()

  if (!url) {
    return null
  }

  if (previewKind === 'image') {
    return url
  }

  if (previewKind === 'pdf') {
    return `${url}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH`
  }

  if (previewKind === 'office') {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
  }

  return null
}

function resolveDocumentFolderKey(document: CrmQuoteDocument): QuoteSidebarFolderKey {
  const parsed = parseDocumentNameMetadata(document.name)

  if (parsed.folderKey) {
    return parsed.folderKey
  }

  return 'quotes'
}

function normalizeFileNameForComparison(value: string | null | undefined) {
  return normalizeMatchValue(value)
    .replace(/\s+/g, ' ')
    .trim()
}

function resolvePathSegments(value: string | null | undefined): string[] {
  return String(value ?? '')
    .trim()
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function buildFolderScanDocumentName(relativePath: string | null | undefined, fileName: string | null | undefined) {
  const normalizedPath = String(relativePath ?? '').trim()
  const normalizedFileName = String(fileName ?? '').trim()

  if (!normalizedPath) {
    return normalizedFileName
  }

  const segments = resolvePathSegments(normalizedPath)

  if (segments.length === 0) {
    return normalizedFileName
  }

  if (segments.length === 1) {
    return segments[0]
  }

  return segments.slice(1).join('/')
}

function isExcelDocumentFileName(fileName: string | null | undefined): boolean {
  const normalizedName = String(fileName ?? '').trim()

  if (!normalizedName || !normalizedName.includes('.')) {
    return false
  }

  const extension = normalizedName.split('.').pop()?.toLowerCase() ?? ''
  return excelDocumentExtensions.has(extension)
}

function isAlwaysResyncedQuotesExcelFile(
  relativePath: string | null | undefined,
  fileName: string | null | undefined,
): boolean {
  if (!isExcelDocumentFileName(fileName)) {
    return false
  }

  const segments = resolvePathSegments(relativePath)

  if (segments.length <= 1) {
    return false
  }

  const fileSegmentIndex = segments.length - 1

  for (let index = fileSegmentIndex - 1; index >= 0; index -= 1) {
    const segmentFolderKey = resolveQuoteSidebarFolderKey(segments[index])

    if (segmentFolderKey !== 'quotes') {
      continue
    }

    return index === fileSegmentIndex - 1
  }

  return false
}

function isAlwaysResyncedQuotesExcelDocument(document: CrmQuoteDocument): boolean {
  const displayName = resolveDocumentDisplayName(document)

  if (!isExcelDocumentFileName(displayName)) {
    return false
  }

  if (resolveDocumentFolderKey(document) !== 'quotes') {
    return false
  }

  const segments = resolvePathSegments(displayName)

  if (segments.length === 0) {
    return false
  }

  const firstSegmentFolderKey = resolveQuoteSidebarFolderKey(segments[0])

  if (firstSegmentFolderKey === 'quotes') {
    return segments.length === 2
  }

  return segments.length === 1
}

function resolveFolderScanEntryPathSegments(entry: FolderScanQueueEntry): string[] {
  const segments = resolvePathSegments(entry.documentName)

  if (segments.length === 0) {
    return []
  }

  const firstFolderKey = resolveQuoteSidebarFolderKey(segments[0])

  if (firstFolderKey && firstFolderKey === entry.folderKey) {
    return segments.slice(1)
  }

  return segments
}

function resolveFolderScanEntryNestedFolderPath(entry: FolderScanQueueEntry): string | null {
  const segments = resolveFolderScanEntryPathSegments(entry)

  if (segments.length <= 1) {
    return null
  }

  return segments.slice(0, -1).join('/')
}

function buildFolderScanQueueEntriesForQuote(targetQuote: CrmQuote, scannedFiles: File[]): FolderScanQueueEntry[] {
  const existingDocuments = resolveQuoteDocuments(targetQuote)
  const existingDuplicateKeys = new Set(
    existingDocuments
      .filter((document) => !isAlwaysResyncedQuotesExcelDocument(document))
      .map((document) => `${resolveDocumentFolderKey(document)}::${normalizeFileNameForComparison(resolveDocumentDisplayName(document))}`),
  )
  const pendingDuplicateKeys = new Set<string>()
  const fallbackFolder = quoteSidebarFolderByKey.get('quotes')

  return scannedFiles.flatMap((file, index) => {
    const relativePath = String(file.webkitRelativePath || file.name).trim()
    const documentName = buildFolderScanDocumentName(relativePath, file.name)
    const folderKey = resolveQuoteSidebarFolderKeyFromRelativePath(relativePath) || 'quotes'
    const folder = quoteSidebarFolderByKey.get(folderKey) ?? fallbackFolder

    if (!folder) {
      return []
    }

    const isExcelFile = isExcelDocumentFileName(file.name)
    const isAlwaysResyncedExcel = isExcelFile && isAlwaysResyncedQuotesExcelFile(relativePath, file.name)
    const shouldEnforceDuplicateCheck = !isAlwaysResyncedExcel

    const duplicateKey = `${folderKey}::${normalizeFileNameForComparison(documentName)}`
    const duplicateExists = shouldEnforceDuplicateCheck
      && (existingDuplicateKeys.has(duplicateKey) || pendingDuplicateKeys.has(duplicateKey))

    if (duplicateExists) {
      return []
    }

    if (shouldEnforceDuplicateCheck) {
      pendingDuplicateKeys.add(duplicateKey)
    }

    return [{
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      folderKey,
      folderLabel: folder.label,
      relativePath,
      documentName,
      selected: true,
      duplicateBlocked: false,
      duplicateReason: null,
    }]
  })
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

  if (normalized.includes('libraries') || normalized.includes('library')) {
    return 'Libraries'
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

  if (explicitStage === 'revision') {
    return 'proposal_submission'
  }

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
  const quoteDateLabel = formatOpportunityLikeDate(quote.opportunityDate)
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
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                lineHeight: 1.2,
                cursor: 'pointer',
                textDecoration: 'underline',
                textDecorationColor: 'transparent',
                '&:hover': {
                  textDecorationColor: alpha('#0f4c81', 0.6),
                },
              }}
              onClick={(event) => {
                event.stopPropagation()
                onOpenDetails(quote)
              }}
            >
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

        <Stack direction="row" justifyContent="space-between" alignItems="center" onClick={preventCardClick}>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }}>
            Quote Date: {quoteDateLabel}
          </Typography>

          {canManage ? (
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
          ) : null}
        </Stack>

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
  const [sortOptionSubmenuAnchorEl, setSortOptionSubmenuAnchorEl] = useState<HTMLElement | null>(null)
  const [sortOptionSubmenuType, setSortOptionSubmenuType] = useState<'date' | 'quote_number' | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [sortMode, setSortMode] = useState<StageSortMode>('quote_number_desc')
  const [activeFilters, setActiveFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)
  const [draftFilters, setDraftFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)

  const isMenuOpen = Boolean(menuAnchorEl)
  const isSortSubmenuOpen = Boolean(sortSubmenuAnchorEl) && isMenuOpen
  const isSortOptionSubmenuOpen = Boolean(sortOptionSubmenuAnchorEl) && Boolean(sortOptionSubmenuType) && isSortSubmenuOpen

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

    if (sortMode === 'date_oldest_to_newest') {
      nextRows.sort((left, right) => compareQuotesByDate(left, right, 'asc'))
    } else if (sortMode === 'date_newest_to_oldest') {
      nextRows.sort((left, right) => compareQuotesByDate(left, right, 'desc'))
    } else if (sortMode === 'quote_number_oldest_to_newest') {
      nextRows.sort((left, right) => compareQuotesByDate(left, right, 'asc'))
    } else if (sortMode === 'quote_number_desc') {
      nextRows.sort((left, right) => compareQuotesByQuoteNumber(right, left))
    } else {
      nextRows.sort(compareQuotesByQuoteNumber)
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
    setSortOptionSubmenuAnchorEl(null)
    setSortOptionSubmenuType(null)
    setSortSubmenuAnchorEl(null)
    setMenuAnchorEl(null)
  }

  const openSortOptionSubmenu = (event: MouseEvent<HTMLElement>, submenuType: 'date' | 'quote_number') => {
    setSortOptionSubmenuAnchorEl(event.currentTarget)
    setSortOptionSubmenuType(submenuType)
  }

  const closeSortSubmenus = () => {
    setSortOptionSubmenuAnchorEl(null)
    setSortOptionSubmenuType(null)
    setSortSubmenuAnchorEl(null)
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        width: '100%',
        minWidth: 0,
        borderRadius: 2.5,
        borderColor: alpha('#0f4c81', 0.16),
        boxShadow: '0 12px 34px rgba(15, 35, 63, 0.08)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: { xs: 1.1, md: 1.35 },
          py: 0.65,
          backgroundColor: alpha(stage.panelColor, 0.4),
          borderBottom: 1,
          borderColor: alpha('#0f4c81', 0.12),
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: stage.headerColor, flexShrink: 0 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0b2239', lineHeight: 1.2 }}>
              {stage.label.replace(/^\d+\.\s*/, '')}
            </Typography>
            {activeFilterCount > 0 ? (
              <Chip
                size="small"
                label={`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}`}
                color="primary"
                variant="outlined"
                sx={{ height: 20 }}
              />
            ) : null}
          </Stack>
            <IconButton
              size="small"
              onClick={(event) => {
                setMenuAnchorEl(event.currentTarget)
              }}
              sx={{
                color: '#0f4c81',
                border: `1px solid ${alpha('#0f4c81', 0.2)}`,
                backgroundColor: alpha('#0f4c81', 0.05),
                p: 0.55,
              }}
              aria-label={`Sort and filter ${stage.label}`}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 19 }} />
            </IconButton>
        </Stack>
        <Menu
          anchorEl={menuAnchorEl}
          open={isMenuOpen}
          onClose={() => {
            closeSortSubmenus()
            setMenuAnchorEl(null)
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onClick={(event) => {
              setSortSubmenuAnchorEl(event.currentTarget)
              setSortOptionSubmenuAnchorEl(null)
              setSortOptionSubmenuType(null)
            }}
            sx={{ minWidth: 170, display: 'flex', justifyContent: 'space-between', gap: 1.5 }}
          >
            Sort by
            <ChevronRightRoundedIcon fontSize="small" />
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDraftFilters(activeFilters)
              setIsFilterDialogOpen(true)
              closeSortSubmenus()
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
              closeSortSubmenus()
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
            closeSortSubmenus()
          }}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <MenuItem
            selected={sortOptionSubmenuType === 'date'}
            onClick={(event) => {
              openSortOptionSubmenu(event, 'date')
            }}
            sx={{ minWidth: 190, display: 'flex', justifyContent: 'space-between', gap: 1.5 }}
          >
            Sort by date
            <ChevronRightRoundedIcon fontSize="small" />
          </MenuItem>
          <MenuItem
            selected={sortOptionSubmenuType === 'quote_number'}
            onClick={(event) => {
              openSortOptionSubmenu(event, 'quote_number')
            }}
            sx={{ minWidth: 190, display: 'flex', justifyContent: 'space-between', gap: 1.5 }}
          >
            Sort by quote number
            <ChevronRightRoundedIcon fontSize="small" />
          </MenuItem>
        </Menu>
        <Menu
          anchorEl={sortOptionSubmenuAnchorEl}
          open={isSortOptionSubmenuOpen}
          onClose={() => {
            setSortOptionSubmenuAnchorEl(null)
            setSortOptionSubmenuType(null)
          }}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {sortOptionSubmenuType === 'date' ? (
            <>
              <MenuItem
                selected={sortMode === 'date_oldest_to_newest'}
                onClick={() => {
                  handleSelectSortMode('date_oldest_to_newest')
                }}
              >
                Oldest to newest
              </MenuItem>
              <MenuItem
                selected={sortMode === 'date_newest_to_oldest'}
                onClick={() => {
                  handleSelectSortMode('date_newest_to_oldest')
                }}
              >
                Newest to oldest
              </MenuItem>
            </>
          ) : null}

          {sortOptionSubmenuType === 'quote_number' ? (
            <>
              <MenuItem
                selected={sortMode === 'quote_number_oldest_to_newest'}
                onClick={() => {
                  handleSelectSortMode('quote_number_oldest_to_newest')
                }}
              >
                Oldest to newest
              </MenuItem>
              <MenuItem
                selected={sortMode === 'quote_number_desc'}
                onClick={() => {
                  handleSelectSortMode('quote_number_desc')
                }}
              >
                Newest highest to lowest
              </MenuItem>
              <MenuItem
                selected={sortMode === 'quote_number_asc'}
                onClick={() => {
                  handleSelectSortMode('quote_number_asc')
                }}
              >
                Lowest to highest
              </MenuItem>
            </>
          ) : null}
        </Menu>
      </Box>

      <Box
        sx={{
          p: { xs: 1, md: 1.5 },
          height: 'clamp(620px, 78vh, 900px)',
          overflowY: 'auto',
          background: `linear-gradient(180deg, ${alpha(stage.panelColor, 0.62)} 0%, #f8fafc 100%)`,
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(3, minmax(0, 1fr))',
          },
          alignContent: 'start',
          gap: 1.15,
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
      </Box>

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

type SalesOpportunitiesPageProps = {
  detailsOnly?: boolean
}

export default function SalesOpportunitiesPage({ detailsOnly = false }: SalesOpportunitiesPageProps = {}) {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkedQuoteId = String(searchParams.get('quoteId') || '').trim()

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
  const [isUploadingFolderSelection, setIsUploadingFolderSelection] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [isConvertOrderDialogOpen, setIsConvertOrderDialogOpen] = useState(false)
  const [isSubmittingConvertOrder, setIsSubmittingConvertOrder] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [convertOrderTargetQuote, setConvertOrderTargetQuote] = useState<CrmQuote | null>(null)
  const [convertOrderFormState, setConvertOrderFormState] = useState<OpportunityConvertOrderFormState>(() => (
    createEmptyConvertOrderForm()
  ))
  const [selectedOpportunityDetailsTab, setSelectedOpportunityDetailsTab] = useState<OpportunityDetailsTab>('details')
  const [selectedOpportunityNestedFolderPath, setSelectedOpportunityNestedFolderPath] = useState<string | null>(null)
  const [opportunityDetailsFormState, setOpportunityDetailsFormState] = useState<OpportunityDetailsFormState | null>(null)
  const [folderScanQueue, setFolderScanQueue] = useState<FolderScanQueueEntry[]>([])
  const [excelSyncLaunchMode, setExcelSyncLaunchMode] = useState<ExcelSyncLaunchMode>('excel_file')
  const [pendingFolderScanFiles, setPendingFolderScanFiles] = useState<File[] | null>(null)
  const [isFolderScanSelectionDialogOpen, setIsFolderScanSelectionDialogOpen] = useState(false)
  const [folderScanTargetQuoteId, setFolderScanTargetQuoteId] = useState('')
  const [folderScanTargetQuoteSnapshot, setFolderScanTargetQuoteSnapshot] = useState<CrmQuote | null>(null)
  const [folderScanActiveSidebarKey, setFolderScanActiveSidebarKey] = useState<FolderScanSidebarKey>('all')
  const [folderScanExpandedSidebarFolderKey, setFolderScanExpandedSidebarFolderKey] = useState<QuoteSidebarFolderKey | null>(null)
  const [folderScanActiveNestedPath, setFolderScanActiveNestedPath] = useState<string | null>(null)
  const [folderScanUploadSummary, setFolderScanUploadSummary] = useState<FolderScanUploadSummary | null>(null)
  const [folderScanUploadProgress, setFolderScanUploadProgress] = useState({ completed: 0, total: 0 })
  const [opportunityDetailsInitialSnapshot, setOpportunityDetailsInitialSnapshot] = useState('')
  const [selectedOpportunityChatDraft, setSelectedOpportunityChatDraft] = useState('')
  const [selectedOpportunityRefreshOnSend, setSelectedOpportunityRefreshOnSend] = useState(false)
  const [isSendingSelectedOpportunityChat, setIsSendingSelectedOpportunityChat] = useState(false)
  const [deletingSelectedOpportunityChatMessageId, setDeletingSelectedOpportunityChatMessageId] = useState('')
  const [pendingExcelSyncPromotionQuoteId, setPendingExcelSyncPromotionQuoteId] = useState<string | null>(null)
  const [detailsActionMenuAnchorEl, setDetailsActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [uploadQuoteActionMenuAnchorEl, setUploadQuoteActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const [activePipelineStage, setActivePipelineStage] = useState<CrmOpportunityStage>('proposal_submission')
  const pipelineUploadExcelInputRef = useRef<HTMLInputElement | null>(null)
  const folderScanInputRef = useRef<HTMLInputElement | null>(null)
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

  const salesRepsQuery = useQuery({
    queryKey: QUERY_KEYS.crmSalesReps,
    queryFn: () => fetchCrmSalesReps(),
    staleTime: 5 * 60 * 1000,
  })

  const convertOrderBoardsQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesConvertOrderBoards,
    queryFn: () => fetchCrmConvertOrderBoards(),
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
  const isRefreshing = (
    dealersQuery.isFetching
    || quotesQuery.isFetching
  ) && !isLoading

  const queryError = [
    dealersQuery.error,
    quotesQuery.error,
    salesRepsQuery.error,
  ]
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

  const convertOrderBoardOptions = useMemo<CrmConvertOrderBoardOption[]>(() => {
    const fromApi = Array.isArray(convertOrderBoardsQuery.data?.boards)
      ? convertOrderBoardsQuery.data.boards
      : []

    if (fromApi.length > 0) {
      return fromApi
    }

    return [
      { id: DEFAULT_NEW_ORDERS_2026_BOARD_ID, name: 'New Orders 2026' },
      { id: DEFAULT_DESIGN_AKF_BOARD_ID, name: 'Design AKF' },
    ]
  }, [convertOrderBoardsQuery.data?.boards])

  const convertOrderPrimaryBoardId = useMemo(() => {
    const fromApi = String(convertOrderBoardsQuery.data?.primaryBoardId ?? '').trim()

    if (fromApi) {
      return fromApi
    }

    return DEFAULT_NEW_ORDERS_2026_BOARD_ID
  }, [convertOrderBoardsQuery.data?.primaryBoardId])

  const convertOrderSecondaryBoardId = useMemo(() => {
    const fromApi = String(convertOrderBoardsQuery.data?.secondaryBoardId ?? '').trim()

    if (fromApi) {
      return fromApi
    }

    return DEFAULT_DESIGN_AKF_BOARD_ID
  }, [convertOrderBoardsQuery.data?.secondaryBoardId])

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
      order_placement: [],
    }

    for (const quote of filteredActiveQuotes) {
      const stage = resolveOpportunityStage(quote)
      base[stage].push(quote)
    }

    for (const stage of stageDefinitions) {
      base[stage.id].sort(compareQuotesByQuoteNumber)
    }

    return base
  }, [filteredActiveQuotes])

  const stageSummaries = useMemo(() => new Map(
    stageDefinitions.map((stage) => {
      const stageRows = stageBuckets[stage.id]
      return [stage.id, {
        count: stageRows.length,
      }]
    }),
  ), [stageBuckets])

  const activePipelineStageDefinition = stageById.get(activePipelineStage) || stageDefinitions[0]

  const selectedOpportunityStage = useMemo(
    () => (selectedOpportunity ? resolveOpportunityStage(selectedOpportunity) : null),
    [selectedOpportunity],
  )

  const isDetailsActionMenuOpen = Boolean(detailsActionMenuAnchorEl)
  const isUploadQuoteActionMenuOpen = Boolean(uploadQuoteActionMenuAnchorEl)
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

  const selectedOpportunitySidebarFolderKey = useMemo<QuoteSidebarFolderKey | null>(() => {
    if (quoteSidebarFolderKeySet.has(selectedOpportunityDetailsTab as QuoteSidebarFolderKey)) {
      return selectedOpportunityDetailsTab as QuoteSidebarFolderKey
    }

    return null
  }, [selectedOpportunityDetailsTab])

  const selectedOpportunitySidebarFolder = useMemo(
    () => (selectedOpportunitySidebarFolderKey
      ? (quoteSidebarFolderByKey.get(selectedOpportunitySidebarFolderKey) ?? null)
      : null),
    [selectedOpportunitySidebarFolderKey],
  )

  const selectedOpportunityDocumentsByFolder = useMemo(() => {
    const grouped = new Map<QuoteSidebarFolderKey, CrmQuoteDocument[]>()

    for (const folder of quoteSidebarFolders) {
      grouped.set(folder.key, [])
    }

    for (const document of selectedOpportunityDocuments) {
      const folderKey = resolveDocumentFolderKey(document)
      const existing = grouped.get(folderKey) ?? []
      grouped.set(folderKey, [...existing, document])
    }

    return grouped
  }, [selectedOpportunityDocuments])

  const selectedOpportunityFolderDocuments = useMemo(
    () => (selectedOpportunitySidebarFolderKey
      ? (selectedOpportunityDocumentsByFolder.get(selectedOpportunitySidebarFolderKey) ?? [])
      : []),
    [selectedOpportunityDocumentsByFolder, selectedOpportunitySidebarFolderKey],
  )

  const selectedOpportunityNestedGroupsByFolder = useMemo(() => {
    const grouped = new Map<QuoteSidebarFolderKey, QuoteNestedFolderGroup[]>()

    for (const folder of quoteSidebarFolders) {
      grouped.set(folder.key, buildQuoteNestedFolderGroups(selectedOpportunityDocumentsByFolder.get(folder.key) ?? [], folder.key))
    }

    return grouped
  }, [selectedOpportunityDocumentsByFolder])

  const selectedOpportunityFolderRootDocuments = useMemo(
    () => selectedOpportunityFolderDocuments.filter(
      (document) => !resolveDocumentNestedFolderPath(document, selectedOpportunitySidebarFolderKey),
    ),
    [selectedOpportunityFolderDocuments, selectedOpportunitySidebarFolderKey],
  )

  const selectedOpportunityFolderNestedGroups = useMemo(
    () => buildQuoteNestedFolderGroups(selectedOpportunityFolderDocuments, selectedOpportunitySidebarFolderKey),
    [selectedOpportunityFolderDocuments, selectedOpportunitySidebarFolderKey],
  )

  const selectedOpportunityActiveNestedFolderGroup = useMemo(
    () => (selectedOpportunityNestedFolderPath
      ? (selectedOpportunityFolderNestedGroups.find((entry) => entry.path === selectedOpportunityNestedFolderPath) ?? null)
      : null),
    [selectedOpportunityFolderNestedGroups, selectedOpportunityNestedFolderPath],
  )

  useEffect(() => {
    if (!selectedOpportunityNestedFolderPath) {
      return
    }

    const isNestedFolderStillVisible = selectedOpportunityFolderNestedGroups
      .some((entry) => entry.path === selectedOpportunityNestedFolderPath)

    if (!isNestedFolderStillVisible) {
      setSelectedOpportunityNestedFolderPath(null)
    }
  }, [selectedOpportunityFolderNestedGroups, selectedOpportunityNestedFolderPath])

  const folderScanTargetQuote = useMemo(
    () => quotes.find((entry) => entry.id === folderScanTargetQuoteId) || folderScanTargetQuoteSnapshot || null,
    [folderScanTargetQuoteId, folderScanTargetQuoteSnapshot, quotes],
  )

  const folderScanSelectedQueueCount = useMemo(
    () => folderScanQueue.filter((entry) => entry.selected && !entry.duplicateBlocked).length,
    [folderScanQueue],
  )

  const folderScanQueueByFolder = useMemo(() => {
    const grouped = new Map<QuoteSidebarFolderKey, FolderScanQueueEntry[]>()

    for (const folder of quoteSidebarFolders) {
      grouped.set(folder.key, [])
    }

    for (const entry of folderScanQueue) {
      const existing = grouped.get(entry.folderKey)

      if (existing) {
        existing.push(entry)
      } else {
        grouped.set(entry.folderKey, [entry])
      }
    }

    return grouped
  }, [folderScanQueue])

  const folderScanNestedSectionsByFolder = useMemo(() => {
    const grouped = new Map<QuoteSidebarFolderKey, FolderScanNestedSection[]>()

    for (const folder of quoteSidebarFolders) {
      const entries = folderScanQueueByFolder.get(folder.key) ?? []
      const nestedPathCounts = new Map<string, { totalCount: number; selectedCount: number }>()

      for (const entry of entries) {
        const nestedFolderPath = resolveFolderScanEntryNestedFolderPath(entry)

        if (!nestedFolderPath) {
          continue
        }

        const existing = nestedPathCounts.get(nestedFolderPath) ?? { totalCount: 0, selectedCount: 0 }

        nestedPathCounts.set(nestedFolderPath, {
          totalCount: existing.totalCount + 1,
          selectedCount: existing.selectedCount + (entry.selected && !entry.duplicateBlocked ? 1 : 0),
        })
      }

      const nestedSections = Array.from(nestedPathCounts.entries())
        .map(([path, counts]) => ({
          path,
          totalCount: counts.totalCount,
          selectedCount: counts.selectedCount,
        }))
        .sort((left, right) => left.path.localeCompare(right.path))

      grouped.set(folder.key, nestedSections)
    }

    return grouped
  }, [folderScanQueueByFolder])

  const folderScanSidebarSections = useMemo<FolderScanSidebarSection[]>(() => {
    const allSection: FolderScanSidebarSection = {
      key: 'all',
      label: 'All Folders',
      totalCount: folderScanQueue.length,
      selectedCount: folderScanSelectedQueueCount,
      blockedCount: folderScanQueue.filter((entry) => entry.duplicateBlocked).length,
    }

    const folderSections = quoteSidebarFolders.map((folder) => {
      const entries = folderScanQueueByFolder.get(folder.key) ?? []

      return {
        key: folder.key,
        label: folder.label,
        totalCount: entries.length,
        selectedCount: entries.filter((entry) => entry.selected && !entry.duplicateBlocked).length,
        blockedCount: entries.filter((entry) => entry.duplicateBlocked).length,
      }
    })

    return [allSection, ...folderSections]
  }, [folderScanQueue, folderScanQueueByFolder, folderScanSelectedQueueCount])

  const folderScanVisibleSections = useMemo<Array<QuoteSidebarFolderDefinition & { entries: FolderScanQueueEntry[] }>>(() => {
    const filterEntriesByActiveNestedPath = (entries: FolderScanQueueEntry[]) => {
      if (!folderScanActiveNestedPath || folderScanActiveSidebarKey === 'all') {
        return entries
      }

      return entries.filter((entry) => resolveFolderScanEntryNestedFolderPath(entry) === folderScanActiveNestedPath)
    }

    if (folderScanActiveSidebarKey === 'all') {
      return quoteSidebarFolders.map((folder) => ({
        ...folder,
        entries: folderScanQueueByFolder.get(folder.key) ?? [],
      }))
    }

    const folder = quoteSidebarFolderByKey.get(folderScanActiveSidebarKey)

    if (!folder) {
      return []
    }

    return [{
      ...folder,
      entries: filterEntriesByActiveNestedPath(folderScanQueueByFolder.get(folder.key) ?? []),
    }]
  }, [folderScanActiveNestedPath, folderScanActiveSidebarKey, folderScanQueueByFolder])

  const folderScanVisibleEntriesCount = useMemo(
    () => folderScanVisibleSections.reduce((total, section) => total + section.entries.length, 0),
    [folderScanVisibleSections],
  )

  const folderScanSelectionScopeLabel = useMemo(() => {
    if (folderScanActiveSidebarKey === 'all') {
      return 'all folders'
    }

    const folderLabel = quoteSidebarFolderByKey.get(folderScanActiveSidebarKey)?.label ?? 'selected folder'

    if (!folderScanActiveNestedPath) {
      return folderLabel
    }

    return `${folderLabel} / ${folderScanActiveNestedPath}`
  }, [folderScanActiveNestedPath, folderScanActiveSidebarKey])

  useEffect(() => {
    if (folderScanActiveSidebarKey === 'all') {
      if (folderScanActiveNestedPath) {
        setFolderScanActiveNestedPath(null)
      }

      return
    }

    const activeFolderEntries = folderScanQueueByFolder.get(folderScanActiveSidebarKey) ?? []

    if (activeFolderEntries.length === 0) {
      setFolderScanActiveSidebarKey('all')
      setFolderScanExpandedSidebarFolderKey(null)
      setFolderScanActiveNestedPath(null)
      return
    }

    if (!folderScanActiveNestedPath) {
      return
    }

    const nestedPathStillExists = activeFolderEntries
      .some((entry) => resolveFolderScanEntryNestedFolderPath(entry) === folderScanActiveNestedPath)

    if (!nestedPathStillExists) {
      setFolderScanActiveNestedPath(null)
    }
  }, [
    folderScanActiveNestedPath,
    folderScanActiveSidebarKey,
    folderScanQueueByFolder,
    setFolderScanExpandedSidebarFolderKey,
  ])

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
    setExcelSyncLaunchMode('excel_file')
    setPendingFolderScanFiles(null)
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
    ])
  }, [dealersQuery, quotesQuery])

  const initializeExcelSyncFromPayload = useCallback(async (
    excelPayload: CrmExcelQuoteSyncInput,
    sourceFileName: string,
    options: {
      launchMode: ExcelSyncLaunchMode
      scannedFiles?: File[]
    },
  ) => {
    const quoteNumberFromExcel = String(excelPayload.quoteNumber ?? '').trim()

    if (!quoteNumberFromExcel) {
      throw new Error('Excel quote file is missing a quote number.')
    }

    const lookupResult = await fetchCrmExcelQuoteLookup(quoteNumberFromExcel)
    const isMissingFromConcept = !lookupResult.found
    const salesRepFromExcel = String(excelPayload.salesRep ?? '').trim()
    const defaultSalesRep = resolveMatchingOption(salesRepFromExcel, excelSyncSalesRepOptions)
    const accountNameFromExcel = String(excelPayload.companyName ?? '').trim()
    const matchedDealers = accountNameFromExcel
      ? findMatchingDealersByName(dealers, accountNameFromExcel)
      : []

    setExcelSyncLaunchMode(options.launchMode)
    setPendingFolderScanFiles(options.launchMode === 'folder_scan' ? (options.scannedFiles ?? []) : null)
    setExcelSyncLookupResult(lookupResult)
    setExcelSyncDraft(excelPayload)
    setExcelSyncSourceFileName(sourceFileName)
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
      setExcelSyncAccountMode('none')
      setExcelSyncDealerSourceIdInput('')
    }

    setExcelSyncDialogError(null)

    if (isMissingFromConcept) {
      setExcelSyncAllowCreateWhenMissingConcept(true)
      setIsExcelMissingConceptDialogOpen(true)
      return
    }

    setExcelSyncAllowCreateWhenMissingConcept(false)
    setIsExcelAccountDialogOpen(true)
  }, [dealers, excelSyncSalesRepOptions])

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
      await initializeExcelSyncFromPayload(excelPayload, file.name, {
        launchMode: 'excel_file',
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to sync quote file.')
    } finally {
      setIsSyncingExcelQuote(false)
    }
  }, [initializeExcelSyncFromPayload])

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

    if (excelSyncAccountMode === 'none') {
      setExcelSyncDealerSourceIdInput('')
      setExcelSyncResolvedDealerSourceId('')
      setExcelSyncResolvedDealerName(excelSyncAccountCandidateName)
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
    excelSyncAccountCandidateName,
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

  const openFolderScanSelectionDialogForQuote = useCallback((targetQuote: CrmQuote, scannedFiles: File[]) => {
    const nextQueue = buildFolderScanQueueEntriesForQuote(targetQuote, scannedFiles)

    resetExcelSyncDialog()
    setFolderScanQueue(nextQueue)
    setFolderScanTargetQuoteId(targetQuote.id)
    setFolderScanTargetQuoteSnapshot(targetQuote)
    setFolderScanActiveSidebarKey('all')
    setFolderScanExpandedSidebarFolderKey(null)
    setFolderScanActiveNestedPath(null)
    setFolderScanUploadSummary(null)
    setFolderScanUploadProgress({ completed: 0, total: 0 })
    setIsFolderScanSelectionDialogOpen(true)

    return nextQueue
  }, [resetExcelSyncDialog])

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

    if (excelSyncAccountMode === 'existing' && !resolvedDealerSourceId) {
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

      if (excelSyncLaunchMode === 'folder_scan') {
        if (!pendingFolderScanFiles || pendingFolderScanFiles.length === 0) {
          throw new Error('No scanned folder files were found for upload.')
        }

        const syncResponse = await syncCrmQuoteFromExcel(syncInput)
        let syncedQuote = syncResponse.quote

        if (!syncedQuote) {
          throw new Error(syncResponse.message || 'Failed to sync quote from scanned folder Excel file.')
        }

        if (resolvedDealerSourceId || resolvedCompanyName) {
          const patchResponse = await updateCrmQuote(syncedQuote.id, {
            ...(resolvedDealerSourceId ? { dealerSourceId: resolvedDealerSourceId } : {}),
            ...(resolvedCompanyName ? { companyName: resolvedCompanyName } : {}),
          })
          syncedQuote = patchResponse.quote
        }

        const scannedFilesForSelection = pendingFolderScanFiles
        const nextQueue = openFolderScanSelectionDialogForQuote(syncedQuote, scannedFilesForSelection)
        const queueLabel = nextQueue.length === 1 ? '1 new file' : `${nextQueue.length} new files`
        setSuccessMessage(`Excel sync is ready for ${quoteNumber}. Showing ${queueLabel}. Only the main Quotes-folder Excel file is always included.`)
        return
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
    excelSyncLaunchMode,
    excelSyncDealerStateCode,
    excelSyncDraft,
    excelSyncLookupResult,
    excelSyncAllowCreateWhenMissingConcept,
    excelSyncAccountMode,
    excelSyncProjectTypeInput,
    excelSyncQuoteNumberInput,
    excelSyncResolvedDealerName,
    excelSyncResolvedDealerSourceId,
    excelSyncSalesRepInput,
    excelSyncSalesRepOptions,
    openFolderScanSelectionDialogForQuote,
    pendingFolderScanFiles,
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

  const uploadSelectedOpportunityDocumentFile = useCallback(async (
    quote: CrmQuote,
    file: File,
    options: {
      folderLabel?: string
      documentName?: string
    } = {},
  ) => {
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

    const normalizedFileName = String(file.name ?? '').trim()
    const normalizedDocumentName = String(options.documentName ?? normalizedFileName).trim() || normalizedFileName
    const normalizedFolderLabel = String(options.folderLabel ?? '').trim()

    return {
      url: downloadUrl,
      name: normalizedFolderLabel
        ? buildDocumentNameWithFolder(normalizedFolderLabel, normalizedDocumentName)
        : normalizedDocumentName,
    }
  }, [])

  const handleOpenFolderScanDialog = useCallback(() => {
    const input = folderScanInputRef.current

    if (!input) {
      return
    }

    input.value = ''
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.click()
  }, [])

  const handleFolderScanUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const scannedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (scannedFiles.length === 0) {
      return
    }

    if (!canManage) {
      setErrorMessage('You do not have permission to upload quote folders.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsUploadingFolderSelection(true)

    try {
      const excelFiles = scannedFiles.filter((file) => {
        const relativePath = String(file.webkitRelativePath || file.name).trim()
        return isAlwaysResyncedQuotesExcelFile(relativePath, file.name)
      })

      if (excelFiles.length === 0) {
        setErrorMessage('Scanned folder must include the main Excel file directly inside the Quotes folder (not in Quotes subfolders).')
        return
      }

      let parsedExcelPayload: CrmExcelQuoteSyncInput | null = null
      let sourceExcelFileName = ''

      for (const file of excelFiles) {
        try {
          parsedExcelPayload = await parseExcelQuoteForSync(file)
          sourceExcelFileName = file.name
          break
        } catch {
          // Try the next Excel file if this workbook fails to parse.
        }
      }

      if (!parsedExcelPayload) {
        setErrorMessage('Could not parse an Excel quote file from the selected folder.')
        return
      }

      const quoteNumberFromExcel = String(parsedExcelPayload.quoteNumber ?? '').trim()

      if (!quoteNumberFromExcel) {
        throw new Error('Excel quote file is missing a quote number.')
      }

      const normalizedQuoteNumber = normalizeMatchValue(quoteNumberFromExcel)
      const existingQuote = quotes.find((entry) => normalizeMatchValue(entry.quoteNumber) === normalizedQuoteNumber) || null

      if (existingQuote) {
        let syncedQuote: CrmQuote | null = existingQuote
        let syncErrorMessage = ''

        try {
          const syncResponse = await syncCrmQuoteFromExcel({
            ...parsedExcelPayload,
            quoteNumber: quoteNumberFromExcel,
          })

          syncedQuote = syncResponse.quote || syncedQuote
        } catch (error) {
          const apiError = error as {
            status?: number
            payload?: {
              error?: unknown
              message?: unknown
            }
          }

          const payloadError = typeof apiError.payload === 'object' && apiError.payload
            ? String(apiError.payload.error ?? apiError.payload.message ?? '').trim()
            : ''

          syncErrorMessage = payloadError || (error instanceof Error ? error.message : 'Failed to sync Excel data for this quote.')

          if (apiError.status !== 409) {
            throw error
          }
        }

        if (!syncedQuote) {
          throw new Error('Could not resolve the existing quote for this scanned folder.')
        }

        const nextQueue = openFolderScanSelectionDialogForQuote(syncedQuote, scannedFiles)
        const queueLabel = nextQueue.length === 1 ? '1 new file' : `${nextQueue.length} new files`

        setSuccessMessage(
          `Quote ${quoteNumberFromExcel} already exists. Showing ${queueLabel}. Only the main Quotes-folder Excel file is always included.`,
        )

        if (syncErrorMessage) {
          setErrorMessage(syncErrorMessage)
        }

        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes })
        return
      }

      await initializeExcelSyncFromPayload(parsedExcelPayload, sourceExcelFileName, {
        launchMode: 'folder_scan',
        scannedFiles,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to scan quote folder.')
    } finally {
      setIsUploadingFolderSelection(false)
    }
  }, [canManage, initializeExcelSyncFromPayload, openFolderScanSelectionDialogForQuote, queryClient, quotes])

  const handleToggleFolderScanEntry = useCallback((entryId: string, checked: boolean) => {
    setFolderScanQueue((current) => current.map((entry) => {
      if (entry.id !== entryId || entry.duplicateBlocked) {
        return entry
      }

      return {
        ...entry,
        selected: checked,
      }
    }))
  }, [])

  const handleSetAllFolderScanEntries = useCallback((checked: boolean) => {
    setFolderScanQueue((current) => current.map((entry) => (
      entry.duplicateBlocked
      || (folderScanActiveSidebarKey !== 'all' && entry.folderKey !== folderScanActiveSidebarKey)
      || (folderScanActiveSidebarKey !== 'all'
        && folderScanActiveNestedPath
        && resolveFolderScanEntryNestedFolderPath(entry) !== folderScanActiveNestedPath)
        ? entry
        : {
          ...entry,
          selected: checked,
        }
    )))
  }, [folderScanActiveNestedPath, folderScanActiveSidebarKey])

  const handleClearFolderScanEntries = useCallback(() => {
    setFolderScanQueue([])
    setFolderScanActiveSidebarKey('all')
    setFolderScanExpandedSidebarFolderKey(null)
    setFolderScanActiveNestedPath(null)
    setFolderScanUploadSummary(null)
  }, [])

  const handleCloseFolderScanSelectionDialog = useCallback(() => {
    if (isUploadingFolderSelection) {
      return
    }

    setIsFolderScanSelectionDialogOpen(false)
    setFolderScanTargetQuoteId('')
    setFolderScanTargetQuoteSnapshot(null)
    setFolderScanActiveSidebarKey('all')
    setFolderScanExpandedSidebarFolderKey(null)
    setFolderScanActiveNestedPath(null)
    setFolderScanUploadSummary(null)
    setFolderScanUploadProgress({ completed: 0, total: 0 })
    setFolderScanQueue([])
  }, [isUploadingFolderSelection])

  const handleUploadSelectedFolderEntries = useCallback(async () => {
    const targetQuote = folderScanTargetQuote

    if (!targetQuote) {
      setErrorMessage('Could not resolve the target quote for this scanned folder.')
      return
    }

    const selectedEntries = folderScanQueue.filter((entry) => entry.selected && !entry.duplicateBlocked)

    if (selectedEntries.length === 0) {
      setErrorMessage('Select at least one scanned file to upload.')
      return
    }

    const existingDocuments = resolveQuoteDocuments(targetQuote)
    const nextDocuments = [...existingDocuments]
    const uploadedEntryIds = new Set<string>()
    const failedFileMessages: string[] = []
    let cursor = 0

    setErrorMessage(null)
    setSuccessMessage(null)
    setFolderScanUploadSummary(null)
    setIsUploadingFolderSelection(true)
    setFolderScanUploadProgress({ completed: 0, total: selectedEntries.length })

    try {
      const workerCount = Math.min(4, selectedEntries.length)
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < selectedEntries.length) {
          const entryIndex = cursor
          cursor += 1
          const entry = selectedEntries[entryIndex]

          try {
            const nextDocument = await uploadSelectedOpportunityDocumentFile(targetQuote, entry.file, {
              folderLabel: entry.folderLabel,
              documentName: entry.documentName,
            })
            nextDocuments.push(nextDocument)
            uploadedEntryIds.add(entry.id)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to upload file.'
            failedFileMessages.push(`${entry.file.name}: ${message}`)
          } finally {
            setFolderScanUploadProgress((current) => ({
              completed: Math.min(current.total, current.completed + 1),
              total: current.total,
            }))
          }
        }
      })

      await Promise.all(workers)

      if (uploadedEntryIds.size > 0) {
        const updateResponse = await updateCrmQuote(targetQuote.id, {
          documents: nextDocuments,
        })
        setFolderScanTargetQuoteSnapshot(updateResponse.quote)

        if (selectedOpportunityId && selectedOpportunityId === targetQuote.id) {
          setOpportunityDetailsFormState((current) => {
            if (!current) {
              return current
            }

            return {
              ...current,
              documents: resolveQuoteDocuments(updateResponse.quote),
            }
          })
        }

        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes })
      }

      setFolderScanQueue((current) => current.filter((entry) => !uploadedEntryIds.has(entry.id)))

      const failedCount = failedFileMessages.length

      setFolderScanUploadSummary({
        uploadedCount: uploadedEntryIds.size,
        attemptedCount: selectedEntries.length,
        failedCount,
      })

      const summaryParts = [
        `Uploaded ${uploadedEntryIds.size} of ${selectedEntries.length} selected file${selectedEntries.length === 1 ? '' : 's'}.`,
      ]

      if (failedCount > 0) {
        summaryParts.push(`${failedCount} file${failedCount === 1 ? '' : 's'} failed.`)
      }

      setSuccessMessage(summaryParts.join(' '))

      if (failedCount > 0) {
        setErrorMessage(failedFileMessages.join(' | '))
      }
    } finally {
      setIsUploadingFolderSelection(false)
    }
  }, [folderScanQueue, folderScanTargetQuote, queryClient, selectedOpportunityId, uploadSelectedOpportunityDocumentFile])

  const handleOpenUploadQuoteActionMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setUploadQuoteActionMenuAnchorEl(event.currentTarget)
  }, [])

  const handleCloseUploadQuoteActionMenu = useCallback(() => {
    setUploadQuoteActionMenuAnchorEl(null)
  }, [])

  const handleOpenUploadQuoteExcelPicker = useCallback(() => {
    setUploadQuoteActionMenuAnchorEl(null)
    const input = pipelineUploadExcelInputRef.current

    if (!input) {
      return
    }

    input.value = ''
    input.click()
  }, [])

  const handleOpenUploadQuoteFolderScanner = useCallback(() => {
    setUploadQuoteActionMenuAnchorEl(null)
    handleOpenFolderScanDialog()
  }, [handleOpenFolderScanDialog])

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
    const parsedDraft = parseQuoteChatRefreshRequest(selectedOpportunityChatDraft)
    const nextMessage = parsedDraft.messageText
    const shouldRefreshQuoteDate = selectedOpportunityRefreshOnSend || parsedDraft.refreshRequested

    if (!selectedOpportunityId || !nextMessage) {
      if (selectedOpportunityId && shouldRefreshQuoteDate && !nextMessage) {
        setErrorMessage('Add a chat message with /refresh when refreshing the quote date.')
      }
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

      let refreshedQuoteDate: string | null = null
      let refreshErrorMessage = ''

      if (shouldRefreshQuoteDate) {
        const nextRefreshedQuoteDate = getTodayEasternDateInputValue()
        refreshedQuoteDate = nextRefreshedQuoteDate

        try {
          await updateCrmQuote(selectedOpportunityId, {
            opportunityDate: nextRefreshedQuoteDate,
          })

          setSelectedOpportunity((current) => {
            if (!current || current.id !== selectedOpportunityId) {
              return current
            }

            return {
              ...current,
              opportunityDate: nextRefreshedQuoteDate,
              updatedAt: new Date().toISOString(),
            }
          })

          setOpportunityDetailsFormState((current) => {
            if (!current) {
              return current
            }

            return {
              ...current,
              opportunityDateInput: nextRefreshedQuoteDate,
            }
          })
        } catch (refreshError) {
          refreshErrorMessage = refreshError instanceof Error
            ? refreshError.message
            : 'Could not refresh quote date.'
        }
      }

      setSelectedOpportunityChatDraft('')
      setSelectedOpportunityRefreshOnSend(false)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(selectedOpportunityId) })

      if (shouldRefreshQuoteDate) {
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes })

        if (refreshErrorMessage) {
          setErrorMessage(`Message sent, but refresh failed: ${refreshErrorMessage}`)
        } else if (refreshedQuoteDate) {
          setSuccessMessage(`Message sent. Quote date refreshed to ${formatOpportunityLikeDate(refreshedQuoteDate)}.`)
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send quote chat message.')
    } finally {
      setIsSendingSelectedOpportunityChat(false)
    }
  }, [
    canManage,
    queryClient,
    selectedOpportunityRefreshOnSend,
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

  const clearDeepLinkedQuoteId = useCallback(() => {
    if (!searchParams.has('quoteId')) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('quoteId')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const handleOpenOpportunityDetails = useCallback((quote: CrmQuote, initialTab: OpportunityDetailsTab = 'details') => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setDetailsActionMenuAnchorEl(null)
    setUploadQuoteActionMenuAnchorEl(null)
    const nextFormState = createOpportunityDetailsFormState(quote)
    setSelectedOpportunityChatDraft('')
    setSelectedOpportunityRefreshOnSend(false)
    setDeletingSelectedOpportunityChatMessageId('')
    setSelectedOpportunityDetailsTab(initialTab)
    setSelectedOpportunityNestedFolderPath(null)
    setSelectedOpportunity(quote)
    setOpportunityDetailsFormState(nextFormState)
    setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
    setFolderScanQueue([])
    setIsUploadingFolderSelection(false)
    setPendingExcelSyncPromotionQuoteId(null)
  }, [])

  const handleOpenOpportunityChat = useCallback((quote: CrmQuote) => {
    handleOpenOpportunityDetails(quote, 'chat')
  }, [handleOpenOpportunityDetails])

  useEffect(() => {
    if (!deepLinkedQuoteId) {
      return
    }

    const deepLinkedQuote = quotes.find((quote) => quote.id === deepLinkedQuoteId)

    if (deepLinkedQuote) {
      handleOpenOpportunityDetails(deepLinkedQuote)
      clearDeepLinkedQuoteId()
      return
    }

    if (!isLoading && !isRefreshing) {
      clearDeepLinkedQuoteId()
    }
  }, [
    clearDeepLinkedQuoteId,
    deepLinkedQuoteId,
    handleOpenOpportunityDetails,
    isLoading,
    isRefreshing,
    quotes,
  ])

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
    if (
      isSavingOpportunityDetails
      || isUploadingFolderSelection
      || isSendingSelectedOpportunityChat
    ) {
      return
    }

    if (isOpportunityDetailsDirty) {
      const confirmedDiscard = window.confirm('Are you sure you want to leave without saving?')

      if (!confirmedDiscard) {
        return
      }
    }

    setDetailsActionMenuAnchorEl(null)
    setUploadQuoteActionMenuAnchorEl(null)
    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
    setOpportunityDetailsInitialSnapshot('')
    setSelectedOpportunityDetailsTab('details')
    setSelectedOpportunityNestedFolderPath(null)
    setSelectedOpportunityChatDraft('')
    setSelectedOpportunityRefreshOnSend(false)
    setFolderScanQueue([])
    setIsUploadingFolderSelection(false)
    setPendingExcelSyncPromotionQuoteId(null)
  }, [
    isSendingSelectedOpportunityChat,
    isOpportunityDetailsDirty,
    isSavingOpportunityDetails,
    setSelectedOpportunityNestedFolderPath,
    isUploadingFolderSelection,
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
    const dealerSourceId = formState.dealerSourceId.trim()
    const quoteNumber = formState.quoteNumber.trim()
    const opportunityDateInput = formState.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(formState.lineItems, formState.subtotal, formState.freight)
    const lineItems = pricing.normalizedLineItems
    const totalAmount = pricing.totalAmount

    // Manual concepts require an account link and quote number. The remaining
    // details can still be filled in later from the Excel quote sync.
    if (!dealerSourceId) {
      setErrorMessage('Dealer account is required.')
      return
    }

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
        dealerSourceId,
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

  const handleCloseConvertOrderDialog = useCallback(() => {
    if (isSubmittingConvertOrder) {
      return
    }

    setIsConvertOrderDialogOpen(false)
    setConvertOrderTargetQuote(null)
    setConvertOrderFormState(createEmptyConvertOrderForm(convertOrderPrimaryBoardId, convertOrderSecondaryBoardId))
  }, [convertOrderPrimaryBoardId, convertOrderSecondaryBoardId, isSubmittingConvertOrder])

  const openConvertOrderDialog = useCallback((quote: CrmQuote) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setConvertOrderTargetQuote(quote)
    setConvertOrderFormState(createEmptyConvertOrderForm(convertOrderPrimaryBoardId, convertOrderSecondaryBoardId))
    setIsConvertOrderDialogOpen(true)
  }, [convertOrderPrimaryBoardId, convertOrderSecondaryBoardId])

  const updateConvertOrderField = useCallback(<Key extends keyof OpportunityConvertOrderFormState>(
    key: Key,
    value: OpportunityConvertOrderFormState[Key],
  ) => {
    setConvertOrderFormState((current) => ({
      ...current,
      [key]: value,
    }))
  }, [])

  const handleSubmitConvertOrder = useCallback(async () => {
    if (!convertOrderTargetQuote) {
      return
    }

    const poDate = convertOrderFormState.poDate.trim()
    const leadTimeDate = convertOrderFormState.leadTimeDate.trim()
    const shipTo = convertOrderFormState.shipTo.trim()

    if (!poDate || !/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
      setErrorMessage('P.O. date is required and must be valid.')
      return
    }

    if (leadTimeDate && !/^\d{4}-\d{2}-\d{2}$/.test(leadTimeDate)) {
      setErrorMessage('Lead Time must be a valid date when provided.')
      return
    }

    if (!shipTo) {
      setErrorMessage('Ship To is required.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmittingConvertOrder(true)
    setBusyQuoteId(convertOrderTargetQuote.id)

    try {
      await convertCrmQuoteToOrder(convertOrderTargetQuote.id, {
        poDate,
        poNumber: convertOrderFormState.poNumber.trim() || null,
        leadTimeDate: leadTimeDate || null,
        shipTo,
        notes: convertOrderFormState.notes.trim() || null,
      })

      await invalidateOpportunityData()
      setIsConvertOrderDialogOpen(false)
      setConvertOrderTargetQuote(null)
      setConvertOrderFormState(createEmptyConvertOrderForm(convertOrderPrimaryBoardId, convertOrderSecondaryBoardId))
      setDetailsActionMenuAnchorEl(null)
      setUploadQuoteActionMenuAnchorEl(null)
      setSelectedOpportunity(null)
      setOpportunityDetailsFormState(null)
      setOpportunityDetailsInitialSnapshot('')
      setSelectedOpportunityDetailsTab('details')
      setSelectedOpportunityNestedFolderPath(null)
      setPendingExcelSyncPromotionQuoteId(null)
      setSuccessMessage('Opportunity converted to order and pushed to New Orders 2026 + Design AKF.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to convert opportunity to order.')
    } finally {
      setIsSubmittingConvertOrder(false)
      setBusyQuoteId(null)
    }
  }, [
    convertOrderFormState.leadTimeDate,
    convertOrderFormState.notes,
    convertOrderFormState.poDate,
    convertOrderFormState.poNumber,
    convertOrderFormState.shipTo,
    convertOrderPrimaryBoardId,
    convertOrderSecondaryBoardId,
    convertOrderTargetQuote,
    invalidateOpportunityData,
  ])

  const handleMarkApproved = useCallback((quote: CrmQuote) => {
    openConvertOrderDialog(quote)
  }, [openConvertOrderDialog])

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
    invalidateOpportunityData,
    opportunityDetailsFormState,
    pendingExcelSyncPromotionQuoteId,
    selectedOpportunity,
  ])

  const convertOrderQuoteLabel = String(
    convertOrderTargetQuote?.quoteNumber
      || convertOrderTargetQuote?.title
      || convertOrderTargetQuote?.id
      || '',
  ).trim()

  if (isLoading && !detailsOnly) {
    return <LoadingPanel loading message="Fetching pipeline opportunities..." />
  }

  return (
    <Stack spacing={1.75}>
      <StatusAlerts
        errorMessage={errorMessage || (queryError instanceof Error ? queryError.message : null)}
        successMessage={successMessage}
      />

      <Dialog
        open={isConvertOrderDialogOpen}
        onClose={handleCloseConvertOrderDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Convert To Order</DialogTitle>
        <DialogContent>
          <Stack spacing={1.35} sx={{ mt: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              This will push to both Monday boards and create a linked CRM order from quote{' '}
              <strong>{convertOrderQuoteLabel || 'N/A'}</strong>.
            </Typography>

            {errorMessage ? (
              <Alert severity="error">{errorMessage}</Alert>
            ) : null}

            <TextField
              select
              fullWidth
              label="Primary Board (Locked)"
              value={convertOrderFormState.primaryBoardId}
              onChange={(event) => {
                updateConvertOrderField('primaryBoardId', event.target.value)
              }}
              helperText="All boards are shown, but only New Orders 2026 is selectable right now."
              disabled={isSubmittingConvertOrder}
            >
              {convertOrderBoardOptions.map((board) => {
                const boardId = String(board?.id ?? '').trim()

                if (!boardId) {
                  return null
                }

                return (
                  <MenuItem
                    key={boardId}
                    value={boardId}
                    disabled={boardId !== convertOrderPrimaryBoardId}
                  >
                    {String(board?.name ?? '').trim() || boardId}
                  </MenuItem>
                )
              })}
            </TextField>

            <TextField
              select
              fullWidth
              label="Secondary Board (Locked)"
              value={convertOrderFormState.secondaryBoardId}
              onChange={(event) => {
                updateConvertOrderField('secondaryBoardId', event.target.value)
              }}
              helperText="This order is also pushed to Design AKF."
              disabled={isSubmittingConvertOrder}
            >
              {convertOrderBoardOptions.map((board) => {
                const boardId = String(board?.id ?? '').trim()

                if (!boardId) {
                  return null
                }

                return (
                  <MenuItem
                    key={boardId}
                    value={boardId}
                    disabled={boardId !== convertOrderSecondaryBoardId}
                  >
                    {String(board?.name ?? '').trim() || boardId}
                  </MenuItem>
                )
              })}
            </TextField>

            <TextField
              required
              fullWidth
              label="P.O. Date"
              type="date"
              value={convertOrderFormState.poDate}
              onChange={(event) => {
                updateConvertOrderField('poDate', event.target.value)
              }}
              InputLabelProps={{ shrink: true }}
              disabled={isSubmittingConvertOrder}
            />

            <TextField
              fullWidth
              label="P.O. Number (Optional)"
              value={convertOrderFormState.poNumber}
              onChange={(event) => {
                updateConvertOrderField('poNumber', event.target.value)
              }}
              disabled={isSubmittingConvertOrder}
            />

            <TextField
              fullWidth
              label="Lead Time (Optional)"
              type="date"
              value={convertOrderFormState.leadTimeDate}
              onChange={(event) => {
                updateConvertOrderField('leadTimeDate', event.target.value)
              }}
              InputLabelProps={{ shrink: true }}
              disabled={isSubmittingConvertOrder}
            />

            <TextField
              required
              fullWidth
              label="Ship To"
              value={convertOrderFormState.shipTo}
              onChange={(event) => {
                updateConvertOrderField('shipTo', event.target.value)
              }}
              multiline
              minRows={2}
              disabled={isSubmittingConvertOrder}
            />

            <TextField
              fullWidth
              label="Notes (Optional)"
              value={convertOrderFormState.notes}
              onChange={(event) => {
                updateConvertOrderField('notes', event.target.value)
              }}
              multiline
              minRows={2}
              disabled={isSubmittingConvertOrder}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseConvertOrderDialog}
            disabled={isSubmittingConvertOrder}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              void handleSubmitConvertOrder()
            }}
            disabled={
              isSubmittingConvertOrder
              || !convertOrderFormState.poDate.trim()
              || !convertOrderFormState.shipTo.trim()
            }
          >
            {isSubmittingConvertOrder ? 'Converting...' : 'Convert To Order'}
          </Button>
        </DialogActions>
      </Dialog>

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
        open={isFolderScanSelectionDialogOpen}
        onClose={handleCloseFolderScanSelectionDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Select New Scanned Documents</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 0.6 }}>
            <Typography variant="body2">
              Quote <strong>{folderScanTargetQuote?.quoteNumber || 'N/A'}</strong> is ready. Choose which scanned files to upload.
            </Typography>

            <Typography variant="caption" color="text.secondary">
              Selected: {folderScanSelectedQueueCount} of {folderScanQueue.length}. Only new files are shown; only the main Excel file in Quotes is always included.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Viewing: {folderScanSelectionScopeLabel} ({folderScanVisibleEntriesCount} file{folderScanVisibleEntriesCount === 1 ? '' : 's'}).
            </Typography>

            {folderScanUploadSummary && !isUploadingFolderSelection ? (
              <Paper
                variant="outlined"
                sx={{
                  px: 1,
                  py: 0.8,
                  borderRadius: 1,
                  borderColor: folderScanUploadSummary.failedCount > 0
                    ? alpha('#b45309', 0.35)
                    : alpha('#166534', 0.35),
                  backgroundColor: folderScanUploadSummary.failedCount > 0
                    ? alpha('#f59e0b', 0.08)
                    : alpha('#16a34a', 0.08),
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    color: folderScanUploadSummary.failedCount > 0 ? '#92400e' : '#166534',
                  }}
                >
                  Uploaded {folderScanUploadSummary.uploadedCount} of {folderScanUploadSummary.attemptedCount} selected file{folderScanUploadSummary.attemptedCount === 1 ? '' : 's'}.
                </Typography>
                {folderScanUploadSummary.failedCount > 0 ? (
                  <Typography variant="caption" sx={{ color: '#92400e' }}>
                    {folderScanUploadSummary.failedCount} file{folderScanUploadSummary.failedCount === 1 ? '' : 's'} failed. You can retry or click Done.
                  </Typography>
                ) : (
                  <Typography variant="caption" sx={{ color: '#166534' }}>
                    Upload completed. You can close this screen or click Done.
                  </Typography>
                )}
              </Paper>
            ) : null}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.1} alignItems="stretch">
              <Stack
                spacing={0.5}
                sx={{
                  width: { xs: '100%', md: 230 },
                  flexShrink: 0,
                  border: `1px solid ${alpha('#0f4c81', 0.2)}`,
                  borderRadius: 1.1,
                  backgroundColor: '#ffffff',
                  p: 0.8,
                }}
              >
                {folderScanSidebarSections.map((section) => {
                  if (section.key === 'all') {
                    return (
                      <Button
                        key={section.key}
                        size="small"
                        variant={folderScanActiveSidebarKey === 'all' ? 'contained' : 'text'}
                        onClick={() => {
                          setFolderScanActiveSidebarKey('all')
                          setFolderScanExpandedSidebarFolderKey(null)
                          setFolderScanActiveNestedPath(null)
                        }}
                        sx={{
                          justifyContent: 'space-between',
                          textTransform: 'none',
                          fontWeight: 700,
                          px: 1,
                        }}
                      >
                        <span>{section.label}</span>
                        <span>{section.selectedCount}/{section.totalCount}</span>
                      </Button>
                    )
                  }

                  const folderKey = section.key as QuoteSidebarFolderKey
                  const nestedSections = folderScanNestedSectionsByFolder.get(folderKey) ?? []
                  const isExpanded = folderScanExpandedSidebarFolderKey === folderKey

                  return (
                    <Stack key={section.key} spacing={0.35}>
                      <Button
                        size="small"
                        variant={folderScanActiveSidebarKey === folderKey ? 'contained' : 'text'}
                        onClick={() => {
                          setFolderScanActiveSidebarKey(folderKey)
                          setFolderScanActiveNestedPath(null)
                          setFolderScanExpandedSidebarFolderKey((current) => (
                            current === folderKey ? null : folderKey
                          ))
                        }}
                        sx={{
                          justifyContent: 'space-between',
                          textTransform: 'none',
                          fontWeight: 700,
                          px: 1,
                        }}
                      >
                        <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
                          {nestedSections.length > 0 ? (
                            <ArrowDropDownRoundedIcon
                              sx={{
                                fontSize: 17,
                                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform 0.15s ease',
                              }}
                            />
                          ) : null}
                          <span>{section.label}</span>
                        </Stack>
                        <span>{section.selectedCount}/{section.totalCount}</span>
                      </Button>

                      {isExpanded && nestedSections.length > 0 ? (
                        <Stack spacing={0.25} sx={{ pb: 0.2 }}>
                          {nestedSections.map((nestedSection) => {
                            const isActiveNestedSection = (
                              folderScanActiveSidebarKey === folderKey
                              && folderScanActiveNestedPath === nestedSection.path
                            )

                            return (
                              <Button
                                key={`${folderKey}::${nestedSection.path}`}
                                size="small"
                                variant={isActiveNestedSection ? 'contained' : 'text'}
                                onClick={() => {
                                  setFolderScanActiveSidebarKey(folderKey)
                                  setFolderScanExpandedSidebarFolderKey(folderKey)
                                  setFolderScanActiveNestedPath(nestedSection.path)
                                }}
                                sx={{
                                  alignSelf: 'flex-end',
                                  width: 'calc(100% - 14px)',
                                  justifyContent: 'space-between',
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  pl: 2,
                                  pr: 1,
                                  minHeight: 27,
                                }}
                              >
                                <span>{nestedSection.path}</span>
                                <span>{nestedSection.selectedCount}/{nestedSection.totalCount}</span>
                              </Button>
                            )
                          })}
                        </Stack>
                      ) : null}
                    </Stack>
                  )
                })}
              </Stack>

              <Stack spacing={0.7} sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="text"
                    disabled={folderScanVisibleEntriesCount === 0 || isUploadingFolderSelection}
                    onClick={() => {
                      handleSetAllFolderScanEntries(true)
                    }}
                  >
                    Select shown
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    disabled={folderScanVisibleEntriesCount === 0 || isUploadingFolderSelection}
                    onClick={() => {
                      handleSetAllFolderScanEntries(false)
                    }}
                  >
                    Clear shown
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="inherit"
                    disabled={folderScanQueue.length === 0 || isUploadingFolderSelection}
                    onClick={handleClearFolderScanEntries}
                  >
                    Clear scanned list
                  </Button>
                </Stack>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 0.9,
                    borderRadius: 1,
                    borderColor: alpha('#0f4c81', 0.2),
                    backgroundColor: '#ffffff',
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  {folderScanQueue.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No scanned files queued.
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      {folderScanVisibleSections.map((section) => {
                        const sectionSelectedCount = section.entries.filter((entry) => entry.selected && !entry.duplicateBlocked).length

                        return (
                          <Stack key={section.key} spacing={0.45}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              {section.label} ({sectionSelectedCount}/{section.entries.length})
                            </Typography>

                            {section.entries.length === 0 ? (
                              <Typography variant="caption" color="text.secondary">
                                No scanned files in this folder.
                              </Typography>
                            ) : (
                              <Stack spacing={0.6}>
                                {section.entries.map((entry) => (
                                  <Stack key={entry.id} direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                                    <Checkbox
                                      size="small"
                                      checked={entry.selected}
                                      disabled={entry.duplicateBlocked || isUploadingFolderSelection}
                                      onChange={(_event, checked) => {
                                        handleToggleFolderScanEntry(entry.id, checked)
                                      }}
                                    />
                                    <Stack spacing={0.1} sx={{ flex: 1, minWidth: 0 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {entry.file.name}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {entry.relativePath}
                                      </Typography>
                                      {entry.duplicateReason ? (
                                        <Typography variant="caption" color="warning.main">
                                          {entry.duplicateReason}
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  </Stack>
                                ))}
                              </Stack>
                            )}
                          </Stack>
                        )
                      })}
                    </Stack>
                  )}
                </Paper>
              </Stack>
            </Stack>

            {isUploadingFolderSelection && folderScanUploadProgress.total > 0 ? (
              <Typography variant="caption" color="text.secondary">
                Uploading {folderScanUploadProgress.completed} / {folderScanUploadProgress.total}...
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseFolderScanSelectionDialog}
            disabled={isUploadingFolderSelection}
          >
            {folderScanUploadSummary ? 'Done' : 'Close'}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (folderScanSelectedQueueCount > 0) {
                void handleUploadSelectedFolderEntries()
                return
              }

              handleCloseFolderScanSelectionDialog()
            }}
            disabled={
              !canManage
              || isUploadingFolderSelection
              || (folderScanSelectedQueueCount === 0 && !folderScanUploadSummary)
            }
          >
            {isUploadingFolderSelection
              ? 'Uploading...'
              : (folderScanSelectedQueueCount > 0
                ? `Upload Selected (${folderScanSelectedQueueCount})`
                : 'Done')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(selectedOpportunityActiveNestedFolderGroup)}
        onClose={() => {
          setSelectedOpportunityNestedFolderPath(null)
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedOpportunitySidebarFolder?.label || 'Folder'}
          {selectedOpportunityActiveNestedFolderGroup ? ` / ${selectedOpportunityActiveNestedFolderGroup.path}` : ''}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 0.6 }}>
            {selectedOpportunityActiveNestedFolderGroup ? (
              <Typography variant="caption" color="text.secondary">
                {selectedOpportunityActiveNestedFolderGroup.documents.length} file{selectedOpportunityActiveNestedFolderGroup.documents.length === 1 ? '' : 's'} in this folder.
              </Typography>
            ) : null}

            {selectedOpportunityActiveNestedFolderGroup && selectedOpportunityActiveNestedFolderGroup.documents.length > 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 0.9,
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(3, minmax(0, 1fr))',
                  },
                }}
              >
                {selectedOpportunityActiveNestedFolderGroup.documents.map((document) => {
                  const documentDisplayName = resolveDocumentDisplayName(document)
                  const documentLeafName = resolveDocumentLeafName(document, selectedOpportunitySidebarFolderKey)
                  const previewKind = resolveDocumentPreviewKind(document)
                  const previewSource = resolveDocumentPreviewSource(document, previewKind)

                  return (
                    <Paper
                      key={`nested-doc-${document.url}`}
                      variant="outlined"
                      sx={{
                        p: 1,
                        borderRadius: 1,
                        borderColor: alpha('#0f4c81', 0.2),
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <Stack spacing={0.7} sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                          <Chip
                            size="small"
                            label={resolveDocumentTypeLabel(document)}
                            sx={{
                              height: 20,
                              fontSize: 11,
                              fontWeight: 700,
                              backgroundColor: alpha('#0f4c81', 0.1),
                              color: '#0f4c81',
                            }}
                          />
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canManage || busyQuoteId === selectedOpportunityId || isUploadingFolderSelection}
                            onClick={() => {
                              void handleRemoveSelectedOpportunityDocument(document.url)
                            }}
                          >
                            <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>

                        <Box
                          component="a"
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            display: 'block',
                            height: 122,
                            borderRadius: 0.9,
                            overflow: 'hidden',
                            border: `1px solid ${alpha('#0f4c81', 0.18)}`,
                            backgroundColor: alpha('#0f4c81', 0.04),
                            textDecoration: 'none',
                          }}
                        >
                          {previewKind === 'image' && previewSource ? (
                            <Box
                              component="img"
                              src={previewSource}
                              alt={documentLeafName || documentDisplayName}
                              sx={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                          ) : null}

                          {previewKind !== 'image' && previewSource ? (
                            <Box
                              component="iframe"
                              src={previewSource}
                              title={`preview-${documentDisplayName}`}
                              sx={{
                                width: '100%',
                                height: '100%',
                                border: 0,
                                display: 'block',
                                pointerEvents: 'none',
                                backgroundColor: '#ffffff',
                              }}
                            />
                          ) : null}

                          {!previewSource ? (
                            <Stack
                              alignItems="center"
                              justifyContent="center"
                              sx={{ height: '100%', px: 1 }}
                            >
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f4c81' }}>
                                Preview unavailable
                              </Typography>
                            </Stack>
                          ) : null}
                        </Box>

                        <Link
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          sx={{
                            minWidth: 0,
                            display: 'block',
                            fontWeight: 600,
                            lineHeight: 1.3,
                            wordBreak: 'break-word',
                          }}
                        >
                          {documentLeafName}
                        </Link>

                        {documentDisplayName !== documentLeafName ? (
                          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                            {documentDisplayName}
                          </Typography>
                        ) : null}

                        <Button
                          size="small"
                          variant="outlined"
                          component="a"
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            alignSelf: 'flex-start',
                            textTransform: 'none',
                            fontWeight: 700,
                          }}
                        >
                          Open File
                        </Button>
                      </Stack>
                    </Paper>
                  )
                })}
              </Box>
            ) : (
              <Typography variant="caption" color="text.secondary">
                No files found in this folder.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSelectedOpportunityNestedFolderPath(null)
            }}
          >
            Close
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
                No direct account name match found. Select one manually, create a new account, or choose Create no account.
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
              <Chip
                clickable
                color={excelSyncAccountMode === 'none' ? 'primary' : 'default'}
                variant={excelSyncAccountMode === 'none' ? 'filled' : 'outlined'}
                label="Create no account"
                onClick={() => {
                  setExcelSyncAccountMode('none')
                  setExcelSyncDealerSourceIdInput('')
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
            ) : excelSyncAccountMode === 'create' ? (
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
            ) : (
              <Typography variant="caption" color="text.secondary">
                No account will be created or linked. The quote will keep the company name from Excel.
              </Typography>
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
                value={
                  excelSyncResolvedDealerName
                  || excelSyncResolvedDealerSourceId
                  || (excelSyncAccountMode === 'none' ? 'Create no account' : '')
                }
                InputProps={{ readOnly: true }}
                helperText={excelSyncAccountMode === 'none'
                  ? 'No account will be created or linked for this quote.'
                  : 'Selected in step 1.'}
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

      {!detailsOnly ? <>
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          overflow: 'hidden',
          borderColor: alpha('#0f4c81', 0.16),
          boxShadow: '0 12px 36px rgba(15, 76, 129, 0.08)',
        }}
      >
        <Box
          sx={{
            p: 0.55,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 0.55,
            borderBottom: 1,
            borderColor: alpha('#0f4c81', 0.1),
            backgroundColor: alpha('#eaf4ff', 0.55),
          }}
        >
          {stageDefinitions.map((stage) => {
            const summary = stageSummaries.get(stage.id) || { count: 0 }
            const isActive = activePipelineStage === stage.id

            return (
              <Button
                key={stage.id}
                onClick={() => setActivePipelineStage(stage.id)}
                variant="text"
                aria-pressed={isActive}
                sx={{
                  px: 1,
                  py: 0.5,
                  justifyContent: 'stretch',
                  textTransform: 'none',
                  color: '#0b2239',
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: isActive ? alpha(stage.headerColor, 0.48) : alpha('#0f4c81', 0.12),
                  backgroundColor: isActive ? '#ffffff' : 'transparent',
                  boxShadow: isActive ? `0 4px 14px ${alpha(stage.headerColor, 0.11)}` : 'none',
                  '&:hover': {
                    backgroundColor: '#ffffff',
                    borderColor: alpha(stage.headerColor, 0.38),
                  },
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ width: '100%' }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: 1,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        fontWeight: 800,
                        color: isActive ? '#ffffff' : stage.headerColor,
                        backgroundColor: isActive ? stage.headerColor : alpha(stage.headerColor, 0.1),
                        fontSize: 12,
                      }}
                    >
                      {stage.id === 'concept' ? '1' : '2'}
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      {stage.label.replace(/^\d+\.\s*/, '')}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={summary.count}
                    sx={{ height: 20, minWidth: 30, fontWeight: 800, color: stage.headerColor, backgroundColor: alpha(stage.headerColor, 0.08) }}
                  />
                </Stack>
              </Button>
            )
          })}
        </Box>

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={0.7}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', lg: 'center' }}
          sx={{
            px: { xs: 1.1, md: 1.3 },
            py: 0.75,
            backgroundColor: '#ffffff',
          }}
        >
          <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
            <WorkspacesRoundedIcon sx={{ color: '#0f4c81', fontSize: 19 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0b2239' }}>
              Opportunities
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.55} alignItems="center">
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
              sx={{ width: { xs: '100%', sm: 245 } }}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<FileUploadRoundedIcon fontSize="small" />}
              endIcon={<ArrowDropDownRoundedIcon fontSize="small" />}
              disabled={!canManage || isSyncingExcelQuote || isUploadingFolderSelection}
              onClick={handleOpenUploadQuoteActionMenu}
            >
              {isSyncingExcelQuote ? 'Syncing Excel...' : (isUploadingFolderSelection ? 'Scanning Folder...' : 'Sync Excel Sheet')}
            </Button>
            <Button
              size="small"
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
              size="small"
              variant="contained"
              startIcon={<AddRoundedIcon fontSize="small" />}
              onClick={handleOpenDialog}
              disabled={!canManage}
            >
              Add Opportunity
            </Button>

            <Menu
              anchorEl={uploadQuoteActionMenuAnchorEl}
              open={isUploadQuoteActionMenuOpen}
              onClose={handleCloseUploadQuoteActionMenu}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                disabled={!canManage || isSyncingExcelQuote || isUploadingFolderSelection}
                onClick={handleOpenUploadQuoteExcelPicker}
              >
                Sync Excel Sheet
              </MenuItem>
              <MenuItem
                disabled={!canManage || isSyncingExcelQuote || isUploadingFolderSelection}
                onClick={handleOpenUploadQuoteFolderScanner}
              >
                Scan Folder
              </MenuItem>
            </Menu>
            <input
              hidden
              ref={pipelineUploadExcelInputRef}
              type="file"
              accept=".xls,.xlsx,.xlsm,.ods,.csv"
              onChange={handleExcelQuoteSyncUpload}
            />
            <input
              hidden
              ref={folderScanInputRef}
              type="file"
              multiple
              onChange={(event) => {
                void handleFolderScanUpload(event)
              }}
            />
          </Stack>
        </Stack>

      </Paper>

      <StageColumn
        key={activePipelineStage}
        stage={activePipelineStageDefinition}
        rows={stageBuckets[activePipelineStage]}
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

            <Autocomplete
              options={excelSyncDealerOptions}
              value={dealersBySourceId.get(formState.dealerSourceId) ?? null}
              onChange={(_event, value) => {
                setFormState((current) => ({
                  ...current,
                  dealerSourceId: value?.sourceId || '',
                  companyName: value?.name || current.companyName,
                }))
              }}
              isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
              getOptionLabel={(option) => resolveDealerSelectionLabel(option)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  required
                  label="Dealer Account"
                  helperText="Select the CRM dealer account that owns this opportunity."
                />
              )}
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
              || !formState.dealerSourceId.trim()
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
      </> : null}

      <Dialog
        open={Boolean(selectedOpportunity && opportunityDetailsFormState)}
        onClose={handleCloseOpportunityDetails}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: {
            width: 'min(1560px, 97vw)',
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
              {detailsOnly ? 'Quote Details' : 'Opportunity Details'}
            </Typography>
            <Typography variant="caption" sx={{ color: alpha('#0b2239', 0.78) }}>
              {detailsOnly
                ? 'Review and update this saved quote.'
                : 'Update details here. Upload quote packages from the pipeline header.'}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.6} alignItems="center">
            {canUseProposalDetailsActions ? (
              <IconButton
                size="medium"
                disabled={
                  isSavingOpportunityDetails
                  || isUploadingFolderSelection
                  || isSendingSelectedOpportunityChat
                }
                onClick={(event) => {
                  setDetailsActionMenuAnchorEl(event.currentTarget)
                }}
              >
                <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            ) : null}
          </Stack>
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
            disabled={
              !canUseProposalDetailsActions
              || isSavingOpportunityDetails
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
            }
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              void handleSaveOpportunityDetails('decline')
            }}
          >
            Declined
          </MenuItem>
          <MenuItem
            disabled={
              !canUseProposalDetailsActions
              || isSavingOpportunityDetails
              || isSubmittingConvertOrder
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
            }
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              if (selectedOpportunity) {
                openConvertOrderDialog(selectedOpportunity)
              }
            }}
          >
            Convert to order
          </MenuItem>
          <MenuItem
            disabled={
              !canUseProposalDetailsActions
              || isSavingOpportunityDetails
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
            }
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
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems="stretch">
                <Stack
                  spacing={0.6}
                  sx={{
                    width: { xs: '100%', md: 232 },
                    flexShrink: 0,
                    border: `1px solid ${alpha('#0f4c81', 0.2)}`,
                    borderRadius: 1.2,
                    backgroundColor: '#ffffff',
                    p: 0.8,
                  }}
                >
                  <Button
                    size="small"
                    variant={selectedOpportunityDetailsTab === 'details' ? 'contained' : 'text'}
                    onClick={() => {
                      setSelectedOpportunityDetailsTab('details')
                    }}
                    sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 700 }}
                  >
                    Details
                  </Button>

                  <Stack
                    spacing={0.2}
                    sx={{
                      py: 0.4,
                      borderTop: `1px solid ${alpha('#0f4c81', 0.16)}`,
                      borderBottom: `1px solid ${alpha('#0f4c81', 0.16)}`,
                    }}
                  >
                    {quoteSidebarFolders.map((folder) => {
                      const folderDocumentCount = (selectedOpportunityDocumentsByFolder.get(folder.key) ?? []).length
                      const folderNestedGroups = selectedOpportunityNestedGroupsByFolder.get(folder.key) ?? []
                      const isFolderSelected = selectedOpportunityDetailsTab === folder.key

                      return (
                        <Stack key={folder.key} spacing={0.25}>
                          <Button
                            size="small"
                            variant={isFolderSelected ? 'contained' : 'text'}
                            onClick={() => {
                              setSelectedOpportunityDetailsTab(folder.key)
                              setSelectedOpportunityNestedFolderPath(null)
                            }}
                            sx={{
                              justifyContent: 'space-between',
                              textTransform: 'none',
                              fontWeight: 600,
                              px: 1,
                            }}
                          >
                            <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
                              {folderNestedGroups.length > 0 ? (
                                <ArrowDropDownRoundedIcon
                                  sx={{
                                    fontSize: 17,
                                    transform: isFolderSelected ? 'rotate(0deg)' : 'rotate(-90deg)',
                                    transition: 'transform 0.15s ease',
                                  }}
                                />
                              ) : null}
                              <span>{folder.label}</span>
                            </Stack>
                            <span>{folderDocumentCount}</span>
                          </Button>

                          {isFolderSelected && folderNestedGroups.length > 0 ? (
                            <Stack spacing={0.2} sx={{ pb: 0.15 }}>
                              {folderNestedGroups.map((group) => {
                                const isActiveNestedFolder = selectedOpportunityNestedFolderPath === group.path

                                return (
                                  <Button
                                    key={`${folder.key}::${group.path}`}
                                    size="small"
                                    variant={isActiveNestedFolder ? 'contained' : 'text'}
                                    onClick={() => {
                                      setSelectedOpportunityDetailsTab(folder.key)
                                      setSelectedOpportunityNestedFolderPath(group.path)
                                    }}
                                    sx={{
                                      alignSelf: 'flex-end',
                                      width: 'calc(100% - 14px)',
                                      justifyContent: 'space-between',
                                      textTransform: 'none',
                                      fontWeight: 600,
                                      pl: 2,
                                      pr: 1,
                                      minHeight: 27,
                                    }}
                                  >
                                    <span>{group.path}</span>
                                    <span>{group.documents.length}</span>
                                  </Button>
                                )
                              })}
                            </Stack>
                          ) : null}
                        </Stack>
                      )
                    })}
                  </Stack>

                  <Button
                    size="small"
                    variant={selectedOpportunityDetailsTab === 'chat' ? 'contained' : 'text'}
                    onClick={() => {
                      setSelectedOpportunityDetailsTab('chat')
                    }}
                    sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 700 }}
                  >
                    {selectedOpportunityChatCount > 0 ? `Chat (${selectedOpportunityChatCount})` : 'Chat'}
                  </Button>
                </Stack>

                <Stack spacing={1.2} sx={{ flex: 1, minWidth: 0 }}>

              {selectedOpportunityDetailsTab === 'details' ? (
                <>
              {selectedOpportunity.convertedOrderId ? (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: alpha('#0f4c81', 0.28),
                    background: `linear-gradient(135deg, ${alpha('#0f4c81', 0.11)} 0%, ${alpha('#4f9ac9', 0.07)} 100%)`,
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: 1.4,
                        display: 'grid',
                        placeItems: 'center',
                        color: '#0f4c81',
                        bgcolor: alpha('#0f4c81', 0.12),
                        flexShrink: 0,
                      }}
                    >
                      <WorkspacesRoundedIcon />
                    </Box>
                    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="overline" sx={{ color: '#0f4c81', fontWeight: 800, lineHeight: 1.2 }}>
                        Accepted Into Order
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        {selectedOpportunity.convertedOrderNumber || selectedOpportunity.orderNumber || 'Linked order'}
                      </Typography>
                      {selectedOpportunity.convertedAt ? (
                        <Typography variant="caption" color="text.secondary">
                          Converted {formatOpportunityLikeDate(selectedOpportunity.convertedAt)}
                        </Typography>
                      ) : null}
                    </Stack>
                    <Button
                      variant="contained"
                      endIcon={<ArrowForwardRoundedIcon />}
                      onClick={() => {
                        window.open(`/orders?orderId=${encodeURIComponent(selectedOpportunity.convertedOrderId || '')}`, '_blank', 'noopener,noreferrer')
                      }}
                      sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                      Open order details
                    </Button>
                  </Stack>
                </Paper>
              ) : null}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <Autocomplete
                  options={excelSyncDealerOptions}
                  value={dealersBySourceId.get(opportunityDetailsFormState.dealerSourceId) ?? null}
                  onChange={(_event, value) => {
                    setOpportunityDetailsFormState((current) => {
                      if (!current || !value) {
                        return current
                      }

                      return {
                        ...current,
                        dealerSourceId: value.sourceId,
                        companyName: value.name || current.companyName,
                      }
                    })
                  }}
                  isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                  getOptionLabel={(option) => resolveDealerSelectionLabel(option)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Dealer Account"
                      helperText={opportunityDetailsFormState.dealerSourceId
                        ? 'This account is linked to the quote.'
                        : 'Select an account before converting this quote to an order.'}
                    />
                  )}
                  disabled={!canManage}
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

                </>
              ) : null}

              {selectedOpportunitySidebarFolder ? (
                <Stack spacing={0.9}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    {selectedOpportunitySidebarFolder.label}
                  </Typography>

                  <Typography variant="caption" color="text.secondary">
                    Upload quote packages from the Sales Opportunities Pipeline header using Sync Excel Sheet / Scan Folder.
                  </Typography>

                  <Stack spacing={0.6}>
                    {selectedOpportunityFolderDocuments.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        No files uploaded in this folder yet.
                      </Typography>
                    ) : (
                      <Stack spacing={0.9}>
                        {selectedOpportunityFolderRootDocuments.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            Files in this tab are organized in nested folders. Use the left sidebar subfolders to open them.
                          </Typography>
                        ) : (
                          <Box
                            sx={{
                              display: 'grid',
                              gap: 0.9,
                              gridTemplateColumns: {
                                xs: '1fr',
                                sm: 'repeat(2, minmax(0, 1fr))',
                                lg: 'repeat(3, minmax(0, 1fr))',
                              },
                            }}
                          >
                            {selectedOpportunityFolderRootDocuments.map((document) => {
                              const documentDisplayName = resolveDocumentDisplayName(document)
                              const documentLeafName = resolveDocumentLeafName(document, selectedOpportunitySidebarFolderKey)
                              const previewKind = resolveDocumentPreviewKind(document)
                              const previewSource = resolveDocumentPreviewSource(document, previewKind)

                              return (
                                <Paper
                                  key={document.url}
                                  variant="outlined"
                                  sx={{
                                    p: 1,
                                    borderRadius: 1,
                                    borderColor: alpha('#0f4c81', 0.2),
                                    backgroundColor: '#ffffff',
                                  }}
                                >
                                  <Stack spacing={0.7} sx={{ minWidth: 0 }}>
                                    <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                                      <Chip
                                        size="small"
                                        label={resolveDocumentTypeLabel(document)}
                                        sx={{
                                          height: 20,
                                          fontSize: 11,
                                          fontWeight: 700,
                                          backgroundColor: alpha('#0f4c81', 0.1),
                                          color: '#0f4c81',
                                        }}
                                      />
                                      <IconButton
                                        size="small"
                                        color="error"
                                        disabled={!canManage || busyQuoteId === selectedOpportunityId || isUploadingFolderSelection}
                                        onClick={() => {
                                          void handleRemoveSelectedOpportunityDocument(document.url)
                                        }}
                                      >
                                        <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Stack>

                                    <Box
                                      component="a"
                                      href={document.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{
                                        display: 'block',
                                        height: 122,
                                        borderRadius: 0.9,
                                        overflow: 'hidden',
                                        border: `1px solid ${alpha('#0f4c81', 0.18)}`,
                                        backgroundColor: alpha('#0f4c81', 0.04),
                                        textDecoration: 'none',
                                      }}
                                    >
                                      {previewKind === 'image' && previewSource ? (
                                        <Box
                                          component="img"
                                          src={previewSource}
                                          alt={documentLeafName || documentDisplayName}
                                          sx={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                            display: 'block',
                                          }}
                                        />
                                      ) : null}

                                      {previewKind !== 'image' && previewSource ? (
                                        <Box
                                          component="iframe"
                                          src={previewSource}
                                          title={`preview-${documentDisplayName}`}
                                          sx={{
                                            width: '100%',
                                            height: '100%',
                                            border: 0,
                                            display: 'block',
                                            pointerEvents: 'none',
                                            backgroundColor: '#ffffff',
                                          }}
                                        />
                                      ) : null}

                                      {!previewSource ? (
                                        <Stack
                                          alignItems="center"
                                          justifyContent="center"
                                          sx={{ height: '100%', px: 1 }}
                                        >
                                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f4c81' }}>
                                            Preview unavailable
                                          </Typography>
                                        </Stack>
                                      ) : null}
                                    </Box>

                                    <Link
                                      href={document.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      underline="hover"
                                      sx={{
                                        minWidth: 0,
                                        display: 'block',
                                        fontWeight: 600,
                                        lineHeight: 1.3,
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      {documentLeafName}
                                    </Link>

                                    {documentDisplayName !== documentLeafName ? (
                                      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                                        {documentDisplayName}
                                      </Typography>
                                    ) : null}

                                    <Button
                                      size="small"
                                      variant="outlined"
                                      component="a"
                                      href={document.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{
                                        alignSelf: 'flex-start',
                                        textTransform: 'none',
                                        fontWeight: 700,
                                      }}
                                    >
                                      Open File
                                    </Button>
                                  </Stack>
                                </Paper>
                              )
                            })}
                          </Box>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Stack>
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
                    placeholder="Add a note that stays with this quote (/refresh also works)"
                    sx={{ flex: 1 }}
                  />

                  <Stack spacing={0.4} sx={{ minWidth: { xs: 0, sm: 240 } }}>
                    {selectedOpportunityChatDraft.trim().length > 0 ? (
                      <FormControlLabel
                        sx={{ m: 0, alignItems: 'flex-start' }}
                        control={(
                          <Checkbox
                            size="small"
                            checked={selectedOpportunityRefreshOnSend}
                            onChange={(event) => {
                              setSelectedOpportunityRefreshOnSend(event.target.checked)
                            }}
                            disabled={!canManage || isSendingSelectedOpportunityChat}
                          />
                        )}
                        label={(
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                            Refresh quote age date on send
                          </Typography>
                        )}
                      />
                    ) : null}

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
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseOpportunityDetails}
            disabled={
              isSavingOpportunityDetails
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
            }
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
              || isUploadingFolderSelection
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
