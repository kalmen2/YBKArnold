import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import OpenWithRoundedIcon from '@mui/icons-material/OpenWithRounded'
import PreviewRoundedIcon from '@mui/icons-material/PreviewRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
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
  Link,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
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
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { Mention, MentionsInput } from 'react-mentions'
import { useAuth } from '../auth/useAuth'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmDealer,
  createCrmDealerContact,
  convertCrmQuoteToOrder,
  createCrmQuote,
  createCrmQuoteRevision,
  createCrmQuoteChatMessage,
  convertCrmQuoteWorkbook,
  fetchCrmConvertOrderBoards,
  fetchCrmChatUsers,
  fetchCrmDealers,
  fetchCrmContacts,
  fetchCrmExcelQuoteLookup,
  fetchCrmQuoteChats,
  fetchCrmQuoteDetails,
  fetchCrmQuotePrintSettings,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  markCrmQuoteFollowedUp,
  removeCrmQuoteChatMessage,
  removeCrmQuote,
  removeCrmQuoteRevision,
  syncCrmQuoteFromExcel,
  updateCrmContact,
  updateCrmDealer,
  updateCrmQuote,
  type CrmDealer,
  type CrmContact,
  type CrmConvertOrderBoardOption,
  type CrmExcelQuoteLookupResponse,
  type CrmExcelQuoteSyncInput,
  type CrmQuoteDocument,
  type CrmQuoteLineImage,
  type CrmQuoteLineItem,
  type CrmQuoteServiceItem,
  type CrmOpportunityStage,
  type CrmQuote,
  type CrmQuoteChatMessage,
  type CrmQuotePrintSettings,
} from '../features/crm/api'
import { resolveQuoteAgeDays } from '../features/crm/utils'
import Quote3dModelPanel from '../features/crm/Quote3dModelPanel'
import {
  buildOrderDocumentBlob,
  buildProformaInvoiceBlob,
  buildWorkOrderDocumentBlob,
  type OrderDocumentLine,
} from '../features/crm/OrderConversionDocuments'
import { resolveFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { formatCurrency } from '../lib/formatters'
import { runAppProcess } from '../lib/appProcesses'
import { QUERY_KEYS } from '../lib/queryKeys'

const DEFAULT_OPPORTUNITY_TITLE_PREFIX = 'Opportunity '
const DEFAULT_WEBSITE_PAYMENT_TERMS = '50% Deposit / 50% CBD'
const DEFAULT_NEW_ORDERS_2026_BOARD_ID = '18393945685'
const DEFAULT_DESIGN_AKF_BOARD_ID = '1064270065'
const MENTION_ALL_ID = '__mention_all__'
const quoteChatMentionsInputStyle = {
  control: { width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45 },
  '&multiLine': {
    control: { minHeight: 76, maxHeight: 180, border: '1px solid rgba(15, 23, 42, 0.26)', borderRadius: 8, backgroundColor: '#fff', overflowY: 'auto' },
    highlighter: { padding: '10px 12px', border: '1px solid transparent', boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'transparent' },
    input: { padding: '10px 12px', minHeight: 76, border: '1px solid transparent', outline: 0, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45, color: '#0f172a', backgroundColor: 'transparent' },
  },
  suggestions: {
    list: { zIndex: 1700, backgroundColor: '#fff', border: '1px solid rgba(15, 23, 42, 0.2)', borderRadius: 8, boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)', maxHeight: 240, overflowY: 'auto', padding: 4 },
    item: { padding: '8px 10px', borderRadius: 6 },
  },
} as const

function extractQuoteChatMentionUids(markup: string) {
  return [...new Set(
    Array.from(String(markup ?? '').matchAll(/@\[[^\]]+\]\(([^)]+)\)/g))
      .map((entry) => String(entry[1] ?? '').trim())
      .filter(Boolean),
  )]
}
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
}

async function parseExcelQuoteForSync(file: File, preferredQuoteNumber?: string) {
  const parser = await import('../features/crm/excelQuoteParser')
  return parser.parseExcelQuoteForSync(file, { preferredQuoteNumber })
}

type OpportunityLineItemFormState = {
  id: string
  itemNumber: string
  description: string
  qty: string
  unitPrice: string
  extPrice: string
  images: CrmQuoteLineImage[]
}

type QuoteImageShape = 'square' | 'landscape' | 'wide' | 'portrait'
type QuoteImageDisplaySize = 'small' | 'medium' | 'large'

type PreparedQuoteImage = {
  file: File
  shape: QuoteImageShape
  displaySize: QuoteImageDisplaySize
}

type QuoteImagePdfLayout = NonNullable<CrmQuoteLineImage['pdfLayout']>

type OpportunityServiceItemFormState = {
  id: string
  title: string
  description: string
  qty: string
  unitPrice: string
  extPrice: string
  images: CrmQuoteLineImage[]
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
  discountPercent: string
  discountScope: 'products' | 'products_and_freight'
  freight: string
  freightDescription: string
  notes: string
  lineItems: OpportunityLineItemFormState[]
  additionalServices: OpportunityServiceItemFormState[]
  shippingServices: OpportunityServiceItemFormState[]
  quoteDocumentUrl: string
  quoteDocumentName: string
  origin: 'website' | 'excel'
  sourceWorkbookUrl: string
  sourceWorkbookName: string
  convertedPdfUrl: string
  convertedPdfName: string
  sketchupDocumentUrl: string
  sketchupDocumentName: string
}

type AddOpportunityStage = 0 | 1 | 2 | 3

const ADD_OPPORTUNITY_STAGES = [
  'Account Information',
  'Quote Lines',
  'Services & Delivery',
  'Review & Submit',
] as const

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
  leadTime: string
  paymentTerms: string
  subtotal: string
  discountPercent: string
  discountScope: 'products' | 'products_and_freight'
  freight: string
  freightDescription: string
  notes: string
  lineItems: OpportunityLineItemFormState[]
  additionalServices: OpportunityServiceItemFormState[]
  shippingServices: OpportunityServiceItemFormState[]
  documents: CrmQuoteDocument[]
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
  chatMessageCount: number
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

type OpportunityDetailsSaveMode = 'save' | 'save_close' | 'decline'
type OpportunitySavePreference = 'save' | 'save_close'
type PendingRevisionSave = {
  mode: OpportunitySavePreference
}
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

type OpportunityDetailsTab = 'details' | 'chat' | 'activity' | QuoteSidebarFolderKey

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
  pdfPreviewQuote?: CrmQuote | null
  pdfSettings?: CrmQuotePrintSettings
  canEdit: boolean
  onAddLineItem: () => void
  onUpdateLineItem: (index: number, field: 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => void
  onRemoveLineItem: (index: number) => void
  onAddImages: (index: number, images: PreparedQuoteImage[]) => void
  onRemoveImage: (lineIndex: number, imageId: string) => void
  onUpdateImageLayout: (lineIndex: number, imageId: string, layout: QuoteImagePdfLayout) => void
  isUploadingImage: boolean
  showPdfLayoutAction?: boolean
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
    id: crypto.randomUUID(),
    itemNumber: '',
    description: '',
    qty: '',
    unitPrice: '',
    extPrice: '',
    images: [],
  }
}

function calculateExtendedPrice(qty: string, unitPrice: string) {
  const quantity = Number(qty)
  const price = Number(unitPrice)
  return qty.trim() && unitPrice.trim() && Number.isFinite(quantity) && Number.isFinite(price)
    ? String(Number((quantity * price).toFixed(2)))
    : ''
}

function updateLineItemPricing(
  lineItem: OpportunityLineItemFormState,
  field: 'description' | 'qty' | 'unitPrice' | 'extPrice',
  value: string,
) {
  const nextLineItem = { ...lineItem, [field]: value }
  if (field === 'qty' || field === 'unitPrice') {
    nextLineItem.extPrice = calculateExtendedPrice(nextLineItem.qty, nextLineItem.unitPrice)
  }
  return nextLineItem
}

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
  return { id: crypto.randomUUID(), title, description, qty: '', unitPrice: price, extPrice: unitPrice === null ? '' : '0', images: [] }
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
    }
  }).filter((item) => item.title && item.qty !== null && item.qty > 0 && item.unitPrice !== null)
}

function isBlankLineItem(lineItem: OpportunityLineItemFormState) {
  return !lineItem.description.trim()
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

const quoteImageSizeOptions: Array<{ value: QuoteImageDisplaySize; label: string; description: string }> = [
  { value: 'small', label: 'Small', description: 'Compact (~60%)' },
  { value: 'medium', label: 'Medium', description: 'Standard (~100%)' },
  { value: 'large', label: 'Large', description: 'Large (~145%)' },
]

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

function QuoteImageCropDialog({
  file,
  open,
  onCancel,
  onComplete,
}: {
  file: File | null
  open: boolean
  onCancel: () => void
  onComplete: (image: PreparedQuoteImage) => void
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
    setCroppedAreaPixels(null)
    setCropError('')
    return () => URL.revokeObjectURL(nextUrl)
  }, [file, open])

  const handleUsePicture = async () => {
    if (!file || !croppedAreaPixels) return
    setIsPreparing(true)
    setCropError('')
    try {
      onComplete({ file: await cropQuoteImage(file, croppedAreaPixels, shape), shape, displaySize })
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
          <Box sx={{ position: 'relative', height: { xs: 320, md: 470 }, bgcolor: '#111827', borderRadius: 2, overflow: 'hidden' }}>
            {sourceUrl ? <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)} objectFit="contain" /> : null}
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
            <Typography variant="caption" fontWeight={800}>Zoom</Typography>
            <Slider value={zoom} min={1} max={3} step={0.05} onChange={(_event, value) => setZoom(value as number)} aria-label="Picture zoom" />
          </Box>
          <Box>
            <Typography variant="caption" fontWeight={800}>Quote size</Typography>
            <ToggleButtonGroup exclusive value={displaySize} onChange={(_event, value: QuoteImageDisplaySize | null) => value && setDisplaySize(value)} size="small" fullWidth sx={{ mt: 0.5 }}>
              {quoteImageSizeOptions.map((option) => <ToggleButton key={option.value} value={option.value}><Stack><span>{option.label}</span><Typography variant="caption" color="text.secondary">{option.description}</Typography></Stack></ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isPreparing}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleUsePicture()} disabled={!croppedAreaPixels || isPreparing}>{isPreparing ? 'Preparing…' : 'Use Picture'}</Button>
      </DialogActions>
    </Dialog>
  )
}

const PDF_PRODUCT_LAYOUT_WIDTH = 327
const PDF_PRODUCT_LAYOUT_HEIGHT = 180

function resolveQuoteImageAspect(image: CrmQuoteLineImage) {
  const width = Number(image.width || 0)
  const height = Number(image.height || 0)
  if (width > 0 && height > 0) return width / height
  if (image.shape === 'portrait') return 4 / 5
  if (image.shape === 'wide') return 16 / 9
  if (image.shape === 'square') return 1
  return 4 / 3
}

function resolveDefaultQuoteImagePdfLayout(image: CrmQuoteLineImage): QuoteImagePdfLayout {
  const width = image.displaySize === 'small' ? 78 : image.displaySize === 'large' ? 170 : 118
  return {
    x: PDF_PRODUCT_LAYOUT_WIDTH - width - 6,
    y: 8,
    width,
  }
}

function normalizeQuoteImagePdfLayout(image: CrmQuoteLineImage, layout: QuoteImagePdfLayout): QuoteImagePdfLayout {
  const aspect = resolveQuoteImageAspect(image)
  const width = Math.min(300, Math.max(48, Number(layout.width) || 118))
  const height = width / aspect
  return {
    x: Math.min(PDF_PRODUCT_LAYOUT_WIDTH - width, Math.max(0, Number(layout.x) || 0)),
    y: Math.min(Math.max(0, PDF_PRODUCT_LAYOUT_HEIGHT - height), Math.max(0, Number(layout.y) || 0)),
    width,
  }
}

function QuotePicturesPdfLayoutDialog({
  lineItems,
  quote,
  settings,
  open,
  onCancel,
  onSave,
}: {
  lineItems: OpportunityLineItemFormState[]
  quote?: CrmQuote | null
  settings?: CrmQuotePrintSettings
  open: boolean
  onCancel: () => void
  onSave: (layouts: Array<{ lineIndex: number; imageId: string; layout: QuoteImagePdfLayout }>) => void
}) {
  const canvasRefs = useRef(new Map<number, HTMLDivElement>())
  const interactionRef = useRef<{
    mode: 'move' | 'resize'
    lineIndex: number
    image: CrmQuoteLineImage
    clientX: number
    clientY: number
    layout: QuoteImagePdfLayout
  } | null>(null)
  const [layouts, setLayouts] = useState<Record<string, QuoteImagePdfLayout>>({})
  const images = useMemo(() => lineItems.flatMap((lineItem, lineIndex) => (
    lineItem.images.map((image) => ({ lineIndex, image }))
  )), [lineItems])

  useEffect(() => {
    if (!open) return
    const resetTimer = window.setTimeout(() => {
      setLayouts(Object.fromEntries(images.map(({ image }) => [
        image.id,
        normalizeQuoteImagePdfLayout(image, image.pdfLayout || resolveDefaultQuoteImagePdfLayout(image)),
      ])))
      interactionRef.current = null
    }, 0)
    return () => window.clearTimeout(resetTimer)
  }, [images, open])

  const startInteraction = (
    mode: 'move' | 'resize',
    lineIndex: number,
    image: CrmQuoteLineImage,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const layout = layouts[image.id]
    if (!layout) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    interactionRef.current = {
      mode,
      lineIndex,
      image,
      clientX: event.clientX,
      clientY: event.clientY,
      layout,
    }
  }

  const continueInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    const canvas = interaction ? canvasRefs.current.get(interaction.lineIndex) : null
    if (!interaction || !canvas) return
    const bounds = canvas.getBoundingClientRect()
    const dx = (event.clientX - interaction.clientX) * (PDF_PRODUCT_LAYOUT_WIDTH / bounds.width)
    const dy = (event.clientY - interaction.clientY) * (PDF_PRODUCT_LAYOUT_HEIGHT / bounds.height)
    const aspect = resolveQuoteImageAspect(interaction.image)

    if (interaction.mode === 'move') {
      setLayouts((current) => ({
        ...current,
        [interaction.image.id]: normalizeQuoteImagePdfLayout(interaction.image, {
          ...interaction.layout,
          x: interaction.layout.x + dx,
          y: interaction.layout.y + dy,
        }),
      }))
      return
    }

    const widthFromPointer = Math.max(dx, dy * aspect)
    setLayouts((current) => ({
      ...current,
      [interaction.image.id]: normalizeQuoteImagePdfLayout(interaction.image, {
        ...interaction.layout,
        width: interaction.layout.width + widthFromPointer,
      }),
    }))
  }

  if (quote && settings) {
    return (
      <Suspense fallback={<Dialog open={open} fullScreen><Stack alignItems="center" justifyContent="center" height="100%"><CircularProgress /></Stack></Dialog>}>
        <QuotePdfPictureLayoutDialog open={open} quote={quote} settings={settings} onCancel={onCancel} onSave={onSave} />
      </Suspense>
    )
  }

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="lg" fullWidth>
      <DialogTitle>Preview PDF &amp; Arrange Pictures</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity="info" icon={<OpenWithRoundedIcon />}>
            This preview shows all product wording and pictures together. Drag any picture to move it, and drag its red corner to resize it.
          </Alert>
          <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
            <Box sx={{ minWidth: 720, maxWidth: 900, minHeight: 1040, mx: 'auto', p: 3.5, borderRadius: 0.5, overflow: 'hidden', border: '1px solid #cbd5e1', boxShadow: '0 12px 30px rgba(15, 23, 42, .16)', bgcolor: '#fff' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2.5, pb: 1.5, borderBottom: '3px solid #0f4c81' }}>
                <Box>
                  <Typography sx={{ color: '#b1161b', fontSize: 22, fontWeight: 900, letterSpacing: 0.3 }}>ARNOLD <Box component="span" sx={{ color: '#172033' }}>CONTRACT</Box></Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 9.5, color: '#526071' }}>866-425-6529 &nbsp; • &nbsp; ArnoldContract.us &nbsp; • &nbsp; 120 Coit Street, Irvington, NJ 07111</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ color: '#0f4c81', fontSize: 19, fontWeight: 800 }}>Estimate</Typography>
                  <Typography sx={{ color: '#475569', fontSize: 10 }}>Picture layout preview</Typography>
                </Box>
              </Stack>
              <Typography sx={{ mb: 0.8, color: '#0f4c81', fontSize: 13, fontWeight: 800 }}>Products</Typography>
              <Box sx={{ bgcolor: '#0f4c81', color: '#fff', display: 'grid', gridTemplateColumns: '46px 1fr 55px 86px 86px', px: 0.8, py: 0.75, fontSize: 11, fontWeight: 800 }}>
                <span>Item</span><span>Description and picture</span><span>Qty</span><span>Unit Price</span><span>Ext</span>
              </Box>
              {lineItems.map((lineItem, lineIndex) => (
                <Box key={lineItem.id || lineIndex} sx={{ display: 'grid', gridTemplateColumns: '46px minmax(0, 1fr) 55px 86px 86px', bgcolor: lineIndex % 2 ? '#fbfdff' : '#fff', borderBottom: '1px solid #d8e0ea' }}>
                  <Box sx={{ p: 1, borderRight: '1px solid #d8e0ea', fontSize: 12, fontWeight: 800 }}>{lineIndex + 1}</Box>
                  <Box ref={(node: HTMLDivElement | null) => { if (node) canvasRefs.current.set(lineIndex, node); else canvasRefs.current.delete(lineIndex) }} sx={{ position: 'relative', minHeight: 180, borderRight: '1px solid #d8e0ea', overflow: 'hidden', touchAction: 'none' }}>
                    <Typography sx={{ position: 'absolute', left: 10, top: 10, right: 10, whiteSpace: 'pre-wrap', color: '#334155', fontSize: 11, lineHeight: 1.4, pointerEvents: 'none' }}>{lineItem.description || 'Product description'}</Typography>
                    {lineItem.images.map((image) => {
                      const layout = layouts[image.id]
                      if (!layout) return null
                      const imageHeight = layout.width / resolveQuoteImageAspect(image)
                      return (
                        <Box key={image.id} onPointerDown={(event) => startInteraction('move', lineIndex, image, event)} onPointerMove={continueInteraction} onPointerUp={() => { interactionRef.current = null }} onPointerCancel={() => { interactionRef.current = null }} sx={{ position: 'absolute', left: `${(layout.x / PDF_PRODUCT_LAYOUT_WIDTH) * 100}%`, top: `${(layout.y / PDF_PRODUCT_LAYOUT_HEIGHT) * 100}%`, width: `${(layout.width / PDF_PRODUCT_LAYOUT_WIDTH) * 100}%`, height: `${(imageHeight / PDF_PRODUCT_LAYOUT_HEIGHT) * 100}%`, border: '2px solid #b1161b', borderRadius: 1, bgcolor: '#fff', boxShadow: '0 5px 16px rgba(15,23,42,.2)', cursor: 'grab', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}>
                          <Box component="img" draggable={false} src={image.url} alt={image.name || `Item ${lineIndex + 1}`} sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
                          <Box onPointerDown={(event) => startInteraction('resize', lineIndex, image, event)} onPointerMove={continueInteraction} onPointerUp={() => { interactionRef.current = null }} onPointerCancel={() => { interactionRef.current = null }} aria-label={`Resize picture for item ${lineIndex + 1}`} sx={{ position: 'absolute', width: 20, height: 20, right: -7, bottom: -7, borderRadius: '50%', bgcolor: '#b1161b', border: '3px solid #fff', boxShadow: '0 1px 5px rgba(0,0,0,.3)', cursor: 'nwse-resize' }} />
                        </Box>
                      )
                    })}
                  </Box>
                  <Box sx={{ p: 1, borderRight: '1px solid #d8e0ea', fontSize: 11, textAlign: 'center' }}>{lineItem.qty || '—'}</Box>
                  <Box sx={{ p: 1, borderRight: '1px solid #d8e0ea', fontSize: 11, textAlign: 'right' }}>{lineItem.unitPrice ? formatCurrency(Number(lineItem.unitPrice), 2) : '—'}</Box>
                  <Box sx={{ p: 1, bgcolor: '#f8fafc', fontSize: 11, textAlign: 'right' }}>{lineItem.extPrice ? formatCurrency(Number(lineItem.extPrice), 2) : '—'}</Box>
                </Box>
              ))}
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            Pictures remain attached to their product row, so descriptions and pricing stay readable when the estimate flows to another page.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setLayouts(Object.fromEntries(images.map(({ image }) => [image.id, normalizeQuoteImagePdfLayout(image, resolveDefaultQuoteImagePdfLayout(image))])))}>Reset All</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={() => onSave(images.map(({ lineIndex, image }) => ({ lineIndex, imageId: image.id, layout: normalizeQuoteImagePdfLayout(image, layouts[image.id] || resolveDefaultQuoteImagePdfLayout(image)) })))}>Save Picture Layout</Button>
      </DialogActions>
    </Dialog>
  )
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

function normalizeLineItemsForPayload(lineItems: OpportunityLineItemFormState[]): CrmQuoteLineItem[] {
  const normalized: CrmQuoteLineItem[] = []

  for (const lineItem of lineItems) {
    if (isBlankLineItem(lineItem)) {
      continue
    }

    normalized.push({
      id: lineItem.id,
      // Item number is always row order (1, 2, 3, ...).
      itemNumber: normalized.length + 1,
      description: lineItem.description.trim() || null,
      qty: toOptionalNumber(lineItem.qty),
      unitPrice: toOptionalNumber(lineItem.unitPrice),
      extPrice: toOptionalNumber(lineItem.extPrice),
      images: lineItem.images,
    })
  }

  return normalized
}

function mapLineItemToFormState(lineItem: CrmQuoteLineItem): OpportunityLineItemFormState {
  return {
    id: lineItem.id || crypto.randomUUID(),
    itemNumber: String(lineItem.itemNumber ?? '').trim(),
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

function resolveQuotePricing(
  lineItems: OpportunityLineItemFormState[],
  subtotalInput: string,
  freightInput: string,
  fallbackTotal = 0,
  additionalServices: OpportunityServiceItemFormState[] = [],
  shippingServices: OpportunityServiceItemFormState[] = [],
  discountPercentInput = '',
  discountScope: 'products' | 'products_and_freight' = 'products',
) {
  const normalizedLineItems = normalizeLineItemsForPayload(lineItems)
  const lineItemsTotal = calculateLineItemsTotal(normalizedLineItems)
  const normalizedAdditionalServices = normalizeServiceItemsForPayload(additionalServices)
  const normalizedShippingServices = normalizeServiceItemsForPayload(shippingServices)
  const additionalServicesTotal = normalizedAdditionalServices
    .reduce((sum, item) => sum + Number(resolveServiceItemExtPrice(item) || 0), 0)
  const shippingServicesTotal = normalizedShippingServices
    .reduce((sum, item) => sum + Number(resolveServiceItemExtPrice(item) || 0), 0)
  const enteredSubtotal = toOptionalNumber(subtotalInput)
  const enteredFreight = toOptionalNumber(freightInput)
  const grossSubtotal = Number(((enteredSubtotal ?? lineItemsTotal) + additionalServicesTotal).toFixed(2))
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
    leadTime: '',
    paymentTerms: DEFAULT_WEBSITE_PAYMENT_TERMS,
    subtotal: '',
    discountPercent: '',
    discountScope: 'products',
    freight: '',
    freightDescription: '',
    notes: '',
    lineItems: Array.from({ length: 4 }, () => createEmptyLineItemFormState()),
    additionalServices: createDefaultAdditionalServices(),
    shippingServices: createDefaultShippingServices(),
    quoteDocumentUrl: '',
    quoteDocumentName: '',
    origin: 'website',
    sourceWorkbookUrl: '',
    sourceWorkbookName: '',
    convertedPdfUrl: '',
    convertedPdfName: '',
    sketchupDocumentUrl: '',
    sketchupDocumentName: '',
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
  const storedAdditionalServicesTotal = (quote.additionalServices || [])
    .reduce((sum, item) => sum + Number(resolveServiceItemExtPrice(item) || 0), 0)
  const storedProductDiscountAmount = Number(quote.discountAmount || 0) - Number(quote.discountFreightAmount || 0)
  const grossStoredSubtotal = Number(quote.subtotal || 0) + storedProductDiscountAmount
  const productSubtotal = quote.subtotal === null || quote.subtotal === undefined
    ? ''
    : String(Math.max(0, grossStoredSubtotal - storedAdditionalServicesTotal))

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
    subtotal: origin === 'excel' ? productSubtotal : '',
    discountPercent: quote.discountPercent === null || quote.discountPercent === undefined ? '' : String(quote.discountPercent),
    discountScope: quote.discountScope === 'products_and_freight' ? 'products_and_freight' : 'products',
    freight: origin === 'excel' && quote.freight !== null && quote.freight !== undefined ? String(quote.freight) : '',
    freightDescription: String(quote.freightDescription || ''),
    notes: String(quote.notes || ''),
    lineItems: mapQuoteLineItemsToFormState(quote.lineItems),
    additionalServices,
    shippingServices: mapServiceItemsToFormState(quote.shippingServices, createDefaultShippingServices),
    documents: resolveQuoteDocuments(quote),
    origin,
    sourceWorkbookUrl: String(quote.sourceWorkbookUrl || ''),
    sourceWorkbookName: String(quote.sourceWorkbookName || ''),
    convertedPdfUrl: String(quote.convertedPdfUrl || ''),
    convertedPdfName: String(quote.convertedPdfName || ''),
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
    documents: quote.documents,
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
  const nextDocuments = Array.from(new Map([
    ...baseState.documents,
    ...(syncInput.sourceWorkbookUrl ? [{ url: syncInput.sourceWorkbookUrl, name: syncInput.sourceWorkbookName || null }] : []),
    ...(syncInput.convertedPdfUrl ? [{ url: syncInput.convertedPdfUrl, name: syncInput.convertedPdfName || null }] : []),
  ].map((document) => [document.url, document])).values())

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
    documents: nextDocuments,
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

function isIgnoredFolderScanFile(file: File): boolean {
  const normalizedName = String(file.name ?? '').trim().toLowerCase()

  return !normalizedName
    || normalizedName === 'thumbs.db'
    || normalizedName === '.ds_store'
    || normalizedName === 'desktop.ini'
    || normalizedName.startsWith('~$')
    || normalizedName.startsWith('._')
}

function resolveFolderScanPreferredQuoteNumber(scannedFiles: File[], quotes: CrmQuote[]): string | undefined {
  const rootFolderKeys = new Set(scannedFiles.map((file) => {
    const [rootFolder = ''] = resolvePathSegments(file.webkitRelativePath || file.name)
    return rootFolder.toLowerCase().replace(/[^a-z0-9]+/g, '')
  }).filter(Boolean))

  return quotes.find((quote) => {
    const quoteKey = String(quote.quoteNumber ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    return quoteKey && [...rootFolderKeys].some((rootKey) => rootKey.includes(quoteKey))
  })?.quoteNumber || undefined
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
    if (isIgnoredFolderScanFile(file)) {
      return []
    }

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
  pdfPreviewQuote,
  pdfSettings,
  canEdit,
  onAddLineItem,
  onUpdateLineItem,
  onRemoveLineItem,
  onAddImages,
  onRemoveImage,
  onUpdateImageLayout,
  isUploadingImage,
  showPdfLayoutAction = true,
}: LineItemsEditorProps) {
  const lineItemsTotal = calculateLineItemsTotal(normalizeLineItemsForPayload(lineItems))
  const [cropTarget, setCropTarget] = useState<{ index: number; file: File } | null>(null)
  const [isPictureLayoutOpen, setIsPictureLayoutOpen] = useState(false)
  const pictureCount = lineItems.reduce((total, lineItem) => total + lineItem.images.length, 0)

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

        <Stack direction="row" spacing={0.8}>
          {showPdfLayoutAction ? (
            <Button size="small" variant="outlined" startIcon={<PreviewRoundedIcon />} onClick={() => setIsPictureLayoutOpen(true)} disabled={!canEdit || pictureCount === 0}>
              Preview PDF &amp; Arrange Pictures
            </Button>
          ) : null}
          <Button size="small" variant="outlined" onClick={onAddLineItem} disabled={!canEdit}>
            Add line item
          </Button>
        </Stack>
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
        <Table size="small" sx={{ minWidth: 980 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 62, fontWeight: 700 }}>Item</TableCell>
              <TableCell sx={{ minWidth: 420, fontWeight: 700 }}>Description</TableCell>
              <TableCell sx={{ width: 90, fontWeight: 700 }}>Qty</TableCell>
              <TableCell sx={{ width: 125, fontWeight: 700 }}>Unit Price</TableCell>
              <TableCell sx={{ width: 135, fontWeight: 700 }}>Ext</TableCell>
              <TableCell align="center" sx={{ width: 60, fontWeight: 700 }}>Del</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lineItems.map((lineItem, index) => (
              <TableRow key={`line-item-${index}`} hover>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <Typography variant="body2" sx={{ pt: 0.7, fontWeight: 800, textAlign: 'center' }}>
                    {index + 1}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.9} alignItems="flex-start">
                    <TextField
                      variant="standard"
                      size="small"
                      value={lineItem.description}
                      onChange={(event) => {
                        onUpdateLineItem(index, 'description', event.target.value)
                      }}
                      disabled={!canEdit}
                      multiline
                      minRows={4}
                      maxRows={12}
                      fullWidth
                      sx={{ flexGrow: 1 }}
                    />
                    <Stack spacing={0.6} sx={{ width: { xs: '100%', lg: 240 }, flexShrink: 0 }}>
                      {lineItem.images.length > 0 ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                          {lineItem.images.map((image) => {
                            const previewSize = resolveEditorLineImagePreviewSize(image.displaySize)

                            return (
                              <Box
                                key={image.id}
                                sx={{
                                  position: 'relative',
                                  width: previewSize.width,
                                  height: previewSize.height,
                                  border: 1,
                                  borderColor: 'divider',
                                  borderRadius: 1,
                                  overflow: 'hidden',
                                  bgcolor: '#fff',
                                }}
                              >
                                <Box component="img" src={image.url} alt={image.name || 'Line item'} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                {canEdit ? (
                                  <>
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => onRemoveImage(index, image.id)}
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
      <QuoteImageCropDialog
        open={Boolean(cropTarget)}
        file={cropTarget?.file || null}
        onCancel={() => setCropTarget(null)}
        onComplete={(image) => {
          if (cropTarget) onAddImages(cropTarget.index, [image])
          setCropTarget(null)
        }}
      />
      <QuotePicturesPdfLayoutDialog
        open={isPictureLayoutOpen}
        lineItems={lineItems}
        quote={pdfPreviewQuote}
        settings={pdfSettings}
        onCancel={() => setIsPictureLayoutOpen(false)}
        onSave={(nextLayouts) => {
          nextLayouts.forEach(({ lineIndex, imageId, layout }) => onUpdateImageLayout(lineIndex, imageId, layout))
          setIsPictureLayoutOpen(false)
        }}
      />
    </Stack>
  )
}

type QuoteServiceItemsEditorProps = {
  heading: string
  description: string
  items: OpportunityServiceItemFormState[]
  canEdit: boolean
  isUploadingImage: boolean
  onChange: (items: OpportunityServiceItemFormState[]) => void
  onAddImages: (index: number, images: PreparedQuoteImage[]) => void
}

function QuoteServiceItemsEditor({ heading, description, items, canEdit, isUploadingImage, onChange, onAddImages }: QuoteServiceItemsEditorProps) {
  const [cropTarget, setCropTarget] = useState<{ index: number; file: File } | null>(null)
  const updateItem = (index: number, patch: Partial<OpportunityServiceItemFormState>) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const updateItemField = (
    index: number,
    field: 'title' | 'description' | 'qty' | 'unitPrice' | 'extPrice',
    value: string,
  ) => {
    onChange(items.map((item, itemIndex) => (
      itemIndex === index
        ? updateServiceItemPricing(item, field, value)
        : item
    )))
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        overflow: 'hidden',
        borderRadius: 2,
        borderColor: alpha('#0f4c81', 0.2),
        boxShadow: '0 8px 24px rgba(15, 76, 129, 0.06)',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        gap={1}
        sx={{ px: 1.6, py: 1.3, background: `linear-gradient(135deg, ${alpha('#0f4c81', 0.1)}, ${alpha('#0f4c81', 0.025)})` }}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={800} color="primary.dark">{heading}</Typography>
          <Typography variant="caption" color="text.secondary">{description}</Typography>
        </Box>
        <Button size="small" variant="contained" disabled={!canEdit} onClick={() => onChange([...items, createServiceItemFormState()])}>Add service</Button>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' },
          gap: 1,
          p: 1.2,
          backgroundColor: '#f8fafc',
        }}
      >
        {items.map((item, index) => (
          <Paper key={item.id} variant="outlined" sx={{ p: 1.2, borderRadius: 1.5, borderColor: alpha('#0f4c81', 0.16), bgcolor: '#fff' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="flex-start" height="100%">
              <Stack spacing={0.8} flex={1} width="100%">
                <TextField size="small" label="Service" value={item.title} disabled={!canEdit} onChange={(event) => updateItemField(index, 'title', event.target.value)} />
                <TextField size="small" label="Description / conditions" value={item.description} disabled={!canEdit} multiline minRows={2} maxRows={4} onChange={(event) => updateItemField(index, 'description', event.target.value)} />
                <Stack direction="row" spacing={0.8}>
                  <TextField
                    size="small"
                    label="Qty"
                    type="number"
                    value={item.qty}
                    disabled={!canEdit}
                    onChange={(event) => updateItemField(index, 'qty', event.target.value)}
                    inputProps={{ inputMode: 'decimal' }}
                    sx={{ width: 90 }}
                  />
                  <TextField
                    size="small"
                    label="Unit Price"
                    type="number"
                    value={item.unitPrice}
                    disabled={!canEdit}
                    onChange={(event) => updateItemField(index, 'unitPrice', event.target.value)}
                    inputProps={{ inputMode: 'decimal' }}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    sx={{ flex: 1, minWidth: 120 }}
                  />
                  <TextField
                    size="small"
                    label="Ext"
                    type="text"
                    value={item.extPrice}
                    disabled={!canEdit}
                    inputProps={{ inputMode: 'decimal' }}
                    InputProps={{
                      readOnly: true,
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    sx={{ flex: 1, minWidth: 120 }}
                  />
                </Stack>
              </Stack>
              <Stack spacing={0.6} sx={{ width: { xs: '100%', md: 150 } }}>
                {item.images.length > 0 ? (
                  <Stack direction="row" spacing={0.5}>
                    {item.images.map((image) => (
                      <Box key={image.id} sx={{ position: 'relative', width: item.images.length === 1 ? 150 : 72, height: 76, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                        <Box component="img" src={image.url} alt={image.name || item.title} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        {canEdit ? <IconButton size="small" color="error" onClick={() => updateItem(index, { images: item.images.filter((entry) => entry.id !== image.id) })} sx={{ position: 'absolute', top: 1, right: 1, bgcolor: 'rgba(255,255,255,.9)', p: 0.2 }}><DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} /></IconButton> : null}
                      </Box>
                    ))}
                  </Stack>
                ) : <Typography variant="caption" color="text.secondary">Picture optional</Typography>}
                {item.images.length < 2 ? (
                  <Button component="label" size="small" variant="text" startIcon={<FileUploadRoundedIcon />} disabled={!canEdit || isUploadingImage} sx={{ alignSelf: 'flex-start', px: 0.4 }}>
                    Add picture
                    <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) setCropTarget({ index, file })
                    }} />
                  </Button>
                ) : null}
              </Stack>
              <Tooltip title="Remove service">
                <span><IconButton size="small" color="error" disabled={!canEdit} onClick={() => onChange(items.filter((_entry, itemIndex) => itemIndex !== index))}><DeleteOutlineRoundedIcon /></IconButton></span>
              </Tooltip>
            </Stack>
          </Paper>
        ))}
      </Box>
      <QuoteImageCropDialog
        open={Boolean(cropTarget)}
        file={cropTarget?.file || null}
        onCancel={() => setCropTarget(null)}
        onComplete={(image) => {
          if (cropTarget) onAddImages(cropTarget.index, [image])
          setCropTarget(null)
        }}
      />
    </Paper>
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
        borderColor: alpha('#0f4c81', 0.2),
        boxShadow: '0 10px 30px rgba(15, 76, 129, 0.07)',
      }}
    >
      <Box sx={{ px: 2, py: 1.6, background: `linear-gradient(135deg, ${alpha('#0f4c81', 0.12)}, ${alpha('#0f4c81', 0.025)})` }}>
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
                borderColor: isSelected ? 'primary.main' : alpha('#0f4c81', 0.18),
                bgcolor: isSelected ? alpha('#0f4c81', 0.055) : '#fff',
                boxShadow: isSelected ? `0 0 0 1px ${alpha('#0f4c81', 0.3)}` : '0 3px 12px rgba(15, 76, 129, 0.05)',
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
                <TextField
                  required
                  autoFocus
                  label="Quantity"
                  type="number"
                  value={draft.qty}
                  onChange={(event) => setDraft((current) => current ? updateServiceItemPricing(current, 'qty', event.target.value) : current)}
                  inputProps={{ min: 0, step: 1, inputMode: 'decimal' }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  required
                  label="Unit Price"
                  type="number"
                  value={draft.unitPrice}
                  onChange={(event) => setDraft((current) => current ? updateServiceItemPricing(current, 'unitPrice', event.target.value) : current)}
                  inputProps={{ min: 0, step: 0.01, inputMode: 'decimal' }}
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
  chatMessageCount,
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
            imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
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

            <IconButton
              size="small"
              disabled={isBusy}
              onClick={(event) => {
                preventCardClick(event)
                onPrintQuote(quote)
              }}
              sx={{ p: 0.15, color: '#0f4c81' }}
              title="Print quote"
              aria-label="Print quote"
            >
              <PrintRoundedIcon sx={{ fontSize: 20 }} />
            </IconButton>

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
                chatMessageCount={Math.max(0, Number(quote.chatMessageCount || 0))}
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkedQuoteId = String(searchParams.get('quoteId') || '').trim()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [formState, setFormState] = useState<OpportunityFormState>(createEmptyOpportunityForm)
  const [addOpportunityStage, setAddOpportunityStage] = useState<AddOpportunityStage>(0)
  const [addOpportunitySubmitAttempted, setAddOpportunitySubmitAttempted] = useState(false)
  const [isAddPictureLayoutOpen, setIsAddPictureLayoutOpen] = useState(false)
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
  const [isUploadingQuoteDocument, setIsUploadingQuoteDocument] = useState(false)
  const [isUploadingLineImage, setIsUploadingLineImage] = useState(false)
  const [isUploadingFolderSelection, setIsUploadingFolderSelection] = useState(false)
  const [isSavingOpportunityDetails, setIsSavingOpportunityDetails] = useState(false)
  const [isConvertOrderDialogOpen, setIsConvertOrderDialogOpen] = useState(false)
  const [isSubmittingConvertOrder, setIsSubmittingConvertOrder] = useState(false)
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null)
  const [loadingOpportunityId, setLoadingOpportunityId] = useState<string | null>(null)
  const [quotePrintPreview, setQuotePrintPreview] = useState<CrmQuote | null>(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmQuote | null>(null)
  const [selectedRevisionNumber, setSelectedRevisionNumber] = useState(0)
  const [pendingRevisionSave, setPendingRevisionSave] = useState<PendingRevisionSave | null>(null)
  const [saveTargetRevisionNumber, setSaveTargetRevisionNumber] = useState(0)
  const [isCreatingRevision, setIsCreatingRevision] = useState(false)
  const [isDeletingRevision, setIsDeletingRevision] = useState(false)
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
  const [selectedOpportunityChatDraftMarkup, setSelectedOpportunityChatDraftMarkup] = useState('')
  const [selectedOpportunityRefreshOnSend, setSelectedOpportunityRefreshOnSend] = useState(false)
  const [isSendingSelectedOpportunityChat, setIsSendingSelectedOpportunityChat] = useState(false)
  const [deletingSelectedOpportunityChatMessageId, setDeletingSelectedOpportunityChatMessageId] = useState('')
  const [detailsActionMenuAnchorEl, setDetailsActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [saveActionMenuAnchorEl, setSaveActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const savePreferenceStorageKey = `arnold:quote-save-action:${appUser?.uid || 'current-user'}`
  const [preferredSaveAction, setPreferredSaveAction] = useState<OpportunitySavePreference>(() => (
    window.localStorage.getItem(savePreferenceStorageKey) === 'save_close' ? 'save_close' : 'save'
  ))
  const [uploadQuoteActionMenuAnchorEl, setUploadQuoteActionMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState('')
  const activePipelineStage: CrmOpportunityStage = 'proposal_submission'
  const pipelineUploadExcelInputRef = useRef<HTMLInputElement | null>(null)
  const folderScanInputRef = useRef<HTMLInputElement | null>(null)
  const selectedOpportunityId = selectedOpportunity?.id ?? ''
  const shouldLoadDealers = Boolean(
    isDialogOpen
    || selectedOpportunityId
    || loadingOpportunityId
    || isExcelAccountDialogOpen
    || isExcelSyncDialogOpen
    || isFolderScanSelectionDialogOpen
  )

  const dealersQuery = useQuery({
    queryKey: QUERY_KEYS.crmOpportunitiesDealers,
    queryFn: () => fetchCrmDealers({ limit: 2500, includeArchived: false }),
    staleTime: 5 * 60 * 1000,
    enabled: shouldLoadDealers,
  })

  const addOpportunityContactsQuery = useQuery({
    queryKey: ['crm', 'dealer-contacts', formState.dealerSourceId],
    queryFn: () => fetchCrmContacts({
      dealerSourceId: formState.dealerSourceId,
      limit: 1000,
      includeArchived: false,
    }),
    enabled: Boolean(isDialogOpen && formState.dealerSourceId),
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
    staleTime: 5 * 60 * 1000,
    enabled: isConvertOrderDialogOpen,
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
  const quoteChatUsersQuery = useQuery({
    queryKey: ['crm', 'chat-users'],
    queryFn: fetchCrmChatUsers,
    enabled: Boolean(selectedOpportunityId && selectedOpportunityDetailsTab === 'chat'),
    staleTime: 2 * 60 * 1000,
  })

  const isLoading = quotesQuery.isLoading
  const isRefreshing = (
    quotesQuery.isFetching
  ) && !isLoading

  const queryError = [
    quotesQuery.error,
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
  const quoteChatUsers = quoteChatUsersQuery.data?.users ?? []
  const quoteChatMentionOptions = useMemo(() => [
    { id: MENTION_ALL_ID, display: 'all' },
    ...quoteChatUsers.map((user) => ({
      id: user.uid,
      display: String(user.displayName || user.email.split('@')[0] || user.email).trim(),
    })),
  ], [quoteChatUsers])

  const selectedOpportunityChatErrorMessage = selectedOpportunityChatsQuery.error instanceof Error
    ? selectedOpportunityChatsQuery.error.message
    : null

  const isAddDialogDirty = useMemo(
    () => serializeOpportunityFormState(formState) !== addDialogInitialSnapshot,
    [addDialogInitialSnapshot, formState],
  )

  const canUploadQuoteDocument = Boolean(formState.quoteNumber.trim())

  const addPricingPreview = useMemo(() => {
    const pricing = resolveQuotePricing(formState.lineItems, formState.subtotal, formState.freight, 0, formState.additionalServices, formState.shippingServices, formState.discountPercent, formState.discountScope)
    return {
      grossSubtotal: pricing.grossSubtotal,
      discountPercent: pricing.discountPercent,
      discountAmount: pricing.discountAmount,
      discountFreightAmount: pricing.discountFreightAmount,
      discountScope: pricing.discountScope,
      subtotal: pricing.subtotal ?? pricing.lineItemsTotal,
      freight: pricing.freight ?? 0,
      totalAmount: pricing.totalAmount,
    }
  }, [formState.additionalServices, formState.discountPercent, formState.discountScope, formState.freight, formState.lineItems, formState.shippingServices, formState.subtotal])

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

    const quoteLinesMissing: string[] = []
    const enteredLineItems = formState.lineItems.filter((lineItem) => !isBlankLineItem(lineItem))

    if (enteredLineItems.length === 0) {
      quoteLinesMissing.push('At least one quote line')
    } else {
      enteredLineItems.forEach((lineItem, index) => {
        if (!lineItem.description.trim()) quoteLinesMissing.push(`Line ${index + 1} description`)
        if (!lineItem.qty.trim() || !Number.isFinite(Number(lineItem.qty)) || Number(lineItem.qty) <= 0) {
          quoteLinesMissing.push(`Line ${index + 1} quantity`)
        }
        if (!lineItem.unitPrice.trim() || !Number.isFinite(Number(lineItem.unitPrice)) || Number(lineItem.unitPrice) < 0) {
          quoteLinesMissing.push(`Line ${index + 1} unit price`)
        }
      })
    }

    return [accountMissing, quoteLinesMissing, [], []] as const
  }, [
    addOpportunityContactOptions,
    dealersBySourceId,
    formState.contactEmail,
    formState.dealerSourceId,
    formState.leadTime,
    formState.lineItems,
    formState.opportunityDateInput,
    formState.paymentTerms,
    formState.quoteNumber,
    formState.salesRep,
    formState.title,
    quotes,
    selectedAddContactSourceId,
  ])

  const addOpportunityTotalMissing = addOpportunityMissingByStage
    .reduce((total, missingFields) => total + missingFields.length, 0)

  const addOpportunityPreviewQuote = useMemo(() => ({
    id: 'new-opportunity-preview',
    dealerSourceId: formState.dealerSourceId || null,
    quoteNumber: formState.quoteNumber.trim() || null,
    title: formState.title.trim() || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${formState.quoteNumber.trim() || 'Preview'}`,
    companyName: formState.companyName.trim() || null,
    contactName: formState.contactName.trim() || null,
    contactEmail: formState.contactEmail.trim() || null,
    contactPhone: formState.contactPhone.trim() || null,
    salesRep: formState.salesRep.trim() || null,
    opportunityDate: formState.opportunityDateInput.trim() || null,
    leadTime: formState.leadTime.trim() || null,
    paymentTerms: formState.paymentTerms.trim() || null,
    subtotal: addPricingPreview.subtotal,
    discountPercent: addPricingPreview.discountPercent,
    discountAmount: addPricingPreview.discountAmount,
    discountScope: addPricingPreview.discountScope,
    discountFreightAmount: addPricingPreview.discountFreightAmount,
    freight: addPricingPreview.freight,
    freightDescription: formState.freightDescription.trim() || null,
    lineItems: normalizeLineItemsForPayload(formState.lineItems),
    additionalServices: normalizeServiceItemsForPayload(formState.additionalServices),
    shippingServices: normalizeServiceItemsForPayload(formState.shippingServices),
    totalAmount: addPricingPreview.totalAmount,
    notes: formState.notes.trim() || null,
    status: 'draft',
    origin: formState.origin,
    documents: [],
    revisions: [],
    revisionCount: 0,
    activeRevisionNumber: 0,
  } as unknown as CrmQuote), [
    addPricingPreview,
    formState.additionalServices,
    formState.companyName,
    formState.contactEmail,
    formState.contactName,
    formState.contactPhone,
    formState.dealerSourceId,
    formState.freightDescription,
    formState.leadTime,
    formState.lineItems,
    formState.notes,
    formState.opportunityDateInput,
    formState.origin,
    formState.paymentTerms,
    formState.quoteNumber,
    formState.salesRep,
    formState.shippingServices,
    formState.title,
  ])

  const detailsPricingPreview = useMemo(() => {
    if (!opportunityDetailsFormState) {
      return null
    }

    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.subtotal,
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
      totalAmount: pricing.totalAmount,
    }
  }, [opportunityDetailsFormState, selectedOpportunity?.totalAmount])

  const selectedOpportunityPrintQuote = useMemo<CrmQuote | null>(() => {
    if (!selectedRevisionQuote || !opportunityDetailsFormState || selectedRevisionQuote.origin === 'excel') {
      return selectedRevisionQuote
    }

    const pricing = resolveQuotePricing(
      opportunityDetailsFormState.lineItems,
      opportunityDetailsFormState.subtotal,
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
    setExcelSyncLaunchMode('excel_file')
    setPendingFolderScanFiles(null)
    setExcelSyncDraft(null)
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
    excelPayload: CrmExcelQuoteSyncInput,
    sourceFileName: string,
    options: {
      launchMode: ExcelSyncLaunchMode
      scannedFiles?: File[]
      sourceFile?: File
    },
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

    setExcelSyncLaunchMode(options.launchMode)
    setPendingFolderScanFiles(options.launchMode === 'folder_scan' ? (options.scannedFiles ?? []) : null)
    setExcelSyncLookupResult(lookupResult)
    setExcelSyncDraft(excelPayload)
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
        launchMode: 'excel_file',
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

      if (!excelSyncSourceFile) {
        throw new Error('The source workbook is no longer available. Select the Excel or ODS file again.')
      }

      if (excelSyncSourceFile.size > 25 * 1024 * 1024) {
        throw new Error('The source workbook must be 25 MB or smaller.')
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
        sourceWorkbookUrl,
        sourceWorkbookName: excelSyncSourceFile.name,
        convertedPdfUrl: converted.convertedPdfUrl,
        convertedPdfName: converted.convertedPdfName,
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
    excelSyncLaunchMode,
    excelSyncDealerStateCode,
    excelSyncDraft,
    excelSyncSourceFile,
    excelSyncLookupResult,
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

  const handleSketchupDocumentUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setErrorMessage(null)
    setIsUploadingQuoteDocument(true)

    try {
      if (!/\.(?:skp|glb)$/i.test(file.name)) {
        throw new Error('Select a SketchUp .skp file or a smooth web .glb file.')
      }
      if (file.size > 2 * 1024 * 1024 * 1024) {
        throw new Error('The 3D model must be 2 GB or smaller.')
      }

      const normalizedQuoteNumber = formState.quoteNumber.trim()
      if (!normalizedQuoteNumber) {
        throw new Error('Enter quote number before uploading the 3D model.')
      }

      const companySegment = sanitizeStoragePathSegment(formState.companyName.trim() || 'company', 'company')
      const quoteSegment = sanitizeStoragePathSegment(normalizedQuoteNumber, 'opportunity')
      const extension = file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'skp'
      const filePath = `crm/opportunities/${companySegment}/${quoteSegment}-rendering-${Date.now()}.${extension}`
      const fileRef = storageRef(firebaseStorage, filePath)
      await uploadBytes(fileRef, file, {
        contentType: file.type || 'application/octet-stream',
      })
      const downloadUrl = await getDownloadURL(fileRef)

      setFormState((current) => ({
        ...current,
        sketchupDocumentUrl: downloadUrl,
        sketchupDocumentName: file.name,
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload the 3D model.')
    } finally {
      setIsUploadingQuoteDocument(false)
    }
  }, [formState.companyName, formState.quoteNumber])

  const uploadLineItemImages = useCallback(async (
    files: Array<File | PreparedQuoteImage>,
    quoteNumber: string,
    companyName: string,
  ): Promise<CrmQuoteLineImage[]> => {
    const normalizedQuoteNumber = quoteNumber.trim()
    if (!normalizedQuoteNumber) throw new Error('Enter a quote number before adding pictures.')

    const companySegment = sanitizeStoragePathSegment(companyName.trim() || 'company', 'company')
    const quoteSegment = sanitizeStoragePathSegment(normalizedQuoteNumber, 'opportunity')
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
    const scannedFiles = Array.from(event.target.files ?? []).filter((file) => !isIgnoredFolderScanFile(file))
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
      let sourceExcelFile: File | null = null
      const preferredQuoteNumber = resolveFolderScanPreferredQuoteNumber(scannedFiles, quotes)

      for (const file of excelFiles) {
        try {
          parsedExcelPayload = await parseExcelQuoteForSync(file, preferredQuoteNumber)
          sourceExcelFileName = file.name
          sourceExcelFile = file
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

        syncedQuote = await loadOpportunityDetails(syncedQuote)

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
        sourceFile: sourceExcelFile || undefined,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to scan quote folder.')
    } finally {
      setIsUploadingFolderSelection(false)
    }
  }, [canManage, initializeExcelSyncFromPayload, loadOpportunityDetails, openFolderScanSelectionDialogForQuote, queryClient, quotes])

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
      const requestedMentionUids = extractQuoteChatMentionUids(selectedOpportunityChatDraftMarkup)
      const mentionUserUids = requestedMentionUids.includes(MENTION_ALL_ID)
        ? [...new Set(quoteChatUsers.map((user) => user.uid))]
        : requestedMentionUids

      await createCrmQuoteChatMessage(selectedOpportunityId, {
        message: nextMessage,
        mentionUserUids,
      })

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
      setSelectedOpportunityChatDraftMarkup('')
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
    selectedOpportunityChatDraftMarkup,
    selectedOpportunityId,
    quoteChatUsers,
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

      setDealerSearchInput(resolveDealerSelectionLabel(dealer))
      setSelectedAddContactSourceId('')
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
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesDealers })
      setIsNewDealerDialogOpen(false)
    } catch (error) {
      setNewDealerError(error instanceof Error ? error.message : 'Failed to add dealer account.')
    } finally {
      setIsSavingNewDealer(false)
    }
  }, [
    excelSyncSalesRepOptions,
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
    setNewContactError(null)
    setNewContactForm({
      name: formState.contactName.trim(),
      email: formState.contactEmail.trim(),
      phone: formState.contactPhone.trim(),
    })
    setIsNewContactDialogOpen(true)
  }, [formState.contactEmail, formState.contactName, formState.contactPhone])

  const handleSavePaymentTerms = useCallback(async () => {
    const paymentTerms = paymentTermsDraft.trim()

    if (!paymentTerms) {
      return
    }

    setIsSavingPaymentTerms(true)

    try {
      if (paymentTermsApplyMode === 'dealer' && formState.dealerSourceId.trim()) {
        await updateCrmDealer(formState.dealerSourceId.trim(), { paymentTerms })
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesDealers })
      }
      setFormState((current) => ({ ...current, paymentTerms }))
      setIsPaymentTermsDialogOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update payment terms.')
    } finally {
      setIsSavingPaymentTerms(false)
    }
  }, [formState.dealerSourceId, paymentTermsApplyMode, paymentTermsDraft, queryClient])

  const handleCreateDealerContact = useCallback(async () => {
    const dealerSourceId = formState.dealerSourceId.trim()
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
      setFormState((current) => ({
        ...current,
        contactName: resolveContactSelectionLabel(contact),
        contactEmail: contact.primaryEmail || '',
        contactPhone: contact.phone || '',
      }))
      await queryClient.invalidateQueries({ queryKey: ['crm', 'dealer-contacts', dealerSourceId] })
      setIsNewContactDialogOpen(false)
      setNewContactForm({ name: '', email: '', phone: '' })
    } catch (error) {
      setNewContactError(error instanceof Error ? error.message : 'Failed to add contact.')
    } finally {
      setIsSavingNewContact(false)
    }
  }, [formState.dealerSourceId, newContactForm.email, newContactForm.name, newContactForm.phone, queryClient])

  const clearDeepLinkedQuoteId = useCallback(() => {
    if (!searchParams.has('quoteId')) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('quoteId')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const openLoadedOpportunityDetails = useCallback((quote: CrmQuote, initialTab: OpportunityDetailsTab = 'details') => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setDetailsActionMenuAnchorEl(null)
    setSaveActionMenuAnchorEl(null)
    setPendingRevisionSave(null)
    setUploadQuoteActionMenuAnchorEl(null)
    const nextRevisionNumber = Number(quote.activeRevisionNumber ?? quote.revisionCount ?? 0)
    const nextRevisionQuote = resolveQuoteRevision(quote, nextRevisionNumber)
    const nextFormState = createOpportunityDetailsFormState(nextRevisionQuote)
    setSelectedOpportunityChatDraft('')
    setSelectedOpportunityRefreshOnSend(false)
    setDeletingSelectedOpportunityChatMessageId('')
    setSelectedOpportunityDetailsTab(initialTab)
    setSelectedOpportunityNestedFolderPath(null)
    setSelectedOpportunity(quote)
    setSelectedRevisionNumber(nextRevisionNumber)
    setOpportunityDetailsFormState(nextFormState)
    setOpportunityDetailsInitialSnapshot(serializeOpportunityDetailsFormState(nextFormState))
    setFolderScanQueue([])
    setIsUploadingFolderSelection(false)
  }, [])

  const handleOpenOpportunityDetails = useCallback(async (summary: CrmQuote, initialTab: OpportunityDetailsTab = 'details') => {
    setErrorMessage(null)
    setBusyQuoteId(summary.id)
    setLoadingOpportunityId(summary.id)
    try {
      openLoadedOpportunityDetails(await loadOpportunityDetails(summary), initialTab)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load opportunity details.')
    } finally {
      setBusyQuoteId(null)
      setLoadingOpportunityId(null)
    }
  }, [loadOpportunityDetails, openLoadedOpportunityDetails])

  const handleOpenOpportunityChat = useCallback((quote: CrmQuote) => {
    void handleOpenOpportunityDetails(quote, 'chat')
  }, [handleOpenOpportunityDetails])

  useEffect(() => {
    if (!deepLinkedQuoteId) {
      return
    }

    const deepLinkedQuote = quotes.find((quote) => quote.id === deepLinkedQuoteId)

    if (deepLinkedQuote) {
      void handleOpenOpportunityDetails(deepLinkedQuote)
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
    setSaveActionMenuAnchorEl(null)
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
    (index: number, field: 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => {
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

  const handleAddFormLineImages = useCallback(async (index: number, files: PreparedQuoteImage[]) => {
    setErrorMessage(null)
    setIsUploadingLineImage(true)
    try {
      const images = await uploadLineItemImages(files, formState.quoteNumber, formState.companyName)
      setFormState((current) => ({
        ...current,
        lineItems: current.lineItems.map((line, lineIndex) => lineIndex === index
          ? { ...line, images: [...line.images, ...images].slice(0, 2) }
          : line),
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload line picture.')
    } finally {
      setIsUploadingLineImage(false)
    }
  }, [formState.companyName, formState.quoteNumber, uploadLineItemImages])

  const handleRemoveFormLineImage = useCallback((lineIndex: number, imageId: string) => {
    setFormState((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, index) => index === lineIndex
        ? { ...line, images: line.images.filter((image) => image.id !== imageId) }
        : line),
    }))
  }, [])

  const handleUpdateFormLineImageLayout = useCallback((lineIndex: number, imageId: string, pdfLayout: QuoteImagePdfLayout) => {
    setFormState((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, index) => index === lineIndex
        ? { ...line, images: line.images.map((image) => image.id === imageId ? { ...image, pdfLayout } : image) }
        : line),
    }))
  }, [])

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
    (index: number, field: 'description' | 'qty' | 'unitPrice' | 'extPrice', value: string) => {
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

  const handleAddDetailsLineImages = useCallback(async (index: number, files: PreparedQuoteImage[]) => {
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
          ? { ...line, images: [...line.images, ...images].slice(0, 2) }
          : line),
      }) : current)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload line picture.')
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

  const handleUpdateDetailsLineImageLayout = useCallback((lineIndex: number, imageId: string, pdfLayout: QuoteImagePdfLayout) => {
    setOpportunityDetailsFormState((current) => current ? ({
      ...current,
      lineItems: current.lineItems.map((line, index) => index === lineIndex
        ? { ...line, images: line.images.map((image) => image.id === imageId ? { ...image, pdfLayout } : image) }
        : line),
    }) : current)
  }, [])

  const handleAddDetailsServiceImages = useCallback(async (
    section: 'additionalServices' | 'shippingServices',
    index: number,
    files: PreparedQuoteImage[],
  ) => {
    if (!opportunityDetailsFormState) return
    setErrorMessage(null)
    setIsUploadingLineImage(true)
    try {
      const images = await uploadLineItemImages(files, opportunityDetailsFormState.quoteNumber, opportunityDetailsFormState.companyName)
      setOpportunityDetailsFormState((current) => current ? ({
        ...current,
        [section]: current[section].map((item, itemIndex) => itemIndex === index
          ? { ...item, images: [...item.images, ...images].slice(0, 2) }
          : item),
      }) : current)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to upload service picture.')
    } finally {
      setIsUploadingLineImage(false)
    }
  }, [opportunityDetailsFormState, uploadLineItemImages])

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
      setSuccessMessage(`Revision ${nextRevisionNumber} created. Add a GLB or SketchUp model when this revision is ready for a public 3D view.`)
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

  const handleCreateOpportunity = useCallback(async () => {
    const dealerSourceId = formState.dealerSourceId.trim()
    const quoteNumber = formState.quoteNumber.trim()
    const opportunityDateInput = formState.opportunityDateInput.trim()
    const pricing = resolveQuotePricing(formState.lineItems, formState.subtotal, formState.freight, 0, formState.additionalServices, formState.shippingServices, formState.discountPercent, formState.discountScope)
    const lineItems = pricing.normalizedLineItems
    const totalAmount = pricing.totalAmount

    setAddOpportunitySubmitAttempted(true)

    if (addOpportunityTotalMissing > 0) {
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

    const title = formState.title.trim() || `${DEFAULT_OPPORTUNITY_TITLE_PREFIX}${quoteNumber}`
    const targetStage: CrmOpportunityStage = 'proposal_submission'
    const targetStatus = isAddDialogDraftFromExcelSync ? 'sent' : 'draft'
    const sentAt = isAddDialogDraftFromExcelSync ? new Date().toISOString() : null

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSavingOpportunity(true)

    try {
      const quoteDocumentUrl = formState.quoteDocumentUrl.trim()
      const quoteDocumentName = formState.quoteDocumentName.trim()
      const sketchupDocumentUrl = formState.sketchupDocumentUrl.trim()
      const sketchupDocumentName = formState.sketchupDocumentName.trim()

      if (selectedAddContactSourceId) {
        await updateCrmContact(selectedAddContactSourceId, {
          name: formState.contactName.trim(),
          primaryEmail: formState.contactEmail.trim(),
          phone: formState.contactPhone.trim() || null,
        })
      }

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
        discountPercent: pricing.discountPercent,
        discountAmount: pricing.discountAmount,
        discountScope: pricing.discountScope,
        discountFreightAmount: pricing.discountFreightAmount,
        freight: pricing.freight,
        freightDescription: formState.freightDescription.trim() || null,
        status: targetStatus,
        opportunityStage: targetStage,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        additionalServices: pricing.normalizedAdditionalServices,
        shippingServices: pricing.normalizedShippingServices,
        origin: formState.origin,
        sourceWorkbookUrl: formState.sourceWorkbookUrl || null,
        sourceWorkbookName: formState.sourceWorkbookName || null,
        convertedPdfUrl: formState.convertedPdfUrl || null,
        convertedPdfName: formState.convertedPdfName || null,
        totalAmount,
        sentAt,
        notes: formState.notes.trim() || null,
        documents: [
          ...(quoteDocumentUrl ? [{ url: quoteDocumentUrl, name: quoteDocumentName || null }] : []),
          ...(formState.sourceWorkbookUrl ? [{ url: formState.sourceWorkbookUrl, name: formState.sourceWorkbookName || null }] : []),
          ...(formState.convertedPdfUrl ? [{ url: formState.convertedPdfUrl, name: formState.convertedPdfName || null }] : []),
          ...(sketchupDocumentUrl ? [{ url: sketchupDocumentUrl, name: sketchupDocumentName || '3D model.glb' }] : []),
        ],
        revisionCount: 0,
      })

      await invalidateOpportunityData()

      const emptyFormState = createEmptyOpportunityForm()

      setSuccessMessage('Opportunity created.')
      setFormState(emptyFormState)
      setAddOpportunityStage(0)
      setAddOpportunitySubmitAttempted(false)
      setDealerSearchInput('')
      setSelectedAddContactSourceId('')
      setAddDialogInitialSnapshot(serializeOpportunityFormState(emptyFormState))
      setIsAddDialogDraftFromExcelSync(false)
      setIsDialogOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create opportunity.')
    } finally {
      setIsSavingOpportunity(false)
    }
  }, [
    addOpportunityTotalMissing,
    formState.additionalServices,
    formState.companyName,
    formState.contactEmail,
    formState.contactName,
    formState.contactPhone,
    formState.convertedPdfName,
    formState.convertedPdfUrl,
    formState.dealerSourceId,
    formState.freight,
    formState.freightDescription,
    formState.leadTime,
    formState.lineItems,
    formState.notes,
    formState.origin,
    formState.opportunityDateInput,
    formState.paymentTerms,
    formState.quoteDocumentName,
    formState.quoteDocumentUrl,
    formState.quoteNumber,
    formState.salesRep,
    formState.sketchupDocumentName,
    formState.sketchupDocumentUrl,
    formState.shippingServices,
    formState.sourceWorkbookName,
    formState.sourceWorkbookUrl,
    formState.subtotal,
    formState.title,
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
    nextForm.includeFreight = Number(quote.freight || 0) > 0 && !convertedKeys.has('freight')
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
    setUploadQuoteActionMenuAnchorEl(null)
    setSelectedOpportunity(null)
    setOpportunityDetailsFormState(null)
    setOpportunityDetailsInitialSnapshot('')
    setSelectedOpportunityDetailsTab('details')
    setSelectedOpportunityNestedFolderPath(null)
    setIsSubmittingConvertOrder(false)
    setBusyQuoteId(null)

    try {
      await runAppProcess({
        label: `Converting ${convertOrderTargetQuote.quoteNumber || convertOrderTargetQuote.title || 'quote'} to order`,
        detail: `Acknowledgement ${acknowledgmentNumber}`,
      }, async () => {
        const selectedProductLines: OrderDocumentLine[] = [
        ...(convertOrderTargetQuote.lineItems || []).filter((item) => convertOrderFormState.selectedLineItemIds.includes(String(item.id || item.itemNumber || ''))).map((item) => ({ id: String(item.id || item.itemNumber || ''), description: item.description || 'Product', qty: item.qty, unitPrice: item.unitPrice, extPrice: Number(item.extPrice || 0), category: 'product' as const })),
        ...(convertOrderTargetQuote.additionalServices || []).filter((item) => convertOrderFormState.selectedAdditionalServiceIds.includes(item.id)).map((item) => ({ id: item.id, description: item.title || item.description || 'Additional service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, extPrice: Number(resolveServiceItemExtPrice(item) || 0), category: 'additional' as const })),
        ]
        const selectedFreightLines: OrderDocumentLine[] = (convertOrderTargetQuote.shippingServices || []).filter((item) => convertOrderFormState.selectedShippingServiceIds.includes(item.id)).map((item) => ({ id: item.id, description: item.title || item.description || 'Freight service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, extPrice: Number(resolveServiceItemExtPrice(item) || 0), category: 'freight' as const }))
        const quoteFreight = convertOrderFormState.includeFreight ? Number(convertOrderTargetQuote.freight || 0) : 0
        if (quoteFreight > 0) selectedFreightLines.push({ id: 'quote-freight', description: convertOrderTargetQuote.freightDescription || 'Freight', qty: 1, unitPrice: quoteFreight, extPrice: quoteFreight, category: 'freight' })
        const productGross = selectedProductLines.reduce((sum, line) => sum + line.extPrice, 0)
        const discountPercent = Math.min(100, Math.max(0, Number(convertOrderTargetQuote.discountPercent || 0)))
        const discountAmount = Number((productGross * (discountPercent / 100)).toFixed(2))
        const productNet = Number((productGross - discountAmount).toFixed(2))
        const freightGross = selectedFreightLines.reduce((sum, line) => sum + line.extPrice, 0)
        const freightDiscountAmount = convertOrderTargetQuote.discountScope === 'products_and_freight'
          ? Number((freightGross * (discountPercent / 100)).toFixed(2))
          : 0
        const freightNet = Number((freightGross - freightDiscountAmount).toFixed(2))
        const documentData = {
          documentDate: poDate,
          companyName: convertOrderTargetQuote.companyName || convertOrderTargetQuote.dealerName || '',
          contactName: convertOrderTargetQuote.contactName || '',
          contactEmail: convertOrderTargetQuote.contactEmail || '',
          contactPhone: convertOrderTargetQuote.contactPhone || '',
          description: convertOrderTargetQuote.description || convertOrderTargetQuote.title || '',
          poNumber: convertOrderFormState.poNumber.trim(),
          projectName: convertOrderTargetQuote.title || '', acknowledgmentNumber,
          leadTime, freightType: convertOrderTargetQuote.freightDescription || selectedFreightLines.map((line) => line.description).join(' / '), shipTo,
          productGross, discountPercent, discountAmount,
          freightGross, freightDiscountAmount,
          productNet, freightNet, grandTotal: productNet + freightNet, depositRequired, depositPercent,
          lines: [...selectedProductLines, ...selectedFreightLines],
        }
        const settings = quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS
        const [confirmationBlob, workOrderBlob, proformaInvoiceBlob] = await Promise.all([
          buildOrderDocumentBlob(documentData, settings),
          buildWorkOrderDocumentBlob(documentData, settings),
          buildProformaInvoiceBlob(documentData, settings),
        ])
        const orderPath = sanitizeStoragePathSegment(acknowledgmentNumber, 'order')
        const generatedAt = Date.now()
        const confirmationRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/order-confirmation-${generatedAt}.pdf`)
        const workOrderRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/work-order-${generatedAt}.pdf`)
        const proformaInvoiceRef = storageRef(firebaseStorage, `crm/orders/${orderPath}/proforma-invoice-${generatedAt}.pdf`)
        await Promise.all([
          uploadBytes(confirmationRef, confirmationBlob, { contentType: 'application/pdf' }),
          uploadBytes(workOrderRef, workOrderBlob, { contentType: 'application/pdf' }),
          uploadBytes(proformaInvoiceRef, proformaInvoiceBlob, { contentType: 'application/pdf' }),
        ])
        const [orderConfirmationUrl, workOrderUrl, proformaInvoiceUrl] = await Promise.all([
          getDownloadURL(confirmationRef),
          getDownloadURL(workOrderRef),
          getDownloadURL(proformaInvoiceRef),
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
      opportunityDetailsFormState.subtotal,
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
        salesRep: opportunityDetailsFormState.salesRep.trim() || null,
        leadTime: opportunityDetailsFormState.leadTime.trim() || null,
        paymentTerms: opportunityDetailsFormState.paymentTerms.trim() || null,
        subtotal: pricing.subtotal,
        discountPercent: pricing.discountPercent,
        discountAmount: pricing.discountAmount,
        discountScope: pricing.discountScope,
        discountFreightAmount: pricing.discountFreightAmount,
        freight: pricing.freight,
        freightDescription: opportunityDetailsFormState.freightDescription.trim() || null,
        opportunityDate: opportunityDateInput || null,
        lineItems,
        additionalServices: pricing.normalizedAdditionalServices,
        shippingServices: pricing.normalizedShippingServices,
        documents: opportunityDetailsFormState.documents,
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
    selectedOpportunity,
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
    return [
      ...(convertOrderTargetQuote.lineItems || []).filter((item) => Number(item.qty ?? 1) !== 0).map((item) => { const id = String(item.id || item.itemNumber || ''); return { key: `line:${id}`, id, group: 'Product', description: item.description || `Item ${item.itemNumber}`, qty: item.qty, unitPrice: item.unitPrice, amount: Number(item.extPrice || 0), field: 'selectedLineItemIds' as const, converted: converted.has(`line:${id}`) } }),
      ...(convertOrderTargetQuote.additionalServices || []).filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0).map((item) => ({ key: `additional:${item.id}`, id: item.id, group: 'Additional Service', description: item.title || item.description || 'Additional service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, amount: Number(resolveServiceItemExtPrice(item) || 0), field: 'selectedAdditionalServiceIds' as const, converted: converted.has(`additional:${item.id}`) })),
      ...(convertOrderTargetQuote.shippingServices || []).filter((item) => Number(resolveServiceItemExtPrice(item) || 0) > 0).map((item) => ({ key: `shipping:${item.id}`, id: item.id, group: 'Freight / Delivery', description: item.title || item.description || 'Freight service', qty: item.qty ?? null, unitPrice: item.unitPrice ?? null, amount: Number(resolveServiceItemExtPrice(item) || 0), field: 'selectedShippingServiceIds' as const, converted: converted.has(`shipping:${item.id}`) })),
      ...(Number(convertOrderTargetQuote.freight || 0) > 0 ? [{ key: 'freight', id: 'freight', group: 'Freight', description: convertOrderTargetQuote.freightDescription || 'Quote freight', qty: 1, unitPrice: Number(convertOrderTargetQuote.freight), amount: Number(convertOrderTargetQuote.freight), field: 'includeFreight' as const, converted: converted.has('freight') }] : []),
    ]
  }, [convertOrderTargetQuote])

  const convertOrderAvailableRows = convertOrderSelectableRows.filter((row) => !row.converted)
  const isConvertOrderRowSelected = (row: typeof convertOrderSelectableRows[number]) => row.field === 'includeFreight'
    ? convertOrderFormState.includeFreight
    : convertOrderFormState[row.field].includes(row.id)
  const convertOrderSelectedRows = convertOrderAvailableRows.filter(isConvertOrderRowSelected)
  const convertOrderProductNet = convertOrderSelectedRows.filter((row) => row.group === 'Product' || row.group === 'Additional Service').reduce((sum, row) => sum + row.amount, 0)
  const convertOrderFreightNet = convertOrderSelectedRows.filter((row) => row.group === 'Freight' || row.group === 'Freight / Delivery').reduce((sum, row) => sum + row.amount, 0)

  if (isLoading && !detailsOnly) {
    return <LoadingPanel loading message="Fetching pipeline opportunities..." />
  }

  return (
    <Stack spacing={1.75}>
      <StatusAlerts
        errorMessage={errorMessage || (queryError instanceof Error ? queryError.message : null)}
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
              helperText="Required. This value becomes the order number on Monday."
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
              placeholder="Search quote #, project, company, or price..."
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

            <Tooltip title="More opportunity actions">
              <span>
                <IconButton
                  size="small"
                  aria-label="More opportunity actions"
                  disabled={!canManage || isSyncingExcelQuote || isUploadingFolderSelection}
                  onClick={handleOpenUploadQuoteActionMenu}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.25 }}
                >
                  <MoreVertRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

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
              <MenuItem
                onClick={() => {
                  handleCloseUploadQuoteActionMenu()
                  navigate('/config?tab=templates')
                }}
              >
                Document Templates
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
        onMarkApproved={handleMarkApproved}
        onMarkFollowedUp={handleMarkFollowedUp}
        onDeclineQuote={handleDeclineQuote}
        onDeleteQuote={handleDeleteQuote}
        onPrintQuote={(quote) => void handlePrintQuote(quote)}
        onOpenDetails={handleOpenOpportunityDetails}
        onOpenChat={handleOpenOpportunityChat}
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

      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: { width: 'min(1440px, 97vw)', height: 'min(920px, 95vh)', borderRadius: 2.5 } }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 0, pt: 1.5 }}>
          <Typography variant="h6" fontWeight={800}>Add Opportunity</Typography>
          <Typography variant="body2" color="text.secondary">
            Build the quote in four stages. You may move ahead with missing fields, but the final quote cannot be submitted until all required information is complete.
          </Typography>
          <Tabs
            value={addOpportunityStage}
            onChange={(_event, value: AddOpportunityStage) => setAddOpportunityStage(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mt: 1 }}
          >
            {ADD_OPPORTUNITY_STAGES.map((stageLabel, index) => {
              const missingCount = addOpportunityMissingByStage[index].length
              const showMissing = addOpportunitySubmitAttempted && missingCount > 0
              return (
                <Tab
                  key={stageLabel}
                  value={index}
                  sx={{ color: showMissing ? 'error.main' : undefined }}
                  label={(
                    <Stack direction="row" spacing={0.6} alignItems="center">
                      <Typography component="span" variant="body2" fontWeight={800}>{index + 1}. {stageLabel}</Typography>
                      {showMissing ? <Typography component="span" color="error" fontWeight={900}>★ Missing Information</Typography> : null}
                    </Stack>
                  )}
                />
              )
            })}
          </Tabs>
        </DialogTitle>

        <DialogContent sx={{ bgcolor: '#f5f8fc', px: { xs: 1.5, md: 2.5 }, py: 2 }}>
          {addOpportunityStage === 0 ? (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    label="Quote Number"
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
                        label="Dealer Account"
                        helperText="Select a saved dealer, or use Add New when there is no match."
                      />
                    )}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    required
                    label="Project Name"
                    value={formState.title}
                    onChange={(event) => setFormState((current) => ({ ...current, title: event.target.value }))}
                    sx={{ flex: 1.4 }}
                  />
                  <TextField
                    select
                    required
                    label="Sales Rep"
                    value={formState.salesRep}
                    onChange={(event) => setFormState((current) => ({ ...current, salesRep: event.target.value }))}
                    sx={{ flex: 1 }}
                  >
                    {excelSyncSalesRepOptions.map((salesRep) => <MenuItem key={salesRep} value={salesRep}>{salesRep}</MenuItem>)}
                  </TextField>
                  <TextField
                    required
                    label="Quote Date"
                    type="date"
                    value={formState.opportunityDateInput}
                    onChange={(event) => setFormState((current) => ({ ...current, opportunityDateInput: event.target.value }))}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 0.8 }}
                  />
                </Stack>

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
                        label="Contact Name"
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
                    label="Contact Email"
                    value={formState.contactEmail}
                    onChange={(event) => setFormState((current) => ({ ...current, contactEmail: event.target.value }))}
                    helperText="Required on every quote."
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    type="tel"
                    label="Contact Phone"
                    value={formState.contactPhone}
                    onChange={(event) => setFormState((current) => ({ ...current, contactPhone: event.target.value }))}
                    sx={{ flex: 0.8 }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                  <TextField
                    required
                    label="Lead Time"
                    value={formState.leadTime}
                    onChange={(event) => setFormState((current) => ({ ...current, leadTime: event.target.value }))}
                    sx={{ flex: 0.7 }}
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.1}>
                <TextField label="Subtotal" value={addPricingPreview.subtotal.toFixed(2)} InputProps={{ readOnly: true, startAdornment: <InputAdornment position="start">$</InputAdornment> }} sx={{ flex: 1 }} />
                <TextField label="Freight" value={addPricingPreview.freight.toFixed(2)} InputProps={{ readOnly: true, startAdornment: <InputAdornment position="start">$</InputAdornment> }} sx={{ flex: 1 }} />
                <TextField
                  label="Discount"
                  value={formState.discountPercent}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === '' || (/^\d{0,3}(?:\.\d{0,2})?$/.test(value) && Number(value) <= 100)) {
                      setFormState((current) => ({ ...current, discountPercent: value }))
                    }
                  }}
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  sx={{ flex: 0.7 }}
                />
              </Stack>
              {formState.discountPercent ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={formState.discountScope}
                  onChange={(_, value: 'products' | 'products_and_freight' | null) => {
                    if (value) setFormState((current) => ({ ...current, discountScope: value }))
                  }}
                  sx={{ alignSelf: 'flex-end' }}
                >
                  <ToggleButton value="products">Products only</ToggleButton>
                  <ToggleButton value="products_and_freight">Products + freight</ToggleButton>
                </ToggleButtonGroup>
              ) : null}
              <Paper variant="outlined" sx={{ px: 1.2, py: 1, borderRadius: 1.5 }}>
                <Stack direction="row" spacing={1} justifyContent="space-between" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2">Product: {formatCurrency(addPricingPreview.grossSubtotal, 2)}</Typography>
                  <Typography variant="body2">Freight: {formatCurrency(addPricingPreview.freight, 2)}</Typography>
                  <Typography variant="body2" fontWeight={800} color="primary">Total: {formatCurrency(addPricingPreview.totalAmount, 2)}</Typography>
                </Stack>
              </Paper>
              <LineItemsEditor
                lineItems={formState.lineItems}
                pdfSettings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                canEdit
                showPdfLayoutAction={false}
                onAddLineItem={handleAddFormLineItem}
                onUpdateLineItem={handleUpdateFormLineItem}
                onRemoveLineItem={handleRemoveFormLineItem}
                onAddImages={(index, files) => void handleAddFormLineImages(index, files)}
                onRemoveImage={handleRemoveFormLineImage}
                onUpdateImageLayout={handleUpdateFormLineImageLayout}
                isUploadingImage={isUploadingLineImage}
              />
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

          {addOpportunityStage === 3 ? (
            <Stack spacing={1.5}>
              {addOpportunitySubmitAttempted && addOpportunityTotalMissing > 0 ? (
                <Alert severity="error">
                  {addOpportunityTotalMissing} required {addOpportunityTotalMissing === 1 ? 'field is' : 'fields are'} missing. Open the red stage tabs to finish them.
                </Alert>
              ) : null}
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
                  <Box>
                    <Typography variant="h6" fontWeight={800}>{formState.title || 'Untitled quote'}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formState.quoteNumber || 'No quote number'} • {formState.companyName || 'No dealer selected'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {normalizeLineItemsForPayload(formState.lineItems).length} quote lines • Total {formatCurrency(addPricingPreview.totalAmount, 2)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button variant="outlined" onClick={() => setIsAddPictureLayoutOpen(true)}>Arrange Pictures</Button>
                    <Button variant="contained" startIcon={<PreviewRoundedIcon />} onClick={() => setQuotePrintPreview(addOpportunityPreviewQuote)}>Preview Final PDF</Button>
                  </Stack>
                </Stack>
              </Paper>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                  <Typography variant="subtitle2" fontWeight={800}>Quote Document (optional)</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" mt={1} flexWrap="wrap" useFlexGap>
                    <Button component="label" size="small" variant="outlined" startIcon={<FileUploadRoundedIcon />} disabled={!canUploadQuoteDocument || isUploadingQuoteDocument}>
                      {isUploadingQuoteDocument ? 'Uploading...' : (formState.quoteDocumentUrl ? 'Replace Document' : 'Upload Document')}
                      <input hidden type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg" onChange={handleQuoteDocumentUpload} />
                    </Button>
                    {formState.quoteDocumentUrl ? <Button component={Link} href={formState.quoteDocumentUrl} target="_blank">Open</Button> : null}
                    {formState.quoteDocumentUrl ? (
                      <Button color="error" onClick={() => setFormState((current) => ({ ...current, quoteDocumentUrl: '', quoteDocumentName: '' }))}>Remove</Button>
                    ) : null}
                  </Stack>
                  {formState.quoteDocumentName ? <Typography variant="caption">{formState.quoteDocumentName}</Typography> : null}
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, flex: 1 }}>
                  <Typography variant="subtitle2" fontWeight={800}>Customer 3D Viewer — GLB or SketchUp File</Typography>
                  <Typography variant="caption" color="text.secondary">
                    For smooth curves without segment lines, upload a GLB exported from SketchUp. You can also attach the original SKP file.
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" mt={1} flexWrap="wrap" useFlexGap>
                    <Button component="label" size="small" variant="outlined" startIcon={<FileUploadRoundedIcon />} disabled={!canUploadQuoteDocument || isUploadingQuoteDocument}>
                      {isUploadingQuoteDocument ? 'Uploading...' : (formState.sketchupDocumentUrl ? 'Replace 3D File' : 'Upload GLB or SKP')}
                      <input hidden type="file" accept=".glb,.skp,model/gltf-binary,application/octet-stream" onChange={handleSketchupDocumentUpload} />
                    </Button>
                    {formState.sketchupDocumentUrl ? <Button component={Link} href={formState.sketchupDocumentUrl} target="_blank">Open</Button> : null}
                    {formState.sketchupDocumentUrl ? (
                      <Button color="error" onClick={() => setFormState((current) => ({ ...current, sketchupDocumentUrl: '', sketchupDocumentName: '' }))}>Remove</Button>
                    ) : null}
                  </Stack>
                  {formState.sketchupDocumentName ? <Typography variant="caption">{formState.sketchupDocumentName}</Typography> : null}
                </Paper>
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', px: 2.5 }}>
          <Button onClick={handleCloseDialog} disabled={isSavingOpportunity || isUploadingQuoteDocument}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          {addOpportunityStage > 0 ? (
            <Button onClick={() => setAddOpportunityStage((addOpportunityStage - 1) as AddOpportunityStage)}>Back</Button>
          ) : null}
          <Typography variant="body2" color={addOpportunityMissingByStage[addOpportunityStage].length ? 'warning.main' : 'text.secondary'}>
            {addOpportunityMissingByStage[addOpportunityStage].length
              ? `${addOpportunityMissingByStage[addOpportunityStage].length} ${addOpportunityMissingByStage[addOpportunityStage].length === 1 ? 'field' : 'fields'} missing`
              : 'All required fields complete'}
          </Typography>
          {addOpportunityStage < 3 ? (
            <Button
              variant="contained"
              onClick={() => setAddOpportunityStage((addOpportunityStage + 1) as AddOpportunityStage)}
            >
              Go to next stage
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={isSavingOpportunity || isUploadingQuoteDocument || !canManage}
              onClick={() => void handleCreateOpportunity()}
            >
              {isSavingOpportunity ? 'Submitting...' : 'Submit'}
            </Button>
          )}
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
              This contact will be saved under {dealersBySourceId.get(formState.dealerSourceId)?.name || 'the selected dealer'} and available on future quotes.
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
      <QuotePicturesPdfLayoutDialog
        open={isAddPictureLayoutOpen}
        lineItems={formState.lineItems}
        quote={addOpportunityPreviewQuote}
        settings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
        onCancel={() => setIsAddPictureLayoutOpen(false)}
        onSave={(layouts) => {
          layouts.forEach(({ lineIndex, imageId, layout }) => {
            handleUpdateFormLineImageLayout(lineIndex, imageId, layout)
          })
          setIsAddPictureLayoutOpen(false)
        }}
      />
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
              !selectedOpportunity
              || isSavingOpportunityDetails
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
            }
            onClick={() => {
              setDetailsActionMenuAnchorEl(null)
              if (selectedOpportunity) void handleMarkFollowedUp(selectedOpportunity)
            }}
          >
            Mark as followed up
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
                  <Button
                    size="small"
                    variant={selectedOpportunityDetailsTab === 'activity' ? 'contained' : 'text'}
                    onClick={() => setSelectedOpportunityDetailsTab('activity')}
                    sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 700 }}
                  >
                    Activity ({Array.isArray(selectedOpportunity.activityLog) ? selectedOpportunity.activityLog.length : 0})
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
                        companyName: resolveDealerQuoteCompanyName(value) || current.companyName,
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
                      label="Dealer Account"
                      helperText={opportunityDetailsFormState.dealerSourceId
                        ? 'This account is linked to the quote.'
                        : 'Select an account before converting this quote to an order.'}
                    />
                  )}
                  disabled={!canManage}
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

                {opportunityDetailsFormState.origin === 'excel' ? (
                  <TextField
                    label="Company Name (from Excel)"
                    value={opportunityDetailsFormState.companyName}
                    onChange={(event) => setOpportunityDetailsFormState((current) => current ? ({ ...current, companyName: event.target.value }) : current)}
                    disabled={!canManage}
                    sx={{ flex: 1 }}
                  />
                ) : null}
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
                  select
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
                >
                  {[...new Set([...excelSyncSalesRepOptions, opportunityDetailsFormState.salesRep].filter(Boolean))].map((salesRep) => <MenuItem key={salesRep} value={salesRep}>{salesRep}</MenuItem>)}
                </TextField>

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
                  label={opportunityDetailsFormState.origin === 'excel' ? 'Sub Net Total' : 'Subtotal (calculated)'}
                  value={opportunityDetailsFormState.origin === 'excel' ? opportunityDetailsFormState.subtotal : (detailsPricingPreview?.subtotal.toFixed(2) || '0.00')}
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
                    readOnly: opportunityDetailsFormState.origin !== 'excel',
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                />

                <TextField
                  label={opportunityDetailsFormState.origin === 'excel' ? 'Freight' : 'Freight (calculated)'}
                  value={opportunityDetailsFormState.origin === 'excel' ? opportunityDetailsFormState.freight : (detailsPricingPreview?.freight.toFixed(2) || '0.00')}
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
                    readOnly: opportunityDetailsFormState.origin !== 'excel',
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                />

                <TextField
                  label="Discount"
                  value={opportunityDetailsFormState.discountPercent}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === '' || (/^\d{0,3}(?:\.\d{0,2})?$/.test(value) && Number(value) <= 100)) {
                      setOpportunityDetailsFormState((current) => current ? ({ ...current, discountPercent: value }) : current)
                    }
                  }}
                  disabled={!canManage}
                  type="text"
                  inputProps={{ inputMode: 'decimal' }}
                  placeholder="0"
                  sx={{ flex: 0.7 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                  helperText="Enter the discount percentage"
                />
              </Stack>
              {opportunityDetailsFormState.discountPercent ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={opportunityDetailsFormState.discountScope}
                  onChange={(_, value: 'products' | 'products_and_freight' | null) => {
                    if (value) {
                      setOpportunityDetailsFormState((current) => current ? ({ ...current, discountScope: value }) : current)
                    }
                  }}
                  disabled={!canManage}
                  sx={{ alignSelf: 'flex-end' }}
                >
                  <ToggleButton value="products">Products only</ToggleButton>
                  <ToggleButton value="products_and_freight">Products + freight</ToggleButton>
                </ToggleButtonGroup>
              ) : null}

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
                      Product: {formatCurrency(detailsPricingPreview.grossSubtotal, 2)}
                    </Typography>
                    {detailsPricingPreview.discountAmount > 0 ? (
                      <Typography variant="caption" sx={{ fontWeight: 800, color: '#b51f2e' }}>
                        Discount ({detailsPricingPreview.discountPercent}%): -{formatCurrency(detailsPricingPreview.discountAmount, 2)}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      Freight: {formatCurrency(detailsPricingPreview.freight, 2)}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#0f4c81' }}>
                      Total: {formatCurrency(detailsPricingPreview.totalAmount, 2)}
                    </Typography>
                  </Stack>
                </Box>
              ) : null}

              <Quote3dModelPanel
                quote={selectedRevisionQuote || selectedOpportunity}
                revisionNumber={selectedRevisionNumber}
                canManage={canManage}
                onChanged={async () => {
                  const response = await fetchCrmQuoteDetails(selectedOpportunity.id)
                  setSelectedOpportunity(response.quote)
                  await quotesQuery.refetch()
                }}
              />

              <LineItemsEditor
                lineItems={opportunityDetailsFormState.lineItems}
                pdfPreviewQuote={selectedOpportunityPrintQuote}
                pdfSettings={quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS}
                canEdit={canManage}
                onAddLineItem={handleAddDetailsLineItem}
                onUpdateLineItem={handleUpdateDetailsLineItem}
                onRemoveLineItem={handleRemoveDetailsLineItem}
                onAddImages={(index, files) => void handleAddDetailsLineImages(index, files)}
                onRemoveImage={handleRemoveDetailsLineImage}
                onUpdateImageLayout={handleUpdateDetailsLineImageLayout}
                isUploadingImage={isUploadingLineImage}
              />

              <QuoteServiceItemsEditor
                heading="Additional Services"
                description="Standard rates are pre-filled. Adjust quantity or unit price only when the project requires it."
                items={opportunityDetailsFormState.additionalServices}
                canEdit={canManage}
                isUploadingImage={isUploadingLineImage}
                onChange={(additionalServices) => setOpportunityDetailsFormState((current) => current ? ({ ...current, additionalServices }) : current)}
                onAddImages={(index, files) => void handleAddDetailsServiceImages('additionalServices', index, files)}
              />

              <QuoteServiceItemsEditor
                heading="Freight, Delivery & Installation"
                description="Add delivery or installation lines with Qty, Unit Price, and Ext values."
                items={opportunityDetailsFormState.shippingServices}
                canEdit={canManage}
                isUploadingImage={isUploadingLineImage}
                onChange={(shippingServices) => setOpportunityDetailsFormState((current) => current ? ({ ...current, shippingServices }) : current)}
                onAddImages={(index, files) => void handleAddDetailsServiceImages('shippingServices', index, files)}
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
                  <Box sx={{ flex: 1 }}>
                    <MentionsInput
                      value={selectedOpportunityChatDraftMarkup}
                      onChange={(_event, nextMarkup, nextPlainText) => {
                        setSelectedOpportunityChatDraftMarkup(nextMarkup)
                        setSelectedOpportunityChatDraft(nextPlainText)
                      }}
                      disabled={!canManage || isSendingSelectedOpportunityChat}
                      placeholder="Add a note. Use @ to tag someone or @all to notify everyone. /refresh also works."
                      style={quoteChatMentionsInputStyle}
                      allowSuggestionsAboveCursor
                    >
                      <Mention
                        trigger="@"
                        markup="@[__display__](__id__)"
                        displayTransform={(_id, display) => `@${display}`}
                        data={quoteChatMentionOptions}
                        appendSpaceOnAdd
                      />
                    </MentionsInput>
                  </Box>

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

              {selectedOpportunityDetailsTab === 'activity' ? (
                <Stack spacing={1.2}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.7}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={800}>Quote Activity</Typography>
                      <Typography variant="body2" color="text.secondary">Tracked link openings and staff follow-ups, newest first.</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`${Math.max(0, Number(selectedOpportunity.linkOpenCount || 0))} link opens`} />
                      {selectedOpportunity.lastLinkOpenedAt ? <Chip size="small" label={`Last opened ${formatQuoteChatTimestamp(selectedOpportunity.lastLinkOpenedAt)}`} /> : null}
                      {selectedOpportunity.lastFollowedUpAt ? <Chip size="small" color="primary" label={`Last follow-up ${formatQuoteChatTimestamp(selectedOpportunity.lastFollowedUpAt)}`} /> : null}
                    </Stack>
                  </Stack>
                  <Paper variant="outlined" sx={{ overflowX: 'auto', borderRadius: 2 }}>
                    <Table size="small" sx={{ minWidth: 1180 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Date and time</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Event</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>IP address</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Approximate location</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Device</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Browser / OS</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Language</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Referring page</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Array.isArray(selectedOpportunity.activityLog) && selectedOpportunity.activityLog.length > 0 ? (
                          [...selectedOpportunity.activityLog]
                            .sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')))
                            .slice(0, 500)
                            .map((activity) => {
                              const location = [activity.location?.city, activity.location?.region, activity.location?.country].filter(Boolean).join(', ')
                              return (
                                <TableRow key={activity.id} hover>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatQuoteChatTimestamp(activity.occurredAt)}</TableCell>
                                  <TableCell>{activity.type === 'public_3d_opened' ? 'Customer 3D link opened' : activity.type === 'follow_up' ? `Follow-up by ${activity.createdByEmail || 'staff'}` : activity.type.replaceAll('_', ' ')}</TableCell>
                                  <TableCell sx={{ fontFamily: 'monospace' }}>{activity.ipAddress || 'Unavailable'}</TableCell>
                                  <TableCell>{location || 'Unavailable'}{activity.location?.coordinates ? <Typography variant="caption" display="block" color="text.secondary">{activity.location.coordinates}</Typography> : null}</TableCell>
                                  <TableCell>{activity.deviceType || 'Unavailable'}</TableCell>
                                  <TableCell>{[activity.browser, activity.operatingSystem].filter(Boolean).join(' / ') || 'Unavailable'}{activity.userAgent ? <Typography variant="caption" display="block" color="text.secondary" sx={{ maxWidth: 280, wordBreak: 'break-word' }}>{activity.userAgent}</Typography> : null}</TableCell>
                                  <TableCell>{activity.acceptLanguage || 'Unavailable'}</TableCell>
                                  <TableCell sx={{ maxWidth: 240, wordBreak: 'break-word' }}>{activity.referrer || 'Direct / unavailable'}</TableCell>
                                </TableRow>
                              )
                            })
                        ) : (
                          <TableRow><TableCell colSpan={8}><Typography color="text.secondary" textAlign="center" sx={{ py: 3 }}>No tracked activity yet.</Typography></TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Paper>
                  <Alert severity="info">Location is approximate and appears only when the hosting network supplies city, region, or country information. It is not GPS data.</Alert>
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
          <ButtonGroup
            variant="contained"
            disabled={
              !canManage
              || isSavingOpportunityDetails
              || isUploadingFolderSelection
              || isSendingSelectedOpportunityChat
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
