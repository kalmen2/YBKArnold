import { DialogFeedback } from '../components/DialogFeedback'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import FilterAltOffRoundedIcon from '@mui/icons-material/FilterAltOffRounded'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Alert,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemText,
  ListItemIcon,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Step,
  StepButton,
  Stepper,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { useAuth } from '../auth/useAuth'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmDealer,
  createCrmDealerContact,
  convertCrmQuoteToOrder,
  addCrmQuoteLeadTime,
  createCrmQuote,
  createCrmQuoteChatMessage,
  createCrmQuoteRevision,
  convertCrmQuoteWorkbook,
  fetchCrmConvertOrderBoards,
  fetchCrmDealers,
  fetchCrmContacts,
  fetchCrmExcelQuoteLookup,
  fetchCrmQuoteDetails,
  fetchCrmDocumentTerms,
  fetchCrmPlaceSuggestions,
  fetchCrmQuotePrintSettings,
  fetchCrmQuoteLineLibrary,
  createCrmQuoteLineLibraryEntry,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  markCrmQuoteFollowedUp,
  removeCrmQuote,
  removeCrmQuoteRevision,
  updateCrmContact,
  updateCrmDealer,
  updateCrmQuote,
  type CrmDealer,
  type CrmContact,
  type CrmConvertOrderBoardOption,
  type CrmExcelQuoteLookupResponse,
  type CrmExcelQuoteImportSummary,
  type CrmExcelQuoteSyncInput,
  type CrmQuoteLineImage,
  type CrmQuoteLineItem,
  type CrmQuoteServiceItem,
  type CrmQuoteServiceLocation,
  type CrmPlaceSuggestion,
  type CrmOpportunityStage,
  type CrmQuote,
  type CrmQuotePrintSettings,
  type CrmQuoteLineLibraryEntry,
  type CrmQuoteTotalPriceType,
} from '../features/crm/api'
import { resolveQuoteAgeDays } from '../features/crm/utils'
import { QuoteChatPanel } from '../features/crm/QuoteChatPanel'
import {
  buildBillOfLadingBlob,
  buildOrderDocumentData,
  buildOrderDocumentBlob,
  buildProformaInvoiceBlob,
  buildWorkOrderDocumentBlob,
  groupOrderDocumentTerms,
  type OrderDocumentLine,
} from '../features/crm/OrderConversionDocuments'
import { resolveFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { formatCurrency } from '../lib/formatters'
import { runAppProcess } from '../lib/appProcesses'
import { evaluateQuoteFormula } from '../features/crm/quoteFormula'
import {
  calculateExtendedPrice,
  copyQuoteLineDetailToSubline,
  createEmptyQuoteLine as createEmptyLineItemFormState,
  duplicateQuoteLineBlock,
  duplicateQuoteSubline,
  joinQuoteLineDescription,
  moveQuoteLineBlock,
  quoteFormulaHint as formulaHint,
  QUOTE_PRODUCT_MAX_LENGTH,
  splitQuoteLineDescription,
  updateQuoteLinePricing as updateLineItemPricing,
  type QuoteLineFormState,
} from '../features/crm/quoteLines'
import { OpportunityListView } from '../features/crm/OpportunityListView'
import type { QuoteFormState, QuoteServiceItemFormState } from '../features/crm/quoteFormState'
import { NewQuoteDialog } from '../features/crm/newQuote/NewQuoteDialog'
import { QuoteFieldLabel } from '../features/crm/QuoteFieldLabel'
import { QuoteTotalsBar } from '../features/crm/QuoteTotalsBar'
import { QUERY_KEYS } from '../lib/queryKeys'

const DEFAULT_OPPORTUNITY_TITLE_PREFIX = 'Opportunity '
const DEFAULT_WEBSITE_PAYMENT_TERMS = '50% Deposit / 50% CBD'
const DEFAULT_NEW_ORDERS_2026_BOARD_ID = '18393945685'
const DEFAULT_DESIGN_AKF_BOARD_ID = '1064270065'
const QuotePdfPreviewDialog = lazy(() => import('../features/crm/NativeQuotePdf').then((module) => ({
  default: module.QuotePdfPreviewDialog,
})))
const QuotePdfPictureLayoutDialog = lazy(() => import('../features/crm/NativeQuotePdf').then((module) => ({
  default: module.QuotePdfPictureLayoutDialog,
})))
const DEFAULT_QUOTE_PRINT_SETTINGS: CrmQuotePrintSettings = {
  id: 'default',
  logoUrl: '/arnold-quote-logo.png',
  logoName: 'Arnold Contract',
  companyName: 'Arnold Contract',
  addressLines: [],
  phone: null,
  email: null,
  website: null,
  headerText: null,
  footerText: 'Thank you for the opportunity to quote this project.',
  accentColor: '#0f4c81',
  showPaymentTerms: true,
  showLeadTime: true,
  showFreight: true,
  customerInformation: '',
  projectManagers: 'Misha Patel, Jose Gonzalez',
  depositRequestBody: 'To begin processing this order, please send the 50% Product Net deposit shown above at your earliest convenience.',
  depositRequestTerms: 'Color samples and shop drawings must be received and approved when required. Delays in receiving required approvals may affect the stated lead time.\n\nCustom orders are final and cannot be returned, exchanged, or refunded.',
  orderConfirmationRequestedInfo: 'Please send the control sample to the address below:\n\nArnold Kolax Furniture Inc.\nAttn: Misha Patel (Ack # {ack})\n120 Coit Street, Irvington, NJ 07111',
  orderConfirmationNotes: 'Thank you for your order. We appreciate your business and look forward to working with you.',
  orderConfirmationTerms: 'Lead times begin after final approved shop drawings and finish samples are received.',
  updatedAt: null,
  updatedByEmail: null,
  leadTimeOptions: ['6 to 8 weeks', '8 to 10 weeks', '10 to 12 weeks'],
}

async function parseExcelQuoteForSync(file: File, preferredQuoteNumber?: string) {
  const parser = await import('../features/crm/excelQuoteParser')
  return parser.parseExcelQuoteForSync(file, { preferredQuoteNumber })
}

type ExcelSyncEmbeddedImage = {
  mainLineIndex: number
  sourceRow: number
  file: File
}

type ParsedExcelQuoteSyncInput = CrmExcelQuoteSyncInput & {
  importSummary: CrmExcelQuoteImportSummary
  embeddedLineImages: ExcelSyncEmbeddedImage[]
}

type OpportunityLineItemFormState = QuoteLineFormState

type QuoteImageShape = 'square' | 'landscape' | 'wide' | 'portrait'
type QuoteImageDisplaySize = 'small' | 'medium' | 'large'

type PreparedQuoteImage = {
  file: File
  shape: QuoteImageShape
  displaySize: QuoteImageDisplaySize
}

type QuoteImageCropTarget = {
  index: number
  file: File
  imageId?: string
  shape?: QuoteImageShape
  displaySize?: QuoteImageDisplaySize
}


type OpportunityServiceItemFormState = QuoteServiceItemFormState
type OpportunityFormState = QuoteFormState

type AddOpportunityStage = 0 | 1 | 2 | 3 | 4

const ADD_OPPORTUNITY_STAGES = [
  'Account Information',
  'Quote Lines',
  'Services & Delivery',
  'Review & Submit',
  'Chat',
] as const

// Review & Submit is the last required stage. Chat sits past it as an optional
// side trip: reachable by its tab, never in the way of submitting.
const LAST_REQUIRED_ADD_STAGE = 3

type NewDealerFormState = {
  name: string
  email: string
  phone: string
  city: string
  state: string
  salesRep: string
  paymentTerms: string
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
  projectType: string
  leadTime: string
  paymentTerms: string
  subtotal: string
  discountPercent: string
  discountScope: 'products' | 'products_and_freight'
  totalPriceType: CrmQuoteTotalPriceType
  freight: string
  freightDescription: string
  notes: string
  lineItems: OpportunityLineItemFormState[]
  additionalServices: OpportunityServiceItemFormState[]
  shippingServices: OpportunityServiceItemFormState[]
  origin: 'website' | 'excel'
  sourceWorkbookUrl: string
  sourceWorkbookName: string
  convertedPdfUrl: string
  convertedPdfName: string
}

type OpportunityConvertOrderFormState = {
  primaryBoardId: string
  secondaryBoardId: string
  acknowledgmentNumber: string
  poDate: string
  poNumber: string
  leadTime: string
  shipTo: string
  notes: string
  depositRequirement: '' | 'required' | 'not_required'
  depositPercent: string
  selectedLineItemIds: string[]
  selectedAdditionalServiceIds: string[]
  selectedShippingServiceIds: string[]
  includeFreight: boolean
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
  onMarkApproved: (quote: CrmQuote) => void
  onMarkFollowedUp: (quote: CrmQuote) => void
  onDeclineQuote: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onPrintQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
  onOpenChat: (quote: CrmQuote) => void
}

type StageColumnProps = {
  stage: StageDefinition
  rows: CrmQuote[]
  dealersBySourceId: Map<string, CrmDealer>
  canManage: boolean
  busyQuoteId: string | null
  onMarkApproved: (quote: CrmQuote) => void
  onMarkFollowedUp: (quote: CrmQuote) => void
  onDeclineQuote: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
  onPrintQuote: (quote: CrmQuote) => void
  onOpenDetails: (quote: CrmQuote) => void
  onOpenChat: (quote: CrmQuote) => void
  // The page's toolbar lives in this component's header now, so its controls
  // come down as props rather than sitting in a second bar of their own.
  globalSearch: string
  onGlobalSearchChange: (value: string) => void
  isRefreshing: boolean
  onRefresh: () => void
  onAddOpportunity: () => void
  isSyncingExcelQuote: boolean
  onSyncExcelSheet: () => void
}

// One flat list. The old set needed three menus to reach, and two of its five
// entries sorted by date while claiming to sort by quote number.
type StageSortMode =
  | 'quote_number_desc'
  | 'quote_number_asc'
  | 'date_newest'
  | 'date_oldest'
  | 'amount_high'
  | 'amount_low'
  | 'account_az'

const STAGE_SORT_OPTIONS: { value: StageSortMode, label: string }[] = [
  { value: 'quote_number_desc', label: 'Quote number, highest first' },
  { value: 'quote_number_asc', label: 'Quote number, lowest first' },
  { value: 'date_newest', label: 'Date, newest first' },
  { value: 'date_oldest', label: 'Date, oldest first' },
  { value: 'amount_high', label: 'Amount, highest first' },
  { value: 'amount_low', label: 'Amount, lowest first' },
  { value: 'account_az', label: 'Account, A to Z' },
]

type StageAmountCondition = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

type ExcelSyncProjectTypeOption = 'Reception Desk' | 'Courtroom' | 'Conference Table' | 'Libraries' | 'Other'
type ExcelSyncAccountMode = 'existing' | 'create' | 'none'

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

type OpportunityDetailsSaveMode = 'save' | 'save_close' | 'decline'
type OpportunitySavePreference = 'save' | 'save_close'
type PendingRevisionSave = {
  mode: OpportunitySavePreference
}

// A formula's answer is the number that matters, so it is shown at full size
// rather than as fine print. The field keeps the formula so it stays editable.
const formulaHintSx = {
  ml: 0,
  mt: 0.25,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: 'primary.main',
} as const

// Qty, unit price and ext are pushed together so the description — the part
// anyone actually reads — keeps the rest of the width. Their default cell
// padding alone would eat a third of a column this narrow, so it is trimmed
// with them.
const QUOTE_LINE_TIGHT_CELL_SX = { px: 0.75 } as const

// The narrow label beside each description ("Finish:", "Size:"). Every pixel
// taken off it goes straight to the description next to it.
const QUOTE_LINE_DETAIL_LABEL_WIDTH = 118

type LineItemsEditorProps = {
  lineItems: OpportunityLineItemFormState[]
  pdfSettings?: CrmQuotePrintSettings
  canEdit: boolean
  onAddLineItem: () => void
  onAddSubline: (index: number) => void
  onUpdateLineItem: (index: number, field: 'detailLabel' | 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => void
  onRemoveLineItem: (index: number) => void
  onMoveLineItem: (index: number, direction: 'up' | 'down') => void
  onDuplicateLineItem: (index: number) => void
  onCopyDetailToSubline: (index: number) => void
  onAddImages: (index: number, images: PreparedQuoteImage[], replaceImageId?: string) => Promise<void>
  onRemoveImage: (lineIndex: number, imageId: string) => void
  onInsertLibraryEntry: (entry: CrmQuoteLineLibraryEntry) => void
  isUploadingImage: boolean
}

const stageDefinitions: StageDefinition[] = [
  {
    id: 'proposal_submission',
    label: 'Opportunities',
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

/**
 * Move a quote line up or down, carrying its sublines with it.
 *
 * Lines are stored flat: a main line is followed immediately by its sublines,
 * which point back at it through parentLineId. Reordering therefore moves a
 * whole block, not a row — swapping single entries would strand sublines under
 * the wrong parent.
 */
function cloneQuoteLineLibraryEntry(entry: CrmQuoteLineLibraryEntry) {
  const idBySourceId = new Map<string, string>()
  const sourceLines = Array.isArray(entry.lines) ? entry.lines : []

  sourceLines.forEach((line) => {
    idBySourceId.set(String(line.id || crypto.randomUUID()), crypto.randomUUID())
  })

  return sourceLines.map((line) => {
    const sourceId = String(line.id || '')
    return {
      id: idBySourceId.get(sourceId) || crypto.randomUUID(),
      parentLineId: line.parentLineId ? (idBySourceId.get(String(line.parentLineId)) || null) : null,
      itemNumber: '',
      detailLabel: String(line.detailLabel || ''),
      description: String(line.description || ''),
      qty: '',
      unitPrice: '',
      extPrice: '',
      images: Array.isArray(line.images) ? line.images.map((image) => ({ ...image, id: crypto.randomUUID() })) : [],
    }
  }) satisfies OpportunityLineItemFormState[]
}

function insertQuoteLineLibraryEntry(
  currentLines: OpportunityLineItemFormState[],
  entry: CrmQuoteLineLibraryEntry,
) {
  const insertedLines = cloneQuoteLineLibraryEntry(entry)
  if (insertedLines.length === 0) return currentLines

  const emptyMainLineIndex = currentLines.findIndex((line) => (
    !line.parentLineId
    && !line.detailLabel.trim()
    && !line.description.trim()
    && !line.qty.trim()
    && !line.unitPrice.trim()
    && line.images.length === 0
    && !currentLines.some((candidate) => candidate.parentLineId === line.id)
  ))

  if (emptyMainLineIndex >= 0) {
    const nextLines = [...currentLines]
    nextLines.splice(emptyMainLineIndex, 1, ...insertedLines)
    return nextLines
  }

  return [...currentLines, ...insertedLines]
}

/** Shows what a typed formula works out to, the way Excel shows the result. */
function resolveServiceItemExtPrice(item: {
  qty?: number | null
  unitPrice?: number | null
  extPrice?: number | null
  price?: number | null
}) {
  const hasExtPrice = item.extPrice !== null && item.extPrice !== undefined
  const extPrice = Number(item.extPrice)
  if (hasExtPrice && Number.isFinite(extPrice)) {
    return Number(extPrice.toFixed(2))
  }

  const hasQuantity = item.qty !== null && item.qty !== undefined
  const hasUnitPrice = item.unitPrice !== null && item.unitPrice !== undefined
  const quantity = Number(item.qty)
  const unitPrice = Number(item.unitPrice)
  if (hasQuantity && hasUnitPrice && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
    return Number((quantity * unitPrice).toFixed(2))
  }

  const hasLegacyPrice = item.price !== null && item.price !== undefined
  const legacyPrice = Number(item.price)
  if (hasLegacyPrice && Number.isFinite(legacyPrice)) {
    return Number(legacyPrice.toFixed(2))
  }

  return null
}

function updateServiceItemPricing(
  serviceItem: OpportunityServiceItemFormState,
  field: 'title' | 'description' | 'qty' | 'unitPrice' | 'extPrice',
  value: string,
) {
  const nextServiceItem = { ...serviceItem, [field]: value }
  if (field === 'qty' || field === 'unitPrice') {
    nextServiceItem.extPrice = calculateExtendedPrice(nextServiceItem.qty, nextServiceItem.unitPrice)
  }
  return nextServiceItem
}

function resolveDealerQuoteCompanyName(dealer: CrmDealer | null | undefined) {
  const configuredName = String(dealer?.quoteCompanyName || '').trim()
  if (configuredName) return configuredName

  const accountName = String(dealer?.name || '').trim()
  if (!accountName) return ''

  return accountName
    .replace(/\s+(?:-|–|—)\s+.+$/, '')
    .replace(/\s*\((?:closed|inactive)\)\s*$/i, '')
    .replace(/(?<!\bof)\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$/i, '')
    .replace(/[;,\s]+$/, '')
    .trim() || accountName
}

const defaultAdditionalServiceTemplates = [
  ['Custom Design Fee', 'Includes up to two rendering revisions with a lead time of two weeks. Additional revisions beyond the included revisions are billed separately.', 175],
  ['Stain to Match', 'Available on Arnold standard veneers. Exclusions and sample-review conditions appear in Customer Information.', 375],
  ['Paint Sample', 'Includes one standard paint strike-off. Additional approval samples may incur an extra fee.', 375],
  ['FIV — Field Verification & Measurement', 'Includes one-time field verification and measurement during regular business hours. The site must be clear and accessible.', 850],
  ['Shop Drawings', 'Includes up to two revisions with an estimated two-week lead time. Additional revisions are billed separately.', 250],
] as const

const defaultShippingServiceTemplates = [
  ['Blanket-Wrapped Dock Delivery', 'Dedicated truck delivery to a local warehouse dock. Customer team unloads the truck; no driver assistance is included.'],
  ['Crated & Shipped via Common Carrier', 'Delivered crated to a warehouse dock by common carrier. Customer team unloads the truck.'],
  ['Delivery & Installation', 'Delivery and installation service. Site conditions, access, working hours, and carry-up requirements must be confirmed before scheduling.'],
] as const

function createServiceItemFormState(title = '', description = '', unitPrice: number | null = null): OpportunityServiceItemFormState {
  const price = unitPrice === null ? '' : String(unitPrice)
  return { id: crypto.randomUUID(), title, description, qty: '', unitPrice: price, extPrice: unitPrice === null ? '' : '0', images: [], location: null }
}

function createDefaultAdditionalServices() {
  return defaultAdditionalServiceTemplates.map(([title, description, unitPrice]) => createServiceItemFormState(title, description, unitPrice))
}

function createDefaultShippingServices() {
  return defaultShippingServiceTemplates.map(([title, description]) => createServiceItemFormState(title, description))
}

function mapServiceItemsToFormState(items: CrmQuoteServiceItem[] | null | undefined, defaults: () => OpportunityServiceItemFormState[]) {
  const sourceItems = (Array.isArray(items) ? items : [])
    .filter((item) => item.id !== 'demolition' && !/demolition/i.test(String(item.title || '')))
  const isStandardAdditionalServices = defaults === createDefaultAdditionalServices
  const normalizedServiceKey = (value: string | null | undefined) => {
    const normalized = String(value || '').toLowerCase()
    if (normalized.includes('custom design')) return 'custom-design'
    if (normalized.includes('stain to match')) return 'stain-match'
    if (normalized.includes('paint sample')) return 'paint-sample'
    if (normalized.includes('field verification') || /\bfiv\b/.test(normalized)) return 'field-verification'
    if (normalized.includes('shop drawing')) return 'shop-drawing'
    return normalized.replace(/[^a-z0-9]+/g, '-')
  }
  const mappedItems = sourceItems.map((item) => ({
    id: item.id || crypto.randomUUID(),
    title: String(item.title || ''),
    description: String(item.description || ''),
    qty: (() => {
      if (item.qty === null || item.qty === undefined) return ''
      const quantity = Number(item.qty)
      return Number.isFinite(quantity) ? String(quantity) : ''
    })(),
    unitPrice: (() => {
      if (item.unitPrice === null || item.unitPrice === undefined) return ''
      const unitPrice = Number(item.unitPrice)
      return Number.isFinite(unitPrice) ? String(unitPrice) : ''
    })(),
    extPrice: (() => {
      if (item.extPrice !== null && item.extPrice !== undefined) {
        const extPrice = Number(item.extPrice)
        if (Number.isFinite(extPrice)) return String(extPrice)
      }
      const qty = Number(item.qty)
      const unitPrice = Number(item.unitPrice)
      return item.qty !== null && item.qty !== undefined
        && item.unitPrice !== null && item.unitPrice !== undefined
        && Number.isFinite(qty) && Number.isFinite(unitPrice)
        ? String(Number((qty * unitPrice).toFixed(2)))
        : ''
    })(),
    images: Array.isArray(item.images) ? item.images : [],
    location: item.location ?? null,
  }))

  if (!isStandardAdditionalServices) {
    return sourceItems.length > 0 ? mappedItems : defaults()
  }

  const standardDefaults = createDefaultAdditionalServices()
  const matchedKeys = new Set<string>()
  const hydratedDefaults = standardDefaults.map((standard) => {
    const key = normalizedServiceKey(standard.title)
    const existing = mappedItems.find((item) => normalizedServiceKey(item.title) === key)
    if (!existing) return standard
    matchedKeys.add(key)
    const qty = existing.qty
    const unitPrice = Number(existing.unitPrice) > 0 ? existing.unitPrice : standard.unitPrice
    return {
      ...standard,
      ...existing,
      title: standard.title,
      description: existing.description || standard.description,
      qty,
      unitPrice,
      extPrice: qty ? calculateExtendedPrice(qty, unitPrice) : '0',
    }
  })
  return [...hydratedDefaults, ...mappedItems.filter((item) => !matchedKeys.has(normalizedServiceKey(item.title)))]
}

function normalizeServiceItemsForPayload(items: OpportunityServiceItemFormState[]): CrmQuoteServiceItem[] {
  return items.map((item) => {
    const qty = toOptionalNumber(item.qty)
    const unitPrice = toOptionalNumber(item.unitPrice)
    const extFromFields = qty !== null && unitPrice !== null
      ? Number((qty * unitPrice).toFixed(2))
      : null
    const extPrice = toOptionalNumber(item.extPrice) ?? extFromFields

    return {
      id: item.id,
      title: item.title.trim(),
      description: item.description.trim() || null,
      qty,
      unitPrice,
      extPrice,
      // Keep legacy field for older records and consumers.
      price: extPrice,
      images: item.images,
      location: item.location,
    }
  }).filter((item) => item.title && item.qty !== null && item.qty > 0 && item.unitPrice !== null)
}

function isBlankLineItem(lineItem: OpportunityLineItemFormState) {
  return !lineItem.detailLabel.trim()
    && !lineItem.description.trim()
    && !lineItem.qty.trim()
    && !lineItem.unitPrice.trim()
    && !lineItem.extPrice.trim()
    && lineItem.images.length === 0
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

async function readImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    return { width: image.naturalWidth || null, height: image.naturalHeight || null }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const quoteImageShapeOptions: Array<{ value: QuoteImageShape; label: string; aspect: number }> = [
  { value: 'square', label: 'Square', aspect: 1 },
  { value: 'landscape', label: 'Rectangle', aspect: 4 / 3 },
  { value: 'wide', label: 'Wide', aspect: 16 / 9 },
  { value: 'portrait', label: 'Portrait', aspect: 4 / 5 },
]

const quoteImageSizeOptions: Array<{
  value: QuoteImageDisplaySize
  label: string
  description: string
  /** Relative printed width, used for the preview bars beside the control. */
  scale: number
}> = [
  { value: 'small', label: 'Small', description: '66% width', scale: 0.66 },
  { value: 'medium', label: 'Medium', description: 'Standard', scale: 1 },
  { value: 'large', label: 'Large', description: '144% width', scale: 1.44 },
]

const quoteImageZoomFromSlider = (value: number) => value <= 0
  ? 1 + value / 200
  : 1 + value / 100

const quoteImageSliderFromZoom = (value: number) => value <= 1
  ? (value - 1) * 200
  : (value - 1) * 100

function resolveEditorLineImagePreviewSize(displaySize: QuoteImageDisplaySize | null | undefined) {
  if (displaySize === 'small') {
    return { width: 92, height: 68 }
  }

  if (displaySize === 'large') {
    return { width: 212, height: 156 }
  }

  return { width: 148, height: 108 }
}

async function cropQuoteImage(file: File, pixels: Area, shape: QuoteImageShape) {
  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = sourceUrl
    await image.decode()
    const maxDimension = 1800
    const scale = Math.min(1, maxDimension / Math.max(pixels.width, pixels.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(pixels.width * scale))
    canvas.height = Math.max(1, Math.round(pixels.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this picture.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => nextBlob ? resolve(nextBlob) : reject(new Error('Could not crop this picture.')), 'image/jpeg', 0.9)
    })
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'quote-picture'
    return new File([blob], `${baseName}-${shape}.jpg`, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

async function loadQuoteImageForEditing(image: CrmQuoteLineImage) {
  const response = await fetch(`/api/crm/quote-image-proxy?url=${encodeURIComponent(image.url)}`)
  if (!response.ok) throw new Error('Could not open this picture for editing.')
  const blob = await response.blob()
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const baseName = String(image.name || 'quote-picture').replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.${extension}`, { type: blob.type || 'image/jpeg' })
}

function QuoteImageCropDialog({
  file,
  open,
  initialShape,
  initialDisplaySize,
  onCancel,
  onComplete,
}: {
  file: File | null
  open: boolean
  initialShape?: QuoteImageShape
  initialDisplaySize?: QuoteImageDisplaySize
  onCancel: () => void
  onComplete: (image: PreparedQuoteImage) => Promise<void>
}) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [shape, setShape] = useState<QuoteImageShape>('landscape')
  const [displaySize, setDisplaySize] = useState<QuoteImageDisplaySize>('medium')
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [cropError, setCropError] = useState('')
  const aspect = quoteImageShapeOptions.find((option) => option.value === shape)?.aspect || 4 / 3

  useEffect(() => {
    if (!file || !open) {
      setSourceUrl('')
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setSourceUrl(nextUrl)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setShape(initialShape || 'landscape')
    setDisplaySize(initialDisplaySize || 'medium')
    setCroppedAreaPixels(null)
    setCropError('')
    return () => URL.revokeObjectURL(nextUrl)
  }, [file, initialDisplaySize, initialShape, open])

  const handleUsePicture = async () => {
    if (!file || !croppedAreaPixels) return
    setIsPreparing(true)
    setCropError('')
    try {
      await onComplete({ file: await cropQuoteImage(file, croppedAreaPixels, shape), shape, displaySize })
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Could not prepare this picture.')
    } finally {
      setIsPreparing(false)
    }
  }

  return (
    <Dialog open={open} onClose={isPreparing ? undefined : onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Fit Quote Picture</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {cropError ? <Alert severity="error">{cropError}</Alert> : null}
          <Box
            onWheel={(event) => {
              event.preventDefault()
              setZoom((current) => Math.min(2, Math.max(0.5, Number((current + (event.deltaY < 0 ? 0.05 : -0.05)).toFixed(2)))))
            }}
            sx={{ position: 'relative', height: { xs: 320, md: 470 }, bgcolor: '#111827', borderRadius: 2, overflow: 'hidden' }}
          >
            {sourceUrl ? <Cropper image={sourceUrl} crop={crop} zoom={zoom} minZoom={0.5} maxZoom={2} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropAreaChange={(_area, pixels) => setCroppedAreaPixels(pixels)} objectFit="contain" restrictPosition roundCropAreaPixels zoomWithScroll={false} /> : null}
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={800}>Shape</Typography>
            <ToggleButtonGroup exclusive value={shape} onChange={(_event, value: QuoteImageShape | null) => {
              if (!value) return
              setShape(value)
              setCroppedAreaPixels(null)
            }} size="small" fullWidth sx={{ mt: 0.5 }}>
              {quoteImageShapeOptions.map((option) => <ToggleButton key={option.value} value={option.value}>{option.label}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={800}>Zoom: {Math.round(zoom * 100)}%</Typography>
            <Slider
              value={quoteImageSliderFromZoom(zoom)}
              min={-100}
              max={100}
              step={5}
              marks={[{ value: -100, label: '50%' }, { value: 0, label: '100%' }, { value: 100, label: '200%' }]}
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `${Math.round(quoteImageZoomFromSlider(value) * 100)}%`}
              onChange={(_event, value) => setZoom(quoteImageZoomFromSlider(value as number))}
              aria-label="Picture zoom percentage"
            />
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={800}>Size on the printed quote</Typography>
            <ToggleButtonGroup exclusive value={displaySize} onChange={(_event, value: QuoteImageDisplaySize | null) => value && setDisplaySize(value)} size="small" fullWidth sx={{ mt: 0.5 }}>
              {quoteImageSizeOptions.map((option) => (
                <ToggleButton key={option.value} value={option.value}>
                  <Stack alignItems="center" spacing={0.5}>
                    <Box
                      sx={{
                        width: 34 * option.scale,
                        height: 16,
                        borderRadius: 0.5,
                        bgcolor: displaySize === option.value ? 'primary.main' : 'action.disabled',
                      }}
                    />
                    <span>{option.label}</span>
                    <Typography variant="caption" color="text.secondary">{option.description}</Typography>
                  </Stack>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Only affects the PDF. The form shows the picture as an attachment.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isPreparing}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleUsePicture()} disabled={!croppedAreaPixels || isPreparing}>{isPreparing ? 'Saving picture…' : 'Use Picture'}</Button>
      </DialogActions>
    </Dialog>
  )
}


function toOptionalNumber(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  // Arithmetic resolves here too, so a formula typed in a field is stored as
  // the number it works out to rather than being dropped on save.
  const parsed = evaluateQuoteFormula(normalized) ?? Number(normalized)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function normalizeLineItemsForPayload(lineItems: OpportunityLineItemFormState[]): CrmQuoteLineItem[] {
  const normalized: CrmQuoteLineItem[] = []
  const mainLineIds = new Set<string>()
  let mainItemNumber = 0

  for (const lineItem of lineItems) {
    if (isBlankLineItem(lineItem)) {
      continue
    }

    const parentLineId = lineItem.parentLineId && mainLineIds.has(lineItem.parentLineId)
      ? lineItem.parentLineId
      : null
    if (!parentLineId) {
      mainItemNumber += 1
      mainLineIds.add(lineItem.id)
    }

    normalized.push({
      id: lineItem.id,
      parentLineId,
      itemNumber: mainItemNumber,
      detailLabel: lineItem.detailLabel.trim() || null,
      description: lineItem.description.trim() || null,
      qty: parentLineId ? null : toOptionalNumber(lineItem.qty),
      unitPrice: parentLineId ? null : toOptionalNumber(lineItem.unitPrice),
      extPrice: parentLineId ? null : toOptionalNumber(lineItem.extPrice),
      images: parentLineId ? [] : lineItem.images,
    })
  }

  return normalized
}

function mapLineItemToFormState(lineItem: CrmQuoteLineItem): OpportunityLineItemFormState {
  return {
    id: lineItem.id || crypto.randomUUID(),
    parentLineId: String(lineItem.parentLineId ?? '').trim() || null,
    itemNumber: String(lineItem.itemNumber ?? '').trim(),
    detailLabel: String(lineItem.detailLabel ?? '').trim(),
    description: String(lineItem.description ?? '').trim(),
    qty: lineItem.qty === null || lineItem.qty === undefined ? '' : String(lineItem.qty),
    unitPrice: lineItem.unitPrice === null || lineItem.unitPrice === undefined ? '' : String(lineItem.unitPrice),
    extPrice: lineItem.extPrice === null || lineItem.extPrice === undefined ? '' : String(lineItem.extPrice),
    images: Array.isArray(lineItem.images) ? lineItem.images : [],
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

/**
 * The in-progress quote as the PDF renderer expects to receive it.
 *
 * Both the staged dialog and the single-page form preview an unsaved quote, and
 * a preview that disagreed with either would be worse than no preview, so they
 * build it here from the same form state.
 */
function buildQuotePreviewQuote(
  form: OpportunityFormState,
  pricing: {
    subtotal: number
    discountPercent: number
    discountAmount: number
    discountScope: 'products' | 'products_and_freight'
    discountFreightAmount: number
    freight: number
    totalAmount: number
  },
) {
  return {
    id: 'new-opportunity-preview',
    dealerSourceId: form.dealerSourceId || null,
    quoteNumber: form.quoteNumber.trim() || null,
    title: form.title.trim() || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${form.quoteNumber.trim() || 'Preview'}`,
    companyName: form.companyName.trim() || null,
    contactName: form.contactName.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    salesRep: form.salesRep.trim() || null,
    projectType: form.projectType.trim() || null,
    opportunityDate: form.opportunityDateInput.trim() || null,
    leadTime: form.leadTime.trim() || null,
    paymentTerms: form.paymentTerms.trim() || null,
    subtotal: pricing.subtotal,
    discountPercent: pricing.discountPercent,
    discountAmount: pricing.discountAmount,
    discountScope: pricing.discountScope,
    discountFreightAmount: pricing.discountFreightAmount,
    totalPriceType: form.totalPriceType,
    freight: pricing.freight,
    freightDescription: form.freightDescription.trim() || null,
    lineItems: normalizeLineItemsForPayload(form.lineItems),
    additionalServices: normalizeServiceItemsForPayload(form.additionalServices),
    shippingServices: normalizeServiceItemsForPayload(form.shippingServices),
    totalAmount: pricing.totalAmount,
    notes: form.notes.trim() || null,
    status: 'draft',
    origin: form.origin,
    revisions: [],
    revisionCount: 0,
    activeRevisionNumber: 0,
  } as unknown as CrmQuote
}

function resolveQuotePricing(
  lineItems: OpportunityLineItemFormState[],
  freightInput: string,
  fallbackTotal = 0,
  additionalServices: OpportunityServiceItemFormState[] = [],
  shippingServices: OpportunityServiceItemFormState[] = [],
  discountPercentInput = '',
  discountScope: 'products' | 'products_and_freight' = 'products',
) {
  const normalizedLineItems = normalizeLineItemsForPayload(lineItems)
  const normalizedAdditionalServices = normalizeServiceItemsForPayload(additionalServices)
  const normalizedShippingServices = normalizeServiceItemsForPayload(shippingServices)
  const additionalServicesTotal = normalizedAdditionalServices
    .reduce((sum, item) => sum + Number(resolveServiceItemExtPrice(item) || 0), 0)
  const shippingServicesTotal = normalizedShippingServices
    .reduce((sum, item) => sum + Number(resolveServiceItemExtPrice(item) || 0), 0)
  const enteredFreight = toOptionalNumber(freightInput)
  const lineItemsTotal = calculateLineItemsTotal(normalizedLineItems)
  const grossSubtotal = Number((lineItemsTotal + additionalServicesTotal).toFixed(2))
  const parsedDiscountPercent = toOptionalNumber(discountPercentInput)
  const discountPercent = Math.min(100, Math.max(0, parsedDiscountPercent ?? 0))
  const productDiscountAmount = Number((grossSubtotal * (discountPercent / 100)).toFixed(2))
  const subtotal = Number((grossSubtotal - productDiscountAmount).toFixed(2))
  const freight = Number((shippingServicesTotal || enteredFreight || 0).toFixed(2))
  const discountFreightAmount = discountScope === 'products_and_freight'
    ? Number((freight * (discountPercent / 100)).toFixed(2))
    : 0
  const discountAmount = Number((productDiscountAmount + discountFreightAmount).toFixed(2))
  const baseSubtotal = subtotal
  const computedTotal = Number((baseSubtotal + (freight ?? 0) - discountFreightAmount).toFixed(2))

  return {
    normalizedLineItems,
    normalizedAdditionalServices,
    normalizedShippingServices,
    lineItemsTotal,
    grossSubtotal,
    discountPercent,
    discountAmount,
    productDiscountAmount,
    discountFreightAmount,
    discountScope,
    subtotal,
    freight,
    listPriceTotal: Number((grossSubtotal + freight).toFixed(2)),
    totalAmount: Number.isFinite(computedTotal)
      ? computedTotal
      : Number(fallbackTotal || 0),
  }
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
    projectType: '',
    leadTime: '',
    paymentTerms: DEFAULT_WEBSITE_PAYMENT_TERMS,
    subtotal: '',
    discountPercent: '',
    discountScope: 'products',
    totalPriceType: 'net',
    freight: '',
    freightDescription: '',
    notes: '',
    lineItems: Array.from({ length: 4 }, () => createEmptyLineItemFormState()),
    additionalServices: createDefaultAdditionalServices(),
    shippingServices: createDefaultShippingServices(),
    origin: 'website',
    sourceWorkbookUrl: '',
    sourceWorkbookName: '',
    convertedPdfUrl: '',
    convertedPdfName: '',
  }
}

/** A blank quote for the single-page form: one line, nothing else assumed. */
function createEmptySinglePageQuoteForm(): OpportunityFormState {
  return {
    ...createEmptyOpportunityForm(),
    lineItems: [createEmptyLineItemFormState()],
    additionalServices: [],
    shippingServices: [],
  }
}

function createEmptyConvertOrderForm(
  primaryBoardId = DEFAULT_NEW_ORDERS_2026_BOARD_ID,
  secondaryBoardId = DEFAULT_DESIGN_AKF_BOARD_ID,
  acknowledgmentNumber = '',
): OpportunityConvertOrderFormState {
  return {
    primaryBoardId,
    secondaryBoardId,
    acknowledgmentNumber: String(acknowledgmentNumber || '').trim(),
    poDate: getTodayEasternDateInputValue(),
    poNumber: '',
    leadTime: '',
    shipTo: '',
    notes: '',
    depositRequirement: '',
    depositPercent: '50',
    selectedLineItemIds: [],
    selectedAdditionalServiceIds: [],
    selectedShippingServiceIds: [],
    includeFreight: false,
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
  const origin = quote.origin === 'excel' ? 'excel' : 'website'
  const additionalServices = mapServiceItemsToFormState(quote.additionalServices, createDefaultAdditionalServices)
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
    projectType: resolveStoredProjectType(quote.projectType),
    leadTime: String(quote.leadTime || ''),
    paymentTerms: String(quote.paymentTerms || ''),
    subtotal: '',
    discountPercent: quote.discountPercent === null || quote.discountPercent === undefined ? '' : String(quote.discountPercent),
    discountScope: quote.discountScope === 'products_and_freight' ? 'products_and_freight' : 'products',
    totalPriceType: quote.totalPriceType === 'list' ? 'list' : 'net',
    freight: origin === 'excel' && quote.freight !== null && quote.freight !== undefined ? String(quote.freight) : '',
    freightDescription: String(quote.freightDescription || ''),
    notes: String(quote.notes || ''),
    lineItems: mapQuoteLineItemsToFormState(quote.lineItems),
    additionalServices,
    shippingServices: mapServiceItemsToFormState(quote.shippingServices, createDefaultShippingServices),
    origin,
    sourceWorkbookUrl: String(quote.sourceWorkbookUrl || ''),
    sourceWorkbookName: String(quote.sourceWorkbookName || ''),
    convertedPdfUrl: String(quote.convertedPdfUrl || ''),
    convertedPdfName: String(quote.convertedPdfName || ''),
  }
}

/**
 * Build a fresh quote form from an existing quote.
 *
 * Line ids are regenerated and parentLineId remapped through the new ids: the
 * copy must not share identifiers with the quote it came from, or saving it
 * would collide with the original's lines and cross the parent links.
 *
 * The quote number is always blank. Every quote needs its own, and inheriting
 * one silently would produce two quotes claiming the same number.
 */
function createDuplicateOpportunityForm(
  quote: CrmQuote,
  keepAccountInformation: boolean,
): OpportunityFormState {
  const source = createOpportunityDetailsFormState(quote)
  const idBySourceId = new Map<string, string>()

  source.lineItems.forEach((line) => {
    idBySourceId.set(String(line.id), crypto.randomUUID())
  })

  const lineItems = source.lineItems.map((line) => ({
    ...line,
    id: idBySourceId.get(String(line.id)) || crypto.randomUUID(),
    parentLineId: line.parentLineId
      ? (idBySourceId.get(String(line.parentLineId)) || null)
      : null,
  }))

  const duplicated: OpportunityFormState = {
    ...source,
    quoteNumber: '',
    opportunityDateInput: resolveDateInputFromIso(new Date().toISOString()),
    lineItems,
    // The copy is a new website quote. Carrying the original's workbook and PDF
    // links would point it at documents that describe the other quote.
    origin: 'website',
    sourceWorkbookUrl: '',
    sourceWorkbookName: '',
    convertedPdfUrl: '',
    convertedPdfName: '',
  }

  if (keepAccountInformation) {
    return duplicated
  }

  return {
    ...duplicated,
    dealerSourceId: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    salesRep: '',
    paymentTerms: '',
  }
}

function resolveQuoteRevision(quote: CrmQuote, revisionNumber: number): CrmQuote {
  const revision = (quote.revisions || []).find(
    (entry) => Number(entry.revisionNumber) === Number(revisionNumber),
  )

  if (!revision) {
    return quote
  }

  return {
    ...quote,
    ...revision,
    id: quote.id,
    opportunityStage: quote.opportunityStage,
    convertedItemKeys: quote.convertedItemKeys,
    convertedOrderId: quote.convertedOrderId,
    convertedOrderNumber: quote.convertedOrderNumber,
    convertedAt: quote.convertedAt,
    baseQuoteNumber: quote.baseQuoteNumber,
    activeRevisionNumber: quote.activeRevisionNumber,
    revisionCount: quote.revisionCount,
    revisions: quote.revisions,
    updatedAt: revision.updatedAt || quote.updatedAt,
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
    origin: syncInput.origin === 'excel' ? 'excel' : baseState.origin,
    sourceWorkbookUrl: String(syncInput.sourceWorkbookUrl || baseState.sourceWorkbookUrl),
    sourceWorkbookName: String(syncInput.sourceWorkbookName || baseState.sourceWorkbookName),
    convertedPdfUrl: String(syncInput.convertedPdfUrl || baseState.convertedPdfUrl),
    convertedPdfName: String(syncInput.convertedPdfName || baseState.convertedPdfName),
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

  // The month as a word, the way the invoice list this page is modelled on
  // writes it. Month first rather than day first, because the rest of the app
  // and everyone reading it is on US ordering.
  return parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function normalizeMatchValue(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeQuoteFamilyValue(value: string | null | undefined) {
  return normalizeMatchValue(value).replace(/[-_\s]*r\d+$/i, '')
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

function resolveContactSelectionLabel(contact: CrmContact) {
  const explicitName = String(contact.name || '').trim()
  const combinedName = [contact.firstName, contact.lastName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  return explicitName || combinedName || contact.primaryEmail || contact.phone || 'Unnamed contact'
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

function resolveStoredProjectType(value: string | null | undefined): ExcelSyncProjectTypeOption | '' {
  const stored = String(value ?? '').trim()

  if (isExcelSyncProjectTypeOption(stored)) {
    return stored
  }

  return resolveDefaultExcelProjectType(stored)
}

function isExcelSyncProjectTypeOption(value: string): value is ExcelSyncProjectTypeOption {
  return excelSyncProjectTypeOptions.includes(value as ExcelSyncProjectTypeOption)
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

  return 'proposal_submission'
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
  onAddSubline,
  onUpdateLineItem,
  onRemoveLineItem,
  onMoveLineItem,
  onDuplicateLineItem,
  onCopyDetailToSubline,
  onAddImages,
  onRemoveImage,
  onInsertLibraryEntry,
  isUploadingImage,
}: LineItemsEditorProps) {
  const [cropTarget, setCropTarget] = useState<QuoteImageCropTarget | null>(null)
  const [imageEditError, setImageEditError] = useState('')
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [saveLibraryTargetIndex, setSaveLibraryTargetIndex] = useState<number | null>(null)
  const [libraryNameDraft, setLibraryNameDraft] = useState('')
  const [libraryError, setLibraryError] = useState('')
  // Zooming the lines alone, so reviewing a long quote does not mean shrinking
  // the whole page with Ctrl+minus and losing the toolbar with it.
  const [lineZoom, setLineZoom] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('arnold.quoteLines.zoom'))
      return Number.isFinite(stored) && stored >= 0.6 && stored <= 1.4 ? stored : 1
    } catch {
      return 1
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('arnold.quoteLines.zoom', String(lineZoom))
    } catch {
      // Storage is a convenience here, never a requirement.
    }
  }, [lineZoom])

  // Ctrl and +/- resize the lines instead of the whole browser window, which is
  // what you actually mean while looking at a quote. Ctrl+0 returns to 100%.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setLineZoom((current) => Math.max(0.6, Number((current - 0.1).toFixed(2))))
        return
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setLineZoom((current) => Math.min(1.4, Number((current + 0.1).toFixed(2))))
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        setLineZoom(1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const [isSavingLibrary, setIsSavingLibrary] = useState(false)
  const libraryQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuoteLineLibrary,
    queryFn: () => fetchCrmQuoteLineLibrary(),
    // The library is only needed after the user opens its dialog. Fetching it
    // while the Quote Lines stage mounts made that tab wait on an unrelated API call.
    enabled: canEdit && isLibraryOpen,
    staleTime: 60 * 1000,
  })
  const visibleLibraryEntries = (libraryQuery.data?.entries || []).filter((entry) => (
    entry.name.toLowerCase().includes(librarySearch.trim().toLowerCase())
  ))

  const saveLineToLibrary = async () => {
    if (saveLibraryTargetIndex === null) return
    const sourceLine = lineItems[saveLibraryTargetIndex]
    if (!sourceLine || sourceLine.parentLineId) return
    const linesToSave = [sourceLine, ...lineItems.filter((line) => line.parentLineId === sourceLine.id)]
    const name = libraryNameDraft.trim()
    if (!name) {
      setLibraryError('Enter a name for this library item.')
      return
    }
    setIsSavingLibrary(true)
    setLibraryError('')
    try {
      await createCrmQuoteLineLibraryEntry({
        name,
        lines: linesToSave.map((line, index) => ({
          id: line.id,
          parentLineId: line.parentLineId,
          itemNumber: index + 1,
          detailLabel: line.detailLabel || null,
          description: line.description || null,
          qty: null,
          unitPrice: null,
          extPrice: null,
          images: line.parentLineId ? [] : line.images,
        })),
      })
      await libraryQuery.refetch()
      setSaveLibraryTargetIndex(null)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Could not save this library item.')
    } finally {
      setIsSavingLibrary(false)
    }
  }

  const handlePasteLineImage = (index: number, event: ReactClipboardEvent<HTMLElement>) => {
    if (!canEdit || isUploadingImage || (lineItems[index]?.images.length ?? 0) >= 2) return

    // Some browsers put a screenshot in `items`, others only in `files`, and a
    // paste carrying both text and an image lists the text first. Checking both
    // lists is the difference between this working everywhere and nowhere.
    const clipboardImage = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile()
      ?? Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
      ?? null

    if (!clipboardImage) return
    event.preventDefault()

    const extension = clipboardImage.type === 'image/jpeg'
      ? 'jpg'
      : clipboardImage.type === 'image/webp' ? 'webp' : 'png'
    const file = new File(
      [clipboardImage],
      `pasted-quote-picture-${crypto.randomUUID()}.${extension}`,
      { type: clipboardImage.type || 'image/png' },
    )
    setCropTarget({ index, file })
  }

  const handleEditLineImage = async (index: number, image: CrmQuoteLineImage) => {
    if (!canEdit || isUploadingImage) return
    setImageEditError('')
    try {
      const shape = quoteImageShapeOptions.some((option) => option.value === image.shape)
        ? image.shape as QuoteImageShape
        : 'landscape'
      const displaySize = quoteImageSizeOptions.some((option) => option.value === image.displaySize)
        ? image.displaySize as QuoteImageDisplaySize
        : 'medium'
      setCropTarget({ index, file: await loadQuoteImageForEditing(image), imageId: image.id, shape, displaySize })
    } catch (error) {
      setImageEditError(error instanceof Error ? error.message : 'Could not open this picture for editing.')
    }
  }

  return (
    <Stack spacing={0.9}>
      {/* One toolbar line: what the lines are, then everything you do to them.
          The running total lives in the totals bar and is not repeated here. */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Line Items
          </Typography>
          <Chip size="small" label={`${lineItems.length} row${lineItems.length === 1 ? '' : 's'}`} sx={{ height: 20, fontSize: 11 }} />
        </Stack>

        <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" variant="outlined" startIcon={<WorkspacesRoundedIcon />} onClick={() => setIsLibraryOpen(true)} disabled={!canEdit}>
            Insert from library
          </Button>
          {/* Arranging pictures by hand is gone. A picture now always prints
              at the end of its own line, which is where the dragging was
              trying to put it and kept getting wrong. */}
          <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mr: 0.5 }}>
            <Tooltip title="Show more lines at once">
              <span>
                <IconButton
                  size="small"
                  disabled={lineZoom <= 0.6}
                  onClick={() => setLineZoom((current) => Math.max(0.6, Number((current - 0.1).toFixed(2))))}
                >
                  <ZoomOutRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Typography
              variant="caption"
              color="text.secondary"
              onClick={() => setLineZoom(1)}
              sx={{ minWidth: 34, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
            >
              {`${Math.round(lineZoom * 100)}%`}
            </Typography>
            <Tooltip title="Make the lines bigger">
              <span>
                <IconButton
                  size="small"
                  disabled={lineZoom >= 1.4}
                  onClick={() => setLineZoom((current) => Math.min(1.4, Number((current + 0.1).toFixed(2))))}
                >
                  <ZoomInRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Button size="small" variant="outlined" onClick={onAddLineItem} disabled={!canEdit}>
            Add line item
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          backgroundColor: '#ffffff',
          overflowX: 'auto',
        }}
      >
        {/* Scales the lines only, leaving the rest of the page alone. `zoom`
            reflows rather than just redrawing, so every column — qty, unit
            price, ext, delete — genuinely narrows. The inverse width keeps the
            table filling the panel instead of leaving dead space beside it, so
            zooming out shows more, not the same amount drawn smaller. */}
        <Box sx={{ zoom: lineZoom, width: `${100 / lineZoom}%` }}>
        {imageEditError ? <Alert severity="error" sx={{ m: 1 }}>{imageEditError}</Alert> : null}
        <Table size="small" sx={{ minWidth: 1040 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, width: 62, fontWeight: 700 }}>Item</TableCell>
              <TableCell colSpan={2} sx={{ minWidth: 660, fontWeight: 700 }}>Description / Detail</TableCell>
              <TableCell sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, width: 76, fontWeight: 700 }}>Qty</TableCell>
              <TableCell sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, width: 96, fontWeight: 700 }}>Unit Price</TableCell>
              <TableCell sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, width: 100, fontWeight: 700 }}>Ext</TableCell>
              <TableCell align="center" sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, width: 44, fontWeight: 700 }}>Del</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lineItems.map((lineItem, index) => ({ lineItem, index }))
              .filter(({ lineItem }) => !lineItem.parentLineId)
              .map(({ lineItem, index }, mainIndex, mainLines) => {
              const sublines = lineItems
                .map((entry, entryIndex) => ({ entry, entryIndex }))
                .filter(({ entry }) => entry.parentLineId === lineItem.id)

              return (
              <TableRow
                key={lineItem.id}
                hover
                onPaste={(event) => handlePasteLineImage(index, event)}
              >
                <TableCell sx={{ ...QUOTE_LINE_TIGHT_CELL_SX, verticalAlign: 'top' }}>
                  <Stack alignItems="center" spacing={0.1} sx={{ pt: 0.2 }}>
                    <Tooltip title="Move up">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!canEdit || mainIndex === 0}
                          onClick={() => onMoveLineItem(index, 'up')}
                          sx={{ p: 0.2 }}
                        >
                          <KeyboardArrowUpRoundedIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1 }}>
                      {mainIndex + 1}
                    </Typography>
                    <Tooltip title="Move down">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!canEdit || mainIndex === mainLines.length - 1}
                          onClick={() => onMoveLineItem(index, 'down')}
                          sx={{ p: 0.2 }}
                        >
                          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Duplicate this line and its sublines">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!canEdit}
                          onClick={() => onDuplicateLineItem(index)}
                          sx={{ p: 0.2, mt: 0.2 }}
                        >
                          <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </TableCell>
                <TableCell colSpan={2}>
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.9} alignItems="flex-start">
                    <Stack spacing={0.55} sx={{ flexGrow: 1, width: '100%' }}>
                      <TextField
                        size="small"
                        value={splitQuoteLineDescription(lineItem.description).heading}
                        onChange={(event) => {
                          const { details } = splitQuoteLineDescription(lineItem.description)
                          onUpdateLineItem(index, 'description', joinQuoteLineDescription(event.target.value, details))
                        }}
                        disabled={!canEdit}
                        fullWidth
                        inputProps={{ style: { fontWeight: 800, color: '#172033' } }}
                        // Held short on purpose: the detail underneath is what
                        // gets read, so it always runs longer than this bar.
                        sx={{
                          width: 'calc(100% - 190px)',
                          minWidth: 160,
                          '& .MuiOutlinedInput-root': { bgcolor: '#eef2f7' },
                        }}
                      />
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.75} alignItems="stretch">
                        <TextField
                          size="small"
                          value={lineItem.detailLabel}
                          onChange={(event) => onUpdateLineItem(index, 'detailLabel', event.target.value)}
                          disabled={!canEdit}
                          multiline
                          minRows={2}
                          maxRows={10}
                          fullWidth
                          placeholder="Product"
                          inputProps={{ maxLength: QUOTE_PRODUCT_MAX_LENGTH }}
                          sx={{ width: { xs: '100%', md: QUOTE_LINE_DETAIL_LABEL_WIDTH }, flexShrink: 0 }}
                        />
                        <TextField
                          size="small"
                          value={splitQuoteLineDescription(lineItem.description).details}
                          onChange={(event) => {
                            const { heading } = splitQuoteLineDescription(lineItem.description)
                            onUpdateLineItem(index, 'description', joinQuoteLineDescription(heading, event.target.value))
                          }}
                          disabled={!canEdit}
                          multiline
                          minRows={2}
                          maxRows={10}
                          fullWidth
                          placeholder="Description"
                          sx={{ minWidth: 200 }}
                        />
                        {/* This row is the line's own detail, not a subline, so
                            copying it means adding a subline that carries the
                            same text — which is what it looks like it should do. */}
                        <Tooltip title="Copy this detail into a new subline">
                          <span>
                            <IconButton
                              size="small"
                              disabled={!canEdit}
                              aria-label="Copy detail into a new subline"
                              onClick={() => onCopyDetailToSubline(index)}
                              sx={{ mt: 0.25, alignSelf: 'flex-start' }}
                            >
                              <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                      <Stack spacing={0.4} sx={{ width: '100%' }}>
                        {sublines.map(({ entry, entryIndex }) => (
                          <Stack key={entry.id} direction="row" spacing={0.25} alignItems="flex-start">
                            <TextField
                              size="small"
                              value={entry.detailLabel}
                              onChange={(event) => onUpdateLineItem(entryIndex, 'detailLabel', event.target.value)}
                              disabled={!canEdit}
                              multiline
                              minRows={2}
                              maxRows={10}
                              placeholder="Product"
                              inputProps={{ style: { fontWeight: 400 }, maxLength: QUOTE_PRODUCT_MAX_LENGTH }}
                              sx={{ width: { xs: '100%', md: QUOTE_LINE_DETAIL_LABEL_WIDTH }, flexShrink: 0 }}
                            />
                            <TextField
                              size="small"
                              value={entry.description}
                              onChange={(event) => onUpdateLineItem(entryIndex, 'description', event.target.value)}
                              disabled={!canEdit}
                              multiline
                              minRows={2}
                              maxRows={10}
                              fullWidth
                              placeholder="Description"
                              inputProps={{ style: { fontWeight: 400 } }}
                              sx={{ minWidth: 200 }}
                            />
                            <Tooltip title="Duplicate this subline">
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={!canEdit}
                                  aria-label="Duplicate additional description"
                                  onClick={() => onDuplicateLineItem(entryIndex)}
                                  sx={{ mt: 0.25 }}
                                >
                                  <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={!canEdit}
                              aria-label="Remove additional description"
                              onClick={() => onRemoveLineItem(entryIndex)}
                              sx={{ mt: 0.25 }}
                            >
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Stack>
                        ))}
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddRoundedIcon />}
                          onClick={() => onAddSubline(index)}
                          disabled={!canEdit}
                          sx={{ alignSelf: 'flex-start', px: 0.25, fontWeight: 400 }}
                        >
                          Add Subline
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<WorkspacesRoundedIcon />}
                          onClick={() => {
                            setLibraryError('')
                            setSaveLibraryTargetIndex(index)
                            setLibraryNameDraft(splitQuoteLineDescription(lineItem.description).heading)
                          }}
                          disabled={!canEdit}
                          sx={{ alignSelf: 'flex-start', px: 0.25, fontWeight: 400 }}
                        >
                          Save to library
                        </Button>
                      </Stack>
                    </Stack>
                    {/* Wide enough for a large preview only once there is one
                        to show. A line with no picture used to hold the same
                        240px open, and on a laptop that was most of what the
                        description was missing. */}
                    <Stack
                      spacing={0.6}
                      sx={{
                        width: { xs: '100%', lg: lineItem.images.length > 0 ? 240 : 124 },
                        flexShrink: 0,
                      }}
                    >
                      {lineItem.images.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                          {lineItem.images.map((image) => {
                            const previewSize = resolveEditorLineImagePreviewSize(image.displaySize)

                            return (
                              <Box
                                key={image.id}
                                role={canEdit ? 'button' : undefined}
                                tabIndex={canEdit ? 0 : undefined}
                                title={canEdit ? 'Edit picture' : undefined}
                                onClick={() => void handleEditLineImage(index, image)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') void handleEditLineImage(index, image)
                                }}
                                sx={{
                                  position: 'relative',
                                  width: previewSize.width,
                                  height: previewSize.height,
                                  border: 1,
                                  borderColor: 'divider',
                                  borderRadius: 1,
                                  overflow: 'hidden',
                                  bgcolor: '#fff',
                                  cursor: canEdit ? 'pointer' : 'default',
                                }}
                              >
                                <Box component="img" src={image.url} alt={image.name || 'Line item'} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                {canEdit ? (
                                  <>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        onRemoveImage(index, image.id)
                                      }}
                                      sx={{ position: 'absolute', top: 1, right: 1, bgcolor: 'rgba(255,255,255,.92)', p: 0.2 }}
                                    >
                                      <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                                    </IconButton>
                                  </>
                                ) : null}
                              </Box>
                            )
                          })}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">Picture optional</Typography>
                      )}
                      {lineItem.images.length < 2 ? (
                        <Button component="label" size="small" variant="text" startIcon={<FileUploadRoundedIcon />} disabled={!canEdit || isUploadingImage} sx={{ alignSelf: 'flex-start', px: 0.4 }}>
                          {isUploadingImage ? 'Uploading…' : 'Add picture'}
                          <input
                            hidden
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              if (file) setCropTarget({ index, file })
                            }}
                          />
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </TableCell>
                <TableCell sx={QUOTE_LINE_TIGHT_CELL_SX}>
                  <TextField
                    variant="standard"
                    size="small"
                    // Text, not number: a number input refuses "48/12" outright,
                    // so a formula could never be typed in the first place.
                    type="text"
                    value={lineItem.qty}
                    onChange={(event) => {
                      onUpdateLineItem(index, 'qty', event.target.value)
                    }}
                    disabled={!canEdit}
                    inputProps={{ inputMode: 'text' }}
                    helperText={formulaHint(lineItem.qty)}
                    FormHelperTextProps={{ sx: formulaHintSx }}
                    fullWidth
                  />
                </TableCell>
                <TableCell sx={QUOTE_LINE_TIGHT_CELL_SX}>
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
                    helperText={formulaHint(lineItem.unitPrice)}
                    FormHelperTextProps={{ sx: formulaHintSx }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    fullWidth
                  />
                </TableCell>
                <TableCell sx={QUOTE_LINE_TIGHT_CELL_SX}>
                  <TextField
                    variant="standard"
                    size="small"
                    type="text"
                    value={lineItem.extPrice}
                    disabled={!canEdit}
                    inputProps={{ inputMode: 'decimal' }}
                    placeholder="0.00"
                    InputProps={{
                      readOnly: true,
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    helperText="Qty × Unit"
                    fullWidth
                  />
                </TableCell>
                <TableCell align="center" sx={QUOTE_LINE_TIGHT_CELL_SX}>
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
              )
            })}
          </TableBody>
        </Table>
        </Box>
      </Box>
      <QuoteImageCropDialog
        open={Boolean(cropTarget)}
        file={cropTarget?.file || null}
        initialShape={cropTarget?.shape}
        initialDisplaySize={cropTarget?.displaySize}
        onCancel={() => setCropTarget(null)}
        onComplete={async (image) => {
          if (!cropTarget) return
          await onAddImages(cropTarget.index, [image], cropTarget.imageId)
          setCropTarget(null)
        }}
      />
      <Dialog open={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Insert from Quote Line Library</DialogTitle>
        <DialogContent><Stack spacing={1} sx={{ pt: 1 }}>
          <TextField autoFocus size="small" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search library" />
          {visibleLibraryEntries.map((entry) => <Paper key={entry.id} variant="outlined" sx={{ p: 1 }}><Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}><Box><Typography fontWeight={700}>{entry.name}</Typography><Typography variant="caption" color="text.secondary">{entry.lines.length} line{entry.lines.length === 1 ? '' : 's'}</Typography></Box><Button size="small" variant="contained" onClick={() => { onInsertLibraryEntry(entry); setIsLibraryOpen(false); setLibrarySearch('') }}>Insert</Button></Stack></Paper>)}
          {!libraryQuery.isLoading && visibleLibraryEntries.length === 0 ? <Typography color="text.secondary" textAlign="center" py={2}>No matching library items.</Typography> : null}
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setIsLibraryOpen(false)}>Close</Button></DialogActions>
      </Dialog>
      <Dialog open={saveLibraryTargetIndex !== null} onClose={() => !isSavingLibrary && setSaveLibraryTargetIndex(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Save to Quote Line Library</DialogTitle>
        <DialogContent><Stack spacing={1} sx={{ pt: 1 }}>
          {libraryError ? <Alert severity="error">{libraryError}</Alert> : null}
          <TextField autoFocus label="Library name" value={libraryNameDraft} onChange={(event) => setLibraryNameDraft(event.target.value)} helperText="The bold top line is used as the default name." />
        </Stack></DialogContent>
        <DialogActions><Button disabled={isSavingLibrary} onClick={() => setSaveLibraryTargetIndex(null)}>Cancel</Button><Button variant="contained" disabled={isSavingLibrary} onClick={() => void saveLineToLibrary()}>{isSavingLibrary ? 'Saving...' : 'Save to library'}</Button></DialogActions>
      </Dialog>
    </Stack>
  )
}


function QuoteServiceLocationPicker({
  value,
  onChange,
}: {
  value: CrmQuoteServiceLocation | null
  onChange: (location: CrmQuoteServiceLocation | null) => void
}) {
  const [inputValue, setInputValue] = useState(value?.label || '')
  const [options, setOptions] = useState<CrmPlaceSuggestion[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isUnavailable, setIsUnavailable] = useState(false)

  const query = inputValue.trim()
  const isQueryable = query.length >= 3 && query !== value?.label
  // Options are kept only for the query that fetched them, so a shortened or
  // re-selected input falls back to an empty list without another render pass.
  const visibleOptions = isQueryable ? options : []

  useEffect(() => {
    if (!isQueryable) {
      return
    }

    let cancelled = false
    // Typeahead runs against a shared upstream geocoder, so wait for a pause in
    // typing rather than firing a lookup per keystroke.
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true)
      fetchCrmPlaceSuggestions(query)
        .then((response) => {
          if (cancelled) return
          setOptions(response.suggestions || [])
          setIsUnavailable(Boolean(response.unavailable))
        })
        .catch(() => {
          if (!cancelled) {
            setOptions([])
            setIsUnavailable(true)
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false)
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [isQueryable, query])

  const detail = value
    ? [value.address, value.city, value.state, value.postalCode].filter(Boolean).join(', ')
    : ''
  const selectedOption: CrmPlaceSuggestion | null = value
    ? {
      kind: value.address ? 'address' : (value.city ? 'city' : 'state'),
      label: value.label,
      address: value.address,
      city: value.city,
      state: value.state,
      postalCode: value.postalCode,
    }
    : null

  return (
    <Autocomplete
      freeSolo
      autoComplete
      filterOptions={(suppliedOptions) => suppliedOptions}
      options={visibleOptions}
      loading={isSearching && isQueryable}
      inputValue={inputValue}
      value={selectedOption}
      isOptionEqualToValue={(option, selected) => option.label === selected?.label}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
      onInputChange={(_event, nextInput, reason) => {
        setInputValue(nextInput)

        // Free text still counts as a location; keep whatever was typed so a
        // spot the geocoder does not know is never silently dropped.
        if (reason === 'input') {
          const trimmed = nextInput.trim()
          onChange(trimmed
            ? { label: trimmed, address: null, city: null, state: null, postalCode: null }
            : null)
        }
      }}
      onChange={(_event, nextValue) => {
        if (!nextValue) {
          setInputValue('')
          onChange(null)
          return
        }

        if (typeof nextValue === 'string') {
          setInputValue(nextValue)
          onChange({ label: nextValue, address: null, city: null, state: null, postalCode: null })
          return
        }

        setInputValue(nextValue.label)
        onChange({
          label: nextValue.label,
          address: nextValue.address,
          city: nextValue.city,
          state: nextValue.state,
          postalCode: nextValue.postalCode,
        })
      }}
      renderOption={(props, option) => (
        <li {...props} key={`${option.kind}:${option.label}`}>
          <Stack spacing={0.15}>
            <Typography variant="body2" fontWeight={700}>{option.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {option.kind === 'state' ? 'State' : option.kind === 'city' ? 'City' : 'Address'}
            </Typography>
          </Stack>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Location"
          placeholder="Address, city, or state — e.g. NYC"
          helperText={isUnavailable
            ? 'Location lookup is unavailable right now. Type the location and it will be saved as written.'
            : (detail || 'Start typing a state, city, or street address.')}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {isSearching ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  )
}

function QuoteServiceCardSelector({
  heading,
  description,
  items,
  canEdit,
  onChange,
  addButtonLabel,
  itemLabel,
}: {
  heading: string
  description: string
  items: OpportunityServiceItemFormState[]
  canEdit: boolean
  onChange: (items: OpportunityServiceItemFormState[]) => void
  addButtonLabel: string
  itemLabel: string
}) {
  const [draft, setDraft] = useState<OpportunityServiceItemFormState | null>(null)
  const activeIndex = draft ? items.findIndex((item) => item.id === draft.id) : -1
  const quantity = Number(draft?.qty)
  const unitPrice = Number(draft?.unitPrice)
  const canSave = Boolean(
    draft?.title.trim()
    && draft?.qty.trim()
    && Number.isFinite(quantity)
    && quantity > 0
    && draft?.unitPrice.trim()
    && Number.isFinite(unitPrice)
    && unitPrice >= 0,
  )

  const saveDraft = () => {
    if (!draft) return
    const normalizedDraft = updateServiceItemPricing(draft, 'unitPrice', draft.unitPrice)
    onChange(activeIndex >= 0
      ? items.map((item, index) => index === activeIndex ? normalizedDraft : item)
      : [...items, normalizedDraft])
    setDraft(null)
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: 'hidden',
        borderRadius: 2.5,
        borderColor: 'divider',
        boxShadow: '0 10px 30px rgba(15, 76, 129, 0.07)',
      }}
    >
      <Box sx={{ px: 2, py: 1.6, bgcolor: 'grey.100' }}>
        <Typography variant="h6" fontWeight={850} color="primary.dark">{heading}</Typography>
        <Typography variant="body2" color="text.secondary">{description}</Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.4,
          p: 1.8,
          bgcolor: '#f8fafc',
        }}
      >
        {items.map((item) => {
          const isSelected = Number(item.qty) > 0
          return (
            <Paper
              key={item.id}
              component="button"
              type="button"
              disabled={!canEdit}
              onClick={() => setDraft({ ...item, images: [...item.images] })}
              variant="outlined"
              sx={{
                appearance: 'none',
                textAlign: 'left',
                width: '100%',
                minHeight: 150,
                p: 1.5,
                borderRadius: 2,
                cursor: canEdit ? 'pointer' : 'default',
                borderColor: isSelected ? 'primary.main' : 'divider',
                bgcolor: isSelected ? 'action.hover' : '#fff',
                boxShadow: isSelected ? 'none' : 'none',
                transition: 'transform 140ms ease, box-shadow 140ms ease',
                '&:hover': canEdit ? {
                  transform: 'translateY(-2px)',
                  boxShadow: '0 10px 25px rgba(15, 76, 129, 0.12)',
                  borderColor: 'primary.main',
                } : undefined,
              }}
            >
              <Stack spacing={1} height="100%">
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Typography variant="subtitle1" fontWeight={850} color="primary.dark">{item.title || `Custom ${itemLabel}`}</Typography>
                  {isSelected ? <Chip size="small" color="primary" label={`Qty ${item.qty}`} /> : <Chip size="small" variant="outlined" label="Select" />}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {item.description || `Add the details for this ${itemLabel}.`}
                </Typography>
                {item.location?.label ? (
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    {item.location.label}
                  </Typography>
                ) : null}
                <Typography variant="body2" fontWeight={750}>
                  {item.unitPrice.trim() ? `${formatCurrency(Number(item.unitPrice), 2)} each` : 'Enter price when selected'}
                </Typography>
              </Stack>
            </Paper>
          )
        })}
      </Box>
      <Box sx={{ px: 1.8, pb: 1.8, bgcolor: '#f8fafc' }}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          disabled={!canEdit}
          onClick={() => setDraft(createServiceItemFormState())}
          sx={{ py: 1.1, borderStyle: 'dashed', fontWeight: 800 }}
        >
          {addButtonLabel}
        </Button>
      </Box>

      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.8 }}>
          <Typography variant="h6" fontWeight={850}>{draft?.title || `Add custom ${itemLabel}`}</Typography>
          <Typography variant="body2" color="text.secondary">
            Review the details, then enter the quantity and unit price.
          </Typography>
        </DialogTitle>
        <DialogContent>
          {draft ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField
                required
                label={itemLabel === 'delivery option' ? 'Delivery Option' : 'Service'}
                value={draft.title}
                onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
              />
              <TextField
                label="Description"
                value={draft.description}
                onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}
                multiline
                minRows={3}
              />
              {itemLabel === 'delivery option' ? (
                <QuoteServiceLocationPicker
                  value={draft.location}
                  onChange={(location) => setDraft((current) => current ? { ...current, location } : current)}
                />
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
                <TextField
                  required
                  autoFocus
                  label="Quantity"
                  type="text"
                  value={draft.qty}
                  onChange={(event) => setDraft((current) => current ? updateServiceItemPricing(current, 'qty', event.target.value) : current)}
                  inputProps={{ inputMode: 'text' }}
                  helperText={formulaHint(draft.qty)}
                  sx={{ flex: 1 }}
                />
                <TextField
                  required
                  label="Unit Price"
                  type="text"
                  value={draft.unitPrice}
                  onChange={(event) => setDraft((current) => current ? updateServiceItemPricing(current, 'unitPrice', event.target.value) : current)}
                  inputProps={{ inputMode: 'decimal' }}
                  helperText={formulaHint(draft.unitPrice)}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  sx={{ flex: 1 }}
                />
              </Stack>
              <Alert severity="info">
                The extended price will be calculated automatically and shown on the final quote.
              </Alert>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          {activeIndex >= 0 && Number(items[activeIndex]?.qty) > 0 ? (
            <Button
              color="error"
              onClick={() => {
                onChange(items.map((item, index) => index === activeIndex ? { ...item, qty: '', extPrice: '' } : item))
                setDraft(null)
              }}
            >
              Remove from quote
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" disabled={!canSave} onClick={saveDraft}>Add to quote</Button>
        </DialogActions>
      </Dialog>
    </Paper>
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
  onMarkApproved,
  onMarkFollowedUp,
  onDeclineQuote,
  onDeleteQuote,
  onPrintQuote,
  onOpenDetails,
  onOpenChat,
}: OpportunityCardProps) {
  const dealerInitial = String(dealerName).trim().charAt(0).toUpperCase() || 'D'
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
        borderColor: 'divider',
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 2px rgba(15, 76, 129, 0.08)',
        cursor: 'pointer',
        transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 6px 20px rgba(15, 76, 129, 0.16)',
          borderColor: 'divider',
        },
      }}
    >
      <Stack spacing={0.9}>
        <Stack direction="row" spacing={0.9} alignItems="flex-start">
          <Avatar
            src={dealerPictureUrl || undefined}
            alt={dealerName}
            variant="rounded"
            imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
            sx={{
              width: 52,
              height: 52,
              flexShrink: 0,
              bgcolor: 'divider',
              color: 'primary.main',
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
                  textDecorationColor: 'inherit',
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
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {formatCurrency(Number(quote.totalAmount || 0), 2)}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ pt: 0.1 }}>
            <Chip
              size="small"
              label={`R${Number(quote.activeRevisionNumber ?? quote.revisionCount ?? 0)}`}
              color="primary"
              variant="outlined"
              sx={{ height: 19, fontSize: 10, fontWeight: 800 }}
            />
            {ageDays > 30 ? (
              <Chip size="small" label={`${ageDays}d`} color="warning" sx={{ height: 19, fontSize: 10 }} />
            ) : (
              <Chip size="small" label={`${ageDays}d`} sx={{ height: 19, fontSize: 10 }} />
            )}

            <Badge
              badgeContent={Number(quote.chatMessageCount ?? 0)}
              color="primary"
              overlap="circular"
              sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15, fontWeight: 800 } }}
            >
              <IconButton
                size="small"
                disabled={isBusy}
                onClick={(event) => {
                  preventCardClick(event)
                  onOpenChat(quote)
                }}
                sx={{ p: 0.15, color: 'primary.main' }}
                title="Quote chat"
                aria-label="Open quote chat"
              >
                <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 19 }} />
              </IconButton>
            </Badge>

            <IconButton
              size="small"
              disabled={isBusy}
              onClick={(event) => {
                preventCardClick(event)
                onPrintQuote(quote)
              }}
              sx={{ p: 0.15, color: 'primary.main' }}
              title="Print quote"
              aria-label="Print quote"
            >
              <PrintRoundedIcon sx={{ fontSize: 20 }} />
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
            onClick={(event) => {
              event.stopPropagation()
              closeMenu()
              onMarkFollowedUp(quote)
            }}
          >
            Mark as followed up
          </MenuItem>
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
  onMarkApproved,
  onMarkFollowedUp,
  onDeclineQuote,
  onDeleteQuote,
  onPrintQuote,
  onOpenDetails,
  onOpenChat,
  globalSearch,
  onGlobalSearchChange,
  isRefreshing,
  onRefresh,
  onAddOpportunity,
  isSyncingExcelQuote,
  onSyncExcelSheet,
}: StageColumnProps) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [sortMode, setSortMode] = useState<StageSortMode>('quote_number_desc')
  // Remembered per browser: whichever way you read this board, it is still that
  // way tomorrow morning.
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => {
    try {
      return window.localStorage.getItem('arnold.opportunities.view') === 'list' ? 'list' : 'cards'
    } catch {
      return 'cards'
    }
  })

  const [activeFilters, setActiveFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)
  const [draftFilters, setDraftFilters] = useState<StageColumnFilters>(createEmptyStageColumnFilters)

  const isMenuOpen = Boolean(menuAnchorEl)

  const resolveDealerName = useCallback((quote: CrmQuote) => String(
    dealersBySourceId.get(quote.dealerSourceId)?.name
      || quote.companyName
      || quote.dealerName
      || quote.dealerSourceId
      || '',
  ).trim(), [dealersBySourceId])

  // Read off the quote, not off the dealer list. The dealer list only loads
  // once a dialog opens, so on the list view it is empty and every avatar fell
  // back to a letter. The quote carries the picture already.
  const resolveDealerPicture = useCallback(
    (quote: CrmQuote) => String(
      quote.dealerPictureUrl ?? dealersBySourceId.get(quote.dealerSourceId)?.pictureUrl ?? '',
    ).trim() || null,
    [dealersBySourceId],
  )

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

    const amountOf = (quote: CrmQuote) => Number(quote.totalAmount || 0)

    if (sortMode === 'date_newest') {
      nextRows.sort((left, right) => compareQuotesByDate(left, right, 'desc'))
    } else if (sortMode === 'date_oldest') {
      nextRows.sort((left, right) => compareQuotesByDate(left, right, 'asc'))
    } else if (sortMode === 'amount_high') {
      nextRows.sort((left, right) => amountOf(right) - amountOf(left))
    } else if (sortMode === 'amount_low') {
      nextRows.sort((left, right) => amountOf(left) - amountOf(right))
    } else if (sortMode === 'account_az') {
      nextRows.sort((left, right) => resolveDealerName(left).localeCompare(resolveDealerName(right)))
    } else if (sortMode === 'quote_number_asc') {
      nextRows.sort(compareQuotesByQuoteNumber)
    } else {
      nextRows.sort((left, right) => compareQuotesByQuoteNumber(right, left))
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







  return (
    <Paper
      variant="outlined"
      sx={{
        width: '100%',
        minWidth: 0,
        borderRadius: 2.5,
        borderColor: 'divider',
        boxShadow: '0 12px 34px rgba(15, 35, 63, 0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Laid out like the invoice list it is modelled on: the title and the
          one primary action on their own line, then a filter row beneath where
          search takes the width and everything else stays small. */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        sx={{ px: { xs: 1.5, md: 2.5 }, pt: 2.5, pb: 1.5 }}
      >
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Opportunities</Typography>
          <Typography variant="body2" color="text.secondary">{`${rows.length} total`}</Typography>
        </Stack>

        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={onAddOpportunity}
          disabled={!canManage}
          sx={{
            // Near-black rather than the palette's green. The accent colour
            // belongs on state and totals, not on the one button that is
            // always on screen.
            bgcolor: 'grey.800',
            boxShadow: 'none',
            '&:hover': { bgcolor: 'grey.900', boxShadow: 'none' },
          }}
        >
          Add Opportunity
        </Button>
      </Stack>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={1.5}
        sx={{ px: { xs: 1.5, md: 2.5 }, pb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <TextField
          size="small"
          placeholder="Search quote, project, account…"
          value={globalSearch}
          onChange={(event) => onGlobalSearchChange(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
          sx={{ flexGrow: 1 }}
        />

        {/* One control, one list, no submenus. */}
        <TextField
          select
          size="small"
          label="Sort by"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as StageSortMode)}
          sx={{ width: { xs: '100%', md: 236 }, flexShrink: 0 }}
        >
          {STAGE_SORT_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_event, next: 'cards' | 'list' | null) => {
              if (!next) {
                return
              }

              setViewMode(next)

              try {
                window.localStorage.setItem('arnold.opportunities.view', next)
              } catch {
                // Storage is a convenience here, never a requirement.
              }
            }}
          >
            <ToggleButton value="cards" aria-label="Card view">
              <ViewModuleRoundedIcon sx={{ fontSize: 19 }} />
            </ToggleButton>
            <ToggleButton value="list" aria-label="List view">
              <ViewListRoundedIcon sx={{ fontSize: 19 }} />
            </ToggleButton>
          </ToggleButtonGroup>

          <Tooltip title={isRefreshing ? 'Refreshing…' : 'Refresh'}>
            <span>
              <IconButton size="small" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing
                  ? <CircularProgress size={17} color="inherit" />
                  : <RefreshRoundedIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>

          {activeFilterCount > 0 ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={activeFilterCount}
              onDelete={() => {
                const emptyFilters = createEmptyStageColumnFilters()
                setDraftFilters(emptyFilters)
                setActiveFilters(emptyFilters)
              }}
            />
          ) : null}

          <Tooltip title="Filters and more">
            <IconButton
              size="small"
              aria-label="Filters and more"
              onClick={(event) => setMenuAnchorEl(event.currentTarget)}
            >
              <MoreVertRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* What is left after sorting moved into the bar: the two filter actions
          and the Excel sync. No submenus. */}
      <Menu
        anchorEl={menuAnchorEl}
        open={isMenuOpen}
        onClose={() => setMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            setDraftFilters(activeFilters)
            setIsFilterDialogOpen(true)
            setMenuAnchorEl(null)
          }}
        >
          <ListItemIcon><FilterListRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Filters…</ListItemText>
        </MenuItem>

        <MenuItem
          disabled={activeFilterCount === 0}
          onClick={() => {
            const emptyFilters = createEmptyStageColumnFilters()
            setDraftFilters(emptyFilters)
            setActiveFilters(emptyFilters)
            setMenuAnchorEl(null)
          }}
        >
          <ListItemIcon><FilterAltOffRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Clear filters</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          disabled={!canManage || isSyncingExcelQuote}
          onClick={() => {
            setMenuAnchorEl(null)
            onSyncExcelSheet()
          }}
        >
          <ListItemIcon><UploadFileRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{isSyncingExcelQuote ? 'Syncing Excel sheet…' : 'Sync Excel Sheet'}</ListItemText>
        </MenuItem>
      </Menu>


      {viewMode === 'list' ? (
        <Box
          sx={{
            p: { xs: 1, md: 1.5 },
            height: 'clamp(620px, 78vh, 900px)',
            overflowY: 'auto',
          }}
        >
          <OpportunityListView
            quotes={visibleRows}
            resolveDealerName={resolveDealerName}
            resolveDealerPicture={resolveDealerPicture}
            formatDate={formatOpportunityLikeDate}
            formatMoney={(value) => formatCurrency(value, 2)}
            canManage={canManage}
            busyQuoteId={busyQuoteId}
            onOpenDetails={onOpenDetails}
            onOpenChat={onOpenChat}
            onPrintQuote={onPrintQuote}
            onDeleteQuote={onDeleteQuote}
          />
        </Box>
      ) : (
      <Box
        sx={{
          p: { xs: 1, md: 1.5 },
          height: 'clamp(620px, 78vh, 900px)',
          overflowY: 'auto',
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
              No opportunities found.
            </Typography>
          </Paper>
        ) : (
          visibleRows.map((quote) => {
            const dealer = dealersBySourceId.get(quote.dealerSourceId)
            const dealerName = dealer?.name || quote.dealerName || quote.dealerSourceId
            const dealerPictureUrl = String(
              dealer?.pictureUrl
              ?? quote.dealerPictureUrl
              ?? '',
            ).trim() || null
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
                onMarkApproved={onMarkApproved}
                onMarkFollowedUp={onMarkFollowedUp}
                onDeclineQuote={onDeclineQuote}
                onDeleteQuote={onDeleteQuote}
                onPrintQuote={onPrintQuote}
                onOpenDetails={onOpenDetails}
                onOpenChat={onOpenChat}
              />
            )
          })
        )}
      </Box>
      )}

      {/* no-error-surface: filter selection only, performs no writes */}
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
  const [formState, setFormState] = useState<OpportunityFormState>(createEmptyOpportunityForm)
  const [addOpportunityStage, setAddOpportunityStage] = useState<AddOpportunityStage>(0)
  const [addOpportunitySubmitAttempted, setAddOpportunitySubmitAttempted] = useState(false)
  const [dealerSearchInput, setDealerSearchInput] = useState('')
  const [isNewDealerDialogOpen, setIsNewDealerDialogOpen] = useState(false)
  const [newDealerForm, setNewDealerForm] = useState<NewDealerFormState>({
    name: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    salesRep: '',
    paymentTerms: DEFAULT_WEBSITE_PAYMENT_TERMS,
  })
  const [newDealerError, setNewDealerError] = useState<string | null>(null)
  const [isSavingNewDealer, setIsSavingNewDealer] = useState(false)
  const [selectedAddContactSourceId, setSelectedAddContactSourceId] = useState('')
  const [isNewContactDialogOpen, setIsNewContactDialogOpen] = useState(false)
  const [newContactForm, setNewContactForm] = useState({ name: '', email: '', phone: '' })
  const [newContactError, setNewContactError] = useState<string | null>(null)
  const [isSavingNewContact, setIsSavingNewContact] = useState(false)
  const [isPaymentTermsDialogOpen, setIsPaymentTermsDialogOpen] = useState(false)
  const [paymentTermsDraft, setPaymentTermsDraft] = useState('')
  const [paymentTermsApplyMode, setPaymentTermsApplyMode] = useState<'quote' | 'dealer'>('quote')
  const [isSavingPaymentTerms, setIsSavingPaymentTerms] = useState(false)
  const [isAddDialogDraftFromExcelSync, setIsAddDialogDraftFromExcelSync] = useState(false)
  const [addDialogInitialSnapshot, setAddDialogInitialSnapshot] = useState(() => serializeOpportunityFormState(createEmptyOpportunityForm()))
  const [isSyncingExcelQuote, setIsSyncingExcelQuote] = useState(false)
  const [isExcelAccountDialogOpen, setIsExcelAccountDialogOpen] = useState(false)
  const [isExcelSyncDialogOpen, setIsExcelSyncDialogOpen] = useState(false)
  const [excelSyncDraft, setExcelSyncDraft] = useState<CrmExcelQuoteSyncInput | null>(null)
  const [excelSyncImportSummary, setExcelSyncImportSummary] = useState<CrmExcelQuoteImportSummary | null>(null)
  const [excelSyncEmbeddedImages, setExcelSyncEmbeddedImages] = useState<ExcelSyncEmbeddedImage[]>([])
  const [excelSyncLookupResult, setExcelSyncLookupResult] = useState<CrmExcelQuoteLookupResponse | null>(null)
  const [excelSyncSourceFileName, setExcelSyncSourceFileName] = useState('')
  const [excelSyncSourceFile, setExcelSyncSourceFile] = useState<File | null>(null)
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
  const [isUploadingLineImage, setIsUploadingLineImage] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [isConvertOrderDialogOpen, setIsConvertOrderDialogOpen] = useState(false)
  const [isSubmittingConvertOrder, setIsSubmittingConvertOrder] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [loadingOpportunityId, setLoadingOpportunityId] = useState<string | null>(null)
  const [quotePrintPreview, setQuotePrintPreview] = useState<CrmQuote | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [opportunityDetailsStage, setOpportunityDetailsStage] = useState<AddOpportunityStage>(0)
  const [selectedRevisionNumber, setSelectedRevisionNumber] = useState(0)
  const [pendingRevisionSave, setPendingRevisionSave] = useState<PendingRevisionSave | null>(null)
  const [saveTargetRevisionNumber, setSaveTargetRevisionNumber] = useState(0)
  const [isCreatingRevision, setIsCreatingRevision] = useState(false)
  const [isDeletingRevision, setIsDeletingRevision] = useState(false)
  const [convertOrderTargetQuote, setConvertOrderTargetQuote] = useState<CrmQuote | null>(null)
  const [convertOrderFormState, setConvertOrderFormState] = useState<OpportunityConvertOrderFormState>(() => (
    createEmptyConvertOrderForm()
  ))
  const [opportunityDetailsFormState, setOpportunityDetailsFormState] = useState<OpportunityDetailsFormState | null>(null)
  const [opportunityDetailsInitialSnapshot, setOpportunityDetailsInitialSnapshot] = useState('')
  const [detailsActionMenuAnchorEl, setDetailsActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [saveActionMenuAnchorEl, setSaveActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const savePreferenceStorageKey = `arnold:quote-save-action:${appUser?.uid || 'current-user'}`
  const [preferredSaveAction, setPreferredSaveAction] = useState<OpportunitySavePreference>(() => (
    window.localStorage.getItem(savePreferenceStorageKey) === 'save_close' ? 'save_close' : 'save'
  ))
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [chatQuote, setChatQuote] = useState<CrmQuote | null>(null)
  const [addOpportunityChatNote, setAddOpportunityChatNote] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const activePipelineStage: CrmOpportunityStage = 'proposal_submission'
  const pipelineUploadExcelInputRef = useRef<HTMLInputElement | null>(null)
  const selectedOpportunityId = selectedOpportunity?.id ?? ''
  // The single-page quote form. It keeps its own draft so opening it never
  // disturbs a half-finished quote in the staged dialog, and hands that draft
  // to the same create call when it is done.
  const [isNewQuoteDialogOpen, setIsNewQuoteDialogOpen] = useState(false)
  const [newQuoteForm, setNewQuoteForm] = useState<OpportunityFormState>(createEmptySinglePageQuoteForm)
  const [newQuotePickerDealer, setNewQuotePickerDealer] = useState<CrmDealer | null>(null)
  const [newQuoteContactSourceId, setNewQuoteContactSourceId] = useState('')
  const [newQuoteCropTarget, setNewQuoteCropTarget] = useState<{
    index: number
    file: File
    imageId?: string
    shape?: QuoteImageShape
    displaySize?: QuoteImageDisplaySize
  } | null>(null)
  const [isUploadingNewQuoteImage, setIsUploadingNewQuoteImage] = useState(false)

  const shouldLoadDealers = Boolean(
    isDialogOpen
    || isNewQuoteDialogOpen
    || selectedOpportunityId
    || loadingOpportunityId
    || isExcelAccountDialogOpen
    || isExcelSyncDialogOpen
  )

  const dealersQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesDealers,
    queryFn: () => fetchCrmDealers({ limit: 2500, includeArchived: false }),
    staleTime: 5 * 60 * 1000,
    enabled: shouldLoadDealers,
  })

  const activeQuoteDealerSourceId = isNewQuoteDialogOpen
    ? (newQuotePickerDealer?.sourceId || newQuoteForm.dealerSourceId)
    : isDialogOpen
      ? formState.dealerSourceId
      : (opportunityDetailsFormState?.dealerSourceId || '')

  const addOpportunityContactsQuery = useQuery({
    queryKey: ['crm', 'dealer-contacts', activeQuoteDealerSourceId],
    queryFn: () => fetchCrmContacts({
      dealerSourceId: activeQuoteDealerSourceId,
      limit: 1000,
      includeArchived: false,
    }),
    enabled: Boolean((isDialogOpen || isNewQuoteDialogOpen || selectedOpportunityId) && activeQuoteDealerSourceId),
    staleTime: 5 * 60 * 1000,
  })

  const quotesQuery = useQuery({
    queryKey: [...QUERY_KEYS.crmOpportunitiesQuotes, detailsOnly ? 'history-detail' : 'open-pipeline'],
    queryFn: () => fetchCrmQuotes({
      limit: 500,
      status: 'all',
      lifecycle: detailsOnly ? 'all' : 'open',
      view: 'cards',
    }),
    staleTime: 60 * 1000,
  })

  const salesRepsQuery = useQuery({
    queryKey: QUERY_KEYS.crmSalesReps,
    queryFn: () => fetchCrmSalesReps(),
    staleTime: 5 * 60 * 1000,
    enabled: shouldLoadDealers,
  })

  const quotePrintSettingsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuotePrintSettings,
    queryFn: fetchCrmQuotePrintSettings,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(quotePrintPreview || selectedOpportunityId || isDialogOpen),
  })

  const convertOrderBoardsQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesConvertOrderBoards,
    queryFn: () => fetchCrmConvertOrderBoards(),
    staleTime: 0,
    enabled: isConvertOrderDialogOpen,
  })

  const isLoading = quotesQuery.isLoading
  const isRefreshing = (
    quotesQuery.isFetching
  ) && !isLoading

  const queryError = [
    quotesQuery.error,
  ]
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

  const loadOpportunityDetails = useCallback(async (summary: CrmQuote) => {
    const response = await fetchCrmQuoteDetails(summary.id)
    return {
      ...summary,
      ...response.quote,
      chatMessageCount: summary.chatMessageCount ?? response.quote.chatMessageCount,
    }
  }, [])

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

  useEffect(() => {
    const suggestedAcknowledgmentNumber = String(
      convertOrderBoardsQuery.data?.suggestedAcknowledgmentNumber ?? '',
    ).trim()

    if (!isConvertOrderDialogOpen || !suggestedAcknowledgmentNumber) {
      return
    }

    setConvertOrderFormState((current) => (
      current.acknowledgmentNumber.trim()
        ? current
        : { ...current, acknowledgmentNumber: suggestedAcknowledgmentNumber }
    ))
  }, [convertOrderBoardsQuery.data?.suggestedAcknowledgmentNumber, isConvertOrderDialogOpen])

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

  const addOpportunityContactOptions = useMemo(
    () => [...(addOpportunityContactsQuery.data?.contacts || [])]
      .sort((left, right) => resolveContactSelectionLabel(left).localeCompare(resolveContactSelectionLabel(right))),
    [addOpportunityContactsQuery.data?.contacts],
  )

  const selectedAddOpportunityContact = useMemo(
    () => addOpportunityContactOptions.find((contact) => contact.sourceId === selectedAddContactSourceId) || null,
    [addOpportunityContactOptions, selectedAddContactSourceId],
  )

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
      const isPriceSearch = /^\$?\s*[\d,]+(?:\.\d+)?\s*$/.test(term)
      const normalizedPriceSearch = isPriceSearch
        ? term.replace(/[$,\s]/g, '')
        : ''
      const totalAmount = Number(quote.totalAmount)
      const priceSearchText = Number.isFinite(totalAmount)
        ? `${totalAmount} ${totalAmount.toFixed(2)}`
        : ''

      return (
        quoteNum.includes(term)
        || title.includes(term)
        || companyName.includes(term)
        || dealerName.includes(term)
        || Boolean(
          normalizedPriceSearch
          && priceSearchText.includes(normalizedPriceSearch),
        )
      )
    })
  }, [activeQuotes, globalSearch])

  const stageBuckets = useMemo(() => {
    const base: Record<CrmOpportunityStage, CrmQuote[]> = {
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

  const activePipelineStageDefinition = stageById.get(activePipelineStage) || stageDefinitions[0]

  const selectedOpportunityStage = useMemo(
    () => (selectedOpportunity ? resolveOpportunityStage(selectedOpportunity) : null),
    [selectedOpportunity],
  )
  const selectedRevisionQuote = useMemo(
    () => (selectedOpportunity
      ? resolveQuoteRevision(selectedOpportunity, selectedRevisionNumber)
      : null),
    [selectedOpportunity, selectedRevisionNumber],
  )
  const activeRevisionNumber = Number(selectedOpportunity?.activeRevisionNumber ?? 0)
  const isSelectedRevisionActive = selectedRevisionNumber === activeRevisionNumber

  const isDetailsActionMenuOpen = Boolean(detailsActionMenuAnchorEl)
  const isSaveActionMenuOpen = Boolean(saveActionMenuAnchorEl)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(savePreferenceStorageKey)
      setPreferredSaveAction(stored === 'save_close' ? 'save_close' : 'save')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [savePreferenceStorageKey])

  const rememberSaveAction = useCallback((action: OpportunitySavePreference) => {
    setPreferredSaveAction(action)
    window.localStorage.setItem(savePreferenceStorageKey, action)
  }, [savePreferenceStorageKey])
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


  const isAddDialogDirty = useMemo(
    () => serializeOpportunityFormState(formState) !== addDialogInitialSnapshot,
    [addDialogInitialSnapshot, formState],
  )


  const addPricingPreview = useMemo(() => {
    const pricing = resolveQuotePricing(formState.lineItems, formState.freight, 0, formState.additionalServices, formState.shippingServices, formState.discountPercent, formState.discountScope)
    return {
      grossSubtotal: pricing.grossSubtotal,
      discountPercent: pricing.discountPercent,
      discountAmount: pricing.discountAmount,
      discountFreightAmount: pricing.discountFreightAmount,
      discountScope: pricing.discountScope,
      subtotal: pricing.subtotal ?? pricing.lineItemsTotal,
      freight: pricing.freight ?? 0,
      listPriceTotal: pricing.listPriceTotal,
      totalAmount: pricing.totalAmount,
    }
  }, [formState.additionalServices, formState.discountPercent, formState.discountScope, formState.freight, formState.lineItems, formState.shippingServices])

  const addOpportunityMissingByStage = useMemo(() => {
    const accountMissing: string[] = []
    const quoteNumber = formState.quoteNumber.trim()
    const selectedDealerExists = Boolean(
      formState.dealerSourceId.trim()
      && dealersBySourceId.has(formState.dealerSourceId.trim()),
    )
    const selectedContactExists = Boolean(
      selectedAddContactSourceId
      && addOpportunityContactOptions.some((contact) => contact.sourceId === selectedAddContactSourceId),
    )

    if (!quoteNumber) accountMissing.push('Quote number')
    if (quoteNumber && quotes.some(
      (entry) => normalizeQuoteFamilyValue(entry.quoteNumber) === normalizeQuoteFamilyValue(quoteNumber),
    )) {
      accountMissing.push('Unique quote number')
    }
    if (!selectedDealerExists) accountMissing.push('Saved dealer account')
    if (!formState.title.trim()) accountMissing.push('Project name')
    if (!formState.salesRep.trim()) accountMissing.push('Sales rep')
    if (!formState.opportunityDateInput.trim()) accountMissing.push('Quote date')
    if (!selectedContactExists) accountMissing.push('Saved contact name')
    if (!formState.contactEmail.trim()) {
      accountMissing.push('Contact email')
    } else if (!isValidEmailAddress(formState.contactEmail)) {
      accountMissing.push('Valid contact email')
    }
    if (!formState.paymentTerms.trim()) accountMissing.push('Payment terms')
    if (!formState.leadTime.trim()) accountMissing.push('Lead time')
    if (!isExcelSyncProjectTypeOption(formState.projectType.trim())) accountMissing.push('Project type')

    const quoteLinesMissing: string[] = []
    const enteredLineItems = formState.lineItems.filter((lineItem) => !isBlankLineItem(lineItem))

    if (enteredLineItems.length === 0) {
      quoteLinesMissing.push('At least one quote line')
    } else {
      enteredLineItems.forEach((lineItem, index) => {
        if (!lineItem.description.trim()) quoteLinesMissing.push(`Line ${index + 1} description`)
        if (lineItem.parentLineId) return
        if (!lineItem.qty.trim() || !Number.isFinite(Number(lineItem.qty)) || Number(lineItem.qty) <= 0) {
          quoteLinesMissing.push(`Line ${index + 1} quantity`)
        }
        if (!lineItem.unitPrice.trim() || !Number.isFinite(Number(lineItem.unitPrice)) || Number(lineItem.unitPrice) < 0) {
          quoteLinesMissing.push(`Line ${index + 1} unit price`)
        }
      })
    }

    return [accountMissing, quoteLinesMissing, [], [], []] as const
  }, [
    addOpportunityContactOptions,
    dealersBySourceId,
    formState.contactEmail,
    formState.dealerSourceId,
    formState.leadTime,
    formState.lineItems,
    formState.opportunityDateInput,
    formState.paymentTerms,
    formState.projectType,
    formState.quoteNumber,
    formState.salesRep,
    formState.title,
    quotes,
    selectedAddContactSourceId,
  ])

  const addOpportunityTotalMissing = addOpportunityMissingByStage
    .reduce((total, missingFields) => total + missingFields.length, 0)
  const addOpportunityCurrentStageMissing = addOpportunityMissingByStage[addOpportunityStage]

  const addOpportunityPreviewQuote = useMemo(
    () => buildQuotePreviewQuote(formState, addPricingPreview),
    [addPricingPreview, formState],
  )

  const newQuotePricing = useMemo(
    () => resolveQuotePricing(
      newQuoteForm.lineItems,
      newQuoteForm.freight,
      0,
      newQuoteForm.additionalServices,
      newQuoteForm.shippingServices,
      newQuoteForm.discountPercent,
      newQuoteForm.discountScope,
    ),
    [newQuoteForm],
  )

  const newQuotePreviewQuote = useMemo(
    () => buildQuotePreviewQuote(newQuoteForm, newQuotePricing),
    [newQuoteForm, newQuotePricing],
  )

  // The same standard services the staged form offers as cards, flattened into
  // the list the single-page form's picker shows.
  const newQuoteLibraryQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuoteLineLibrary,
    queryFn: () => fetchCrmQuoteLineLibrary(),
    enabled: isNewQuoteDialogOpen,
    staleTime: 60 * 1000,
  })

  const newQuoteLibraryEntries = useMemo(
    () => (Array.isArray(newQuoteLibraryQuery.data?.entries) ? newQuoteLibraryQuery.data.entries : []),
    [newQuoteLibraryQuery.data?.entries],
  )

  const handleSaveNewQuoteLibraryEntry = useCallback(async (name: string, lineIndex: number) => {
    const sourceLine = newQuoteForm.lineItems[lineIndex]

    if (!sourceLine || sourceLine.parentLineId) {
      return
    }

    const linesToSave = [
      sourceLine,
      ...newQuoteForm.lineItems.filter((line) => line.parentLineId === sourceLine.id),
    ]

    try {
      await createCrmQuoteLineLibraryEntry({
        name,
        // Prices are left out on purpose: a library block is the wording and
        // the structure, and last quarter's number is worse than none.
        lines: linesToSave.map((line, index) => ({
          id: line.id,
          parentLineId: line.parentLineId,
          itemNumber: index + 1,
          detailLabel: line.detailLabel || null,
          description: line.description || null,
          qty: null,
          unitPrice: null,
          extPrice: null,
          images: line.parentLineId ? [] : line.images,
        })),
      })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteLineLibrary })
      setSuccessMessage(`Saved "${name}" to the library.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save this library item.')
    }
    // Invalidating rather than refetching keeps this callback stable: the query
    // object itself is a new reference on every render.
  }, [newQuoteForm.lineItems, queryClient])

  const quoteLeadTimeOptions = useMemo(
    () => {
      const stored = quotePrintSettingsQuery.data?.settings?.leadTimeOptions
      const options = Array.isArray(stored) && stored.length > 0
        ? stored
        : DEFAULT_QUOTE_PRINT_SETTINGS.leadTimeOptions

      // A quote already saved with a lead time that has since been removed
      // still has to be able to show it.
      return newQuoteForm.leadTime && !options.includes(newQuoteForm.leadTime)
        ? [...options, newQuoteForm.leadTime]
        : options
    },
    [newQuoteForm.leadTime, quotePrintSettingsQuery.data?.settings?.leadTimeOptions],
  )

  const handleAddQuoteLeadTime = useCallback(async (leadTime: string) => {
    try {
      await addCrmQuoteLeadTime(leadTime)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuotePrintSettings })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save that lead time.')
    }
  }, [queryClient])

  const newQuoteServicePresets = useMemo(
    () => defaultAdditionalServiceTemplates.map(([title, description, unitPrice]) => ({
      title, description, unitPrice,
    })),
    [],
  )

  const newQuoteDeliveryPresets = useMemo(
    () => defaultShippingServiceTemplates.map(([title, description]) => ({
      title, description, unitPrice: null,
    })),
    [],
  )

  const detailsPricingPreview = useMemo(() => {
    if (!opportunityDetailsFormState) {
      return null
    }

    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.freight,
      Number(selectedOpportunity?.totalAmount || 0),
      opportunityDetailsFormState.additionalServices,
      opportunityDetailsFormState.shippingServices,
      opportunityDetailsFormState.discountPercent,
      opportunityDetailsFormState.discountScope,
    )

    return {
      grossSubtotal: pricing.grossSubtotal,
      discountPercent: pricing.discountPercent,
      discountAmount: pricing.discountAmount,
      discountFreightAmount: pricing.discountFreightAmount,
      discountScope: pricing.discountScope,
      subtotal: pricing.subtotal ?? pricing.lineItemsTotal,
      freight: pricing.freight ?? 0,
      listPriceTotal: pricing.listPriceTotal,
      totalAmount: pricing.totalAmount,
    }
  }, [opportunityDetailsFormState, selectedOpportunity?.totalAmount])

  const selectedOpportunityPrintQuote = useMemo<CrmQuote | null>(() => {
    if (!selectedRevisionQuote || !opportunityDetailsFormState) {
      return selectedRevisionQuote
    }

    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.freight,
      Number(selectedRevisionQuote.totalAmount || 0),
      opportunityDetailsFormState.additionalServices,
      opportunityDetailsFormState.shippingServices,
      opportunityDetailsFormState.discountPercent,
      opportunityDetailsFormState.discountScope,
    )

    return {
      ...selectedRevisionQuote,
      dealerSourceId: opportunityDetailsFormState.dealerSourceId.trim() || selectedRevisionQuote.dealerSourceId,
      companyName: opportunityDetailsFormState.companyName.trim() || null,
      contactName: opportunityDetailsFormState.contactName.trim() || null,
      contactEmail: opportunityDetailsFormState.contactEmail.trim() || null,
      contactPhone: opportunityDetailsFormState.contactPhone.trim() || null,
      salesRep: opportunityDetailsFormState.salesRep.trim() || null,
      quoteNumber: opportunityDetailsFormState.quoteNumber.trim() || null,
      title: opportunityDetailsFormState.title.trim() || selectedRevisionQuote.title,
      opportunityDate: opportunityDetailsFormState.opportunityDateInput.trim() || null,
      leadTime: opportunityDetailsFormState.leadTime.trim() || null,
      paymentTerms: opportunityDetailsFormState.paymentTerms.trim() || null,
      subtotal: pricing.subtotal,
      discountPercent: pricing.discountPercent,
      discountAmount: pricing.discountAmount,
      discountScope: pricing.discountScope,
      discountFreightAmount: pricing.discountFreightAmount,
      totalPriceType: opportunityDetailsFormState.totalPriceType,
      freight: pricing.freight,
      freightDescription: opportunityDetailsFormState.freightDescription.trim() || null,
      lineItems: pricing.normalizedLineItems,
      additionalServices: pricing.normalizedAdditionalServices,
      shippingServices: pricing.normalizedShippingServices,
      totalAmount: pricing.totalAmount,
      notes: opportunityDetailsFormState.notes.trim() || null,
    }
  }, [opportunityDetailsFormState, selectedRevisionQuote])

  const invalidateOpportunityData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesOrders }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmPageBootstrap }),
    ])
  }, [queryClient])

  const resetExcelSyncDialog = useCallback(() => {
    setIsExcelAccountDialogOpen(false)
    setIsExcelSyncDialogOpen(false)
    setExcelSyncDraft(null)
    setExcelSyncImportSummary(null)
    setExcelSyncEmbeddedImages([])
    setExcelSyncLookupResult(null)
    setExcelSyncSourceFileName('')
    setExcelSyncSourceFile(null)
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
    await quotesQuery.refetch()
  }, [quotesQuery])

  const initializeExcelSyncFromPayload = useCallback(async (
    excelPayload: ParsedExcelQuoteSyncInput,
    sourceFileName: string,
    options: { sourceFile?: File },
  ) => {
    const quoteNumberFromExcel = String(excelPayload.quoteNumber ?? '').trim()

    if (!quoteNumberFromExcel) {
      throw new Error('Excel quote file is missing a quote number.')
    }

    const lookupResult = await fetchCrmExcelQuoteLookup(quoteNumberFromExcel)
    const salesRepFromExcel = String(excelPayload.salesRep ?? '').trim()
    const defaultSalesRep = resolveMatchingOption(salesRepFromExcel, excelSyncSalesRepOptions)
    const accountNameFromExcel = String(excelPayload.companyName ?? '').trim()
    const matchedDealers = accountNameFromExcel
      ? findMatchingDealersByName(dealers, accountNameFromExcel)
      : []

    setExcelSyncLookupResult(lookupResult)
    setExcelSyncDraft(excelPayload)
    setExcelSyncImportSummary(excelPayload.importSummary)
    setExcelSyncEmbeddedImages(excelPayload.embeddedLineImages)
    setExcelSyncSourceFileName(sourceFileName)
    setExcelSyncSourceFile(options.sourceFile || null)
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
        sourceFile: file,
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

  const uploadLineItemImages = useCallback(async (
    files: Array<File | PreparedQuoteImage>,
    quoteNumber: string,
    companyName: string,
  ): Promise<CrmQuoteLineImage[]> => {
    const normalizedQuoteNumber = quoteNumber.trim()
    const companySegment = sanitizeStoragePathSegment(companyName.trim() || 'company', 'company')
    const quoteSegment = sanitizeStoragePathSegment(
      normalizedQuoteNumber || `draft-${crypto.randomUUID()}`,
      'opportunity',
    )
    const uploadedImages: CrmQuoteLineImage[] = []

    for (const imageInput of files) {
      const file = imageInput instanceof File ? imageInput : imageInput.file
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error(`${file.name} must be a JPG, PNG, or WebP image.`)
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`${file.name} must be 10 MB or smaller.`)
      }

      const id = crypto.randomUUID()
      const extension = resolveFileExtension(file) || '.jpg'
      const filePath = `crm/opportunities/${companySegment}/${quoteSegment}-line-image-${id}${extension}`
      const reference = storageRef(firebaseStorage, filePath)
      const dimensions = await readImageDimensions(file)
      await uploadBytes(reference, file, { contentType: file.type })
      uploadedImages.push({
        id,
        url: await getDownloadURL(reference),
        name: file.name,
        width: dimensions.width,
        height: dimensions.height,
        shape: imageInput instanceof File ? null : imageInput.shape,
        displaySize: imageInput instanceof File ? 'medium' : imageInput.displaySize,
      })
    }

    return uploadedImages
  }, [])

  const deleteUploadedDraftImages = useCallback(async (images: CrmQuoteLineImage[]) => {
    await Promise.all(images.map(async (image) => {
      const imageUrl = String(image.url || '').trim()
      if (!imageUrl) return

      try {
        await deleteObject(storageRef(firebaseStorage, imageUrl))
      } catch {
        // Cleanup is best-effort. The quote itself never saves an image URL
        // when its draft is discarded, so a failed cleanup remains harmless.
      }
    }))
  }, [])

  const handleAddNewQuoteImage = useCallback(async (
    index: number,
    prepared: PreparedQuoteImage,
    replaceImageId?: string,
  ) => {
    setErrorMessage(null)
    setIsUploadingNewQuoteImage(true)

    try {
      const images = await uploadLineItemImages(
        [prepared],
        newQuoteForm.quoteNumber,
        newQuoteForm.companyName,
      )

      // The picture being replaced is deleted from storage, not just dropped
      // from the form, or every adjustment would leave a file behind.
      const replaced = replaceImageId
        ? newQuoteForm.lineItems[index]?.images.find((image) => image.id === replaceImageId)
        : null

      if (replaced && images[0]) {
        void deleteUploadedDraftImages([replaced])
      }

      setNewQuoteForm((current) => ({
        ...current,
        lineItems: current.lineItems.map((line, lineIndex) => (lineIndex === index
          ? {
            ...line,
            images: replaceImageId
              ? line.images.map((image) => (image.id === replaceImageId ? images[0] || image : image))
              : [...line.images, ...images].slice(0, 2),
          }
          : line)),
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not upload that picture.')
    } finally {
      setIsUploadingNewQuoteImage(false)
    }
  }, [
    deleteUploadedDraftImages,
    newQuoteForm.companyName,
    newQuoteForm.lineItems,
    newQuoteForm.quoteNumber,
    uploadLineItemImages,
  ])

  // Reopens an added picture with its crop, zoom, shape and size as saved.
  const handleEditNewQuoteImage = useCallback(async (lineIndex: number, imageId: string) => {
    const image = newQuoteForm.lineItems[lineIndex]?.images.find((entry) => entry.id === imageId)

    if (!image) {
      return
    }

    try {
      const shape = quoteImageShapeOptions.some((option) => option.value === image.shape)
        ? image.shape as QuoteImageShape
        : 'landscape'
      const displaySize = quoteImageSizeOptions.some((option) => option.value === image.displaySize)
        ? image.displaySize as QuoteImageDisplaySize
        : 'medium'

      setNewQuoteCropTarget({
        index: lineIndex,
        file: await loadQuoteImageForEditing(image),
        imageId: image.id,
        shape,
        displaySize,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not open this picture.')
    }
  }, [newQuoteForm.lineItems])

  // Closing without creating has to take the uploaded pictures with it.
  // Nothing else ever references them, so left alone they would sit in storage
  // for good.
  const discardNewQuoteDraft = useCallback(() => {
    const orphanedImages = newQuoteForm.lineItems.flatMap((line) => line.images)

    if (orphanedImages.length > 0) {
      void deleteUploadedDraftImages(orphanedImages)
    }

    setNewQuoteForm(createEmptySinglePageQuoteForm())
    setNewQuotePickerDealer(null)
    setNewQuoteContactSourceId('')
    setIsNewQuoteDialogOpen(false)
  }, [deleteUploadedDraftImages, newQuoteForm.lineItems])

  const handleRemoveNewQuoteImage = useCallback((lineIndex: number, imageId: string) => {
    const removed = newQuoteForm.lineItems[lineIndex]?.images.find((image) => image.id === imageId)

    if (removed) {
      void deleteUploadedDraftImages([removed])
    }

    setNewQuoteForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, index) => (index === lineIndex
        ? { ...line, images: line.images.filter((image) => image.id !== imageId) }
        : line)),
    }))
  }, [deleteUploadedDraftImages, newQuoteForm.lineItems])

  // Edits made on the quote follow through to the contact record, so fixing an
  // address here fixes it for the next quote too.
  const handleSaveNewQuoteContact = useCallback(async (details: {
    name: string
    email: string
    phone: string
  }) => {
    if (!newQuoteContactSourceId) {
      return
    }

    try {
      await updateCrmContact(newQuoteContactSourceId, {
        name: details.name,
        primaryEmail: details.email,
        phone: details.phone || null,
      })
      await queryClient.invalidateQueries({
        queryKey: ['crm', 'dealer-contacts', newQuoteForm.dealerSourceId],
      })
    } catch (error) {
      setErrorMessage(error instanceof Error
        ? error.message
        : 'Saved on this quote, but the contact record could not be updated.')
    }
  }, [newQuoteContactSourceId, newQuoteForm.dealerSourceId, queryClient])

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
    setSuccessMessage(`Quote ${quoteNumber} is syncing in the background. You can keep using the site.`)
    setIsSyncingExcelQuote(true)
    setIsExcelSyncDialogOpen(false)

    try {
      const dealerFromMap = dealersBySourceId.get(resolvedDealerSourceId)
      const resolvedCompanyName = String(
        excelSyncResolvedDealerName
        || dealerFromMap?.name
        || excelSyncDraft.companyName
        || '',
      ).trim()

      if (!excelSyncSourceFile) {
        throw new Error('The source workbook is no longer available. Select the Excel or ODS file again.')
      }

      if (excelSyncSourceFile.size > 25 * 1024 * 1024) {
        throw new Error('The source workbook must be 25 MB or smaller.')
      }

      const syncedLineItems = Array.isArray(excelSyncDraft.lineItems)
        ? excelSyncDraft.lineItems.map((lineItem) => ({
          ...lineItem,
          images: Array.isArray(lineItem.images) ? [...lineItem.images] : [],
        }))
        : []

      if (excelSyncEmbeddedImages.length > 0) {
        const mainLineIndexes = syncedLineItems
          .map((lineItem, index) => ({ lineItem, index }))
          .filter(({ lineItem }) => !lineItem.parentLineId)
          .map(({ index }) => index)

        for (const embeddedImage of excelSyncEmbeddedImages) {
          const targetLineIndex = mainLineIndexes[embeddedImage.mainLineIndex]
          if (targetLineIndex === undefined) continue

          const targetLine = syncedLineItems[targetLineIndex]
          const existingImages = Array.isArray(targetLine.images) ? targetLine.images : []
          if (existingImages.length >= 2) continue

          const uploadedImages = await uploadLineItemImages(
            [embeddedImage.file],
            quoteNumber,
            resolvedCompanyName || String(excelSyncDraft.companyName || ''),
          )
          syncedLineItems[targetLineIndex] = {
            ...targetLine,
            images: [...existingImages, ...uploadedImages].slice(0, 2),
          }
        }
      }

      const companySegment = sanitizeStoragePathSegment(resolvedCompanyName || 'company', 'company')
      const quoteSegment = sanitizeStoragePathSegment(quoteNumber, 'opportunity')
      const workbookExtension = resolveFileExtension(excelSyncSourceFile) || '.xlsx'
      const workbookPath = `crm/opportunities/${companySegment}/${quoteSegment}-source-${Date.now()}${workbookExtension}`
      const workbookReference = storageRef(firebaseStorage, workbookPath)
      await uploadBytes(
        workbookReference,
        excelSyncSourceFile,
        excelSyncSourceFile.type ? { contentType: excelSyncSourceFile.type } : undefined,
      )
      const sourceWorkbookUrl = await getDownloadURL(workbookReference)
      const converted = await convertCrmQuoteWorkbook({
        workbookUrl: sourceWorkbookUrl,
        workbookName: excelSyncSourceFile.name,
        quoteNumber,
      })

      const syncInput: CrmExcelQuoteSyncInput = {
        ...excelSyncDraft,
        quoteNumber,
        salesRep: selectedSalesRep,
        dealerState: dealerStateCode,
        projectType: projectTypeInput,
        origin: 'excel',
        lineItems: syncedLineItems,
        sourceWorkbookUrl,
        sourceWorkbookName: excelSyncSourceFile.name,
        convertedPdfUrl: converted.convertedPdfUrl,
        convertedPdfName: converted.convertedPdfName,
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
        setSelectedOpportunity(targetQuote)
        setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(baseFormState))
        setOpportunityDetailsFormState(stagedFormState)
        resetExcelSyncDialog()
        setSuccessMessage(`Excel data loaded for ${quoteNumber}. Review and click Save to apply.`)
        return
      }

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
        subtotal: '',
        freight: syncInput.freight === null || syncInput.freight === undefined
          ? ''
          : String(syncInput.freight),
        freightDescription: String(syncInput.freightDescription ?? '').trim(),
        lineItems: stagedLineItems,
        origin: syncInput.origin === 'excel' ? 'excel' : 'website',
        sourceWorkbookUrl: String(syncInput.sourceWorkbookUrl || ''),
        sourceWorkbookName: String(syncInput.sourceWorkbookName || ''),
        convertedPdfUrl: String(syncInput.convertedPdfUrl || ''),
        convertedPdfName: String(syncInput.convertedPdfName || ''),
      })
      setIsAddDialogDraftFromExcelSync(true)
      setAddDialogInitialSnapshot(serializeOpportunityFormState(baseFormState))
      setIsDialogOpen(true)
      resetExcelSyncDialog()
      setSuccessMessage(`Excel data loaded for ${quoteNumber}. Review and create the opportunity.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to sync quote file.')
    } finally {
      setIsSyncingExcelQuote(false)
    }
  }, [
    dealersBySourceId,
    excelSyncDealerStateCode,
    excelSyncDraft,
    excelSyncEmbeddedImages,
    excelSyncSourceFile,
    excelSyncLookupResult,
    excelSyncAccountMode,
    excelSyncProjectTypeInput,
    excelSyncQuoteNumberInput,
    excelSyncResolvedDealerName,
    excelSyncResolvedDealerSourceId,
    excelSyncSalesRepInput,
    excelSyncSalesRepOptions,
    quotes,
    resetExcelSyncDialog,
    uploadLineItemImages,
  ])



  const handleOpenNewQuote = useCallback(() => {
    setNewQuoteForm(createEmptySinglePageQuoteForm())
    setNewQuotePickerDealer(null)
    setNewQuoteContactSourceId('')
    setErrorMessage(null)
    setIsNewQuoteDialogOpen(true)
  }, [])

  const handleOpenUploadQuoteExcelPicker = useCallback(() => {
    const input = pipelineUploadExcelInputRef.current

    if (!input) {
      return
    }

    input.value = ''
    input.click()
  }, [])

  // Duplicating asks one question first: does the copy keep the account, or is
  // it the same product for somebody else?
  const [duplicateSourceQuote, setDuplicateSourceQuote] = useState<CrmQuote | null>(null)

  const handleStartDuplicate = useCallback((keepAccountInformation: boolean) => {
    const sourceQuote = duplicateSourceQuote

    if (!sourceQuote) {
      return
    }

    const duplicatedFormState = createDuplicateOpportunityForm(sourceQuote, keepAccountInformation)

    setDuplicateSourceQuote(null)
    setSelectedOpportunity(null)
    setErrorMessage(null)
    setSuccessMessage(null)
    setFormState(duplicatedFormState)
    setAddOpportunityChatNote('')
    setAddOpportunityStage(0)
    setAddOpportunitySubmitAttempted(false)
    setDealerSearchInput('')
    setSelectedAddContactSourceId('')
    setAddDialogInitialSnapshot(serializeOpportunityFormState(duplicatedFormState))
    setIsAddDialogDraftFromExcelSync(false)
    setIsDialogOpen(true)
  }, [duplicateSourceQuote])

  const handleOpenDialog = useCallback(() => {
    const emptyFormState = createEmptyOpportunityForm()

    setErrorMessage(null)
    setSuccessMessage(null)
    setFormState(emptyFormState)
    setAddOpportunityChatNote('')
    setAddOpportunityStage(0)
    setAddOpportunitySubmitAttempted(false)
    setDealerSearchInput('')
    setSelectedAddContactSourceId('')
    setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
    setIsAddDialogDraftFromExcelSync(false)
    setIsDialogOpen(true)
  }, [])

  const handleOpenNewDealerDialog = useCallback(() => {
    setNewDealerError(null)
    setNewDealerForm({
      name: dealerSearchInput.trim(),
      email: '',
      phone: '',
      city: '',
      state: '',
      salesRep: formState.salesRep.trim(),
      paymentTerms: DEFAULT_WEBSITE_PAYMENT_TERMS,
    })
    setIsNewDealerDialogOpen(true)
  }, [dealerSearchInput, formState.salesRep])

  const handleCreateDealer = useCallback(async () => {
    const name = newDealerForm.name.trim()

    if (!name) {
      setNewDealerError('Dealer name is required.')
      return
    }

    setNewDealerError(null)
    setIsSavingNewDealer(true)

    try {
      const response = await createCrmDealer({
        name,
        quoteCompanyName: name,
        email: newDealerForm.email.trim() || null,
        phone: newDealerForm.phone.trim() || null,
        city: newDealerForm.city.trim() || null,
        state: newDealerForm.state.trim() || null,
        salesRep: newDealerForm.salesRep.trim() || null,
        paymentTerms: newDealerForm.paymentTerms.trim() || DEFAULT_WEBSITE_PAYMENT_TERMS,
      })
      const dealer = response.dealer

      setSelectedAddContactSourceId('')

      if (isNewQuoteDialogOpen) {
        // The picker moves straight on to this dealer's contacts, which is
        // where the flow was heading when Add was pressed.
        setNewQuotePickerDealer(dealer)
      } else {
        setDealerSearchInput(resolveDealerSelectionLabel(dealer))
        setFormState((current) => ({
          ...current,
          dealerSourceId: dealer.sourceId,
          companyName: resolveDealerQuoteCompanyName(dealer),
          salesRep: resolveMatchingOption(dealer.salesRep, excelSyncSalesRepOptions)
            || dealer.salesRep
            || current.salesRep
            || 'House',
          paymentTerms: dealer.paymentTerms || DEFAULT_WEBSITE_PAYMENT_TERMS,
          contactName: '',
          contactEmail: '',
          contactPhone: '',
        }))
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesDealers })
      setIsNewDealerDialogOpen(false)
    } catch (error) {
      setNewDealerError(error instanceof Error ? error.message : 'Failed to add dealer account.')
    } finally {
      setIsSavingNewDealer(false)
    }
  }, [
    excelSyncSalesRepOptions,
    isNewQuoteDialogOpen,
    newDealerForm.city,
    newDealerForm.email,
    newDealerForm.name,
    newDealerForm.paymentTerms,
    newDealerForm.phone,
    newDealerForm.salesRep,
    newDealerForm.state,
    queryClient,
  ])

  const handleOpenNewContactDialog = useCallback(() => {
    const contact = opportunityDetailsFormState || formState
    setNewContactError(null)
    setNewContactForm({
      name: contact.contactName.trim(),
      email: contact.contactEmail.trim(),
      phone: contact.contactPhone.trim(),
    })
    setIsNewContactDialogOpen(true)
  }, [formState, opportunityDetailsFormState])

  const handleSavePaymentTerms = useCallback(async () => {
    const paymentTerms = paymentTermsDraft.trim()

    if (!paymentTerms) {
      return
    }

    setIsSavingPaymentTerms(true)

    try {
      if (paymentTermsApplyMode === 'dealer' && activeQuoteDealerSourceId.trim()) {
        await updateCrmDealer(activeQuoteDealerSourceId.trim(), { paymentTerms })
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesDealers })
      }
      if (selectedOpportunityId) {
        setOpportunityDetailsFormState((current) => current ? ({ ...current, paymentTerms }) : current)
      } else {
        setFormState((current) => ({ ...current, paymentTerms }))
      }
      setIsPaymentTermsDialogOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update payment terms.')
    } finally {
      setIsSavingPaymentTerms(false)
    }
  }, [activeQuoteDealerSourceId, paymentTermsApplyMode, paymentTermsDraft, queryClient, selectedOpportunityId])

  const handleCreateDealerContact = useCallback(async () => {
    const dealerSourceId = activeQuoteDealerSourceId.trim()
    const name = newContactForm.name.trim()

    if (!dealerSourceId) {
      setNewContactError('Select a dealer before adding a contact.')
      return
    }

    if (!name) {
      setNewContactError('Contact name is required.')
      return
    }

    setNewContactError(null)
    setIsSavingNewContact(true)

    try {
      const response = await createCrmDealerContact(dealerSourceId, {
        name,
        primaryEmail: newContactForm.email.trim() || null,
        phone: newContactForm.phone.trim() || null,
      })
      const contact = response.contact
      setSelectedAddContactSourceId(contact.sourceId)

      if (isNewQuoteDialogOpen) {
        const dealer = newQuotePickerDealer
        setNewQuoteForm((current) => ({
          ...current,
          dealerSourceId: dealerSourceId,
          companyName: dealer ? resolveDealerQuoteCompanyName(dealer) : current.companyName,
          salesRep: current.salesRep
            || resolveMatchingOption(dealer?.salesRep, excelSyncSalesRepOptions)
            || 'House',
          paymentTerms: dealer?.paymentTerms || current.paymentTerms,
          contactName: resolveContactSelectionLabel(contact),
          contactEmail: contact.primaryEmail || '',
          contactPhone: contact.phone || '',
        }))
      } else if (selectedOpportunityId) {
        setOpportunityDetailsFormState((current) => current ? ({
          ...current,
          contactName: resolveContactSelectionLabel(contact),
          contactEmail: contact.primaryEmail || '',
          contactPhone: contact.phone || '',
        }) : current)
      } else {
        setFormState((current) => ({
          ...current,
          contactName: resolveContactSelectionLabel(contact),
          contactEmail: contact.primaryEmail || '',
          contactPhone: contact.phone || '',
        }))
      }
      await queryClient.invalidateQueries({ queryKey: ['crm', 'dealer-contacts', dealerSourceId] })
      setIsNewContactDialogOpen(false)
      setNewContactForm({ name: '', email: '', phone: '' })
    } catch (error) {
      setNewContactError(error instanceof Error ? error.message : 'Failed to add contact.')
    } finally {
      setIsSavingNewContact(false)
    }
  }, [
    activeQuoteDealerSourceId,
    excelSyncSalesRepOptions,
    isNewQuoteDialogOpen,
    newContactForm.email,
    newContactForm.name,
    newContactForm.phone,
    newQuotePickerDealer,
    queryClient,
    selectedOpportunityId,
  ])

  const clearDeepLinkedQuoteId = useCallback(() => {
    if (!searchParams.has('quoteId')) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('quoteId')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const openLoadedOpportunityDetails = useCallback((quote: CrmQuote) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setDetailsActionMenuAnchorEl(null)
    setSaveActionMenuAnchorEl(null)
    setPendingRevisionSave(null)
    const nextRevisionNumber = Number(quote.activeRevisionNumber ?? quote.revisionCount ?? 0)
    const nextRevisionQuote = resolveQuoteRevision(quote, nextRevisionNumber)
    const nextFormState = createOpportunityDetailsFormState(nextRevisionQuote)
    setSelectedAddContactSourceId(String(nextRevisionQuote.contactSourceId || ''))
    setSelectedOpportunity(quote)
    setOpportunityDetailsStage(0)
    setSelectedRevisionNumber(nextRevisionNumber)
    setOpportunityDetailsFormState(nextFormState)
    setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
  }, [])

  const handleOpenOpportunityDetails = useCallback(async (summary: CrmQuote) => {
    setErrorMessage(null)
    // Open from the card data immediately. Older accepted quotes can take longer
    // to hydrate, but the details surface should never appear unresponsive.
    openLoadedOpportunityDetails(summary)
    setBusyQuoteId(summary.id)
    try {
      openLoadedOpportunityDetails(await loadOpportunityDetails(summary))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load opportunity details.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [loadOpportunityDetails, openLoadedOpportunityDetails])

  useEffect(() => {
    if (!deepLinkedQuoteId) {
      return
    }

    const deepLinkedQuote = quotes.find((quote) => quote.id === deepLinkedQuoteId)

    if (deepLinkedQuote) {
      void handleOpenOpportunityDetails(deepLinkedQuote)
      return
    }

    if (!isLoading && !isRefreshing) {
      setErrorMessage(null)
      setBusyQuoteId(deepLinkedQuoteId)
      setLoadingOpportunityId(deepLinkedQuoteId)
      void fetchCrmQuoteDetails(deepLinkedQuoteId)
        .then((response) => {
          openLoadedOpportunityDetails(response.quote)
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load quote details.')
        })
        .finally(() => {
          setBusyQuoteId(null)
          setLoadingOpportunityId(null)
        })
    }
  }, [
    deepLinkedQuoteId,
    handleOpenOpportunityDetails,
    openLoadedOpportunityDetails,
    isLoading,
    isRefreshing,
    quotes,
  ])

  const handleCloseDialog = useCallback(() => {
    if (isSavingOpportunity) {
      return
    }

    if (isAddDialogDirty) {
      const confirmedDiscard = window.confirm('Are you sure you want to leave without saving?')

      if (!confirmedDiscard) {
        return
      }
    }

    // New-quote pictures upload for immediate preview. Remove every one when
    // the draft is discarded so Storage cannot accumulate orphan files.
    void deleteUploadedDraftImages(formState.lineItems.flatMap((lineItem) => lineItem.images))

    const emptyFormState = createEmptyOpportunityForm()

    setFormState(emptyFormState)
    setAddOpportunityStage(0)
    setAddOpportunitySubmitAttempted(false)
    setDealerSearchInput('')
    setSelectedAddContactSourceId('')
    setIsNewDealerDialogOpen(false)
    setIsNewContactDialogOpen(false)
    setIsPaymentTermsDialogOpen(false)
    setNewContactError(null)
    setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
    setIsAddDialogDraftFromExcelSync(false)
    setIsDialogOpen(false)
  }, [deleteUploadedDraftImages, formState.lineItems, isAddDialogDirty, isSavingOpportunity])

  const handleCloseOpportunityDetails = useCallback(() => {
    if (
      isSavingOpportunityDetails
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
    setSaveActionMenuAnchorEl(null)
    setSelectedOpportunity(null)
    setSelectedAddContactSourceId('')
    setOpportunityDetailsStage(0)
    setOpportunityDetailsFormState(null)
    setOpportunityDetailsInitialSnapshot('')
    clearDeepLinkedQuoteId()
  }, [
    clearDeepLinkedQuoteId,
    isOpportunityDetailsDirty,
    isSavingOpportunityDetails,
  ])

  const handleAddFormLineItem = useCallback(() => {
    setFormState((current) => ({
      ...current,
      lineItems: [...current.lineItems, createEmptyLineItemFormState()],
    }))
  }, [])

  const handleInsertFormLibraryEntry = useCallback((entry: CrmQuoteLineLibraryEntry) => {
    setFormState((current) => ({
      ...current,
      lineItems: insertQuoteLineLibraryEntry(current.lineItems, entry),
    }))
  }, [])

  const handleAddFormSubline = useCallback((index: number) => {
    setFormState((current) => {
      const parentLine = current.lineItems[index]
      if (!parentLine || parentLine.parentLineId) return current
      let insertIndex = index + 1
      while (current.lineItems[insertIndex]?.parentLineId === parentLine.id) insertIndex += 1
      const nextLineItems = [...current.lineItems]
      nextLineItems.splice(insertIndex, 0, createEmptyLineItemFormState(parentLine.id))
      return { ...current, lineItems: nextLineItems }
    })
  }, [])

  const handleCopyFormDetailToSubline = useCallback((index: number) => {
    setFormState((current) => ({
      ...current,
      lineItems: copyQuoteLineDetailToSubline(current.lineItems, index),
    }))
  }, [])

  const handleDuplicateFormLineItem = useCallback((index: number) => {
    setFormState((current) => ({
      ...current,
      lineItems: current.lineItems[index]?.parentLineId
        ? duplicateQuoteSubline(current.lineItems, index)
        : duplicateQuoteLineBlock(current.lineItems, index),
    }))
  }, [])

  const handleMoveFormLineItem = useCallback((index: number, direction: 'up' | 'down') => {
    setFormState((current) => ({
      ...current,
      lineItems: moveQuoteLineBlock(current.lineItems, index, direction),
    }))
  }, [])

  const handleRemoveFormLineItem = useCallback((index: number) => {
    const removedLine = formState.lineItems[index]
    const removedImages = formState.lineItems
      .filter((entry, entryIndex) => entryIndex === index || entry.parentLineId === removedLine?.id)
      .flatMap((entry) => entry.images)
    void deleteUploadedDraftImages(removedImages)

    setFormState((current) => {
      const currentRemovedLine = current.lineItems[index]
      const nextLineItems = current.lineItems.filter((entry, entryIndex) => (
        entryIndex !== index && entry.parentLineId !== currentRemovedLine?.id
      ))

      return {
        ...current,
        lineItems: nextLineItems.length > 0 ? nextLineItems : [createEmptyLineItemFormState()],
      }
    })
  }, [deleteUploadedDraftImages, formState.lineItems])

  const handleUpdateFormLineItem = useCallback(
    (index: number, field: 'detailLabel' | 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => {
      setFormState((current) => ({
        ...current,
        lineItems: current.lineItems.map((entry, entryIndex) => (
          entryIndex === index
            ? updateLineItemPricing(entry, field, value)
            : entry
        )),
      }))
    },
    [],
  )

  const handleAddFormLineImages = useCallback(async (index: number, files: PreparedQuoteImage[], replaceImageId?: string) => {
    setErrorMessage(null)
    setIsUploadingLineImage(true)
    try {
      const images = await uploadLineItemImages(files, formState.quoteNumber, formState.companyName)
      const replacedImage = replaceImageId
        ? formState.lineItems[index]?.images.find((image) => image.id === replaceImageId)
        : null
      if (replacedImage && images[0]) {
        void deleteUploadedDraftImages([replacedImage])
      }
      setFormState((current) => ({
        ...current,
        lineItems: current.lineItems.map((line, lineIndex) => lineIndex === index
          ? {
            ...line,
            images: replaceImageId
              ? line.images.map((image) => image.id === replaceImageId ? images[0] || image : image)
              : [...line.images, ...images].slice(0, 2),
          }
          : line),
      }))
    } catch (error) {
      const uploadError = error instanceof Error ? error : new Error('Failed to upload line picture.')
      setErrorMessage(uploadError.message)
      throw uploadError
    } finally {
      setIsUploadingLineImage(false)
    }
  }, [deleteUploadedDraftImages, formState.companyName, formState.lineItems, formState.quoteNumber, uploadLineItemImages])

  const handleRemoveFormLineImage = useCallback((lineIndex: number, imageId: string) => {
    const removedImage = formState.lineItems[lineIndex]?.images.find((image) => image.id === imageId)
    if (removedImage) {
      void deleteUploadedDraftImages([removedImage])
    }
    setFormState((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, index) => index === lineIndex
        ? { ...line, images: line.images.filter((image) => image.id !== imageId) }
        : line),
    }))
  }, [deleteUploadedDraftImages, formState.lineItems])


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

  const handleInsertDetailsLibraryEntry = useCallback((entry: CrmQuoteLineLibraryEntry) => {
    setOpportunityDetailsFormState((current) => current ? ({
      ...current,
      lineItems: insertQuoteLineLibraryEntry(current.lineItems, entry),
    }) : current)
  }, [])

  const handleAddDetailsSubline = useCallback((index: number) => {
    setOpportunityDetailsFormState((current) => {
      if (!current) return current
      const parentLine = current.lineItems[index]
      if (!parentLine || parentLine.parentLineId) return current
      let insertIndex = index + 1
      while (current.lineItems[insertIndex]?.parentLineId === parentLine.id) insertIndex += 1
      const nextLineItems = [...current.lineItems]
      nextLineItems.splice(insertIndex, 0, createEmptyLineItemFormState(parentLine.id))
      return { ...current, lineItems: nextLineItems }
    })
  }, [])

  const handleCopyDetailsDetailToSubline = useCallback((index: number) => {
    setOpportunityDetailsFormState((current) => (current
      ? { ...current, lineItems: copyQuoteLineDetailToSubline(current.lineItems, index) }
      : current))
  }, [])

  const handleDuplicateDetailsLineItem = useCallback((index: number) => {
    setOpportunityDetailsFormState((current) => (current
      ? {
        ...current,
        lineItems: current.lineItems[index]?.parentLineId
          ? duplicateQuoteSubline(current.lineItems, index)
          : duplicateQuoteLineBlock(current.lineItems, index),
      }
      : current))
  }, [])

  const handleMoveDetailsLineItem = useCallback((index: number, direction: 'up' | 'down') => {
    setOpportunityDetailsFormState((current) => (current
      ? { ...current, lineItems: moveQuoteLineBlock(current.lineItems, index, direction) }
      : current))
  }, [])

  const handleRemoveDetailsLineItem = useCallback((index: number) => {
    setOpportunityDetailsFormState((current) => {
      if (!current) {
        return current
      }

      const removedLine = current.lineItems[index]
      const nextLineItems = current.lineItems.filter((entry, entryIndex) => (
        entryIndex !== index && entry.parentLineId !== removedLine?.id
      ))

      return {
        ...current,
        lineItems: nextLineItems.length > 0 ? nextLineItems : [createEmptyLineItemFormState()],
      }
    })
  }, [])

  const handleUpdateDetailsLineItem = useCallback(
    (index: number, field: 'detailLabel' | 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => {
      setOpportunityDetailsFormState((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          lineItems: current.lineItems.map((entry, entryIndex) => (
            entryIndex === index
              ? updateLineItemPricing(entry, field, value)
              : entry
          )),
        }
      })
    },
    [],
  )

  const handleAddDetailsLineImages = useCallback(async (index: number, files: PreparedQuoteImage[], replaceImageId?: string) => {
    if (!opportunityDetailsFormState) return
    setErrorMessage(null)
    setIsUploadingLineImage(true)
    try {
      const images = await uploadLineItemImages(
        files,
        opportunityDetailsFormState.quoteNumber,
        opportunityDetailsFormState.companyName,
      )
      setOpportunityDetailsFormState((current) => current ? ({
        ...current,
        lineItems: current.lineItems.map((line, lineIndex) => lineIndex === index
          ? {
            ...line,
            images: replaceImageId
              ? line.images.map((image) => image.id === replaceImageId ? images[0] || image : image)
              : [...line.images, ...images].slice(0, 2),
          }
          : line),
      }) : current)
    } catch (error) {
      const uploadError = error instanceof Error ? error : new Error('Failed to upload line picture.')
      setErrorMessage(uploadError.message)
      throw uploadError
    } finally {
      setIsUploadingLineImage(false)
    }
  }, [opportunityDetailsFormState, uploadLineItemImages])

  const handleRemoveDetailsLineImage = useCallback((lineIndex: number, imageId: string) => {
    setOpportunityDetailsFormState((current) => current ? ({
      ...current,
      lineItems: current.lineItems.map((line, index) => index === lineIndex
        ? { ...line, images: line.images.filter((image) => image.id !== imageId) }
        : line),
    }) : current)
  }, [])


  const handlePrintQuote = useCallback(async (quoteSummary: CrmQuote, detailsAlreadyLoaded = false) => {
    setErrorMessage(null)
    setBusyQuoteId(quoteSummary.id)
    setLoadingOpportunityId(quoteSummary.id)

    let quote: CrmQuote
    try {
      quote = detailsAlreadyLoaded ? quoteSummary : await loadOpportunityDetails(quoteSummary)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load this quote for printing.')
      setBusyQuoteId(null)
      setLoadingOpportunityId(null)
      return
    }
    setLoadingOpportunityId(null)

    setQuotePrintPreview(quote)
    setBusyQuoteId(null)
  }, [loadOpportunityDetails])

  const handleSelectRevision = useCallback((nextRevisionNumber: number) => {
    if (!selectedOpportunity || nextRevisionNumber === selectedRevisionNumber) {
      return
    }

    if (isOpportunityDetailsDirty) {
      const confirmed = window.confirm('Discard the unsaved changes and open another revision?')
      if (!confirmed) return
    }

    const revisionQuote = resolveQuoteRevision(selectedOpportunity, nextRevisionNumber)
    const nextFormState = createOpportunityDetailsFormState(revisionQuote)
    setSelectedAddContactSourceId(String(revisionQuote.contactSourceId || ''))
    setSelectedRevisionNumber(nextRevisionNumber)
    setOpportunityDetailsFormState(nextFormState)
    setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
    setErrorMessage(null)
    setSuccessMessage(null)
  }, [isOpportunityDetailsDirty, selectedOpportunity, selectedRevisionNumber])

  const handleCreateRevision = useCallback(async () => {
    if (!selectedOpportunity || !selectedOpportunityPrintQuote) return

    if (isOpportunityDetailsDirty) {
      setErrorMessage('Save the current revision before creating the next revision.')
      return
    }

    const confirmed = window.confirm(
      `Create Revision ${Number(selectedOpportunity.revisionCount ?? activeRevisionNumber) + 1} from Revision ${selectedRevisionNumber}?`,
    )
    if (!confirmed) return

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsCreatingRevision(true)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      const response = await createCrmQuoteRevision(selectedOpportunity.id, {
        sourceRevisionNumber: selectedRevisionNumber,
      })
      const nextQuote = response.quote
      const nextRevisionNumber = Number(nextQuote.activeRevisionNumber ?? nextQuote.revisionCount ?? 0)
      const nextRevisionQuote = resolveQuoteRevision(nextQuote, nextRevisionNumber)
      const nextFormState = createOpportunityDetailsFormState(nextRevisionQuote)

      setSelectedOpportunity(nextQuote)
      setSelectedRevisionNumber(nextRevisionNumber)
      setOpportunityDetailsFormState(nextFormState)
      setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
      await invalidateOpportunityData()
      setSuccessMessage(`Revision ${nextRevisionNumber} created.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create the new revision.')
    } finally {
      setIsCreatingRevision(false)
      setBusyQuoteId(null)
    }
  }, [
    activeRevisionNumber,
    invalidateOpportunityData,
    isOpportunityDetailsDirty,
    selectedOpportunity,
    selectedOpportunityPrintQuote,
    selectedRevisionNumber,
  ])

  const handleDeleteRevision = useCallback(async () => {
    if (!selectedOpportunity) return
    const revisions = selectedOpportunity.revisions || []

    if (revisions.length <= 1) {
      setErrorMessage('Revision 0 is the only revision. Delete the whole opportunity if you want to remove it.')
      return
    }

    const warning = selectedRevisionNumber === 0
      ? 'Delete Revision 0? Every remaining revision will jump back one number. This cannot be undone.'
      : `Delete Revision ${selectedRevisionNumber}? Every later revision will jump back one number. This cannot be undone.`
    if (!window.confirm(warning)) return

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsDeletingRevision(true)
    setBusyQuoteId(selectedOpportunity.id)

    try {
      const response = await removeCrmQuoteRevision(selectedOpportunity.id, selectedRevisionNumber)
      const nextQuote = response.quote
      const nextRevisionNumber = Math.min(
        selectedRevisionNumber,
        Number(nextQuote.revisionCount ?? 0),
      )
      const nextRevisionQuote = resolveQuoteRevision(nextQuote, nextRevisionNumber)
      const nextFormState = createOpportunityDetailsFormState(nextRevisionQuote)
      setSelectedOpportunity(nextQuote)
      setSelectedRevisionNumber(nextRevisionNumber)
      setOpportunityDetailsFormState(nextFormState)
      setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
      await invalidateOpportunityData()
      setSuccessMessage(`Revision deleted. The remaining revisions are now numbered 0 through ${nextQuote.revisionCount ?? 0}.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete the revision.')
    } finally {
      setIsDeletingRevision(false)
      setBusyQuoteId(null)
    }
  }, [invalidateOpportunityData, selectedOpportunity, selectedRevisionNumber])

  // `draft` is passed by the single-page form, which validates its own fields
  // and keeps its own state. Without it this saves the staged dialog's form.
  const handleCreateOpportunity = useCallback(async (draft?: OpportunityFormState) => {
    const isSinglePageDraft = Boolean(draft)
    const source = draft ?? formState
    const dealerSourceId = source.dealerSourceId.trim()
    const quoteNumber = source.quoteNumber.trim()
    const opportunityDateInput = source.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(source.lineItems, source.freight, 0, source.additionalServices, source.shippingServices, source.discountPercent, source.discountScope)
    const lineItems = pricing.normalizedLineItems
    const totalAmount = pricing.totalAmount

    if (!isSinglePageDraft) {
      setAddOpportunitySubmitAttempted(true)
    }

    if (!isSinglePageDraft && addOpportunityTotalMissing > 0) {
      setErrorMessage(
        `${addOpportunityTotalMissing} required ${addOpportunityTotalMissing === 1 ? 'field is' : 'fields are'} missing. Review the stages marked in red.`,
      )
      return
    }

    const isDuplicateQuoteNumber = quotes.some(
      (entry) => normalizeQuoteFamilyValue(entry.quoteNumber) === normalizeQuoteFamilyValue(quoteNumber),
    )

    if (isDuplicateQuoteNumber) {
      setErrorMessage(`Quote number ${quoteNumber} already exists. Open that opportunity instead.`)
      return
    }

    if (opportunityDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date must be a valid date.')
      return
    }

    const title = source.title.trim() || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${quoteNumber}`
    const targetStage: CrmOpportunityStage = 'proposal_submission'
    const isExcelDraft = !isSinglePageDraft && isAddDialogDraftFromExcelSync
    const targetStatus = isExcelDraft ? 'sent' : 'draft'
    const sentAt = isExcelDraft ? new Date().toISOString() : null

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunity(true)

    try {

      // The single-page form picks an existing contact rather than editing one
      // inline, so there is nothing to write back for it.
      if (!isSinglePageDraft && selectedAddContactSourceId) {
        await updateCrmContact(selectedAddContactSourceId, {
          name: source.contactName.trim(),
          primaryEmail: source.contactEmail.trim(),
          phone: source.contactPhone.trim() || null,
        })
      }

      const createdQuote = await createCrmQuote({
        dealerSourceId,
        quoteNumber,
        title,
        companyName: source.companyName.trim() || null,
        contactName: source.contactName.trim() || null,
        contactEmail: source.contactEmail.trim() || null,
        contactPhone: source.contactPhone.trim() || null,
        contactSourceId: selectedAddContactSourceId || null,
        salesRep: source.salesRep.trim() || null,
        projectType: source.projectType.trim() || null,
        leadTime: source.leadTime.trim() || null,
        paymentTerms: source.paymentTerms.trim() || null,
        subtotal: pricing.subtotal,
        discountPercent: pricing.discountPercent,
        discountAmount: pricing.discountAmount,
        discountScope: pricing.discountScope,
        discountFreightAmount: pricing.discountFreightAmount,
        totalPriceType: source.totalPriceType,
        freight: pricing.freight,
        freightDescription: source.freightDescription.trim() || null,
        status: targetStatus,
        opportunityStage: targetStage,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        additionalServices: pricing.normalizedAdditionalServices,
        shippingServices: pricing.normalizedShippingServices,
        origin: source.origin,
        sourceWorkbookUrl: source.sourceWorkbookUrl || null,
        sourceWorkbookName: source.sourceWorkbookName || null,
        convertedPdfUrl: source.convertedPdfUrl || null,
        convertedPdfName: source.convertedPdfName || null,
        totalAmount,
        sentAt,
        notes: source.notes.trim() || null,
        revisionCount: 0,
      })

      const openingNote = isSinglePageDraft ? '' : addOpportunityChatNote.trim()
      const createdQuoteId = String(createdQuote?.quote?.id ?? '').trim()

      if (openingNote && createdQuoteId) {
        try {
          await createCrmQuoteChatMessage(createdQuoteId, openingNote)
        } catch {
          // The quote itself is saved; a failed opening note must not read as a
          // failed submission.
          setErrorMessage('Opportunity created, but the first chat message could not be posted.')
        }
      }

      await invalidateOpportunityData()

      const emptyFormState = createEmptyOpportunityForm()

      setSuccessMessage('Opportunity created.')

      if (isSinglePageDraft) {
        setNewQuoteForm(createEmptySinglePageQuoteForm())
        setNewQuotePickerDealer(null)
        setIsNewQuoteDialogOpen(false)
      } else {
        setFormState(emptyFormState)
        setAddOpportunityChatNote('')
        setAddOpportunityStage(0)
        setAddOpportunitySubmitAttempted(false)
        setDealerSearchInput('')
        setSelectedAddContactSourceId('')
        setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
        setIsAddDialogDraftFromExcelSync(false)
        setIsDialogOpen(false)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create opportunity.')
    } finally {
      setIsSavingOpportunity(false)
    }
  }, [
    addOpportunityChatNote,
    addOpportunityTotalMissing,
    formState,
    invalidateOpportunityData,
    isAddDialogDraftFromExcelSync,
    quotes,
    selectedAddContactSourceId,
  ])

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
    const convertedKeys = new Set(Array.isArray(quote.convertedItemKeys) ? quote.convertedItemKeys : [])
    const nextForm = createEmptyConvertOrderForm(
        convertOrderPrimaryBoardId,
        convertOrderSecondaryBoardId,
        String(quote.acknowledgmentNumber || '').trim(),
      )
    nextForm.leadTime = String(quote.leadTime || '').trim()
    nextForm.selectedLineItemIds = (quote.lineItems || [])
      .filter((item) => Number(item.qty ?? 1) !== 0)
      .map((item) => String(item.id || item.itemNumber || '').trim())
      .filter((id) => id && !convertedKeys.has(`line:${id}`))
    nextForm.selectedAdditionalServiceIds = (quote.additionalServices || []).filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0 && !convertedKeys.has(`additional:${item.id}`)).map((item) => item.id)
    nextForm.selectedShippingServiceIds = (quote.shippingServices || []).filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0 && !convertedKeys.has(`shipping:${item.id}`)).map((item) => item.id)
    // A quote-level freight amount is separate from the delivery service. Do
    // not auto-select both, which otherwise creates duplicate delivery charges.
    nextForm.includeFreight = nextForm.selectedShippingServiceIds.length === 0
      && Number(quote.freight || 0) > 0
      && !convertedKeys.has('freight')
    setConvertOrderFormState(nextForm)
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

    const acknowledgmentNumber = convertOrderFormState.acknowledgmentNumber.trim()
    const poDate = convertOrderFormState.poDate.trim()
    const leadTime = convertOrderFormState.leadTime.trim()
    const shipTo = convertOrderFormState.shipTo.trim()
    const depositRequired = convertOrderFormState.depositRequirement === 'required'
    const depositPercent = depositRequired ? Number(convertOrderFormState.depositPercent) : null

    if (!acknowledgmentNumber) {
      setErrorMessage('Acknowledgement Number is required.')
      return
    }

    if (!poDate || !/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
      setErrorMessage('P.O. date is required and must be valid.')
      return
    }

    if (!shipTo) {
      setErrorMessage('Ship To is required.')
      return
    }

    if (!convertOrderFormState.depositRequirement) {
      setErrorMessage('Select whether a deposit is required.')
      return
    }

    if (depositRequired && (!Number.isFinite(depositPercent) || Number(depositPercent) <= 0 || Number(depositPercent) > 100)) {
      setErrorMessage('Deposit percentage must be greater than 0 and no more than 100.')
      return
    }

    const selectedCount = convertOrderFormState.selectedLineItemIds.length
      + convertOrderFormState.selectedAdditionalServiceIds.length
      + convertOrderFormState.selectedShippingServiceIds.length
      + (convertOrderFormState.includeFreight ? 1 : 0)
    if (selectedCount === 0) {
      setErrorMessage('Select at least one quote line to convert.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmittingConvertOrder(true)
    setBusyQuoteId(convertOrderTargetQuote.id)
    setIsConvertOrderDialogOpen(false)
    setConvertOrderTargetQuote(null)
    setConvertOrderFormState(createEmptyConvertOrderForm(convertOrderPrimaryBoardId, convertOrderSecondaryBoardId))
    setDetailsActionMenuAnchorEl(null)
    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
    setOpportunityDetailsInitialSnapshot('')
    setIsSubmittingConvertOrder(false)
    setBusyQuoteId(null)

    try {
      await runAppProcess({
        label: `Converting ${convertOrderTargetQuote.quoteNumber || convertOrderTargetQuote.title || 'quote'} to order`,
        detail: `Acknowledgement ${acknowledgmentNumber}`,
      }, async () => {
        const selectedProductLines: OrderDocumentLine[] = [
        ...(convertOrderTargetQuote.lineItems || []).filter((item) => convertOrderFormState.selectedLineItemIds.includes(String(item.id || item.itemNumber || ''))).map((item) => ({ id: String(item.id || item.itemNumber || ''), parentLineId: item.parentLineId || null, detailLabel: item.detailLabel || null, description: item.description || 'Product', qty: item.qty, unitPrice: item.unitPrice, extPrice: Number(item.extPrice || 0), category: 'product' as const })),
        ...(convertOrderTargetQuote.additionalServices || []).filter((item) => convertOrderFormState.selectedAdditionalServiceIds.includes(item.id)).map((item) => ({ id: item.id, description: item.title || item.description || 'Additional service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, extPrice: Number(resolveServiceItemExtPrice(item) || 0), category: 'additional' as const })),
        ]
        const selectedFreightLines: OrderDocumentLine[] = (convertOrderTargetQuote.shippingServices || []).filter((item) => convertOrderFormState.selectedShippingServiceIds.includes(item.id)).map((item) => ({ id: item.id, description: item.title || item.description || 'Freight service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, extPrice: Number(resolveServiceItemExtPrice(item) || 0), category: 'freight' as const }))
        const quoteFreight = convertOrderFormState.includeFreight ? Number(convertOrderTargetQuote.freight || 0) : 0
        if (quoteFreight > 0) selectedFreightLines.push({ id: 'quote-freight', description: 'Delivery', qty: 1, unitPrice: quoteFreight, extPrice: quoteFreight, category: 'freight' })
        const productGross = selectedProductLines.reduce((sum, line) => sum + line.extPrice, 0)
        const discountPercent = Math.min(100, Math.max(0, Number(convertOrderTargetQuote.discountPercent || 0)))
        const discountAmount = Number((productGross * (discountPercent / 100)).toFixed(2))
        const productNet = Number((productGross - discountAmount).toFixed(2))
        const freightGross = selectedFreightLines.reduce((sum, line) => sum + line.extPrice, 0)
        const freightDiscountAmount = convertOrderTargetQuote.discountScope === 'products_and_freight'
          ? Number((freightGross * (discountPercent / 100)).toFixed(2))
          : 0
        const freightNet = Number((freightGross - freightDiscountAmount).toFixed(2))
        const documentData = buildOrderDocumentData({
          documentDate: poDate,
          companyName: convertOrderTargetQuote.companyName || convertOrderTargetQuote.dealerName || '',
          contactName: convertOrderTargetQuote.contactName || '',
          contactEmail: convertOrderTargetQuote.contactEmail || '',
          contactPhone: convertOrderTargetQuote.contactPhone || '',
          description: convertOrderTargetQuote.description || '',
          poNumber: convertOrderFormState.poNumber.trim(),
          projectName: convertOrderTargetQuote.title || '',
          acknowledgmentNumber,
          leadTime,
          shipTo,
          freightDescription: String(convertOrderTargetQuote.freightDescription ?? '').trim(),
          productGross, discountPercent, discountAmount,
          freightGross, freightDiscountAmount,
          productNet, freightNet, depositRequired, depositPercent,
          lines: [...selectedProductLines, ...selectedFreightLines],
        })
        const settings = quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS
        const termsResponse = await fetchCrmDocumentTerms(convertOrderTargetQuote.dealerSourceId)
        const documentTerms = groupOrderDocumentTerms(termsResponse.terms)
        const [confirmationBlob, workOrderBlob, proformaInvoiceBlob, bolBlob] = await Promise.all([
          buildOrderDocumentBlob(documentData, settings, documentTerms),
          buildWorkOrderDocumentBlob(documentData, settings, documentTerms),
          buildProformaInvoiceBlob(documentData, settings, documentTerms),
          buildBillOfLadingBlob(documentData, settings, documentTerms),
        ])
        const orderPath = sanitizeStoragePathSegment(acknowledgmentNumber, 'order')
        const generatedAt = Date.now()
        const confirmationRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/order-confirmation-${generatedAt}.pdf`)
        const workOrderRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/work-order-${generatedAt}.pdf`)
        const proformaInvoiceRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/proforma-invoice-${generatedAt}.pdf`)
        const bolRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/bill-of-lading-${generatedAt}.pdf`)
        await Promise.all([
          uploadBytes(confirmationRef, confirmationBlob, { contentType: 'application/pdf' }),
          uploadBytes(workOrderRef, workOrderBlob, { contentType: 'application/pdf' }),
          uploadBytes(proformaInvoiceRef, proformaInvoiceBlob, { contentType: 'application/pdf' }),
          uploadBytes(bolRef, bolBlob, { contentType: 'application/pdf' }),
        ])
        const [orderConfirmationUrl, workOrderUrl, proformaInvoiceUrl, bolUrl] = await Promise.all([
          getDownloadURL(confirmationRef),
          getDownloadURL(workOrderRef),
          getDownloadURL(proformaInvoiceRef),
          getDownloadURL(bolRef),
        ])

        await convertCrmQuoteToOrder(convertOrderTargetQuote.id, {
          acknowledgmentNumber,
          poDate,
          poNumber: convertOrderFormState.poNumber.trim() || null,
          leadTime: leadTime || null,
          shipTo,
          notes: convertOrderFormState.notes.trim() || null,
          selectedLineItemIds: convertOrderFormState.selectedLineItemIds,
          selectedAdditionalServiceIds: convertOrderFormState.selectedAdditionalServiceIds,
          selectedShippingServiceIds: convertOrderFormState.selectedShippingServiceIds,
          includeFreight: convertOrderFormState.includeFreight,
          depositRequired,
          depositPercent,
          depositRequestUrl: null,
          depositRequestName: null,
          orderConfirmationUrl,
          orderConfirmationName: `Order Confirmation - ${acknowledgmentNumber}.pdf`,
          workOrderUrl,
          workOrderName: `Work Order - ${acknowledgmentNumber}.pdf`,
          proformaInvoiceUrl,
          proformaInvoiceName: `Proforma Invoice - ${acknowledgmentNumber}.pdf`,
          bolUrl,
          bolName: `Bill of Lading - ${acknowledgmentNumber}.pdf`,
        })
      })

      await invalidateOpportunityData()
      setSuccessMessage('Opportunity converted to order and pushed to New Orders 2026 + Design AKF.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to convert opportunity to order.')
    } finally {
      setIsSubmittingConvertOrder(false)
      setBusyQuoteId(null)
    }
  }, [
    convertOrderFormState.acknowledgmentNumber,
    convertOrderFormState.depositPercent,
    convertOrderFormState.depositRequirement,
    convertOrderFormState.leadTime,
    convertOrderFormState.notes,
    convertOrderFormState.poDate,
    convertOrderFormState.poNumber,
    convertOrderFormState.shipTo,
    convertOrderFormState.selectedLineItemIds,
    convertOrderFormState.selectedAdditionalServiceIds,
    convertOrderFormState.selectedShippingServiceIds,
    convertOrderFormState.includeFreight,
    convertOrderPrimaryBoardId,
    convertOrderSecondaryBoardId,
    convertOrderTargetQuote,
    invalidateOpportunityData,
    quotePrintSettingsQuery.data?.settings,
  ])

  const handleMarkApproved = useCallback(async (quoteSummary: CrmQuote) => {
    setBusyQuoteId(quoteSummary.id)
    setLoadingOpportunityId(quoteSummary.id)
    try {
      openConvertOrderDialog(await loadOpportunityDetails(quoteSummary))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load opportunity details.')
    } finally {
      setBusyQuoteId(null)
      setLoadingOpportunityId(null)
    }
  }, [loadOpportunityDetails, openConvertOrderDialog])

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

  const handleMarkFollowedUp = useCallback(async (quote: CrmQuote) => {
    const confirmed = window.confirm(`Confirm that ${quote.quoteNumber || quote.title} was followed up? The day counter will restart from today.`)
    if (!confirmed) return

    setErrorMessage(null)
    setSuccessMessage(null)
    setBusyQuoteId(quote.id)
    try {
      const response = await markCrmQuoteFollowedUp(quote.id)
      setSelectedOpportunity((current) => current?.id === quote.id ? response.quote : current)
      await Promise.all([
        invalidateOpportunityData(),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(quote.id) }),
      ])
      setSuccessMessage('Follow-up recorded. The opportunity day counter has restarted.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to record the follow-up.')
    } finally {
      setBusyQuoteId(null)
    }
  }, [invalidateOpportunityData, queryClient])

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

  const handleSaveOpportunityDetails = useCallback(async (
    mode: OpportunityDetailsSaveMode = 'save',
    targetRevisionNumber = selectedRevisionNumber,
  ) => {
    if (!selectedOpportunity || !opportunityDetailsFormState) {
      return
    }

    const quoteNumber = opportunityDetailsFormState.quoteNumber.trim()
    const opportunityDateInput = opportunityDetailsFormState.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.freight,
      Number(selectedOpportunity.totalAmount || 0),
      opportunityDetailsFormState.additionalServices,
      opportunityDetailsFormState.shippingServices,
      opportunityDetailsFormState.discountPercent,
      opportunityDetailsFormState.discountScope,
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

    if (!opportunityDetailsFormState.dealerSourceId.trim()) {
      setErrorMessage('Dealer account is required.')
      return
    }

    if (!opportunityDetailsFormState.contactName.trim() || !opportunityDetailsFormState.contactEmail.trim()) {
      setErrorMessage('Contact name and email are required.')
      return
    }

    if (!opportunityDetailsFormState.salesRep.trim() || !opportunityDetailsFormState.leadTime.trim()) {
      setErrorMessage('Sales rep and lead time are required.')
      return
    }

    if (!isExcelSyncProjectTypeOption(opportunityDetailsFormState.projectType.trim())) {
      setErrorMessage('Select a Project Type on the Account Information tab before saving.')
      return
    }

    if (opportunityDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(opportunityDateInput)) {
      setErrorMessage('Opportunity date must be a valid date.')
      return
    }

    const quoteLabel = quoteNumber || selectedOpportunity.quoteNumber || selectedOpportunity.title

    const duplicateQuote = quotes.find((entry) => (
      entry.id !== selectedOpportunity.id
      && normalizeQuoteFamilyValue(entry.quoteNumber) === normalizeQuoteFamilyValue(quoteNumber)
    ))
    if (duplicateQuote) {
      setErrorMessage(`Quote number ${quoteNumber} already belongs to another opportunity.`)
      return
    }

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
      if (selectedAddContactSourceId) {
        await updateCrmContact(selectedAddContactSourceId, {
          name: opportunityDetailsFormState.contactName.trim(),
          primaryEmail: opportunityDetailsFormState.contactEmail.trim(),
          phone: opportunityDetailsFormState.contactPhone.trim() || null,
        })
      }
      const detailsPayload = {
        revisionNumber: targetRevisionNumber,
        ...((mode === 'save' || mode === 'save_close')
          ? { activeRevisionNumber: targetRevisionNumber }
          : {}),
        ...(selectedDealerSourceId ? { dealerSourceId: selectedDealerSourceId } : {}),
        quoteNumber: quoteNumber || null,
        title,
        companyName: opportunityDetailsFormState.companyName.trim() || null,
        contactName: opportunityDetailsFormState.contactName.trim() || null,
        contactEmail: opportunityDetailsFormState.contactEmail.trim() || null,
        contactPhone: opportunityDetailsFormState.contactPhone.trim() || null,
        contactSourceId: selectedAddContactSourceId || null,
        salesRep: opportunityDetailsFormState.salesRep.trim() || null,
        ...(opportunityDetailsFormState.projectType.trim()
          ? { projectType: opportunityDetailsFormState.projectType.trim() }
          : {}),
        leadTime: opportunityDetailsFormState.leadTime.trim() || null,
        paymentTerms: opportunityDetailsFormState.paymentTerms.trim() || null,
        subtotal: pricing.subtotal,
        discountPercent: pricing.discountPercent,
        discountAmount: pricing.discountAmount,
        discountScope: pricing.discountScope,
        discountFreightAmount: pricing.discountFreightAmount,
        totalPriceType: opportunityDetailsFormState.totalPriceType,
        freight: pricing.freight,
        freightDescription: opportunityDetailsFormState.freightDescription.trim() || null,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        additionalServices: pricing.normalizedAdditionalServices,
        shippingServices: pricing.normalizedShippingServices,
        origin: opportunityDetailsFormState.origin,
        sourceWorkbookUrl: opportunityDetailsFormState.sourceWorkbookUrl || null,
        sourceWorkbookName: opportunityDetailsFormState.sourceWorkbookName || null,
        convertedPdfUrl: opportunityDetailsFormState.convertedPdfUrl || null,
        convertedPdfName: opportunityDetailsFormState.convertedPdfName || null,
        totalAmount,
        notes: opportunityDetailsFormState.notes.trim() || null,
      }

      let savedQuote: CrmQuote | null = null
      if (mode === 'save' || mode === 'save_close') {
        const response = await updateCrmQuote(selectedOpportunity.id, detailsPayload)
        savedQuote = response.quote
        setSuccessMessage('Opportunity updated.')
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
      if (mode === 'save') {
        if (savedQuote) {
          const savedRevisionQuote = resolveQuoteRevision(savedQuote, targetRevisionNumber)
          const savedFormState = createOpportunityDetailsFormState(savedRevisionQuote)
          setSelectedOpportunity(savedQuote)
          setSelectedRevisionNumber(targetRevisionNumber)
          setOpportunityDetailsFormState(savedFormState)
          setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(savedFormState))
          setSuccessMessage(`Opportunity saved with Revision ${targetRevisionNumber} as the current version.`)
        } else {
          setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(opportunityDetailsFormState))
        }
      } else {
        setSelectedOpportunity(null)
        setOpportunityDetailsFormState(null)
        setOpportunityDetailsInitialSnapshot('')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update opportunity.')
    } finally {
      setIsSavingOpportunityDetails(false)
      setBusyQuoteId(null)
    }
  }, [
    invalidateOpportunityData,
    opportunityDetailsFormState,
    quotes,
    selectedOpportunity,
    selectedAddContactSourceId,
    selectedRevisionNumber,
  ])

  const handleRequestSaveOpportunityDetails = useCallback((mode: OpportunitySavePreference) => {
    if (!selectedOpportunity) {
      return
    }

    const revisions = selectedOpportunity.revisions || []
    if (revisions.length > 1 && selectedRevisionNumber !== activeRevisionNumber) {
      setSaveTargetRevisionNumber(selectedRevisionNumber)
      setPendingRevisionSave({ mode })
      return
    }

    void handleSaveOpportunityDetails(mode, selectedRevisionNumber)
  }, [
    activeRevisionNumber,
    handleSaveOpportunityDetails,
    selectedOpportunity,
    selectedRevisionNumber,
  ])

  const convertOrderQuoteLabel = String(
    convertOrderTargetQuote?.quoteNumber
      || convertOrderTargetQuote?.title
      || convertOrderTargetQuote?.id
      || '',
  ).trim()

  const convertOrderSelectableRows = useMemo(() => {
    if (!convertOrderTargetQuote) return []
    const converted = new Set(convertOrderTargetQuote.convertedItemKeys || [])
    const pricedShippingServices = (convertOrderTargetQuote.shippingServices || [])
      .filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0)
    return [
      ...(convertOrderTargetQuote.lineItems || []).filter((item) => Number(item.qty ?? 1) !== 0).map((item) => { const id = String(item.id || item.itemNumber || ''); return { key: `line:${id}`, id, group: 'Product', description: item.description || `Item ${item.itemNumber}`, qty: item.qty, unitPrice: item.unitPrice, amount: Number(item.extPrice || 0), field: 'selectedLineItemIds' as const, converted: converted.has(`line:${id}`) } }),
      ...(convertOrderTargetQuote.additionalServices || []).filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0).map((item) => ({ key: `additional:${item.id}`, id: item.id, group: 'Additional Service', description: item.title || item.description || 'Additional service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, amount: Number(resolveServiceItemExtPrice(item) || 0), field: 'selectedAdditionalServiceIds' as const, converted: converted.has(`additional:${item.id}`) })),
      ...pricedShippingServices.map((item) => ({ key: `shipping:${item.id}`, id: item.id, group: 'Freight / Delivery', description: item.title || item.description || 'Freight service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, amount: Number(resolveServiceItemExtPrice(item) || 0), field: 'selectedShippingServiceIds' as const, converted: converted.has(`shipping:${item.id}`) })),
      ...(pricedShippingServices.length === 0 && Number(convertOrderTargetQuote.freight || 0) > 0 ? [{ key: 'freight', id: 'freight', group: 'Delivery', description: 'Delivery', qty: 1, unitPrice: Number(convertOrderTargetQuote.freight), amount: Number(convertOrderTargetQuote.freight), field: 'includeFreight' as const, converted: converted.has('freight') }] : []),
    ]
  }, [convertOrderTargetQuote])

  const convertOrderAvailableRows = convertOrderSelectableRows.filter((row) => !row.converted)
  const isConvertOrderRowSelected = (row: typeof convertOrderSelectableRows[number]) => row.field === 'includeFreight'
    ? convertOrderFormState.includeFreight
    : convertOrderFormState[row.field].includes(row.id)
  const convertOrderSelectedRows = convertOrderAvailableRows.filter(isConvertOrderRowSelected)
  const convertOrderProductNet = convertOrderSelectedRows.filter((row) => row.group === 'Product' || row.group === 'Additional Service').reduce((sum, row) => sum + row.amount, 0)
  const convertOrderFreightNet = convertOrderSelectedRows.filter((row) => row.group === 'Delivery' || row.group === 'Freight / Delivery').reduce((sum, row) => sum + row.amount, 0)

  if (isLoading && !detailsOnly) {
    return <LoadingPanel loading message="Fetching pipeline opportunities..." />
  }

  return (
    // Centred rather than edge to edge. The invoice list this page is modelled
    // on leaves air on both sides, and that margin is most of why it reads as
    // calm — a table stretched across a wide monitor does not.
    <Stack spacing={1.75} sx={{ width: '100%', maxWidth: 1200, mx: 'auto' }}>
      <StatusAlerts
        errorMessage={isDialogOpen || selectedOpportunity ? null : (errorMessage || (queryError instanceof Error ? queryError.message : null))}
        successMessage={successMessage}
      />

      <Dialog open={Boolean(loadingOpportunityId)} maxWidth="xs" fullWidth>
        <DialogContent>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={28} />
            <Box>
              <Typography fontWeight={800}>Loading opportunity details</Typography>
              <Typography variant="body2" color="text.secondary">Opening the selected quote…</Typography>
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingRevisionSave)}
        onClose={() => {
          if (!isSavingOpportunityDetails) {
            setPendingRevisionSave(null)
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Choose the saved quote version</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              You are editing Revision {selectedRevisionNumber}, while Revision {activeRevisionNumber} is currently shown
              on the opportunity. Select which revision should receive these changes and become the current version.
            </Typography>
            <TextField
              select
              autoFocus
              fullWidth
              label="Save changes on"
              value={saveTargetRevisionNumber}
              onChange={(event) => setSaveTargetRevisionNumber(Number(event.target.value))}
            >
              {(selectedOpportunity?.revisions || []).map((revision) => {
                const revisionNumber = Number(revision.revisionNumber)
                const labels = [
                  revisionNumber === selectedRevisionNumber ? 'currently open' : '',
                  revisionNumber === activeRevisionNumber ? 'currently active' : '',
                ].filter(Boolean)

                return (
                  <MenuItem key={revision.id} value={revisionNumber}>
                    R{revisionNumber}{labels.length > 0 ? ` — ${labels.join(', ')}` : ''}
                  </MenuItem>
                )
              })}
            </TextField>
            <Alert severity={saveTargetRevisionNumber === selectedRevisionNumber ? 'info' : 'warning'}>
              {saveTargetRevisionNumber === selectedRevisionNumber
                ? `R${saveTargetRevisionNumber} will become the version shown on the opportunity card and used by Print.`
                : `The details currently open from R${selectedRevisionNumber} will replace the saved details in R${saveTargetRevisionNumber}. R${saveTargetRevisionNumber} will then become the current version.`}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={isSavingOpportunityDetails}
            onClick={() => setPendingRevisionSave(null)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={isSavingOpportunityDetails}
            onClick={() => {
              const pendingSave = pendingRevisionSave
              setPendingRevisionSave(null)
              if (pendingSave) {
                void handleSaveOpportunityDetails(pendingSave.mode, saveTargetRevisionNumber)
              }
            }}
          >
            {pendingRevisionSave?.mode === 'save_close'
              ? `Save R${saveTargetRevisionNumber} and Close`
              : `Save on R${saveTargetRevisionNumber}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isConvertOrderDialogOpen}
        onClose={handleCloseConvertOrderDialog}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { minHeight: { md: '86vh' }, maxHeight: '94vh' } }}
      >
        <DialogTitle>Convert To Order</DialogTitle>
        <DialogContent>
          <Stack spacing={1.35} sx={{ mt: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              This will push to both Monday boards and create a linked CRM order from quote{' '}
              <strong>{convertOrderQuoteLabel || 'N/A'}</strong>. The order number sent to Monday will use the
              acknowledgement number below.
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
              label="Acknowledgement Number"
              value={convertOrderFormState.acknowledgmentNumber}
              onChange={(event) => {
                updateConvertOrderField('acknowledgmentNumber', event.target.value)
              }}
              helperText="Defaults to the next YYMMNN acknowledgement number. You can change it before converting."
              disabled={isSubmittingConvertOrder}
            />

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

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField
                required
                select
                fullWidth
                label="Is a deposit required?"
                value={convertOrderFormState.depositRequirement}
                onChange={(event) => {
                  const requirement = event.target.value as OpportunityConvertOrderFormState['depositRequirement']
                  setConvertOrderFormState((current) => ({
                    ...current,
                    depositRequirement: requirement,
                    depositPercent: requirement === 'required' ? (current.depositPercent || '50') : '',
                  }))
                }}
                helperText="Required for every order."
                disabled={isSubmittingConvertOrder}
              >
                <MenuItem value="" disabled>Select an option</MenuItem>
                <MenuItem value="required">Yes - deposit required</MenuItem>
                <MenuItem value="not_required">No deposit required</MenuItem>
              </TextField>

              {convertOrderFormState.depositRequirement === 'required' ? (
                <TextField
                  required
                  fullWidth
                  type="number"
                  label="Deposit Percentage"
                  value={convertOrderFormState.depositPercent}
                  onChange={(event) => updateConvertOrderField('depositPercent', event.target.value)}
                  inputProps={{ min: 1, max: 100, step: 1 }}
                  helperText="Defaults to 50%; change it for this order if needed."
                  disabled={isSubmittingConvertOrder}
                />
              ) : null}
            </Stack>

            <TextField
              fullWidth
              label="Lead Time"
              value={convertOrderFormState.leadTime}
              onChange={(event) => {
                updateConvertOrderField('leadTime', event.target.value)
              }}
              helperText="Copied from the quote; for example, 12–14 weeks after shop drawing approval + transit time."
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

            <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={1} sx={{ px: 1.5, py: 1.1, bgcolor: '#eef4f8' }}>
                <Box>
                  <Typography fontWeight={800}>Select Quote Lines</Typography>
                  <Typography variant="caption" color="text.secondary">Only priced additional services are shown. Previously converted lines remain locked.</Typography>
                </Box>
                <FormControlLabel
                  control={<Checkbox checked={convertOrderAvailableRows.length > 0 && convertOrderSelectedRows.length === convertOrderAvailableRows.length} indeterminate={convertOrderSelectedRows.length > 0 && convertOrderSelectedRows.length < convertOrderAvailableRows.length} onChange={(event) => {
                    const checked = event.target.checked
                    setConvertOrderFormState((current) => ({ ...current,
                      selectedLineItemIds: checked ? convertOrderAvailableRows.filter((row) => row.field === 'selectedLineItemIds').map((row) => row.id) : [],
                      selectedAdditionalServiceIds: checked ? convertOrderAvailableRows.filter((row) => row.field === 'selectedAdditionalServiceIds').map((row) => row.id) : [],
                      selectedShippingServiceIds: checked ? convertOrderAvailableRows.filter((row) => row.field === 'selectedShippingServiceIds').map((row) => row.id) : [],
                      includeFreight: checked && convertOrderAvailableRows.some((row) => row.field === 'includeFreight'),
                    }))
                  }} />}
                  label="Select all available"
                />
              </Stack>
              <Table size="small">
                <TableHead><TableRow><TableCell padding="checkbox" /><TableCell>Type</TableCell><TableCell>Description</TableCell><TableCell align="right">Qty</TableCell><TableCell align="right">Unit Price</TableCell><TableCell align="right">Extended</TableCell></TableRow></TableHead>
                <TableBody>{convertOrderSelectableRows.map((row) => <TableRow key={row.key} sx={{ opacity: row.converted ? 0.5 : 1 }}>
                  <TableCell padding="checkbox"><Checkbox disabled={row.converted || isSubmittingConvertOrder} checked={!row.converted && isConvertOrderRowSelected(row)} onChange={(event) => setConvertOrderFormState((current) => {
                    if (row.field === 'includeFreight') return { ...current, includeFreight: event.target.checked }
                    const values = current[row.field]
                    return { ...current, [row.field]: event.target.checked ? [...new Set([...values, row.id])] : values.filter((id) => id !== row.id) }
                  })} /></TableCell>
                  <TableCell>{row.converted ? `${row.group} — already converted` : row.group}</TableCell><TableCell>{row.description}</TableCell><TableCell align="right">{row.qty ?? '—'}</TableCell><TableCell align="right">{row.unitPrice == null ? '—' : formatCurrency(row.unitPrice, 2)}</TableCell><TableCell align="right">{formatCurrency(row.amount, 2)}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
              <Stack direction="row" justifyContent="flex-end" spacing={2.5} sx={{ p: 1.5, bgcolor: '#f8fafc' }}>
                <Typography>Product Net: <strong>{formatCurrency(convertOrderProductNet, 2)}</strong></Typography>
                <Typography>Freight Net: <strong>{formatCurrency(convertOrderFreightNet, 2)}</strong></Typography>
                <Typography color="primary">Grand Total: <strong>{formatCurrency(convertOrderProductNet + convertOrderFreightNet, 2)}</strong></Typography>
                <Typography color={convertOrderFormState.depositRequirement === 'required' ? 'error' : 'text.secondary'}>
                  {convertOrderFormState.depositRequirement === 'required'
                    ? `${convertOrderFormState.depositPercent || '—'}% deposit required`
                    : convertOrderFormState.depositRequirement === 'not_required'
                      ? 'No deposit required'
                      : 'Deposit selection required'}
                </Typography>
              </Stack>
            </Paper>

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
              || !convertOrderFormState.acknowledgmentNumber.trim()
              || !convertOrderFormState.poDate.trim()
              || !convertOrderFormState.shipTo.trim()
              || !convertOrderFormState.depositRequirement
              || (convertOrderFormState.depositRequirement === 'required' && (
                !Number.isFinite(Number(convertOrderFormState.depositPercent))
                || Number(convertOrderFormState.depositPercent) <= 0
                || Number(convertOrderFormState.depositPercent) > 100
              ))
              || convertOrderSelectedRows.length === 0
            }
          >
            {isSubmittingConvertOrder ? 'Converting...' : 'Convert To Order'}
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
            {excelSyncSourceFileName ? (
              <Typography variant="caption" color="text.secondary">
                File: {excelSyncSourceFileName}
              </Typography>
            ) : null}

            {excelSyncImportSummary ? (
              <Alert severity="info" sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {excelSyncImportSummary.sheetName}
                </Typography>
                <Typography variant="caption" component="div">
                  {excelSyncImportSummary.mainLineCount} main lines, {excelSyncImportSummary.pairedSublineCount} two-column sublines, and {excelSyncImportSummary.singleColumnSublineCount} single-column sublines detected.
                </Typography>
                {excelSyncImportSummary.embeddedImageCount > 0 ? (
                  <Typography variant="caption" component="div">
                    {excelSyncImportSummary.matchedImageCount} embedded line {excelSyncImportSummary.matchedImageCount === 1 ? 'image' : 'images'} will be uploaded with this quote.
                  </Typography>
                ) : null}
              </Alert>
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
      <input
        hidden
        ref={pipelineUploadExcelInputRef}
        type="file"
        accept=".xls,.xlsx,.xlsm,.ods,.csv"
        onChange={handleExcelQuoteSyncUpload}
      />

      <StageColumn
        key={activePipelineStage}
        stage={activePipelineStageDefinition}
        rows={stageBuckets[activePipelineStage]}
        dealersBySourceId={dealersBySourceId}
        canManage={canManage}
        busyQuoteId={busyQuoteId}
        onMarkApproved={handleMarkApproved}
        onMarkFollowedUp={handleMarkFollowedUp}
        onDeclineQuote={handleDeclineQuote}
        onDeleteQuote={handleDeleteQuote}
        onPrintQuote={(quote) => void handlePrintQuote(quote)}
        onOpenDetails={handleOpenOpportunityDetails}
        onOpenChat={setChatQuote}
        globalSearch={globalSearch}
        onGlobalSearchChange={setGlobalSearch}
        isRefreshing={isRefreshing}
        onRefresh={() => void handleRefresh()}
        onAddOpportunity={handleOpenNewQuote}
        isSyncingExcelQuote={isSyncingExcelQuote}
        onSyncExcelSheet={handleOpenUploadQuoteExcelPicker}
      />

      {quotePrintPreview ? (
        <Suspense fallback={null}>
          <QuotePdfPreviewDialog
            open
            quote={quotePrintPreview}
            settings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
            onClose={() => setQuotePrintPreview(null)}
          />
        </Suspense>
      ) : null}

      {isNewQuoteDialogOpen ? (
      <NewQuoteDialog
        open
        form={newQuoteForm}
        pricing={{
          productTotal: newQuotePricing.grossSubtotal,
          freightTotal: newQuotePricing.freight,
          discountAmount: newQuotePricing.discountAmount + newQuotePricing.discountFreightAmount,
          netTotal: newQuotePricing.totalAmount,
        }}
        dealers={excelSyncDealerOptions}
        contacts={addOpportunityContactOptions}
        isLoadingDealers={dealersQuery.isFetching}
        isLoadingContacts={addOpportunityContactsQuery.isFetching}
        selectedDealer={newQuotePickerDealer}
        salesRepOptions={excelSyncSalesRepOptions}
        projectTypeOptions={excelSyncProjectTypeOptions}
        leadTimeOptions={quoteLeadTimeOptions}
        servicePresets={newQuoteServicePresets}
        deliveryPresets={newQuoteDeliveryPresets}
        libraryEntries={newQuoteLibraryEntries}
        isLoadingLibrary={newQuoteLibraryQuery.isFetching}
        isSaving={isSavingOpportunity}
        isUploadingImage={isUploadingNewQuoteImage}
        errorMessage={errorMessage}
        renderPreview={() => (
          <Suspense fallback={<Stack alignItems="center" py={8}><CircularProgress /></Stack>}>
            <QuotePdfPictureLayoutDialog
              open
              embedded
              quote={newQuotePreviewQuote}
              settings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
              onCancel={() => {}}
              onSave={() => {}}
              hideEmbeddedActions
            />
          </Suspense>
        )}
        onPickDealer={setNewQuotePickerDealer}
        onPickContact={(contact) => setNewQuoteContactSourceId(contact.sourceId)}
        onFormChange={setNewQuoteForm}
        onAddDealer={(typedName) => {
          setNewDealerError(null)
          setNewDealerForm({
            name: typedName.trim(),
            email: '',
            phone: '',
            city: '',
            state: '',
            salesRep: newQuoteForm.salesRep.trim(),
            paymentTerms: DEFAULT_WEBSITE_PAYMENT_TERMS,
          })
          setIsNewDealerDialogOpen(true)
        }}
        onAddContact={(typedName) => {
          setNewContactError(null)
          setNewContactForm({ name: typedName.trim(), email: '', phone: '' })
          setIsNewContactDialogOpen(true)
        }}
        onAddLeadTime={(leadTime) => void handleAddQuoteLeadTime(leadTime)}
        onUseOldForm={() => {
          setIsNewQuoteDialogOpen(false)
          setNewQuotePickerDealer(null)
          handleOpenDialog()
        }}
        onPickImage={(index, file) => setNewQuoteCropTarget({ index, file })}
        onRemoveImage={handleRemoveNewQuoteImage}
        onEditImage={(lineIndex, imageId) => void handleEditNewQuoteImage(lineIndex, imageId)}
        onSaveContact={(details) => void handleSaveNewQuoteContact(details)}
        onInsertLibraryEntry={(entry) => setNewQuoteForm((current) => ({
          ...current,
          lineItems: insertQuoteLineLibraryEntry(current.lineItems, entry),
        }))}
        onSaveLibraryEntry={handleSaveNewQuoteLibraryEntry}
        onCreate={() => void handleCreateOpportunity(newQuoteForm)}
        onClose={discardNewQuoteDraft}
      />
      ) : null}

      {/* Cropping happens here rather than inside the form: the same zoom and
          crop the staged editor uses, so a picture added either way lands on
          the PDF the same. */}
      <QuoteImageCropDialog
        open={Boolean(newQuoteCropTarget)}
        file={newQuoteCropTarget?.file || null}
        initialShape={newQuoteCropTarget?.shape}
        initialDisplaySize={newQuoteCropTarget?.displaySize}
        onCancel={() => setNewQuoteCropTarget(null)}
        onComplete={async (image) => {
          if (!newQuoteCropTarget) {
            return
          }

          const { index, imageId } = newQuoteCropTarget
          setNewQuoteCropTarget(null)
          await handleAddNewQuoteImage(index, image, imageId)
        }}
      />

      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: { width: 'min(1440px, 97vw)', height: 'min(920px, 95vh)', borderRadius: 2.5 } }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5, pt: 2 }}>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>Add Opportunity</Typography>
          {/* A stepper rather than tabs: it shows how far through you are and
              which stages are already complete, instead of shouting the same
              red warning next to every unfinished one. */}
          <Stepper
            nonLinear
            activeStep={addOpportunityStage}
            sx={{
              '& .MuiStepConnector-line': { borderColor: 'divider' },
              // Chat is not a step in building the quote — it sits beside the
              // flow, so no connector runs into it. Connectors are siblings of
              // the Steps, not children, so the last one is the second-to-last
              // child rather than anything inside the Chat step.
              '& > .MuiStepConnector-root:nth-last-child(2) .MuiStepConnector-line': {
                borderColor: 'transparent',
              },
            }}
          >
            {ADD_OPPORTUNITY_STAGES.map((stageLabel, index) => {
              const missingCount = addOpportunityMissingByStage[index]?.length ?? 0
              const isComplete = missingCount === 0
              const showMissing = addOpportunitySubmitAttempted && !isComplete

              return (
                <Step key={stageLabel} completed={isComplete && index !== addOpportunityStage}>
                  <StepButton
                    onClick={() => setAddOpportunityStage(index as AddOpportunityStage)}
                    optional={showMissing ? (
                      <Typography variant="caption" color="error">
                        {`${missingCount} missing`}
                      </Typography>
                    ) : undefined}
                  >
                    <Typography variant="body2" fontWeight={index === addOpportunityStage ? 800 : 500}>
                      {stageLabel}
                    </Typography>
                  </StepButton>
                </Step>
              )
            })}
          </Stepper>
        </DialogTitle>

        <DialogContent sx={{ bgcolor: '#f5f8fc', px: { xs: 1.5, md: 2.5 }, py: 2 }}>
          {addOpportunityStage === 0 ? (
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Stack spacing={1.5}>
                <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                  Dealer
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    label={<QuoteFieldLabel label="Quote Number" value={formState.quoteNumber} />}
                    required
                    autoFocus
                    value={formState.quoteNumber}
                    onChange={(event) => setFormState((current) => ({ ...current, quoteNumber: event.target.value }))}
                    helperText={isAddDialogDraftFromExcelSync ? 'This synced quote will be added to Opportunities.' : 'Required and must be unique.'}
                    sx={{ flex: 0.7 }}
                  />
                  <Autocomplete
                    sx={{ flex: 1.3 }}
                    options={excelSyncDealerOptions}
                    value={dealersBySourceId.get(formState.dealerSourceId) ?? null}
                    inputValue={dealerSearchInput}
                    onInputChange={(_event, inputValue, reason) => {
                      setDealerSearchInput(inputValue)
                      if (reason === 'input' && formState.dealerSourceId) {
                        setSelectedAddContactSourceId('')
                        setFormState((current) => ({
                          ...current,
                          dealerSourceId: '',
                          companyName: '',
                          contactName: '',
                          contactEmail: '',
                          contactPhone: '',
                        }))
                      }
                    }}
                    onChange={(_event, value) => {
                      setDealerSearchInput(value ? resolveDealerSelectionLabel(value) : '')
                      setSelectedAddContactSourceId('')
                      setFormState((current) => ({
                        ...current,
                        dealerSourceId: value?.sourceId || '',
                        companyName: value ? resolveDealerQuoteCompanyName(value) : '',
                        salesRep: value ? (resolveMatchingOption(value.salesRep, excelSyncSalesRepOptions) || value.salesRep || current.salesRep || 'House') : current.salesRep,
                        paymentTerms: value?.paymentTerms || DEFAULT_WEBSITE_PAYMENT_TERMS,
                        contactName: '',
                        contactEmail: '',
                        contactPhone: '',
                      }))
                    }}
                    isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                    getOptionLabel={(option) => resolveDealerSelectionLabel(option)}
                    noOptionsText="No matching dealer accounts."
                    PaperComponent={(paperProps) => (
                      <Paper {...paperProps}>
                        {paperProps.children}
                        <Box sx={{ p: 0.8, borderTop: 1, borderColor: 'divider', bgcolor: '#f8fafc' }}>
                        <Button
                          fullWidth
                          size="small"
                          variant="outlined"
                          startIcon={<AddRoundedIcon fontSize="small" />}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={handleOpenNewDealerDialog}
                        >
                          Add new{dealerSearchInput.trim() ? `: ${dealerSearchInput.trim()}` : ' dealer'}
                        </Button>
                        </Box>
                      </Paper>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        required
                        label={<QuoteFieldLabel label="Dealer Account" value={formState.dealerSourceId} />}
                        helperText="Select a saved dealer, or use Add New when there is no match."
                      />
                    )}
                  />
                </Stack>

                <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                  {'Project'}
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    required
                    label={<QuoteFieldLabel label="Project Name" value={formState.title} />}
                    value={formState.title}
                    onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
                    sx={{ flex: 1.4 }}
                  />
                  <TextField
                    select
                    required
                    label={<QuoteFieldLabel label="Sales Rep" value={formState.salesRep} />}
                    value={formState.salesRep}
                    onChange={(event) => setFormState((current) => ({ ...current, salesRep: event.target.value }))}
                    sx={{ flex: 1 }}
                  >
                    {excelSyncSalesRepOptions.map((salesRep) => <MenuItem key={salesRep} value={salesRep}>{salesRep}</MenuItem>)}
                  </TextField>
                  <TextField
                    required
                    label={<QuoteFieldLabel label="Quote Date" value={formState.opportunityDateInput} />}
                    type="date"
                    value={formState.opportunityDateInput}
                    onChange={(event) => setFormState((current) => ({ ...current, opportunityDateInput: event.target.value }))}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 0.8 }}
                  />
                </Stack>

                <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                  {'Contact'}
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <Autocomplete
                    options={addOpportunityContactOptions}
                    value={selectedAddOpportunityContact}
                    inputValue={formState.contactName}
                    disabled={!formState.dealerSourceId}
                    loading={addOpportunityContactsQuery.isFetching}
                    onChange={(_event, contact) => {
                      setSelectedAddContactSourceId(contact?.sourceId || '')
                      setFormState((current) => ({
                        ...current,
                        contactName: contact ? resolveContactSelectionLabel(contact) : '',
                        contactEmail: contact?.primaryEmail || '',
                        contactPhone: contact?.phone || '',
                      }))
                    }}
                    onInputChange={(_event, inputValue, reason) => {
                      if (reason !== 'input') return
                      const selectedLabel = selectedAddOpportunityContact
                        ? resolveContactSelectionLabel(selectedAddOpportunityContact)
                        : ''
                      const normalizedInput = inputValue.trim().replace(/\s+/g, ' ')
                      const normalizedSelectedLabel = selectedLabel.trim().replace(/\s+/g, ' ')

                      if (selectedAddContactSourceId && normalizedInput === normalizedSelectedLabel) {
                        setFormState((current) => ({ ...current, contactName: inputValue }))
                        return
                      }

                      setSelectedAddContactSourceId('')
                      setFormState((current) => ({ ...current, contactName: inputValue }))
                    }}
                    isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                    getOptionLabel={(contact) => resolveContactSelectionLabel(contact)}
                    noOptionsText="No matching contacts."
                    PaperComponent={(paperProps) => (
                      <Paper {...paperProps}>
                        {paperProps.children}
                        <Box sx={{ p: 0.8, borderTop: 1, borderColor: 'divider', bgcolor: '#f8fafc' }}>
                        <Button
                          fullWidth
                          size="small"
                          variant="outlined"
                          startIcon={<AddRoundedIcon fontSize="small" />}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={handleOpenNewContactDialog}
                        >
                          Add new{formState.contactName.trim() ? `: ${formState.contactName.trim()}` : ' contact'}
                        </Button>
                        </Box>
                      </Paper>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        required
                        label={<QuoteFieldLabel label="Contact Name" value={formState.contactName} />}
                        helperText={!formState.dealerSourceId ? 'Select a dealer first.' : 'Select a saved contact, or use Add New.'}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {addOpportunityContactsQuery.isFetching ? <CircularProgress color="inherit" size={18} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    sx={{ flex: 1.2 }}
                  />
                  <TextField
                    required
                    type="email"
                    label={<QuoteFieldLabel label="Contact Email" value={formState.contactEmail} />}
                    value={formState.contactEmail}
                    onChange={(event) => setFormState((current) => ({ ...current, contactEmail: event.target.value }))}
                    helperText="Required on every quote."
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    type="tel"
                    label={<QuoteFieldLabel label="Contact Phone" value={formState.contactPhone} />}
                    value={formState.contactPhone}
                    onChange={(event) => setFormState((current) => ({ ...current, contactPhone: event.target.value }))}
                    sx={{ flex: 0.8 }}
                  />
                </Stack>

                <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                  Terms
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    required
                    label={<QuoteFieldLabel label="Lead Time" value={formState.leadTime} />}
                    value={formState.leadTime}
                    onChange={(event) => setFormState((current) => ({ ...current, leadTime: event.target.value }))}
                    sx={{ flex: 0.7 }}
                  />
                  <Autocomplete
                    options={excelSyncProjectTypeOptions}
                    value={isExcelSyncProjectTypeOption(formState.projectType) ? formState.projectType : null}
                    onChange={(_event, value) => setFormState((current) => ({ ...current, projectType: value || '' }))}
                    sx={{ flex: 0.9 }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        required
                        label={<QuoteFieldLabel label="Project Type" filled={isExcelSyncProjectTypeOption(formState.projectType)} />}
                        error={addOpportunitySubmitAttempted && !isExcelSyncProjectTypeOption(formState.projectType)}
                        helperText="Same list the Excel sync uses."
                      />
                    )}
                  />
                  <Paper variant="outlined" sx={{ p: 1.2, flex: 1.3, borderRadius: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="caption" color="text.secondary" fontWeight={800}>PAYMENT TERMS</Typography>
                          <Tooltip title="This is the payment terms for this dealer. You can change it.">
                            <InfoOutlinedIcon color="action" sx={{ fontSize: 17 }} />
                          </Tooltip>
                        </Stack>
                        <Typography variant="body1" fontWeight={700}>{formState.paymentTerms || 'Not set'}</Typography>
                        <Typography variant="caption" color="text.secondary">These are the payment terms for this dealer.</Typography>
                      </Box>
                      <Button
                        size="small"
                        onClick={() => {
                          setPaymentTermsDraft(formState.paymentTerms)
                          setPaymentTermsApplyMode('quote')
                          setIsPaymentTermsDialogOpen(true)
                        }}
                      >
                        Change
                      </Button>
                    </Stack>
                  </Paper>
                </Stack>
              </Stack>
            </Paper>
          ) : null}

          {addOpportunityStage === 1 ? (
            <Stack spacing={1.5}>
              <LineItemsEditor
                lineItems={formState.lineItems}
                pdfSettings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                canEdit
                onAddLineItem={handleAddFormLineItem}
                onAddSubline={handleAddFormSubline}
                onUpdateLineItem={handleUpdateFormLineItem}
                onRemoveLineItem={handleRemoveFormLineItem}
                onMoveLineItem={handleMoveFormLineItem}
                onDuplicateLineItem={handleDuplicateFormLineItem}
                onCopyDetailToSubline={handleCopyFormDetailToSubline}
                onAddImages={handleAddFormLineImages}
                onRemoveImage={handleRemoveFormLineImage}
                onInsertLibraryEntry={handleInsertFormLibraryEntry}
                isUploadingImage={isUploadingLineImage}
              />
              <QuoteTotalsBar
                productTotal={addPricingPreview.grossSubtotal}
                freightTotal={addPricingPreview.freight}
                netTotal={formState.totalPriceType === 'list'
                  ? addPricingPreview.listPriceTotal
                  : addPricingPreview.totalAmount}
                totalLabel={formState.totalPriceType === 'list' ? 'List Price Total' : 'Net Price Total'}
                discountPercent={formState.discountPercent}
                discountScope={formState.discountScope}
                canEdit
                onDiscountPercentChange={(value) => setFormState((current) => ({ ...current, discountPercent: value }))}
                onDiscountScopeChange={(value) => setFormState((current) => ({ ...current, discountScope: value }))}
              />
              <TextField
                select
                label="Total shown on quote"
                value={formState.totalPriceType}
                onChange={(event) => setFormState((current) => ({ ...current, totalPriceType: event.target.value as CrmQuoteTotalPriceType }))}
                helperText="Choose the total shown at the bottom of the estimate."
                sx={{ alignSelf: 'flex-end', minWidth: 220 }}
              >
                <MenuItem value="list">List price total</MenuItem>
                <MenuItem value="net">Net price total</MenuItem>
              </TextField>
            </Stack>
          ) : null}

          {addOpportunityStage === 2 ? (
            <Stack spacing={1.5}>
              <TextField
                label="Freight Description"
                value={formState.freightDescription}
                onChange={(event) => setFormState((current) => ({ ...current, freightDescription: event.target.value }))}
                placeholder="Dock delivery, destination, or freight notes"
              />
              <QuoteServiceCardSelector
                heading="Additional Services"
                description="Select a service card to review its details and enter the quantity and unit price."
                items={formState.additionalServices}
                canEdit={!isSavingOpportunity}
                onChange={(additionalServices) => setFormState((current) => ({ ...current, additionalServices }))}
                addButtonLabel="Add a custom service"
                itemLabel="service"
              />
              <QuoteServiceCardSelector
                heading="Freight, Delivery & Installation"
                description="Select one of the three delivery options to review its details, quantity, and unit price."
                items={formState.shippingServices}
                canEdit={!isSavingOpportunity}
                onChange={(shippingServices) => setFormState((current) => ({ ...current, shippingServices }))}
                addButtonLabel="Add another delivery option"
                itemLabel="delivery option"
              />
              <TextField
                label="Notes"
                value={formState.notes}
                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                multiline
                minRows={3}
                placeholder="Optional notes"
              />
            </Stack>
          ) : null}

          {addOpportunityStage === 4 ? (
            <Stack spacing={1.25}>
              <Alert severity="info">
                Optional. Anything written here is posted as the first chat message once the quote is
                created, and the thread stays on the quote afterwards.
              </Alert>
              <TextField
                label="First chat message"
                value={addOpportunityChatNote}
                onChange={(event) => setAddOpportunityChatNote(event.target.value)}
                multiline
                minRows={4}
                placeholder="Anything the team should know about this quote…"
              />
            </Stack>
          ) : null}

          {addOpportunityStage === 3 ? (
            <Stack spacing={0.75}>
              {addOpportunitySubmitAttempted && addOpportunityTotalMissing > 0 ? (
                <Alert severity="error">
                  {addOpportunityTotalMissing} required {addOpportunityTotalMissing === 1 ? 'field is' : 'fields are'} missing. Open the red stage tabs to finish them.
                </Alert>
              ) : null}
              <Paper variant="outlined" sx={{ px: 1.25, py: 0.65, borderRadius: 1 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} spacing={{ xs: 0.25, md: 1.5 }} flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={800}>{formState.title || 'Untitled quote'}</Typography>
                  <Typography variant="caption" color="text.secondary">{formState.quoteNumber || 'No quote number'} • {formState.companyName || 'No dealer selected'}</Typography>
                  <Typography variant="caption" color="text.secondary">{normalizeLineItemsForPayload(formState.lineItems).length} quote lines • Total {formatCurrency(addPricingPreview.totalAmount, 2)}</Typography>
                </Stack>
              </Paper>
              <Suspense fallback={<Stack alignItems="center" py={8}><CircularProgress /></Stack>}>
                <QuotePdfPictureLayoutDialog
                  open
                  embedded
                  quote={addOpportunityPreviewQuote}
                  settings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                  onCancel={() => {}}
                  onSave={() => {}}
                  hideEmbeddedActions
                />
              </Suspense>
            </Stack>
          ) : null}
        </DialogContent>

        {errorMessage ? (
          <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ mx: 2.5, mb: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', px: 2.5 }}>
          <Button onClick={handleCloseDialog} disabled={isSavingOpportunity}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          {addOpportunityStage > 0 ? (
            <Button onClick={() => setAddOpportunityStage((addOpportunityStage - 1) as AddOpportunityStage)}>Back</Button>
          ) : null}
          <Tooltip
            arrow
            disableHoverListener={addOpportunityCurrentStageMissing.length === 0}
            title={(
              <Stack spacing={0.4} sx={{ py: 0.25 }}>
                <Typography variant="caption" fontWeight={800}>Missing fields</Typography>
                {addOpportunityCurrentStageMissing.map((field) => <Typography key={field} variant="caption">{field}</Typography>)}
              </Stack>
            )}
          >
            <Typography variant="body2" sx={{ cursor: addOpportunityCurrentStageMissing.length ? 'help' : 'default' }} color={addOpportunityCurrentStageMissing.length ? 'warning.main' : 'text.secondary'}>
              {addOpportunityCurrentStageMissing.length
                ? `${addOpportunityCurrentStageMissing.length} ${addOpportunityCurrentStageMissing.length === 1 ? 'field' : 'fields'} missing`
                : 'All required fields complete'}
            </Typography>
          </Tooltip>
          {addOpportunityStage < LAST_REQUIRED_ADD_STAGE ? (
            <Button
              variant="contained"
              onClick={() => setAddOpportunityStage((addOpportunityStage + 1) as AddOpportunityStage)}
            >
              Go to next stage
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={isSavingOpportunity || !canManage}
              onClick={() => void handleCreateOpportunity()}
            >
              {isSavingOpportunity ? 'Submitting...' : 'Submit'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(chatQuote)}
        onClose={() => setChatQuote(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ pb: 0.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 19, color: 'primary.main' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight={850} sx={{ lineHeight: 1.2 }}>
                {chatQuote?.quoteNumber || chatQuote?.title || 'Quote'} chat
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Notes and follow-ups stay with this quote.
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {chatQuote ? <QuoteChatPanel quoteId={chatQuote.id} canPost={canManage} /> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChatQuote(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isNewDealerDialogOpen}
        onClose={() => {
          if (!isSavingNewDealer) setIsNewDealerDialogOpen(false)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Dealer Account</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.8 }}>
            <Typography variant="body2" color="text.secondary">
              Dealer name is required. The remaining account details can be completed now or later.
            </Typography>
            {newDealerError ? <Alert severity="error">{newDealerError}</Alert> : null}
            <TextField
              required
              autoFocus
              label="Dealer Name"
              value={newDealerForm.name}
              onChange={(event) => setNewDealerForm((current) => ({ ...current, name: event.target.value }))}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
              <TextField
                label="Email (optional)"
                type="email"
                value={newDealerForm.email}
                onChange={(event) => setNewDealerForm((current) => ({ ...current, email: event.target.value }))}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Phone (optional)"
                type="tel"
                value={newDealerForm.phone}
                onChange={(event) => setNewDealerForm((current) => ({ ...current, phone: event.target.value }))}
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
              <TextField
                label="City (optional)"
                value={newDealerForm.city}
                onChange={(event) => setNewDealerForm((current) => ({ ...current, city: event.target.value }))}
                sx={{ flex: 1 }}
              />
              <TextField
                label="State (optional)"
                value={newDealerForm.state}
                onChange={(event) => setNewDealerForm((current) => ({ ...current, state: event.target.value }))}
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              select
              label="Sales Rep (optional)"
              value={newDealerForm.salesRep}
              onChange={(event) => setNewDealerForm((current) => ({ ...current, salesRep: event.target.value }))}
            >
              {excelSyncSalesRepOptions.map((salesRep) => <MenuItem key={salesRep} value={salesRep}>{salesRep}</MenuItem>)}
            </TextField>
            <TextField
              label="Payment Terms (optional)"
              value={newDealerForm.paymentTerms}
              onChange={(event) => setNewDealerForm((current) => ({ ...current, paymentTerms: event.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={isSavingNewDealer} onClick={() => setIsNewDealerDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={isSavingNewDealer || !newDealerForm.name.trim()}
            onClick={() => void handleCreateDealer()}
          >
            {isSavingNewDealer ? 'Saving...' : 'Save New Dealer'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isPaymentTermsDialogOpen}
        onClose={() => {
          if (!isSavingPaymentTerms) setIsPaymentTermsDialogOpen(false)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Change Payment Terms</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.8 }}>
            <Typography variant="body2" color="text.secondary">
              Select a common payment term or type a custom one, then choose whether this is a one-time quote change or the dealer&apos;s new default.
            </Typography>
            <Autocomplete
              freeSolo
              options={[
                '50% Deposit / 50% CBD',
                'Due on receipt',
                'Net 15',
                'Net 30',
                'Net 45',
                'Net 60',
                'Credit Card',
              ]}
              inputValue={paymentTermsDraft}
              onInputChange={(_event, value) => setPaymentTermsDraft(value)}
              onChange={(_event, value) => setPaymentTermsDraft(value || '')}
              renderInput={(params) => <TextField {...params} required autoFocus label="Payment Terms" />}
            />
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={paymentTermsApplyMode}
              onChange={(_event, value: 'quote' | 'dealer' | null) => {
                if (value) setPaymentTermsApplyMode(value)
              }}
            >
              <ToggleButton value="quote" sx={{ py: 1.2 }}>
                <Stack>
                  <Typography variant="body2" fontWeight={800}>This quote only</Typography>
                  <Typography variant="caption">Use these terms one time</Typography>
                </Stack>
              </ToggleButton>
              <ToggleButton value="dealer" sx={{ py: 1.2 }}>
                <Stack>
                  <Typography variant="body2" fontWeight={800}>Change for all future quotes</Typography>
                  <Typography variant="caption">Update the dealer default</Typography>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </DialogContent>
        <DialogFeedback error={errorMessage} onDismissError={() => setErrorMessage(null)} />
        <DialogActions>
          <Button disabled={isSavingPaymentTerms} onClick={() => setIsPaymentTermsDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={isSavingPaymentTerms || !paymentTermsDraft.trim()}
            onClick={() => void handleSavePaymentTerms()}
          >
            {isSavingPaymentTerms
              ? 'Saving...'
              : paymentTermsApplyMode === 'dealer'
                ? 'Save as Dealer Default'
                : 'Use for This Quote'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isNewContactDialogOpen}
        onClose={() => {
          if (!isSavingNewContact) setIsNewContactDialogOpen(false)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Contact</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.8 }}>
            <Typography variant="body2" color="text.secondary">
              This contact will be saved under {dealersBySourceId.get(activeQuoteDealerSourceId)?.name || 'the selected dealer'} and available on future quotes.
            </Typography>
            {newContactError ? <Alert severity="error">{newContactError}</Alert> : null}
            <TextField
              required
              autoFocus
              label="Contact Name"
              value={newContactForm.name}
              onChange={(event) => setNewContactForm((current) => ({ ...current, name: event.target.value }))}
            />
            <TextField
              label="Email (optional)"
              type="email"
              value={newContactForm.email}
              onChange={(event) => setNewContactForm((current) => ({ ...current, email: event.target.value }))}
            />
            <TextField
              label="Phone (optional)"
              type="tel"
              value={newContactForm.phone}
              onChange={(event) => setNewContactForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={isSavingNewContact} onClick={() => setIsNewContactDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={isSavingNewContact || !newContactForm.name.trim()}
            onClick={() => void handleCreateDealerContact()}
          >
            {isSavingNewContact ? 'Adding...' : 'Add Contact'}
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
            position: 'relative',
            gap: 1,
            py: 1.6,
            px: 2,
            color: 'text.primary',
            bgcolor: 'grey.100',
          }}
        >
          <Stack spacing={0.15}>
            <Stack direction="row" spacing={0.85} alignItems="center">
              <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.1 }}>
                {detailsOnly ? 'Quote Details' : 'Opportunity Details'}
              </Typography>
              {selectedOpportunity ? (
                <Badge
                  badgeContent={Number(selectedOpportunity.chatMessageCount ?? 0)}
                  color="primary"
                  overlap="circular"
                  sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15, fontWeight: 800 } }}
                >
                  <IconButton
                    size="small"
                    onClick={() => setChatQuote(selectedOpportunity)}
                    title="Quote chat"
                    aria-label="Open quote chat"
                    sx={{ color: 'primary.main', bgcolor: alpha('#ffffff', 0.7), '&:hover': { bgcolor: '#ffffff' } }}
                  >
                    <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Badge>
              ) : null}
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {detailsOnly
                ? 'Review and update this saved quote.'
                : 'Update details here. Upload quote packages from the pipeline header.'}
            </Typography>
          </Stack>
          {selectedOpportunity ? (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                position: { md: 'absolute' },
                left: { md: '50%' },
                transform: { md: 'translateX(-50%)' },
              }}
            >
              <TextField
                select
                size="small"
                label="Revision"
                value={selectedRevisionNumber}
                onChange={(event) => handleSelectRevision(Number(event.target.value))}
                sx={{
                  minWidth: 132,
                  '& .MuiOutlinedInput-root': { bgcolor: alpha('#ffffff', 0.72) },
                }}
              >
                {(selectedOpportunity.revisions || []).map((revision) => (
                  <MenuItem key={revision.id} value={revision.revisionNumber}>
                    Revision {revision.revisionNumber}
                  </MenuItem>
                ))}
              </TextField>
              {isSelectedRevisionActive ? <Chip size="small" color="primary" label="Current" /> : null}
            </Stack>
          ) : null}
          <Stack direction="row" spacing={0.6} alignItems="center">
            {selectedOpportunity ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                disabled={isCreatingRevision || isSavingOpportunityDetails}
                onClick={() => void handleCreateRevision()}
                sx={{ bgcolor: alpha('#ffffff', 0.65), whiteSpace: 'nowrap' }}
              >
                {isCreatingRevision ? 'Creating…' : 'Create Revision'}
              </Button>
            ) : null}
            {selectedOpportunity && (selectedOpportunity.revisions || []).length > 1 ? (
              <Tooltip title={`Delete Revision ${selectedRevisionNumber}`}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={isDeletingRevision || isCreatingRevision || isSavingOpportunityDetails}
                    onClick={() => void handleDeleteRevision()}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 19 }} />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            {selectedOpportunityPrintQuote ? (
              <Tooltip title="Print quote">
                <IconButton
                  size="medium"
                  disabled={busyQuoteId === selectedOpportunityPrintQuote.id}
                  onClick={() => void handlePrintQuote(selectedOpportunityPrintQuote, true)}
                >
                  <PrintRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            ) : null}
            {canUseProposalDetailsActions ? (
              <IconButton
                size="medium"
                disabled={
                  isSavingOpportunityDetails
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
        <Dialog
          open={Boolean(duplicateSourceQuote)}
          onClose={() => setDuplicateSourceQuote(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Duplicate quote</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              {`Copying the lines, services and images from ${
                String(duplicateSourceQuote?.quoteNumber || 'this quote')
              }. Should the new quote keep the same account?`}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Either way you enter a new quote number — it is never copied.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            <Button onClick={() => setDuplicateSourceQuote(null)}>Cancel</Button>
            <Button variant="outlined" onClick={() => handleStartDuplicate(false)}>
              Lines only
            </Button>
            <Button variant="contained" onClick={() => handleStartDuplicate(true)}>
              Keep account
            </Button>
          </DialogActions>
        </Dialog>

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
              !selectedOpportunity
              || isSavingOpportunityDetails
            }
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              if (selectedOpportunity) void handleMarkFollowedUp(selectedOpportunity)
            }}
          >
            Mark as followed up
          </MenuItem>
          <MenuItem
            disabled={!selectedOpportunity || isSavingOpportunityDetails}
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              setDuplicateSourceQuote(selectedOpportunity)
            }}
          >
            Duplicate quote
          </MenuItem>
          <MenuItem
            disabled={
              !canUseProposalDetailsActions
              || isSavingOpportunityDetails
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
              <Tabs
                value={opportunityDetailsStage}
                onChange={(_event, value: AddOpportunityStage) => setOpportunityDetailsStage(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ bgcolor: '#fff', borderRadius: 2, px: 1, border: 1, borderColor: 'divider' }}
              >
                {ADD_OPPORTUNITY_STAGES.map((stageLabel, index) => (
                  <Tab
                    key={stageLabel}
                    value={index}
                    label={`${index + 1}. ${stageLabel}`}
                    sx={{ fontWeight: 800 }}
                  />
                ))}
              </Tabs>
              <Stack spacing={1.2} sx={{ flex: 1, minWidth: 0 }}>
              {opportunityDetailsStage === 0 ? (
                <>
              {selectedOpportunity.convertedOrderId ? (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor: 'divider',
                    bgcolor: 'grey.100',
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
                        color: 'primary.main',
                        bgcolor: 'divider',
                        flexShrink: 0,
                      }}
                    >
                      <WorkspacesRoundedIcon />
                    </Box>
                    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 800, lineHeight: 1.2 }}>
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

              {/* Same four groups, in the same order, as the Add Opportunity
                  form. The headings used to sit inside the rows, so "Project"
                  and "Terms" rendered as stray words between two fields. */}
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                    Dealer
                  </Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                    <TextField
                      label={<QuoteFieldLabel label="Quote Number" value={opportunityDetailsFormState.quoteNumber} />}
                      value={opportunityDetailsFormState.quoteNumber}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, quoteNumber: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 0.7 }}
                    />
                    <Autocomplete
                      options={excelSyncDealerOptions}
                      value={dealersBySourceId.get(opportunityDetailsFormState.dealerSourceId) ?? null}
                      onChange={(_event, value) => {
                        setSelectedAddContactSourceId('')
                        setOpportunityDetailsFormState((current) => {
                          if (!current || !value) {
                            return current
                          }

                          return {
                            ...current,
                            dealerSourceId: value.sourceId,
                            companyName: resolveDealerQuoteCompanyName(value) || current.companyName,
                            contactName: '',
                            contactEmail: '',
                            contactPhone: '',
                            salesRep: resolveMatchingOption(value.salesRep, excelSyncSalesRepOptions) || 'House',
                            paymentTerms: current.origin === 'excel'
                              ? current.paymentTerms
                              : (value.paymentTerms || DEFAULT_WEBSITE_PAYMENT_TERMS),
                          }
                        })
                      }}
                      isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                      getOptionLabel={(option) => resolveDealerSelectionLabel(option)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={<QuoteFieldLabel label="Dealer Account" value={opportunityDetailsFormState.dealerSourceId} />}
                          helperText={opportunityDetailsFormState.dealerSourceId
                            ? 'This account is linked to the quote.'
                            : 'Select an account before converting this quote to an order.'}
                        />
                      )}
                      disabled={!canManage}
                      sx={{ flex: 1.3 }}
                    />
                  </Stack>

                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                    Project
                  </Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                    <TextField
                      label={<QuoteFieldLabel label="Project Name" value={opportunityDetailsFormState.title} />}
                      value={opportunityDetailsFormState.title}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, title: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 1.4 }}
                    />
                    <TextField
                      select
                      label={<QuoteFieldLabel label="Sales Rep" value={opportunityDetailsFormState.salesRep} />}
                      value={opportunityDetailsFormState.salesRep}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, salesRep: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 1 }}
                    >
                      {[...new Set([...excelSyncSalesRepOptions, opportunityDetailsFormState.salesRep].filter(Boolean))].map((salesRep) => <MenuItem key={salesRep} value={salesRep}>{salesRep}</MenuItem>)}
                    </TextField>
                    <TextField
                      label={<QuoteFieldLabel label="Quote Date" value={opportunityDetailsFormState.opportunityDateInput} />}
                      type="date"
                      value={opportunityDetailsFormState.opportunityDateInput}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, opportunityDateInput: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      InputLabelProps={{ shrink: true }}
                      sx={{ flex: 0.8 }}
                    />
                  </Stack>

                  {opportunityDetailsFormState.origin === 'excel' ? (
                    <TextField
                      label={<QuoteFieldLabel label="Company Name (from Excel)" value={opportunityDetailsFormState.companyName} />}
                      value={opportunityDetailsFormState.companyName}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, companyName: event.target.value } : current
                      ))}
                      disabled={!canManage}
                    />
                  ) : null}

                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                    Contact
                  </Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                    <Autocomplete
                      options={addOpportunityContactOptions}
                      value={selectedAddOpportunityContact}
                      inputValue={opportunityDetailsFormState.contactName}
                      onChange={(_event, contact) => {
                        setSelectedAddContactSourceId(contact?.sourceId || '')
                        setOpportunityDetailsFormState((current) => current ? ({
                          ...current,
                          contactName: contact ? resolveContactSelectionLabel(contact) : '',
                          contactEmail: contact?.primaryEmail || '',
                          contactPhone: contact?.phone || '',
                        }) : current)
                      }}
                      onInputChange={(_event, inputValue, reason) => {
                        if (reason !== 'input') return
                        setSelectedAddContactSourceId('')
                        setOpportunityDetailsFormState((current) => current ? ({ ...current, contactName: inputValue }) : current)
                      }}
                      isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                      getOptionLabel={(contact) => resolveContactSelectionLabel(contact)}
                      PaperComponent={(paperProps) => (
                        <Paper {...paperProps}>
                          {paperProps.children}
                          <Box sx={{ p: 0.8, borderTop: 1, borderColor: 'divider' }}>
                            <Button fullWidth size="small" onMouseDown={(event) => event.preventDefault()} onClick={handleOpenNewContactDialog}>
                              Add new contact
                            </Button>
                          </Box>
                        </Paper>
                      )}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          required
                          label={<QuoteFieldLabel label="Contact Name" value={opportunityDetailsFormState.contactName} />}
                        />
                      )}
                      disabled={!canManage}
                      sx={{ flex: 1.2 }}
                    />
                    <TextField
                      type="email"
                      label={<QuoteFieldLabel label="Contact Email" value={opportunityDetailsFormState.contactEmail} />}
                      value={opportunityDetailsFormState.contactEmail}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, contactEmail: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      type="tel"
                      label={<QuoteFieldLabel label="Contact Phone" value={opportunityDetailsFormState.contactPhone} />}
                      value={opportunityDetailsFormState.contactPhone}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, contactPhone: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 0.8 }}
                    />
                  </Stack>

                  <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 0.4 }}>
                    Terms
                  </Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                    <TextField
                      label={<QuoteFieldLabel label="Lead Time" value={opportunityDetailsFormState.leadTime} />}
                      value={opportunityDetailsFormState.leadTime}
                      onChange={(event) => setOpportunityDetailsFormState((current) => (
                        current ? { ...current, leadTime: event.target.value } : current
                      ))}
                      disabled={!canManage}
                      sx={{ flex: 0.7 }}
                    />
                    <Autocomplete
                      options={excelSyncProjectTypeOptions}
                      value={isExcelSyncProjectTypeOption(opportunityDetailsFormState.projectType) ? opportunityDetailsFormState.projectType : null}
                      onChange={(_event, value) => {
                        setOpportunityDetailsFormState((current) => (
                          current ? { ...current, projectType: value || '' } : current
                        ))
                      }}
                      disabled={!canManage}
                      sx={{ flex: 0.9 }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          required
                          label={<QuoteFieldLabel label="Project Type" filled={isExcelSyncProjectTypeOption(opportunityDetailsFormState.projectType)} />}
                          helperText="Same list the Excel sync uses."
                        />
                      )}
                    />
                    <Paper variant="outlined" sx={{ p: 1.2, flex: 1.3, borderRadius: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Box>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography variant="caption" color="text.secondary" fontWeight={800}>PAYMENT TERMS</Typography>
                            <Tooltip title="This is the payment terms for this dealer. You can change it.">
                              <InfoOutlinedIcon color="action" sx={{ fontSize: 17 }} />
                            </Tooltip>
                          </Stack>
                          <Typography variant="body1" fontWeight={700}>{opportunityDetailsFormState.paymentTerms || 'Not set'}</Typography>
                          <Typography variant="caption" color="text.secondary">These are the payment terms for this dealer.</Typography>
                        </Box>
                        <Button
                          size="small"
                          disabled={!canManage}
                          onClick={() => {
                            setPaymentTermsDraft(opportunityDetailsFormState.paymentTerms)
                            setPaymentTermsApplyMode('quote')
                            setIsPaymentTermsDialogOpen(true)
                          }}
                        >
                          Change
                        </Button>
                      </Stack>
                    </Paper>
                  </Stack>
                </Stack>
              </Paper>

                </>
              ) : null}

              {opportunityDetailsStage === 1 ? (
                <>

              <LineItemsEditor
                lineItems={opportunityDetailsFormState.lineItems}
                pdfSettings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                canEdit={canManage}
                onAddLineItem={handleAddDetailsLineItem}
                onAddSubline={handleAddDetailsSubline}
                onUpdateLineItem={handleUpdateDetailsLineItem}
                onRemoveLineItem={handleRemoveDetailsLineItem}
                onMoveLineItem={handleMoveDetailsLineItem}
                onDuplicateLineItem={handleDuplicateDetailsLineItem}
                onCopyDetailToSubline={handleCopyDetailsDetailToSubline}
                onAddImages={handleAddDetailsLineImages}
                onRemoveImage={handleRemoveDetailsLineImage}
                onInsertLibraryEntry={handleInsertDetailsLibraryEntry}
                isUploadingImage={isUploadingLineImage}
              />
              {detailsPricingPreview ? (
                <QuoteTotalsBar
                  productTotal={detailsPricingPreview.grossSubtotal}
                  freightTotal={detailsPricingPreview.freight}
                  netTotal={opportunityDetailsFormState.totalPriceType === 'list'
                    ? detailsPricingPreview.listPriceTotal
                    : detailsPricingPreview.totalAmount}
                  totalLabel={opportunityDetailsFormState.totalPriceType === 'list' ? 'List Price Total' : 'Net Price Total'}
                  discountPercent={opportunityDetailsFormState.discountPercent}
                  discountScope={opportunityDetailsFormState.discountScope}
                  canEdit={canManage}
                  onDiscountPercentChange={(value) => setOpportunityDetailsFormState((current) => (
                    current ? { ...current, discountPercent: value } : current
                  ))}
                  onDiscountScopeChange={(value) => setOpportunityDetailsFormState((current) => (
                    current ? { ...current, discountScope: value } : current
                  ))}
                />
              ) : null}

              <TextField
                select
                label="Total shown on quote"
                value={opportunityDetailsFormState.totalPriceType}
                onChange={(event) => setOpportunityDetailsFormState((current) => current ? ({ ...current, totalPriceType: event.target.value as CrmQuoteTotalPriceType }) : current)}
                disabled={!canManage}
                helperText="Choose the total shown at the bottom of the estimate."
                sx={{ alignSelf: 'flex-end', minWidth: 220 }}
              >
                <MenuItem value="list">List price total</MenuItem>
                <MenuItem value="net">Net price total</MenuItem>
              </TextField>

                </>
              ) : null}

              {opportunityDetailsStage === 2 ? (
                <>
              <TextField
                label="Freight Description"
                value={opportunityDetailsFormState.freightDescription}
                onChange={(event) => {
                  setOpportunityDetailsFormState((current) => current ? ({
                    ...current,
                    freightDescription: event.target.value,
                  }) : current)
                }}
                disabled={!canManage}
                placeholder="Dock delivery, destination, or freight notes"
              />
              <QuoteServiceCardSelector
                heading="Additional Services"
                description="Standard rates are pre-filled. Adjust quantity or unit price only when the project requires it."
                items={opportunityDetailsFormState.additionalServices}
                canEdit={canManage}
                onChange={(additionalServices) => setOpportunityDetailsFormState((current) => current ? ({ ...current, additionalServices }) : current)}
                addButtonLabel="Add another service"
                itemLabel="service"
              />

              <QuoteServiceCardSelector
                heading="Freight, Delivery & Installation"
                description="Select one of the delivery options to review its details, quantity, and unit price."
                items={opportunityDetailsFormState.shippingServices}
                canEdit={canManage}
                onChange={(shippingServices) => setOpportunityDetailsFormState((current) => current ? ({ ...current, shippingServices }) : current)}
                addButtonLabel="Add another delivery option"
                itemLabel="delivery option"
              />

              <TextField
                label="Notes"
                value={opportunityDetailsFormState.notes}
                onChange={(event) => setOpportunityDetailsFormState((current) => current ? ({ ...current, notes: event.target.value }) : current)}
                disabled={!canManage}
                multiline
                minRows={3}
              />
                </>
              ) : null}

              {opportunityDetailsStage === 3 && selectedOpportunityPrintQuote ? (
                <Suspense fallback={<Stack alignItems="center" py={8}><CircularProgress /></Stack>}>
                  <QuotePdfPictureLayoutDialog
                    open
                    embedded
                    quote={selectedOpportunityPrintQuote}
                    settings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                    onCancel={() => {}}
                    onSave={() => {}}
                    hideEmbeddedActions
                  />
                </Suspense>
              ) : null}

              {opportunityDetailsStage === 4 ? (
                <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, borderRadius: 2, bgcolor: '#fff' }}>
                  <Stack spacing={0.2} sx={{ mb: 1.25 }}>
                    <Typography variant="subtitle1" fontWeight={850}>Quote chat</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Notes and follow-ups for {selectedOpportunity.quoteNumber || selectedOpportunity.title || 'this quote'}.
                    </Typography>
                  </Stack>
                  <QuoteChatPanel quoteId={selectedOpportunity.id} canPost={canManage} />
                </Paper>
              ) : null}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>

        {errorMessage ? (
          <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ mx: 2, mb: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}

        <DialogActions>
          <Button
            onClick={handleCloseOpportunityDetails}
            disabled={
              isSavingOpportunityDetails
            }
          >
            Close Without Saving
          </Button>
          <Box sx={{ flex: 1 }} />
          {opportunityDetailsStage > 0 ? (
            <Button onClick={() => setOpportunityDetailsStage((opportunityDetailsStage - 1) as AddOpportunityStage)}>
              Back
            </Button>
          ) : null}
          {opportunityDetailsStage < LAST_REQUIRED_ADD_STAGE ? (
            <Button
              variant="contained"
              onClick={() => setOpportunityDetailsStage((opportunityDetailsStage + 1) as AddOpportunityStage)}
            >
              Go to next stage
            </Button>
          ) : (
            <ButtonGroup
            variant="contained"
            disabled={
              !canManage
              || isSavingOpportunityDetails
              || !opportunityDetailsFormState
            }
          >
            <Button onClick={() => handleRequestSaveOpportunityDetails(preferredSaveAction)}>
              {isSavingOpportunityDetails ? 'Saving...' : preferredSaveAction === 'save_close' ? 'Save and Close' : 'Save'}
            </Button>
            <Button
              size="small"
              aria-label="Choose save action"
              aria-haspopup="menu"
              aria-expanded={isSaveActionMenuOpen ? 'true' : undefined}
              onClick={(event) => setSaveActionMenuAnchorEl(event.currentTarget)}
              sx={{ px: 0.8 }}
            >
              <ArrowDropDownRoundedIcon />
            </Button>
            </ButtonGroup>
          )}
          <Menu
            anchorEl={saveActionMenuAnchorEl}
            open={isSaveActionMenuOpen}
            onClose={() => setSaveActionMenuAnchorEl(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <MenuItem
              selected={preferredSaveAction === 'save'}
              onClick={() => {
                setSaveActionMenuAnchorEl(null)
                rememberSaveAction('save')
                handleRequestSaveOpportunityDetails('save')
              }}
            >
              Save
            </MenuItem>
            <MenuItem
              selected={preferredSaveAction === 'save_close'}
              onClick={() => {
                setSaveActionMenuAnchorEl(null)
                rememberSaveAction('save_close')
                handleRequestSaveOpportunityDetails('save_close')
              }}
            >
              Save and Close
            </MenuItem>
          </Menu>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
