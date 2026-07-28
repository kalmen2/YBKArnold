import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded'
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tabs,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mention, MentionsInput } from 'react-mentions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { firebaseStorage } from '../../auth/firebase'
import {
  buildOrderDocumentBlob,
  buildChangeOrderDocumentBlob,
  buildProformaInvoiceBlob,
  buildWorkOrderDocumentBlob,
} from '../../features/crm/OrderConversionDocuments'
import { DEFAULT_QUOTE_PRINT_SETTINGS } from '../../features/crm/NativeQuotePdf'
import { fetchCrmQuotePrintSettings } from '../../features/crm/api'
import {
  createOrderChatMessage,
  fetchOrderChats,
  fetchOrderPhotos,
  fetchOrdersChatUsers,
  fetchOrdersJobDetails,
  postOrdersWarrantyIssueCreate,
  postOrdersWarrantyLeadTimeUpdate,
  postOrdersWarrantyMarkDone,
  postOrdersShopDrawingDelete,
  postOrdersShopDrawingUpload,
  postOrdersCutListDelete,
  postOrdersCutListUpload,
  postOrdersOrderDetailsUpdate,
  postOrdersOrderConfirmationUpdate,
  postOrdersChangeOrderCreate,
  postOrdersShip,
  postOrdersShippingDocumentDelete,
  postOrdersShippingDocumentUpload,
  removeOrderChatMessage,
  postOrdersOrderNumberUpdate,
  type OrdersShippingDocumentType,
  type OrdersCutListDocument,
  type OrdersChatUser,
  type OrdersJobDetailEntry,
  ordersJobDetailsQueryKey,
  ordersChatMessagesQueryKey,
  type OrdersJobDetailsResponse,
  type OrdersOverviewOrder,
  type OrderPhoto,
} from '../../features/orders/api'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDisplayDate,
} from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { sanitizeStoragePathSegment } from '../../lib/fileUtils'
import { resolveBolUrl } from './bolUrl'
import { resolveCutListUrl } from './cutListUrl'
import { resolveShopDrawingUrl } from './shopDrawingUrl'
import { formatProgress } from './utils'

export type JobDetailsMode = 'details' | 'history'

type JobDetailsDialogProps = {
  open: boolean
  mode: JobDetailsMode | null
  order: OrdersOverviewOrder | null
  initialTab?: JobDetailsTab
  onOpenBolDocument: (order: OrdersOverviewOrder) => void
  onOpenShopDrawingDocument: (order: OrdersOverviewOrder) => void
  onOpenCutListDocument: (order: OrdersOverviewOrder) => void
  onOpenInvoiceDocument: (order: OrdersOverviewOrder) => void
  onClose: () => void
}

export type JobDetailsTab = 'hours' | 'shipping' | 'info' | 'pictures' | 'warranty' | 'chat'

function normalizeDateInputValue(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  const matched = normalized.match(/^(\d{4}-\d{2}-\d{2})/)

  return matched ? matched[1] : ''
}

type OrderWarrantyState = {
  issueActive: boolean
  issueDescription: string | null
  issueReportedAt: string | null
  issueLeadTimeDate: string | null
  issueDoneAt: string | null
  lastCompletedDescription: string | null
  lastCompletedReportedAt: string | null
  lastCompletedLeadTimeDate: string | null
  lastCompletedDoneAt: string | null
  lastCompletedDurationDays: number | null
  lastCompletedLeadTimeVarianceDays: number | null
}

function buildOrderWarrantyState(order: OrdersOverviewOrder | null | undefined): OrderWarrantyState {
  const durationDaysRaw = Number(order?.warrantyLastCompletedDurationDays)
  const leadTimeVarianceDaysRaw = Number(order?.warrantyLastCompletedLeadTimeVarianceDays)

  return {
    issueActive: order?.warrantyIssueActive === true,
    issueDescription: String(order?.warrantyIssueDescription ?? '').trim() || null,
    issueReportedAt: String(order?.warrantyIssueReportedAt ?? '').trim() || null,
    issueLeadTimeDate: normalizeDateInputValue(order?.warrantyIssueLeadTimeDate ?? '') || null,
    issueDoneAt: String(order?.warrantyIssueDoneAt ?? '').trim() || null,
    lastCompletedDescription:
      String(order?.warrantyLastCompletedDescription ?? '').trim() || null,
    lastCompletedReportedAt:
      String(order?.warrantyLastCompletedReportedAt ?? '').trim() || null,
    lastCompletedLeadTimeDate:
      normalizeDateInputValue(order?.warrantyLastCompletedLeadTimeDate ?? '') || null,
    lastCompletedDoneAt:
      String(order?.warrantyLastCompletedDoneAt ?? '').trim() || null,
    lastCompletedDurationDays:
      Number.isFinite(durationDaysRaw) ? Number(durationDaysRaw) : null,
    lastCompletedLeadTimeVarianceDays:
      Number.isFinite(leadTimeVarianceDaysRaw) ? Number(leadTimeVarianceDaysRaw) : null,
  }
}

function formatWarrantyVarianceLabel(value: number | null) {
  if (!Number.isFinite(Number(value))) {
    return '—'
  }

  const normalized = Number(value)
  const abs = Math.abs(normalized)
  const dayLabel = `${abs} day${abs === 1 ? '' : 's'}`

  if (normalized === 0) {
    return 'On time'
  }

  return normalized > 0
    ? `${dayLabel} late`
    : `${dayLabel} early`
}

function formatStageLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

  if (!normalized) {
    return 'Unspecified'
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ')
}

function normalizeMentionAlias(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '')
}

function resolveMentionFirstName(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  const source = normalized.includes('@')
    ? normalized.slice(0, normalized.indexOf('@'))
    : normalized
  const alias = normalizeMentionAlias(source)
  const firstToken = alias.split(/[._-]/).find(Boolean) ?? ''

  if (!firstToken) {
    return ''
  }

  return `${firstToken.charAt(0).toUpperCase()}${firstToken.slice(1)}`
}

type MentionSuggestionOption = {
  id: string
  display: string
}

const chatMentionsInputStyle = {
  control: {
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.45,
  },
  '&multiLine': {
    control: {
      minHeight: 84,
      maxHeight: 188,
      border: '1px solid rgba(15, 23, 42, 0.26)',
      borderRadius: 8,
      backgroundColor: '#ffffff',
      overflowY: 'auto',
    },
    highlighter: {
      padding: '10px 12px',
      border: '1px solid transparent',
      boxSizing: 'border-box',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      color: 'transparent',
    },
    input: {
      margin: 0,
      padding: '10px 12px',
      minHeight: 84,
      border: '1px solid transparent',
      outline: 0,
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.45,
      color: '#0f172a',
      backgroundColor: 'transparent',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    },
  },
  suggestions: {
    list: {
      zIndex: 1600,
      backgroundColor: '#ffffff',
      border: '1px solid rgba(15, 23, 42, 0.2)',
      borderRadius: 8,
      boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
      maxHeight: 220,
      overflowY: 'auto',
      padding: '4px',
    },
    item: {
      padding: '0',
    },
  },
} as const

function extractMentionUserUidsFromMarkup(markup: string) {
  const ids = Array.from(String(markup ?? '').matchAll(/@\[[^\]]+\]\(([^)]+)\)/g))
    .map((entry) => String(entry[1] ?? '').trim())
    .filter(Boolean)

  return [...new Set(ids)]
}

function extractMentionAliases(message: string) {
  const aliases = Array.from(String(message ?? '').matchAll(/@([a-zA-Z0-9._-]+)/g))
    .map((entry) => normalizeMentionAlias(entry[1]))
    .filter(Boolean)

  return [...new Set(aliases)]
}

function renderMessageWithMentionPills(message: string) {
  const normalized = String(message ?? '').trim()

  if (!normalized) {
    return '-'
  }

  const segments = normalized.split(/(@[a-zA-Z0-9._-]+)/g)

  return segments.map((segment, index) => {
    if (!/^@[a-zA-Z0-9._-]+$/.test(segment)) {
      return (
        <Box key={`text-${index}`} component="span">
          {segment}
        </Box>
      )
    }

    const label = resolveMentionFirstName(segment.slice(1))

    if (!label) {
      return (
        <Box key={`mention-fallback-${index}`} component="span">
          {segment}
        </Box>
      )
    }

    return (
      <Box
        key={`mention-${index}`}
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: 0.85,
          py: 0.05,
          mx: 0.2,
          borderRadius: 999,
          bgcolor: (theme) => alpha(theme.palette.info.main, 0.18),
          color: (theme) => theme.palette.info.dark,
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        @{label}
      </Box>
    )
  })
}

const shippingUploadSupportedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function inferShippingMimeTypeFromFileName(fileName: string) {
  const normalized = String(fileName ?? '').trim().toLowerCase()

  if (normalized.endsWith('.pdf')) {
    return 'application/pdf'
  }

  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (normalized.endsWith('.png')) {
    return 'image/png'
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalized.endsWith('.heic')) {
    return 'image/heic'
  }

  if (normalized.endsWith('.heif')) {
    return 'image/heif'
  }

  return ''
}

function resolveShippingUploadMimeType(file: File) {
  const fromFile = String(file?.type ?? '').trim().toLowerCase()

  if (shippingUploadSupportedMimeTypes.has(fromFile)) {
    return fromFile
  }

  const fromName = inferShippingMimeTypeFromFileName(file?.name ?? '')

  if (shippingUploadSupportedMimeTypes.has(fromName)) {
    return fromName
  }

  return ''
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = typeof reader.result === 'string'
        ? reader.result
        : ''

      if (!result) {
        reject(new Error('Could not read file data.'))
        return
      }

      resolve(result)
    }

    reader.onerror = () => {
      reject(new Error('Could not read file data.'))
    }

    reader.readAsDataURL(file)
  })
}

type DocumentPreviewMode = 'image' | 'pdf' | 'unsupported'

function toInlinePreviewUrl(url: string | null | undefined) {
  const normalized = String(url ?? '').trim()

  if (!normalized) {
    return ''
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(normalized, 'http://localhost')
  } catch {
    return normalized
  }

  if (!/^\/api\/dashboard\/monday\/.+\/download$/i.test(parsedUrl.pathname)) {
    return normalized
  }

  if (parsedUrl.searchParams.get('inline') !== '1') {
    parsedUrl.searchParams.set('inline', '1')
  }

  const updatedSearch = parsedUrl.searchParams.toString()

  if (/^https?:\/\//i.test(normalized)) {
    const absoluteUrl = new URL(normalized)
    absoluteUrl.search = updatedSearch ? `?${updatedSearch}` : ''
    return absoluteUrl.toString()
  }

  return `${parsedUrl.pathname}${updatedSearch ? `?${updatedSearch}` : ''}${parsedUrl.hash || ''}`
}

function resolveDocumentPreviewMode({
  fileName,
  mimeType,
  url,
}: {
  fileName?: string | null
  mimeType?: string | null
  url?: string | null
}): DocumentPreviewMode {
  const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase()

  if (normalizedMimeType.startsWith('image/')) {
    return 'image'
  }

  if (normalizedMimeType === 'application/pdf') {
    return 'pdf'
  }

  const source = `${String(fileName ?? '').trim()} ${String(url ?? '').trim()}`.toLowerCase()

  if (/\.(png|jpe?g|webp|heic|heif)(\?|#|$)/.test(source)) {
    return 'image'
  }

  if (/\.pdf(\?|#|$)/.test(source)) {
    return 'pdf'
  }

  return 'unsupported'
}

export function JobDetailsDialog({
  open,
  mode,
  order,
  initialTab = 'info',
  onOpenBolDocument,
  onOpenShopDrawingDocument,
  onOpenInvoiceDocument,
  onClose,
}: JobDetailsDialogProps) {
  const { appUser, firebaseUser } = useAuth()
  const queryClient = useQueryClient()
  const enabled = open && Boolean(order?.mondayItemId || order?.jobNumber || order?.orderName)
  const orderChatId = String(order?.id ?? '').trim()
  const orderPhotoId = String(order?.mondayItemId || order?.orderNumber || order?.jobNumber || order?.id || '').trim()
  const orderPhotoDisplayNumber = String(order?.orderNumber || order?.jobNumber || orderPhotoId || '').trim()
  const [detailsTab, setDetailsTab] = useState<JobDetailsTab>('info')
  const [orderNumberDraft, setOrderNumberDraft] = useState('')
  const [chatDraft, setChatDraft] = useState('')
  const [chatDraftMarkup, setChatDraftMarkup] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [deletingChatMessageId, setDeletingChatMessageId] = useState('')
  const [chatActionError, setChatActionError] = useState<string | null>(null)
  const [chatSuccessMessage, setChatSuccessMessage] = useState<string | null>(null)
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderDueDate, setReminderDueDate] = useState('')
  const [reminderRecipientUids, setReminderRecipientUids] = useState<string[]>([])
  const [reminderNote, setReminderNote] = useState('')
  const shopDrawingUploadInputRef = useRef<HTMLInputElement | null>(null)
  const cutListUploadInputRef = useRef<HTMLInputElement | null>(null)
  const signedBolUploadInputRef = useRef<HTMLInputElement | null>(null)
  const customerSignedBolUploadInputRef = useRef<HTMLInputElement | null>(null)
  const customerSignedChangeOrderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const inspectionSheetUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [isShippingDocumentsEditMode, setIsShippingDocumentsEditMode] = useState(false)
  const [shippingUploadInFlightType, setShippingUploadInFlightType] = useState<OrdersShippingDocumentType | ''>('')
  const [shippingDeleteInFlightType, setShippingDeleteInFlightType] = useState<OrdersShippingDocumentType | ''>('')
  const [isShippingOrder, setIsShippingOrder] = useState(false)
  const [shippingActionError, setShippingActionError] = useState<string | null>(null)
  const [shippingActionSuccess, setShippingActionSuccess] = useState<string | null>(null)
  const [uploadedSignedBolUrl, setUploadedSignedBolUrl] = useState<string | null>(null)
  const [uploadedCustomerSignedBolUrl, setUploadedCustomerSignedBolUrl] = useState<string | null>(null)
  const [uploadedInspectionSheetUrl, setUploadedInspectionSheetUrl] = useState<string | null>(null)
  const [uploadedSignedBolName, setUploadedSignedBolName] = useState<string | null>(null)
  const [uploadedCustomerSignedBolName, setUploadedCustomerSignedBolName] = useState<string | null>(null)
  const [uploadedInspectionSheetName, setUploadedInspectionSheetName] = useState<string | null>(null)
  const [signedBolDeletedLocally, setSignedBolDeletedLocally] = useState(false)
  const [customerSignedBolDeletedLocally, setCustomerSignedBolDeletedLocally] = useState(false)
  const [inspectionSheetDeletedLocally, setInspectionSheetDeletedLocally] = useState(false)
  const [isChangeOrderEditorOpen, setIsChangeOrderEditorOpen] = useState(false)
  const [isCreatingChangeOrder, setIsCreatingChangeOrder] = useState(false)
  const [changeOrderDraftLines, setChangeOrderDraftLines] = useState<OrdersOverviewOrder['orderDocumentLines']>([])
  const [changeOrderActionError, setChangeOrderActionError] = useState<string | null>(null)
  const [isUploadingShopDrawing, setIsUploadingShopDrawing] = useState(false)
  const [isDeletingShopDrawing, setIsDeletingShopDrawing] = useState(false)
  const [isUploadingCutList, setIsUploadingCutList] = useState(false)
  const [isDeletingCutList, setIsDeletingCutList] = useState(false)
  const [uploadedShopDrawingUrl, setUploadedShopDrawingUrl] = useState<string | null>(null)
  const [uploadedCutListUrl, setUploadedCutListUrl] = useState<string | null>(null)
  const [uploadedShopDrawingName, setUploadedShopDrawingName] = useState<string | null>(null)
  const [uploadedCutListName, setUploadedCutListName] = useState<string | null>(null)
  const [uploadedCutListDocuments, setUploadedCutListDocuments] = useState<OrdersCutListDocument[] | null>(null)
  const [infoDocumentUploadName, setInfoDocumentUploadName] = useState('')
  const [shopDrawingDeletedLocally, setShopDrawingDeletedLocally] = useState(false)
  const [cutListDeletedLocally, setCutListDeletedLocally] = useState(false)
  const [infoDocumentActionError, setInfoDocumentActionError] = useState<string | null>(null)
  const [infoDocumentActionSuccess, setInfoDocumentActionSuccess] = useState<string | null>(null)
  const [isGeneratingOrderConfirmation, setIsGeneratingOrderConfirmation] = useState(false)
  const [generatedOrderConfirmationUrl, setGeneratedOrderConfirmationUrl] = useState<string | null>(null)
  const [generatedOrderConfirmationName, setGeneratedOrderConfirmationName] = useState<string | null>(null)
  const [generatedWorkOrderUrl, setGeneratedWorkOrderUrl] = useState<string | null>(null)
  const [generatedWorkOrderName, setGeneratedWorkOrderName] = useState<string | null>(null)
  const [generatedProformaInvoiceUrl, setGeneratedProformaInvoiceUrl] = useState<string | null>(null)
  const [generatedProformaInvoiceName, setGeneratedProformaInvoiceName] = useState<string | null>(null)
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState('')
  const [documentPreviewTitle, setDocumentPreviewTitle] = useState('Document Preview')
  const [documentPreviewMode, setDocumentPreviewMode] = useState<DocumentPreviewMode>('unsupported')
  const [isLoadingDocumentPreview, setIsLoadingDocumentPreview] = useState(false)
  const [documentPreviewCollection, setDocumentPreviewCollection] = useState<OrdersCutListDocument[]>([])
  const [documentPreviewIndex, setDocumentPreviewIndex] = useState(0)
  const [isPrintingDocumentPreview, setIsPrintingDocumentPreview] = useState(false)
  const [isLoadingBolPreview, setIsLoadingBolPreview] = useState(false)
  const [selectedOrderPhoto, setSelectedOrderPhoto] = useState<OrderPhoto | null>(null)
  const bolPreviewObjectUrlRef = useRef<string | null>(null)
  const cutListPreviewObjectUrlRef = useRef<string | null>(null)
  const cutListPreviewRequestIdRef = useRef(0)
  const [isManagerEditMode, setIsManagerEditMode] = useState(false)
  const [isSavingManagerEdit, setIsSavingManagerEdit] = useState(false)
  const [managerEditError, setManagerEditError] = useState<string | null>(null)
  const [managerEditSuccess, setManagerEditSuccess] = useState<string | null>(null)
  const [managerEditWarning, setManagerEditWarning] = useState<string | null>(null)
  const [orderNameDraft, setOrderNameDraft] = useState('')
  const [poNumberDraft, setPoNumberDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [benchDraft, setBenchDraft] = useState('')
  const [orderDateDraft, setOrderDateDraft] = useState('')
  const [leadTimeDateDraft, setLeadTimeDateDraft] = useState('')
  const [podDateDraft, setPodDateDraft] = useState('')
  const [warrantyState, setWarrantyState] = useState<OrderWarrantyState>(() => buildOrderWarrantyState(order))
  const [warrantyIssueDescriptionDraft, setWarrantyIssueDescriptionDraft] = useState('')
  const [warrantyLeadTimeDateDraft, setWarrantyLeadTimeDateDraft] = useState('')
  const [isSavingWarrantyIssue, setIsSavingWarrantyIssue] = useState(false)
  const [isSavingWarrantyLeadTime, setIsSavingWarrantyLeadTime] = useState(false)
  const [isMarkingWarrantyDone, setIsMarkingWarrantyDone] = useState(false)
  const [warrantyActionError, setWarrantyActionError] = useState<string | null>(null)
  const quotePrintSettingsQuery = useQuery({
    queryKey: ['crm', 'quote-print-settings'],
    queryFn: fetchCrmQuotePrintSettings,
    enabled: open,
    staleTime: 10 * 60 * 1000,
  })
  const [warrantyActionSuccess, setWarrantyActionSuccess] = useState<string | null>(null)
  const [showWarrantyWorkspace, setShowWarrantyWorkspace] = useState(initialTab === 'warranty')

  const detailsQuery = useQuery<OrdersJobDetailsResponse>({
    queryKey: ordersJobDetailsQueryKey({
      mondayItemId: order?.mondayItemId ?? '',
      jobNumber: order?.jobNumber ?? '',
      orderName: order?.orderName ?? '',
    }),
    queryFn: () => fetchOrdersJobDetails({
      mondayItemId: order?.mondayItemId,
      jobNumber: order?.jobNumber,
      orderName: order?.orderName,
    }),
    enabled,
    staleTime: 60 * 1000,
  })

  const orderPhotosQuery = useQuery({
    queryKey: ['orders', 'photos', orderPhotoId],
    queryFn: () => fetchOrderPhotos(orderPhotoId),
    enabled: open && mode === 'details' && detailsTab === 'pictures' && Boolean(orderPhotoId),
    staleTime: 30 * 1000,
  })

  const chatMessagesQuery = useQuery({
    queryKey: orderChatId
      ? ordersChatMessagesQueryKey(orderChatId)
      : ['orders', 'chat', 'missing-order-id'],
    queryFn: () => fetchOrderChats(orderChatId, {
      limit: 200,
      offset: 0,
    }),
    enabled: open && mode === 'details' && Boolean(orderChatId),
    staleTime: 20 * 1000,
  })

  const chatUsersQuery = useQuery({
    queryKey: ['orders', 'chat-users'],
    queryFn: () => fetchOrdersChatUsers(),
    enabled: open && mode === 'details',
    staleTime: 2 * 60 * 1000,
  })

  useEffect(() => {
    if (!open || mode !== 'details') {
      return
    }

    setDetailsTab(initialTab === 'shipping' ? 'info' : initialTab)
  }, [initialTab, mode, open, order?.id])

  useEffect(() => {
    if (!open || mode !== 'details') {
      return
    }

    setOrderNumberDraft(String(order?.orderNumber ?? '').trim())
    setChatDraft('')
    setChatDraftMarkup('')
    setDeletingChatMessageId('')
    setChatActionError(null)
    setChatSuccessMessage(null)
    setSelectedOrderPhoto(null)
    setReminderEnabled(false)
    setReminderDueDate('')
    setReminderRecipientUids([])
    setReminderNote('')
    setIsShippingDocumentsEditMode(false)
    setShippingUploadInFlightType('')
    setShippingDeleteInFlightType('')
    setIsShippingOrder(false)
    setShippingActionError(null)
    setShippingActionSuccess(null)
    setUploadedSignedBolUrl(null)
    setUploadedCustomerSignedBolUrl(null)
    setUploadedInspectionSheetUrl(null)
    setUploadedSignedBolName(null)
    setUploadedCustomerSignedBolName(null)
    setUploadedInspectionSheetName(null)
    setSignedBolDeletedLocally(false)
    setCustomerSignedBolDeletedLocally(false)
    setInspectionSheetDeletedLocally(false)
    setIsChangeOrderEditorOpen(false)
    setIsCreatingChangeOrder(false)
    setChangeOrderDraftLines([])
    setChangeOrderActionError(null)
    setIsUploadingShopDrawing(false)
    setIsDeletingShopDrawing(false)
    setIsUploadingCutList(false)
    setIsDeletingCutList(false)
    setUploadedShopDrawingUrl(null)
    setUploadedCutListUrl(null)
    setUploadedShopDrawingName(null)
    setUploadedCutListName(null)
    setUploadedCutListDocuments(null)
    setInfoDocumentUploadName('')
    setShopDrawingDeletedLocally(false)
    setCutListDeletedLocally(false)
    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)
    setDocumentPreviewUrl('')
    setDocumentPreviewTitle('Document Preview')
    setDocumentPreviewMode('unsupported')
    setIsLoadingDocumentPreview(false)
    setDocumentPreviewCollection([])
    setDocumentPreviewIndex(0)
    setIsPrintingDocumentPreview(false)
    setIsLoadingBolPreview(false)
    if (bolPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(bolPreviewObjectUrlRef.current)
      bolPreviewObjectUrlRef.current = null
    }
    if (cutListPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(cutListPreviewObjectUrlRef.current)
      cutListPreviewObjectUrlRef.current = null
    }
    cutListPreviewRequestIdRef.current += 1
    setIsManagerEditMode(false)
    setIsSavingManagerEdit(false)
    setManagerEditError(null)
    setManagerEditSuccess(null)
    setManagerEditWarning(null)
    setOrderNameDraft(String(order?.orderName ?? '').trim())
    setPoNumberDraft(String(order?.poNumber ?? '').trim())
    setNotesDraft(String(order?.notes ?? '').trim())
    setDescriptionDraft(String(order?.description ?? '').trim())
    setBenchDraft(String(order?.bench ?? '').trim())
    setOrderDateDraft(normalizeDateInputValue(order?.orderDate ?? ''))
    setLeadTimeDateDraft(normalizeDateInputValue(order?.dueDate ?? ''))
    setPodDateDraft(normalizeDateInputValue(order?.shippedAt ?? ''))
    const nextWarrantyState = buildOrderWarrantyState(order)
    setWarrantyState(nextWarrantyState)
    setShowWarrantyWorkspace(initialTab === 'warranty' || nextWarrantyState.issueActive)
    setWarrantyIssueDescriptionDraft(nextWarrantyState.issueDescription ?? '')
    setWarrantyLeadTimeDateDraft(nextWarrantyState.issueLeadTimeDate ?? '')
    setIsSavingWarrantyIssue(false)
    setIsSavingWarrantyLeadTime(false)
    setIsMarkingWarrantyDone(false)
    setWarrantyActionError(null)
    setWarrantyActionSuccess(null)

    if (shopDrawingUploadInputRef.current) {
      shopDrawingUploadInputRef.current.value = ''
    }

    if (cutListUploadInputRef.current) {
      cutListUploadInputRef.current.value = ''
    }

    if (signedBolUploadInputRef.current) {
      signedBolUploadInputRef.current.value = ''
    }

    if (customerSignedBolUploadInputRef.current) {
      customerSignedBolUploadInputRef.current.value = ''
    }

    if (customerSignedChangeOrderUploadInputRef.current) {
      customerSignedChangeOrderUploadInputRef.current.value = ''
    }

    if (inspectionSheetUploadInputRef.current) {
      inspectionSheetUploadInputRef.current.value = ''
    }
  }, [
    mode,
    open,
    order?.description,
    order?.dueDate,
    order?.id,
    order?.orderDate,
    order?.orderName,
    order?.orderNumber,
    order?.notes,
    order?.poNumber,
    order?.shippedAt,
    order?.warrantyIssueActive,
    order?.warrantyIssueDescription,
    order?.warrantyIssueReportedAt,
    order?.warrantyIssueLeadTimeDate,
    order?.warrantyIssueDoneAt,
    order?.warrantyLastCompletedDescription,
    order?.warrantyLastCompletedReportedAt,
    order?.warrantyLastCompletedLeadTimeDate,
    order?.warrantyLastCompletedDoneAt,
    order?.warrantyLastCompletedDurationDays,
    order?.warrantyLastCompletedLeadTimeVarianceDays,
    initialTab,
  ])

  const label = order?.orderNumber || order?.jobNumber || 'Job'
  const errorMessage = detailsQuery.error instanceof Error ? detailsQuery.error.message : null
  const managerHistory = Array.isArray(detailsQuery.data?.managerHistory)
    ? detailsQuery.data.managerHistory
    : []
  const detailsEntries = Array.isArray(detailsQuery.data?.entries)
    ? detailsQuery.data.entries
    : []
  const currentUserUid = String(appUser?.uid || firebaseUser?.uid || '').trim()
  const currentUserEmail = String(appUser?.email || firebaseUser?.email || '').trim().toLowerCase()
  const isCurrentUserAdmin = appUser?.isAdmin === true
  const chatUsers = chatUsersQuery.data?.users ?? []
  const chatMessages = chatMessagesQuery.data?.messages ?? []
  const combinedChatErrorMessage = chatActionError
    || (chatMessagesQuery.error instanceof Error ? chatMessagesQuery.error.message : null)
    || (chatUsersQuery.error instanceof Error ? chatUsersQuery.error.message : null)

  const mentionAliasToUsers = useMemo<Map<string, OrdersChatUser[]>>(() => {
    const aliasMap = new Map<string, OrdersChatUser[]>()

    chatUsers.forEach((user) => {
      const aliases = new Set<string>([
        normalizeMentionAlias(user.email),
        normalizeMentionAlias(String(user.email ?? '').split('@')[0]),
        normalizeMentionAlias(user.displayName),
        normalizeMentionAlias(resolveMentionFirstName(user.displayName)),
        normalizeMentionAlias(resolveMentionFirstName(user.email)),
      ].filter(Boolean))

      aliases.forEach((alias) => {
        const existingUsers = aliasMap.get(alias) ?? []
        aliasMap.set(alias, [...existingUsers, user])
      })
    })

    return aliasMap
  }, [chatUsers])

  const mentionSuggestionSource = useMemo(() => chatUsers
    .map((user) => {
      const id = String(user.uid ?? '').trim()
      const email = String(user.email ?? '').trim()
      const display = resolveMentionFirstName(user.displayName || user.email)
        || normalizeMentionAlias(email.split('@')[0])
      const normalizedDisplay = normalizeMentionAlias(display)

      return {
        id,
        email,
        display,
        normalizedDisplay,
      }
    })
    .filter((entry) => Boolean(entry.id && entry.normalizedDisplay))
    .sort((left, right) => left.display.localeCompare(right.display)), [chatUsers])

  const mentionEmailByUid = useMemo(
    () => new Map(mentionSuggestionSource.map((entry) => [entry.id, entry.email])),
    [mentionSuggestionSource],
  )

  const loadMentionSuggestions = (
    query: string,
    callback: (items: MentionSuggestionOption[]) => void,
  ) => {
    const normalizedQuery = normalizeMentionAlias(query)

    if (!normalizedQuery) {
      callback([])
      return
    }

    callback(
      mentionSuggestionSource
        .filter((entry) => entry.normalizedDisplay.startsWith(normalizedQuery))
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          display: entry.display,
        })),
    )
  }

  const handleSendChatMessage = async () => {
    const nextMessage = chatDraft.trim()
    const shouldCreateReminder = reminderEnabled
    const reminderHasRequiredFields = Boolean(reminderDueDate && reminderRecipientUids.length > 0)
    const fallbackReminderMessage = reminderNote.trim()
    const finalMessage = nextMessage || (shouldCreateReminder ? fallbackReminderMessage : '')

    if (!orderChatId || !finalMessage) {
      return
    }

    if (shouldCreateReminder && !reminderHasRequiredFields) {
      setChatActionError('Reminder needs a due date and at least one recipient.')
      return
    }

    setChatActionError(null)
    setChatSuccessMessage(null)
    setIsSendingChat(true)

    try {
      const mentionUserUidsFromMarkup = extractMentionUserUidsFromMarkup(chatDraftMarkup)
      const mentionAliases = extractMentionAliases(finalMessage)
      const mentionUserUidsFromAliases = [...new Set(
        mentionAliases.flatMap((alias) => {
          const matchedUsers = mentionAliasToUsers.get(alias) ?? []

          return matchedUsers.length === 1
            ? [matchedUsers[0].uid]
            : []
        }),
      )]
      const mentionUserUids = [...new Set([...mentionUserUidsFromMarkup, ...mentionUserUidsFromAliases])]

      await createOrderChatMessage(orderChatId, {
        message: finalMessage,
        orderNumber: order?.orderNumber ?? null,
        mondayItemId: order?.mondayItemId ?? null,
        orderName: order?.orderName ?? null,
        mentionUserUids,
        reminder: shouldCreateReminder
          ? {
            dueDate: reminderDueDate,
            note: reminderNote.trim() || null,
            targetUserUids: reminderRecipientUids,
          }
          : null,
      })

      setChatDraft('')
      setChatDraftMarkup('')
      setReminderEnabled(false)
      setReminderDueDate('')
      setReminderRecipientUids([])
      setReminderNote('')

      await queryClient.invalidateQueries({ queryKey: ordersChatMessagesQueryKey(orderChatId) })

      if (shouldCreateReminder) {
        setChatSuccessMessage('Chat reminder created. Recipients will get a bell notification on the due date.')
      }
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Failed to send message.')
    } finally {
      setIsSendingChat(false)
    }
  }

  const canManageOrderChatMessage = (message: {
    createdByUid?: string | null
    createdByEmail?: string | null
  }) => {
    if (isCurrentUserAdmin) {
      return true
    }

    const createdByUid = String(message.createdByUid ?? '').trim()
    const createdByEmail = String(message.createdByEmail ?? '').trim().toLowerCase()

    return Boolean(
      (currentUserUid && createdByUid && currentUserUid === createdByUid)
      || (currentUserEmail && createdByEmail && currentUserEmail === createdByEmail),
    )
  }

  const handleDeleteChatMessage = async (messageId: string) => {
    if (!orderChatId || !messageId) {
      return
    }

    if (!window.confirm('Delete this chat message?')) {
      return
    }

    setChatActionError(null)
    setChatSuccessMessage(null)
    setDeletingChatMessageId(messageId)

    try {
      await removeOrderChatMessage(orderChatId, messageId)
      await queryClient.invalidateQueries({ queryKey: ordersChatMessagesQueryKey(orderChatId) })
    } catch (error) {
      setChatActionError(error instanceof Error ? error.message : 'Could not delete chat message.')
    } finally {
      setDeletingChatMessageId('')
    }
  }

  const historyByDate = new Map<string, typeof managerHistory>()
  managerHistory.forEach((row) => {
    const normalizedDate = String(row.date ?? '').trim().slice(0, 10) || 'unknown'
    const rowsForDate = historyByDate.get(normalizedDate)
    if (rowsForDate) {
      rowsForDate.push(row)
      return
    }
    historyByDate.set(normalizedDate, [row])
  })

  const managerReadyByDate = new Map<string, number | null>()
  historyByDate.forEach((rowsForDate, dateKey) => {
    let latestReadyPercent: number | null = null
    let latestUpdatedAtTime = Number.NEGATIVE_INFINITY

    rowsForDate.forEach((row) => {
      const readyPercent = Number(row.readyPercent)

      if (!Number.isFinite(readyPercent)) {
        return
      }

      const updatedAt = String(row.updatedAt ?? '').trim()
      const updatedAtTime = updatedAt ? Date.parse(updatedAt) : Number.NEGATIVE_INFINITY

      if (latestReadyPercent === null || updatedAtTime >= latestUpdatedAtTime) {
        latestReadyPercent = readyPercent
        latestUpdatedAtTime = updatedAtTime
      }
    })

    managerReadyByDate.set(dateKey, latestReadyPercent)
  })

  const hoursByDate = new Map<string, {
    dayTotalHours: number
    workerHours: Map<string, number>
    entries: OrdersJobDetailEntry[]
  }>()
  detailsEntries.forEach((entry) => {
    const normalizedDate = String(entry.date ?? '').trim().slice(0, 10) || 'unknown'
    const parsedHours = Number(entry.totalHours)
    const totalHours = Number.isFinite(parsedHours) ? parsedHours : 0
    const workerLabel = String(entry.workerName ?? '').trim() || 'Unknown worker'

    let bucket = hoursByDate.get(normalizedDate)
    if (!bucket) {
      bucket = {
        dayTotalHours: 0,
        workerHours: new Map<string, number>(),
        entries: [],
      }
      hoursByDate.set(normalizedDate, bucket)
    }

    bucket.dayTotalHours += totalHours
    bucket.entries.push(entry)
    const currentWorkerHours = bucket.workerHours.get(workerLabel) ?? 0
    bucket.workerHours.set(workerLabel, currentWorkerHours + totalHours)
  })

  const dateKeys = Array.from(new Set([
    ...historyByDate.keys(),
    ...hoursByDate.keys(),
  ]))

  const sortedDateKeys = [...dateKeys].sort((a, b) => {
    if (a === 'unknown') {
      return 1
    }
    if (b === 'unknown') {
      return -1
    }
    if (a === b) {
      return 0
    }
    return a > b ? -1 : 1
  })

  const chronologicalDates = [...dateKeys].filter((key) => key !== 'unknown').sort()
  const cumulativeHoursByDate = new Map<string, number>()
  let runningTotalHours = 0
  chronologicalDates.forEach((dateKey) => {
    runningTotalHours += hoursByDate.get(dateKey)?.dayTotalHours ?? 0
    cumulativeHoursByDate.set(dateKey, runningTotalHours)
  })

  const sortedHoursDateKeys = Array.from(hoursByDate.keys()).sort((a, b) => {
    if (a === 'unknown') {
      return 1
    }
    if (b === 'unknown') {
      return -1
    }
    if (a === b) {
      return 0
    }
    return a > b ? -1 : 1
  })

  const workerRows = [...(detailsQuery.data?.workers ?? [])].sort((a, b) => b.totalHours - a.totalHours)
  const maxWorkerHours = workerRows.reduce((maxValue, worker) => Math.max(maxValue, worker.totalHours), 0)

  const stageHoursByLabel = new Map<string, number>()
  detailsEntries.forEach((entry) => {
    const stageLabel = formatStageLabel(entry.stageName)
    const parsedTotalHours = Number(entry.totalHours)
    const totalHours = Number.isFinite(parsedTotalHours) ? parsedTotalHours : 0
    stageHoursByLabel.set(stageLabel, (stageHoursByLabel.get(stageLabel) ?? 0) + totalHours)
  })

  const stageRows = Array.from(stageHoursByLabel.entries())
    .map(([stageLabel, totalHours]) => ({ stageLabel, totalHours }))
    .sort((a, b) => b.totalHours - a.totalHours)
  const maxStageHours = stageRows.reduce((maxValue, stageRow) => Math.max(maxValue, stageRow.totalHours), 0)

  const shipTo = String(order?.shipTo ?? '').trim()
  const shipNotes = String(order?.shipNotes ?? '').trim()
  const documentOrder = detailsQuery.data?.order || order
  const hasMondayItemId = Boolean(String(order?.mondayItemId ?? '').trim())
  const bolUrl = resolveBolUrl(order)
  const bolPreviewUrl = hasMondayItemId
    ? `/api/dashboard/monday/bol/download?orderId=${encodeURIComponent(String(order?.mondayItemId ?? '').trim())}&inline=1`
    : bolUrl
  const shopDrawingUrlFromOrder = resolveShopDrawingUrl(order)
  const cutListUrlFromOrder = resolveCutListUrl(documentOrder)
  const shopDrawingUrl = shopDrawingDeletedLocally
    ? null
    : uploadedShopDrawingUrl || shopDrawingUrlFromOrder || null
  const storedCutListDocuments = Array.isArray(documentOrder?.cutListDocuments)
    ? documentOrder.cutListDocuments.filter((document) => Boolean(String(document?.url ?? '').trim()))
    : []
  const fallbackCutListDocuments: OrdersCutListDocument[] = cutListUrlFromOrder
    ? [{
        fileName: 'cut-list.pdf',
        mimeType: 'application/pdf',
        url: cutListUrlFromOrder,
        uploadedAt: null,
      }]
    : []
  const cutListDocuments = cutListDeletedLocally
    ? []
    : uploadedCutListDocuments
      ?? (storedCutListDocuments.length > 0 ? storedCutListDocuments : fallbackCutListDocuments)
  const cutListUrl = cutListDocuments[0]?.url
    || uploadedCutListUrl
    || null
  const shopDrawingDisplayName = shopDrawingDeletedLocally
    ? null
    : shopDrawingUrl
      ? uploadedShopDrawingName || 'shop-drawing.pdf'
      : null
  const cutListDisplayName = cutListDeletedLocally
    ? null
    : cutListDocuments.length > 1
      ? `${cutListDocuments.length} cut lists`
      : cutListUrl
        ? cutListDocuments[0]?.fileName || uploadedCutListName || 'cut-list.pdf'
      : null
  const invoiceNumber = String(order?.invoiceNumber ?? '').trim()
  const invoicePreviewUrl = String(order?.invoiceCachedUrl ?? '').trim()
  const orderConfirmationUrl = String(
    generatedOrderConfirmationUrl || order?.orderConfirmationUrl || '',
  ).trim()
  const orderConfirmationName = generatedOrderConfirmationName
    || order?.orderConfirmationName
    || 'order-confirmation.pdf'
  const hasPendingChangeOrder = order?.changeOrderStatus === 'awaiting_customer_signature'
    && Number.isFinite(Number(order?.pendingChangeVersion))
  const workOrderUrl = hasPendingChangeOrder
    ? ''
    : String(generatedWorkOrderUrl || order?.workOrderUrl || '').trim()
  const workOrderName = generatedWorkOrderName
    || order?.workOrderName
    || 'work-order.pdf'
  const proformaInvoiceUrl = String(
    generatedProformaInvoiceUrl || order?.proformaInvoiceUrl || '',
  ).trim()
  const proformaInvoiceName = generatedProformaInvoiceName
    || order?.proformaInvoiceName
    || 'proforma-invoice.pdf'
  const hasBolText = Boolean(String(order?.bol ?? '').trim())
  const signedBolUrl = signedBolDeletedLocally
    ? null
    : uploadedSignedBolUrl || String(order?.signedBolUrl ?? '').trim() || null
  const customerSignedBolUrl = customerSignedBolDeletedLocally
    ? null
    : uploadedCustomerSignedBolUrl || String(order?.customerSignedBolUrl ?? '').trim() || null
  const inspectionSheetUrl = inspectionSheetDeletedLocally
    ? null
    : uploadedInspectionSheetUrl || String(order?.inspectionSheetUrl ?? '').trim() || null
  const signedBolDisplayName = signedBolDeletedLocally
    ? null
    : uploadedSignedBolName || String(order?.signedBol ?? '').trim() || null
  const customerSignedBolDisplayName = customerSignedBolDeletedLocally
    ? null
    : uploadedCustomerSignedBolName || String(order?.customerSignedBol ?? '').trim() || null
  const inspectionSheetDisplayName = inspectionSheetDeletedLocally
    ? null
    : uploadedInspectionSheetName || String(order?.inspectionSheet ?? '').trim() || null
  const canOpenBolDocument = Boolean(bolUrl || (hasBolText && hasMondayItemId))
  const hasSignedBolForShipping = Boolean(signedBolUrl)
  const hasCustomerSignedBol = Boolean(customerSignedBolUrl)
  const hasDriverSignedBol = Boolean(signedBolUrl)
  const shouldShowCustomerSignedBol = Boolean(hasDriverSignedBol || hasCustomerSignedBol)
  const customerSignedChangeOrderUrl = String(order?.customerSignedChangeOrderUrl ?? '').trim() || null
  const changeOrderUrl = String(order?.changeOrderUrl ?? '').trim() || null
  const changeOrderVersion = Number(order?.pendingChangeVersion || order?.changeVersion || 0)
  const hasInspectionSheetForShipping = Boolean(inspectionSheetUrl)
  const canShipFromWebsiteFlow = hasSignedBolForShipping && hasInspectionSheetForShipping
  const isUploadingSignedBol = shippingUploadInFlightType === 'signed_bol'
  const isUploadingCustomerSignedBol = shippingUploadInFlightType === 'customer_signed_bol'
  const isUploadingInspectionSheet = shippingUploadInFlightType === 'inspection_sheet'
  const isDeletingSignedBol = shippingDeleteInFlightType === 'signed_bol'
  const isDeletingCustomerSignedBol = shippingDeleteInFlightType === 'customer_signed_bol'
  const isDeletingInspectionSheet = shippingDeleteInFlightType === 'inspection_sheet'
  const isUploadingShippingDocument = Boolean(shippingUploadInFlightType)
  const isDeletingShippingDocument = Boolean(shippingDeleteInFlightType)
  const isUpdatingInfoDocument =
    isUploadingShopDrawing
    || isDeletingShopDrawing
    || isUploadingCutList
    || isDeletingCutList
  const canOpenShopDrawingDocument = Boolean(shopDrawingUrl)
  const canOpenCutListDocument = Boolean(cutListUrl)
  const canOpenInvoiceDocument = Boolean(invoiceNumber)
  const hasMondayRecord = Boolean(order?.hasMondayRecord)
  const canManageOrderMetadata = appUser?.isAdmin === true || appUser?.isManager === true
  const canEditOrderInformation =
    canManageOrderMetadata
    || appUser?.isOfficeWorker === true
  const canManageOrderDocuments = canEditOrderInformation
  const canEditOrderNumber =
    canEditOrderInformation
    && hasMondayRecord
    && Boolean(String(order?.mondayItemId ?? '').trim())
    && order?.hasQuickBooksRecord !== true
  const isWarrantyActionInFlight =
    isSavingWarrantyIssue || isSavingWarrantyLeadTime || isMarkingWarrantyDone
  const canManageWarrantyIssue = Boolean(order?.isShipped && String(order?.mondayItemId ?? '').trim())
  const canCreateWarrantyIssue = canManageWarrantyIssue && !warrantyState.issueActive
  const canUpdateWarrantyLeadTime = canManageWarrantyIssue && warrantyState.issueActive
  const shouldShowWarrantyTab = warrantyState.issueActive || showWarrantyWorkspace

  useEffect(() => {
    setGeneratedOrderConfirmationUrl(null)
    setGeneratedOrderConfirmationName(null)
    setGeneratedWorkOrderUrl(null)
    setGeneratedWorkOrderName(null)
    setGeneratedProformaInvoiceUrl(null)
    setGeneratedProformaInvoiceName(null)
  }, [order?.id])

  const handleGenerateOrderConfirmation = async (override?: {
    lines: OrdersOverviewOrder['orderDocumentLines']
    productNet: number
    freightNet: number
    version?: number
  }) => {
    if (!order || !canEditOrderInformation || isGeneratingOrderConfirmation) {
      return
    }

    const orderKey = String(order.id ?? '').trim()
    const orderNumber = String(order.orderNumber ?? '').trim()

    if (!orderKey || !orderNumber) {
      setInfoDocumentActionError('This order does not have enough identity information to create a confirmation.')
      return
    }

    setIsGeneratingOrderConfirmation(true)
    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)

    try {
      const freightNet = override
        ? Math.max(0, Number(override.freightNet || 0))
        : Number.isFinite(Number(order.freightValue))
        ? Math.max(0, Number(order.freightValue))
        : 0
      const productNet = override
        ? Math.max(0, Number(override.productNet || 0))
        : Number.isFinite(Number(order.productValue))
        ? Math.max(0, Number(order.productValue))
        : Number.isFinite(Number(order.orderValue))
          ? Math.max(0, Number(order.orderValue) - freightNet)
          : 0
      const depositRequired = order.depositRequired !== false
      const depositPercent = depositRequired
        && Number.isFinite(Number(order.depositPercent))
        && Number(order.depositPercent) > 0
        ? Number(order.depositPercent)
        : 50
      const documentName = `Order Confirmation - ${orderNumber}.pdf`
      const effectiveChangeVersion = Number(override?.version ?? order.changeVersion ?? 0)
      const workOrderName = effectiveChangeVersion > 0
        ? `Work Order Change V${effectiveChangeVersion} - ${orderNumber}.pdf`
        : `Work Order - ${orderNumber}.pdf`
      const proformaInvoiceName = `Proforma Invoice - ${orderNumber}.pdf`
      const documentData = {
        changeVersion: override?.version ?? order.changeVersion,
        documentDate: String(order.orderDate ?? '').trim(),
        companyName: String(order.dealerName ?? '').trim(),
        contactName: String(order.contactName ?? '').trim(),
        contactEmail: String(order.contactEmail ?? '').trim(),
        contactPhone: String(order.contactPhone ?? '').trim(),
        description: String(order.description ?? order.orderName ?? '').trim(),
        poNumber: String(order.poNumber ?? '').trim(),
        projectName: String(order.orderName ?? '').trim(),
        acknowledgmentNumber: orderNumber,
        leadTime: String(
          order.leadTime
          || (order.leadTimeDays ? `${order.leadTimeDays} days` : '')
          || order.dueDate
          || '',
        ).trim(),
        freightType: String(order.freightDescription ?? '').trim(),
        shipTo: String(order.shipTo ?? '').trim(),
        productGross: Number(order.productGrossValue || productNet + Number(order.discountAmount || 0)),
        discountPercent: Number(order.discountPercent || 0),
        discountAmount: Number(order.discountAmount || 0),
        productNet,
        freightGross: Number(order.freightGrossValue || freightNet + Number(order.discountFreightAmount || 0)),
        freightDiscountAmount: Number(order.discountFreightAmount || 0),
        freightNet,
        grandTotal: productNet + freightNet,
        depositRequired,
        depositPercent,
        lines: override?.lines
          ?? (Array.isArray(order.orderDocumentLines) ? order.orderDocumentLines : []),
      }
      const settings = quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS
      const [confirmationBlob, workOrderBlob, proformaInvoiceBlob] = await Promise.all([
        buildOrderDocumentBlob(documentData, settings),
        buildWorkOrderDocumentBlob(documentData, settings),
        buildProformaInvoiceBlob(documentData, settings),
      ])
      const orderPath = sanitizeStoragePathSegment(orderNumber, 'order')
      const generatedAt = Date.now()
      const confirmationRef = storageRef(
        firebaseStorage,
        `crm/orders/${orderPath}/order-confirmation-${generatedAt}.pdf`,
      )
      const workOrderRef = storageRef(
        firebaseStorage,
        `crm/orders/${orderPath}/work-order-${generatedAt}.pdf`,
      )
      const proformaInvoiceRef = storageRef(
        firebaseStorage,
        `crm/orders/${orderPath}/proforma-invoice-${generatedAt}.pdf`,
      )
      await Promise.all([
        uploadBytes(confirmationRef, confirmationBlob, { contentType: 'application/pdf' }),
        uploadBytes(workOrderRef, workOrderBlob, { contentType: 'application/pdf' }),
        uploadBytes(proformaInvoiceRef, proformaInvoiceBlob, { contentType: 'application/pdf' }),
      ])
      const [documentUrl, workOrderUrl, proformaInvoiceUrl] = await Promise.all([
        getDownloadURL(confirmationRef),
        getDownloadURL(workOrderRef),
        getDownloadURL(proformaInvoiceRef),
      ])

      await postOrdersOrderConfirmationUpdate({
        orderKey,
        documentUrl,
        documentName,
        workOrderUrl,
        workOrderName,
        proformaInvoiceUrl,
        proformaInvoiceName,
      })

      setGeneratedOrderConfirmationUrl(documentUrl)
      setGeneratedOrderConfirmationName(documentName)
      setGeneratedWorkOrderUrl(workOrderUrl)
      setGeneratedWorkOrderName(workOrderName)
      setGeneratedProformaInvoiceUrl(proformaInvoiceUrl)
      setGeneratedProformaInvoiceName(proformaInvoiceName)
      setInfoDocumentActionSuccess('Order confirmation, work order, and proforma invoice generated.')
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setInfoDocumentActionError(
        error instanceof Error ? error.message : 'Could not generate the order documents.',
      )
    } finally {
      setIsGeneratingOrderConfirmation(false)
    }
  }

  const handleCreateChangeOrder = async () => {
    if (!order || !canEditOrderInformation || isCreatingChangeOrder) return

    const normalizedLines = changeOrderDraftLines
      .map((line) => {
        const qty = Math.max(0, Number(line.qty || 0))
        const unitPrice = Math.max(0, Number(line.unitPrice || 0))
        return {
          ...line,
          description: String(line.description ?? '').trim(),
          qty,
          unitPrice,
          extPrice: Number((qty * unitPrice).toFixed(2)),
        }
      })
      .filter((line) => line.description)

    if (normalizedLines.length === 0) {
      setChangeOrderActionError('Add at least one line with a description.')
      return
    }

    setIsCreatingChangeOrder(true)
    setChangeOrderActionError(null)

    try {
      const productNet = Number(normalizedLines
        .filter((line) => line.category !== 'freight')
        .reduce((sum, line) => sum + line.extPrice, 0)
        .toFixed(2))
      const freightNet = Number(normalizedLines
        .filter((line) => line.category === 'freight')
        .reduce((sum, line) => sum + line.extPrice, 0)
        .toFixed(2))
      const version = Number(order.pendingChangeVersion || order.changeVersion + 1 || 1)
      const orderNumber = String(order.orderNumber ?? '').trim()
      const documentData = {
        documentDate: new Date().toISOString().slice(0, 10),
        companyName: String(order.dealerName ?? '').trim(),
        contactName: String(order.contactName ?? '').trim(),
        contactEmail: String(order.contactEmail ?? '').trim(),
        contactPhone: String(order.contactPhone ?? '').trim(),
        description: String(order.description ?? order.orderName ?? '').trim(),
        poNumber: String(order.poNumber ?? '').trim(),
        projectName: String(order.orderName ?? '').trim(),
        acknowledgmentNumber: orderNumber,
        leadTime: String(order.leadTime || order.dueDate || '').trim(),
        freightType: String(order.freightDescription ?? '').trim(),
        shipTo: String(order.shipTo ?? '').trim(),
        productNet,
        freightNet,
        grandTotal: productNet + freightNet,
        depositRequired: false,
        depositPercent: null,
        lines: normalizedLines,
      }
      const settings = quotePrintSettingsQuery.data?.settings || DEFAULT_QUOTE_PRINT_SETTINGS
      const blob = await buildChangeOrderDocumentBlob(documentData, settings, version)
      const orderPath = sanitizeStoragePathSegment(orderNumber, 'order')
      const documentName = `Change Order V${version} - ${orderNumber}.pdf`
      const documentRef = storageRef(
        firebaseStorage,
        `crm/orders/${orderPath}/change-order-v${version}-${Date.now()}.pdf`,
      )
      await uploadBytes(documentRef, blob, { contentType: 'application/pdf' })
      const changeOrderUrl = await getDownloadURL(documentRef)

      await postOrdersChangeOrderCreate({
        orderKey: order.id,
        mondayItemId: order.mondayItemId,
        orderNumber,
        lines: normalizedLines,
        changeOrderUrl,
        changeOrderName: documentName,
      })

      setIsChangeOrderEditorOpen(false)
      setInfoDocumentActionSuccess(
        `Change Version ${version} created. Upload the customer-signed change order to apply it.`,
      )
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setChangeOrderActionError(
        error instanceof Error ? error.message : 'Could not create the Change Order.',
      )
    } finally {
      setIsCreatingChangeOrder(false)
    }
  }

  const renderInlineDocumentMiniPreview = ({
    url,
    fileName,
    mimeType,
    emptyLabel = 'Preview unavailable',
  }: {
    url: string | null | undefined
    fileName?: string | null
    mimeType?: string | null
    emptyLabel?: string
  }) => {
    const normalizedUrl = toInlinePreviewUrl(url)
    const previewMode = resolveDocumentPreviewMode({
      fileName,
      mimeType,
      url: normalizedUrl,
    })

    if (!normalizedUrl || previewMode === 'unsupported') {
      return (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{
            height: 72,
            borderRadius: 2,
            border: '1px dashed',
            borderColor: 'divider',
            bgcolor: (theme) => alpha(theme.palette.text.primary, 0.025),
            px: 2,
            textAlign: 'center',
          }}
        >
          <CloudOffRoundedIcon sx={{ color: 'text.disabled', fontSize: 34, mb: 0.75 }} />
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
            {emptyLabel}
          </Typography>
        </Stack>
      )
    }

    if (previewMode === 'image') {
      return (
        <Box
          component="img"
          src={normalizedUrl}
          alt={String(fileName ?? '').trim() || 'Attachment preview'}
          sx={{
            width: '100%',
            height: 110,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            objectFit: 'contain',
            display: 'block',
            bgcolor: 'action.hover',
          }}
        />
      )
    }

    return (
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="center"
        spacing={0.75}
        sx={{
          height: 72,
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#ffffff',
          px: 1,
        }}
      >
        <PictureAsPdfRoundedIcon sx={{ color: 'error.main' }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
          PDF loads only when opened
        </Typography>
      </Stack>
    )
  }

  const renderOrderFact = (
    fieldLabel: string,
    value: string | null | undefined,
    options?: {
      fullWidth?: boolean
      multiline?: boolean
      accent?: 'primary' | 'info' | 'warning' | 'success'
    },
  ) => (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: options?.multiline ? '1fr' : { xs: '1fr', sm: '128px minmax(0, 1fr)' },
        alignItems: 'start',
        gap: options?.multiline ? 0.35 : 1,
        py: 0.72,
        gridColumn: options?.fullWidth ? '1 / -1' : undefined,
        minWidth: 0,
        borderBottom: '1px solid',
        borderColor: 'rgba(15, 42, 68, 0.08)',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 850,
          letterSpacing: '0.045em',
          textTransform: 'uppercase',
          color: `${options?.accent || 'primary'}.main`,
          lineHeight: 1.45,
        }}
      >
        {fieldLabel}
      </Typography>
      <Typography
        variant="body1"
        sx={{
          fontWeight: 600,
          fontSize: { xs: '0.88rem', md: '0.91rem' },
          lineHeight: 1.45,
          whiteSpace: options?.multiline ? 'pre-wrap' : 'normal',
          overflowWrap: 'anywhere',
        }}
      >
        {String(value ?? '').trim() || '—'}
      </Typography>
    </Box>
  )

  const renderEditableOrderFact = ({
    label,
    value,
    onChange,
    type = 'text',
    multiline = false,
    disabled = false,
    accent = 'primary',
    helperText,
  }: {
    label: string
    value: string
    onChange: (value: string) => void
    type?: 'text' | 'date'
    multiline?: boolean
    disabled?: boolean
    accent?: 'primary' | 'info' | 'warning' | 'success'
    helperText?: string
  }) => (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: multiline ? '1fr' : { xs: '1fr', sm: '128px minmax(0, 1fr)' },
        alignItems: 'start',
        gap: multiline ? 0.35 : 1,
        py: 0.55,
        minWidth: 0,
        borderBottom: '1px solid',
        borderColor: 'rgba(15, 42, 68, 0.08)',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 850,
          letterSpacing: '0.045em',
          textTransform: 'uppercase',
          color: `${accent}.main`,
          lineHeight: 1.45,
          pt: multiline ? 0 : 0.8,
        }}
      >
        {label}
      </Typography>
      <TextField
        size="small"
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isSavingManagerEdit}
        multiline={multiline}
        minRows={multiline ? 2 : undefined}
        maxRows={multiline ? 5 : undefined}
        helperText={helperText}
        InputLabelProps={type === 'date' ? { shrink: true } : undefined}
        fullWidth
      />
    </Box>
  )

  const renderDocumentCard = ({
    title,
    url,
    fileName,
    available,
    statusText,
    emptyLabel,
    onOpen,
    onUpload,
    onDelete,
    onGenerate,
    generateLabel,
    readOnly = false,
    hidePreviewButton = false,
    controlsDisabled = false,
    uploading = false,
    generating = false,
  }: {
    title: string
    url?: string | null
    fileName?: string | null
    available: boolean
    statusText: string
    emptyLabel: string
    onOpen?: () => void
    onUpload?: () => void
    onDelete?: () => void
    onGenerate?: () => void
    generateLabel?: string
    readOnly?: boolean
    hidePreviewButton?: boolean
    controlsDisabled?: boolean
    uploading?: boolean
    generating?: boolean
  }) => (
    <Paper
      variant="outlined"
      role={available && onOpen ? 'button' : undefined}
      aria-label={`${title}: ${available ? (url ? 'available to preview' : 'available') : 'missing'}`}
      tabIndex={available && onOpen ? 0 : -1}
      onClick={available ? onOpen : undefined}
      onKeyDown={(event) => {
        if (available && onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen()
        }
      }}
      sx={{
        minHeight: 136,
        p: 1.35,
        borderRadius: 2,
        borderColor: available ? 'rgba(28, 82, 128, 0.24)' : 'rgba(15, 42, 68, 0.1)',
        bgcolor: '#ffffff',
        opacity: available ? 1 : 0.72,
        cursor: available && onOpen ? 'pointer' : 'default',
        transition: 'box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease',
        '&:hover': available && onOpen
          ? {
              borderColor: 'primary.light',
              transform: 'translateY(-1px)',
              boxShadow: '0 8px 22px rgba(15, 42, 68, 0.08)',
            }
          : undefined,
      }}
    >
      <Stack spacing={1.1} sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.4,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            color: available ? 'primary.main' : 'text.disabled',
            bgcolor: available
              ? (theme) => alpha(theme.palette.primary.main, 0.1)
              : 'rgba(15, 42, 68, 0.05)',
          }}
        >
          <DescriptionRoundedIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 850, lineHeight: 1.25 }}>
            {title}
          </Typography>
        </Box>
        <Chip
          size="small"
          variant={available || uploading ? 'filled' : 'outlined'}
          color={uploading ? 'info' : available ? 'success' : 'default'}
          icon={uploading
            ? <CircularProgress size={13} color="inherit" />
            : available
              ? <CheckCircleRoundedIcon />
              : undefined}
          label={uploading ? 'Uploading…' : available ? statusText : 'Missing'}
          sx={{ height: 22, fontSize: '0.68rem', fontWeight: 750 }}
        />
        </Stack>
        <Typography
          variant="body2"
          color={available ? 'text.secondary' : 'text.disabled'}
          sx={{
            minHeight: 38,
            lineHeight: 1.4,
            fontWeight: available ? 600 : 650,
            overflowWrap: 'anywhere',
          }}
        >
          {uploading
            ? `Uploading ${infoDocumentUploadName || title}…`
            : available
              ? fileName || statusText
              : emptyLabel}
          {readOnly && available ? ' · Read only' : ''}
        </Typography>
        {uploading ? <LinearProgress sx={{ borderRadius: 999 }} /> : null}
        <Stack
          direction="row"
          spacing={0.45}
          alignItems="center"
          sx={{ mt: 'auto' }}
          onClick={(event) => event.stopPropagation()}
        >
          {available && onOpen && !hidePreviewButton ? (
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityRoundedIcon fontSize="small" />}
              onClick={onOpen}
              sx={{ textTransform: 'none', fontWeight: 750, mr: 'auto' }}
            >
              Preview
            </Button>
          ) : <Box sx={{ flex: 1 }} />}
          {canManageOrderDocuments && onUpload ? (
            <IconButton
              size="small"
              onClick={onUpload}
              disabled={controlsDisabled || isUpdatingInfoDocument || isSavingManagerEdit}
              aria-label={`${available ? 'Replace' : 'Upload'} ${title}`}
            >
              <UploadFileRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {canManageOrderDocuments && available && onDelete ? (
            <IconButton
              size="small"
              color="error"
              onClick={onDelete}
              disabled={controlsDisabled || isUpdatingInfoDocument || isSavingManagerEdit}
              aria-label={`Delete ${title}`}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {canEditOrderInformation && onGenerate ? (
            <Button
              size="small"
              variant={available ? 'text' : 'contained'}
              disabled={controlsDisabled || generating}
              startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <PictureAsPdfRoundedIcon fontSize="small" />}
              onClick={onGenerate}
              sx={{ textTransform: 'none', fontWeight: 800 }}
            >
              {generating ? 'Generating…' : generateLabel || (available ? 'Regenerate' : 'Generate')}
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Paper>
  )

  const resetManagerEditDraftsFromOrder = () => {
    setOrderNameDraft(String(order?.orderName ?? '').trim())
    setPoNumberDraft(String(order?.poNumber ?? '').trim())
    setNotesDraft(String(order?.notes ?? '').trim())
    setDescriptionDraft(String(order?.description ?? '').trim())
    setBenchDraft(String(order?.bench ?? '').trim())
    setOrderDateDraft(normalizeDateInputValue(order?.orderDate ?? ''))
    setLeadTimeDateDraft(normalizeDateInputValue(order?.dueDate ?? ''))
    setPodDateDraft(normalizeDateInputValue(order?.shippedAt ?? ''))
  }

  const handleStartManagerEdit = () => {
    if (!canEditOrderInformation || isSavingManagerEdit) {
      return
    }

    if (!hasMondayRecord || !String(order?.mondayItemId ?? '').trim()) {
      setManagerEditError('Only Monday-linked orders can be edited.')
      return
    }

    setManagerEditError(null)
    setManagerEditSuccess(null)
    setManagerEditWarning(null)
    setIsManagerEditMode(true)
  }

  const handleCancelManagerEdit = () => {
    resetManagerEditDraftsFromOrder()
    setManagerEditError(null)
    setManagerEditWarning(null)
    setIsManagerEditMode(false)
  }

  const handleSaveManagerEdit = async () => {
    if (!order || !isManagerEditMode) {
      return
    }

    if (!canEditOrderInformation) {
      setManagerEditError('Only office workers, managers, and admins can edit these fields.')
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const nextOrderName = String(orderNameDraft ?? '').trim()
    const requestedOrderNumber = String(orderNumberDraft ?? '').trim()
    const currentOrderNumber = String(order.orderNumber ?? '').trim()

    if (!mondayItemId) {
      setManagerEditError('Monday item id is missing for this order.')
      return
    }

    if (!requestedOrderNumber) {
      setManagerEditError('Order number is required.')
      return
    }

    if (!nextOrderName) {
      setManagerEditError('Order name is required.')
      return
    }

    setIsSavingManagerEdit(true)
    setManagerEditError(null)
    setManagerEditSuccess(null)
    setManagerEditWarning(null)

    try {
      let orderNumberWarning: string | null = null

      if (requestedOrderNumber !== currentOrderNumber) {
        const orderNumberResponse = await postOrdersOrderNumberUpdate({
          mondayItemId,
          orderNumber: requestedOrderNumber,
          currentOrderNumber,
        })

        setOrderNumberDraft(String(orderNumberResponse.order.orderNumber ?? '').trim())
        orderNumberWarning = orderNumberResponse.warning ?? null
      }

      const response = await postOrdersOrderDetailsUpdate({
        mondayItemId,
        orderName: nextOrderName,
        poNumber: String(poNumberDraft ?? '').trim(),
        notes: String(notesDraft ?? '').trim(),
        description: String(descriptionDraft ?? '').trim(),
        bench: String(benchDraft ?? '').trim(),
        dueDate: String(leadTimeDateDraft ?? '').trim(),
        podDate: String(podDateDraft ?? '').trim(),
      })

      setOrderNameDraft(String(response.order.orderName ?? '').trim())
      setPoNumberDraft(String(response.order.poNumber ?? '').trim())
      setNotesDraft(String(response.order.notes ?? '').trim())
      setDescriptionDraft(String(response.order.description ?? '').trim())
      setBenchDraft(String(response.order.bench ?? '').trim())
      setLeadTimeDateDraft(normalizeDateInputValue(response.order.dueDate ?? ''))
      setPodDateDraft(normalizeDateInputValue(response.order.podDate ?? ''))
      setManagerEditSuccess('All information updated successfully.')
      setManagerEditWarning(response.warning ?? orderNumberWarning ?? null)
      setIsManagerEditMode(false)

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setManagerEditError(
        error instanceof Error
          ? error.message
          : 'Could not update order details.',
      )
    } finally {
      setIsSavingManagerEdit(false)
    }
  }

  const applyWarrantyOrderPayload = (nextOrder: {
    warrantyIssueActive: boolean
    warrantyIssueDescription: string | null
    warrantyIssueReportedAt: string | null
    warrantyIssueLeadTimeDate: string | null
    warrantyIssueDoneAt: string | null
    warrantyLastCompletedDescription: string | null
    warrantyLastCompletedReportedAt: string | null
    warrantyLastCompletedLeadTimeDate: string | null
    warrantyLastCompletedDoneAt: string | null
    warrantyLastCompletedDurationDays: number | null
    warrantyLastCompletedLeadTimeVarianceDays: number | null
  }) => {
    const nextState: OrderWarrantyState = {
      issueActive: nextOrder.warrantyIssueActive === true,
      issueDescription: String(nextOrder.warrantyIssueDescription ?? '').trim() || null,
      issueReportedAt: String(nextOrder.warrantyIssueReportedAt ?? '').trim() || null,
      issueLeadTimeDate: normalizeDateInputValue(nextOrder.warrantyIssueLeadTimeDate ?? '') || null,
      issueDoneAt: String(nextOrder.warrantyIssueDoneAt ?? '').trim() || null,
      lastCompletedDescription:
        String(nextOrder.warrantyLastCompletedDescription ?? '').trim() || null,
      lastCompletedReportedAt:
        String(nextOrder.warrantyLastCompletedReportedAt ?? '').trim() || null,
      lastCompletedLeadTimeDate:
        normalizeDateInputValue(nextOrder.warrantyLastCompletedLeadTimeDate ?? '') || null,
      lastCompletedDoneAt:
        String(nextOrder.warrantyLastCompletedDoneAt ?? '').trim() || null,
      lastCompletedDurationDays:
        Number.isFinite(Number(nextOrder.warrantyLastCompletedDurationDays))
          ? Number(nextOrder.warrantyLastCompletedDurationDays)
          : null,
      lastCompletedLeadTimeVarianceDays:
        Number.isFinite(Number(nextOrder.warrantyLastCompletedLeadTimeVarianceDays))
          ? Number(nextOrder.warrantyLastCompletedLeadTimeVarianceDays)
          : null,
    }

    setWarrantyState(nextState)
    setWarrantyIssueDescriptionDraft(nextState.issueActive ? (nextState.issueDescription ?? '') : '')
    setWarrantyLeadTimeDateDraft(nextState.issueLeadTimeDate ?? '')
  }

  const handleCreateWarrantyIssue = async () => {
    if (!order || isSavingWarrantyIssue || isSavingWarrantyLeadTime || isMarkingWarrantyDone) {
      return
    }

    if (!order.isShipped) {
      setWarrantyActionError('Warranty issues can only be opened after the order is shipped.')
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const descriptionValue = String(warrantyIssueDescriptionDraft ?? '').trim()
    const leadTimeDateValue = String(warrantyLeadTimeDateDraft ?? '').trim()

    if (!mondayItemId) {
      setWarrantyActionError('Monday item id is missing for this order.')
      return
    }

    if (!descriptionValue) {
      setWarrantyActionError('Issue description is required.')
      return
    }

    if (!leadTimeDateValue) {
      setWarrantyActionError('Warranty lead time is required.')
      return
    }

    setIsSavingWarrantyIssue(true)
    setWarrantyActionError(null)
    setWarrantyActionSuccess(null)

    try {
      const response = await postOrdersWarrantyIssueCreate({
        mondayItemId,
        description: descriptionValue,
        leadTimeDate: leadTimeDateValue,
      })

      applyWarrantyOrderPayload(response.order)
      setWarrantyActionSuccess(
        response.createdOrder
          ? `Warranty order ${response.createdOrder.orderNumber} was created in Orders and linked to ${response.createdOrder.parentOrderNumber}.`
          : 'Warranty order created.',
      )

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setWarrantyActionError(
        error instanceof Error
          ? error.message
          : 'Could not add warranty issue.',
      )
    } finally {
      setIsSavingWarrantyIssue(false)
    }
  }

  const handleSaveWarrantyLeadTime = async () => {
    if (!order || isSavingWarrantyIssue || isSavingWarrantyLeadTime || isMarkingWarrantyDone) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setWarrantyActionError('Monday item id is missing for this order.')
      return
    }

    if (!warrantyState.issueActive) {
      setWarrantyActionError('Open a warranty issue before setting lead time.')
      return
    }

    setIsSavingWarrantyLeadTime(true)
    setWarrantyActionError(null)
    setWarrantyActionSuccess(null)

    try {
      const response = await postOrdersWarrantyLeadTimeUpdate({
        mondayItemId,
        leadTimeDate: String(warrantyLeadTimeDateDraft ?? '').trim() || null,
      })

      applyWarrantyOrderPayload(response.order)
      setWarrantyActionSuccess('Warranty lead time updated.')

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setWarrantyActionError(
        error instanceof Error
          ? error.message
          : 'Could not update warranty lead time.',
      )
    } finally {
      setIsSavingWarrantyLeadTime(false)
    }
  }

  const handleMarkWarrantyDone = async () => {
    if (!order || isSavingWarrantyIssue || isSavingWarrantyLeadTime || isMarkingWarrantyDone) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setWarrantyActionError('Monday item id is missing for this order.')
      return
    }

    if (!warrantyState.issueActive) {
      setWarrantyActionError('No active warranty issue to close.')
      return
    }

    const shouldContinue = window.confirm('Mark this warranty issue as done?')

    if (!shouldContinue) {
      return
    }

    setIsMarkingWarrantyDone(true)
    setWarrantyActionError(null)
    setWarrantyActionSuccess(null)

    try {
      const response = await postOrdersWarrantyMarkDone({ mondayItemId })

      applyWarrantyOrderPayload(response.order)
      setWarrantyActionSuccess('Warranty issue marked as done.')
      setShowWarrantyWorkspace(false)
      setDetailsTab('info')

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setWarrantyActionError(
        error instanceof Error
          ? error.message
          : 'Could not mark warranty issue as done.',
      )
    } finally {
      setIsMarkingWarrantyDone(false)
    }
  }

  const handleUploadShippingDocument = async (
    documentType: OrdersShippingDocumentType,
    file: File,
  ) => {
    if (!order || !canManageOrderDocuments || isUploadingShippingDocument || isDeletingShippingDocument) {
      return
    }

    const mimeType = resolveShippingUploadMimeType(file)

    if (!mimeType) {
      setShippingActionError('Only PDF/JPG/PNG/WEBP/HEIC/HEIF files are supported.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setShippingActionError('File exceeds 10MB limit.')
      return
    }

    setShippingUploadInFlightType(documentType)
    setShippingActionError(null)
    setShippingActionSuccess(null)

    try {
      const fileBase64 = await readFileAsDataUrl(file)
      const response = await postOrdersShippingDocumentUpload({
        orderKey: order.id,
        mondayItemId: order.mondayItemId,
        orderNumber: order.orderNumber,
        documentType,
        fileName: file.name,
        mimeType,
        fileBase64,
      })

      if (documentType === 'signed_bol') {
        setUploadedSignedBolUrl(response.order.signedBolUrl || null)
        setUploadedSignedBolName(response.order.signedBol || file.name)
        setSignedBolDeletedLocally(false)
      } else if (documentType === 'customer_signed_bol') {
        setUploadedCustomerSignedBolUrl(response.order.customerSignedBolUrl || null)
        setUploadedCustomerSignedBolName(response.order.customerSignedBol || file.name)
        setCustomerSignedBolDeletedLocally(false)
      } else if (documentType === 'customer_signed_change_order') {
        const pendingLines = Array.isArray(order.pendingOrderChangeLines)
          ? order.pendingOrderChangeLines
          : []
        const pendingProductNet = Number(order.pendingChangeProductNet || 0)
        const pendingFreightNet = Number(order.pendingChangeFreightNet || 0)

        if (pendingLines.length > 0) {
          await handleGenerateOrderConfirmation({
            lines: pendingLines,
            productNet: pendingProductNet,
            freightNet: pendingFreightNet,
            version: Number(order.pendingChangeVersion || order.changeVersion + 1 || 1),
          })
        }
      } else {
        setUploadedInspectionSheetUrl(response.order.inspectionSheetUrl || null)
        setUploadedInspectionSheetName(response.order.inspectionSheet || file.name)
        setInspectionSheetDeletedLocally(false)
      }

      setShippingActionSuccess(
        `${response.document.label} uploaded${response.order.isShipped ? ' for this shipped order' : ''}.`,
      )

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setShippingActionError(
        error instanceof Error
          ? error.message
          : 'Could not upload shipping document.',
      )
    } finally {
      setShippingUploadInFlightType('')

      if (documentType === 'signed_bol' && signedBolUploadInputRef.current) {
        signedBolUploadInputRef.current.value = ''
      }

      if (documentType === 'customer_signed_bol' && customerSignedBolUploadInputRef.current) {
        customerSignedBolUploadInputRef.current.value = ''
      }

      if (
        documentType === 'customer_signed_change_order'
        && customerSignedChangeOrderUploadInputRef.current
      ) {
        customerSignedChangeOrderUploadInputRef.current.value = ''
      }

      if (documentType === 'inspection_sheet' && inspectionSheetUploadInputRef.current) {
        inspectionSheetUploadInputRef.current.value = ''
      }
    }
  }

  const handleOpenDocumentPreview = ({
    title,
    url,
    fileName,
    mimeType,
    collection,
    collectionIndex = 0,
  }: {
    title: string
    url: string | null | undefined
    fileName?: string | null
    mimeType?: string | null
    collection?: OrdersCutListDocument[]
    collectionIndex?: number
  }) => {
    const normalizedCollection = Array.isArray(collection) ? collection : []
    const safeCollectionIndex = normalizedCollection.length > 0
      ? Math.min(Math.max(collectionIndex, 0), normalizedCollection.length - 1)
      : 0
    const selectedDocument = normalizedCollection[safeCollectionIndex]
    const normalizedUrl = String(url ?? selectedDocument?.url ?? '').trim()
    const previewUrl = toInlinePreviewUrl(normalizedUrl)

    if (!previewUrl) {
      return
    }

    setDocumentPreviewTitle(
      normalizedCollection.length > 1
        ? `${title} · ${safeCollectionIndex + 1} of ${normalizedCollection.length}`
        : title,
    )
    setDocumentPreviewUrl(previewUrl)
    setDocumentPreviewMode(resolveDocumentPreviewMode({
      fileName: selectedDocument?.fileName || fileName,
      mimeType: selectedDocument?.mimeType || mimeType,
      url: previewUrl,
    }))
    setDocumentPreviewCollection(normalizedCollection)
    setDocumentPreviewIndex(safeCollectionIndex)
  }

  const handleOpenCutListPreview = async ({
    collection,
    collectionIndex = 0,
  }: {
    collection: OrdersCutListDocument[]
    collectionIndex?: number
  }) => {
    if (!Array.isArray(collection) || collection.length === 0) {
      return
    }

    const safeCollectionIndex = Math.min(
      Math.max(collectionIndex, 0),
      collection.length - 1,
    )
    const selectedDocument = collection[safeCollectionIndex]
    const mondayItemId = String(order?.mondayItemId ?? '').trim()

    if (!selectedDocument?.url || !mondayItemId) {
      setInfoDocumentActionError('This Cut List is not connected to an order file.')
      return
    }

    let selectedDocumentHost = ''
    try {
      selectedDocumentHost = new URL(selectedDocument.url).hostname.toLowerCase()
    } catch {
      // Relative Arnold URLs are handled by the authenticated preview proxy.
    }
    const isLegacyMondayDocument =
      selectedDocumentHost === 'monday.com'
      || selectedDocumentHost.endsWith('.monday.com')
    const previewSearch = new URLSearchParams(
      isLegacyMondayDocument
        ? { orderId: mondayItemId }
        : {
            mondayItemId,
            documentUrl: selectedDocument.url,
          },
    )
    const sourceUrl = isLegacyMondayDocument
      ? `/api/dashboard/monday/cut-list/download?${previewSearch.toString()}`
      : `/api/orders/monday/cut-list/preview?${previewSearch.toString()}`

    cutListPreviewRequestIdRef.current += 1
    const requestId = cutListPreviewRequestIdRef.current
    setDocumentPreviewTitle(
      collection.length > 1
        ? `Cut List · ${safeCollectionIndex + 1} of ${collection.length}`
        : 'Cut List',
    )
    setDocumentPreviewCollection(collection)
    setDocumentPreviewIndex(safeCollectionIndex)
    setDocumentPreviewMode('unsupported')
    setDocumentPreviewUrl('about:blank')
    setIsLoadingDocumentPreview(true)
    setInfoDocumentActionError(null)

    try {
      const parsedUrl = new URL(sourceUrl, window.location.origin)
      const needsAuthentication =
        parsedUrl.origin === window.location.origin
        && parsedUrl.pathname.startsWith('/api/')
      const token = needsAuthentication
        ? await firebaseUser?.getIdToken()
        : null
      const response = await fetch(sourceUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'Could not load this Cut List preview.')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)

      if (requestId !== cutListPreviewRequestIdRef.current) {
        URL.revokeObjectURL(objectUrl)
        return
      }

      if (cutListPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(cutListPreviewObjectUrlRef.current)
      }
      cutListPreviewObjectUrlRef.current = objectUrl

      handleOpenDocumentPreview({
        title: 'Cut List',
        url: objectUrl,
        fileName: selectedDocument.fileName,
        mimeType: blob.type || selectedDocument.mimeType,
        collection,
        collectionIndex: safeCollectionIndex,
      })
    } catch (error) {
      if (requestId !== cutListPreviewRequestIdRef.current) {
        return
      }

      setInfoDocumentActionError(
        error instanceof Error ? error.message : 'Could not load this Cut List preview.',
      )
      setDocumentPreviewUrl('')
      setDocumentPreviewCollection([])
      setDocumentPreviewIndex(0)
    } finally {
      if (requestId === cutListPreviewRequestIdRef.current) {
        setIsLoadingDocumentPreview(false)
      }
    }
  }

  const handleNavigateDocumentPreview = (direction: -1 | 1) => {
    if (documentPreviewCollection.length < 2) {
      return
    }

    const nextIndex =
      (documentPreviewIndex + direction + documentPreviewCollection.length)
      % documentPreviewCollection.length
    void handleOpenCutListPreview({
      collection: documentPreviewCollection,
      collectionIndex: nextIndex,
    })
  }

  const handleCloseDocumentPreview = () => {
    cutListPreviewRequestIdRef.current += 1
    if (bolPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(bolPreviewObjectUrlRef.current)
      bolPreviewObjectUrlRef.current = null
    }
    if (cutListPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(cutListPreviewObjectUrlRef.current)
      cutListPreviewObjectUrlRef.current = null
    }
    setDocumentPreviewUrl('')
    setDocumentPreviewTitle('Document Preview')
    setDocumentPreviewMode('unsupported')
    setIsLoadingDocumentPreview(false)
    setDocumentPreviewCollection([])
    setDocumentPreviewIndex(0)
  }

  const handleOpenBolPreview = async () => {
    if (!order || isLoadingBolPreview) {
      return
    }

    if (!hasMondayItemId) {
      if (bolUrl) {
        handleOpenDocumentPreview({
          title: 'BOL Preview',
          url: bolUrl,
          fileName: 'bill-of-lading.pdf',
          mimeType: 'application/pdf',
        })
        return
      }

      onOpenBolDocument(order)
      return
    }

    setIsLoadingBolPreview(true)
    setShippingActionError(null)

    try {
      const token = await firebaseUser?.getIdToken()
      const response = await fetch(bolPreviewUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'Could not load the BOL preview.')
      }

      const blob = await response.blob()
      if (bolPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(bolPreviewObjectUrlRef.current)
      }
      const objectUrl = URL.createObjectURL(blob)
      bolPreviewObjectUrlRef.current = objectUrl
      handleOpenDocumentPreview({
        title: 'BOL Preview',
        url: objectUrl,
        fileName: 'bill-of-lading.pdf',
        mimeType: blob.type || 'application/pdf',
      })
    } catch (error) {
      setShippingActionError(
        error instanceof Error ? error.message : 'Could not load the BOL preview.',
      )
    } finally {
      setIsLoadingBolPreview(false)
    }
  }

  const handlePrintDocumentPreview = async () => {
    if (!documentPreviewUrl || isPrintingDocumentPreview) {
      return
    }

    setIsPrintingDocumentPreview(true)

    try {
      const response = await fetch(documentPreviewUrl)

      if (!response.ok) {
        throw new Error('Could not prepare this document for printing.')
      }

      const objectUrl = URL.createObjectURL(await response.blob())
      const printFrame = document.createElement('iframe')
      printFrame.style.position = 'fixed'
      printFrame.style.width = '1px'
      printFrame.style.height = '1px'
      printFrame.style.right = '0'
      printFrame.style.bottom = '0'
      printFrame.style.border = '0'
      printFrame.src = objectUrl

      const cleanUp = () => {
        URL.revokeObjectURL(objectUrl)
        printFrame.remove()
        setIsPrintingDocumentPreview(false)
      }

      printFrame.onload = () => {
        const printWindow = printFrame.contentWindow

        if (!printWindow) {
          cleanUp()
          return
        }

        printWindow.onafterprint = cleanUp
        printWindow.focus()
        printWindow.print()
        window.setTimeout(cleanUp, 60_000)
      }

      document.body.appendChild(printFrame)
    } catch (error) {
      setInfoDocumentActionError(
        error instanceof Error ? error.message : 'Could not print this document.',
      )
      setIsPrintingDocumentPreview(false)
    }
  }

  const handleDeleteShippingDocument = async (documentType: OrdersShippingDocumentType) => {
    if (!order || !canManageOrderDocuments || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setShippingActionError('Monday item id is missing for this order.')
      return
    }

    const shouldContinue = window.confirm(
      documentType === 'signed_bol'
        ? 'Delete Driver Signed BOL from this order?'
        : documentType === 'customer_signed_bol'
          ? 'Delete Customer Signed BOL from this order?'
          : 'Delete Inspection Sheet from this order?',
    )

    if (!shouldContinue) {
      return
    }

    setShippingDeleteInFlightType(documentType)
    setShippingActionError(null)
    setShippingActionSuccess(null)

    try {
      const response = await postOrdersShippingDocumentDelete({
        orderKey: order.id,
        mondayItemId: order.mondayItemId,
        orderNumber: order.orderNumber,
        documentType,
      })

      const nextSignedBolUrl = response.order.signedBolUrl || null
      const nextCustomerSignedBolUrl = response.order.customerSignedBolUrl || null
      const nextInspectionSheetUrl = response.order.inspectionSheetUrl || null

      setUploadedSignedBolUrl(nextSignedBolUrl)
      setUploadedSignedBolName(response.order.signedBol || null)
      setSignedBolDeletedLocally(!nextSignedBolUrl)

      setUploadedCustomerSignedBolUrl(nextCustomerSignedBolUrl)
      setUploadedCustomerSignedBolName(response.order.customerSignedBol || null)
      setCustomerSignedBolDeletedLocally(!nextCustomerSignedBolUrl)

      setUploadedInspectionSheetUrl(nextInspectionSheetUrl)
      setUploadedInspectionSheetName(response.order.inspectionSheet || null)
      setInspectionSheetDeletedLocally(!nextInspectionSheetUrl)

      setShippingActionSuccess(`${response.document.label} deleted.`)

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setShippingActionError(
        error instanceof Error
          ? error.message
          : 'Could not delete shipping document.',
      )
    } finally {
      setShippingDeleteInFlightType('')
    }
  }

  const handleUploadInfoDocument = async (
    documentType: 'shop_drawing' | 'cut_list',
    file: File,
  ) => {
    if (!order || !canManageOrderDocuments || isUpdatingInfoDocument || isSavingManagerEdit) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setInfoDocumentActionError('Monday item id is missing for this order.')
      return
    }

    const mimeType = resolveShippingUploadMimeType(file)

    if (!mimeType) {
      setInfoDocumentActionError('Only PDF/JPG/PNG/WEBP/HEIC/HEIF files are supported.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setInfoDocumentActionError('File exceeds 10MB limit.')
      return
    }

    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)
    setInfoDocumentUploadName(file.name)

    if (documentType === 'shop_drawing') {
      setIsUploadingShopDrawing(true)
    } else {
      setIsUploadingCutList(true)
    }

    try {
      const fileBase64 = await readFileAsDataUrl(file)

      if (documentType === 'shop_drawing') {
        const response = await postOrdersShopDrawingUpload({
          mondayItemId,
          fileName: file.name,
          mimeType,
          fileBase64,
        })
        const nextUrl = String(response.order.shopDrawingCachedUrl ?? '').trim()
          || String(response.order.shopDrawingUrl ?? '').trim()
          || null

        setUploadedShopDrawingUrl(nextUrl)
        setUploadedShopDrawingName(response.document?.fileName || file.name)
        setShopDrawingDeletedLocally(!nextUrl)
        setInfoDocumentActionSuccess('Shop drawing updated.')

        if (response.warning) {
          setInfoDocumentActionError(response.warning)
        }
      } else {
        const response = await postOrdersCutListUpload({
          mondayItemId,
          fileName: file.name,
          mimeType,
          fileBase64,
        })
        const nextUrl = String(response.order.cutListCachedUrl ?? '').trim()
          || String(response.order.cutListUrl ?? '').trim()
          || null

        setUploadedCutListUrl(nextUrl)
        setUploadedCutListName(response.document?.fileName || file.name)
        setUploadedCutListDocuments(
          Array.isArray(response.order.cutListDocuments)
            ? response.order.cutListDocuments
            : null,
        )
        setCutListDeletedLocally(!nextUrl)
        const savedCutListCount = response.order.cutListDocuments?.length || 1
        setInfoDocumentActionSuccess(
          `${savedCutListCount} cut list${savedCutListCount === 1 ? '' : 's'} saved.`,
        )

        if (response.warning) {
          setInfoDocumentActionError(response.warning)
        }
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setInfoDocumentActionError(
        error instanceof Error
          ? error.message
          : `Could not update ${documentType === 'shop_drawing' ? 'shop drawing' : 'cut list'}.`,
      )
    } finally {
      if (documentType === 'shop_drawing') {
        setIsUploadingShopDrawing(false)
        if (shopDrawingUploadInputRef.current) {
          shopDrawingUploadInputRef.current.value = ''
        }
      } else {
        setIsUploadingCutList(false)
        if (cutListUploadInputRef.current) {
          cutListUploadInputRef.current.value = ''
        }
      }
      setInfoDocumentUploadName('')
    }
  }

  const handleDeleteInfoDocument = async (documentType: 'shop_drawing' | 'cut_list') => {
    if (!order || !canManageOrderDocuments || isUpdatingInfoDocument || isSavingManagerEdit) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setInfoDocumentActionError('Monday item id is missing for this order.')
      return
    }

    const shouldContinue = window.confirm(
      documentType === 'shop_drawing'
        ? 'Delete this shop drawing from website and Monday?'
        : 'Delete this cut list from website and Monday?',
    )

    if (!shouldContinue) {
      return
    }

    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)

    if (documentType === 'cut_list') {
      const previousDocuments = [...cutListDocuments]
      const previousUrl = cutListUrl
      const previousName = cutListDisplayName

      setUploadedCutListDocuments([])
      setUploadedCutListUrl(null)
      setUploadedCutListName(null)
      setCutListDeletedLocally(true)
      setInfoDocumentActionSuccess('Cut list removed. Deletion is running in the background.')

      void postOrdersCutListDelete({
        mondayItemId,
        orderNumber: order.orderNumber,
      })
        .then((response) => {
          const nextDocuments = Array.isArray(response.order.cutListDocuments)
            ? response.order.cutListDocuments
            : []
          const nextUrl =
            String(response.order.cutListCachedUrl ?? '').trim()
            || String(response.order.cutListUrl ?? '').trim()
            || null

          setUploadedCutListDocuments(nextDocuments)
          setUploadedCutListUrl(nextUrl)
          setCutListDeletedLocally(nextDocuments.length === 0 && !nextUrl)
          setInfoDocumentActionSuccess('Cut list deleted.')

          if (response.warning) {
            setInfoDocumentActionError(response.warning)
          }
        })
        .catch((error) => {
          setUploadedCutListDocuments(previousDocuments)
          setUploadedCutListUrl(previousUrl)
          setUploadedCutListName(previousName)
          setCutListDeletedLocally(false)
          setInfoDocumentActionSuccess(null)
          setInfoDocumentActionError(
            error instanceof Error ? error.message : 'Could not delete cut list.',
          )
        })
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
          void queryClient.invalidateQueries({
            queryKey: ordersJobDetailsQueryKey({
              mondayItemId: order?.mondayItemId ?? '',
              jobNumber: order?.jobNumber ?? '',
              orderName: order?.orderName ?? '',
            }),
          })
        })

      return
    }

    setIsDeletingShopDrawing(true)

    try {
      const response = await postOrdersShopDrawingDelete({ mondayItemId })
      const nextUrl = String(response.order.shopDrawingCachedUrl ?? '').trim()
        || String(response.order.shopDrawingUrl ?? '').trim()
        || null

      setUploadedShopDrawingUrl(nextUrl)
      setUploadedShopDrawingName(null)
      setShopDrawingDeletedLocally(!nextUrl)
      setInfoDocumentActionSuccess('Shop drawing deleted.')

      if (response.warning) {
        setInfoDocumentActionError(response.warning)
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setInfoDocumentActionError(
        error instanceof Error
          ? error.message
          : 'Could not delete shop drawing.',
      )
    } finally {
      setIsDeletingShopDrawing(false)
    }
  }

  const handleDeleteCurrentCutList = async () => {
    if (
      !order
      || !canManageOrderDocuments
      || isDeletingCutList
      || documentPreviewCollection.length === 0
    ) {
      return
    }

    const currentDocument = documentPreviewCollection[documentPreviewIndex]
    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!currentDocument || !mondayItemId) {
      return
    }

    const shouldContinue = window.confirm(
      `Delete “${currentDocument.fileName}”? The other cut lists will remain.`,
    )

    if (!shouldContinue) {
      return
    }

    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)

    const previousDocuments = [...documentPreviewCollection]
    const previousUrl = cutListUrl
    const previousName = cutListDisplayName
    const optimisticDocuments = previousDocuments.filter(
      (document) => document.url !== currentDocument.url,
    )
    const optimisticUrl = optimisticDocuments[0]?.url || null

    setUploadedCutListDocuments(optimisticDocuments)
    setUploadedCutListUrl(optimisticUrl)
    setUploadedCutListName(null)
    setCutListDeletedLocally(optimisticDocuments.length === 0)
    setInfoDocumentActionSuccess('Cut list removed. Deletion is running in the background.')

    if (optimisticDocuments.length === 0) {
      handleCloseDocumentPreview()
    } else {
      const nextIndex = Math.min(documentPreviewIndex, optimisticDocuments.length - 1)
      void handleOpenCutListPreview({
        collection: optimisticDocuments,
        collectionIndex: nextIndex,
      })
    }

    void postOrdersCutListDelete({
        mondayItemId,
        documentUrl: currentDocument.url,
        orderNumber: order.orderNumber,
        fileName: currentDocument.fileName,
      })
      .then((response) => {
      const nextDocuments = Array.isArray(response.order.cutListDocuments)
        ? response.order.cutListDocuments
        : []
      const nextUrl =
        String(response.order.cutListCachedUrl ?? '').trim()
        || String(response.order.cutListUrl ?? '').trim()
        || null

      setUploadedCutListDocuments(nextDocuments)
      setUploadedCutListUrl(nextUrl)
      setUploadedCutListName(null)
      setCutListDeletedLocally(nextDocuments.length === 0)
      setInfoDocumentActionSuccess(
        nextDocuments.length > 0
          ? `Cut list deleted. ${nextDocuments.length} remaining.`
          : 'Cut list deleted.',
      )

        if (response.warning) {
          setInfoDocumentActionError(response.warning)
        }
      })
      .catch((error) => {
        setUploadedCutListDocuments(previousDocuments)
        setUploadedCutListUrl(previousUrl)
        setUploadedCutListName(previousName)
        setCutListDeletedLocally(false)
        setInfoDocumentActionSuccess(null)
        setInfoDocumentActionError(
          error instanceof Error ? error.message : 'Could not delete this cut list.',
        )
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
        void queryClient.invalidateQueries({
          queryKey: ordersJobDetailsQueryKey({
            mondayItemId: order?.mondayItemId ?? '',
            jobNumber: order?.jobNumber ?? '',
            orderName: order?.orderName ?? '',
          }),
        })
      })
  }

  const handleShipOrder = async () => {
    if (!order || isShippingOrder || isUploadingShippingDocument || isDeletingShippingDocument) {
      return
    }

    setShippingActionError(null)
    setShippingActionSuccess(null)

    if (order.isShipped) {
      setShippingActionError('Order is already shipped. You can still upload shipping documents.')
      return
    }

    if (!canShipFromWebsiteFlow) {
      setShippingActionError('Upload Driver Signed BOL and Inspection Sheet before shipping.')
      return
    }

    const shouldContinue = window.confirm(
      'Ship this order now? It will move from Order Track to Shipped in Monday.',
    )

    if (!shouldContinue) {
      return
    }

    setIsShippingOrder(true)

    try {
      const response = await postOrdersShip({
        orderKey: order.id,
        mondayItemId: order.mondayItemId,
        orderNumber: order.orderNumber,
      })

      setShippingActionSuccess(
        response.move.mappingMode === 'best_match_fallback'
          ? 'Order moved to Shipped with Monday best-match mapping fallback.'
          : 'Order moved to Shipped with Monday column mapping.',
      )

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      await queryClient.invalidateQueries({
        queryKey: ordersJobDetailsQueryKey({
          mondayItemId: order?.mondayItemId ?? '',
          jobNumber: order?.jobNumber ?? '',
          orderName: order?.orderName ?? '',
        }),
      })
    } catch (error) {
      setShippingActionError(
        error instanceof Error
          ? error.message
          : 'Could not ship this order.',
      )
    } finally {
      setIsShippingOrder(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          height: { xs: '96vh', md: '92vh' },
          maxHeight: { xs: '96vh', md: '92vh' },
          borderRadius: { xs: 2, md: 2.5 },
          bgcolor: '#f7f9fc',
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle
        sx={{
          py: { xs: 1.3, md: 1.65 },
          px: { xs: 1.75, md: 2.5 },
          borderBottom: '1px solid',
          borderColor: 'rgba(15, 42, 68, 0.1)',
          bgcolor: '#ffffff',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" spacing={2}>
          <Stack spacing={0.35} sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="primary.main"
              sx={{ fontWeight: 900, letterSpacing: '0.12em', lineHeight: 1.2 }}
            >
              {mode === 'history' ? 'Production history' : 'Order workspace'}
            </Typography>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 850,
                fontSize: { xs: '1.25rem', md: '1.45rem' },
                lineHeight: 1.2,
              }}
            >
              {label}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
              {order?.orderName ? (
                <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {order.orderName}
                </Typography>
              ) : null}
              {order?.isShipped ? <Chip size="small" color="success" label="Shipped" /> : null}
              {warrantyState.issueActive ? <Chip size="small" color="warning" label="Warranty in progress" /> : null}
            </Stack>
            {order?.parentOrderNumber ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Linked to order {order.parentOrderNumber} · QuickBooks activity uses that order's project
              </Typography>
            ) : null}
          </Stack>
          {mode !== 'history' ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: appUser?.canViewOrderValue
                  ? 'repeat(3, minmax(110px, 1fr))'
                  : 'minmax(120px, 1fr)',
                border: '1px solid',
                borderColor: 'rgba(15, 42, 68, 0.1)',
                borderRadius: 1.75,
                overflow: 'hidden',
                bgcolor: '#fbfcfe',
                flexShrink: 0,
              }}
            >
              {[
                {
                  label: 'Progress',
                  value: Number.isFinite(Number(order?.managerReadyPercent))
                    ? `${Number(order?.managerReadyPercent).toFixed(0)}%`
                    : '—',
                },
                ...(appUser?.canViewOrderValue
                  ? [
                      {
                        label: 'Order Value',
                        value: order?.orderValue !== null
                          && order?.orderValue !== undefined
                          && Number.isFinite(Number(order.orderValue))
                          ? formatCurrency(Number(order.orderValue), 2)
                          : '—',
                      },
                      {
                        label: 'Freight Value',
                        value: order?.freightValue !== null
                          && order?.freightValue !== undefined
                          && Number.isFinite(Number(order.freightValue))
                          ? formatCurrency(Number(order.freightValue), 2)
                          : '—',
                      },
                    ]
                  : []),
              ].map((metric, index) => (
                <Box
                  key={metric.label}
                  sx={{
                    px: 1.35,
                    py: 0.8,
                    minWidth: 0,
                    borderLeft: index > 0 ? '1px solid rgba(15, 42, 68, 0.1)' : 'none',
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 750 }}>
                    {metric.label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 850 }} noWrap>
                    {metric.value}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent
        sx={{
          overflowY: 'auto',
          pt: 0,
          pb: 1.25,
          px: { xs: 1.5, md: 2.5 },
        }}
      >
        {mode === 'history' ? (
          detailsQuery.isLoading ? (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Loading details...</Typography>
            </Stack>
          ) : errorMessage ? (
            <Alert severity="error">{errorMessage}</Alert>
          ) : !detailsQuery.data ? (
            <Alert severity="info">No details available.</Alert>
          ) : (
          sortedDateKeys.length === 0 ? (
            <Alert severity="info">No manager status history found for this job yet.</Alert>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 0.75 }}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={`Days tracked: ${sortedDateKeys.length}`}
                  variant="outlined"
                />
                <Chip
                  label={`Total hours overall: ${detailsQuery.data.summary.totalHours.toFixed(2)}`}
                  color="primary"
                  variant="outlined"
                />
              </Stack>

              {sortedDateKeys.map((dateKey, index) => {
                const historyRows = historyByDate.get(dateKey) ?? []
                const dayHoursBucket = hoursByDate.get(dateKey)
                const dayHours = dayHoursBucket?.dayTotalHours ?? 0
                const cumulativeHours = dateKey === 'unknown'
                  ? detailsQuery.data.summary.totalHours
                  : (cumulativeHoursByDate.get(dateKey) ?? detailsQuery.data.summary.totalHours)
                const workerBreakdown = dayHoursBucket
                  ? Array.from(dayHoursBucket.workerHours.entries()).sort((a, b) => b[1] - a[1])
                  : []
                const dateLabel = dateKey === 'unknown' ? 'Unknown date' : formatDate(dateKey)

                return (
                  <Accordion key={dateKey} defaultExpanded={index === 0} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                        <Typography variant="subtitle2" fontWeight={800}>{dateLabel}</Typography>
                        <Chip size="small" label={`Updates: ${historyRows.length}`} variant="outlined" />
                        <Chip size="small" label={`Day hours: ${dayHours.toFixed(2)}`} color="primary" variant="outlined" />
                        <Chip size="small" label={`Total through day: ${cumulativeHours.toFixed(2)}`} variant="outlined" />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0.5 }}>
                      {historyRows.length === 0 ? (
                        <Alert severity="info" sx={{ mb: workerBreakdown.length > 0 ? 1 : 0 }}>
                          No manager status updates saved for this day.
                        </Alert>
                      ) : (
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Ready %</TableCell>
                                <TableCell>Updated</TableCell>
                                <TableCell>Job Name</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {historyRows.map((row) => (
                                <TableRow key={`${row.id || 'history'}-${row.updatedAt || 'na'}`} hover>
                                  <TableCell>{formatProgress(row.readyPercent)}</TableCell>
                                  <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                                  <TableCell>{row.jobName || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}

                      {workerBreakdown.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No worker hour entries found for this day.
                        </Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Worker</TableCell>
                                <TableCell>Hours Worked</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {workerBreakdown.map(([workerName, hours]) => (
                                <TableRow key={`${dateKey}-${workerName}`} hover>
                                  <TableCell>{workerName}</TableCell>
                                  <TableCell>{hours.toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Stack>
          )
          )
        ) : (
          <Stack spacing={2} sx={{ pt: 0 }}>
            <Tabs
              value={detailsTab}
              onChange={(_event, value: JobDetailsTab) => {
                setDetailsTab(value)
              }}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: 48,
                borderBottom: '1px solid',
                borderColor: 'divider',
                px: { xs: 0.5, md: 1 },
                bgcolor: '#ffffff',
                position: 'sticky',
                top: 0,
                zIndex: 3,
                '& .MuiTab-root': {
                  minHeight: 48,
                  textTransform: 'none',
                  fontWeight: 800,
                  fontSize: { xs: 14, md: 14.5 },
                  px: { xs: 1.25, md: 2 },
                  py: 0.75,
                },
                '& .MuiTabs-indicator': {
                  height: 3,
                  borderRadius: 2,
                },
              }}
            >
              <Tab value="info" label="Order overview" />
              <Tab value="hours" label="Hours" />
              <Tab value="pictures" label="Pictures" />
              {shouldShowWarrantyTab ? (
                <Tab
                  value="warranty"
                  label={warrantyState.issueActive ? 'Warranty case' : 'New warranty case'}
                />
              ) : null}
              <Tab value="chat" label="Chat" />
            </Tabs>

            {detailsTab === 'pictures' ? (
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', sm: 'center' }}
                >
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 825, fontSize: '1.08rem' }}>
                      Order pictures
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Pictures taken by workers for order {orderPhotoDisplayNumber || '—'}.
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={orderPhotosQuery.isFetching
                      ? <CircularProgress size={14} color="inherit" />
                      : <ImageRoundedIcon fontSize="small" />}
                    disabled={orderPhotosQuery.isFetching || !orderPhotoId}
                    onClick={() => {
                      void orderPhotosQuery.refetch()
                    }}
                  >
                    Refresh pictures
                  </Button>
                </Stack>

                {orderPhotosQuery.isLoading ? (
                  <Stack alignItems="center" spacing={1.25} sx={{ py: 7 }}>
                    <CircularProgress size={28} />
                    <Typography color="text.secondary">Loading order pictures…</Typography>
                  </Stack>
                ) : orderPhotosQuery.isError ? (
                  <Alert severity="error">
                    {orderPhotosQuery.error instanceof Error
                      ? orderPhotosQuery.error.message
                      : 'Could not load the order pictures.'}
                  </Alert>
                ) : (orderPhotosQuery.data?.photos || []).length === 0 ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      py: 7,
                      px: 2,
                      textAlign: 'center',
                      borderStyle: 'dashed',
                      borderColor: alpha('#0f4c81', 0.22),
                      bgcolor: alpha('#0f4c81', 0.025),
                    }}
                  >
                    <ImageRoundedIcon sx={{ fontSize: 42, color: 'text.disabled', mb: 1 }} />
                    <Typography fontWeight={750}>No pictures yet</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Pictures taken in the worker app will appear here automatically.
                    </Typography>
                  </Paper>
                ) : (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(2, minmax(0, 1fr))',
                        sm: 'repeat(3, minmax(0, 1fr))',
                        lg: 'repeat(4, minmax(0, 1fr))',
                      },
                      gap: 1.2,
                    }}
                  >
                    {(orderPhotosQuery.data?.photos || []).map((photo, index) => (
                      <Paper
                        key={photo.path}
                        component="button"
                        type="button"
                        variant="outlined"
                        onClick={() => setSelectedOrderPhoto(photo)}
                        sx={{
                          p: 0,
                          overflow: 'hidden',
                          borderRadius: 1.75,
                          cursor: 'pointer',
                          textAlign: 'left',
                          bgcolor: '#fff',
                          transition: 'transform 150ms ease, box-shadow 150ms ease',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            boxShadow: '0 10px 24px rgba(15, 42, 68, 0.12)',
                          },
                        }}
                      >
                        <Box
                          component="img"
                          src={photo.url}
                          alt={`Order ${orderPhotoDisplayNumber} picture ${index + 1}`}
                          loading="lazy"
                          sx={{
                            width: '100%',
                            aspectRatio: '4 / 3',
                            display: 'block',
                            objectFit: 'cover',
                            bgcolor: '#eef2f6',
                          }}
                        />
                        <Stack spacing={0.15} sx={{ px: 1, py: 0.8 }}>
                          <Typography variant="caption" sx={{ fontWeight: 750 }}>
                            Picture {index + 1}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {photo.createdAt ? formatDateTime(photo.createdAt) : 'Date unavailable'}
                          </Typography>
                        </Stack>
                      </Paper>
                    ))}
                  </Box>
                )}
              </Stack>
            ) : null}

            {detailsTab === 'hours' ? (
              detailsQuery.isLoading ? (
                <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                  <Typography color="text.secondary">Loading hours...</Typography>
                </Stack>
              ) : errorMessage ? (
                <Alert severity="error">{errorMessage}</Alert>
              ) : !detailsQuery.data ? (
                <Alert severity="info">No hours data available.</Alert>
              ) : (
                <Stack spacing={2.1}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip
                      label={`Total hours: ${detailsQuery.data.summary.totalHours.toFixed(2)}`}
                      color="primary"
                      variant="outlined"
                    />
                    <Chip label={`Workers: ${detailsQuery.data.summary.workerCount}`} variant="outlined" />
                    <Chip label={`Entries: ${detailsQuery.data.summary.entryCount}`} variant="outlined" />
                    {appUser?.canViewLaborCost
                      && detailsQuery.data.summary.totalLaborCost !== null ? (
                        <Chip
                          label={`Labor: ${formatCurrency(detailsQuery.data.summary.totalLaborCost, 2)}`}
                          variant="outlined"
                        />
                      ) : null}
                  </Stack>

                  <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 } }}>
                    <Stack spacing={1.15}>
                      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1rem', md: '1.12rem' } }}>
                        Total Chart
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total hours by worker and by stage (including cut and stitching when logged).
                      </Typography>

                      {workerRows.length === 0 ? (
                        <Alert severity="info">No worker activity found for this job yet.</Alert>
                      ) : (
                        <Stack spacing={1.35}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            By worker
                          </Typography>

                          {workerRows.map((worker) => {
                            const ratio = maxWorkerHours > 0
                              ? (worker.totalHours / maxWorkerHours) * 100
                              : 0

                            return (
                              <Box
                                key={worker.workerId}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 220px) minmax(180px, 1fr) auto' },
                                  gap: 1,
                                  alignItems: 'center',
                                }}
                              >
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  {worker.workerName}
                                </Typography>

                                <LinearProgress
                                  variant="determinate"
                                  value={Math.max(0, Math.min(100, ratio))}
                                  sx={{
                                    height: 10,
                                    borderRadius: 999,
                                    bgcolor: 'action.hover',
                                  }}
                                />

                                <Typography variant="body2" sx={{ fontWeight: 700, textAlign: { xs: 'left', sm: 'right' } }}>
                                  {worker.totalHours.toFixed(2)} hrs
                                </Typography>
                              </Box>
                            )
                          })}
                        </Stack>
                      )}

                      <Stack spacing={1.35}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          By stage
                        </Typography>

                        {stageRows.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            No stage labels found in timesheet entries yet.
                          </Typography>
                        ) : (
                          stageRows.map((stageRow) => {
                            const ratio = maxStageHours > 0
                              ? (stageRow.totalHours / maxStageHours) * 100
                              : 0

                            return (
                              <Box
                                key={stageRow.stageLabel}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 220px) minmax(180px, 1fr) auto' },
                                  gap: 1,
                                  alignItems: 'center',
                                }}
                              >
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  {stageRow.stageLabel}
                                </Typography>

                                <LinearProgress
                                  variant="determinate"
                                  value={Math.max(0, Math.min(100, ratio))}
                                  sx={{
                                    height: 10,
                                    borderRadius: 999,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                      bgcolor: 'secondary.main',
                                    },
                                  }}
                                />

                                <Typography variant="body2" sx={{ fontWeight: 700, textAlign: { xs: 'left', sm: 'right' } }}>
                                  {stageRow.totalHours.toFixed(2)} hrs
                                </Typography>
                              </Box>
                            )
                          })
                        )}
                      </Stack>
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 } }}>
                    <Stack spacing={1.15}>
                      <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1rem', md: '1.12rem' } }}>
                        Per Date
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Every date is a dropdown. Open a date to see the worker totals and every entry for that day.
                      </Typography>

                      {sortedHoursDateKeys.length === 0 ? (
                        <Alert severity="info">No timesheet entries found for this job.</Alert>
                      ) : (
                        sortedHoursDateKeys.map((dateKey, index) => {
                          const dateBucket = hoursByDate.get(dateKey)
                          const dayTotalHours = dateBucket?.dayTotalHours ?? 0
                          const dayEntries = dateBucket?.entries ?? []
                          const managerReadyPercent = managerReadyByDate.get(dateKey) ?? null
                          const cumulativeHours = dateKey === 'unknown'
                            ? detailsQuery.data.summary.totalHours
                            : (cumulativeHoursByDate.get(dateKey) ?? detailsQuery.data.summary.totalHours)
                          const dateLabel = dateKey === 'unknown' ? 'Unknown date' : formatDate(dateKey)

                          const workersByDay = new Map<string, {
                            workerName: string
                            regularHours: number
                            overtimeHours: number
                            totalHours: number
                            laborCost: number
                          }>()

                          dayEntries.forEach((entry) => {
                            const workerName = String(entry.workerName ?? '').trim() || 'Unknown worker'
                            const regularHours = Number.isFinite(Number(entry.regularHours)) ? Number(entry.regularHours) : 0
                            const overtimeHours = Number.isFinite(Number(entry.overtimeHours)) ? Number(entry.overtimeHours) : 0
                            const totalHours = Number.isFinite(Number(entry.totalHours)) ? Number(entry.totalHours) : 0
                            const laborCost = Number.isFinite(Number(entry.laborCost)) ? Number(entry.laborCost) : 0
                            const existing = workersByDay.get(workerName)

                            if (existing) {
                              existing.regularHours += regularHours
                              existing.overtimeHours += overtimeHours
                              existing.totalHours += totalHours
                              existing.laborCost += laborCost
                              return
                            }

                            workersByDay.set(workerName, {
                              workerName,
                              regularHours,
                              overtimeHours,
                              totalHours,
                              laborCost,
                            })
                          })

                          const workerRowsForDay = Array.from(workersByDay.values())
                            .sort((a, b) => b.totalHours - a.totalHours)

                          return (
                            <Accordion key={dateKey} defaultExpanded={index === 0} disableGutters>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                    {dateLabel}
                                  </Typography>
                                  <Chip size="small" label={`Entries: ${dayEntries.length}`} variant="outlined" />
                                  <Chip size="small" label={`Workers: ${workerRowsForDay.length}`} variant="outlined" />
                                  <Chip size="small" label={`Day hours: ${dayTotalHours.toFixed(2)}`} color="primary" variant="outlined" />
                                  <Chip
                                    size="small"
                                    label={`Ready: ${formatProgress(managerReadyPercent)}`}
                                    color={managerReadyPercent !== null ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                  <Chip size="small" label={`Total through day: ${cumulativeHours.toFixed(2)}`} variant="outlined" />
                                </Stack>
                              </AccordionSummary>
                              <AccordionDetails sx={{ pt: 0.5 }}>
                                {workerRowsForDay.length === 0 ? (
                                  <Typography variant="body2" color="text.secondary" sx={{ mb: dayEntries.length > 0 ? 1 : 0 }}>
                                    No worker totals available for this date.
                                  </Typography>
                                ) : (
                                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Worker</TableCell>
                                          <TableCell>Regular Hours</TableCell>
                                          <TableCell>Overtime Hours</TableCell>
                                          <TableCell>Total Hours</TableCell>
                                          {appUser?.canViewLaborCost ? <TableCell>Labor Cost</TableCell> : null}
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {workerRowsForDay.map((workerRow) => (
                                          <TableRow key={`${dateKey}-${workerRow.workerName}`} hover>
                                            <TableCell>{workerRow.workerName}</TableCell>
                                            <TableCell>{workerRow.regularHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.overtimeHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.totalHours.toFixed(2)}</TableCell>
                                            {appUser?.canViewLaborCost ? (
                                              <TableCell>{formatCurrency(workerRow.laborCost, 2)}</TableCell>
                                            ) : null}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                )}

                                <TableContainer component={Paper} variant="outlined">
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Worker</TableCell>
                                        <TableCell>Stage</TableCell>
                                        <TableCell>Regular</TableCell>
                                        <TableCell>OT</TableCell>
                                        <TableCell>Total</TableCell>
                                        {appUser?.canViewLaborCost ? <TableCell>Rate</TableCell> : null}
                                        {appUser?.canViewLaborCost ? <TableCell>Labor Cost</TableCell> : null}
                                        <TableCell>Notes</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {dayEntries.length === 0 ? (
                                        <TableRow>
                                          <TableCell
                                            colSpan={
                                              6
                                              + (appUser?.canViewLaborCost ? 1 : 0)
                                              + (appUser?.canViewLaborCost ? 1 : 0)
                                            }
                                            align="center"
                                          >
                                            <Typography color="text.secondary" sx={{ py: 2 }}>
                                              No timesheet entries found for this date.
                                            </Typography>
                                          </TableCell>
                                        </TableRow>
                                      ) : (
                                        dayEntries.map((entry) => (
                                          <TableRow key={entry.id} hover>
                                            <TableCell>{entry.workerName}</TableCell>
                                            <TableCell>{formatStageLabel(entry.stageName)}</TableCell>
                                            <TableCell>{entry.regularHours.toFixed(2)}</TableCell>
                                            <TableCell>{entry.overtimeHours.toFixed(2)}</TableCell>
                                            <TableCell>{entry.totalHours.toFixed(2)}</TableCell>
                                            {appUser?.canViewLaborCost && entry.rate !== null ? (
                                              <TableCell>{formatCurrency(entry.rate, 2)}</TableCell>
                                            ) : appUser?.canViewLaborCost ? <TableCell>—</TableCell> : null}
                                            {appUser?.canViewLaborCost && entry.laborCost !== null ? (
                                              <TableCell>{formatCurrency(entry.laborCost, 2)}</TableCell>
                                            ) : appUser?.canViewLaborCost ? <TableCell>—</TableCell> : null}
                                            <TableCell>{entry.notes || '—'}</TableCell>
                                          </TableRow>
                                        ))
                                      )}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </AccordionDetails>
                            </Accordion>
                          )
                        })
                      )}
                    </Stack>
                  </Paper>
                </Stack>
              )
            ) : null}

            {detailsTab === 'shipping' ? (
              <Stack spacing={1.25} sx={{ order: 2 }}>
                <Box sx={{ pt: 0.25 }}>
                  <Typography variant="h6" sx={{ fontWeight: 825, fontSize: '1.08rem' }}>
                    Shipping
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Shipment readiness and final status
                  </Typography>
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                    <Chip
                      label={order?.isShipped ? 'Shipped' : 'Not shipped'}
                      color={order?.isShipped ? 'success' : 'default'}
                      variant="outlined"
                      size="small"
                    />
                    <Chip
                      label={`Shipped at: ${order?.shippedAt ? formatDate(order.shippedAt) : '—'}`}
                      variant="outlined"
                      size="small"
                    />
                  </Stack>
                </Box>
                {shippingActionSuccess ? (
                  <Alert severity="success">{shippingActionSuccess}</Alert>
                ) : null}

                {shippingActionError ? (
                  <Alert severity="error">{shippingActionError}</Alert>
                ) : null}

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={1.1}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      justifyContent="space-between"
                    >
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Shipping Documents
                      </Typography>
                      <Button
                        size="small"
                        variant={isShippingDocumentsEditMode ? 'contained' : 'outlined'}
                        startIcon={<EditRoundedIcon fontSize="small" />}
                        onClick={() => {
                          setIsShippingDocumentsEditMode((current) => !current)
                        }}
                        disabled={!canManageOrderDocuments || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                      >
                        {isShippingDocumentsEditMode ? 'Done Editing' : 'Edit'}
                      </Button>
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                      {isShippingDocumentsEditMode
                        ? 'Driver Signed BOL and Inspection Sheet are required to ship. Customer Signed BOL becomes available after the Driver Signed BOL.'
                        : 'Customer Signed BOL does not block shipping and appears after the Driver Signed BOL is uploaded.'}
                    </Typography>

                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      <Chip
                        size="small"
                        variant="outlined"
                        color={hasSignedBolForShipping ? 'success' : 'error'}
                        label={hasSignedBolForShipping ? 'Driver Signed BOL: Ready' : 'Driver Signed BOL: Missing'}
                      />
                      {shouldShowCustomerSignedBol ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={hasCustomerSignedBol ? 'success' : 'error'}
                          label={hasCustomerSignedBol ? 'Customer Signed BOL: Ready' : 'Customer Signed BOL: Missing'}
                        />
                      ) : null}
                      <Chip
                        size="small"
                        variant="outlined"
                        color={hasInspectionSheetForShipping ? 'success' : 'error'}
                        label={hasInspectionSheetForShipping ? 'Inspection Sheet: Ready' : 'Inspection Sheet: Missing'}
                      />
                    </Stack>

                    <Box
                      sx={{
                        display: 'grid',
                        gap: 1,
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                      }}
                    >
                      <Paper
                        variant="outlined"
                        role={canOpenBolDocument ? 'button' : undefined}
                        tabIndex={canOpenBolDocument ? 0 : -1}
                        onClick={() => {
                          if (!canOpenBolDocument) return
                          void handleOpenBolPreview()
                        }}
                        onKeyDown={(event) => {
                          if (
                            canOpenBolDocument
                            && (event.key === 'Enter' || event.key === ' ')
                          ) {
                            event.preventDefault()
                            event.currentTarget.click()
                          }
                        }}
                        sx={{
                          p: 1.1,
                          cursor: canOpenBolDocument ? 'pointer' : 'default',
                          '&:hover': canOpenBolDocument
                            ? { borderColor: 'primary.light', boxShadow: 1 }
                            : undefined,
                        }}
                      >
                        <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              BOL
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={canOpenBolDocument ? 'success' : 'default'}
                              label={isLoadingBolPreview ? 'Loading…' : canOpenBolDocument ? 'Available' : 'Missing'}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 36 }}>
                            {hasBolText
                              ? 'Bill of lading is available for preview.'
                              : 'No bill of lading is available yet.'}
                          </Typography>
                          {renderInlineDocumentMiniPreview({
                            url: bolPreviewUrl,
                            fileName: 'bill-of-lading.pdf',
                            emptyLabel: 'No BOL preview yet',
                          })}
                        </Stack>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.1 }}>
                        <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Driver Signed BOL
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={hasSignedBolForShipping ? 'success' : 'error'}
                              label={hasSignedBolForShipping ? 'Ready' : 'Missing'}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 36, overflowWrap: 'anywhere' }}>
                            {signedBolDisplayName || 'No file attached yet.'}
                          </Typography>
                          {renderInlineDocumentMiniPreview({
                            url: signedBolUrl,
                            fileName: signedBolDisplayName,
                            emptyLabel: 'Driver Signed BOL not uploaded',
                          })}
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              disabled={!signedBolUrl || isUploadingShippingDocument || isDeletingShippingDocument}
                              onClick={() => {
                                handleOpenDocumentPreview({
                                  title: 'Driver Signed BOL Preview',
                                  url: signedBolUrl,
                                  fileName: signedBolDisplayName,
                                })
                              }}
                            >
                              Preview
                            </Button>

                            {isShippingDocumentsEditMode ? (
                              <>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<UploadFileRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => {
                                    signedBolUploadInputRef.current?.click()
                                  }}
                                >
                                  {isUploadingSignedBol ? 'Uploading...' : hasSignedBolForShipping ? 'Replace' : 'Upload'}
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || !hasSignedBolForShipping || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => {
                                    void handleDeleteShippingDocument('signed_bol')
                                  }}
                                >
                                  {isDeletingSignedBol ? 'Deleting...' : 'Delete'}
                                </Button>
                              </>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Paper>

                      {shouldShowCustomerSignedBol ? (
                        <Paper variant="outlined" sx={{ p: 1.1 }}>
                          <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Customer Signed BOL
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={hasCustomerSignedBol ? 'success' : order?.isShipped ? 'error' : 'default'}
                              label={hasCustomerSignedBol ? 'Ready' : 'Missing'}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 36, overflowWrap: 'anywhere' }}>
                            {customerSignedBolDisplayName || 'Upload after customer acceptance or pickup.'}
                          </Typography>
                          {renderInlineDocumentMiniPreview({
                            url: customerSignedBolUrl,
                            fileName: customerSignedBolDisplayName,
                            emptyLabel: 'Customer Signed BOL not uploaded',
                          })}
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              disabled={!customerSignedBolUrl || isUploadingShippingDocument || isDeletingShippingDocument}
                              onClick={() => {
                                handleOpenDocumentPreview({
                                  title: 'Customer Signed BOL Preview',
                                  url: customerSignedBolUrl,
                                  fileName: customerSignedBolDisplayName,
                                })
                              }}
                            >
                              Preview
                            </Button>
                            {isShippingDocumentsEditMode ? (
                              <>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<UploadFileRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || !hasDriverSignedBol || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => customerSignedBolUploadInputRef.current?.click()}
                                >
                                  {isUploadingCustomerSignedBol ? 'Uploading...' : hasCustomerSignedBol ? 'Replace' : 'Upload'}
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || !hasCustomerSignedBol || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => void handleDeleteShippingDocument('customer_signed_bol')}
                                >
                                  {isDeletingCustomerSignedBol ? 'Deleting...' : 'Delete'}
                                </Button>
                              </>
                            ) : null}
                          </Stack>
                          </Stack>
                        </Paper>
                      ) : null}

                      <Paper variant="outlined" sx={{ p: 1.1 }}>
                        <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Inspection Sheet
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={hasInspectionSheetForShipping ? 'success' : 'error'}
                              label={hasInspectionSheetForShipping ? 'Ready' : 'Missing'}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 36, overflowWrap: 'anywhere' }}>
                            {inspectionSheetDisplayName || 'No file attached yet.'}
                          </Typography>
                          {renderInlineDocumentMiniPreview({
                            url: inspectionSheetUrl,
                            fileName: inspectionSheetDisplayName,
                            emptyLabel: 'Inspection sheet not uploaded',
                          })}
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              disabled={!inspectionSheetUrl || isUploadingShippingDocument || isDeletingShippingDocument}
                              onClick={() => {
                                handleOpenDocumentPreview({
                                  title: 'Inspection Sheet Preview',
                                  url: inspectionSheetUrl,
                                  fileName: inspectionSheetDisplayName,
                                })
                              }}
                            >
                              Preview
                            </Button>

                            {isShippingDocumentsEditMode ? (
                              <>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<UploadFileRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => {
                                    inspectionSheetUploadInputRef.current?.click()
                                  }}
                                >
                                  {isUploadingInspectionSheet ? 'Uploading...' : hasInspectionSheetForShipping ? 'Replace' : 'Upload'}
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                  disabled={!canManageOrderDocuments || !hasInspectionSheetForShipping || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                                  onClick={() => {
                                    void handleDeleteShippingDocument('inspection_sheet')
                                  }}
                                >
                                  {isDeletingInspectionSheet ? 'Deleting...' : 'Delete'}
                                </Button>
                              </>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Paper>
                    </Box>

                    {!canManageOrderDocuments ? (
                      <Typography variant="caption" color="text.secondary">
                        Only office workers, managers, and admins can edit attachments.
                      </Typography>
                    ) : null}

                    {!canShipFromWebsiteFlow ? (
                      <Typography variant="caption" color="error.main">
                        Ship requires an uploaded Driver Signed BOL and Inspection Sheet.
                      </Typography>
                    ) : null}

                    {order?.isShipped ? (
                      <Typography variant="caption" color="text.secondary">
                        Order is already shipped. Document edits are still available.
                      </Typography>
                    ) : null}

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
                      <Button
                        size="medium"
                        variant="contained"
                        color={canShipFromWebsiteFlow ? 'success' : 'error'}
                        disabled={Boolean(order?.isShipped) || isShippingOrder || isUploadingShippingDocument || isDeletingShippingDocument}
                        onClick={() => {
                          void handleShipOrder()
                        }}
                      >
                        {order?.isShipped ? 'Shipped' : isShippingOrder ? 'Shipping...' : 'Ship'}
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              </Stack>
            ) : null}

            {detailsTab === 'warranty' ? (
              <Stack spacing={1.25}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 1.4, md: 1.75 },
                    borderRadius: 2,
                    borderColor: 'rgba(15, 42, 68, 0.12)',
                  }}
                >
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: 2,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'warning.dark',
                          bgcolor: (theme) => alpha(theme.palette.warning.main, 0.14),
                        }}
                      >
                        <HealthAndSafetyRoundedIcon />
                      </Box>
                      <Box>
                        <Typography variant="h6" sx={{ fontWeight: 825, fontSize: '1.08rem' }}>
                          {warrantyState.issueActive ? 'Warranty case' : 'Start a warranty case'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Record the issue and keep its follow-up separate from the original production work.
                        </Typography>
                      </Box>
                    </Stack>

                    {warrantyActionError ? (
                      <Alert severity="error">{warrantyActionError}</Alert>
                    ) : null}

                    {warrantyActionSuccess ? (
                      <Alert severity="success">{warrantyActionSuccess}</Alert>
                    ) : null}

                    {!canManageWarrantyIssue ? (
                      <Typography variant="body2" color="text.secondary">
                        Warranty issues can be added after the order is shipped.
                      </Typography>
                    ) : null}

                    {warrantyState.issueActive ? (
                      <>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label="In progress"
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Reported: ${warrantyState.issueReportedAt ? formatDate(warrantyState.issueReportedAt) : '—'}`}
                          />
                        </Stack>

                        <TextField
                          size="small"
                          label="Issue description"
                          value={warrantyState.issueDescription ?? ''}
                          fullWidth
                          multiline
                          minRows={3}
                          disabled
                        />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <TextField
                            size="small"
                            label="Lead time"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={warrantyLeadTimeDateDraft}
                            onChange={(event) => setWarrantyLeadTimeDateDraft(event.target.value)}
                            disabled={!canUpdateWarrantyLeadTime || isWarrantyActionInFlight}
                            fullWidth
                          />

                          <Button
                            variant="outlined"
                            onClick={() => {
                              void handleSaveWarrantyLeadTime()
                            }}
                            disabled={!canUpdateWarrantyLeadTime || isWarrantyActionInFlight}
                            sx={{ minWidth: 150 }}
                          >
                            {isSavingWarrantyLeadTime ? 'Saving...' : 'Save Lead Time'}
                          </Button>

                          <Button
                            variant="contained"
                            color="success"
                            onClick={() => {
                              void handleMarkWarrantyDone()
                            }}
                            disabled={!canUpdateWarrantyLeadTime || isWarrantyActionInFlight}
                            sx={{ minWidth: 130 }}
                          >
                            {isMarkingWarrantyDone ? 'Saving...' : 'Mark Done'}
                          </Button>
                        </Stack>
                      </>
                    ) : (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          Describe the warranty work. Saving creates a new order ending in _WR in the Orders tab and links its costs to this order.
                        </Typography>

                        <TextField
                          size="small"
                          label="Issue description"
                          placeholder="What went wrong?"
                          value={warrantyIssueDescriptionDraft}
                          onChange={(event) => setWarrantyIssueDescriptionDraft(event.target.value)}
                          disabled={!canCreateWarrantyIssue || isWarrantyActionInFlight}
                          fullWidth
                          multiline
                          minRows={3}
                        />

                        <TextField
                          size="small"
                          label="Warranty lead time"
                          type="date"
                          InputLabelProps={{ shrink: true }}
                          value={warrantyLeadTimeDateDraft}
                          onChange={(event) => setWarrantyLeadTimeDateDraft(event.target.value)}
                          disabled={!canCreateWarrantyIssue || isWarrantyActionInFlight}
                          required
                          fullWidth
                        />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button
                            variant="contained"
                            onClick={() => {
                              void handleCreateWarrantyIssue()
                            }}
                            disabled={!canCreateWarrantyIssue || isWarrantyActionInFlight}
                            sx={{ minWidth: 130 }}
                          >
                            {isSavingWarrantyIssue ? 'Starting...' : 'Start Warranty Case'}
                          </Button>
                          <Button
                            variant="text"
                            color="inherit"
                            onClick={() => {
                              setShowWarrantyWorkspace(false)
                              setDetailsTab('info')
                            }}
                            disabled={isWarrantyActionInFlight}
                          >
                            Cancel
                          </Button>
                        </Stack>
                      </>
                    )}

                    {warrantyState.lastCompletedDoneAt ? (
                      <Paper variant="outlined" sx={{ p: 1 }}>
                        <Stack spacing={0.5}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Last Completed Warranty
                          </Typography>
                          <Typography variant="body2">
                            Description: {warrantyState.lastCompletedDescription || '—'}
                          </Typography>
                          <Typography variant="body2">
                            Reported: {warrantyState.lastCompletedReportedAt ? formatDate(warrantyState.lastCompletedReportedAt) : '—'}
                          </Typography>
                          <Typography variant="body2">
                            Lead time: {warrantyState.lastCompletedLeadTimeDate ? formatDate(warrantyState.lastCompletedLeadTimeDate) : '—'}
                          </Typography>
                          <Typography variant="body2">
                            Done: {formatDate(warrantyState.lastCompletedDoneAt)}
                          </Typography>
                          <Typography variant="body2">
                            Duration: {Number.isFinite(Number(warrantyState.lastCompletedDurationDays))
                              ? `${warrantyState.lastCompletedDurationDays} day${Number(warrantyState.lastCompletedDurationDays) === 1 ? '' : 's'}`
                              : '—'}
                          </Typography>
                          <Typography variant="body2">
                            Lead time result: {formatWarrantyVarianceLabel(warrantyState.lastCompletedLeadTimeVarianceDays)}
                          </Typography>
                        </Stack>
                      </Paper>
                    ) : null}
                  </Stack>
                </Paper>
              </Stack>
            ) : null}

            {detailsTab === 'chat' ? (
              <Stack spacing={1.25}>
                {chatSuccessMessage ? (
                  <Alert severity="success">{chatSuccessMessage}</Alert>
                ) : null}

                {combinedChatErrorMessage ? (
                  <Alert severity="error">{combinedChatErrorMessage}</Alert>
                ) : null}

                <Paper variant="outlined" sx={{ p: 0.9 }}>
                  {chatMessagesQuery.isLoading ? (
                    <Stack alignItems="center" spacing={1.5} sx={{ py: 3.5 }}>
                      <CircularProgress size={24} />
                      <Typography color="text.secondary">Loading chat...</Typography>
                    </Stack>
                  ) : chatMessages.length === 0 ? (
                    <Alert severity="info">No chat messages yet. Start the thread below.</Alert>
                  ) : (
                    <Stack spacing={0.8}>
                      {chatMessages.map((message) => {
                        const canDeleteMessage = canManageOrderChatMessage(message)
                        const isDeletingMessage = deletingChatMessageId === message.id
                        const reminderTargetEmails = Array.isArray(message.reminder?.targetUserEmails)
                          ? message.reminder.targetUserEmails
                          : []

                        return (
                          <Paper key={message.id} variant="outlined" sx={{ p: 0.8 }}>
                            <Stack spacing={0.45}>
                              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {String(message.createdByName || message.createdByEmail || 'A teammate').trim()} · {formatDateTime(message.createdAt)}
                                  {message.updatedAt ? ` · Edited ${formatDateTime(message.updatedAt)}` : ''}
                                </Typography>

                                {canDeleteMessage ? (
                                  <Button
                                    size="small"
                                    color="error"
                                    variant="text"
                                    startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                    disabled={isDeletingMessage}
                                    onClick={() => {
                                      void handleDeleteChatMessage(message.id)
                                    }}
                                  >
                                    {isDeletingMessage ? 'Deleting...' : 'Delete'}
                                  </Button>
                                ) : null}
                              </Stack>

                              <Box
                                sx={{
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                  fontSize: '0.875rem',
                                  lineHeight: 1.45,
                                }}
                              >
                                {renderMessageWithMentionPills(message.message)}
                              </Box>

                              {message.reminder ? (
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5}>
                                  <Chip
                                    size="small"
                                    icon={<NotificationsActiveRoundedIcon fontSize="small" />}
                                    label={`Reminder ${message.reminder.dueDate}`}
                                    variant="outlined"
                                  />
                                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                    For: {reminderTargetEmails.join(', ') || '-'}
                                  </Typography>
                                </Stack>
                              ) : null}
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  )}
                </Paper>

                <Stack spacing={0.45}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Write update
                  </Typography>

                  <MentionsInput
                    value={chatDraftMarkup}
                    onChange={(_event, nextMarkupValue, nextPlainTextValue) => {
                      setChatDraftMarkup(nextMarkupValue)
                      setChatDraft(nextPlainTextValue)
                    }}
                    placeholder="Write update"
                    style={chatMentionsInputStyle}
                    a11ySuggestionsListLabel="Mention users"
                    allowSuggestionsAboveCursor
                  >
                    <Mention
                      trigger="@"
                      markup="@[__display__](__id__)"
                      data={loadMentionSuggestions}
                      appendSpaceOnAdd
                      displayTransform={(_id, display) => `@${display}`}
                      style={{
                        backgroundColor: 'rgba(30, 144, 255, 0.18)',
                        borderRadius: 4,
                        color: 'transparent',
                      }}
                      renderSuggestion={(entry, _search, highlightedDisplay, _index, focused) => (
                        <Box
                          sx={{
                            px: 0.8,
                            py: 0.6,
                            borderRadius: 0.8,
                            bgcolor: focused ? alpha('#2196f3', 0.14) : 'transparent',
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                            {highlightedDisplay}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.15 }}>
                            {mentionEmailByUid.get(String(entry.id ?? '')) || ''}
                          </Typography>
                        </Box>
                      )}
                    />
                  </MentionsInput>
                </Stack>

                <Paper variant="outlined" sx={{ p: 0.8 }}>
                  <Stack spacing={0.7}>
                    <FormControlLabel
                      control={(
                        <Checkbox
                          size="small"
                          checked={reminderEnabled}
                          onChange={(event) => {
                            const nextValue = event.target.checked
                            setReminderEnabled(nextValue)

                            if (nextValue && currentUserUid && !reminderRecipientUids.includes(currentUserUid)) {
                              setReminderRecipientUids((current) => [...new Set([...current, currentUserUid])])
                            }
                          }}
                        />
                      )}
                      label="Create reminder"
                    />

                    {reminderEnabled ? (
                      <Stack spacing={0.7}>
                        <TextField
                          size="small"
                          type="date"
                          label="Reminder date"
                          InputLabelProps={{ shrink: true }}
                          value={reminderDueDate}
                          onChange={(event) => {
                            setReminderDueDate(event.target.value)
                          }}
                        />

                        <FormControl size="small">
                          <InputLabel id="order-chat-reminder-recipients-label">Notify workers</InputLabel>
                          <Select
                            labelId="order-chat-reminder-recipients-label"
                            multiple
                            label="Notify workers"
                            value={reminderRecipientUids}
                            onChange={(event) => {
                              const nextValue = event.target.value
                              setReminderRecipientUids(Array.isArray(nextValue) ? nextValue.map(String) : String(nextValue).split(','))
                            }}
                            renderValue={(selected) => {
                              const selectedIds = Array.isArray(selected) ? selected : []
                              const selectedUsers = chatUsers.filter((user) => selectedIds.includes(user.uid))
                              return selectedUsers.map((user) => String(user.displayName ?? '').trim() || user.email).join(', ')
                            }}
                          >
                            {chatUsers.map((user) => (
                              <MenuItem key={user.uid} value={user.uid}>
                                <Checkbox size="small" checked={reminderRecipientUids.includes(user.uid)} />
                                <Typography variant="body2">
                                  {String(user.displayName ?? '').trim() || user.email} ({user.email})
                                </Typography>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <TextField
                          size="small"
                          label="Reminder note"
                          placeholder="What should they remember?"
                          value={reminderNote}
                          onChange={(event) => {
                            setReminderNote(event.target.value)
                          }}
                        />
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>

                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    variant="contained"
                    onClick={() => {
                      void handleSendChatMessage()
                    }}
                    disabled={
                      isSendingChat
                      || !orderChatId
                      || (!chatDraft.trim() && !(reminderEnabled && reminderDueDate && reminderRecipientUids.length > 0 && reminderNote.trim()))
                    }
                  >
                    {isSendingChat ? 'Sending...' : 'Send'}
                  </Button>
                </Stack>
              </Stack>
            ) : null}

            {detailsTab === 'info' ? (
              <Stack spacing={1.1} sx={{ order: 1 }}>
                {order?.sourceQuoteId ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: { xs: 1.4, md: 1.7 },
                      borderColor: (theme) => alpha(theme.palette.primary.main, 0.28),
                      background: (theme) => `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.info.light, 0.08)} 100%)`,
                    }}
                  >
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.4} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <Box
                        sx={{
                          width: 42,
                          height: 42,
                          borderRadius: 1.5,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'primary.main',
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                          flexShrink: 0,
                        }}
                      >
                        <DescriptionRoundedIcon />
                      </Box>
                      <Stack spacing={0.35} sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                          Accepted Quote
                        </Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                          {order.sourceQuoteNumber || 'Linked quote'}
                        </Typography>
                        <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                          {order.quoteAcceptedAt ? (
                            <Chip size="small" label={`Accepted ${formatDate(order.quoteAcceptedAt)}`} />
                          ) : null}
                          {order.convertedAt ? (
                            <Chip size="small" variant="outlined" label={`Converted ${formatDateTime(order.convertedAt)}`} />
                          ) : null}
                        </Stack>
                      </Stack>
                      <Button
                        variant="contained"
                        endIcon={<OpenInNewRoundedIcon />}
                        onClick={() => {
                          window.open(`/sales?tab=quotes&quoteId=${encodeURIComponent(order.sourceQuoteId || '')}`, '_blank', 'noopener,noreferrer')
                        }}
                        sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        Open quote details
                      </Button>
                    </Stack>
                  </Paper>
                ) : null}

                <Paper
                  elevation={0}
                  sx={{
                    p: 0,
                    bgcolor: 'transparent',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography variant="h6" sx={{ fontWeight: 825, fontSize: '1.08rem' }}>
                            Order Info
                          </Typography>
                          {changeOrderVersion > 0 ? (
                            <Chip
                              size="small"
                              color={hasPendingChangeOrder ? 'warning' : 'primary'}
                              label={`Change Version ${changeOrderVersion}${hasPendingChangeOrder ? ' — Pending' : ''}`}
                            />
                          ) : null}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          Project, delivery, and production details
                        </Typography>
                      </Box>

                      <Stack direction="row" spacing={0.75}>
                        {order?.isShipped && !warrantyState.issueActive ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<HealthAndSafetyRoundedIcon />}
                            onClick={() => {
                              setShowWarrantyWorkspace(true)
                              setDetailsTab('warranty')
                            }}
                            sx={{ textTransform: 'none', fontWeight: 750 }}
                          >
                            Start warranty case
                          </Button>
                        ) : warrantyState.issueActive ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<HealthAndSafetyRoundedIcon />}
                            onClick={() => {
                              setShowWarrantyWorkspace(true)
                              setDetailsTab('warranty')
                            }}
                            sx={{ textTransform: 'none', fontWeight: 750 }}
                          >
                            Open warranty case
                          </Button>
                        ) : null}

                        {canEditOrderInformation ? (
                          isManagerEditMode ? (
                            <>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={handleCancelManagerEdit}
                              disabled={isSavingManagerEdit}
                              sx={{ minWidth: 84 }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => {
                                void handleSaveManagerEdit()
                              }}
                              disabled={isSavingManagerEdit || !canEditOrderInformation}
                              startIcon={isSavingManagerEdit ? <CircularProgress size={14} /> : null}
                              sx={{ minWidth: 84 }}
                            >
                              Save
                            </Button>
                            </>
                          ) : (
                            <IconButton
                              size="small"
                              onClick={handleStartManagerEdit}
                              disabled={!canEditOrderInformation || !hasMondayRecord || isSavingManagerEdit}
                              sx={{ border: '1px solid', borderColor: 'divider' }}
                              aria-label="Edit order information"
                            >
                              <EditRoundedIcon fontSize="small" />
                            </IconButton>
                          )
                        ) : null}
                      </Stack>
                    </Stack>

                    {managerEditError ? (
                      <Alert severity="error">{managerEditError}</Alert>
                    ) : null}

                    {managerEditSuccess ? (
                      <Alert severity="success">{managerEditSuccess}</Alert>
                    ) : null}

                    {managerEditWarning ? (
                      <Alert severity="warning">{managerEditWarning}</Alert>
                    ) : null}

                    <Box
                        sx={{
                          display: 'grid',
                          gap: 1.5,
                          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)' },
                          alignItems: 'start',
                        }}
                      >
                        <Box
                          component="section"
                          sx={{
                            order: { xs: 2, md: 2 },
                            px: 1.5,
                            py: 1.25,
                            borderRadius: 2,
                            bgcolor: '#ffffff',
                            border: '1px solid',
                            borderColor: 'rgba(15, 42, 68, 0.1)',
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.65 }}>
                            <Box
                              sx={{
                                width: 34,
                                height: 34,
                                display: 'grid',
                                placeItems: 'center',
                                borderRadius: 1.25,
                                color: 'primary.main',
                                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                              }}
                            >
                              <Inventory2RoundedIcon fontSize="small" />
                            </Box>
                            <Box>
                              <Typography variant="subtitle1" sx={{ fontWeight: 850, lineHeight: 1.2 }}>
                                Order & project
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Commercial and production information
                              </Typography>
                            </Box>
                          </Stack>
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Order number',
                                value: orderNumberDraft,
                                onChange: setOrderNumberDraft,
                                disabled: !canEditOrderNumber,
                                helperText: order?.hasQuickBooksRecord
                                  ? 'Locked because this order has a QuickBooks project.'
                                  : undefined,
                              })
                            : renderOrderFact('Order number', orderNumberDraft)}
                          {renderOrderFact('Order date', orderDateDraft ? formatDate(orderDateDraft) : '')}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Description',
                                value: descriptionDraft,
                                onChange: setDescriptionDraft,
                                multiline: true,
                              })
                            : renderOrderFact('Description', descriptionDraft, { fullWidth: true, multiline: true })}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Project',
                                value: orderNameDraft,
                                onChange: setOrderNameDraft,
                              })
                            : renderOrderFact('Project', orderNameDraft)}
                          {renderOrderFact('Dealer', order?.dealerName)}
                          {appUser?.canViewOrderValue
                            ? renderOrderFact('Sales representative', order?.salesRep)
                            : null}
                          {appUser?.canViewOrderValue
                            ? renderOrderFact(
                              'Deposit received',
                              order?.depositReceivedDate
                                ? formatDisplayDate(order.depositReceivedDate)
                                : '',
                              { accent: 'success' },
                            )
                            : null}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'PO number',
                                value: poNumberDraft,
                                onChange: setPoNumberDraft,
                              })
                            : renderOrderFact('PO number', poNumberDraft)}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Bench',
                                value: benchDraft,
                                onChange: setBenchDraft,
                              })
                            : renderOrderFact('Bench', benchDraft)}
                          {renderOrderFact(
                            'Order type',
                            warrantyState.issueActive
                              ? 'Warranty'
                              : order?.parentOrderNumber
                                ? 'Linked follow-up order'
                                : 'Standard order',
                            { accent: 'success' },
                          )}
                          {renderOrderFact(
                            'Deposit terms',
                            order?.depositRequired === false
                              ? 'Not required'
                              : order?.depositRequired
                                ? `${Number(order?.depositPercent) || 0}% required`
                                : '',
                          )}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Internal notes',
                                value: notesDraft,
                                onChange: setNotesDraft,
                                multiline: true,
                              })
                            : renderOrderFact('Internal notes', notesDraft, { fullWidth: true, multiline: true })}
                        </Box>

                        <Box
                          component="section"
                          sx={{
                            order: { xs: 1, md: 1 },
                            px: 1.5,
                            py: 1.25,
                            borderRadius: 2,
                            bgcolor: '#ffffff',
                            border: '1px solid',
                            borderColor: 'rgba(15, 42, 68, 0.1)',
                            borderTop: '4px solid',
                            borderTopColor: 'info.main',
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.65 }}>
                            <Box
                              sx={{
                                width: 34,
                                height: 34,
                                display: 'grid',
                                placeItems: 'center',
                                borderRadius: 1.25,
                                color: 'info.main',
                                bgcolor: (theme) => alpha(theme.palette.info.main, 0.1),
                              }}
                            >
                              <LocalShippingRoundedIcon fontSize="small" />
                            </Box>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 850, lineHeight: 1.2 }}>
                                Shipping
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Delivery instructions and schedule
                              </Typography>
                            </Box>
                            <Chip
                              size="small"
                              color={order?.isShipped ? 'success' : 'default'}
                              label={order?.isShipped ? 'Shipped' : 'Pending'}
                              sx={{ fontWeight: 750 }}
                            />
                          </Stack>
                          <Box
                            sx={{
                              p: 1.05,
                              mb: 0.55,
                              borderRadius: 1.5,
                              bgcolor: (theme) => alpha(theme.palette.warning.main, 0.08),
                              borderLeft: '3px solid',
                              borderLeftColor: 'warning.main',
                            }}
                          >
                            <Typography variant="caption" color="warning.dark" sx={{ fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Shipping note
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 0.2, fontWeight: 650, whiteSpace: 'pre-wrap' }}>
                              {shipNotes || 'No special shipping instructions.'}
                            </Typography>
                          </Box>
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'Lead time',
                                value: leadTimeDateDraft,
                                onChange: setLeadTimeDateDraft,
                                type: 'date',
                                accent: 'info',
                              })
                            : renderOrderFact('Lead time', leadTimeDateDraft ? formatDate(leadTimeDateDraft) : '', { accent: 'info' })}
                          {renderOrderFact('Ship to', shipTo, { fullWidth: true, multiline: true, accent: 'info' })}
                          {isManagerEditMode
                            ? renderEditableOrderFact({
                                label: 'POD date',
                                value: podDateDraft,
                                onChange: setPodDateDraft,
                                type: 'date',
                                accent: 'info',
                              })
                            : renderOrderFact('POD date', podDateDraft ? formatDate(podDateDraft) : '', { accent: 'info' })}
                          {renderOrderFact('Status', order?.mondayStatus || order?.rowStatus, { accent: 'info' })}
                          {renderOrderFact(
                            'Progress',
                            Number.isFinite(Number(order?.progressPercent))
                              ? `${Number(order?.progressPercent).toFixed(0)}%`
                              : '',
                            { accent: 'info' },
                          )}
                        </Box>
                      </Box>

                    {!canEditOrderInformation ? (
                      <Typography variant="caption" color="text.secondary">
                        Only office workers, managers, and admins can edit with the pencil icon.
                      </Typography>
                    ) : null}

                    {canEditOrderInformation && !hasMondayRecord ? (
                      <Typography variant="caption" color="text.secondary">
                        Only Monday-linked orders can be edited.
                      </Typography>
                    ) : null}
                  </Stack>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 1.25, md: 1.6 },
                    borderRadius: 2,
                    borderColor: 'rgba(15, 42, 68, 0.12)',
                    bgcolor: '#ffffff',
                  }}
                >
                  <Stack spacing={1.1}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.25}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                        <Box
                          sx={{
                            width: 38,
                            height: 38,
                            display: 'grid',
                            placeItems: 'center',
                            borderRadius: 1.4,
                            color: 'primary.main',
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                          }}
                        >
                          <FolderOpenRoundedIcon />
                        </Box>
                        <Box>
                          <Typography variant="h6" sx={{ fontWeight: 850, fontSize: '1.08rem' }}>
                            Document center
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Open, replace, or add the working files for this order.
                          </Typography>
                        </Box>
                      </Stack>

                      {canEditOrderInformation ? (
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
                          <Button
                            variant="outlined"
                            startIcon={<EditRoundedIcon />}
                            disabled={isCreatingChangeOrder || hasPendingChangeOrder}
                            onClick={() => {
                              setChangeOrderDraftLines(
                                (order?.pendingOrderChangeLines?.length
                                  ? order.pendingOrderChangeLines
                                  : order?.orderDocumentLines ?? []
                                ).map((line) => ({ ...line })),
                              )
                              setChangeOrderActionError(null)
                              setIsChangeOrderEditorOpen(true)
                            }}
                            sx={{ textTransform: 'none', fontWeight: 800 }}
                          >
                            {hasPendingChangeOrder ? `Change V${changeOrderVersion} Pending` : 'Make Change Order'}
                          </Button>
                          <Button
                            variant={orderConfirmationUrl && workOrderUrl && proformaInvoiceUrl ? 'outlined' : 'contained'}
                            disabled={isGeneratingOrderConfirmation || hasPendingChangeOrder}
                            startIcon={isGeneratingOrderConfirmation
                              ? <CircularProgress size={16} color="inherit" />
                              : <PictureAsPdfRoundedIcon />}
                            onClick={() => {
                              void handleGenerateOrderConfirmation()
                            }}
                            sx={{
                              minWidth: { sm: 220 },
                              textTransform: 'none',
                              fontWeight: 850,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isGeneratingOrderConfirmation
                              ? 'Generating Documents…'
                              : orderConfirmationUrl && workOrderUrl && proformaInvoiceUrl
                                ? 'Regenerate Documents'
                                : 'Generate Documents'}
                          </Button>
                        </Stack>
                      ) : null}
                    </Stack>

                    {infoDocumentActionError ? (
                      <Alert severity="error">{infoDocumentActionError}</Alert>
                    ) : null}

                    {infoDocumentActionSuccess ? (
                      <Alert severity="success">{infoDocumentActionSuccess}</Alert>
                    ) : null}

                    {shippingActionError ? (
                      <Alert severity="error">{shippingActionError}</Alert>
                    ) : null}

                    {shippingActionSuccess ? (
                      <Alert severity="success">{shippingActionSuccess}</Alert>
                    ) : null}

                    <Box
                      sx={{
                        display: 'grid',
                        gap: 1,
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          lg: 'repeat(4, minmax(0, 1fr))',
                        },
                      }}
                    >
                      {renderDocumentCard({
                        title: 'Order Confirmation',
                        url: orderConfirmationUrl,
                        fileName: orderConfirmationUrl
                          ? orderConfirmationName
                          : null,
                        available: Boolean(orderConfirmationUrl),
                        statusText: orderConfirmationUrl ? 'Available' : 'Ready to generate',
                        emptyLabel: 'Use the Generate Documents button above',
                        readOnly: true,
                        onOpen: orderConfirmationUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Order Confirmation',
                              url: orderConfirmationUrl,
                              fileName: orderConfirmationName,
                              mimeType: 'application/pdf',
                            })
                          : undefined,
                      })}

                      {renderDocumentCard({
                        title: 'Work Order',
                        url: workOrderUrl,
                        fileName: workOrderUrl
                          ? workOrderName
                          : null,
                        available: Boolean(workOrderUrl),
                        statusText: hasPendingChangeOrder
                          ? 'Waiting for signed change order'
                          : workOrderUrl
                            ? 'Available'
                            : 'Ready to generate',
                        emptyLabel: hasPendingChangeOrder
                          ? 'Please upload customer-signed change order'
                          : 'Use the Generate Documents button above',
                        readOnly: true,
                        onOpen: workOrderUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Work Order',
                              url: workOrderUrl,
                              fileName: workOrderName,
                              mimeType: 'application/pdf',
                            })
                          : undefined,
                      })}

                      {hasPendingChangeOrder || changeOrderUrl || customerSignedChangeOrderUrl ? (
                        <>
                          {renderDocumentCard({
                            title: `Change Order — Version ${changeOrderVersion}`,
                            url: changeOrderUrl,
                            fileName: order?.changeOrderName,
                            available: Boolean(changeOrderUrl),
                            statusText: hasPendingChangeOrder ? 'Awaiting customer signature' : 'Approved',
                            emptyLabel: 'Change Order is being prepared',
                            readOnly: true,
                            onOpen: changeOrderUrl
                              ? () => handleOpenDocumentPreview({
                                  title: `Change Order — Version ${changeOrderVersion}`,
                                  url: changeOrderUrl,
                                  fileName: order?.changeOrderName,
                                  mimeType: 'application/pdf',
                                })
                              : undefined,
                          })}

                          {renderDocumentCard({
                            title: 'Customer Signed Change Order',
                            url: customerSignedChangeOrderUrl,
                            fileName: order?.customerSignedChangeOrder,
                            available: Boolean(customerSignedChangeOrderUrl),
                            statusText: customerSignedChangeOrderUrl
                              ? 'Approved copy uploaded'
                              : 'Signature required',
                            emptyLabel: 'Upload the customer-signed change order',
                            controlsDisabled: !hasPendingChangeOrder || isUploadingShippingDocument,
                            onOpen: customerSignedChangeOrderUrl
                              ? () => handleOpenDocumentPreview({
                                  title: 'Customer Signed Change Order',
                                  url: customerSignedChangeOrderUrl,
                                  fileName: order?.customerSignedChangeOrder,
                                })
                              : undefined,
                            onUpload: hasPendingChangeOrder
                              ? () => customerSignedChangeOrderUploadInputRef.current?.click()
                              : undefined,
                          })}
                        </>
                      ) : null}

                      {renderDocumentCard({
                        title: 'Proforma Invoice',
                        url: proformaInvoiceUrl,
                        fileName: proformaInvoiceUrl ? proformaInvoiceName : null,
                        available: Boolean(proformaInvoiceUrl),
                        statusText: proformaInvoiceUrl ? 'Available' : 'Ready to generate',
                        emptyLabel: 'Use the Generate Documents button above',
                        readOnly: true,
                        onOpen: proformaInvoiceUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Proforma Invoice',
                              url: proformaInvoiceUrl,
                              fileName: proformaInvoiceName,
                              mimeType: 'application/pdf',
                            })
                          : undefined,
                      })}

                      {renderDocumentCard({
                        title: 'Shop Drawing',
                        url: shopDrawingUrl,
                        fileName: shopDrawingDisplayName,
                        available: canOpenShopDrawingDocument,
                        statusText: canOpenShopDrawingDocument ? 'Available' : 'Not uploaded',
                        emptyLabel: 'No shop drawing uploaded',
                        onOpen: order && canOpenShopDrawingDocument
                          ? () => onOpenShopDrawingDocument(order)
                          : undefined,
                        onUpload: () => shopDrawingUploadInputRef.current?.click(),
                        onDelete: () => {
                          void handleDeleteInfoDocument('shop_drawing')
                        },
                      })}

                      {renderDocumentCard({
                        title: 'Cut List',
                        url: cutListUrl,
                        fileName: cutListDisplayName,
                        available: canOpenCutListDocument,
                        statusText: canOpenCutListDocument
                          ? `${cutListDocuments.length} file${cutListDocuments.length === 1 ? '' : 's'}`
                          : 'Not uploaded',
                        emptyLabel: 'No cut list uploaded',
                        uploading: isUploadingCutList,
                        hidePreviewButton: true,
                        onOpen: canOpenCutListDocument
                          ? () => void handleOpenCutListPreview({
                              collection: cutListDocuments,
                              collectionIndex: 0,
                            })
                          : undefined,
                        onUpload: () => cutListUploadInputRef.current?.click(),
                      })}

                      {renderDocumentCard({
                        title: 'Invoice',
                        url: invoicePreviewUrl,
                        fileName: invoiceNumber ? `Invoice #${invoiceNumber}` : null,
                        available: canOpenInvoiceDocument,
                        statusText: canOpenInvoiceDocument ? 'Available' : 'Not available yet',
                        emptyLabel: canOpenInvoiceDocument
                          ? 'Invoice available'
                          : 'No invoice has been issued',
                        readOnly: true,
                        onOpen: order && canOpenInvoiceDocument
                          ? () => onOpenInvoiceDocument(order)
                          : undefined,
                      })}
                    </Box>

                    <Box sx={{ pt: 0.35 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Shipping documents
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Driver Signed BOL and Inspection Sheet are required before shipping. Customer Signed BOL appears after the Driver Signed BOL is uploaded.
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: 'grid',
                        gap: 1,
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          md: 'repeat(3, minmax(0, 1fr))',
                        },
                      }}
                    >
                      {renderDocumentCard({
                        title: 'BOL',
                        url: bolPreviewUrl,
                        fileName: 'bill-of-lading.pdf',
                        available: canOpenBolDocument,
                        statusText: canOpenBolDocument ? 'Available' : 'Not available yet',
                        emptyLabel: 'No BOL available',
                        readOnly: true,
                        hidePreviewButton: true,
                        onOpen: order && canOpenBolDocument
                          ? () => void handleOpenBolPreview()
                          : undefined,
                      })}

                      {renderDocumentCard({
                        title: 'Driver Signed BOL',
                        url: signedBolUrl,
                        fileName: signedBolDisplayName,
                        available: hasSignedBolForShipping,
                        statusText: hasSignedBolForShipping ? 'Ready' : 'Missing',
                        emptyLabel: 'Driver Signed BOL not uploaded',
                        controlsDisabled: isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder,
                        onOpen: signedBolUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Driver Signed BOL Preview',
                              url: signedBolUrl,
                              fileName: signedBolDisplayName,
                            })
                          : undefined,
                        onUpload: () => signedBolUploadInputRef.current?.click(),
                        onDelete: () => {
                          void handleDeleteShippingDocument('signed_bol')
                        },
                      })}

                      {shouldShowCustomerSignedBol ? renderDocumentCard({
                        title: 'Customer Signed BOL',
                        url: customerSignedBolUrl,
                        fileName: customerSignedBolDisplayName,
                        available: hasCustomerSignedBol,
                        statusText: hasCustomerSignedBol ? 'Ready' : 'Missing',
                        emptyLabel: 'Customer Signed BOL not uploaded',
                        controlsDisabled: !hasDriverSignedBol || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder,
                        onOpen: customerSignedBolUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Customer Signed BOL Preview',
                              url: customerSignedBolUrl,
                              fileName: customerSignedBolDisplayName,
                            })
                          : undefined,
                        onUpload: () => customerSignedBolUploadInputRef.current?.click(),
                        onDelete: () => {
                          void handleDeleteShippingDocument('customer_signed_bol')
                        },
                      }) : null}

                      {renderDocumentCard({
                        title: 'Inspection Sheet',
                        url: inspectionSheetUrl,
                        fileName: inspectionSheetDisplayName,
                        available: hasInspectionSheetForShipping,
                        statusText: hasInspectionSheetForShipping ? 'Ready' : 'Missing',
                        emptyLabel: 'Inspection sheet not uploaded',
                        controlsDisabled: isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder,
                        onOpen: inspectionSheetUrl
                          ? () => handleOpenDocumentPreview({
                              title: 'Inspection Sheet Preview',
                              url: inspectionSheetUrl,
                              fileName: inspectionSheetDisplayName,
                            })
                          : undefined,
                        onUpload: () => inspectionSheetUploadInputRef.current?.click(),
                        onDelete: () => {
                          void handleDeleteShippingDocument('inspection_sheet')
                        },
                      })}
                    </Box>

                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                      justifyContent="space-between"
                      sx={{
                        p: 1,
                        borderRadius: 1.5,
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.045),
                      }}
                    >
                      <Stack direction="row" spacing={0.65} useFlexGap flexWrap="wrap">
                        <Chip
                          size="small"
                          variant="outlined"
                          color={hasSignedBolForShipping ? 'success' : 'error'}
                          label={hasSignedBolForShipping ? 'Driver Signed BOL ready' : 'Driver Signed BOL missing'}
                        />
                        {shouldShowCustomerSignedBol ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            color={hasCustomerSignedBol ? 'success' : 'error'}
                            label={hasCustomerSignedBol ? 'Customer Signed BOL ready' : 'Customer Signed BOL missing'}
                          />
                        ) : null}
                        <Chip
                          size="small"
                          variant="outlined"
                          color={hasInspectionSheetForShipping ? 'success' : 'error'}
                          label={hasInspectionSheetForShipping ? 'Inspection ready' : 'Inspection missing'}
                        />
                        {order?.isShipped ? (
                          <Chip size="small" color="success" label="Shipped" />
                        ) : null}
                      </Stack>
                      <Button
                        size="small"
                        variant="contained"
                        color={canShipFromWebsiteFlow ? 'success' : 'error'}
                        disabled={Boolean(order?.isShipped) || isShippingOrder || isUploadingShippingDocument || isDeletingShippingDocument}
                        onClick={() => {
                          void handleShipOrder()
                        }}
                        sx={{ minWidth: 104 }}
                      >
                        {order?.isShipped ? 'Shipped' : isShippingOrder ? 'Shipping...' : 'Ship Order'}
                      </Button>
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      Files are loaded only when opened. This prevents automatic downloads when viewing an order.
                    </Typography>
                  </Stack>
                </Paper>
              </Stack>
            ) : null}
          </Stack>
        )}

        <Dialog
          open={isChangeOrderEditorOpen}
          onClose={() => {
            if (!isCreatingChangeOrder) setIsChangeOrderEditorOpen(false)
          }}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle>
            Create Change Version {Number(order?.pendingChangeVersion || (order?.changeVersion ?? 0) + 1)}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.5}>
              <Alert severity="info">
                The order number stays {order?.orderNumber}. These changes remain pending until the customer-signed change order is uploaded.
              </Alert>
              {changeOrderActionError ? <Alert severity="error">{changeOrderActionError}</Alert> : null}
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell sx={{ width: 150 }}>Type</TableCell>
                      <TableCell sx={{ width: 100 }}>Qty</TableCell>
                      <TableCell sx={{ width: 130 }}>Unit price</TableCell>
                      <TableCell align="right" sx={{ width: 125 }}>Extended</TableCell>
                      <TableCell sx={{ width: 52 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {changeOrderDraftLines.map((line, index) => {
                      const extended = Number(line.qty || 0) * Number(line.unitPrice || 0)
                      return (
                        <TableRow key={line.id || index}>
                          <TableCell>
                            <TextField
                              fullWidth
                              size="small"
                              value={line.description}
                              onChange={(event) => setChangeOrderDraftLines((current) =>
                                current.map((entry, entryIndex) => entryIndex === index
                                  ? { ...entry, description: event.target.value }
                                  : entry)
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              select
                              fullWidth
                              size="small"
                              value={line.category}
                              onChange={(event) => setChangeOrderDraftLines((current) =>
                                current.map((entry, entryIndex) => entryIndex === index
                                  ? { ...entry, category: event.target.value as typeof entry.category }
                                  : entry)
                              )}
                            >
                              <MenuItem value="product">Product</MenuItem>
                              <MenuItem value="additional">Additional</MenuItem>
                              <MenuItem value="freight">Freight</MenuItem>
                            </TextField>
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              value={line.qty ?? 0}
                              inputProps={{ min: 0, step: 1 }}
                              onChange={(event) => setChangeOrderDraftLines((current) =>
                                current.map((entry, entryIndex) => entryIndex === index
                                  ? { ...entry, qty: Math.max(0, Number(event.target.value) || 0) }
                                  : entry)
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              value={line.unitPrice ?? 0}
                              inputProps={{ min: 0, step: 0.01 }}
                              onChange={(event) => setChangeOrderDraftLines((current) =>
                                current.map((entry, entryIndex) => entryIndex === index
                                  ? { ...entry, unitPrice: Math.max(0, Number(event.target.value) || 0) }
                                  : entry)
                              )}
                            />
                          </TableCell>
                          <TableCell align="right">{formatCurrency(extended)}</TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label="Remove line"
                              onClick={() => setChangeOrderDraftLines((current) =>
                                current.filter((_, entryIndex) => entryIndex !== index)
                              )}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button
                  startIcon={<AddRoundedIcon />}
                  onClick={() => setChangeOrderDraftLines((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      description: '',
                      qty: 1,
                      unitPrice: 0,
                      extPrice: 0,
                      category: 'product',
                    },
                  ])}
                >
                  Add Line
                </Button>
                <Typography fontWeight={800}>
                  Revised total: {formatCurrency(changeOrderDraftLines.reduce(
                    (sum, line) => sum + Number(line.qty || 0) * Number(line.unitPrice || 0),
                    0,
                  ))}
                </Typography>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setIsChangeOrderEditorOpen(false)}
              disabled={isCreatingChangeOrder}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleCreateChangeOrder()}
              disabled={isCreatingChangeOrder}
              startIcon={isCreatingChangeOrder ? <CircularProgress size={16} /> : <PictureAsPdfRoundedIcon />}
            >
              {isCreatingChangeOrder ? 'Creating…' : 'Create Change Order'}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(documentPreviewUrl)}
          onClose={handleCloseDocumentPreview}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle>{documentPreviewTitle}</DialogTitle>
          <DialogContent dividers>
            {isLoadingDocumentPreview ? (
              <Stack alignItems="center" justifyContent="center" spacing={1.25} sx={{ minHeight: '55vh' }}>
                <CircularProgress size={30} />
                <Typography variant="body2" color="text.secondary">
                  Loading Cut List preview…
                </Typography>
              </Stack>
            ) : documentPreviewMode === 'image' ? (
              <Box
                component="img"
                src={documentPreviewUrl}
                alt={documentPreviewTitle}
                sx={{
                  display: 'block',
                  width: '100%',
                  maxHeight: '70vh',
                  objectFit: 'contain',
                }}
              />
            ) : documentPreviewMode === 'pdf' ? (
              <Box
                component="iframe"
                src={`${documentPreviewUrl}#toolbar=0&navpanes=0`}
                title={documentPreviewTitle}
                sx={{
                  width: '100%',
                  height: '70vh',
                  border: 0,
                }}
              />
            ) : (
              <Stack spacing={1.2}>
                <Typography variant="body2" color="text.secondary">
                  Inline preview is not available for this file type.
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => {
                    if (documentPreviewCollection.length > 0) {
                      void handlePrintDocumentPreview()
                    } else {
                      window.open(documentPreviewUrl, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {documentPreviewCollection.length > 0 ? 'Print' : 'Open in New Tab'}
                </Button>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            {documentPreviewCollection.length > 1 ? (
              <>
                <Button
                  startIcon={<NavigateBeforeRoundedIcon />}
                  onClick={() => handleNavigateDocumentPreview(-1)}
                >
                  Previous
                </Button>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 0.75, fontWeight: 750 }}
                >
                  {documentPreviewIndex + 1} of {documentPreviewCollection.length}
                </Typography>
                <Button
                  endIcon={<NavigateNextRoundedIcon />}
                  onClick={() => handleNavigateDocumentPreview(1)}
                >
                  Next
                </Button>
              </>
            ) : null}
            <Box sx={{ flex: 1 }} />
            {documentPreviewCollection.length > 0 || documentPreviewMode === 'pdf' ? (
              <>
                {documentPreviewCollection.length > 0 && canManageOrderDocuments ? (
                  <IconButton
                    color="error"
                    aria-label="Delete this cut list"
                    disabled={isDeletingCutList}
                    onClick={() => {
                      void handleDeleteCurrentCutList()
                    }}
                  >
                    {isDeletingCutList
                      ? <CircularProgress size={20} color="inherit" />
                      : <DeleteOutlineRoundedIcon />}
                  </IconButton>
                ) : null}
                <Button
                  onClick={() => {
                    void handlePrintDocumentPreview()
                  }}
                  disabled={isPrintingDocumentPreview}
                >
                  {isPrintingDocumentPreview ? 'Preparing…' : 'Print'}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  if (documentPreviewUrl) {
                    window.open(documentPreviewUrl, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                Open in New Tab
              </Button>
            )}
            <Button onClick={handleCloseDocumentPreview}>Close</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(selectedOrderPhoto)}
          onClose={() => setSelectedOrderPhoto(null)}
          maxWidth="lg"
          fullWidth
          PaperProps={{ sx: { bgcolor: '#101820', overflow: 'hidden' } }}
        >
          <DialogTitle sx={{ color: '#fff', py: 1.25 }}>
            Order {orderPhotoDisplayNumber} picture
          </DialogTitle>
          <DialogContent sx={{ p: { xs: 1, sm: 1.5 }, display: 'grid', placeItems: 'center' }}>
            {selectedOrderPhoto ? (
              <Box
                component="img"
                src={selectedOrderPhoto.url}
                alt={`Order ${orderPhotoDisplayNumber} picture`}
                sx={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '76vh',
                  objectFit: 'contain',
                  borderRadius: 1,
                }}
              />
            ) : null}
          </DialogContent>
          <DialogActions sx={{ bgcolor: '#101820' }}>
            <Button
              color="inherit"
              sx={{ color: '#fff' }}
              onClick={() => setSelectedOrderPhoto(null)}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>

        <input
          ref={shopDrawingUploadInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadInfoDocument('shop_drawing', file)
            }

            event.currentTarget.value = ''
          }}
        />

        <input
          ref={cutListUploadInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])

            if (files.length > 0) {
              void (async () => {
                for (const file of files) {
                  await handleUploadInfoDocument('cut_list', file)
                }
              })()
            }

            event.currentTarget.value = ''
          }}
        />

        <input
          ref={signedBolUploadInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadShippingDocument('signed_bol', file)
            }

            event.currentTarget.value = ''
          }}
        />

        <input
          ref={customerSignedBolUploadInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadShippingDocument('customer_signed_bol', file)
            }

            event.currentTarget.value = ''
          }}
        />

        <input
          ref={customerSignedChangeOrderUploadInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadShippingDocument('customer_signed_change_order', file)
            }

            event.currentTarget.value = ''
          }}
        />

        <input
          ref={inspectionSheetUploadInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadShippingDocument('inspection_sheet', file)
            }

            event.currentTarget.value = ''
          }}
        />
      </DialogContent>
      <DialogActions
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          px: 2.5,
          py: 1.1,
        }}
      >
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
