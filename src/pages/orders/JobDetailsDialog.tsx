import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mention, MentionsInput } from 'react-mentions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import {
  createOrderChatMessage,
  fetchOrderChats,
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
  postOrdersShip,
  postOrdersShippingDocumentDelete,
  postOrdersShippingDocumentUpload,
  removeOrderChatMessage,
  postOrdersOrderNumberUpdate,
  type OrdersShippingDocumentType,
  type OrdersChatUser,
  type OrdersJobDetailEntry,
  ordersJobDetailsQueryKey,
  ordersChatMessagesQueryKey,
  type OrdersJobDetailsResponse,
  type OrdersOverviewOrder,
} from '../../features/orders/api'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
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

export type JobDetailsTab = 'hours' | 'shipping' | 'info' | 'warranty' | 'chat'

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
  onOpenCutListDocument,
  onOpenInvoiceDocument,
  onClose,
}: JobDetailsDialogProps) {
  const { appUser, firebaseUser } = useAuth()
  const queryClient = useQueryClient()
  const enabled = open && Boolean(order?.mondayItemId || order?.jobNumber || order?.orderName)
  const orderChatId = String(order?.id ?? '').trim()
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
  const inspectionSheetUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [isShippingDocumentsEditMode, setIsShippingDocumentsEditMode] = useState(false)
  const [shippingUploadInFlightType, setShippingUploadInFlightType] = useState<OrdersShippingDocumentType | ''>('')
  const [shippingDeleteInFlightType, setShippingDeleteInFlightType] = useState<OrdersShippingDocumentType | ''>('')
  const [isShippingOrder, setIsShippingOrder] = useState(false)
  const [shippingActionError, setShippingActionError] = useState<string | null>(null)
  const [shippingActionSuccess, setShippingActionSuccess] = useState<string | null>(null)
  const [uploadedSignedBolUrl, setUploadedSignedBolUrl] = useState<string | null>(null)
  const [uploadedInspectionSheetUrl, setUploadedInspectionSheetUrl] = useState<string | null>(null)
  const [uploadedSignedBolName, setUploadedSignedBolName] = useState<string | null>(null)
  const [uploadedInspectionSheetName, setUploadedInspectionSheetName] = useState<string | null>(null)
  const [signedBolDeletedLocally, setSignedBolDeletedLocally] = useState(false)
  const [inspectionSheetDeletedLocally, setInspectionSheetDeletedLocally] = useState(false)
  const [isUploadingShopDrawing, setIsUploadingShopDrawing] = useState(false)
  const [isDeletingShopDrawing, setIsDeletingShopDrawing] = useState(false)
  const [isUploadingCutList, setIsUploadingCutList] = useState(false)
  const [isDeletingCutList, setIsDeletingCutList] = useState(false)
  const [uploadedShopDrawingUrl, setUploadedShopDrawingUrl] = useState<string | null>(null)
  const [uploadedCutListUrl, setUploadedCutListUrl] = useState<string | null>(null)
  const [uploadedShopDrawingName, setUploadedShopDrawingName] = useState<string | null>(null)
  const [uploadedCutListName, setUploadedCutListName] = useState<string | null>(null)
  const [shopDrawingDeletedLocally, setShopDrawingDeletedLocally] = useState(false)
  const [cutListDeletedLocally, setCutListDeletedLocally] = useState(false)
  const [infoDocumentActionError, setInfoDocumentActionError] = useState<string | null>(null)
  const [infoDocumentActionSuccess, setInfoDocumentActionSuccess] = useState<string | null>(null)
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState('')
  const [documentPreviewTitle, setDocumentPreviewTitle] = useState('Document Preview')
  const [documentPreviewMode, setDocumentPreviewMode] = useState<DocumentPreviewMode>('unsupported')
  const [isManagerEditMode, setIsManagerEditMode] = useState(false)
  const [isSavingManagerEdit, setIsSavingManagerEdit] = useState(false)
  const [managerEditError, setManagerEditError] = useState<string | null>(null)
  const [managerEditSuccess, setManagerEditSuccess] = useState<string | null>(null)
  const [managerEditWarning, setManagerEditWarning] = useState<string | null>(null)
  const [orderNameDraft, setOrderNameDraft] = useState('')
  const [poNumberDraft, setPoNumberDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
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
  const [warrantyActionSuccess, setWarrantyActionSuccess] = useState<string | null>(null)

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

    setDetailsTab(initialTab)
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
    setUploadedInspectionSheetUrl(null)
    setUploadedSignedBolName(null)
    setUploadedInspectionSheetName(null)
    setSignedBolDeletedLocally(false)
    setInspectionSheetDeletedLocally(false)
    setIsUploadingShopDrawing(false)
    setIsDeletingShopDrawing(false)
    setIsUploadingCutList(false)
    setIsDeletingCutList(false)
    setUploadedShopDrawingUrl(null)
    setUploadedCutListUrl(null)
    setUploadedShopDrawingName(null)
    setUploadedCutListName(null)
    setShopDrawingDeletedLocally(false)
    setCutListDeletedLocally(false)
    setInfoDocumentActionError(null)
    setInfoDocumentActionSuccess(null)
    setDocumentPreviewUrl('')
    setDocumentPreviewTitle('Document Preview')
    setDocumentPreviewMode('unsupported')
    setIsManagerEditMode(false)
    setIsSavingManagerEdit(false)
    setManagerEditError(null)
    setManagerEditSuccess(null)
    setManagerEditWarning(null)
    setOrderNameDraft(String(order?.orderName ?? '').trim())
    setPoNumberDraft(String(order?.poNumber ?? '').trim())
    setNotesDraft(String(order?.notes ?? '').trim())
    setDescriptionDraft(String(order?.description ?? '').trim())
    setOrderDateDraft(normalizeDateInputValue(order?.orderDate ?? ''))
    setLeadTimeDateDraft(normalizeDateInputValue(order?.dueDate ?? ''))
    setPodDateDraft(normalizeDateInputValue(order?.shippedAt ?? ''))
    const nextWarrantyState = buildOrderWarrantyState(order)
    setWarrantyState(nextWarrantyState)
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
  const description = String(order?.description ?? '').trim()
  const notes = String(order?.notes ?? '').trim()
  const bolUrl = resolveBolUrl(order)
  const shopDrawingUrlFromOrder = resolveShopDrawingUrl(order)
  const cutListUrlFromOrder = resolveCutListUrl(order)
  const shopDrawingUrl = shopDrawingDeletedLocally
    ? null
    : uploadedShopDrawingUrl || shopDrawingUrlFromOrder || null
  const cutListUrl = cutListDeletedLocally
    ? null
    : uploadedCutListUrl || cutListUrlFromOrder || null
  const shopDrawingDisplayName = shopDrawingDeletedLocally
    ? null
    : uploadedShopDrawingName || 'shop-drawing.pdf'
  const cutListDisplayName = cutListDeletedLocally
    ? null
    : uploadedCutListName || 'cut-list.pdf'
  const invoiceNumber = String(order?.invoiceNumber ?? '').trim()
  const invoicePreviewUrl = String(order?.invoiceCachedUrl ?? '').trim()
  const depositRequestUrl = String(order?.depositRequestUrl ?? '').trim()
  const orderConfirmationUrl = String(order?.orderConfirmationUrl ?? '').trim()
  const hasBolText = Boolean(String(order?.bol ?? '').trim())
  const signedBolUrl = signedBolDeletedLocally
    ? null
    : uploadedSignedBolUrl || String(order?.signedBolUrl ?? '').trim() || null
  const inspectionSheetUrl = inspectionSheetDeletedLocally
    ? null
    : uploadedInspectionSheetUrl || String(order?.inspectionSheetUrl ?? '').trim() || null
  const signedBolDisplayName = signedBolDeletedLocally
    ? null
    : uploadedSignedBolName || String(order?.signedBol ?? '').trim() || null
  const inspectionSheetDisplayName = inspectionSheetDeletedLocally
    ? null
    : uploadedInspectionSheetName || String(order?.inspectionSheet ?? '').trim() || null
  const hasMondayItemId = Boolean(String(order?.mondayItemId ?? '').trim())
  const canOpenBolDocument = Boolean(bolUrl || (hasBolText && hasMondayItemId))
  const hasSignedBolForShipping = Boolean(signedBolUrl)
  const hasInspectionSheetForShipping = Boolean(inspectionSheetUrl)
  const canShipFromWebsiteFlow = hasSignedBolForShipping && hasInspectionSheetForShipping
  const isUploadingSignedBol = shippingUploadInFlightType === 'signed_bol'
  const isUploadingInspectionSheet = shippingUploadInFlightType === 'inspection_sheet'
  const isDeletingSignedBol = shippingDeleteInFlightType === 'signed_bol'
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
  const canEditOrderNumber =
    canManageOrderMetadata
    && hasMondayRecord
    && Boolean(String(order?.mondayItemId ?? '').trim())
  const isWarrantyActionInFlight =
    isSavingWarrantyIssue || isSavingWarrantyLeadTime || isMarkingWarrantyDone
  const canManageWarrantyIssue = Boolean(order?.isShipped && String(order?.mondayItemId ?? '').trim())
  const canCreateWarrantyIssue = canManageWarrantyIssue && !warrantyState.issueActive
  const canUpdateWarrantyLeadTime = canManageWarrantyIssue && warrantyState.issueActive

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
            height: 128,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            px: 1,
            textAlign: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
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
            height: 128,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            objectFit: 'cover',
            display: 'block',
            bgcolor: 'action.hover',
          }}
        />
      )
    }

    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        spacing={0.45}
        sx={{
          height: 128,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#ffffff',
          px: 1,
          textAlign: 'center',
        }}
      >
        <PictureAsPdfRoundedIcon sx={{ color: 'error.main' }} />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          PDF preview available on click
        </Typography>
      </Stack>
    )
  }

  const resetManagerEditDraftsFromOrder = () => {
    setOrderNameDraft(String(order?.orderName ?? '').trim())
    setPoNumberDraft(String(order?.poNumber ?? '').trim())
    setNotesDraft(String(order?.notes ?? '').trim())
    setDescriptionDraft(String(order?.description ?? '').trim())
    setOrderDateDraft(normalizeDateInputValue(order?.orderDate ?? ''))
    setLeadTimeDateDraft(normalizeDateInputValue(order?.dueDate ?? ''))
    setPodDateDraft(normalizeDateInputValue(order?.shippedAt ?? ''))
  }

  const handleStartManagerEdit = () => {
    if (!canManageOrderMetadata || isSavingManagerEdit) {
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

    if (!canManageOrderMetadata) {
      setManagerEditError('Only managers and admins can edit these fields.')
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
        orderDate: String(orderDateDraft ?? '').trim(),
        dueDate: String(leadTimeDateDraft ?? '').trim(),
        podDate: String(podDateDraft ?? '').trim(),
      })

      setOrderNameDraft(String(response.order.orderName ?? '').trim())
      setPoNumberDraft(String(response.order.poNumber ?? '').trim())
      setNotesDraft(String(response.order.notes ?? '').trim())
      setDescriptionDraft(String(response.order.description ?? '').trim())
      setOrderDateDraft(normalizeDateInputValue(response.order.orderDate ?? ''))
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

    if (!mondayItemId) {
      setWarrantyActionError('Monday item id is missing for this order.')
      return
    }

    if (!descriptionValue) {
      setWarrantyActionError('Issue description is required.')
      return
    }

    setIsSavingWarrantyIssue(true)
    setWarrantyActionError(null)
    setWarrantyActionSuccess(null)

    try {
      const response = await postOrdersWarrantyIssueCreate({
        mondayItemId,
        description: descriptionValue,
      })

      applyWarrantyOrderPayload(response.order)
      setWarrantyActionSuccess('Warranty issue added.')

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
    if (!order || isUploadingShippingDocument || isDeletingShippingDocument) {
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
  }: {
    title: string
    url: string | null | undefined
    fileName?: string | null
    mimeType?: string | null
  }) => {
    const normalizedUrl = String(url ?? '').trim()
    const previewUrl = toInlinePreviewUrl(normalizedUrl)

    if (!previewUrl) {
      return
    }

    setDocumentPreviewTitle(title)
    setDocumentPreviewUrl(previewUrl)
    setDocumentPreviewMode(resolveDocumentPreviewMode({
      fileName,
      mimeType,
      url: previewUrl,
    }))
  }

  const handleCloseDocumentPreview = () => {
    setDocumentPreviewUrl('')
    setDocumentPreviewTitle('Document Preview')
    setDocumentPreviewMode('unsupported')
  }

  const handleDeleteShippingDocument = async (documentType: OrdersShippingDocumentType) => {
    if (!order || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder) {
      return
    }

    const mondayItemId = String(order.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setShippingActionError('Monday item id is missing for this order.')
      return
    }

    const shouldContinue = window.confirm(
      documentType === 'signed_bol'
        ? 'Delete Signed BOL from this order?'
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
      const nextInspectionSheetUrl = response.order.inspectionSheetUrl || null

      setUploadedSignedBolUrl(nextSignedBolUrl)
      setUploadedSignedBolName(response.order.signedBol || null)
      setSignedBolDeletedLocally(!nextSignedBolUrl)

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
    if (!order || !canManageOrderMetadata || isUpdatingInfoDocument || isSavingManagerEdit) {
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
        setCutListDeletedLocally(!nextUrl)
        setInfoDocumentActionSuccess('Cut list updated.')

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
    }
  }

  const handleDeleteInfoDocument = async (documentType: 'shop_drawing' | 'cut_list') => {
    if (!order || !canManageOrderMetadata || isUpdatingInfoDocument || isSavingManagerEdit) {
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

    if (documentType === 'shop_drawing') {
      setIsDeletingShopDrawing(true)
    } else {
      setIsDeletingCutList(true)
    }

    try {
      if (documentType === 'shop_drawing') {
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
      } else {
        const response = await postOrdersCutListDelete({ mondayItemId })
        const nextUrl = String(response.order.cutListCachedUrl ?? '').trim()
          || String(response.order.cutListUrl ?? '').trim()
          || null

        setUploadedCutListUrl(nextUrl)
        setUploadedCutListName(null)
        setCutListDeletedLocally(!nextUrl)
        setInfoDocumentActionSuccess('Cut list deleted.')

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
          : `Could not delete ${documentType === 'shop_drawing' ? 'shop drawing' : 'cut list'}.`,
      )
    } finally {
      if (documentType === 'shop_drawing') {
        setIsDeletingShopDrawing(false)
      } else {
        setIsDeletingCutList(false)
      }
    }
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
      setShippingActionError('Upload Signed BOL and Inspection Sheet before shipping.')
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
          height: { xs: '90vh', md: '82vh' },
          maxHeight: { xs: '90vh', md: '82vh' },
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          pb: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack spacing={0.35}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              fontSize: { xs: '1.2rem', md: '1.4rem' },
              lineHeight: 1.2,
            }}
          >
            {mode === 'history' ? 'Manager Status History' : 'Order Details'}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {order?.parentOrderNumber ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Linked to order {order.parentOrderNumber} · QuickBooks activity uses that order's project
            </Typography>
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent
        sx={{
          overflowY: 'auto',
          pt: 1.5,
          pb: 1.25,
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
          <Stack spacing={1.75} sx={{ pt: 0.5 }}>
            <Tabs
              value={detailsTab}
              onChange={(_event, value: JobDetailsTab) => {
                setDetailsTab(value)
              }}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: 44,
                borderBottom: '1px solid',
                borderColor: 'divider',
                pb: 0.25,
                '& .MuiTab-root': {
                  minHeight: 44,
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: { xs: 14, md: 15 },
                  px: 1.5,
                  py: 0.75,
                },
                '& .MuiTabs-indicator': {
                  height: 3,
                  borderRadius: 2,
                },
              }}
            >
              <Tab value="info" label="Info" />
              <Tab value="hours" label="Hours" />
              <Tab value="shipping" label="Shipping" />
              <Tab value="warranty" label="Warranty" />
              <Tab value="chat" label="Chat" />
            </Tabs>

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
                    <Chip
                      label={`Labor: ${formatCurrency(detailsQuery.data.summary.totalLaborCost, 2)}`}
                      variant="outlined"
                    />
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
                                          <TableCell>Labor Cost</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {workerRowsForDay.map((workerRow) => (
                                          <TableRow key={`${dateKey}-${workerRow.workerName}`} hover>
                                            <TableCell>{workerRow.workerName}</TableCell>
                                            <TableCell>{workerRow.regularHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.overtimeHours.toFixed(2)}</TableCell>
                                            <TableCell>{workerRow.totalHours.toFixed(2)}</TableCell>
                                            <TableCell>{formatCurrency(workerRow.laborCost, 2)}</TableCell>
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
                                        <TableCell>Rate</TableCell>
                                        <TableCell>Labor Cost</TableCell>
                                        <TableCell>Notes</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {dayEntries.length === 0 ? (
                                        <TableRow>
                                          <TableCell colSpan={8} align="center">
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
                                            <TableCell>{formatCurrency(entry.rate, 2)}</TableCell>
                                            <TableCell>{formatCurrency(entry.laborCost, 2)}</TableCell>
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
              <Stack spacing={1.25}>
                {shippingActionSuccess ? (
                  <Alert severity="success">{shippingActionSuccess}</Alert>
                ) : null}

                {shippingActionError ? (
                  <Alert severity="error">{shippingActionError}</Alert>
                ) : null}

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Shipping Address
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {shipTo || '—'}
                    </Typography>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
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
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Shipping Notes
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {shipNotes || '—'}
                    </Typography>
                  </Stack>
                </Paper>

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
                        disabled={!canManageOrderMetadata || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
                      >
                        {isShippingDocumentsEditMode ? 'Done Editing' : 'Edit'}
                      </Button>
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                      {isShippingDocumentsEditMode
                        ? 'Edit mode is on. Signed BOL and Inspection Sheet are one file each; you can replace or delete them.'
                        : 'Preview files below. Signed BOL and Inspection Sheet are one file each.'}
                    </Typography>

                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      <Chip
                        size="small"
                        variant="outlined"
                        color={hasSignedBolForShipping ? 'success' : 'error'}
                        label={hasSignedBolForShipping ? 'Signed BOL: Ready' : 'Signed BOL: Missing'}
                      />
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
                        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                      }}
                    >
                      <Paper variant="outlined" sx={{ p: 1.1 }}>
                        <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              BOL
                            </Typography>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={canOpenBolDocument ? 'success' : 'default'}
                              label={canOpenBolDocument ? 'Available' : 'Missing'}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 36 }}>
                            {hasBolText
                              ? 'Bill of lading is available for preview.'
                              : 'No bill of lading is available yet.'}
                          </Typography>
                          {renderInlineDocumentMiniPreview({
                            url: bolUrl,
                            fileName: String(order?.bol ?? '').trim() || null,
                            emptyLabel: 'No BOL preview yet',
                          })}
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<VisibilityRoundedIcon fontSize="small" />}
                            disabled={!canOpenBolDocument || !order || isShippingOrder}
                            onClick={() => {
                              if (!order) {
                                return
                              }

                              if (bolUrl) {
                                handleOpenDocumentPreview({
                                  title: 'BOL Preview',
                                  url: bolUrl,
                                  fileName: String(order.bol ?? '').trim() || null,
                                })
                                return
                              }

                              onOpenBolDocument(order)
                            }}
                          >
                            Preview
                          </Button>
                        </Stack>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1.1 }}>
                        <Stack spacing={0.9}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Signed BOL
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
                            emptyLabel: 'Signed BOL not uploaded',
                          })}
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<VisibilityRoundedIcon fontSize="small" />}
                              disabled={!signedBolUrl || isUploadingShippingDocument || isDeletingShippingDocument}
                              onClick={() => {
                                handleOpenDocumentPreview({
                                  title: 'Signed BOL Preview',
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
                                  disabled={!canManageOrderMetadata || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
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
                                  disabled={!canManageOrderMetadata || !hasSignedBolForShipping || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
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
                                  disabled={!canManageOrderMetadata || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
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
                                  disabled={!canManageOrderMetadata || !hasInspectionSheetForShipping || isUploadingShippingDocument || isDeletingShippingDocument || isShippingOrder}
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

                    {!canManageOrderMetadata ? (
                      <Typography variant="caption" color="text.secondary">
                        Only managers and admins can edit attachments.
                      </Typography>
                    ) : null}

                    {!canShipFromWebsiteFlow ? (
                      <Typography variant="caption" color="error.main">
                        Ship requires uploaded Signed BOL and Inspection Sheet.
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
                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Warranty
                    </Typography>

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
                          Add a warranty issue to move this order into the Warranty tab.
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

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button
                            variant="contained"
                            onClick={() => {
                              void handleCreateWarrantyIssue()
                            }}
                            disabled={!canCreateWarrantyIssue || isWarrantyActionInFlight}
                            sx={{ minWidth: 130 }}
                          >
                            {isSavingWarrantyIssue ? 'Saving...' : 'Add Issue'}
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
              <Stack spacing={1.25}>
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

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        All Information
                      </Typography>

                      {canManageOrderMetadata ? (
                        isManagerEditMode ? (
                          <Stack direction="row" spacing={0.75}>
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
                              disabled={isSavingManagerEdit || !canManageOrderMetadata}
                              startIcon={isSavingManagerEdit ? <CircularProgress size={14} /> : null}
                              sx={{ minWidth: 84 }}
                            >
                              Save
                            </Button>
                          </Stack>
                        ) : (
                          <IconButton
                            size="small"
                            onClick={handleStartManagerEdit}
                            disabled={!canManageOrderMetadata || !hasMondayRecord || isSavingManagerEdit}
                            sx={{ border: '1px solid', borderColor: 'divider' }}
                          >
                            <EditRoundedIcon fontSize="small" />
                          </IconButton>
                        )
                      ) : null}
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

                    {isManagerEditMode ? (
                      <Stack spacing={1}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <TextField
                            size="small"
                            label="Order number"
                            value={orderNumberDraft}
                            onChange={(event) => setOrderNumberDraft(event.target.value)}
                            disabled={!canEditOrderNumber || isSavingManagerEdit}
                            fullWidth
                          />
                          <TextField
                            size="small"
                            label="Order name"
                            value={orderNameDraft}
                            onChange={(event) => setOrderNameDraft(event.target.value)}
                            disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                            fullWidth
                          />
                        </Stack>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <TextField
                            size="small"
                            label="PO number"
                            value={poNumberDraft}
                            onChange={(event) => setPoNumberDraft(event.target.value)}
                            disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                            fullWidth
                          />
                          <TextField
                            size="small"
                            label="Order date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={orderDateDraft}
                            onChange={(event) => setOrderDateDraft(event.target.value)}
                            disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                            fullWidth
                          />
                        </Stack>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <TextField
                            size="small"
                            label="Lead time"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={leadTimeDateDraft}
                            onChange={(event) => setLeadTimeDateDraft(event.target.value)}
                            disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                            fullWidth
                          />
                          <TextField
                            size="small"
                            label="POD date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={podDateDraft}
                            onChange={(event) => setPodDateDraft(event.target.value)}
                            disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                            fullWidth
                          />
                        </Stack>

                        <TextField
                          size="small"
                          label="Notes"
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                          disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                          fullWidth
                          multiline
                          minRows={3}
                        />

                        <TextField
                          size="small"
                          label="Description"
                          value={descriptionDraft}
                          onChange={(event) => setDescriptionDraft(event.target.value)}
                          disabled={!isManagerEditMode || isSavingManagerEdit || !canManageOrderMetadata}
                          fullWidth
                          multiline
                          minRows={3}
                        />
                      </Stack>
                    ) : (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          Information is read-only until a manager uses the pencil icon.
                        </Typography>

                        <Box
                          sx={{
                            display: 'grid',
                            gap: 0.8,
                            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                          }}
                      >
                      {depositRequestUrl ? (
                        <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                          <Stack spacing={0.7}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Deposit Request</Typography>
                            <Box sx={{ cursor: 'pointer' }} onClick={() => handleOpenDocumentPreview({ title: 'Deposit Request', url: depositRequestUrl, fileName: order?.depositRequestName || 'deposit-request.pdf', mimeType: 'application/pdf' })}>
                              {renderInlineDocumentMiniPreview({ url: depositRequestUrl, fileName: order?.depositRequestName || 'deposit-request.pdf', emptyLabel: 'Open deposit request' })}
                            </Box>
                            <Typography variant="caption" color="text.secondary">{order?.depositRequestName || 'Deposit Request PDF'}</Typography>
                          </Stack>
                        </Paper>
                      ) : null}

                      {orderConfirmationUrl ? (
                        <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                          <Stack spacing={0.7}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Order Confirmation</Typography>
                            <Box sx={{ cursor: 'pointer' }} onClick={() => handleOpenDocumentPreview({ title: 'Order Confirmation', url: orderConfirmationUrl, fileName: order?.orderConfirmationName || 'order-confirmation.pdf', mimeType: 'application/pdf' })}>
                              {renderInlineDocumentMiniPreview({ url: orderConfirmationUrl, fileName: order?.orderConfirmationName || 'order-confirmation.pdf', emptyLabel: 'Open order confirmation' })}
                            </Box>
                            <Typography variant="caption" color="text.secondary">{order?.orderConfirmationName || 'Order Confirmation PDF'}</Typography>
                          </Stack>
                        </Paper>
                      ) : null}

                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">Order number</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{orderNumberDraft || '—'}</Typography>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">Order name</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{orderNameDraft || '—'}</Typography>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">PO number</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{poNumberDraft || '—'}</Typography>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">Order date</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{orderDateDraft || '—'}</Typography>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">Lead time</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{leadTimeDateDraft || '—'}</Typography>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary">POD date</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{podDateDraft || '—'}</Typography>
                          </Paper>
                        </Box>

                        <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                          <Typography variant="caption" color="text.secondary">Description</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {description || '—'}
                          </Typography>
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                          <Typography variant="caption" color="text.secondary">Notes</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {notes || '—'}
                          </Typography>
                        </Paper>
                      </>
                    )}

                    {!canManageOrderMetadata ? (
                      <Typography variant="caption" color="text.secondary">
                        Only managers and admins can edit with the pencil icon.
                      </Typography>
                    ) : null}

                    {canManageOrderMetadata && !hasMondayRecord ? (
                      <Typography variant="caption" color="text.secondary">
                        Only Monday-linked orders can be edited.
                      </Typography>
                    ) : null}
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack spacing={0.85}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Documents
                    </Typography>

                    {infoDocumentActionError ? (
                      <Alert severity="error">{infoDocumentActionError}</Alert>
                    ) : null}

                    {infoDocumentActionSuccess ? (
                      <Alert severity="success">{infoDocumentActionSuccess}</Alert>
                    ) : null}

                    <Typography variant="body2" color="text.secondary">
                      Click any box to open full preview.
                    </Typography>

                    <Box
                      sx={{
                        display: 'grid',
                        gap: 0.8,
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                      }}
                    >
                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                        <Stack spacing={0.7}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Shop Drawing
                          </Typography>
                          <Box
                            sx={{ position: 'relative', cursor: canOpenShopDrawingDocument ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!order || !canOpenShopDrawingDocument) {
                                return
                              }

                              onOpenShopDrawingDocument(order)
                            }}
                          >
                            {renderInlineDocumentMiniPreview({
                              url: shopDrawingUrl,
                              fileName: shopDrawingDisplayName,
                              emptyLabel: 'No preview available',
                            })}

                            {canManageOrderMetadata ? (
                              <Stack
                                direction="row"
                                spacing={0.4}
                                sx={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  p: 0.3,
                                  borderRadius: 1,
                                  bgcolor: alpha('#ffffff', 0.92),
                                }}
                                onClick={(event) => {
                                  event.stopPropagation()
                                }}
                              >
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    shopDrawingUploadInputRef.current?.click()
                                  }}
                                  disabled={isUpdatingInfoDocument || isSavingManagerEdit}
                                >
                                  <UploadFileRoundedIcon fontSize="small" />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    void handleDeleteInfoDocument('shop_drawing')
                                  }}
                                  disabled={!shopDrawingUrl || isUpdatingInfoDocument || isSavingManagerEdit}
                                >
                                  <DeleteOutlineRoundedIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            ) : null}
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {shopDrawingDisplayName || 'No file attached'}
                          </Typography>
                        </Stack>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                        <Stack spacing={0.7}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Cut List
                          </Typography>
                          <Box
                            sx={{ position: 'relative', cursor: canOpenCutListDocument ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!order || !canOpenCutListDocument) {
                                return
                              }

                              onOpenCutListDocument(order)
                            }}
                          >
                            {renderInlineDocumentMiniPreview({
                              url: cutListUrl,
                              fileName: cutListDisplayName,
                              emptyLabel: 'No preview available',
                            })}

                            {canManageOrderMetadata ? (
                              <Stack
                                direction="row"
                                spacing={0.4}
                                sx={{
                                  position: 'absolute',
                                  top: 6,
                                  right: 6,
                                  p: 0.3,
                                  borderRadius: 1,
                                  bgcolor: alpha('#ffffff', 0.92),
                                }}
                                onClick={(event) => {
                                  event.stopPropagation()
                                }}
                              >
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    cutListUploadInputRef.current?.click()
                                  }}
                                  disabled={isUpdatingInfoDocument || isSavingManagerEdit}
                                >
                                  <UploadFileRoundedIcon fontSize="small" />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    void handleDeleteInfoDocument('cut_list')
                                  }}
                                  disabled={!cutListUrl || isUpdatingInfoDocument || isSavingManagerEdit}
                                >
                                  <DeleteOutlineRoundedIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            ) : null}
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {cutListDisplayName || 'No file attached'}
                          </Typography>
                        </Stack>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1 }}>
                        <Stack spacing={0.7}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Invoice
                          </Typography>
                          <Box
                            sx={{ cursor: canOpenInvoiceDocument ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!order || !canOpenInvoiceDocument) {
                                return
                              }

                              onOpenInvoiceDocument(order)
                            }}
                          >
                            {renderInlineDocumentMiniPreview({
                              url: invoicePreviewUrl,
                              fileName: invoiceNumber || 'invoice.pdf',
                              emptyLabel: 'Invoice preview loads on click',
                            })}
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {invoiceNumber ? `Invoice #${invoiceNumber} (read-only from QuickBooks)` : 'No invoice number yet'}
                          </Typography>
                        </Stack>
                      </Paper>
                    </Box>

                    <Typography variant="caption" color="text.secondary">
                      Invoice is read-only. Shop Drawing and Cut List can be replaced or deleted by managers.
                    </Typography>
                  </Stack>
                </Paper>

                <Paper variant="outlined" sx={{ p: { xs: 1.3, md: 1.5 } }}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={`PO: ${order?.poNumber || '—'}`} size="small" variant="outlined" />
                    <Chip label={`Order date: ${order?.orderDate ? formatDate(order.orderDate) : '—'}`} size="small" variant="outlined" />
                  </Stack>
                </Paper>
              </Stack>
            ) : null}
          </Stack>
        )}

        <Dialog
          open={Boolean(documentPreviewUrl)}
          onClose={handleCloseDocumentPreview}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle>{documentPreviewTitle}</DialogTitle>
          <DialogContent dividers>
            {documentPreviewMode === 'image' ? (
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
                src={documentPreviewUrl}
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
                    window.open(documentPreviewUrl, '_blank', 'noopener,noreferrer')
                  }}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Open in New Tab
                </Button>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                if (documentPreviewUrl) {
                  window.open(documentPreviewUrl, '_blank', 'noopener,noreferrer')
                }
              }}
            >
              Open in New Tab
            </Button>
            <Button onClick={handleCloseDocumentPreview}>Close</Button>
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
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) {
              void handleUploadInfoDocument('cut_list', file)
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
