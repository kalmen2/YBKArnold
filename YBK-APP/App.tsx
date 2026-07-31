import AsyncStorage from '@react-native-async-storage/async-storage'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import { Audio } from 'expo-av'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { ORDER_TONES, TICKET_TONES } from './appConstants'
import type {
  AppLanguage,
  AppScreen,
  DashboardOrder,
  DetailSelection,
  MondayDashboardSnapshot,
  MobileAlert,
  MobileAuthUser,
  MobileChatMessage,
  MobileChatThread,
  MobileChatUser,
  MobileManagerOrderProgress,
  MobileTimesheetEntry,
  MobileTimesheetStage,
  MobileTimesheetWorker,
  OrderPhoto,
  OrderJobDetailsSnapshot,
  SupportTicketsSnapshot,
  ZendeskTicketSummarySnapshot,
} from './appTypes'
import { mobileAuth } from './firebase'
import {
  buildOrderBuckets,
  formatDateInput,
  formatDisplayDate,
  formatSyncTimestamp,
  normalizeTicketStatus,
} from './appUtils'
import { API_BASE_URL, request, withBuildQuery } from './appApi'
import { styles } from './appStyles'
import { ChatSection } from './components/ChatSection'
import {
  AlertsSection,
  AuthButton,
  AuthShell,
  DashboardSection,
  InlineLoading,
  ManagerSheetSection,
  OrdersSection,
  PicturesSection,
  SettingsOverviewSection,
  TimesheetSection,
} from './appSections'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const MOBILE_BIOMETRIC_ENABLED_KEY = 'ybk.mobile.biometric.enabled'
const MOBILE_LANGUAGE_KEY = 'ybk.mobile.language'
const MOBILE_NOTIFICATIONS_ENABLED_KEY = 'ybk.mobile.notifications.enabled'
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? ''
const ORDERS_PAGE_SIZE = 30
const CHAT_MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024
const ADMIN_PORTAL_PAGES = [
  { path: '/admin/cash', labelEn: 'Cash Accounts', labelEs: 'Cuentas de caja', icon: 'cash-outline' as const },
  { path: '/admin/reports', labelEn: 'Reports', labelEs: 'Reportes', icon: 'bar-chart-outline' as const },
  { path: '/admin/users', labelEn: 'Users', labelEs: 'Usuarios', icon: 'people-outline' as const },
] as const

const HEBREW_TRANSLATIONS: Record<string, string> = {
  Orders: 'הזמנות',
  Pictures: 'תמונות',
  Notifications: 'התראות',
  Chat: 'צ׳אט',
  Admin: 'ניהול',
  'Manager Sheet': 'דף מנהל',
  'Time Sheet': 'גיליון שעות',
  Settings: 'הגדרות',
  Refresh: 'רענון',
  Refreshing: 'מרענן',
  Version: 'גרסה',
  Security: 'אבטחה',
  Language: 'שפה',
  'Choose your app language.': 'בחר את שפת האפליקציה.',
  Enabled: 'מופעל',
  Disabled: 'כבוי',
  On: 'פועל',
  Off: 'כבוי',
  'App Updates': 'עדכוני אפליקציה',
  Account: 'חשבון',
  Open: 'פתח',
  Reports: 'דוחות',
  Users: 'משתמשים',
  Worker: 'עובד',
  Workers: 'עובדים',
  Entries: 'רשומות',
  Hours: 'שעות',
  Months: 'חודשים',
  Jobs: 'עבודות',
  Dates: 'תאריכים',
  'Hours by worker': 'שעות לפי עובד',
  'Hours by month': 'שעות לפי חודש',
  'Hours by date': 'שעות לפי תאריך',
  'No worker report rows.': 'אין שורות דוח לפי עובד.',
  'No month report rows.': 'אין שורות דוח לפי חודש.',
  'No date report rows.': 'אין שורות דוח לפי תאריך.',
  'User access controls': 'בקרות גישה למשתמשים',
  Role: 'תפקיד',
  Approved: 'מאושר',
  Pending: 'ממתין',
  'Access mode': 'מצב גישה',
  'Last login': 'כניסה אחרונה',
  'Web + App': 'ווב + אפליקציה',
  'Web only': 'ווב בלבד',
  'App only': 'אפליקציה בלבד',
  'Grant access': 'מתן גישה',
  'Remove access': 'הסרת גישה',
  Close: 'סגור',
  Save: 'שמור',
  'Saving...': 'שומר...',
  'Open details': 'פתח פרטים',
  'Hide details': 'הסתר פרטים',
  Updated: 'עודכן',
  'No users found.': 'לא נמצאו משתמשים.',
  'Open access menu': 'פתח תפריט גישה',
  'Change access': 'שינוי גישה',
  'Select access mode for this user.': 'בחר מצב גישה עבור המשתמש הזה.',
  'Current mode': 'מצב נוכחי',
  'Report options': 'אפשרויות דוחות',
  'Report by worker': 'דוח לפי עובד',
  'Report by month': 'דוח לפי חודש',
  'Back to report options': 'חזרה לאפשרויות דוחות',
  'Open worker report': 'פתח דוח עובדים',
  'Open month report': 'פתח דוח חודשי',
  'No rows found for this report.': 'לא נמצאו שורות לדוח זה.',
  'Pictures are hidden by menu.': 'התמונות מוסתרות על ידי התפריט.',
  'Search by order #': 'חפש לפי מספר הזמנה',
  'No orders match your search.': 'אין הזמנות התואמות לחיפוש שלך.',
  Order: 'הזמנה',
}

type AdminWorkspacePagePath = (typeof ADMIN_PORTAL_PAGES)[number]['path']
type OrdersViewFilter = 'orders' | 'design' | 'shipped'
type AdminAccessMode = 'web_and_app' | 'web_only' | 'app_only'
type AdminUserRole = 'standard' | 'manager' | 'sales_rep' | 'admin'
type AdminReportsView = 'menu' | 'worker' | 'month' | 'job' | 'date'

type AppUpdateStatusResponse = {
  url?: string | null
  build?: number | string | null
  version?: string | null
}

type AdminWorkspaceStat = {
  id?: string
  label: string
  value: string
}

type AdminWorkspaceRowMetric = {
  label: string
  value: string
}

type AdminWorkspaceRowWorkerDateEntry = {
  date: string
  hours: number
  laborCost: number
}

type AdminWorkspaceRowWorkerDetail = {
  workerId: string
  workerName: string
  totalHours: number
  totalLaborCost: number
  dateEntries: AdminWorkspaceRowWorkerDateEntry[]
}

type AdminWorkspaceRow = {
  id: string
  title: string
  subtitle: string
  meta?: string
  details?: string[]
  metrics?: AdminWorkspaceRowMetric[]
  workerDetails?: AdminWorkspaceRowWorkerDetail[]
}

type AdminWorkspaceSection = {
  id: string
  title: string
  rows: AdminWorkspaceRow[]
  emptyText: string
}

type AdminWorkspacePanelData = {
  stats: AdminWorkspaceStat[]
  sections: AdminWorkspaceSection[]
  note?: string
  updatedAt?: string | null
}

type AdminWorkspaceUserRecord = {
  uid: string
  email: string
  displayName: string
  role: AdminUserRole
  isApproved: boolean
  clientAccessMode: AdminAccessMode
  hasWebAccess: boolean
  hasAppAccess: boolean
  lastLoginAt: string | null
}

type SettingsMenuId = 'security' | 'language' | 'notifications' | 'updates' | 'admin' | 'account'
type BottomNavScreen = 'orders' | 'pictures' | 'timesheet' | 'manager' | 'alerts' | 'chat' | 'admin'

type ChatAttachmentDraft = {
  kind: 'image' | 'voice'
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

function normalizeJobName(value: string) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function extractDigits(value: string) {
  const digits = String(value ?? '').replace(/\D+/g, '').trim()

  return digits || null
}

function buildAppleRawNonce(length = 32) {
  const nonceCharacters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._'
  const nonceLength = Math.max(16, Math.min(length, 64))
  const randomBytes = Crypto.getRandomBytes(nonceLength)
  let rawNonce = ''

  for (let index = 0; index < nonceLength; index += 1) {
    rawNonce += nonceCharacters[randomBytes[index] % nonceCharacters.length]
  }

  return rawNonce
}

function normalizeIsoDate(value: string) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return null
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizedValue)

  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const parsed = new Date(year, month - 1, day)

    if (
      parsed.getFullYear() === year
      && parsed.getMonth() === month - 1
      && parsed.getDate() === day
    ) {
      return formatDateInput(parsed)
    }

    return null
  }

  const parsed = new Date(normalizedValue)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return formatDateInput(parsed)
}

function formatMonthBucketLabel(monthKey: string, locale: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? '').trim())

  if (!match) {
    return monthKey
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const parsed = new Date(year, month - 1, 1)

  if (Number.isNaN(parsed.getTime())) {
    return monthKey
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(parsed)
}

type MobileNonOrderCategory = 'general' | 'companyPurchase' | 'payroll'

const MOBILE_NON_ORDER_CATEGORY_CONFIG: Array<{
  category: MobileNonOrderCategory
  label: string
  matchers: string[]
}> = [
  {
    category: 'general',
    label: 'General',
    matchers: ['general expense', 'general', 'repair', 'customer stock'],
  },
  {
    category: 'companyPurchase',
    label: 'Company Purchase',
    matchers: ['company purchase'],
  },
  {
    category: 'payroll',
    label: 'Payroll',
    matchers: ['payroll'],
  },
]

function splitQuickBooksProjectLabel(projectName: string, fallbackProjectId: string) {
  const normalizedName = String(projectName ?? '').trim()

  if (!normalizedName) {
    return {
      customerName: '-',
      projectNumber: String(fallbackProjectId || '-').trim() || '-',
    }
  }

  const hasColonSeparator = normalizedName.includes(':')
  const hasHyphenSeparator = normalizedName.includes(' - ')
  const segments = hasColonSeparator
    ? normalizedName.split(':').map((segment) => segment.trim()).filter(Boolean)
    : hasHyphenSeparator
      ? normalizedName.split(' - ').map((segment) => segment.trim()).filter(Boolean)
      : [normalizedName]

  if (segments.length <= 1) {
    return {
      customerName: '-',
      projectNumber: segments[0] || String(fallbackProjectId || '-').trim() || '-',
    }
  }

  return {
    customerName: segments.slice(0, -1).join(' : '),
    projectNumber: segments[segments.length - 1] || String(fallbackProjectId || '-').trim() || '-',
  }
}

function normalizeMatcherValue(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resolveMobileNonOrderCategory(...candidates: Array<string | null | undefined>) {
  const normalizedCandidates = candidates
    .map((value) => normalizeMatcherValue(value))
    .filter(Boolean)

  if (normalizedCandidates.length === 0) {
    return null
  }

  const matched = MOBILE_NON_ORDER_CATEGORY_CONFIG.find((config) => (
    normalizedCandidates.some((candidate) => (
      config.matchers.some((matcher) => {
        const normalizedMatcher = normalizeMatcherValue(matcher)
        return candidate === normalizedMatcher || candidate.includes(normalizedMatcher)
      })
    ))
  ))

  return matched?.category ?? null
}

function resolveMonthRange(monthKey: string) {
  const match = String(monthKey ?? '').trim().match(/^(\d{4})-(\d{2})$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }

  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  return {
    start,
    end,
  }
}

function shiftIsoDateByDays(value: string, deltaDays: number) {
  const normalized = normalizeIsoDate(value)

  if (!normalized) {
    return null
  }

  const [year, month, day] = normalized.split('-').map(Number)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const nextDate = new Date(year, month - 1, day)
  nextDate.setDate(nextDate.getDate() + deltaDays)

  return formatDateInput(nextDate)
}

function resolveDateKeyFromReportRowId(rowId: string) {
  const normalizedRowId = String(rowId ?? '').trim()
  const match = /^date-(?:report|non-order)-(\d{4}-\d{2}-\d{2})-/.exec(normalizedRowId)

  if (!match) {
    return ''
  }

  return match[1]
}

function resolveLatestReadyPercentOnOrBefore(
  rows: Array<{ date: string; readyPercent: number | null }>,
  date: string,
) {
  let latest: number | null = null

  rows.forEach((row) => {
    if (row.readyPercent === null || row.date > date) {
      return
    }

    latest = row.readyPercent
  })

  return latest
}

function translateToHebrew(english: string) {
  const normalized = String(english ?? '')
  const direct = HEBREW_TRANSLATIONS[normalized]

  if (direct) {
    return direct
  }

  const pageMatch = /^Page\s+(\d+)\s+of\s+(\d+)$/.exec(normalized)

  if (pageMatch) {
    return `עמוד ${pageMatch[1]} מתוך ${pageMatch[2]}`
  }

  const uploadMatch = /^Upload\s+\((\d+)\)$/.exec(normalized)

  if (uploadMatch) {
    return `העלה (${uploadMatch[1]})`
  }

  const readyToUploadMatch = /^Ready to upload\s+\((\d+)\)$/.exec(normalized)

  if (readyToUploadMatch) {
    return `מוכן להעלאה (${readyToUploadMatch[1]})`
  }

  return normalized
}

function toTimestampMs(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? '').trim())

  return Number.isFinite(timestamp) ? timestamp : null
}

function parseBuildNumberLike(value: unknown) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  const direct = Number(normalized)

  if (Number.isFinite(direct)) {
    return Math.floor(direct)
  }

  const digitGroups = normalized.match(/\d+/g)

  if (!digitGroups || digitGroups.length === 0) {
    return null
  }

  const trailingDigits = Number(digitGroups[digitGroups.length - 1])

  return Number.isFinite(trailingDigits) ? trailingDigits : null
}

function compareVersionLabels(leftValue: unknown, rightValue: unknown) {
  const toNumericParts = (value: unknown) => {
    const normalized = String(value ?? '').trim().replace(/^[vV]/, '')

    if (!normalized) {
      return []
    }

    const digitGroups = normalized.match(/\d+/g)

    if (!digitGroups || digitGroups.length === 0) {
      return []
    }

    return digitGroups
      .map((group) => Number(group))
      .filter((group) => Number.isFinite(group))
  }

  const leftParts = toNumericParts(leftValue)
  const rightParts = toNumericParts(rightValue)

  if (leftParts.length === 0 || rightParts.length === 0) {
    return null
  }

  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart === rightPart) {
      continue
    }

    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

function normalizeTextValue(value: unknown) {
  return String(value ?? '').trim()
}

function toCountValue(value: unknown) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

function clipTextValue(value: unknown, maxLength = 160) {
  const normalized = normalizeTextValue(value)

  if (!normalized) {
    return ''
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}

function formatCurrencyAmount(value: number, locale: string) {
  return Number.isFinite(value)
    ? value.toLocaleString(locale, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      })
    : '$0'
}

function formatCurrencyAmountPrecise(value: number, locale: string) {
  return Number.isFinite(value)
    ? value.toLocaleString(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '-'
}

function normalizeAdminAccessMode(value: unknown): AdminAccessMode {
  const normalized = normalizeTextValue(value).toLowerCase()

  if (normalized === 'web_only' || normalized === 'app_only') {
    return normalized
  }

  return 'web_and_app'
}

function normalizeAdminUserRole(value: unknown): AdminUserRole {
  const normalized = normalizeTextValue(value).toLowerCase()

  if (normalized === 'manager' || normalized === 'sales_rep' || normalized === 'admin') {
    return normalized
  }

  return 'standard'
}

function isShippedDashboardOrder(order: DashboardOrder) {
  if (order.isDone || Boolean(order.movedToShippedAt || order.shippedAt)) {
    return true
  }

  const normalizedStatus = normalizeTextValue(order.statusLabel).toLowerCase()

  if (/\bnot\s+shipped\b/.test(normalizedStatus)) {
    return false
  }

  return /\bshipped\b/.test(normalizedStatus)
}

function isDesignDashboardOrder(order: DashboardOrder) {
  const combinedText = `${normalizeTextValue(order.stageLabel)} ${normalizeTextValue(order.statusLabel)}`.toLowerCase()

  return /\bdesign\b/.test(combinedText)
}

export default function App() {
  const { height: windowHeight } = useWindowDimensions()
  const isExpoGo = Constants.appOwnership === 'expo'

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [authProfile, setAuthProfile] = useState<MobileAuthUser | null>(null)
  const [isAuthResolved, setIsAuthResolved] = useState(false)
  const [isCheckingApproval, setIsCheckingApproval] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isEmailSigningIn, setIsEmailSigningIn] = useState(false)
  const [isAppleSignInAvailable, setIsAppleSignInAvailable] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [emailSignInValue, setEmailSignInValue] = useState('')
  const [passwordSignInValue, setPasswordSignInValue] = useState('')
  const [language, setLanguage] = useState<AppLanguage>('en')
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(true)
  const [isBiometricPromptOpen, setIsBiometricPromptOpen] = useState(false)
  const [hasSkippedBiometricPrompt, setHasSkippedBiometricPrompt] = useState(false)
  const [isAuthenticatingBiometric, setIsAuthenticatingBiometric] = useState(false)
  const [hasBiometricSessionAuth, setHasBiometricSessionAuth] = useState(false)
  const [isDisableBiometricConfirmOpen, setIsDisableBiometricConfirmOpen] = useState(false)
  const [lastAutoBiometricAttemptAt, setLastAutoBiometricAttemptAt] = useState(0)

  const [activeScreen, setActiveScreen] = useState<AppScreen>('dashboard')
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [mondaySnapshot, setMondaySnapshot] = useState<MondayDashboardSnapshot | null>(null)
  const [zendeskSnapshot, setZendeskSnapshot] = useState<ZendeskTicketSummarySnapshot | null>(null)
  const [supportTicketsSnapshot, setSupportTicketsSnapshot] = useState<SupportTicketsSnapshot | null>(null)

  const [detailSelection, setDetailSelection] = useState<DetailSelection>(null)
  const [dashboardMetricZoomOrderId, setDashboardMetricZoomOrderId] = useState<string | null>(null)
  const dashboardMetricZoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const screenScrollRef = useRef<ScrollView | null>(null)
  const activeVoiceRecordingRef = useRef<Audio.Recording | null>(null)
  const activeVoiceSoundRef = useRef<Audio.Sound | null>(null)
  const [adminPortalRoutePath, setAdminPortalRoutePath] = useState<AdminWorkspacePagePath | null>(null)

  const [selectedPictureOrderId, setSelectedPictureOrderId] = useState<string | null>(null)
  const [isPicturesModalOpen, setIsPicturesModalOpen] = useState(false)
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const [ordersSearchQuery, setOrdersSearchQuery] = useState('')
  const [ordersViewFilter, setOrdersViewFilter] = useState<OrdersViewFilter>('orders')
  const [ordersPage, setOrdersPage] = useState(1)
  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState<DashboardOrder | null>(null)
  const [isOrderDetailsFromDashboardMetric, setIsOrderDetailsFromDashboardMetric] = useState(false)
  const [selectedOrderDetailsView, setSelectedOrderDetailsView] = useState<'overview' | 'admin'>('overview')
  const [isOrderDetailsLoading, setIsOrderDetailsLoading] = useState(false)
  const [orderJobDetailsByOrderId, setOrderJobDetailsByOrderId] = useState<Record<string, OrderJobDetailsSnapshot>>({})
  const [expandedOrderStatusHistoryRowKey, setExpandedOrderStatusHistoryRowKey] = useState<string | null>(null)
  const [ordersDetailMessage, setOrdersDetailMessage] = useState<string | null>(null)
  const [orderPhotosByOrderId, setOrderPhotosByOrderId] = useState<Record<string, OrderPhoto[]>>({})
  const [isLoadingOrderPhotos, setIsLoadingOrderPhotos] = useState(false)
  const [isUploadingPicture, setIsUploadingPicture] = useState(false)
  const [pendingPictures, setPendingPictures] = useState<
    Array<{
      id: string
      base64: string
      mimeType: string
      previewUri: string
    }>
  >([])
  const [pictureMessage, setPictureMessage] = useState<string | null>(null)

  const [timesheetWorker, setTimesheetWorker] = useState<MobileTimesheetWorker | null>(null)
  const [timesheetEntries, setTimesheetEntries] = useState<MobileTimesheetEntry[]>([])
  const [timesheetStages, setTimesheetStages] = useState<MobileTimesheetStage[]>([])
  const [isTimesheetLoading, setIsTimesheetLoading] = useState(false)
  const [isTimesheetSaving, setIsTimesheetSaving] = useState(false)
  const [timesheetMessage, setTimesheetMessage] = useState<string | null>(null)
  const [timesheetDate, setTimesheetDate] = useState(() => formatDateInput(new Date()))
  const [timesheetJobNumber, setTimesheetJobNumber] = useState('')
  const [timesheetStageId, setTimesheetStageId] = useState('')
  const [timesheetHours, setTimesheetHours] = useState('')
  const [timesheetNotes, setTimesheetNotes] = useState('')
  const [isTimesheetDatePickerOpen, setIsTimesheetDatePickerOpen] = useState(false)
  const [managerDate, setManagerDate] = useState(() => formatDateInput(new Date()))
  const [isManagerDatePickerOpen, setIsManagerDatePickerOpen] = useState(false)
  const [managerWorkers, setManagerWorkers] = useState<MobileTimesheetWorker[]>([])
  const [managerEntries, setManagerEntries] = useState<MobileTimesheetEntry[]>([])
  const [managerOrderProgress, setManagerOrderProgress] = useState<MobileManagerOrderProgress[]>([])
  const [managerProgressByJob, setManagerProgressByJob] = useState<Record<string, string>>({})
  const [isManagerLoading, setIsManagerLoading] = useState(false)
  const [isManagerSaving, setIsManagerSaving] = useState(false)
  const [managerMessage, setManagerMessage] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<MobileAlert[]>([])
  const [isAlertsLoading, setIsAlertsLoading] = useState(false)
  const [alertsMessage, setAlertsMessage] = useState<string | null>(null)
  const [alertsUnreadCount, setAlertsUnreadCount] = useState(0)
  const [showReadAlerts, setShowReadAlerts] = useState(false)
  const [chatThreads, setChatThreads] = useState<MobileChatThread[]>([])
  const [chatUsers, setChatUsers] = useState<MobileChatUser[]>([])
  const [chatMessagesByThreadId, setChatMessagesByThreadId] = useState<Record<string, MobileChatMessage[]>>({})
  const [chatSelectedThreadId, setChatSelectedThreadId] = useState<string | null>(null)
  const [chatViewMode, setChatViewMode] = useState<'list' | 'thread'>('list')
  const [chatComposerText, setChatComposerText] = useState('')
  const [chatAttachmentDraft, setChatAttachmentDraft] = useState<ChatAttachmentDraft | null>(null)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isChatMessagesLoading, setIsChatMessagesLoading] = useState(false)
  const [isChatSendingMessage, setIsChatSendingMessage] = useState(false)
  const [isChatRecordingVoice, setIsChatRecordingVoice] = useState(false)
  const [isChatProcessingVoice, setIsChatProcessingVoice] = useState(false)
  const [chatPlayingMessageId, setChatPlayingMessageId] = useState<string | null>(null)
  const [chatMessage, setChatMessage] = useState<string | null>(null)
  const [registeredPushToken, setRegisteredPushToken] = useState<string | null>(null)
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(true)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [resolvedUpdateUrl, setResolvedUpdateUrl] = useState('')
  const [adminPortalMessage, setAdminPortalMessage] = useState<string | null>(null)
  const [adminWorkspaceLoadingPath, setAdminWorkspaceLoadingPath] = useState<AdminWorkspacePagePath | null>(null)
  const [adminWorkspaceDataByPath, setAdminWorkspaceDataByPath] = useState<Partial<Record<AdminWorkspacePagePath, AdminWorkspacePanelData>>>({})
  const [adminUsersForAccess, setAdminUsersForAccess] = useState<AdminWorkspaceUserRecord[]>([])
  const [adminUserSavingUid, setAdminUserSavingUid] = useState<string | null>(null)
  const [adminAccessMenuUserUid, setAdminAccessMenuUserUid] = useState<string | null>(null)
  const [adminReportsView, setAdminReportsView] = useState<AdminReportsView>('menu')
  const [adminReportWorkerSearch, setAdminReportWorkerSearch] = useState('')
  const [adminSelectedWorkerReportRowId, setAdminSelectedWorkerReportRowId] = useState<string | null>(null)
  const [adminReportMonthStatId, setAdminReportMonthStatId] = useState<string>('summary')
  const [adminSelectedMonthProjectRowId, setAdminSelectedMonthProjectRowId] = useState<string | null>(null)
  const [adminReportJobSearch, setAdminReportJobSearch] = useState('')
  const [adminReportDateRangeStart, setAdminReportDateRangeStart] = useState(() => formatDateInput(new Date()))
  const [adminReportDateRangeEnd, setAdminReportDateRangeEnd] = useState(() => formatDateInput(new Date()))
  const [adminDatePickerTarget, setAdminDatePickerTarget] = useState<'start' | 'end' | null>(null)
  const [adminReportMonthListModalState, setAdminReportMonthListModalState] = useState<{
    statId: string
    title: string
    section: AdminWorkspaceSection
  } | null>(null)
  const [adminReportDetailsModalState, setAdminReportDetailsModalState] = useState<{
    sectionTitle: string
    row: AdminWorkspaceRow
  } | null>(null)
  const [adminReportWorkerDrilldownModalState, setAdminReportWorkerDrilldownModalState] = useState<{
    parentRowTitle: string
    worker: AdminWorkspaceRowWorkerDetail
  } | null>(null)
  const [adminExpandedWorkspaceRowId, setAdminExpandedWorkspaceRowId] = useState<string | null>(null)
  const [adminCashAccountModalRow, setAdminCashAccountModalRow] = useState<AdminWorkspaceRow | null>(null)
  const [activeSettingsMenuId, setActiveSettingsMenuId] = useState<SettingsMenuId | null>(null)

  const isSpanish = language === 'es'
  const isHebrew = language === 'he'
  const locale = isSpanish ? 'es-ES' : isHebrew ? 'he-IL' : 'en-US'
  const t = useCallback(
    (english: string, spanish: string) => {
      if (isSpanish) {
        return spanish
      }

      if (isHebrew) {
        return translateToHebrew(english)
      }

      return english
    },
    [isHebrew, isSpanish],
  )
  const getErrorMessage = useCallback(
    (error: unknown, englishFallback: string, spanishFallback: string) => {
      return error instanceof Error ? error.message : t(englishFallback, spanishFallback)
    },
    [t],
  )
  const isBiometricLocked = isBiometricEnabled && !hasBiometricSessionAuth
  const hasApprovedSessionAccess = Boolean(authProfile?.isApproved) && !isBiometricLocked
  const isAdminUser = Boolean(authProfile?.isAdmin)
  const isStandardUser = authProfile?.role === 'standard'
  const isShopWorker = Boolean(authProfile?.isShopWorker) || authProfile?.role === 'shop_worker'
  const canStartDirectChat = Boolean(
    authProfile?.isAdmin
    || authProfile?.isManager
    || authProfile?.role === 'standard',
  )
  const hasManagerSheetAccess = !isAdminUser && Boolean(authProfile?.isManager)
  const hasAdminOrderDetailsAccess = Boolean(authProfile?.isAdmin)
  const profileDisplayName = useMemo(
    () => String(firebaseUser?.displayName ?? '').trim()
      || String(firebaseUser?.email ?? '').trim()
      || 'Arnold user',
    [firebaseUser?.displayName, firebaseUser?.email],
  )
  const profileEmail = useMemo(
    () => String(firebaseUser?.email ?? '').trim(),
    [firebaseUser?.email],
  )
  const profilePhotoUrl = useMemo(
    () => String(firebaseUser?.photoURL ?? '').trim(),
    [firebaseUser?.photoURL],
  )
  const profileInitial = useMemo(
    () => profileDisplayName.charAt(0).toUpperCase() || 'A',
    [profileDisplayName],
  )

  const bottomNavItems = useMemo<Array<{
    id: BottomNavScreen
    label: string
    icon: keyof typeof Ionicons.glyphMap
  }>>(() => {
    if (isAdminUser) {
      return [
        { id: 'orders', label: t('Orders', 'Ordenes'), icon: 'receipt-outline' },
        { id: 'pictures', label: t('Pictures', 'Fotos'), icon: 'images-outline' },
        { id: 'chat', label: t('Chat', 'Chat'), icon: 'chatbubble-ellipses-outline' },
        { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
        { id: 'admin', label: t('Admin', 'Admin'), icon: 'settings-outline' },
      ]
    }

    if (hasManagerSheetAccess) {
      return [
        { id: 'orders', label: t('Orders', 'Ordenes'), icon: 'receipt-outline' },
        { id: 'pictures', label: t('Pictures', 'Fotos'), icon: 'images-outline' },
        { id: 'manager', label: t('Manager Sheet', 'Hoja gerente'), icon: 'clipboard-outline' },
        { id: 'chat', label: t('Chat', 'Chat'), icon: 'chatbubble-ellipses-outline' },
        { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
      ]
    }

    return [
      { id: 'orders', label: t('Orders', 'Ordenes'), icon: 'receipt-outline' },
      { id: 'pictures', label: t('Pictures', 'Fotos'), icon: 'images-outline' },
      { id: 'timesheet', label: t('Time Sheet', 'Horas'), icon: 'time-outline' },
      { id: 'chat', label: t('Chat', 'Chat'), icon: 'chatbubble-ellipses-outline' },
      { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
    ]
  }, [hasManagerSheetAccess, isAdminUser, t])

  const sortedChatThreads = useMemo(() => {
    const orderedThreads = [...chatThreads].sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned)) {
        return left.pinned ? -1 : 1
      }

      const leftSort = String(left.lastMessageAt ?? left.updatedAt ?? left.createdAt ?? '')
      const rightSort = String(right.lastMessageAt ?? right.updatedAt ?? right.createdAt ?? '')

      return rightSort.localeCompare(leftSort)
    })
    return orderedThreads
  }, [chatThreads])

  const selectedChatThread = useMemo(
    () => sortedChatThreads.find((thread) => thread.id === chatSelectedThreadId) ?? null,
    [chatSelectedThreadId, sortedChatThreads],
  )

  const selectedChatMessages = useMemo(
    () => (selectedChatThread ? (chatMessagesByThreadId[selectedChatThread.id] ?? []) : []),
    [chatMessagesByThreadId, selectedChatThread],
  )

  const resolveChatThreadTitle = useCallback((thread: MobileChatThread | null) => {
    if (!thread) {
      return t('Chat', 'Chat')
    }

    if (thread.type === 'group') {
      return thread.name || t('Group chat', 'Chat grupal')
    }

    const requesterUid = String(firebaseUser?.uid ?? '').trim()
    const peer = thread.memberProfiles.find((member) => member.uid !== requesterUid) || thread.memberProfiles[0]

    if (!peer) {
      return t('Direct chat', 'Chat directo')
    }

    return peer.displayName || peer.email || t('Direct chat', 'Chat directo')
  }, [firebaseUser?.uid, t])

  const resolveChatThreadSubtitle = useCallback((thread: MobileChatThread | null) => {
    if (!thread) {
      return ''
    }

    if (thread.type === 'group') {
      const memberCount = thread.memberUids.length

      return t(
        `${memberCount} members`,
        `${memberCount} miembros`,
      )
    }

    const requesterUid = String(firebaseUser?.uid ?? '').trim()
    const peer = thread.memberProfiles.find((member) => member.uid !== requesterUid) || thread.memberProfiles[0]

    return peer?.email ?? t('Direct chat', 'Chat directo')
  }, [firebaseUser?.uid, t])

  const dashboardUnreadSummary = useMemo(() => {
    if (alertsUnreadCount <= 0) {
      return null
    }

    if (isSpanish) {
      return alertsUnreadCount === 1
        ? 'Tienes 1 mensaje sin leer.'
        : `Tienes ${alertsUnreadCount} mensajes sin leer.`
    }

    if (isHebrew) {
      return alertsUnreadCount === 1
        ? 'יש לך הודעה אחת שלא נקראה.'
        : `יש לך ${alertsUnreadCount} הודעות שלא נקראו.`
    }

    return alertsUnreadCount === 1
      ? 'You have 1 unread message.'
      : `You have ${alertsUnreadCount} unread messages.`
  }, [alertsUnreadCount, isHebrew, isSpanish])

  const installedNativeVersion = useMemo(() => {
    const nativeVersion = String(Constants.nativeAppVersion ?? '').trim()
    const applicationVersion = String(Application.nativeApplicationVersion ?? '').trim()

    if (nativeVersion) {
      return nativeVersion
    }

    if (applicationVersion) {
      return applicationVersion
    }

    const fallbackVersion = String(Constants.expoConfig?.version ?? '').trim()

    return fallbackVersion || 'unknown'
  }, [])

  const installedNativeBuildLabel = useMemo(() => {
    const nativeBuild = String(Constants.nativeBuildVersion ?? '').trim()
    const applicationBuild = String(Application.nativeBuildVersion ?? '').trim()

    if (nativeBuild) {
      return nativeBuild
    }

    if (applicationBuild) {
      return applicationBuild
    }

    const fallbackBuild =
      Platform.OS === 'android'
        ? Constants.expoConfig?.android?.versionCode
        : Constants.expoConfig?.ios?.buildNumber

    return String(fallbackBuild ?? '').trim()
  }, [])

  const installedNativeBuildNumber = useMemo(() => {
    return parseBuildNumberLike(installedNativeBuildLabel)
  }, [installedNativeBuildLabel])

  const appVersionLabel = useMemo(() => {
    return `Version ${installedNativeVersion}`
  }, [installedNativeVersion])

  const settingsMenuItems = useMemo<Array<{ id: SettingsMenuId; title: string; subtitle: string; status: string }>>(
    () => {
      const items: Array<{ id: SettingsMenuId; title: string; subtitle: string; status: string }> = [
        {
          id: 'security',
          title: t('Security', 'Seguridad'),
          subtitle: t('Biometric sign-in controls.', 'Controles de inicio biometrico.'),
          status: isBiometricEnabled ? t('Enabled', 'Activada') : t('Disabled', 'Desactivada'),
        },
        {
          id: 'language',
          title: t('Language', 'Idioma'),
          subtitle: t('Choose your app language.', 'Elige el idioma de la aplicacion.'),
          status: language === 'es' ? 'Espanol' : language === 'he' ? 'עברית' : 'English',
        },
        {
          id: 'notifications',
          title: t('Notifications', 'Notificaciones'),
          subtitle: t('Enable, disable, or manage notification access.', 'Activa, desactiva o administra acceso de notificaciones.'),
          status: isNotificationsEnabled ? t('On', 'Activas') : t('Off', 'Desactivadas'),
        },
        {
          id: 'updates',
          title: t('App Updates', 'Actualizaciones'),
          subtitle: t('Check and install the latest version.', 'Busca e instala la version mas reciente.'),
          status: appVersionLabel,
        },
      ]

      items.push({
        id: 'account',
        title: t('Account', 'Cuenta'),
        subtitle: t('Sign-out and session actions.', 'Acciones de sesion y cierre de sesion.'),
        status: t('Open', 'Abrir'),
      })

      return items
    },
    [appVersionLabel, isBiometricEnabled, isNotificationsEnabled, language, t],
  )

  const activeSettingsMenuItem = useMemo(
    () => settingsMenuItems.find((item) => item.id === activeSettingsMenuId) ?? null,
    [activeSettingsMenuId, settingsMenuItems],
  )

  const easProjectId = useMemo(() => {
    return String(
      Constants.easConfig?.projectId
      ?? Constants.expoConfig?.extra?.eas?.projectId
      ?? '',
    ).trim()
  }, [])

  const lockBiometricSession = useCallback(() => {
    setHasBiometricSessionAuth(false)
    setHasSkippedBiometricPrompt(false)
    setIsBiometricPromptOpen(false)
  }, [])

  const unlockBiometricSession = useCallback(() => {
    setHasBiometricSessionAuth(true)
    setHasSkippedBiometricPrompt(false)
    setIsBiometricPromptOpen(false)
  }, [])

  const signOutForExpiredSession = useCallback(async () => {
    await signOut(mobileAuth)
    setAuthProfile(null)
    lockBiometricSession()
    setAuthMessage(t('Your session expired. Please sign in again.', 'Tu sesion expiro. Inicia sesion otra vez.'))
  }, [lockBiometricSession, t])

  const lockSessionWithMessage = useCallback(
    (message: string) => {
      setAuthProfile(null)
      lockBiometricSession()
      setAuthMessage(message)
    },
    [lockBiometricSession],
  )

  const resetPendingPicturesAndMessage = useCallback(() => {
    setPendingPictures([])
    setPictureMessage(null)
  }, [])

  const closePicturesModal = useCallback(() => {
    setIsPicturesModalOpen(false)
    resetPendingPicturesAndMessage()
  }, [resetPendingPicturesAndMessage])

  const closeSettingsMenu = useCallback(() => {
    setActiveSettingsMenuId(null)
    setAdminPortalMessage(null)
  }, [])

  const handleOpenAdminPortalPage = useCallback((
    routePath: AdminWorkspacePagePath,
  ) => {
    setAdminPortalMessage(null)
    setActiveSettingsMenuId(null)
    setActiveScreen('admin')
    setIsAccountMenuOpen(false)
    setAdminPortalRoutePath(routePath)
  }, [])

  const requestWithSession = useCallback(
    async <T,>(path: string, refreshRequested = false, init: RequestInit = {}) => {
      const runRequest = async (idToken: string | null) => {
        return request<T>(path, refreshRequested, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            'x-client-platform': 'app',
            ...(idToken
              ? {
                  Authorization: `Bearer ${idToken}`,
                }
              : {}),
          },
        })
      }

      let idToken = firebaseUser ? await firebaseUser.getIdToken() : null

      try {
        return await runRequest(idToken)
      } catch (error) {
        const status = (error as { status?: number })?.status

        if (status === 401 && firebaseUser) {
          try {
            idToken = await firebaseUser.getIdToken(true)
            return await runRequest(idToken)
          } catch (retryError) {
            const retryStatus = (retryError as { status?: number })?.status

            if (retryStatus === 401) {
              await signOutForExpiredSession()
            }

            throw retryError
          }
        }

        if (status === 401) {
          await signOutForExpiredSession()
        }

        throw error
      }
    },
    [firebaseUser, signOutForExpiredSession],
  )

  const loadAdminWorkspacePage = useCallback(
    async (routePath: AdminWorkspacePagePath, forceReload = false) => {
      if (!forceReload && adminWorkspaceDataByPath[routePath]) {
        return
      }

      setAdminWorkspaceLoadingPath(routePath)
      setAdminPortalMessage(null)

      try {
        let panelData: AdminWorkspacePanelData | null = null

        if (routePath !== '/admin/users') {
          setAdminUsersForAccess([])
          setAdminAccessMenuUserUid(null)
        }

        switch (routePath) {
          case '/admin/cash': {
            const overviewPath = forceReload
              ? '/api/quickbooks/overview?refresh=1'
              : '/api/quickbooks/overview'
            const payload = await requestWithSession<{
              generatedAt?: string
              totals?: Record<string, unknown>
              loanSummaries?: Array<Record<string, unknown>>
            }>(overviewPath)

            const loanSummaries = Array.isArray(payload.loanSummaries)
              ? payload.loanSummaries.map((summary, index) => {
                  const details = Array.isArray(summary.details) ? summary.details : []
                  const totalLoanAmount = Number(summary.totalLoanAmount)
                  const totalInvestedAmount = Number(summary.totalInvestedAmount)
                  const totalTakenOutAmount = Number(summary.totalTakenOutAmount)

                  return {
                    id: normalizeTextValue(summary.bucketId) || `loan-${index + 1}`,
                    label: normalizeTextValue(summary.label) || t('Loan account', 'Cuenta de prestamo'),
                    movementCount: toCountValue(summary.movementCount),
                    totalLoanAmount: Number.isFinite(totalLoanAmount) ? totalLoanAmount : 0,
                    totalInvestedAmount: Number.isFinite(totalInvestedAmount) ? totalInvestedAmount : 0,
                    totalTakenOutAmount: Number.isFinite(totalTakenOutAmount) ? totalTakenOutAmount : 0,
                    details,
                  }
                })
              : []

            const findLoanSummary = (aliases: string[]) => {
              return loanSummaries.find((summary) => {
                const normalizedLabel = summary.label.toLowerCase()

                return aliases.some((alias) => normalizedLabel.includes(alias))
              }) ?? null
            }

            const selectedLoans = [
              {
                id: 'loan-ben-tyberg',
                title: t('Loan from Ben Tyberg', 'Prestamo de Ben Tyberg'),
                aliases: ['ben tyberg', 'tyberg'],
              },
              {
                id: 'loan-israel-kamionka',
                title: t('Loan from Israel Kamionka', 'Prestamo de Israel Kamionka'),
                aliases: ['israel kamionka', 'kamionka'],
              },
              {
                id: 'loan-yb-coit',
                title: t('Loan from YB Coit', 'Prestamo de YB Coit'),
                aliases: ['yb coit', 'coit'],
              },
            ]

            const cashRows = selectedLoans.map((loanItem) => {
              const summary = findLoanSummary(loanItem.aliases)
              const details = Array.isArray(summary?.details)
                ? [...summary.details]
                  .sort((left, right) => {
                    return (toTimestampMs(normalizeTextValue(right.txnDate)) ?? 0)
                      - (toTimestampMs(normalizeTextValue(left.txnDate)) ?? 0)
                  })
                  .slice(0, 30)
                  .map((detail) => {
                    const amount = Number(detail.amount)
                    const amountValue = Number.isFinite(amount) ? amount : 0
                    const direction = normalizeTextValue(detail.direction).toLowerCase()
                    const directionLabel = direction === 'in'
                      ? t('in', 'entra')
                      : direction === 'out'
                        ? t('out', 'sale')
                        : t('move', 'mov')
                    const txnDate = normalizeTextValue(detail.txnDate) || null
                    const detailSource = clipTextValue(
                      normalizeTextValue(detail.description)
                      || normalizeTextValue(detail.docNumber)
                      || normalizeTextValue(detail.accountName),
                      90,
                    )

                    return `${formatDisplayDate(txnDate, locale)} - ${directionLabel} ${formatCurrencyAmount(amountValue, locale)} - ${detailSource || '-'}`
                  })
                : []

              if (details.length === 0) {
                details.push(t('No transactions found for this loan.', 'No se encontraron movimientos para este prestamo.'))
              }

              return {
                id: loanItem.id,
                title: loanItem.title,
                subtitle: `${t('Total loan', 'Prestamo total')}: ${formatCurrencyAmount(summary?.totalLoanAmount ?? 0, locale)}`,
                meta: `${t('Invested', 'Invertido')}: ${formatCurrencyAmount(summary?.totalInvestedAmount ?? 0, locale)} - ${t('Taken out', 'Retirado')}: ${formatCurrencyAmount(summary?.totalTakenOutAmount ?? 0, locale)} - ${t('Moves', 'Movimientos')}: ${summary?.movementCount ?? 0}`,
                details,
              }
            })

            panelData = {
              updatedAt: normalizeTextValue(payload.generatedAt) || new Date().toISOString(),
              stats: [],
              sections: [
                {
                  id: 'loan_accounts',
                  title: t('Loan accounts', 'Cuentas de prestamos'),
                  emptyText: t('No loan accounts found.', 'No se encontraron cuentas de prestamos.'),
                  rows: cashRows,
                },
              ],
            }
            break
          }

          case '/admin/reports': {
            const quickBooksOverviewPath = forceReload
              ? '/api/quickbooks/overview?full=1&refresh=1'
              : '/api/quickbooks/overview?full=1'
            const [timesheetPayload, quickBooksPayload] = await Promise.all([
              requestWithSession<{
                workers?: Array<Record<string, unknown>>
                entries?: Array<Record<string, unknown>>
                orderProgress?: Array<Record<string, unknown>>
              }>('/api/timesheet/state'),
              requestWithSession<{
                generatedAt?: string
                projects?: Array<Record<string, unknown>>
                details?: Record<string, unknown>
              }>(quickBooksOverviewPath),
            ])

            const workers = Array.isArray(timesheetPayload.workers) ? timesheetPayload.workers : []
            const entries = Array.isArray(timesheetPayload.entries) ? timesheetPayload.entries : []
            const orderProgress = Array.isArray(timesheetPayload.orderProgress)
              ? timesheetPayload.orderProgress
              : []
            const quickBooksProjects = Array.isArray(quickBooksPayload.projects)
              ? quickBooksPayload.projects
              : []
            const quickBooksDetails = quickBooksPayload.details && typeof quickBooksPayload.details === 'object'
              ? quickBooksPayload.details
              : {}
            const quickBooksBills = Array.isArray(quickBooksDetails.bills)
              ? quickBooksDetails.bills
              : []
            const quickBooksPayments = Array.isArray(quickBooksDetails.payments)
              ? quickBooksDetails.payments
              : []

            const workerNameById = new Map<string, string>()
            const workerRateById = new Map<string, number>()

            workers.forEach((worker, index) => {
              const workerId = normalizeTextValue(worker.id) || `worker-${index + 1}`
              const workerNumber = normalizeTextValue(worker.workerNumber)
              const workerName = normalizeTextValue(worker.fullName) || t('Unnamed worker', 'Trabajador sin nombre')
              const displayWorker = workerNumber ? `${workerNumber} - ${workerName}` : workerName
              const hourlyRate = Number(worker.hourlyRate)

              workerNameById.set(workerId, displayWorker)
              workerRateById.set(workerId, Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0)
            })

            const workerTotals = new Map<string, {
              label: string
              hours: number
              entryCount: number
              laborCost: number
            }>()
            const monthJobs = new Map<string, Map<string, {
              jobName: string
              totalHours: number
              totalLaborCost: number
            }>>()
            const allTimeJobsByKey = new Map<string, {
              jobName: string
              totalHours: number
              totalLaborCost: number
            }>()
            const allTimeJobWorkersByJobKey = new Map<string, Map<string, {
              workerName: string
              totalHours: number
              totalLaborCost: number
              dateTotals: Map<string, { hours: number; laborCost: number }>
            }>>()
            const workerJobKeysByMonth = new Map<string, Map<string, Set<string>>>()
            const workerJobSummariesByMonth = new Map<string, Map<string, Map<string, {
              jobName: string
              totalHours: number
              totalLaborCost: number
            }>>>()
            const monthKeysSet = new Set<string>()

            entries.forEach((entry, index) => {
              const workerId = normalizeTextValue(entry.workerId)
              const regularHours = Number(entry.hours)
              const overtimeHours = Number(entry.overtimeHours)
              const safeRegularHours = Number.isFinite(regularHours) ? Math.max(0, regularHours) : 0
              const safeOvertimeHours = Number.isFinite(overtimeHours) ? Math.max(0, overtimeHours) : 0
              const combinedHours = safeRegularHours + safeOvertimeHours

              if (combinedHours <= 0) {
                return
              }

              const workerSnapshotRate = Number(entry.payRate)
              const fallbackRate = workerRateById.get(workerId) ?? 0
              const resolvedRate = Number.isFinite(workerSnapshotRate) && workerSnapshotRate > 0
                ? workerSnapshotRate
                : fallbackRate
              const laborCost = (safeRegularHours * resolvedRate) + (safeOvertimeHours * resolvedRate * 1.5)

              const fallbackWorkerLabel = t('Unlinked worker', 'Trabajador sin enlace')
              const workerLabel = workerNameById.get(workerId) || fallbackWorkerLabel
              const workerKey = workerId || `worker-fallback-${index + 1}`
              const workerCurrent = workerTotals.get(workerKey) ?? {
                label: workerLabel,
                hours: 0,
                entryCount: 0,
                laborCost: 0,
              }
              workerCurrent.hours += combinedHours
              workerCurrent.entryCount += 1
              workerCurrent.laborCost += laborCost
              workerTotals.set(workerKey, workerCurrent)

              const normalizedDate = normalizeIsoDate(normalizeTextValue(entry.date))
              const monthKey = normalizedDate ? normalizedDate.slice(0, 7) : ''

              if (!monthKey) {
                return
              }

              monthKeysSet.add(monthKey)

              const jobName = normalizeTextValue(entry.jobName) || t('Unnamed job', 'Trabajo sin nombre')
              const jobKey = normalizeJobName(jobName) || `job-${index + 1}`

              const allTimeJob = allTimeJobsByKey.get(jobKey) ?? {
                jobName,
                totalHours: 0,
                totalLaborCost: 0,
              }
              allTimeJob.totalHours += combinedHours
              allTimeJob.totalLaborCost += laborCost
              allTimeJobsByKey.set(jobKey, allTimeJob)

              const allTimeWorkersForJob = allTimeJobWorkersByJobKey.get(jobKey) ?? new Map<string, {
                workerName: string
                totalHours: number
                totalLaborCost: number
                dateTotals: Map<string, { hours: number; laborCost: number }>
              }>()
              const allTimeWorker = allTimeWorkersForJob.get(workerKey) ?? {
                workerName: workerLabel,
                totalHours: 0,
                totalLaborCost: 0,
                dateTotals: new Map<string, { hours: number; laborCost: number }>(),
              }
              allTimeWorker.totalHours += combinedHours
              allTimeWorker.totalLaborCost += laborCost

              if (normalizedDate) {
                const dateTotals = allTimeWorker.dateTotals.get(normalizedDate) ?? { hours: 0, laborCost: 0 }
                dateTotals.hours += combinedHours
                dateTotals.laborCost += laborCost
                allTimeWorker.dateTotals.set(normalizedDate, dateTotals)
              }

              allTimeWorkersForJob.set(workerKey, allTimeWorker)
              allTimeJobWorkersByJobKey.set(jobKey, allTimeWorkersForJob)

              const monthWorkerJobs = workerJobKeysByMonth.get(monthKey) ?? new Map<string, Set<string>>()
              const workerJobKeys = monthWorkerJobs.get(workerKey) ?? new Set<string>()
              workerJobKeys.add(jobKey)
              monthWorkerJobs.set(workerKey, workerJobKeys)
              workerJobKeysByMonth.set(monthKey, monthWorkerJobs)

              const monthWorkerSummaries = workerJobSummariesByMonth.get(monthKey) ?? new Map<string, Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>>()
              const workerJobSummaries = monthWorkerSummaries.get(workerKey) ?? new Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>()
              const workerJobSummary = workerJobSummaries.get(jobKey) ?? {
                jobName,
                totalHours: 0,
                totalLaborCost: 0,
              }
              workerJobSummary.totalHours += combinedHours
              workerJobSummary.totalLaborCost += laborCost
              workerJobSummaries.set(jobKey, workerJobSummary)
              monthWorkerSummaries.set(workerKey, workerJobSummaries)
              workerJobSummariesByMonth.set(monthKey, monthWorkerSummaries)

              const jobsByKey = monthJobs.get(monthKey) ?? new Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>()
              const currentJob = jobsByKey.get(jobKey) ?? {
                jobName,
                totalHours: 0,
                totalLaborCost: 0,
              }

              currentJob.totalHours += combinedHours
              currentJob.totalLaborCost += laborCost
              jobsByKey.set(jobKey, currentJob)
              monthJobs.set(monthKey, jobsByKey)
            })

            const progressRowsByJobKey = new Map<string, Array<{ date: string; readyPercent: number | null }>>()

            orderProgress.forEach((progress, index) => {
              const normalizedDate = normalizeIsoDate(normalizeTextValue(progress.date))

              if (!normalizedDate) {
                return
              }

              const monthKey = normalizedDate.slice(0, 7)
              const rawJobName = normalizeTextValue(progress.jobName)
              const jobName = rawJobName || t('Unnamed job', 'Trabajo sin nombre')
              const jobKey = normalizeJobName(jobName) || `progress-job-${index + 1}`
              const readyPercentRaw = Number(progress.readyPercent)
              const readyPercent = Number.isFinite(readyPercentRaw)
                ? Math.min(100, Math.max(0, readyPercentRaw))
                : null

              monthKeysSet.add(monthKey)

              const rows = progressRowsByJobKey.get(jobKey) ?? []
              rows.push({
                date: normalizedDate,
                readyPercent,
              })
              progressRowsByJobKey.set(jobKey, rows)

              const jobsByKey = monthJobs.get(monthKey) ?? new Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>()

              if (!jobsByKey.has(jobKey)) {
                jobsByKey.set(jobKey, {
                  jobName,
                  totalHours: 0,
                  totalLaborCost: 0,
                })
              }

              monthJobs.set(monthKey, jobsByKey)
            })

            progressRowsByJobKey.forEach((rows) => {
              rows.sort((left, right) => left.date.localeCompare(right.date))
            })

            const projectLookupById = new Map<string, {
              jobKey: string
              nonOrderCategory: MobileNonOrderCategory | null
            }>()
            const financialTotalsByJobKey = new Map<string, {
              purchaseOrderAmount: number
              billAmount: number
              invoiceAmount: number
              paymentAmount: number
            }>()

            quickBooksProjects.forEach((project, index) => {
              const projectId = normalizeTextValue(project.projectId) || normalizeTextValue(project.id) || `project-${index + 1}`
              const projectName = normalizeTextValue(project.projectName)
              const splitLabel = splitQuickBooksProjectLabel(projectName, projectId)
              const jobKey = normalizeJobName(splitLabel.projectNumber)

              if (!jobKey) {
                return
              }

              projectLookupById.set(projectId, {
                jobKey,
                nonOrderCategory: resolveMobileNonOrderCategory(projectName, splitLabel.projectNumber),
              })

              const purchaseOrderAmount = Number(project.purchaseOrderAmount)
              const billAmount = Number(project.billAmount)
              const invoiceAmount = Number(project.invoiceAmount)
              const paymentAmount = Number(project.paymentAmount)
              const current = financialTotalsByJobKey.get(jobKey) ?? {
                purchaseOrderAmount: 0,
                billAmount: 0,
                invoiceAmount: 0,
                paymentAmount: 0,
              }

              current.purchaseOrderAmount += Number.isFinite(purchaseOrderAmount) ? purchaseOrderAmount : 0
              current.billAmount += Number.isFinite(billAmount) ? billAmount : 0
              current.invoiceAmount += Number.isFinite(invoiceAmount) ? invoiceAmount : 0
              current.paymentAmount += Number.isFinite(paymentAmount) ? paymentAmount : 0
              financialTotalsByJobKey.set(jobKey, current)
            })

            const paymentsByMonthJobKey = new Map<string, number>()
            const paymentsByDateJobKey = new Map<string, number>()
            const billsByDateJobKey = new Map<string, number>()
            const billsPaidByDateJobKey = new Map<string, number>()
            const nonOrderByMonthCategory = new Map<string, Map<MobileNonOrderCategory, {
              billedAmount: number
              paidAmount: number
            }>>()
            const nonOrderByDateCategory = new Map<string, Map<MobileNonOrderCategory, {
              billedAmount: number
              paidAmount: number
            }>>()
            const billRowsByMonth = new Map<string, AdminWorkspaceRow[]>()
            const overheadBillRowsByMonth = new Map<string, AdminWorkspaceRow[]>()

            quickBooksBills.forEach((bill) => {
              const projectId = normalizeTextValue((bill as Record<string, unknown>).projectId)
              const projectName = normalizeTextValue((bill as Record<string, unknown>).projectName)
              const txnDate = normalizeIsoDate(normalizeTextValue((bill as Record<string, unknown>).txnDate))

              if (!txnDate) {
                return
              }

              const fallbackProjectNumber = splitQuickBooksProjectLabel(projectName, projectId).projectNumber
              const projectLookup = projectLookupById.get(projectId)
              const jobKey = projectLookup?.jobKey || normalizeJobName(fallbackProjectNumber)

              if (!jobKey) {
                return
              }

              const totalAmount = Number((bill as Record<string, unknown>).totalAmount)
              const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

              if (normalizedTotalAmount <= 0) {
                return
              }

              const balanceAmount = Number((bill as Record<string, unknown>).balanceAmount)
              const normalizedBalanceAmount = Number.isFinite(balanceAmount) ? Math.max(0, balanceAmount) : 0
              const paidAmount = Math.max(0, normalizedTotalAmount - normalizedBalanceAmount)
              const monthKey = txnDate.slice(0, 7)
              const projectLabel = projectName || fallbackProjectNumber || t('No project', 'Sin proyecto')
              const billNumber = normalizeTextValue((bill as Record<string, unknown>).docNumber)
              const vendorName = normalizeTextValue((bill as Record<string, unknown>).vendorDisplayName)
                || normalizeTextValue((bill as Record<string, unknown>).vendorName)
              const billMemo = normalizeTextValue((bill as Record<string, unknown>).privateNote)
              const monthBillRows = billRowsByMonth.get(monthKey) ?? []
              const billRowId = `month-bill-${monthKey}-${monthBillRows.length + 1}`
              const billRow: AdminWorkspaceRow = {
                id: billRowId,
                title: `${formatDisplayDate(txnDate, locale)} • ${clipTextValue(projectLabel, 32)}`,
                subtitle: `${t('Amount', 'Monto')}: ${formatCurrencyAmountPrecise(normalizedTotalAmount, locale)} - ${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(paidAmount, locale)}`,
                meta: `${t('Balance', 'Balance')}: ${formatCurrencyAmountPrecise(normalizedBalanceAmount, locale)}`,
                details: [
                  `${t('Project', 'Proyecto')}: ${projectLabel}`,
                  `${t('Amount', 'Monto')}: ${formatCurrencyAmountPrecise(normalizedTotalAmount, locale)}`,
                  `${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(paidAmount, locale)}`,
                  `${t('Balance', 'Balance')}: ${formatCurrencyAmountPrecise(normalizedBalanceAmount, locale)}`,
                  ...(billNumber ? [`${t('Bill #', 'Factura #')}: ${billNumber}`] : []),
                  ...(vendorName ? [`${t('Vendor', 'Proveedor')}: ${vendorName}`] : []),
                  ...(billMemo ? [`${t('Memo', 'Nota')}: ${clipTextValue(billMemo, 120)}`] : []),
                ],
              }
              monthBillRows.push(billRow)
              billRowsByMonth.set(monthKey, monthBillRows)

              billsByDateJobKey.set(
                `${txnDate}:${jobKey}`,
                Number(((billsByDateJobKey.get(`${txnDate}:${jobKey}`) ?? 0) + normalizedTotalAmount).toFixed(2)),
              )
              billsPaidByDateJobKey.set(
                `${txnDate}:${jobKey}`,
                Number(((billsPaidByDateJobKey.get(`${txnDate}:${jobKey}`) ?? 0) + paidAmount).toFixed(2)),
              )

              const nonOrderCategory = projectLookup?.nonOrderCategory
                ?? resolveMobileNonOrderCategory(projectName, fallbackProjectNumber)

              if (nonOrderCategory) {
                const monthOverheadRows = overheadBillRowsByMonth.get(monthKey) ?? []
                monthOverheadRows.push({
                  ...billRow,
                  id: `month-overhead-${monthKey}-${monthOverheadRows.length + 1}`,
                })
                overheadBillRowsByMonth.set(monthKey, monthOverheadRows)
              }

              if (!nonOrderCategory) {
                return
              }

              const monthCategoryTotals = nonOrderByMonthCategory.get(monthKey) ?? new Map<
                MobileNonOrderCategory,
                { billedAmount: number; paidAmount: number }
              >()
              const monthCurrent = monthCategoryTotals.get(nonOrderCategory) ?? {
                billedAmount: 0,
                paidAmount: 0,
              }
              monthCurrent.billedAmount += normalizedTotalAmount
              monthCurrent.paidAmount += paidAmount
              monthCategoryTotals.set(nonOrderCategory, monthCurrent)
              nonOrderByMonthCategory.set(monthKey, monthCategoryTotals)

              const dateCategoryTotals = nonOrderByDateCategory.get(txnDate) ?? new Map<
                MobileNonOrderCategory,
                { billedAmount: number; paidAmount: number }
              >()
              const dateCurrent = dateCategoryTotals.get(nonOrderCategory) ?? {
                billedAmount: 0,
                paidAmount: 0,
              }
              dateCurrent.billedAmount += normalizedTotalAmount
              dateCurrent.paidAmount += paidAmount
              dateCategoryTotals.set(nonOrderCategory, dateCurrent)
              nonOrderByDateCategory.set(txnDate, dateCategoryTotals)
            })

            quickBooksPayments.forEach((payment) => {
              const projectId = normalizeTextValue((payment as Record<string, unknown>).projectId)
              const projectName = normalizeTextValue((payment as Record<string, unknown>).projectName)
              const txnDate = normalizeIsoDate(normalizeTextValue((payment as Record<string, unknown>).txnDate))

              if (!txnDate) {
                return
              }

              const monthKey = txnDate.slice(0, 7)
              const fallbackProjectNumber = splitQuickBooksProjectLabel(projectName, projectId).projectNumber
              const jobKey = projectLookupById.get(projectId)?.jobKey || normalizeJobName(fallbackProjectNumber)

              if (!jobKey) {
                return
              }

              const totalAmount = Number((payment as Record<string, unknown>).totalAmount)
              const normalizedTotalAmount = Number.isFinite(totalAmount) ? totalAmount : 0

              if (normalizedTotalAmount <= 0) {
                return
              }

              paymentsByMonthJobKey.set(
                `${monthKey}:${jobKey}`,
                Number(((paymentsByMonthJobKey.get(`${monthKey}:${jobKey}`) ?? 0) + normalizedTotalAmount).toFixed(2)),
              )
              paymentsByDateJobKey.set(
                `${txnDate}:${jobKey}`,
                Number(((paymentsByDateJobKey.get(`${txnDate}:${jobKey}`) ?? 0) + normalizedTotalAmount).toFixed(2)),
              )
            })

            const monthKeys = [...monthKeysSet].sort((left, right) => right.localeCompare(left))
            const activeMonthKey = monthKeys[0] ?? ''
            const activeMonthRange = activeMonthKey ? resolveMonthRange(activeMonthKey) : null
            const activeMonthPreviousDate = activeMonthRange
              ? (shiftIsoDateByDays(activeMonthRange.start, -1) ?? activeMonthRange.start)
              : null

            const activeMonthProgressByJobKey = new Map<string, number>()

            if (activeMonthRange && activeMonthPreviousDate) {
              const jobsByKey = monthJobs.get(activeMonthKey) ?? new Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>()

              jobsByKey.forEach((_jobData, jobKey) => {
                const readyRows = progressRowsByJobKey.get(jobKey) ?? []
                const previousReady = resolveLatestReadyPercentOnOrBefore(readyRows, activeMonthPreviousDate) ?? 0
                const endReady = resolveLatestReadyPercentOnOrBefore(readyRows, activeMonthRange.end) ?? previousReady
                const delta = Math.max(0, Number((endReady - previousReady).toFixed(1)))
                activeMonthProgressByJobKey.set(jobKey, delta)
              })
            }

            const workerRows = [...workerTotals.entries()]
              .sort(([, left], [, right]) => right.hours - left.hours)
              .slice(0, 80)
              .map(([workerKey, row], index) => {
                const workerJobs = workerJobKeysByMonth.get(activeMonthKey)?.get(workerKey) ?? new Set<string>()
                const workerJobSummaries = workerJobSummariesByMonth.get(activeMonthKey)?.get(workerKey) ?? new Map<string, {
                  jobName: string
                  totalHours: number
                  totalLaborCost: number
                }>()
                const progressMade = [...workerJobs].reduce(
                  (sum, jobKey) => sum + (activeMonthProgressByJobKey.get(jobKey) ?? 0),
                  0,
                )

                const workerJobDetails = [...workerJobSummaries.values()]
                  .sort((left, right) => right.totalHours - left.totalHours)
                  .slice(0, 20)
                  .map((jobSummary) => (
                    `${clipTextValue(jobSummary.jobName, 30)} - ${t('Hours', 'Horas')}: ${jobSummary.totalHours.toFixed(1)} - ${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(jobSummary.totalLaborCost, locale)}`
                  ))

                return {
                  id: `worker-report-${workerKey || index + 1}`,
                  title: row.label,
                  subtitle: `${t('Hours', 'Horas')}: ${row.hours.toFixed(1)} - ${t('Entries', 'Entradas')}: ${row.entryCount}`,
                  meta: `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(row.laborCost, locale)}`,
                  metrics: [
                    {
                      label: t('Jobs', 'Trabajos'),
                      value: String(workerJobs.size),
                    },
                    {
                      label: t('Progress', 'Progreso'),
                      value: `${progressMade.toFixed(1)}%`,
                    },
                  ],
                  details: workerJobDetails.length > 0
                    ? workerJobDetails
                    : [t('No rows found for this report.', 'No se encontraron filas para este reporte.')],
                }
              })

            const buildWorkerDetailsForJob = (jobKey: string): AdminWorkspaceRowWorkerDetail[] => {
              const workersById = allTimeJobWorkersByJobKey.get(jobKey)

              if (!workersById) {
                return []
              }

              return [...workersById.entries()]
                .map(([workerId, worker]) => ({
                  workerId,
                  workerName: worker.workerName,
                  totalHours: Number(worker.totalHours.toFixed(2)),
                  totalLaborCost: Number(worker.totalLaborCost.toFixed(2)),
                  dateEntries: [...worker.dateTotals.entries()]
                    .sort((left, right) => right[0].localeCompare(left[0]))
                    .map(([date, totals]) => ({
                      date,
                      hours: Number(totals.hours.toFixed(2)),
                      laborCost: Number(totals.laborCost.toFixed(2)),
                    })),
                }))
                .sort((left, right) => right.totalHours - left.totalHours || left.workerName.localeCompare(right.workerName))
            }

            const allTimeJobRows: AdminWorkspaceRow[] = [...allTimeJobsByKey.entries()]
              .map(([jobKey, jobData], index) => {
                const financialTotals = financialTotalsByJobKey.get(jobKey) ?? {
                  purchaseOrderAmount: 0,
                  billAmount: 0,
                  invoiceAmount: 0,
                  paymentAmount: 0,
                }
                const accountsAmount = financialTotals.paymentAmount > 0
                  ? financialTotals.paymentAmount
                  : Math.max(financialTotals.invoiceAmount, financialTotals.purchaseOrderAmount)
                const billsAmount = financialTotals.billAmount
                const totalCost = Number((jobData.totalLaborCost + billsAmount).toFixed(2))
                const totalProfit = Number((accountsAmount - totalCost).toFixed(2))
                const workerDetails = buildWorkerDetailsForJob(jobKey)
                const numberMatch = /\b\d{5,8}\b/.exec(jobData.jobName)
                const fallbackDigits = extractDigits(jobData.jobName)
                const displayOrderNumber = numberMatch?.[0] || fallbackDigits || ''

                return {
                  sortProfit: totalProfit,
                  row: {
                    id: `job-report-${jobKey || index + 1}`,
                    title: displayOrderNumber ? `#${displayOrderNumber}` : clipTextValue(jobData.jobName, 30),
                    subtitle: `${t('Total profit', 'Ganancia total')}: ${formatCurrencyAmountPrecise(totalProfit, locale)}`,
                    meta: `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(jobData.totalLaborCost, locale)}`,
                    metrics: [
                      {
                        label: t('Hours', 'Horas'),
                        value: jobData.totalHours.toFixed(1),
                      },
                      {
                        label: t('Labor', 'Mano de obra'),
                        value: formatCurrencyAmountPrecise(jobData.totalLaborCost, locale),
                      },
                      {
                        label: t('Total cost', 'Costo total'),
                        value: formatCurrencyAmountPrecise(totalCost, locale),
                      },
                    ],
                    details: [
                      `${t('Job', 'Trabajo')}: ${jobData.jobName}`,
                      `${t('Hours', 'Horas')}: ${jobData.totalHours.toFixed(1)}`,
                      `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(jobData.totalLaborCost, locale)}`,
                      `${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(billsAmount, locale)}`,
                      `${t('Total cost', 'Costo total')}: ${formatCurrencyAmountPrecise(totalCost, locale)}`,
                      `${t('Accounts', 'Cuentas')}: ${formatCurrencyAmountPrecise(accountsAmount, locale)}`,
                      `${t('Total profit', 'Ganancia total')}: ${formatCurrencyAmountPrecise(totalProfit, locale)}`,
                    ],
                    workerDetails,
                  },
                }
              })
              .sort((left, right) => right.sortProfit - left.sortProfit || left.row.title.localeCompare(right.row.title))
              .map(({ row }) => row)

            const monthSummaryByKey = new Map<string, {
              totalAmountSpent: number
              totalCostShould: number
              totalEarned: number
              totalShouldEarn: number
            }>()
            const monthJobDataByKey = new Map<string, Array<{
              id: string
              jobName: string
              totalHours: number
              totalLaborCost: number
              previousReadyPercent: number
              endReadyPercent: number
              progressDeltaPercent: number
              contractAmount: number
              expectedEarnedAmount: number
              billsAmount: number
              receivedThisMonth: number
            }>>()

            const monthRows: AdminWorkspaceRow[] = monthKeys
              .slice(0, 24)
              .flatMap((monthKey) => {
                const jobsByKey = monthJobs.get(monthKey) ?? new Map<string, {
                  jobName: string
                  totalHours: number
                  totalLaborCost: number
                }>()
                const monthRange = resolveMonthRange(monthKey)
                const monthStart = monthRange?.start ?? `${monthKey}-01`
                const previousDate = shiftIsoDateByDays(monthStart, -1) ?? monthStart
                const monthLabel = formatMonthBucketLabel(monthKey, locale)

                const jobRows = [...jobsByKey.entries()]
                  .map(([jobKey, jobData], jobIndex) => {
                    const financialTotals = financialTotalsByJobKey.get(jobKey) ?? {
                      purchaseOrderAmount: 0,
                      billAmount: 0,
                      invoiceAmount: 0,
                      paymentAmount: 0,
                    }
                    const readyRows = progressRowsByJobKey.get(jobKey) ?? []
                    const previousReadyPercent = resolveLatestReadyPercentOnOrBefore(readyRows, previousDate) ?? 0
                    const endReadyPercent = monthRange
                      ? (resolveLatestReadyPercentOnOrBefore(readyRows, monthRange.end) ?? previousReadyPercent)
                      : previousReadyPercent
                    const progressDeltaPercent = Math.max(
                      0,
                      Number((endReadyPercent - previousReadyPercent).toFixed(1)),
                    )
                    const contractAmount = financialTotals.purchaseOrderAmount > 0
                      ? financialTotals.purchaseOrderAmount
                      : Math.max(financialTotals.invoiceAmount, financialTotals.paymentAmount)
                    const expectedEarnedAmount = Number(((contractAmount * progressDeltaPercent) / 100).toFixed(2))
                    const receivedThisMonth = paymentsByMonthJobKey.get(`${monthKey}:${jobKey}`) ?? 0

                    return {
                      id: `month-job-${monthKey}-${jobIndex + 1}`,
                      jobName: jobData.jobName,
                      totalHours: jobData.totalHours,
                      totalLaborCost: jobData.totalLaborCost,
                      previousReadyPercent,
                      endReadyPercent,
                      progressDeltaPercent,
                      contractAmount,
                      expectedEarnedAmount,
                      billsAmount: financialTotals.billAmount,
                      receivedThisMonth,
                    }
                  })
                  .sort((left, right) => {
                    if (right.expectedEarnedAmount !== left.expectedEarnedAmount) {
                      return right.expectedEarnedAmount - left.expectedEarnedAmount
                    }

                    return left.jobName.localeCompare(right.jobName)
                  })

                monthJobDataByKey.set(monthKey, jobRows)

                const monthNonOrderCategories = nonOrderByMonthCategory.get(monthKey)
                const totalNonOrderBilled = MOBILE_NON_ORDER_CATEGORY_CONFIG.reduce((sum, config) => {
                  const totals = monthNonOrderCategories?.get(config.category)
                  return sum + (totals?.billedAmount ?? 0)
                }, 0)
                const totalNonOrderPaid = MOBILE_NON_ORDER_CATEGORY_CONFIG.reduce((sum, config) => {
                  const totals = monthNonOrderCategories?.get(config.category)
                  return sum + (totals?.paidAmount ?? 0)
                }, 0)
                const monthLabor = jobRows.reduce((sum, row) => sum + row.totalLaborCost, 0)
                const monthBills = jobRows.reduce((sum, row) => sum + row.billsAmount, 0)
                const monthEarned = jobRows.reduce((sum, row) => sum + row.receivedThisMonth, 0)
                const monthShouldEarn = jobRows.reduce((sum, row) => sum + row.expectedEarnedAmount, 0)

                monthSummaryByKey.set(monthKey, {
                  totalAmountSpent: Number((monthLabor + totalNonOrderPaid).toFixed(2)),
                  totalCostShould: Number((monthLabor + monthBills + totalNonOrderBilled).toFixed(2)),
                  totalEarned: Number(monthEarned.toFixed(2)),
                  totalShouldEarn: Number(monthShouldEarn.toFixed(2)),
                })

                const monthJobRows: AdminWorkspaceRow[] = jobRows.map((row) => {
                  const totalCost = Number((row.totalLaborCost + row.billsAmount).toFixed(2))
                  const projectProfit = Number((row.expectedEarnedAmount - totalCost).toFixed(2))
                  const netProfit = Number((row.receivedThisMonth - totalCost).toFixed(2))

                  return {
                    id: row.id,
                    title: `${monthLabel} • ${clipTextValue(row.jobName, 28)}`,
                    subtitle: `${t('Hours', 'Horas')}: ${row.totalHours.toFixed(1)} - ${t('Project profit', 'Ganancia del proyecto')}: ${formatCurrencyAmountPrecise(projectProfit, locale)}`,
                    meta: `${t('Net profit', 'Ganancia neta')}: ${formatCurrencyAmountPrecise(netProfit, locale)}`,
                    metrics: [
                      {
                        label: t('Accounts', 'Cuentas'),
                        value: formatCurrencyAmountPrecise(row.receivedThisMonth, locale),
                      },
                      {
                        label: t('Labor', 'Mano de obra'),
                        value: formatCurrencyAmountPrecise(row.totalLaborCost, locale),
                      },
                      {
                        label: t('Bills', 'Facturas'),
                        value: formatCurrencyAmountPrecise(row.billsAmount, locale),
                      },
                      {
                        label: t('Total cost', 'Costo total'),
                        value: formatCurrencyAmountPrecise(totalCost, locale),
                      },
                    ],
                    details: [
                      `${t('Accounts', 'Cuentas')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)}`,
                      `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(row.totalLaborCost, locale)}`,
                      `${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(row.billsAmount, locale)}`,
                      `${t('Total cost', 'Costo total')}: ${formatCurrencyAmountPrecise(totalCost, locale)}`,
                      `${t('Ready order amount', 'Monto de orden listo')}: ${formatCurrencyAmountPrecise(row.expectedEarnedAmount, locale)}`,
                      `${t('Earned amount', 'Monto ganado')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)}`,
                      `${t('Project profit', 'Ganancia del proyecto')}: ${formatCurrencyAmountPrecise(projectProfit, locale)}`,
                      `${t('Net profit', 'Ganancia neta')}: ${formatCurrencyAmountPrecise(netProfit, locale)}`,
                    ],
                  }
                })

                const monthNonOrderRows: AdminWorkspaceRow[] = MOBILE_NON_ORDER_CATEGORY_CONFIG.map((config, categoryIndex) => {
                  const totals = monthNonOrderCategories?.get(config.category) ?? {
                    billedAmount: 0,
                    paidAmount: 0,
                  }

                  return {
                    id: `month-non-order-${monthKey}-${categoryIndex + 1}`,
                    title: `${monthLabel} • ${config.label} (non-order)`,
                    subtitle: `${t('Billed', 'Facturado')}: ${formatCurrencyAmountPrecise(totals.billedAmount, locale)} - ${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(totals.paidAmount, locale)}`,
                    metrics: [
                      {
                        label: t('Category', 'Categoria'),
                        value: config.label,
                      },
                    ],
                  }
                }).filter((row) => row.subtitle.includes('$'))

                return [...monthJobRows, ...monthNonOrderRows]
              })

            const dateJobs = new Map<string, Map<string, {
              jobName: string
              totalHours: number
              totalLaborCost: number
            }>>()

            entries.forEach((entry, index) => {
              const normalizedDate = normalizeIsoDate(normalizeTextValue(entry.date))

              if (!normalizedDate) {
                return
              }

              const regularHours = Number(entry.hours)
              const overtimeHours = Number(entry.overtimeHours)
              const safeRegularHours = Number.isFinite(regularHours) ? Math.max(0, regularHours) : 0
              const safeOvertimeHours = Number.isFinite(overtimeHours) ? Math.max(0, overtimeHours) : 0
              const combinedHours = safeRegularHours + safeOvertimeHours

              if (combinedHours <= 0) {
                return
              }

              const workerId = normalizeTextValue(entry.workerId)
              const workerSnapshotRate = Number(entry.payRate)
              const fallbackRate = workerRateById.get(workerId) ?? 0
              const resolvedRate = Number.isFinite(workerSnapshotRate) && workerSnapshotRate > 0
                ? workerSnapshotRate
                : fallbackRate
              const laborCost = (safeRegularHours * resolvedRate) + (safeOvertimeHours * resolvedRate * 1.5)
              const jobName = normalizeTextValue(entry.jobName) || t('Unnamed job', 'Trabajo sin nombre')
              const jobKey = normalizeJobName(jobName) || `date-job-${index + 1}`
              const jobsByKey = dateJobs.get(normalizedDate) ?? new Map<string, {
                jobName: string
                totalHours: number
                totalLaborCost: number
              }>()
              const current = jobsByKey.get(jobKey) ?? {
                jobName,
                totalHours: 0,
                totalLaborCost: 0,
              }
              current.totalHours += combinedHours
              current.totalLaborCost += laborCost
              jobsByKey.set(jobKey, current)
              dateJobs.set(normalizedDate, jobsByKey)
            })

            const dateRows: AdminWorkspaceRow[] = [...dateJobs.keys()]
              .sort((left, right) => right.localeCompare(left))
              .slice(0, 45)
              .flatMap((dateKey) => {
                const jobsByKey = dateJobs.get(dateKey) ?? new Map<string, {
                  jobName: string
                  totalHours: number
                  totalLaborCost: number
                }>()
                const previousDate = shiftIsoDateByDays(dateKey, -1) ?? dateKey
                const dateLabel = formatDisplayDate(dateKey, locale)

                const jobRows: AdminWorkspaceRow[] = [...jobsByKey.entries()].map(([jobKey, jobData], jobIndex) => {
                  const readyRows = progressRowsByJobKey.get(jobKey) ?? []
                  const previousReadyPercent = resolveLatestReadyPercentOnOrBefore(readyRows, previousDate) ?? 0
                  const endReadyPercent = resolveLatestReadyPercentOnOrBefore(readyRows, dateKey) ?? previousReadyPercent
                  const progressDeltaPercent = Math.max(
                    0,
                    Number((endReadyPercent - previousReadyPercent).toFixed(1)),
                  )

                  return {
                    id: `date-report-${dateKey}-${jobIndex + 1}`,
                    title: `${dateLabel} • ${clipTextValue(jobData.jobName, 28)}`,
                    subtitle: `${t('Hours', 'Horas')}: ${jobData.totalHours.toFixed(1)} - ${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(jobData.totalLaborCost, locale)}`,
                    meta: `${t('Progress', 'Progreso')}: ${previousReadyPercent.toFixed(1)}% -> ${endReadyPercent.toFixed(1)}% (+${progressDeltaPercent.toFixed(1)}%)`,
                    metrics: [
                      {
                        label: t('Bills', 'Facturas'),
                        value: formatCurrencyAmountPrecise(billsByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale),
                      },
                      {
                        label: t('Bills paid', 'Facturas pagadas'),
                        value: formatCurrencyAmountPrecise(billsPaidByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale),
                      },
                      {
                        label: t('Received', 'Recibido'),
                        value: formatCurrencyAmountPrecise(paymentsByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale),
                      },
                    ],
                    details: [
                      `${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(billsByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale)}`,
                      `${t('Bills paid', 'Facturas pagadas')}: ${formatCurrencyAmountPrecise(billsPaidByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale)}`,
                      `${t('Received', 'Recibido')}: ${formatCurrencyAmountPrecise(paymentsByDateJobKey.get(`${dateKey}:${jobKey}`) ?? 0, locale)}`,
                    ],
                  }
                })

                const dateNonOrderCategories = nonOrderByDateCategory.get(dateKey)
                const nonOrderRows: AdminWorkspaceRow[] = MOBILE_NON_ORDER_CATEGORY_CONFIG.map((config, categoryIndex) => {
                  const totals = dateNonOrderCategories?.get(config.category) ?? {
                    billedAmount: 0,
                    paidAmount: 0,
                  }

                  return {
                    id: `date-non-order-${dateKey}-${categoryIndex + 1}`,
                    title: `${dateLabel} • ${config.label} (non-order)`,
                    subtitle: `${t('Billed', 'Facturado')}: ${formatCurrencyAmountPrecise(totals.billedAmount, locale)} - ${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(totals.paidAmount, locale)}`,
                    details: [
                      `${t('Category', 'Categoria')}: ${config.label}`,
                      `${t('Billed', 'Facturado')}: ${formatCurrencyAmountPrecise(totals.billedAmount, locale)}`,
                      `${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(totals.paidAmount, locale)}`,
                    ],
                  }
                }).filter((row) => row.subtitle.includes('$'))

                return [...jobRows, ...nonOrderRows]
              })

            const activeMonthSummary = monthSummaryByKey.get(activeMonthKey) ?? {
              totalAmountSpent: 0,
              totalCostShould: 0,
              totalEarned: 0,
              totalShouldEarn: 0,
            }
            const activeMonthNetProfit = Number((activeMonthSummary.totalEarned - activeMonthSummary.totalCostShould).toFixed(2))
            const activeMonthProjectProfit = Number((activeMonthSummary.totalShouldEarn - activeMonthSummary.totalCostShould).toFixed(2))
            const activeMonthLabel = activeMonthKey
              ? formatMonthBucketLabel(activeMonthKey, locale)
              : t('Current month', 'Mes actual')
            const activeMonthTotalCostBillRows = billRowsByMonth.get(activeMonthKey) ?? []
            const activeMonthOverheadBillRows = overheadBillRowsByMonth.get(activeMonthKey) ?? []
            const activeMonthJobData = monthJobDataByKey.get(activeMonthKey) ?? []

            const activeMonthNetProfitRows: AdminWorkspaceRow[] = [...activeMonthJobData]
              .map((row, index) => {
                const totalCost = Number((row.totalLaborCost + row.billsAmount).toFixed(2))
                const netProfit = Number((row.receivedThisMonth - totalCost).toFixed(2))
                const projectProfit = Number((row.expectedEarnedAmount - totalCost).toFixed(2))

                return {
                  id: `month-net-${activeMonthKey}-${index + 1}`,
                  title: clipTextValue(row.jobName, 36),
                  subtitle: `${t('Net profit', 'Ganancia neta')}: ${formatCurrencyAmountPrecise(netProfit, locale)}`,
                  meta: `${t('Earned amount', 'Monto ganado')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)} - ${t('Total cost', 'Costo total')}: ${formatCurrencyAmountPrecise(totalCost, locale)}`,
                  details: [
                    `${t('Accounts', 'Cuentas')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)}`,
                    `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(row.totalLaborCost, locale)}`,
                    `${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(row.billsAmount, locale)}`,
                    `${t('Total cost', 'Costo total')}: ${formatCurrencyAmountPrecise(totalCost, locale)}`,
                    `${t('Ready order amount', 'Monto de orden listo')}: ${formatCurrencyAmountPrecise(row.expectedEarnedAmount, locale)}`,
                    `${t('Project profit', 'Ganancia del proyecto')}: ${formatCurrencyAmountPrecise(projectProfit, locale)}`,
                    `${t('Net profit', 'Ganancia neta')}: ${formatCurrencyAmountPrecise(netProfit, locale)}`,
                  ],
                }
              })
              .sort((left, right) => {
                return left.title.localeCompare(right.title)
              })

            const activeMonthProjectProfitRows: AdminWorkspaceRow[] = [...activeMonthJobData]
              .map((row, index) => {
                const totalCost = Number((row.totalLaborCost + row.billsAmount).toFixed(2))
                const netProfit = Number((row.receivedThisMonth - totalCost).toFixed(2))
                const projectProfit = Number((row.expectedEarnedAmount - totalCost).toFixed(2))

                return {
                  id: `month-project-${activeMonthKey}-${index + 1}`,
                  title: clipTextValue(row.jobName, 36),
                  subtitle: `${t('Project profit', 'Ganancia del proyecto')}: ${formatCurrencyAmountPrecise(projectProfit, locale)}`,
                  meta: `${t('Ready order amount', 'Monto de orden listo')}: ${formatCurrencyAmountPrecise(row.expectedEarnedAmount, locale)}`,
                  details: [
                    `${t('Accounts', 'Cuentas')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)}`,
                    `${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(row.totalLaborCost, locale)}`,
                    `${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(row.billsAmount, locale)}`,
                    `${t('Total cost', 'Costo total')}: ${formatCurrencyAmountPrecise(totalCost, locale)}`,
                    `${t('Ready order amount', 'Monto de orden listo')}: ${formatCurrencyAmountPrecise(row.expectedEarnedAmount, locale)}`,
                    `${t('Earned amount', 'Monto ganado')}: ${formatCurrencyAmountPrecise(row.receivedThisMonth, locale)}`,
                    `${t('Project profit', 'Ganancia del proyecto')}: ${formatCurrencyAmountPrecise(projectProfit, locale)}`,
                    `${t('Net profit', 'Ganancia neta')}: ${formatCurrencyAmountPrecise(netProfit, locale)}`,
                  ],
                }
              })
              .sort((left, right) => {
                return left.title.localeCompare(right.title)
              })

            panelData = {
              updatedAt: normalizeTextValue(quickBooksPayload.generatedAt) || new Date().toISOString(),
              note: t(
                'Reports are organized with worker, month, and date cards. Non-order categories are included inside each month/date breakdown.',
                'Los reportes estan organizados con tarjetas por trabajador, mes y fecha. Las categorias no relacionadas a ordenes estan incluidas dentro de cada desglose por mes/fecha.',
              ),
              stats: [
                {
                  id: 'general_overhead',
                  label: `${t('General overhead', 'Gasto general')} (${activeMonthLabel})`,
                  value: formatCurrencyAmountPrecise(activeMonthSummary.totalAmountSpent, locale),
                },
                {
                  id: 'total_cost',
                  label: t('Total cost', 'Costo total'),
                  value: formatCurrencyAmountPrecise(activeMonthSummary.totalCostShould, locale),
                },
                {
                  id: 'net_profit',
                  label: t('Net profit', 'Ganancia neta'),
                  value: formatCurrencyAmountPrecise(activeMonthNetProfit, locale),
                },
                {
                  id: 'project_profit',
                  label: t('Project profit', 'Ganancia del proyecto'),
                  value: formatCurrencyAmountPrecise(activeMonthProjectProfit, locale),
                },
              ],
              sections: [
                {
                  id: 'report_worker',
                  title: t('Hours by worker', 'Horas por trabajador'),
                  emptyText: t('No worker report rows.', 'No hay filas por trabajador.'),
                  rows: workerRows,
                },
                {
                  id: 'report_month',
                  title: t('Report by month', 'Reporte por mes'),
                  emptyText: t('No month report rows.', 'No hay filas por mes.'),
                  rows: monthRows,
                },
                {
                  id: 'report_job',
                  title: t('Report by job', 'Reporte por trabajo'),
                  emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
                  rows: allTimeJobRows,
                },
                {
                  id: 'report_date',
                  title: t('Report by date', 'Reporte por fecha'),
                  emptyText: t('No date report rows.', 'No hay filas por fecha.'),
                  rows: dateRows,
                },
                {
                  id: 'report_month_total_cost_bills',
                  title: `${t('Bill list', 'Lista de facturas')} - ${t('Total cost', 'Costo total')}`,
                  emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
                  rows: activeMonthTotalCostBillRows,
                },
                {
                  id: 'report_month_overhead_bills',
                  title: `${t('Bill list', 'Lista de facturas')} - ${t('General overhead', 'Gasto general')}`,
                  emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
                  rows: activeMonthOverheadBillRows,
                },
                {
                  id: 'report_month_net_profit_orders',
                  title: t('Net profit by order', 'Ganancia neta por orden'),
                  emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
                  rows: activeMonthNetProfitRows,
                },
                {
                  id: 'report_month_project_profit_orders',
                  title: t('Project profit by order', 'Ganancia del proyecto por orden'),
                  emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
                  rows: activeMonthProjectProfitRows,
                },
              ],
            }
            break
          }

          case '/admin/users': {
            const payload = await requestWithSession<{
              users?: Array<Record<string, unknown>>
            }>('/api/auth/users')

            const users: AdminWorkspaceUserRecord[] = Array.isArray(payload.users)
              ? payload.users.map((user, index) => ({
                  uid: normalizeTextValue(user.uid) || `user-${index + 1}`,
                  email: normalizeTextValue(user.email) || '-',
                  displayName: normalizeTextValue(user.displayName) || '-',
                  role: normalizeAdminUserRole(user.role),
                  isApproved: user.isApproved === true,
                  clientAccessMode: normalizeAdminAccessMode(user.clientAccessMode),
                  hasWebAccess: user.hasWebAccess === true || normalizeAdminAccessMode(user.clientAccessMode) !== 'app_only',
                  hasAppAccess: user.hasAppAccess === true || normalizeAdminAccessMode(user.clientAccessMode) !== 'web_only',
                  lastLoginAt: normalizeTextValue(user.lastLoginAt) || null,
                }))
              : []

            const sortedUsers = [...users].sort(
              (left, right) => {
                if (left.isApproved !== right.isApproved) {
                  return Number(left.isApproved) - Number(right.isApproved)
                }

                return left.email.localeCompare(right.email)
              },
            )

            setAdminUsersForAccess(sortedUsers)

            const approvedCount = users.filter((user) => user.isApproved).length
            const webAccessCount = users.filter((user) => user.hasWebAccess).length
            const appAccessCount = users.filter((user) => user.hasAppAccess).length
            const adminCount = users.filter((user) => user.role === 'admin').length
            const pendingCount = users.filter((user) => !user.isApproved).length

            panelData = {
              updatedAt: new Date().toISOString(),
              stats: [
                { label: t('Users', 'Usuarios'), value: String(users.length) },
                { label: t('Approved', 'Aprobados'), value: String(approvedCount) },
                { label: t('Pending', 'Pendientes'), value: String(pendingCount) },
                { label: t('Admins', 'Admins'), value: String(adminCount) },
                { label: t('Web access', 'Acceso web'), value: String(webAccessCount) },
                { label: t('App access', 'Acceso app'), value: String(appAccessCount) },
              ],
              sections: [
                {
                  id: 'user_accounts',
                  title: t('User accounts', 'Cuentas de usuario'),
                  emptyText: t('No users found.', 'No hay usuarios.'),
                  rows: sortedUsers.slice(0, 120).map((user) => {
                    const roleLabel = normalizeTextValue(user.role).toUpperCase() || 'STANDARD'
                    const approvalLabel = user.isApproved
                      ? t('Approved', 'Aprobado')
                      : t('Pending', 'Pendiente')
                    const accessLabel =
                      user.clientAccessMode === 'web_only'
                        ? t('Web only', 'Solo web')
                        : user.clientAccessMode === 'app_only'
                          ? t('App only', 'Solo app')
                          : t('Web + App', 'Web + App')

                    return {
                      id: user.uid,
                      title: user.displayName || user.email,
                      subtitle: `${roleLabel} - ${approvalLabel}`,
                      meta: `${t('Access mode', 'Modo acceso')}: ${accessLabel} - ${t('Last login', 'Ultimo acceso')}: ${formatSyncTimestamp(user.lastLoginAt, locale)}`,
                    }
                  }),
                },
              ],
            }
            break
          }

          default: {
            panelData = {
              updatedAt: new Date().toISOString(),
              stats: [],
              sections: [],
              note: t('Unsupported admin page.', 'Pagina admin no soportada.'),
            }
          }
        }

        if (panelData) {
          setAdminWorkspaceDataByPath((previous) => ({
            ...previous,
            [routePath]: panelData,
          }))
        }
      } catch (error) {
        setAdminPortalMessage(
          getErrorMessage(
            error,
            'Could not load admin data right now.',
            'No se pudo cargar datos admin ahora.',
          ),
        )
      } finally {
        setAdminWorkspaceLoadingPath((current) => (current === routePath ? null : current))
      }
    },
    [adminWorkspaceDataByPath, getErrorMessage, locale, requestWithSession, t],
  )

  const handleAdminWorkspaceRefresh = useCallback(() => {
    if (!adminPortalRoutePath) {
      return
    }

    void loadAdminWorkspacePage(adminPortalRoutePath, true)
  }, [adminPortalRoutePath, loadAdminWorkspacePage])

  const handleUpdateAdminUserAccess = useCallback(async (uid: string, mode: AdminAccessMode) => {
    const targetUid = normalizeTextValue(uid)

    if (!targetUid) {
      return
    }

    setAdminUserSavingUid(targetUid)
    setAdminPortalMessage(null)

    try {
      await requestWithSession(`/api/auth/users/${encodeURIComponent(targetUid)}/client-access`, false, {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      })
      await loadAdminWorkspacePage('/admin/users', true)
      setAdminPortalMessage(t('User access updated.', 'Acceso del usuario actualizado.'))
    } catch (error) {
      setAdminPortalMessage(
        getErrorMessage(
          error,
          'Could not update user access right now.',
          'No se pudo actualizar el acceso del usuario ahora.',
        ),
      )
    } finally {
      setAdminUserSavingUid((current) => (current === targetUid ? null : current))
    }
  }, [getErrorMessage, loadAdminWorkspacePage, requestWithSession, t])

  const handleToggleAdminUserApproval = useCallback(async (user: AdminWorkspaceUserRecord) => {
    const targetUid = normalizeTextValue(user.uid)

    if (!targetUid) {
      return
    }

    setAdminUserSavingUid(targetUid)
    setAdminPortalMessage(null)

    try {
      const path = user.isApproved
        ? `/api/auth/users/${encodeURIComponent(targetUid)}/unapprove`
        : `/api/auth/users/${encodeURIComponent(targetUid)}/approval`
      const payload = user.isApproved
        ? {}
        : {
          role: user.role,
          ...(user.role === 'admin' ? { confirmAdminPromotion: true } : {}),
        }

      await requestWithSession(path, false, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      await loadAdminWorkspacePage('/admin/users', true)
      setAdminPortalMessage(
        user.isApproved
          ? t('User access removed.', 'Acceso del usuario retirado.')
          : t('User access granted.', 'Acceso del usuario otorgado.'),
      )
    } catch (error) {
      setAdminPortalMessage(
        getErrorMessage(
          error,
          'Could not update user approval right now.',
          'No se pudo actualizar la aprobacion del usuario ahora.',
        ),
      )
    } finally {
      setAdminUserSavingUid((current) => (current === targetUid ? null : current))
    }
  }, [getErrorMessage, loadAdminWorkspacePage, requestWithSession, t])

  const syncAuthProfile = useCallback(async () => {
    if (!firebaseUser) {
      setAuthProfile(null)
      setIsCheckingApproval(false)
      return
    }

    setIsCheckingApproval(true)

    try {
      const payload = await requestWithSession<{
        user?: {
          isApproved?: unknown
          role?: unknown
          isAdmin?: unknown
          isManager?: unknown
          isSalesRep?: unknown
          isShopWorker?: unknown
        }
      }>('/api/auth/me')

      const approvalValue = payload?.user?.isApproved

      if (typeof approvalValue !== 'boolean') {
        setAuthMessage(t('Unable to verify account approval.', 'No se pudo verificar la aprobacion de la cuenta.'))
        return
      }

      const roleValue = String(payload?.user?.role ?? '').trim().toLowerCase()
      const normalizedRole = ['standard', 'manager', 'sales_rep', 'shop_worker', 'admin'].includes(roleValue)
        ? (roleValue as MobileAuthUser['role'])
        : 'standard'
      const isAdmin = payload?.user?.isAdmin === true || normalizedRole === 'admin'
      const isManager = payload?.user?.isManager === true || normalizedRole === 'manager'

      setAuthProfile({
        isApproved: approvalValue,
        role: normalizedRole,
        isAdmin,
        isManager,
        isSalesRep: payload?.user?.isSalesRep === true || normalizedRole === 'sales_rep',
        isShopWorker: payload?.user?.isShopWorker === true || normalizedRole === 'shop_worker',
      })
      setAuthMessage(null)
    } catch (error) {
      const status = (error as { status?: number })?.status

      if (status === 401) {
        return
      }

      if (status === 403) {
        lockSessionWithMessage(
          error instanceof Error && error.message
            ? error.message
            : t(
                'Access is blocked outside your allowed login hours.',
                'El acceso esta bloqueado fuera de tu horario permitido de inicio de sesion.',
              ),
        )
        return
      }

      setAuthMessage(
        getErrorMessage(
          error,
          'Could not verify account access.',
          'No se pudo verificar el acceso de la cuenta.',
        ),
      )
    } finally {
      setIsCheckingApproval(false)
    }
  }, [firebaseUser, getErrorMessage, lockSessionWithMessage, requestWithSession, t])

  const handleAuthenticateBiometric = useCallback(async () => {
    setIsAuthenticatingBiometric(true)

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync()
      const isEnrolled = await LocalAuthentication.isEnrolledAsync()

      if (!hasHardware || !isEnrolled) {
        setIsBiometricEnabled(false)
        unlockBiometricSession()
        await AsyncStorage.setItem(MOBILE_BIOMETRIC_ENABLED_KEY, 'false')
        setAuthMessage(
          t(
            'Biometric unlock is not available on this device. It has been turned off.',
            'El desbloqueo biometrico no esta disponible en este dispositivo. Se desactivo.',
          ),
        )
        return
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Use biometrics for Arnold', 'Usar biometria para Arnold'),
        fallbackLabel: t('Use device passcode', 'Usar codigo del dispositivo'),
        disableDeviceFallback: false,
      })

      if (result.success) {
        unlockBiometricSession()
        setAuthMessage(null)
        return
      }

      setAuthMessage(
        t('Biometric verification was cancelled. Try again or skip.', 'La verificacion biometrica se cancelo. Intenta de nuevo o omitir.'),
      )
    } catch (error) {
      setAuthMessage(
        getErrorMessage(error, 'Could not verify biometrics.', 'No se pudo verificar la biometria.'),
      )
    } finally {
      setIsAuthenticatingBiometric(false)
    }
  }, [getErrorMessage, t, unlockBiometricSession])

  const handleSkipBiometricPrompt = useCallback(() => {
    setHasBiometricSessionAuth(false)
    setHasSkippedBiometricPrompt(true)
    setIsBiometricPromptOpen(false)
    setAuthMessage(null)
  }, [])

  const maybeAutoPromptBiometric = useCallback(() => {
    if (!firebaseUser || !authProfile?.isApproved) {
      return
    }

    if (!isBiometricEnabled || hasBiometricSessionAuth || isAuthenticatingBiometric) {
      return
    }

    const now = Date.now()

    // Prevent immediate re-trigger loops after user cancels biometric verification.
    if (now - lastAutoBiometricAttemptAt < 3000) {
      return
    }

    setLastAutoBiometricAttemptAt(now)
    void handleAuthenticateBiometric()
  }, [
    authProfile?.isApproved,
    firebaseUser,
    handleAuthenticateBiometric,
    hasBiometricSessionAuth,
    isAuthenticatingBiometric,
    isBiometricEnabled,
    lastAutoBiometricAttemptAt,
  ])

  const handleUseGoogleSessionUnlock = useCallback(() => {
    // User is already authenticated with Google at this stage; allow session unlock without biometric.
    unlockBiometricSession()
    setAuthMessage(null)
  }, [unlockBiometricSession])

  const handleChangeLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage)

    try {
      await AsyncStorage.setItem(MOBILE_LANGUAGE_KEY, nextLanguage)
    } catch {
      // Keep selected language in memory if persistence fails.
    }
  }, [])

  const handleToggleBiometricFromSettings = useCallback(async () => {
    if (isBiometricEnabled) {
      setIsDisableBiometricConfirmOpen(true)
      return
    }

    setIsBiometricEnabled(true)
    lockBiometricSession()
    await AsyncStorage.setItem(MOBILE_BIOMETRIC_ENABLED_KEY, 'true')

    if (authProfile?.isApproved) {
      setIsBiometricPromptOpen(true)
    }
  }, [authProfile?.isApproved, isBiometricEnabled, lockBiometricSession])

  const openAppUpdateUrl = useCallback(async (preferredUrl?: string | null) => {
    const targetUpdateUrl = String(preferredUrl ?? '').trim()

    if (!targetUpdateUrl) {
      setUpdateMessage(
        t(
          'Update link is not configured yet. Ask admin to set platform update URLs.',
          'El enlace de actualizacion no esta configurado. Pide al administrador que configure los enlaces de actualizacion.',
        ),
      )
      return false
    }

    try {
      const launchUrl =
        Platform.OS === 'android' && /\.apk(?:$|\?)/i.test(targetUpdateUrl)
          ? `${targetUpdateUrl}${targetUpdateUrl.includes('?') ? '&' : '?'}installTs=${Date.now()}`
          : targetUpdateUrl
      const canOpen = await Linking.canOpenURL(launchUrl)

      if (!canOpen) {
        setUpdateMessage(
          t(
            'This device cannot open the update link. Contact support.',
            'Este dispositivo no puede abrir el enlace de actualizacion. Contacta soporte.',
          ),
        )
        return false
      }

      await Linking.openURL(launchUrl)
      setUpdateMessage(
        t(
          'Update link opened. Install the new version when prompted.',
          'Se abrio el enlace de actualizacion. Instala la nueva version cuando se te pida.',
        ),
      )
      return true
    } catch (error) {
      setUpdateMessage(
        getErrorMessage(
          error,
          'Could not open update link.',
          'No se pudo abrir el enlace de actualizacion.',
        ),
      )
      return false
    }
  }, [getErrorMessage, t])

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateMessage(null)
    setResolvedUpdateUrl('')
    setIsCheckingForUpdates(true)

    try {
      const updatePlatform = Platform.OS === 'ios' ? 'ios' : 'android'
      const payload = await requestWithSession<AppUpdateStatusResponse>(
        `/api/app-updates/status?platform=${updatePlatform}`,
      )
      const backendUpdateUrl = String(payload?.url ?? '').trim()
      const latestBuildNumber = parseBuildNumberLike(payload?.build)
      const candidateUpdateUrl = withBuildQuery(backendUpdateUrl, latestBuildNumber ?? Number.NaN)
      const latestVersion = String(payload?.version ?? '').trim()
      const versionComparison = compareVersionLabels(latestVersion, installedNativeVersion)
      const hasComparableBuilds = latestBuildNumber !== null && installedNativeBuildNumber !== null
      const hasComparableVersions = versionComparison !== null
      const hasNewNativeBuild = hasComparableBuilds
        ? latestBuildNumber > installedNativeBuildNumber
        : hasComparableVersions
          ? versionComparison > 0
          : false

      if (!candidateUpdateUrl) {
        setUpdateMessage(
          t(
            'Update link is not configured yet.',
            'El enlace de actualizacion aun no esta configurado.',
          ),
        )
        return
      }

      if (!hasNewNativeBuild) {
        const currentVersionText = installedNativeVersion || 'unknown'

        setUpdateMessage(
          t(
            `You already have the latest version (${currentVersionText}).`,
            `Ya tienes la version mas reciente (${currentVersionText}).`,
          ),
        )
        return
      }

      setResolvedUpdateUrl(candidateUpdateUrl)
      if (latestVersion) {
        setUpdateMessage(
          t(
            `Native update found (Version ${latestVersion}). Tap Install Update.`,
            `Se encontro actualizacion nativa (Version ${latestVersion}). Toca Instalar actualizacion.`,
          ),
        )
        return
      }

      setUpdateMessage(
        t(
          'Native update found. Tap Install Update to continue.',
          'Se encontro actualizacion nativa. Toca Instalar actualizacion para continuar.',
        ),
      )
    } catch (error) {
      setUpdateMessage(
        getErrorMessage(
          error,
          'Could not check for updates.',
          'No se pudo buscar actualizaciones.',
        ),
      )
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [
    getErrorMessage,
    installedNativeBuildNumber,
    installedNativeVersion,
    requestWithSession,
    t,
  ])

  const handleInstallUpdate = useCallback(async () => {
    if (!resolvedUpdateUrl) {
      setUpdateMessage(
        t(
          'Check for updates first.',
          'Primero busca actualizaciones.',
        ),
      )
      return
    }

    setIsInstallingUpdate(true)

    try {
      await openAppUpdateUrl(resolvedUpdateUrl)
    } catch (error) {
      setUpdateMessage(
        getErrorMessage(
          error,
          'Could not install update.',
          'No se pudo instalar la actualizacion.',
        ),
      )
    } finally {
      setIsInstallingUpdate(false)
    }
  }, [getErrorMessage, openAppUpdateUrl, resolvedUpdateUrl, t])

  const handleConfirmDisableBiometric = useCallback(async () => {
    setIsBiometricEnabled(false)
    unlockBiometricSession()
    setIsDisableBiometricConfirmOpen(false)
    await AsyncStorage.setItem(MOBILE_BIOMETRIC_ENABLED_KEY, 'false')
  }, [unlockBiometricSession])

  const handleSignOut = useCallback(async () => {
    if (registeredPushToken && firebaseUser) {
      try {
        await requestWithSession('/api/alerts/device-token', false, {
          method: 'DELETE',
          body: JSON.stringify({ token: registeredPushToken }),
        })
      } catch {
        // Best-effort cleanup only.
      }
    }

    await signOut(mobileAuth)
    setAuthProfile(null)
    closeSettingsMenu()
    setDetailSelection(null)
    closePicturesModal()
    setIsAccountMenuOpen(false)
    lockBiometricSession()
    setIsDisableBiometricConfirmOpen(false)
    setLastAutoBiometricAttemptAt(0)
    setTimesheetMessage(null)
    setIsManagerDatePickerOpen(false)
    setManagerWorkers([])
    setManagerEntries([])
    setManagerOrderProgress([])
    setManagerProgressByJob({})
    setManagerMessage(null)
    setManagerDate(formatDateInput(new Date()))
    setAlerts([])
    setAlertsUnreadCount(0)
    setAlertsMessage(null)
    setRegisteredPushToken(null)
    setAuthMessage(null)
  }, [closePicturesModal, closeSettingsMenu, firebaseUser, lockBiometricSession, registeredPushToken, requestWithSession])

  const handleStartGoogleLogin = useCallback(async () => {
    if (isExpoGo) {
      setAuthMessage(
        t(
          'Google sign-in requires a development or production build. It is not available in Expo Go.',
          'El inicio de sesion con Google requiere un build de desarrollo o produccion. No esta disponible en Expo Go.',
        ),
      )
      return
    }

    if (!GOOGLE_WEB_CLIENT_ID) {
      setAuthMessage(t('Google sign-in is not configured yet for mobile.', 'El inicio de sesion con Google aun no esta configurado para movil.'))
      return
    }

    setAuthMessage(null)
    setIsSigningIn(true)

    try {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      })

      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        })
      }

      const response = await GoogleSignin.signIn()

      if (!isSuccessResponse(response)) {
        return
      }

      const idToken = String(response.data.idToken ?? '').trim()

      if (!idToken) {
        setAuthMessage(t('Google sign-in did not return an ID token.', 'Google no devolvio un ID token al iniciar sesion.'))
        return
      }

      const credential = GoogleAuthProvider.credential(idToken)
      await signInWithCredential(mobileAuth, credential)
      setAuthMessage(null)
    } catch (error) {
      if (isErrorWithCode(error)) {
        if (error.code === statusCodes.SIGN_IN_CANCELLED) {
          setAuthMessage(null)
          return
        }

        if (error.code === statusCodes.IN_PROGRESS) {
          setAuthMessage(
            t(
              'Google sign-in is already in progress.',
              'El inicio de sesion con Google ya esta en progreso.',
            ),
          )
          return
        }

        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setAuthMessage(
            t(
              'Google Play Services are not available on this device.',
              'Google Play Services no esta disponible en este dispositivo.',
            ),
          )
          return
        }
      }

      setAuthMessage(getErrorMessage(error, 'Google sign-in failed.', 'Fallo el inicio de sesion con Google.'))
    } finally {
      setIsSigningIn(false)
    }
  }, [getErrorMessage, isExpoGo, t])

  const handleStartAppleLogin = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      setAuthMessage(
        t(
          'Apple sign-in is available on iPhone and iPad only.',
          'El inicio de sesion con Apple solo esta disponible en iPhone y iPad.',
        ),
      )
      return
    }

    if (!isAppleSignInAvailable) {
      setAuthMessage(
        t(
          'Apple sign-in is not available on this device yet.',
          'El inicio de sesion con Apple no esta disponible en este dispositivo.',
        ),
      )
      return
    }

    setAuthMessage(null)
    setIsSigningIn(true)

    try {
      const rawNonce = buildAppleRawNonce()
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      )

      const appleAuthCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      })
      const idToken = String(appleAuthCredential.identityToken ?? '').trim()

      if (!idToken) {
        setAuthMessage(
          t(
            'Apple sign-in did not return an identity token.',
            'Apple no devolvio un token de identidad al iniciar sesion.',
          ),
        )
        return
      }

      const provider = new OAuthProvider('apple.com')
      const credential = provider.credential({
        idToken,
        rawNonce,
      })

      await signInWithCredential(mobileAuth, credential)
      setAuthMessage(null)
    } catch (error) {
      const errorCode = String((error as { code?: string })?.code ?? '').trim()

      if (errorCode === 'ERR_REQUEST_CANCELED') {
        setAuthMessage(null)
        return
      }

      setAuthMessage(
        getErrorMessage(
          error,
          'Apple sign-in failed.',
          'Fallo el inicio de sesion con Apple.',
        ),
      )
    } finally {
      setIsSigningIn(false)
    }
  }, [getErrorMessage, isAppleSignInAvailable, t])

  const handleStartEmailPasswordLogin = useCallback(async () => {
    const normalizedEmail = emailSignInValue.trim().toLowerCase()
    const normalizedPassword = passwordSignInValue

    if (!normalizedEmail || !normalizedPassword) {
      setAuthMessage(
        t(
          'Enter email and password to continue.',
          'Escribe correo y contrasena para continuar.',
        ),
      )
      return
    }

    setAuthMessage(null)
    setIsEmailSigningIn(true)

    try {
      await signInWithEmailAndPassword(mobileAuth, normalizedEmail, normalizedPassword)
      setAuthMessage(null)
    } catch (error) {
      const normalizedCode = String((error as { code?: string })?.code ?? '').trim().toLowerCase()

      if (
        normalizedCode.includes('auth/invalid-credential')
        || normalizedCode.includes('auth/wrong-password')
        || normalizedCode.includes('auth/user-not-found')
        || normalizedCode.includes('auth/invalid-email')
      ) {
        setAuthMessage(t('Incorrect email or password.', 'Correo o contrasena incorrectos.'))
        return
      }

      setAuthMessage(
        getErrorMessage(
          error,
          'Email sign-in failed.',
          'Fallo el inicio de sesion con correo.',
        ),
      )
    } finally {
      setIsEmailSigningIn(false)
    }
  }, [emailSignInValue, getErrorMessage, passwordSignInValue, t])

  useEffect(() => {
    let isMounted = true
    const resolveTimeoutId = setTimeout(() => {
      if (!isMounted) {
        return
      }

      setIsAuthResolved(true)
    }, 2500)

    let subscription = () => {
      // No-op default unsubscribe.
    }

    try {
      subscription = onAuthStateChanged(mobileAuth, (nextUser) => {
        if (!isMounted) {
          return
        }

        setFirebaseUser(nextUser)
        setIsAuthResolved(true)
        clearTimeout(resolveTimeoutId)
      })
    } catch (error) {
      if (isMounted) {
        setAuthMessage(
          getErrorMessage(
            error,
            'Mobile auth failed to initialize.',
            'La autenticacion movil no pudo iniciarse.',
          ),
        )
        setIsAuthResolved(true)
      }

      clearTimeout(resolveTimeoutId)
    }

    return () => {
      isMounted = false
      clearTimeout(resolveTimeoutId)
      subscription()
    }
  }, [getErrorMessage, t])

  useEffect(() => {
    let isMounted = true

    Promise.all([
      AsyncStorage.getItem(MOBILE_BIOMETRIC_ENABLED_KEY),
      AsyncStorage.getItem(MOBILE_LANGUAGE_KEY),
      AsyncStorage.getItem(MOBILE_NOTIFICATIONS_ENABLED_KEY),
    ])
      .then(([storedBiometricValue, storedLanguageValue, storedNotificationsValue]) => {
        if (!isMounted) {
          return
        }

        if (storedBiometricValue === 'false') {
          setIsBiometricEnabled(false)
        }

        if (storedLanguageValue === 'es' || storedLanguageValue === 'en' || storedLanguageValue === 'he') {
          setLanguage(storedLanguageValue)
        }

        if (storedNotificationsValue === 'false') {
          setIsNotificationsEnabled(false)
        }
      })
      .catch(() => {
        // Keep default when storage read fails.
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    if (Platform.OS !== 'ios') {
      setIsAppleSignInAvailable(false)
      return () => {
        isMounted = false
      }
    }

    AppleAuthentication.isAvailableAsync()
      .then((isAvailable) => {
        if (!isMounted) {
          return
        }

        setIsAppleSignInAvailable(isAvailable)
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        setIsAppleSignInAvailable(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!firebaseUser) {
      setAuthProfile(null)
      closeSettingsMenu()
      setIsCheckingApproval(false)
      setRegisteredPushToken(null)
      setIsManagerDatePickerOpen(false)
      setManagerWorkers([])
      setManagerEntries([])
      setManagerOrderProgress([])
      setManagerProgressByJob({})
      setManagerMessage(null)
      setAlerts([])
      setAlertsUnreadCount(0)
      setShowReadAlerts(false)
      setAlertsMessage(null)
      setOrderJobDetailsByOrderId({})
      setSelectedOrderDetailsView('overview')
      setIsOrderDetailsLoading(false)
      lockBiometricSession()
      setLastAutoBiometricAttemptAt(0)
      return
    }

    setPasswordSignInValue('')
    lockBiometricSession()
    void syncAuthProfile()
  }, [closeSettingsMenu, firebaseUser, lockBiometricSession, syncAuthProfile])

  useEffect(() => {
    if (activeScreen === 'timesheet' && hasManagerSheetAccess) {
      setActiveScreen('manager')
      return
    }

    if (activeScreen === 'manager' && !hasManagerSheetAccess) {
      setActiveScreen('dashboard')
    }
  }, [activeScreen, hasManagerSheetAccess])

  useEffect(() => {
    if (activeScreen === 'admin' && !isAdminUser) {
      setActiveScreen('dashboard')
    }
  }, [activeScreen, isAdminUser])

  useEffect(() => {
    const frameHandle = requestAnimationFrame(() => {
      screenScrollRef.current?.scrollTo({ y: 0, animated: false })
    })

    return () => {
      cancelAnimationFrame(frameHandle)
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeScreen !== 'admin' || !isAdminUser) {
      return
    }

    const hasSelectedAdminPage = Boolean(adminPortalRoutePath)

    if (!hasSelectedAdminPage || !ADMIN_PORTAL_PAGES.some((page) => page.path === adminPortalRoutePath)) {
      setAdminPortalRoutePath(ADMIN_PORTAL_PAGES[0].path)
    }
  }, [activeScreen, adminPortalRoutePath, isAdminUser])

  useEffect(() => {
    if (activeScreen !== 'admin' || !isAdminUser || !adminPortalRoutePath) {
      return
    }

    void loadAdminWorkspacePage(adminPortalRoutePath)
  }, [activeScreen, adminPortalRoutePath, isAdminUser, loadAdminWorkspacePage])

  useEffect(() => {
    if (activeScreen !== 'manager') {
      setIsManagerDatePickerOpen(false)
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeScreen !== 'admin') {
      setAdminDatePickerTarget(null)
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeSettingsMenuId !== 'admin') {
      setAdminPortalMessage(null)
    }
  }, [activeSettingsMenuId])

  useEffect(() => {
    setAdminExpandedWorkspaceRowId(null)
    setAdminAccessMenuUserUid(null)
    setAdminReportsView('menu')
    setAdminReportWorkerSearch('')
    setAdminSelectedWorkerReportRowId(null)
    setAdminReportMonthStatId('summary')
    setAdminSelectedMonthProjectRowId(null)
    setAdminReportJobSearch('')
    setAdminReportDateRangeStart('')
    setAdminReportDateRangeEnd('')
    setAdminDatePickerTarget(null)
    setAdminReportMonthListModalState(null)
    setAdminReportDetailsModalState(null)
    setAdminReportWorkerDrilldownModalState(null)
  }, [adminPortalRoutePath])

  useEffect(() => {
    maybeAutoPromptBiometric()
  }, [maybeAutoPromptBiometric])

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        maybeAutoPromptBiometric()
      }
    })

    return () => {
      appStateSubscription.remove()
    }
  }, [maybeAutoPromptBiometric])

  useEffect(() => {
    if (!firebaseUser || !authProfile?.isApproved) {
      setIsBiometricPromptOpen(false)
      return
    }

    if (!isBiometricEnabled) {
      unlockBiometricSession()
      return
    }

    if (hasSkippedBiometricPrompt) {
      setIsBiometricPromptOpen(false)
      return
    }

    if (!hasBiometricSessionAuth) {
      setIsBiometricPromptOpen(true)
    }
  }, [
    authProfile?.isApproved,
    firebaseUser,
    hasBiometricSessionAuth,
    hasSkippedBiometricPrompt,
    isBiometricEnabled,
    unlockBiometricSession,
  ])

  const orderBuckets = useMemo(() => {
    return buildOrderBuckets(mondaySnapshot?.orders ?? [])
  }, [mondaySnapshot])

  useEffect(() => {
    if (!firebaseUser || !authProfile?.isApproved) {
      return
    }

    const intervalId = setInterval(() => {
      void syncAuthProfile()
    }, 60_000)

    return () => {
      clearInterval(intervalId)
    }
  }, [authProfile?.isApproved, firebaseUser, syncAuthProfile])

  const loadDashboard = useCallback(async (refreshRequested: boolean) => {
    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    setErrorMessage(null)

    try {
      const [mondayResult, zendeskResult, supportTicketsResult] = await Promise.allSettled([
        requestWithSession<MondayDashboardSnapshot>('/api/dashboard/monday', refreshRequested),
        requestWithSession<ZendeskTicketSummarySnapshot>('/api/dashboard/zendesk', refreshRequested),
        requestWithSession<SupportTicketsSnapshot>('/api/support/tickets?limit=500', refreshRequested),
      ])

      const failedSlices: string[] = []

      if (mondayResult.status === 'fulfilled') {
        setMondaySnapshot(mondayResult.value)
      } else {
        failedSlices.push(t('orders', 'ordenes'))
      }

      if (zendeskResult.status === 'fulfilled') {
        setZendeskSnapshot(zendeskResult.value)
      } else {
        failedSlices.push(t('ticket summary', 'resumen de tickets'))
      }

      if (supportTicketsResult.status === 'fulfilled') {
        setSupportTicketsSnapshot(supportTicketsResult.value)
      } else {
        failedSlices.push(t('ticket list', 'lista de tickets'))
      }

      if (failedSlices.length > 0) {
        setErrorMessage(
          t(
            `Could not refresh ${failedSlices.join(', ')}.`,
            `No se pudo actualizar ${failedSlices.join(', ')}.`,
          ),
        )
      }
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, 'Failed to load data.', 'No se pudieron cargar los datos.'),
      )
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [getErrorMessage, requestWithSession, t])

  useEffect(() => {
    if (!hasApprovedSessionAccess) {
      return
    }

    void loadDashboard(false)
  }, [hasApprovedSessionAccess, loadDashboard])

  const loadTimesheet = useCallback(async () => {
    setIsTimesheetLoading(true)
    setTimesheetMessage(null)

    try {
      const payload = await requestWithSession<{
        worker: MobileTimesheetWorker
        entries: MobileTimesheetEntry[]
        stages: MobileTimesheetStage[]
      }>('/api/timesheet/my-state')
      let nextStages = Array.isArray(payload.stages) ? payload.stages : []

      if (nextStages.length === 0) {
        try {
          const todayIsoDate = formatDateInput(new Date())
          const fallbackPayload = await requestWithSession<{ stages?: MobileTimesheetStage[] }>(
            `/api/timesheet/state?from=${todayIsoDate}&to=${todayIsoDate}`,
          )
          const fallbackStages = Array.isArray(fallbackPayload.stages)
            ? fallbackPayload.stages
            : []

          if (fallbackStages.length > 0) {
            nextStages = fallbackStages
          }
        } catch {
          // Keep default empty stage state if fallback fails.
        }
      }

      setTimesheetWorker(payload.worker ?? null)
      setTimesheetEntries(Array.isArray(payload.entries) ? payload.entries : [])
      setTimesheetStages(nextStages)
      setTimesheetStageId((previous) =>
        previous && nextStages.some((stage) => stage.id === previous) ? previous : '',
      )
    } catch (error) {
      setTimesheetWorker(null)
      setTimesheetEntries([])
      setTimesheetStages([])
      setTimesheetStageId('')
      setTimesheetMessage(
        getErrorMessage(
          error,
          'Could not load your timesheet.',
          'No se pudo cargar tu hoja de horas.',
        ),
      )
    } finally {
      setIsTimesheetLoading(false)
    }
  }, [getErrorMessage, requestWithSession])

  useEffect(() => {
    if (activeScreen !== 'timesheet') {
      return
    }

    if (!hasApprovedSessionAccess) {
      return
    }

    void loadTimesheet()
  }, [activeScreen, hasApprovedSessionAccess, loadTimesheet])

  const loadManagerSheet = useCallback(async () => {
    if (!hasManagerSheetAccess) {
      setManagerWorkers([])
      setManagerEntries([])
      setManagerOrderProgress([])
      setManagerProgressByJob({})
      return
    }

    setIsManagerLoading(true)
    setManagerMessage(null)

    try {
      const payload = await requestWithSession<{
        workers?: MobileTimesheetWorker[]
        entries?: MobileTimesheetEntry[]
        orderProgress?: MobileManagerOrderProgress[]
      }>('/api/timesheet/state?from=2020-01-01')

      setManagerWorkers(Array.isArray(payload.workers) ? payload.workers : [])
      setManagerEntries(Array.isArray(payload.entries) ? payload.entries : [])
      setManagerOrderProgress(Array.isArray(payload.orderProgress) ? payload.orderProgress : [])
    } catch (error) {
      setManagerWorkers([])
      setManagerEntries([])
      setManagerOrderProgress([])
      setManagerProgressByJob({})
      setManagerMessage(
        getErrorMessage(
          error,
          'Could not load manager sheet data.',
          'No se pudo cargar los datos de la hoja de gerente.',
        ),
      )
    } finally {
      setIsManagerLoading(false)
    }
  }, [getErrorMessage, hasManagerSheetAccess, requestWithSession])

  useEffect(() => {
    if (activeScreen !== 'manager') {
      return
    }

    if (!hasApprovedSessionAccess || !hasManagerSheetAccess) {
      return
    }

    void loadManagerSheet()
  }, [activeScreen, hasApprovedSessionAccess, hasManagerSheetAccess, loadManagerSheet])

  useEffect(() => {
    if (activeScreen !== 'orders') {
      return
    }

    if (!hasApprovedSessionAccess || !hasManagerSheetAccess) {
      return
    }

    void loadManagerSheet()
  }, [activeScreen, hasApprovedSessionAccess, hasManagerSheetAccess, loadManagerSheet])

  const loadAlerts = useCallback(async (refreshRequested = false) => {
    setIsAlertsLoading(true)

    if (refreshRequested) {
      setIsRefreshing(true)
    }

    try {
      const payload = await requestWithSession<{ alerts: MobileAlert[]; unreadCount?: number }>(
        '/api/alerts/my?limit=80',
        refreshRequested,
      )

      const nextAlerts = Array.isArray(payload.alerts)
        ? payload.alerts.map((alertItem) => ({
            ...alertItem,
            isRead: Boolean(alertItem.isRead),
            readAt: String(alertItem.readAt ?? '').trim() || null,
          }))
        : []
      const unreadCountFromPayload = Number(payload.unreadCount)
      const unreadCount = Number.isFinite(unreadCountFromPayload)
        ? Math.max(0, Math.floor(unreadCountFromPayload))
        : nextAlerts.reduce((total, alertItem) => total + (alertItem.isRead ? 0 : 1), 0)

      setAlerts(nextAlerts)
      setAlertsUnreadCount(unreadCount)
      setAlertsMessage(null)
    } catch (error) {
      setAlerts([])
      setAlertsUnreadCount(0)
      setAlertsMessage(
        getErrorMessage(
          error,
          'Could not load notifications.',
          'No se pudieron cargar las notificaciones.',
        ),
      )
    } finally {
      setIsAlertsLoading(false)
      setIsRefreshing(false)
    }
  }, [getErrorMessage, requestWithSession])

  const markAlertAsRead = useCallback(async (alertItem: MobileAlert) => {
    const alertId = String(alertItem?.id ?? '').trim()

    if (!alertId || alertItem.isRead) {
      return
    }

    try {
      const payload = await requestWithSession<{ readAt?: string }>(
        `/api/alerts/${encodeURIComponent(alertId)}/read`,
        false,
        {
          method: 'POST',
        },
      )
      const nextReadAt = String(payload.readAt ?? '').trim() || new Date().toISOString()

      setAlerts((previous) =>
        previous.map((entry) =>
          entry.id === alertId
            ? {
                ...entry,
                isRead: true,
                readAt: nextReadAt,
              }
            : entry,
        ),
      )
      setAlertsUnreadCount((current) => Math.max(0, current - 1))
    } catch (error) {
      setAlertsMessage(
        getErrorMessage(
          error,
          'Could not mark this notification as read.',
          'No se pudo marcar esta notificacion como leida.',
        ),
      )
    }
  }, [getErrorMessage, requestWithSession])

  const markAlertAsUnread = useCallback(async (alertItem: MobileAlert) => {
    const alertId = String(alertItem?.id ?? '').trim()

    if (!alertId || !alertItem.isRead) {
      return
    }

    try {
      await requestWithSession(
        `/api/alerts/${encodeURIComponent(alertId)}/unread`,
        false,
        {
          method: 'POST',
        },
      )

      setAlerts((previous) =>
        previous.map((entry) =>
          entry.id === alertId
            ? {
                ...entry,
                isRead: false,
                readAt: null,
              }
            : entry,
        ),
      )
      setAlertsUnreadCount((current) => Math.max(0, current + 1))
    } catch (error) {
      setAlertsMessage(
        getErrorMessage(
          error,
          'Could not mark this notification as unread.',
          'No se pudo marcar esta notificacion como no leida.',
        ),
      )
    }
  }, [getErrorMessage, requestWithSession])

  const unloadActiveVoiceSound = useCallback(async () => {
    const activeSound = activeVoiceSoundRef.current

    if (!activeSound) {
      return
    }

    activeVoiceSoundRef.current = null

    try {
      await activeSound.stopAsync()
    } catch {
      // Ignore stop failures during cleanup.
    }

    try {
      await activeSound.unloadAsync()
    } catch {
      // Ignore unload failures during cleanup.
    }

    setChatPlayingMessageId(null)
  }, [])

  const loadChatState = useCallback(async (refreshRequested = false) => {
    if (refreshRequested) {
      setIsRefreshing(true)
    }

    setIsChatLoading(true)

    try {
      const [usersPayload, threadsPayload] = await Promise.all([
        requestWithSession<{ users?: MobileChatUser[] }>(
          '/api/chat/users',
          refreshRequested,
        ),
        requestWithSession<{ threads?: MobileChatThread[] }>(
          '/api/chat/threads',
          refreshRequested,
        ),
      ])

      const nextUsers = Array.isArray(usersPayload.users) ? usersPayload.users : []
      const nextThreads = Array.isArray(threadsPayload.threads) ? threadsPayload.threads : []
      setChatUsers(nextUsers)
      setChatThreads(nextThreads)
      setChatMessage(null)
      setChatSelectedThreadId((current) => {
        if (current && nextThreads.some((thread) => thread.id === current)) {
          return current
        }
        return nextThreads[0]?.id ?? null
      })
    } catch (error) {
      setChatUsers([])
      setChatThreads([])
      setChatSelectedThreadId(null)
      setChatMessage(
        getErrorMessage(
          error,
          'Could not load chat threads.',
          'No se pudieron cargar los chats.',
        ),
      )
    } finally {
      setIsChatLoading(false)
      setIsRefreshing(false)
    }
  }, [getErrorMessage, requestWithSession])

  const handleStartDirectChat = useCallback(async (targetUid: string) => {
    const normalizedTargetUid = String(targetUid ?? '').trim()
    if (!canStartDirectChat || !normalizedTargetUid) return

    setIsChatLoading(true)
    setChatMessage(null)

    try {
      const payload = await requestWithSession<{ thread?: MobileChatThread }>(
        '/api/chat/threads/direct',
        false,
        {
          method: 'POST',
          body: JSON.stringify({ targetUid: normalizedTargetUid }),
        },
      )
      await loadChatState(false)
      if (payload.thread?.id) {
        setChatSelectedThreadId(payload.thread.id)
        setChatViewMode('thread')
      }
    } catch (error) {
      setChatMessage(
        getErrorMessage(error, 'Could not start this chat.', 'No se pudo iniciar este chat.'),
      )
    } finally {
      setIsChatLoading(false)
    }
  }, [canStartDirectChat, getErrorMessage, loadChatState, requestWithSession])

  const handleCreateGroupChat = useCallback(async (name: string, memberUids: string[]) => {
    const normalizedName = String(name ?? '').trim()
    const normalizedMembers = Array.from(
      new Set(memberUids.map((uid) => String(uid ?? '').trim()).filter(Boolean)),
    )

    if (!isAdminUser || !normalizedName || normalizedMembers.length === 0) {
      return
    }

    setIsChatLoading(true)
    setChatMessage(null)

    try {
      const payload = await requestWithSession<{ thread?: MobileChatThread }>(
        '/api/chat/groups',
        false,
        {
          method: 'POST',
          body: JSON.stringify({
            name: normalizedName,
            memberUids: normalizedMembers,
          }),
        },
      )
      await loadChatState(false)
      if (payload.thread?.id) {
        setChatSelectedThreadId(payload.thread.id)
        setChatViewMode('thread')
      }
    } catch (error) {
      setChatMessage(
        getErrorMessage(error, 'Could not create this group.', 'No se pudo crear este grupo.'),
      )
    } finally {
      setIsChatLoading(false)
    }
  }, [getErrorMessage, isAdminUser, loadChatState, requestWithSession])

  const handleSetChatPinned = useCallback(async (threadId: string, pinned: boolean) => {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return

    try {
      await requestWithSession(
        `/api/chat/threads/${encodeURIComponent(normalizedThreadId)}/preferences`,
        false,
        {
          method: 'PATCH',
          body: JSON.stringify({ pinned }),
        },
      )
      await loadChatState(false)
    } catch (error) {
      setChatMessage(
        getErrorMessage(error, 'Could not update this chat.', 'No se pudo actualizar este chat.'),
      )
    }
  }, [getErrorMessage, loadChatState, requestWithSession])

  const handleDeleteChatThread = useCallback(async (threadId: string) => {
    const normalizedThreadId = String(threadId ?? '').trim()
    if (!normalizedThreadId) return

    try {
      await requestWithSession(
        `/api/chat/threads/${encodeURIComponent(normalizedThreadId)}`,
        false,
        {
          method: 'DELETE',
        },
      )
      setChatSelectedThreadId((current) => current === normalizedThreadId ? null : current)
      setChatViewMode('list')
      await loadChatState(false)
    } catch (error) {
      setChatMessage(
        getErrorMessage(error, 'Could not delete this chat.', 'No se pudo borrar este chat.'),
      )
    }
  }, [getErrorMessage, loadChatState, requestWithSession])

  const loadChatMessages = useCallback(async (threadId: string, refreshRequested = false) => {
    const normalizedThreadId = String(threadId ?? '').trim()

    if (!normalizedThreadId) {
      return
    }

    if (refreshRequested) {
      setIsRefreshing(true)
    }

    setIsChatMessagesLoading(true)

    try {
      const payload = await requestWithSession<{
        messages?: MobileChatMessage[]
      }>(
        `/api/chat/threads/${encodeURIComponent(normalizedThreadId)}/messages?limit=160&offset=0`,
        refreshRequested,
      )
      const nextMessages = Array.isArray(payload.messages) ? payload.messages : []

      setChatMessagesByThreadId((previous) => ({
        ...previous,
        [normalizedThreadId]: nextMessages,
      }))
      setChatMessage(null)
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not load chat messages.',
          'No se pudieron cargar los mensajes de chat.',
        ),
      )
    } finally {
      setIsChatMessagesLoading(false)
      setIsRefreshing(false)
    }
  }, [getErrorMessage, requestWithSession])

  const submitChatMessage = useCallback(async (
    thread: MobileChatThread,
    input: {
      text?: string
      attachment?: ChatAttachmentDraft | null
    },
  ) => {
    const normalizedText = String(input.text ?? '').trim()
    const attachmentDraft = input.attachment ?? null

    if (!normalizedText && !attachmentDraft) {
      return
    }

    await requestWithSession(
      `/api/chat/threads/${encodeURIComponent(thread.id)}/messages`,
      false,
      {
        method: 'POST',
        body: JSON.stringify({
          ...(normalizedText
            ? {
                text: normalizedText,
              }
            : {}),
          ...(attachmentDraft
            ? {
                attachment: {
                  kind: attachmentDraft.kind,
                  dataUrl: attachmentDraft.dataUrl,
                  mimeType: attachmentDraft.mimeType,
                  fileName: attachmentDraft.fileName,
                },
              }
            : {}),
        }),
      },
    )
  }, [requestWithSession])

  const handleSendChatMessage = useCallback(async (overrideText?: string) => {
    if (!selectedChatThread || isChatSendingMessage) {
      return
    }

    const normalizedText = String(overrideText ?? chatComposerText ?? '').trim()

    if (!normalizedText && !chatAttachmentDraft) {
      return
    }

    setIsChatSendingMessage(true)
    setChatMessage(null)

    try {
      await submitChatMessage(selectedChatThread, {
        text: normalizedText,
        attachment: chatAttachmentDraft,
      })

      setChatComposerText('')
      setChatAttachmentDraft(null)
      await Promise.all([
        loadChatMessages(selectedChatThread.id, false),
        loadChatState(false),
      ])
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not send your chat message.',
          'No se pudo enviar tu mensaje de chat.',
        ),
      )
    } finally {
      setIsChatSendingMessage(false)
    }
  }, [
    chatAttachmentDraft,
    chatComposerText,
    getErrorMessage,
    isChatSendingMessage,
    loadChatMessages,
    loadChatState,
    selectedChatThread,
    submitChatMessage,
  ])

  const handleDeleteChatMessage = useCallback(async (messageId: string) => {
    const normalizedMessageId = String(messageId ?? '').trim()

    if (!selectedChatThread || !normalizedMessageId) {
      return
    }

    try {
      await requestWithSession(
        `/api/chat/messages/${encodeURIComponent(normalizedMessageId)}`,
        false,
        {
          method: 'DELETE',
        },
      )

      await Promise.all([
        loadChatMessages(selectedChatThread.id, false),
        loadChatState(false),
      ])
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not delete this message.',
          'No se pudo borrar este mensaje.',
        ),
      )
    }
  }, [getErrorMessage, loadChatMessages, loadChatState, requestWithSession, selectedChatThread])

  const handleAttachChatImage = useCallback(async (source: 'library' | 'camera' = 'library') => {
    try {
      const permissionResult = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()

      if (permissionResult.status !== 'granted') {
        setChatMessage(
          source === 'camera'
            ? t(
              'Camera permission is required to take photos.',
              'Se requiere permiso de camara para tomar fotos.',
            )
            : t(
              'Media permission is required to attach photos.',
              'Se requiere permiso multimedia para adjuntar fotos.',
            ),
        )
        return
      }

      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: true,
        })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: true,
        })

      if (result.canceled || result.assets.length === 0) {
        return
      }

      const selectedAsset = result.assets[0]

      if (!selectedAsset.base64) {
        setChatMessage(
          t(
            'Could not prepare selected image.',
            'No se pudo preparar la imagen seleccionada.',
          ),
        )
        return
      }

      const mimeType = String(selectedAsset.mimeType ?? 'image/jpeg').trim() || 'image/jpeg'
      const estimatedBytes = Math.floor((selectedAsset.base64.length * 3) / 4)

      if (estimatedBytes > CHAT_MAX_ATTACHMENT_BYTES) {
        setChatMessage(
          t(
            'Image is too large. Maximum size is 6 MB.',
            'La imagen es demasiado grande. El maximo es 6 MB.',
          ),
        )
        return
      }

      setChatAttachmentDraft({
        kind: 'image',
        dataUrl: `data:${mimeType};base64,${selectedAsset.base64}`,
        mimeType,
        fileName: String(
          selectedAsset.fileName
          ?? (source === 'camera' ? `chat-camera-${Date.now()}.jpg` : 'chat-image.jpg'),
        ).trim() || 'chat-image.jpg',
        sizeBytes: estimatedBytes,
      })
      setChatMessage(null)
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not attach image.',
          'No se pudo adjuntar la imagen.',
        ),
      )
    }
  }, [getErrorMessage, t])

  const handleStartVoiceNoteRecording = useCallback(async () => {
    if (!selectedChatThread || isChatSendingMessage || isChatRecordingVoice || isChatProcessingVoice) {
      return
    }

    setChatMessage(null)

    try {
      const permissionResult = await Audio.requestPermissionsAsync()

      if (permissionResult.status !== 'granted') {
        setChatMessage(
          t(
            'Microphone permission is required for voice notes.',
            'Se requiere permiso de microfono para notas de voz.',
          ),
        )
        return
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      })

      const recording = new Audio.Recording()

      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      await recording.startAsync()

      activeVoiceRecordingRef.current = recording
      setIsChatRecordingVoice(true)
    } catch (error) {
      activeVoiceRecordingRef.current = null
      setIsChatRecordingVoice(false)
      setChatMessage(
        getErrorMessage(
          error,
          'Could not start voice recording.',
          'No se pudo iniciar la grabacion de voz.',
        ),
      )
    }
  }, [getErrorMessage, isChatProcessingVoice, isChatRecordingVoice, isChatSendingMessage, selectedChatThread, t])

  const handleStopVoiceNoteRecording = useCallback(async (sendImmediately = false) => {
    const activeRecording = activeVoiceRecordingRef.current

    if (!activeRecording || isChatProcessingVoice) {
      return
    }

    setIsChatProcessingVoice(true)
    let sentImmediately = false

    try {
      await activeRecording.stopAndUnloadAsync()
      const audioUri = activeRecording.getURI()

      if (!audioUri) {
        throw new Error('Recorded file is unavailable.')
      }

      const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
        encoding: 'base64',
      })

      const estimatedBytes = Math.floor((String(base64Audio).length * 3) / 4)

      if (!base64Audio || estimatedBytes <= 0) {
        throw new Error('Voice note is empty.')
      }

      if (estimatedBytes > CHAT_MAX_ATTACHMENT_BYTES) {
        setChatMessage(
          t(
            'Voice note is too large. Maximum size is 6 MB.',
            'La nota de voz es demasiado grande. El maximo es 6 MB.',
          ),
        )
        return
      }

      const mimeType = Platform.OS === 'ios' ? 'audio/x-m4a' : 'audio/mp4'

      const voiceAttachmentDraft: ChatAttachmentDraft = {
        kind: 'voice',
        dataUrl: `data:${mimeType};base64,${base64Audio}`,
        mimeType,
        fileName: `voice-note-${Date.now()}.m4a`,
        sizeBytes: estimatedBytes,
      }

      if (sendImmediately && selectedChatThread && !isChatSendingMessage) {
        sentImmediately = true
        setIsChatSendingMessage(true)
        await submitChatMessage(selectedChatThread, {
          attachment: voiceAttachmentDraft,
        })
        setChatComposerText('')
        setChatAttachmentDraft(null)
        await Promise.all([
          loadChatMessages(selectedChatThread.id, false),
          loadChatState(false),
        ])
      } else {
        setChatAttachmentDraft(voiceAttachmentDraft)
      }

      setChatMessage(null)
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not prepare voice note.',
          'No se pudo preparar la nota de voz.',
        ),
      )
    } finally {
      activeVoiceRecordingRef.current = null
      setIsChatRecordingVoice(false)
      setIsChatProcessingVoice(false)

      if (sentImmediately) {
        setIsChatSendingMessage(false)
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        })
      } catch {
        // Ignore audio mode reset failures.
      }
    }
  }, [
    getErrorMessage,
    isChatProcessingVoice,
    isChatSendingMessage,
    loadChatMessages,
    loadChatState,
    selectedChatThread,
    submitChatMessage,
    t,
  ])

  const handleToggleVoicePlayback = useCallback(async (messageId: string, dataUrl: string) => {
    const normalizedMessageId = String(messageId ?? '').trim()
    const normalizedDataUrl = String(dataUrl ?? '').trim()

    if (!normalizedMessageId || !normalizedDataUrl) {
      return
    }

    if (chatPlayingMessageId === normalizedMessageId) {
      await unloadActiveVoiceSound()
      return
    }

    try {
      await unloadActiveVoiceSound()
      const createdSound = await Audio.Sound.createAsync(
        { uri: normalizedDataUrl },
        { shouldPlay: true },
      )
      const sound = createdSound.sound

      activeVoiceSoundRef.current = sound
      setChatPlayingMessageId(normalizedMessageId)
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          return
        }

        if (status.didJustFinish) {
          void unloadActiveVoiceSound()
        }
      })
    } catch (error) {
      setChatMessage(
        getErrorMessage(
          error,
          'Could not play voice note.',
          'No se pudo reproducir la nota de voz.',
        ),
      )
    }
  }, [chatPlayingMessageId, getErrorMessage, unloadActiveVoiceSound])

  const resolveNotificationTargetScreen = useCallback((rawData: unknown): AppScreen => {
    if (!rawData || typeof rawData !== 'object') {
      return 'alerts'
    }

    const notificationData = rawData as Record<string, unknown>
    const route = String(
      notificationData.route
      ?? notificationData.screen
      ?? notificationData.targetScreen
      ?? '',
    ).trim().toLowerCase()
    const type = String(notificationData.type ?? '').trim().toLowerCase()

    if (route === 'updates' || route === 'update' || type === 'app_update') {
      return 'settings'
    }

    if (route === 'chat' || type === 'chat_message') {
      return 'chat'
    }

    return 'alerts'
  }, [])

  useEffect(() => {
    if (!firebaseUser || !hasApprovedSessionAccess) {
      return
    }

    void loadAlerts(false)
  }, [
    activeScreen,
    firebaseUser,
    hasApprovedSessionAccess,
    loadAlerts,
  ])

  useEffect(() => {
    if (activeScreen !== 'chat' || !hasApprovedSessionAccess) {
      return
    }

    void loadChatState(false)
  }, [activeScreen, hasApprovedSessionAccess, loadChatState])

  useEffect(() => {
    if (activeScreen !== 'chat' || !hasApprovedSessionAccess || !chatSelectedThreadId) {
      return
    }

    void loadChatMessages(chatSelectedThreadId, false)
  }, [activeScreen, chatSelectedThreadId, hasApprovedSessionAccess, loadChatMessages])

  useEffect(() => {
    if (activeScreen !== 'chat' || !hasApprovedSessionAccess) {
      return
    }

    const refreshInterval = setInterval(() => {
      void loadChatState(false)
    }, 12000)

    return () => {
      clearInterval(refreshInterval)
    }
  }, [activeScreen, hasApprovedSessionAccess, loadChatState])

  useEffect(() => {
    if (activeScreen !== 'chat' || !hasApprovedSessionAccess || !chatSelectedThreadId) {
      return
    }

    const refreshInterval = setInterval(() => {
      void loadChatMessages(chatSelectedThreadId, false)
    }, 5000)

    return () => {
      clearInterval(refreshInterval)
    }
  }, [activeScreen, chatSelectedThreadId, hasApprovedSessionAccess, loadChatMessages])

  useEffect(() => {
    if (activeScreen === 'chat') {
      return
    }

    void unloadActiveVoiceSound()
    setIsChatRecordingVoice(false)
  }, [activeScreen, unloadActiveVoiceSound])

  useEffect(() => {
    return () => {
      const activeRecording = activeVoiceRecordingRef.current

      if (activeRecording) {
        void activeRecording.stopAndUnloadAsync().catch(() => {
          // Ignore cleanup failures.
        })
      }

      void unloadActiveVoiceSound()
    }
  }, [unloadActiveVoiceSound])

  const registerPushTokenForAlerts = useCallback(async (forceEnable = false) => {
    if (!firebaseUser || !hasApprovedSessionAccess || (!forceEnable && !isNotificationsEnabled)) {
      return
    }

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('alerts', {
          name: 'Notifications',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 200, 160, 200],
          lightColor: '#3d65ef',
        })
      }

      const currentPermissions = await Notifications.getPermissionsAsync()
      let permissionStatus = currentPermissions.status

      if (permissionStatus !== 'granted') {
        const requestedPermissions = await Notifications.requestPermissionsAsync()
        permissionStatus = requestedPermissions.status
      }

      if (permissionStatus !== 'granted') {
        setAlertsMessage((current) =>
          current
          ?? t(
            'Notifications are disabled. Enable them in device settings to receive notifications.',
            'Las notificaciones estan desactivadas. Activalas en configuracion para recibir notificaciones.',
          ),
        )
        return
      }

      let token = ''
      let tokenProvider: 'expo' | 'fcm' = 'expo'

      if (Platform.OS === 'android') {
        const devicePushToken = await Notifications.getDevicePushTokenAsync()
        token = String(devicePushToken.data ?? '').trim()
        tokenProvider = 'fcm'
      } else {
        const tokenPayload = await Notifications.getExpoPushTokenAsync(
          easProjectId
            ? {
                projectId: easProjectId,
              }
            : undefined,
        )
        token = String(tokenPayload.data ?? '').trim()
        tokenProvider = 'expo'
      }

      if (!token || token === registeredPushToken) {
        return
      }

      await requestWithSession('/api/alerts/device-token', false, {
        method: 'POST',
        body: JSON.stringify({
          token,
          tokenProvider,
          platform: 'app',
          appVersion: installedNativeVersion,
          appBuild: installedNativeBuildLabel,
        }),
      })

      setRegisteredPushToken(token)
      setAlertsMessage(null)
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : ''
      const normalizedMessage = rawMessage.toLowerCase()

      if (
        Platform.OS === 'android'
        && (
          normalizedMessage.includes('firebase app is not initialized')
          || normalizedMessage.includes('fcm credentials')
        )
      ) {
        setAlertsMessage(
          t(
            'Notifications are not ready in this install yet. Reinstall the latest local APK and then enable notifications again.',
            'Las notificaciones aun no estan listas en esta instalacion. Reinstala el APK local mas reciente y luego activa notificaciones otra vez.',
          ),
        )
        return
      }

      setAlertsMessage(
        getErrorMessage(
          error,
          'Could not register this phone for notifications.',
          'No se pudo registrar este telefono para notificaciones.',
        ),
      )
    }
  }, [
    easProjectId,
    firebaseUser,
    getErrorMessage,
    hasApprovedSessionAccess,
    installedNativeBuildLabel,
    installedNativeVersion,
    isNotificationsEnabled,
    registeredPushToken,
    requestWithSession,
    t,
  ])

  const handleEnableNotifications = useCallback(async () => {
    setAlertsMessage(null)
    setIsNotificationsEnabled(true)

    try {
      await AsyncStorage.setItem(MOBILE_NOTIFICATIONS_ENABLED_KEY, 'true')
    } catch {
      // Keep in-memory state if persistence fails.
    }

    void registerPushTokenForAlerts(true)
  }, [registerPushTokenForAlerts])

  const handleOpenDeviceNotificationSettings = useCallback(async () => {
    try {
      await Linking.openSettings()
      setAlertsMessage(
        t(
          'Opened device settings. You can block notifications there.',
          'Se abrio configuracion del dispositivo. Puedes bloquear notificaciones alli.',
        ),
      )
    } catch (error) {
      setAlertsMessage(
        getErrorMessage(
          error,
          'Could not open device settings.',
          'No se pudo abrir la configuracion del dispositivo.',
        ),
      )
    }
  }, [getErrorMessage, t])

  const handleDisableNotifications = useCallback(async () => {
    setAlertsMessage(null)
    setIsNotificationsEnabled(false)

    try {
      await AsyncStorage.setItem(MOBILE_NOTIFICATIONS_ENABLED_KEY, 'false')
    } catch {
      // Keep in-memory state if persistence fails.
    }

    if (firebaseUser) {
      try {
        await requestWithSession('/api/alerts/device-token', false, {
          method: 'DELETE',
          body: registeredPushToken ? JSON.stringify({ token: registeredPushToken }) : undefined,
        })
      } catch {
        // Best-effort cleanup only.
      }
    }

    setRegisteredPushToken(null)
    await handleOpenDeviceNotificationSettings()
  }, [firebaseUser, handleOpenDeviceNotificationSettings, registeredPushToken, requestWithSession])

  useEffect(() => {
    if (!firebaseUser || !hasApprovedSessionAccess || !isNotificationsEnabled) {
      return
    }

    void registerPushTokenForAlerts()
  }, [
    firebaseUser,
    hasApprovedSessionAccess,
    isNotificationsEnabled,
    registerPushTokenForAlerts,
  ])

  useEffect(() => {
    const receiveSubscription = Notifications.addNotificationReceivedListener(() => {
      if (!firebaseUser || !authProfile?.isApproved) {
        return
      }

      void loadAlerts(true)
    })
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!firebaseUser || !authProfile?.isApproved) {
        return
      }

      const nextScreen = resolveNotificationTargetScreen(response.notification.request.content.data)

      setActiveScreen(nextScreen)

      if (nextScreen === 'settings') {
        setActiveSettingsMenuId('updates')
      }

      void loadAlerts(true)
    })

    return () => {
      receiveSubscription.remove()
      responseSubscription.remove()
    }
  }, [authProfile?.isApproved, firebaseUser, loadAlerts, resolveNotificationTargetScreen])

  const handleSaveTimesheetEntry = useCallback(async () => {
    const normalizedDate = timesheetDate.trim()
    const todayIsoDate = formatDateInput(new Date())
    const normalizedJobNumber = timesheetJobNumber.trim()
    const normalizedNotes = timesheetNotes.trim()
    const hours = Number(timesheetHours)

    if (!normalizedDate) {
      setTimesheetMessage(t('Date is required.', 'La fecha es obligatoria.'))
      return
    }

    if (normalizedDate !== todayIsoDate) {
      setTimesheetMessage(
        t(
          'You can only add entries for today.',
          'Solo puedes agregar entradas para la fecha de hoy.',
        ),
      )
      return
    }

    if (!normalizedJobNumber) {
      setTimesheetMessage(t('Job number is required.', 'El numero de trabajo es obligatorio.'))
      return
    }

    if (!timesheetStageId) {
      setTimesheetMessage(t('Stage is required.', 'La etapa es obligatoria.'))
      return
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      setTimesheetMessage(t('Hours must be a positive number.', 'Las horas deben ser un numero positivo.'))
      return
    }

    setIsTimesheetSaving(true)
    setTimesheetMessage(null)

    try {
      const payload = await requestWithSession<{ entry: MobileTimesheetEntry }>(
        '/api/timesheet/my-entries',
        false,
        {
          method: 'POST',
          body: JSON.stringify({
            date: normalizedDate,
            jobName: normalizedJobNumber,
            stageId: timesheetStageId,
            hours,
            notes: normalizedNotes,
          }),
        },
      )

      setTimesheetEntries((previous) => [payload.entry, ...previous])
      setTimesheetJobNumber('')
      setTimesheetHours('')
      setTimesheetNotes('')
      setTimesheetMessage(t('Timesheet entry saved.', 'Entrada de horas guardada.'))
    } catch (error) {
      setTimesheetMessage(
        getErrorMessage(
          error,
          'Could not save timesheet entry.',
          'No se pudo guardar la entrada de horas.',
        ),
      )
    } finally {
      setIsTimesheetSaving(false)
    }
  }, [
    getErrorMessage,
    requestWithSession,
    t,
    timesheetDate,
    timesheetHours,
    timesheetJobNumber,
    timesheetNotes,
    timesheetStageId,
  ])

  const handleRefreshOrdersScreen = useCallback(() => {
    void (async () => {
      const selectedOrderKey = String(selectedOrderForDetails?.id ?? '').trim()
      const selectedOrderDetailsSnapshot = selectedOrderKey
        ? orderJobDetailsByOrderId[selectedOrderKey] ?? null
        : null
      const selectedMondayItemId = String(
        selectedOrderDetailsSnapshot?.order?.mondayItemId
        ?? selectedOrderDetailsSnapshot?.job?.mondayItemId
        ?? selectedOrderForDetails?.mondayItemId
        ?? selectedOrderForDetails?.id
        ?? '',
      ).trim()

      setOrdersDetailMessage(null)

      try {
        await requestWithSession<{ ok?: boolean }>(
          '/api/orders/refresh',
          false,
          {
            method: 'POST',
          },
        )
      } catch (error) {
        setOrdersDetailMessage(
          getErrorMessage(
            error,
            'Could not refresh orders from Monday.',
            'No se pudo actualizar ordenes desde Monday.',
          ),
        )
      }

      await loadDashboard(true)

      if (!selectedOrderKey || !selectedMondayItemId) {
        return
      }

      try {
        const bolRefreshPayload = await requestWithSession<{
          ok?: boolean
          cachedBolUrl?: string | null
          fileName?: string | null
        }>(
          `/api/dashboard/monday/bol/download?orderId=${encodeURIComponent(selectedMondayItemId)}&cacheOnly=1&forceRefresh=1`,
        )

        const refreshedBolCachedUrl = String(bolRefreshPayload?.cachedBolUrl ?? '').trim()

        if (refreshedBolCachedUrl) {
          setOrderJobDetailsByOrderId((previous) => {
            const existingDetails = previous[selectedOrderKey]

            if (!existingDetails?.order) {
              return previous
            }

            return {
              ...previous,
              [selectedOrderKey]: {
                ...existingDetails,
                order: {
                  ...existingDetails.order,
                  bolCachedUrl: refreshedBolCachedUrl,
                },
              },
            }
          })
        }

        const refreshedDetails = await requestWithSession<OrderJobDetailsSnapshot>(
          `/api/orders/job-details?mondayItemId=${encodeURIComponent(selectedMondayItemId)}`,
          true,
        )

        setOrderJobDetailsByOrderId((previous) => ({
          ...previous,
          [selectedOrderKey]: refreshedDetails,
        }))
      } catch (error) {
        setOrdersDetailMessage(
          getErrorMessage(
            error,
            'Could not refresh BOL from Monday. Tap Refresh again in a moment.',
            'No se pudo actualizar el BOL desde Monday. Toca Actualizar otra vez en un momento.',
          ),
        )
      }
    })()
  }, [
    getErrorMessage,
    loadDashboard,
    orderJobDetailsByOrderId,
    requestWithSession,
    selectedOrderForDetails,
  ])

  const handleRefreshActiveScreen = useCallback(() => {
    if (activeScreen === 'timesheet') {
      void loadTimesheet()
      return
    }

    if (activeScreen === 'manager') {
      void loadManagerSheet()
      return
    }

    if (activeScreen === 'alerts') {
      void loadAlerts(true)
      return
    }

    if (activeScreen === 'chat') {
      void loadChatState(true)

      if (chatSelectedThreadId) {
        void loadChatMessages(chatSelectedThreadId, true)
      }

      return
    }

    if (activeScreen === 'settings') {
      void syncAuthProfile()
      void handleCheckForUpdates()
      return
    }

    if (activeScreen === 'admin') {
      setAdminPortalMessage(null)
      handleAdminWorkspaceRefresh()
      return
    }

    if (activeScreen === 'orders') {
      handleRefreshOrdersScreen()
      return
    }

    void loadDashboard(true)
  }, [
    activeScreen,
    handleCheckForUpdates,
    handleAdminWorkspaceRefresh,
    handleRefreshOrdersScreen,
    chatSelectedThreadId,
    loadChatMessages,
    loadChatState,
    loadAlerts,
    loadDashboard,
    loadManagerSheet,
    loadTimesheet,
    syncAuthProfile,
  ])

  useEffect(() => {
    const firstOrderId = mondaySnapshot?.orders?.[0]?.id ?? null

    setSelectedPictureOrderId((previous) => {
      if (previous && mondaySnapshot?.orders?.some((order) => order.id === previous)) {
        return previous
      }

      return firstOrderId
    })
  }, [mondaySnapshot])

  useEffect(() => {
    resetPendingPicturesAndMessage()
  }, [resetPendingPicturesAndMessage, selectedPictureOrderId])

  const loadOrderPhotos = useCallback(
    async (orderId: string, forceRefresh = false) => {
      if (!orderId) {
        return
      }

      if (!forceRefresh && orderPhotosByOrderId[orderId]) {
        return
      }

      setIsLoadingOrderPhotos(true)
      setPictureMessage(null)

      try {
        const payload = await requestWithSession<{ orderId: string; photos: OrderPhoto[] }>(
          `/api/orders/${encodeURIComponent(orderId)}/photos`,
        )

        setOrderPhotosByOrderId((previous) => ({
          ...previous,
          [orderId]: Array.isArray(payload.photos) ? payload.photos : [],
        }))
      } catch {
        setPictureMessage(
          t(
            'Could not load saved pictures for this order.',
            'No se pudieron cargar las fotos guardadas para esta orden.',
          ),
        )
      } finally {
        setIsLoadingOrderPhotos(false)
      }
    },
    [orderPhotosByOrderId, requestWithSession, t],
  )

  useEffect(() => {
    if (activeScreen !== 'pictures' || !selectedPictureOrderId) {
      return
    }

    void loadOrderPhotos(selectedPictureOrderId)
  }, [activeScreen, selectedPictureOrderId, loadOrderPhotos])

  const openPicturesModalForOrder = useCallback((orderId: string) => {
    setSelectedPictureOrderId(orderId)
    resetPendingPicturesAndMessage()
    setIsPicturesModalOpen(true)
    void loadOrderPhotos(orderId)
  }, [loadOrderPhotos, resetPendingPicturesAndMessage])

  const orderMetrics = useMemo(
    () => [
      {
        key: 'lateOrders' as const,
        label: t('Late Orders', 'Ordenes atrasadas'),
        value: mondaySnapshot?.metrics.lateOrders ?? 0,
        helper: t('Past due and not shipped', 'Vencidas y no enviadas'),
        tone: ORDER_TONES[0],
      },
      {
        key: 'dueThisWeekOrders' as const,
        label: t('Due This Week', 'Vencen esta semana'),
        value: orderBuckets.dueThisWeekOrders.length,
        helper: t('Not shipped, due in 7 days', 'No enviadas, vencen en 7 dias'),
        tone: ORDER_TONES[1],
      },
      {
        key: 'dueInTwoWeeksOrders' as const,
        label: t('Due In 2 Weeks', 'Vencen en 2 semanas'),
        value: orderBuckets.dueInTwoWeeksOrders.length,
        helper: t('Not shipped, due in 8-14 days', 'No enviadas, vencen en 8-14 dias'),
        tone: ORDER_TONES[3],
      },
      {
        key: 'activeOrders' as const,
        label: t('In Progress', 'En progreso'),
        value: mondaySnapshot?.metrics.activeOrders ?? 0,
        helper: t('Currently active jobs', 'Trabajos activos actualmente'),
        tone: ORDER_TONES[2],
      },
      {
        key: 'missingDueDateOrders' as const,
        label: t('Missing Due Date', 'Sin fecha de entrega'),
        value: mondaySnapshot?.metrics.missingDueDateOrders ?? 0,
        helper: t('Needs scheduling', 'Necesita programacion'),
        tone: ORDER_TONES[4],
      },
    ],
    [mondaySnapshot, orderBuckets, t],
  )

  const ticketMetrics = useMemo(
    () => [
      {
        key: 'newTickets' as const,
        label: t('New', 'Nuevos'),
        value: zendeskSnapshot?.metrics.newTickets ?? 0,
        tone: TICKET_TONES[0],
      },
      {
        key: 'inProgressTickets' as const,
        label: t('In Process', 'En proceso'),
        value: zendeskSnapshot?.metrics.inProgressTickets ?? 0,
        tone: TICKET_TONES[1],
      },
      {
        key: 'openTickets' as const,
        label: t('Open', 'Abiertos'),
        value: zendeskSnapshot?.metrics.openTickets ?? 0,
        tone: TICKET_TONES[2],
      },
      {
        key: 'pendingTickets' as const,
        label: t('Pending', 'Pendientes'),
        value: zendeskSnapshot?.metrics.pendingTickets ?? 0,
        tone: TICKET_TONES[3],
      },
      {
        key: 'solvedTickets' as const,
        label: t('Solved', 'Resueltos'),
        value: zendeskSnapshot?.metrics.solvedTickets ?? 0,
        tone: TICKET_TONES[4],
      },
    ],
    [zendeskSnapshot, t],
  )

  const latestSyncText = useMemo(() => {
    const pickNewestSyncValue = (values: Array<string | null | undefined>) => {
      const candidates = values
        .map((value) => String(value ?? '').trim())
        .filter((value): value is string => Boolean(value))

      if (!candidates.length) {
        return null
      }

      return candidates.reduce((latest, current) => {
        const latestTime = Date.parse(latest)
        const currentTime = Date.parse(current)

        if (Number.isNaN(latestTime)) {
          return current
        }

        if (Number.isNaN(currentTime)) {
          return latest
        }

        return currentTime > latestTime ? current : latest
      })
    }

    const formatSyncValue = (value: string) => {
      const parsed = new Date(value)

      if (Number.isNaN(parsed.getTime())) {
        return value
      }

      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(parsed)
    }

    const adminSyncValue = adminPortalRoutePath
      ? adminWorkspaceDataByPath[adminPortalRoutePath]?.updatedAt
      : null

    const contextualCandidates =
      activeScreen === 'admin'
        ? [adminSyncValue]
        : activeScreen === 'orders' || activeScreen === 'pictures'
          ? [mondaySnapshot?.generatedAt]
          : activeScreen === 'alerts'
            ? [zendeskSnapshot?.generatedAt, supportTicketsSnapshot?.generatedAt]
            : [mondaySnapshot?.generatedAt, zendeskSnapshot?.generatedAt, supportTicketsSnapshot?.generatedAt, adminSyncValue]

    const newestRaw = pickNewestSyncValue(contextualCandidates)
      ?? pickNewestSyncValue([
        mondaySnapshot?.generatedAt,
        zendeskSnapshot?.generatedAt,
        supportTicketsSnapshot?.generatedAt,
        adminSyncValue,
      ])

    if (!newestRaw) {
      return t('Unknown', 'Desconocido')
    }

    return formatSyncValue(newestRaw)
  }, [
    activeScreen,
    adminPortalRoutePath,
    adminWorkspaceDataByPath,
    locale,
    mondaySnapshot?.generatedAt,
    supportTicketsSnapshot?.generatedAt,
    t,
    zendeskSnapshot?.generatedAt,
  ])

  const detailOrders = useMemo(() => {
    if (!mondaySnapshot || !detailSelection || detailSelection.type !== 'order') {
      return []
    }

    let selectedOrders: DashboardOrder[] = []

    switch (detailSelection.key) {
      case 'lateOrders':
        selectedOrders = mondaySnapshot.details.lateOrders
        break
      case 'dueThisWeekOrders':
        selectedOrders = orderBuckets.dueThisWeekOrders
        break
      case 'dueInTwoWeeksOrders':
        selectedOrders = orderBuckets.dueInTwoWeeksOrders
        break
      case 'activeOrders':
        selectedOrders = mondaySnapshot.details.activeOrders
        break
      case 'missingDueDateOrders':
        selectedOrders = mondaySnapshot.details.missingDueDateOrders
        break
      default:
        return []
    }

    if (!isStandardUser) {
      return selectedOrders
    }

    return selectedOrders.filter((order) => {
      const isShipped = isShippedDashboardOrder(order)
      const isDesign = isDesignDashboardOrder(order)

      return !isShipped && !isDesign
    })
  }, [detailSelection, isStandardUser, mondaySnapshot, orderBuckets])

  const detailTickets = useMemo(() => {
    if (!supportTicketsSnapshot || !detailSelection || detailSelection.type !== 'ticket') {
      return []
    }

    const allTickets = supportTicketsSnapshot.tickets

    return allTickets.filter((ticket) => {
      const status = normalizeTicketStatus(ticket.status)
      const statusLabel = normalizeTicketStatus(ticket.statusLabel)

      switch (detailSelection.key) {
        case 'newTickets':
          return status === 'new' || statusLabel.includes('new')
        case 'inProgressTickets':
          return (
            status === 'in_progress' ||
            statusLabel.includes('in progress') ||
            statusLabel.includes('in-progress')
          )
        case 'openTickets':
          return (
            (status === 'open' || statusLabel === 'open') &&
            !statusLabel.includes('in progress') &&
            !statusLabel.includes('in-progress')
          )
        case 'pendingTickets':
          return status === 'pending' || statusLabel.includes('pending')
        case 'solvedTickets':
          return (
            status === 'solved' ||
            status === 'closed' ||
            statusLabel.includes('solved') ||
            statusLabel.includes('closed')
          )
        default:
          return false
      }
    })
  }, [detailSelection, supportTicketsSnapshot])

  const clearDashboardMetricZoomTimeout = useCallback(() => {
    if (dashboardMetricZoomTimeoutRef.current) {
      clearTimeout(dashboardMetricZoomTimeoutRef.current)
      dashboardMetricZoomTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearDashboardMetricZoomTimeout()
    }
  }, [clearDashboardMetricZoomTimeout])

  useEffect(() => {
    if (!detailSelection || detailSelection.type !== 'order') {
      clearDashboardMetricZoomTimeout()
      setDashboardMetricZoomOrderId(null)
    }
  }, [clearDashboardMetricZoomTimeout, detailSelection])

  const handleToggleDashboardMetricOrderZoom = useCallback((orderId: string) => {
    clearDashboardMetricZoomTimeout()
    setDashboardMetricZoomOrderId((current) => (current === orderId ? null : orderId))
  }, [clearDashboardMetricZoomTimeout])

  const handleOpenDashboardOrderFromMetrics = useCallback((order: DashboardOrder) => {
    if (!String(order.id ?? '').trim()) {
      return
    }

    clearDashboardMetricZoomTimeout()
    setDetailSelection(null)
    setActiveScreen('orders')
    setOrdersSearchQuery('')
    setOrdersPage(1)
    setSelectedOrderForDetails(order)
    setSelectedOrderDetailsView('overview')
    setOrdersDetailMessage(null)
    setIsOrderDetailsFromDashboardMetric(true)
    setDashboardMetricZoomOrderId(null)
  }, [clearDashboardMetricZoomTimeout])

  const allOrdersForPictures = useMemo(() => {
    const allOrders = mondaySnapshot?.orders ?? []

    if (!isStandardUser) {
      return allOrders
    }

    return allOrders.filter((order) => {
      const isShipped = isShippedDashboardOrder(order)
      const isDesign = isDesignDashboardOrder(order)

      return !isShipped && !isDesign
    })
  }, [isStandardUser, mondaySnapshot])

  const filteredOrdersForPictures = useMemo(() => {
    const normalizedQuery = orderSearchQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return allOrdersForPictures
    }

    return allOrdersForPictures.filter((order) => {
      const orderId = String(order.id ?? '').toLowerCase()
      const orderNumber = String(order.orderNumber ?? '').toLowerCase()
      const orderName = String(order.name ?? '').toLowerCase()

      return orderId.includes(normalizedQuery)
        || orderNumber.includes(normalizedQuery)
        || orderName.includes(normalizedQuery)
    })
  }, [allOrdersForPictures, orderSearchQuery])

  const filteredOrdersForList = useMemo(() => {
    const normalizedQuery = ordersSearchQuery.trim().toLowerCase()
    const viewFilteredOrders = allOrdersForPictures.filter((order) => {
      const isShipped = isShippedDashboardOrder(order)
      const isDesign = isDesignDashboardOrder(order)

      if (ordersViewFilter === 'shipped') {
        return isShipped
      }

      if (ordersViewFilter === 'design') {
        return !isShipped && isDesign
      }

      return !isShipped && !isDesign
    })

    if (!normalizedQuery) {
      return viewFilteredOrders
    }

    return viewFilteredOrders.filter((order) => {
      const orderId = String(order.id ?? '').toLowerCase()
      const orderNumber = String(order.orderNumber ?? '').toLowerCase()
      const poNumber = String(order.poNumber ?? '').toLowerCase()
      const orderName = String(order.name ?? '').toLowerCase()
      return orderId.includes(normalizedQuery)
        || orderNumber.includes(normalizedQuery)
        || poNumber.includes(normalizedQuery)
        || orderName.includes(normalizedQuery)
    })
  }, [allOrdersForPictures, ordersSearchQuery, ordersViewFilter])

  useEffect(() => {
    if (!isStandardUser) {
      return
    }

    if (ordersViewFilter !== 'orders') {
      setOrdersViewFilter('orders')
    }
  }, [isStandardUser, ordersViewFilter])

  const ordersTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOrdersForList.length / ORDERS_PAGE_SIZE)),
    [filteredOrdersForList.length],
  )

  const paginatedOrdersForList = useMemo(() => {
    const safePage = Math.min(Math.max(ordersPage, 1), ordersTotalPages)
    const start = (safePage - 1) * ORDERS_PAGE_SIZE

    return filteredOrdersForList.slice(start, start + ORDERS_PAGE_SIZE)
  }, [filteredOrdersForList, ordersPage, ordersTotalPages])

  const safeOrdersPage = useMemo(
    () => Math.min(Math.max(ordersPage, 1), ordersTotalPages),
    [ordersPage, ordersTotalPages],
  )

  const ordersRangeStart = useMemo(() => {
    if (filteredOrdersForList.length === 0) {
      return 0
    }

    return (safeOrdersPage - 1) * ORDERS_PAGE_SIZE + 1
  }, [filteredOrdersForList.length, safeOrdersPage])

  const ordersRangeEnd = useMemo(() => {
    if (filteredOrdersForList.length === 0) {
      return 0
    }

    return ordersRangeStart + paginatedOrdersForList.length - 1
  }, [filteredOrdersForList.length, ordersRangeStart, paginatedOrdersForList.length])

  useEffect(() => {
    setOrdersPage(1)
  }, [ordersSearchQuery, ordersViewFilter])

  useEffect(() => {
    setOrdersPage((current) => Math.min(current, ordersTotalPages))
  }, [ordersTotalPages])

  const selectedPictureOrder = useMemo(
    () => allOrdersForPictures.find((order) => order.id === selectedPictureOrderId) ?? null,
    [allOrdersForPictures, selectedPictureOrderId],
  )

  const picturesCardHeight = useMemo(
    () => Math.max(390, windowHeight - 240),
    [windowHeight],
  )

  const ordersCardHeight = useMemo(
    () => Math.max(390, windowHeight - 240),
    [windowHeight],
  )

  const alertsCardHeight = useMemo(
    () => Math.max(400, windowHeight - 300),
    [windowHeight],
  )

  const chatCardHeight = useMemo(
    () => Math.max(420, windowHeight - 300),
    [windowHeight],
  )

  const chatThreadCardHeight = useMemo(
    () => Math.max(520, windowHeight - 140),
    [windowHeight],
  )

  const poNumberByOrderId = useMemo(() => {
    const poByOrderId: Record<string, string | null> = {}

    allOrdersForPictures.forEach((order) => {
      const orderWithPo = order as DashboardOrder & { poNumber?: string | null; po_number?: string | null }
      const poNumber = String(orderWithPo.poNumber ?? orderWithPo.po_number ?? '').trim()

      if (poNumber) {
        poByOrderId[String(order.id)] = poNumber
      }
    })

    Object.entries(orderJobDetailsByOrderId).forEach(([orderId, detailsSnapshot]) => {
      const poNumber = String(detailsSnapshot?.order?.poNumber ?? '').trim()

      if (poNumber) {
        poByOrderId[orderId] = poNumber
      }
    })

    return poByOrderId
  }, [allOrdersForPictures, orderJobDetailsByOrderId])

  const adminWorkspaceHeight = useMemo(
    () => Math.max(440, windowHeight - 300),
    [windowHeight],
  )

  const selectedAdminPortalPage = useMemo(
    () => ADMIN_PORTAL_PAGES.find((page) => page.path === adminPortalRoutePath) ?? ADMIN_PORTAL_PAGES[0],
    [adminPortalRoutePath],
  )

  const selectedAdminWorkspaceData = useMemo(
    () => adminWorkspaceDataByPath[selectedAdminPortalPage.path] ?? null,
    [adminWorkspaceDataByPath, selectedAdminPortalPage.path],
  )

  const selectedAdminAccessMenuUser = useMemo(
    () => adminUsersForAccess.find((user) => user.uid === adminAccessMenuUserUid) ?? null,
    [adminAccessMenuUserUid, adminUsersForAccess],
  )

  const selectedAdminReportSections = useMemo(() => {
    if (selectedAdminPortalPage.path !== '/admin/reports') {
      return {
        worker: null,
        month: null,
        job: null,
        date: null,
        monthTotalCostBills: null,
        monthOverheadBills: null,
        monthNetProfitOrders: null,
        monthProjectProfitOrders: null,
      }
    }

    const sections = selectedAdminWorkspaceData?.sections ?? []

    return {
      worker: sections.find((section) => section.id === 'report_worker') ?? null,
      month: sections.find((section) => section.id === 'report_month') ?? null,
      job: sections.find((section) => section.id === 'report_job') ?? null,
      date: sections.find((section) => section.id === 'report_date') ?? null,
      monthTotalCostBills: sections.find((section) => section.id === 'report_month_total_cost_bills') ?? null,
      monthOverheadBills: sections.find((section) => section.id === 'report_month_overhead_bills') ?? null,
      monthNetProfitOrders: sections.find((section) => section.id === 'report_month_net_profit_orders') ?? null,
      monthProjectProfitOrders: sections.find((section) => section.id === 'report_month_project_profit_orders') ?? null,
    }
  }, [selectedAdminPortalPage.path, selectedAdminWorkspaceData])

  const adminReportWorkerRows = useMemo(
    () => selectedAdminReportSections.worker?.rows ?? [],
    [selectedAdminReportSections.worker],
  )

  const filteredAdminReportWorkerRows = useMemo(() => {
    const normalizedQuery = adminReportWorkerSearch.trim().toLowerCase()

    if (!normalizedQuery) {
      return adminReportWorkerRows
    }

    return adminReportWorkerRows.filter((row) => (
      row.title.toLowerCase().includes(normalizedQuery)
      || row.subtitle.toLowerCase().includes(normalizedQuery)
    ))
  }, [adminReportWorkerSearch, adminReportWorkerRows])

  const selectedAdminWorkerReportRow = useMemo(() => {
    if (!adminSelectedWorkerReportRowId) {
      return null
    }

    return adminReportWorkerRows.find((row) => row.id === adminSelectedWorkerReportRowId) ?? null
  }, [adminReportWorkerRows, adminSelectedWorkerReportRowId])

  const adminReportMonthTotalCostBillRows = useMemo(
    () => selectedAdminReportSections.monthTotalCostBills?.rows ?? [],
    [selectedAdminReportSections.monthTotalCostBills],
  )

  const adminReportMonthOverheadBillRows = useMemo(
    () => selectedAdminReportSections.monthOverheadBills?.rows ?? [],
    [selectedAdminReportSections.monthOverheadBills],
  )

  const adminReportMonthNetProfitRows = useMemo(
    () => selectedAdminReportSections.monthNetProfitOrders?.rows ?? [],
    [selectedAdminReportSections.monthNetProfitOrders],
  )

  const adminReportMonthProjectProfitRows = useMemo(
    () => selectedAdminReportSections.monthProjectProfitOrders?.rows ?? [],
    [selectedAdminReportSections.monthProjectProfitOrders],
  )

  const selectedAdminMonthProjectProfitRow = useMemo(
    () => adminReportMonthProjectProfitRows.find((row) => row.id === adminSelectedMonthProjectRowId) ?? null,
    [adminReportMonthProjectProfitRows, adminSelectedMonthProjectRowId],
  )

  const adminReportMonthSummaryCards = useMemo(() => {
    if (selectedAdminPortalPage.path !== '/admin/reports') {
      return []
    }

    const statsById = new Map<string, AdminWorkspaceStat>()

    ;(selectedAdminWorkspaceData?.stats ?? []).forEach((stat) => {
      const statId = normalizeTextValue(stat.id)

      if (!statId) {
        return
      }

      statsById.set(statId, stat)
    })

    return [
      {
        id: 'general_overhead',
        label: t('General overhead', 'Gasto general'),
        value: statsById.get('general_overhead')?.value ?? '$0.00',
      },
      {
        id: 'total_cost',
        label: t('Total cost', 'Costo total'),
        value: statsById.get('total_cost')?.value ?? '$0.00',
      },
      {
        id: 'net_profit',
        label: t('Net profit', 'Ganancia neta'),
        value: statsById.get('net_profit')?.value ?? '$0.00',
      },
      {
        id: 'project_profit',
        label: t('Project profit', 'Ganancia del proyecto'),
        value: statsById.get('project_profit')?.value ?? '$0.00',
      },
    ]
  }, [selectedAdminPortalPage.path, selectedAdminWorkspaceData?.stats, t])

  const adminReportJobRows = useMemo(
    () => selectedAdminReportSections.job?.rows ?? [],
    [selectedAdminReportSections.job],
  )

  const filteredAdminReportJobRows = useMemo(() => {
    const normalizedQuery = adminReportJobSearch.trim().toLowerCase()

    if (!normalizedQuery) {
      return adminReportJobRows
    }

    return adminReportJobRows.filter((row) => (
      row.title.toLowerCase().includes(normalizedQuery)
      || row.subtitle.toLowerCase().includes(normalizedQuery)
      || String(row.meta ?? '').toLowerCase().includes(normalizedQuery)
    ))
  }, [adminReportJobRows, adminReportJobSearch])

  const adminReportDateRows = useMemo(
    () => selectedAdminReportSections.date?.rows ?? [],
    [selectedAdminReportSections.date],
  )

  const adminReportMonthSectionsByCardId = useMemo<Record<string, AdminWorkspaceSection | null>>(
    () => ({
      general_overhead: selectedAdminReportSections.monthOverheadBills
        ? {
          ...selectedAdminReportSections.monthOverheadBills,
          rows: adminReportMonthOverheadBillRows,
        }
        : null,
      total_cost: selectedAdminReportSections.monthTotalCostBills
        ? {
          ...selectedAdminReportSections.monthTotalCostBills,
          rows: adminReportMonthTotalCostBillRows,
        }
        : null,
      net_profit: selectedAdminReportSections.monthNetProfitOrders
        ? {
          ...selectedAdminReportSections.monthNetProfitOrders,
          rows: adminReportMonthNetProfitRows,
        }
        : null,
      project_profit: selectedAdminReportSections.monthProjectProfitOrders
        ? {
          ...selectedAdminReportSections.monthProjectProfitOrders,
          rows: adminReportMonthProjectProfitRows,
        }
        : null,
    }),
    [
      adminReportMonthNetProfitRows,
      adminReportMonthOverheadBillRows,
      adminReportMonthProjectProfitRows,
      adminReportMonthTotalCostBillRows,
      selectedAdminReportSections.monthNetProfitOrders,
      selectedAdminReportSections.monthOverheadBills,
      selectedAdminReportSections.monthProjectProfitOrders,
      selectedAdminReportSections.monthTotalCostBills,
    ],
  )

  const visibleAdminSections = useMemo(() => {
    const sections = selectedAdminWorkspaceData?.sections ?? []

    if (selectedAdminPortalPage.path !== '/admin/reports') {
      return sections
    }

    if (adminReportsView === 'menu') {
      return []
    }

    if (adminReportsView === 'worker') {
      return selectedAdminReportSections.worker
        ? [{ ...selectedAdminReportSections.worker, rows: filteredAdminReportWorkerRows }]
        : []
    }

    if (adminReportsView === 'month') {
      return []
    }

    if (adminReportsView === 'job') {
      return selectedAdminReportSections.job
        ? [{
          ...selectedAdminReportSections.job,
          title: t('Job reports', 'Reportes por trabajo'),
          rows: filteredAdminReportJobRows,
          emptyText: t('No rows found for this report.', 'No se encontraron filas para este reporte.'),
        }]
        : []
    }

    const normalizedRangeStart = normalizeIsoDate(adminReportDateRangeStart)
    const normalizedRangeEnd = normalizeIsoDate(adminReportDateRangeEnd)
    const rangeLowerBound = normalizedRangeStart && normalizedRangeEnd
      ? (normalizedRangeStart <= normalizedRangeEnd ? normalizedRangeStart : normalizedRangeEnd)
      : (normalizedRangeStart ?? normalizedRangeEnd)
    const rangeUpperBound = normalizedRangeStart && normalizedRangeEnd
      ? (normalizedRangeStart <= normalizedRangeEnd ? normalizedRangeEnd : normalizedRangeStart)
      : (normalizedRangeEnd ?? normalizedRangeStart)

    const rowsForDate = adminReportDateRows.filter((row) => {
      const rowDateKey = resolveDateKeyFromReportRowId(row.id)

      if (!rowDateKey) {
        return false
      }

      if (rangeLowerBound && rowDateKey < rangeLowerBound) {
        return false
      }

      if (rangeUpperBound && rowDateKey > rangeUpperBound) {
        return false
      }

      return true
    })

    return selectedAdminReportSections.date
      ? [{ ...selectedAdminReportSections.date, rows: rowsForDate }]
      : []
  }, [
    adminReportDateRangeEnd,
    adminReportDateRangeStart,
    adminReportDateRows,
    adminReportsView,
    filteredAdminReportJobRows,
    filteredAdminReportWorkerRows,
    selectedAdminPortalPage.path,
    selectedAdminReportSections.date,
    selectedAdminReportSections.job,
    selectedAdminReportSections.worker,
    selectedAdminWorkspaceData?.sections,
    t,
  ])

  useEffect(() => {
    if (selectedAdminPortalPage.path !== '/admin/reports') {
      return
    }

    const dateKeys = [...new Set(
      adminReportDateRows
        .map((row) => resolveDateKeyFromReportRowId(row.id))
        .filter((dateKey) => Boolean(dateKey)),
    )].sort((left, right) => left.localeCompare(right))

    if (dateKeys.length === 0) {
      return
    }

    const normalizedStart = normalizeIsoDate(adminReportDateRangeStart)
    const normalizedEnd = normalizeIsoDate(adminReportDateRangeEnd)

    if (normalizedStart && normalizedEnd) {
      return
    }

    const fallbackStart = dateKeys[0]
    const fallbackEnd = dateKeys[dateKeys.length - 1]

    if (!normalizedStart && fallbackStart) {
      setAdminReportDateRangeStart(fallbackStart)
    }

    if (!normalizedEnd && fallbackEnd) {
      setAdminReportDateRangeEnd(fallbackEnd)
    }
  }, [
    adminReportDateRangeEnd,
    adminReportDateRangeStart,
    adminReportDateRows,
    selectedAdminPortalPage.path,
  ])

  useEffect(() => {
    if (adminReportDetailsModalState) {
      return
    }

    if (adminReportWorkerDrilldownModalState) {
      setAdminReportWorkerDrilldownModalState(null)
    }
  }, [adminReportDetailsModalState, adminReportWorkerDrilldownModalState])

  useEffect(() => {
    if (!adminSelectedWorkerReportRowId) {
      return
    }

    const stillVisible = filteredAdminReportWorkerRows.some((row) => row.id === adminSelectedWorkerReportRowId)

    if (!stillVisible) {
      setAdminSelectedWorkerReportRowId(null)
    }
  }, [adminSelectedWorkerReportRowId, filteredAdminReportWorkerRows])

  useEffect(() => {
    if (adminReportsView !== 'month' || adminReportMonthStatId !== 'project_profit') {
      if (adminSelectedMonthProjectRowId) {
        setAdminSelectedMonthProjectRowId(null)
      }
      return
    }

    if (!adminSelectedMonthProjectRowId) {
      return
    }

    const stillExists = adminReportMonthProjectProfitRows.some((row) => row.id === adminSelectedMonthProjectRowId)

    if (!stillExists) {
      setAdminSelectedMonthProjectRowId(null)
    }
  }, [
    adminReportMonthProjectProfitRows,
    adminReportMonthStatId,
    adminReportsView,
    adminSelectedMonthProjectRowId,
  ])

  useEffect(() => {
    if (adminReportsView === 'month') {
      return
    }

    if (!adminReportMonthListModalState) {
      return
    }

    setAdminReportMonthListModalState(null)
    setAdminReportMonthStatId('summary')
  }, [adminReportMonthListModalState, adminReportsView])

  useEffect(() => {
    if (!adminReportMonthListModalState) {
      return
    }

    const refreshedSection = adminReportMonthSectionsByCardId[adminReportMonthListModalState.statId]

    if (!refreshedSection) {
      setAdminReportMonthListModalState(null)
      setAdminReportMonthStatId('summary')
      return
    }

    if (refreshedSection !== adminReportMonthListModalState.section) {
      setAdminReportMonthListModalState((current) => {
        if (!current || current.statId !== adminReportMonthListModalState.statId) {
          return current
        }

        return {
          ...current,
          section: refreshedSection,
        }
      })
    }
  }, [adminReportMonthListModalState, adminReportMonthSectionsByCardId])

  useEffect(() => {
    if (selectedAdminPortalPage.path !== '/admin/cash') {
      setAdminCashAccountModalRow(null)
    }
  }, [selectedAdminPortalPage.path])

  const isAdminWorkspaceLoading = adminWorkspaceLoadingPath === selectedAdminPortalPage.path
  const isAdminReportsDetailModalOpen = selectedAdminPortalPage.path === '/admin/reports' && adminReportsView !== 'menu'

  const selectedOrderPhotos = useMemo(() => {
    if (!selectedPictureOrder) {
      return []
    }

    return orderPhotosByOrderId[selectedPictureOrder.id] ?? []
  }, [orderPhotosByOrderId, selectedPictureOrder])

  const pendingPictureCount = pendingPictures.length

  const timesheetEntriesForSelectedDate = useMemo(
    () => timesheetEntries.filter((entry) => String(entry.date) === timesheetDate.trim()),
    [timesheetDate, timesheetEntries],
  )

  const timesheetStageNamesById = useMemo(
    () =>
      timesheetStages.reduce<Record<string, string>>((accumulator, stage) => {
        accumulator[stage.id] = stage.name
        return accumulator
      }, {}),
    [timesheetStages],
  )

  const managerProgressByDateJobKey = useMemo(() => {
    const map = new Map<string, MobileManagerOrderProgress>()

    managerOrderProgress.forEach((progress) => {
      const normalizedDate = normalizeIsoDate(progress.date)
      const normalizedJobName = normalizeJobName(progress.jobName)

      if (!normalizedDate || !normalizedJobName) {
        return
      }

      const key = `${normalizedDate}:${normalizedJobName}`
      map.set(key, progress)
    })

    return map
  }, [managerOrderProgress])

  const managerWorkersById = useMemo(() => {
    const map = new Map<string, MobileTimesheetWorker>()

    managerWorkers.forEach((worker) => {
      const workerId = String(worker.id ?? '').trim()

      if (workerId) {
        map.set(workerId, worker)
      }
    })

    return map
  }, [managerWorkers])

  const mondayOrderLookup = useMemo(() => {
    const byNormalizedKey = new Map<string, MondayDashboardSnapshot['orders'][number]>()
    const byDigits = new Map<string, MondayDashboardSnapshot['orders'][number]>()

    ;(mondaySnapshot?.orders ?? []).forEach((order) => {
      const nameKey = normalizeJobName(order.name)

      if (nameKey && !byNormalizedKey.has(nameKey)) {
        byNormalizedKey.set(nameKey, order)
      }

      const idKey = normalizeJobName(order.id)

      if (idKey && !byNormalizedKey.has(idKey)) {
        byNormalizedKey.set(idKey, order)
      }

      const nameDigits = extractDigits(order.name)

      if (nameDigits && !byDigits.has(nameDigits)) {
        byDigits.set(nameDigits, order)
      }

      const idDigits = extractDigits(order.id)

      if (idDigits && !byDigits.has(idDigits)) {
        byDigits.set(idDigits, order)
      }
    })

    return {
      byNormalizedKey,
      byDigits,
    }
  }, [mondaySnapshot?.orders])

  const managerDayEntries = useMemo(
    () => managerEntries.filter((entry) => normalizeIsoDate(entry.date) === managerDate.trim()),
    [managerDate, managerEntries],
  )

  const managerDayJobs = useMemo(() => {
    const jobNames = new Set<string>()

    managerDayEntries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    managerOrderProgress.forEach((progress) => {
      if (normalizeIsoDate(progress.date) !== managerDate.trim()) {
        return
      }

      const jobName = String(progress.jobName ?? '').trim()

      if (jobName) {
        jobNames.add(jobName)
      }
    })

    return [...jobNames].sort((left, right) => left.localeCompare(right))
  }, [managerDate, managerDayEntries, managerOrderProgress])

  const managerRows = useMemo(() => {
    const entriesByJobKey = new Map<
      string,
      {
        totalHours: number
        workerHoursById: Map<string, number>
      }
    >()

    managerDayEntries.forEach((entry) => {
      const jobKey = normalizeJobName(entry.jobName)

      if (!jobKey) {
        return
      }

      const existing = entriesByJobKey.get(jobKey) ?? {
        totalHours: 0,
        workerHoursById: new Map<string, number>(),
      }
      const workerKey = String(entry.workerId ?? '').trim() || `entry-${entry.id}`

      existing.totalHours += Number(entry.hours ?? 0)
      existing.workerHoursById.set(
        workerKey,
        (existing.workerHoursById.get(workerKey) ?? 0) + Number(entry.hours ?? 0),
      )
      entriesByJobKey.set(jobKey, existing)
    })

    return managerDayJobs.map((jobName) => {
      const jobKey = normalizeJobName(jobName)
      const jobDigits = extractDigits(jobName)
      const matchedMondayOrder =
        mondayOrderLookup.byNormalizedKey.get(jobKey)
        || (jobDigits ? mondayOrderLookup.byDigits.get(jobDigits) : null)
        || null
      const totals = entriesByJobKey.get(jobKey)
      const progressKey = `${managerDate.trim()}:${jobKey}`
      const savedProgress = managerProgressByDateJobKey.get(progressKey)
      const savedReadyPercent = savedProgress ? Number(savedProgress.readyPercent) : 0
      const rawDraft = String(managerProgressByJob[jobName] ?? '').trim()
      const parsedDraft = Number(rawDraft)
      const workerHoursByWorker = [...(totals?.workerHoursById.entries() ?? [])]
        .map(([workerId, hours]) => ({
          workerId,
          workerName: managerWorkersById.get(workerId)?.fullName ?? 'Unknown worker',
          hours,
        }))
        .sort((left, right) => right.hours - left.hours || left.workerName.localeCompare(right.workerName))
      const editReadyPercent =
        rawDraft === '' || !Number.isFinite(parsedDraft)
          ? savedReadyPercent
          : Math.min(100, Math.max(0, parsedDraft))

      return {
        jobName,
        displayOrderNumber: matchedMondayOrder?.id ?? jobName,
        mondayOrderId: matchedMondayOrder?.id ?? null,
        mondayItemName: matchedMondayOrder?.name ?? null,
        shopDrawingUrl: matchedMondayOrder?.shopDrawingUrl ?? null,
        shopDrawingCachedUrl: matchedMondayOrder?.shopDrawingCachedUrl ?? null,
        totalHours: totals?.totalHours ?? 0,
        workerCount: workerHoursByWorker.length,
        workerHoursByWorker,
        savedReadyPercent,
        editReadyPercent,
      }
    })
  }, [
    managerDate,
    managerDayEntries,
    managerDayJobs,
    managerProgressByDateJobKey,
    managerProgressByJob,
    managerWorkersById,
    mondayOrderLookup.byDigits,
    mondayOrderLookup.byNormalizedKey,
  ])

  const latestManagerProgressByOrderId = useMemo(() => {
    const map = new Map<string, { readyPercent: number; updatedAt: string | null; timestamp: number }>()

    managerOrderProgress.forEach((progress) => {
      const jobName = String(progress.jobName ?? '').trim()

      if (!jobName) {
        return
      }

      const normalizedJobName = normalizeJobName(jobName)
      const jobDigits = extractDigits(jobName)
      const matchedOrder =
        mondayOrderLookup.byNormalizedKey.get(normalizedJobName)
        || (jobDigits ? mondayOrderLookup.byDigits.get(jobDigits) : null)
        || null
      const orderId = String(matchedOrder?.id ?? '').trim()

      if (!orderId) {
        return
      }

      const readyPercent = Number(progress.readyPercent)

      if (!Number.isFinite(readyPercent)) {
        return
      }

      const updatedAt = String(progress.updatedAt ?? progress.date ?? '').trim() || null
      const timestamp = toTimestampMs(updatedAt) ?? 0
      const existing = map.get(orderId)

      if (!existing || timestamp >= existing.timestamp) {
        map.set(orderId, {
          readyPercent: Math.min(100, Math.max(0, readyPercent)),
          updatedAt,
          timestamp,
        })
      }
    })

    return map
  }, [managerOrderProgress, mondayOrderLookup.byDigits, mondayOrderLookup.byNormalizedKey])

  const managerRowByOrderId = useMemo(() => {
    const map = new Map<string, {
      savedReadyPercent: number
      workerCount: number
      totalHours: number
      updatedAt: string | null
    }>()

    managerRows.forEach((row) => {
      const orderId = String(row.mondayOrderId ?? '').trim()

      if (!orderId) {
        return
      }

      const key = `${managerDate.trim()}:${normalizeJobName(row.jobName)}`
      const progress = managerProgressByDateJobKey.get(key)
      const updatedAt = String(progress?.updatedAt ?? progress?.date ?? '').trim() || null

      map.set(orderId, {
        savedReadyPercent: Number.isFinite(row.savedReadyPercent)
          ? Math.min(100, Math.max(0, row.savedReadyPercent))
          : 0,
        workerCount: row.workerCount,
        totalHours: row.totalHours,
        updatedAt,
      })
    })

    return map
  }, [managerDate, managerProgressByDateJobKey, managerRows])

  const allTimeEntryTotalsByOrderId = useMemo(() => {
    const map = new Map<string, {
      workerIds: Set<string>
      totalHours: number
      updatedAt: string | null
      timestamp: number
    }>()

    managerEntries.forEach((entry) => {
      const jobName = String(entry.jobName ?? '').trim()

      if (!jobName) {
        return
      }

      const normalizedJobName = normalizeJobName(jobName)
      const jobDigits = extractDigits(jobName)
      const matchedOrder =
        mondayOrderLookup.byNormalizedKey.get(normalizedJobName)
        || (jobDigits ? mondayOrderLookup.byDigits.get(jobDigits) : null)
        || null
      const orderId = String(matchedOrder?.id ?? '').trim()

      if (!orderId) {
        return
      }

      const currentTotals = map.get(orderId) ?? {
        workerIds: new Set<string>(),
        totalHours: 0,
        updatedAt: null,
        timestamp: 0,
      }
      const workerId = String(entry.workerId ?? '').trim()

      if (workerId) {
        currentTotals.workerIds.add(workerId)
      }

      const entryHours = Number(entry.hours)

      if (Number.isFinite(entryHours)) {
        currentTotals.totalHours += entryHours
      }

      const normalizedDate = normalizeIsoDate(String(entry.date ?? '').trim())
      const entryDate = normalizedDate ?? (String(entry.date ?? '').trim() || null)
      const entryTimestamp = toTimestampMs(entryDate) ?? 0

      if (entryTimestamp >= currentTotals.timestamp) {
        currentTotals.timestamp = entryTimestamp
        currentTotals.updatedAt = entryDate
      }

      map.set(orderId, currentTotals)
    })

    const totalsByOrderId = new Map<string, {
      workerCount: number
      totalHours: number
      updatedAt: string | null
    }>()

    map.forEach((value, orderId) => {
      totalsByOrderId.set(orderId, {
        workerCount: value.workerIds.size,
        totalHours: value.totalHours,
        updatedAt: value.updatedAt,
      })
    })

    return totalsByOrderId
  }, [managerEntries, mondayOrderLookup.byDigits, mondayOrderLookup.byNormalizedKey])

  const orderManagerInsightsByOrderId = useMemo(() => {
    const insightsByOrderId: Record<string, {
      readyPercent: number | null
      workerCount: number
      totalHours: number
      updatedAt: string | null
    }> = {}

    allOrdersForPictures.forEach((order) => {
      const orderId = String(order.id ?? '').trim()

      if (!orderId) {
        return
      }

      const sameDayRow = managerRowByOrderId.get(orderId)
      const latestProgress = latestManagerProgressByOrderId.get(orderId)
      const allTimeEntryTotals = allTimeEntryTotalsByOrderId.get(orderId)

      insightsByOrderId[orderId] = {
        readyPercent: sameDayRow?.savedReadyPercent ?? latestProgress?.readyPercent ?? null,
        workerCount: allTimeEntryTotals?.workerCount ?? sameDayRow?.workerCount ?? 0,
        totalHours: allTimeEntryTotals?.totalHours ?? sameDayRow?.totalHours ?? 0,
        updatedAt: allTimeEntryTotals?.updatedAt ?? sameDayRow?.updatedAt ?? latestProgress?.updatedAt ?? null,
      }
    })

    return insightsByOrderId
  }, [allOrdersForPictures, allTimeEntryTotalsByOrderId, latestManagerProgressByOrderId, managerRowByOrderId])

  const selectedOrderIdForDetails = useMemo(
    () => String(selectedOrderForDetails?.id ?? '').trim(),
    [selectedOrderForDetails?.id],
  )

  const selectedOrderJobDetails = useMemo(() => {
    if (!selectedOrderIdForDetails) {
      return null
    }

    return orderJobDetailsByOrderId[selectedOrderIdForDetails] ?? null
  }, [orderJobDetailsByOrderId, selectedOrderIdForDetails])

  const selectedOrderOverviewDetails = useMemo(() => {
    const detailsOrder = selectedOrderJobDetails?.order ?? null
    const fallbackOrder = selectedOrderForDetails
    const orderNumber = String(
      detailsOrder?.orderNumber
      ?? detailsOrder?.jobNumber
      ?? fallbackOrder?.id
      ?? '',
    ).trim() || null
    const orderName = String(detailsOrder?.orderName ?? fallbackOrder?.name ?? '').trim() || null
    const poNumber = String(detailsOrder?.poNumber ?? '').trim() || null
    const mondayStatus = String(detailsOrder?.mondayStatus ?? fallbackOrder?.statusLabel ?? '').trim() || null
    const leadTimeRaw = Number(detailsOrder?.leadTimeDays ?? fallbackOrder?.leadTimeDays)
    const leadTimeDays = Number.isFinite(leadTimeRaw) ? leadTimeRaw : null
    const orderDate = String(detailsOrder?.orderDate ?? fallbackOrder?.orderDate ?? '').trim() || null
    const dueDate = String(
      detailsOrder?.dueDate
      ?? fallbackOrder?.effectiveDueDate
      ?? fallbackOrder?.dueDate
      ?? '',
    ).trim() || null
    const shippedAt = String(detailsOrder?.shippedAt ?? fallbackOrder?.shippedAt ?? '').trim() || null
    const paidInFull =
      typeof detailsOrder?.paidInFull === 'boolean'
        ? detailsOrder.paidInFull
        : typeof fallbackOrder?.paidInFull === 'boolean'
          ? fallbackOrder.paidInFull
          : null
    const totalHoursRaw = Number(detailsOrder?.totalHours)
    const summaryHoursRaw = Number(selectedOrderJobDetails?.summary?.totalHours)
    const totalHoursWorked = Number.isFinite(totalHoursRaw)
      ? totalHoursRaw
      : Number.isFinite(summaryHoursRaw)
        ? summaryHoursRaw
        : null
    const totalLaborCostRaw = Number(detailsOrder?.totalLaborCost ?? selectedOrderJobDetails?.summary?.totalLaborCost)
    const totalLaborCost = Number.isFinite(totalLaborCostRaw) ? totalLaborCostRaw : null
    const amountOwedRaw = Number(detailsOrder?.amountOwed ?? fallbackOrder?.amountOwed)
    const amountOwed = Number.isFinite(amountOwedRaw) ? amountOwedRaw : null
    const poAmountRaw = Number(detailsOrder?.poAmount ?? fallbackOrder?.poAmount)
    const poAmount = Number.isFinite(poAmountRaw) ? poAmountRaw : null
    const billedAmountRaw = Number(detailsOrder?.billedAmount)
    const billedAmount = Number.isFinite(billedAmountRaw) ? billedAmountRaw : null
    const invoiceAmountRaw = Number(detailsOrder?.invoiceAmount)
    const invoiceAmount = Number.isFinite(invoiceAmountRaw) ? invoiceAmountRaw : null
    const billBalanceAmountRaw = Number(detailsOrder?.billBalanceAmount)
    const billBalanceAmount = Number.isFinite(billBalanceAmountRaw) ? billBalanceAmountRaw : null
    const progressPercentRaw = Number(detailsOrder?.progressPercent)
    const progressPercent = Number.isFinite(progressPercentRaw) ? progressPercentRaw : null
    const managerReadyPercentRaw = Number(
      detailsOrder?.managerReadyPercent
      ?? selectedOrderJobDetails?.job?.latestManagerReadyPercent,
    )
    const managerReadyPercent = Number.isFinite(managerReadyPercentRaw) ? managerReadyPercentRaw : null
    const quickBooksProjectIds = Array.isArray(detailsOrder?.quickBooksProjectIds)
      ? detailsOrder.quickBooksProjectIds
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
      : []
    const quickBooksProjectNames = Array.isArray(detailsOrder?.quickBooksProjectNames)
      ? detailsOrder.quickBooksProjectNames
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
      : []
    const statusHistory = Array.isArray(detailsOrder?.statusHistory) && detailsOrder.statusHistory.length > 0
      ? detailsOrder.statusHistory
      : Array.isArray(selectedOrderJobDetails?.managerHistory)
        ? selectedOrderJobDetails.managerHistory
        : []

    return {
      orderNumber,
      orderName,
      poNumber,
      mondayStatus,
      leadTimeDays,
      orderDate,
      dueDate,
      shippedAt,
      paidInFull,
      totalHoursWorked,
      totalLaborCost,
      shipTo: String(detailsOrder?.shipTo ?? '').trim() || null,
      shipNotes: String(detailsOrder?.shipNotes ?? '').trim() || null,
      invoiceNumber: String(detailsOrder?.invoiceNumber ?? fallbackOrder?.invoiceNumber ?? '').trim() || null,
      amountOwed,
      poAmount,
      billedAmount,
      invoiceAmount,
      billBalanceAmount,
      notes: String(detailsOrder?.notes ?? '').trim() || null,
      description: String(detailsOrder?.description ?? '').trim() || null,
      bolCachedUrl: String(detailsOrder?.bolCachedUrl ?? '').trim() || null,
      bolUrl: String(detailsOrder?.bolUrl ?? detailsOrder?.bol ?? '').trim() || null,
      drawingCachedUrl: String(detailsOrder?.shopDrawingCachedUrl ?? '').trim() || null,
      drawingUrl: String(detailsOrder?.shopDrawingUrl ?? fallbackOrder?.shopDrawingCachedUrl ?? fallbackOrder?.shopDrawingUrl ?? '').trim() || null,
      cutListCachedUrl: String(detailsOrder?.cutListCachedUrl ?? '').trim() || null,
      cutListUrl: String(detailsOrder?.cutListUrl ?? '').trim() || null,
      rowStatus: String(detailsOrder?.rowStatus ?? '').trim() || null,
      source: String(detailsOrder?.source ?? '').trim() || null,
      progressPercent,
      managerReadyPercent,
      managerReadyDate: String(
        detailsOrder?.managerReadyDate
        ?? selectedOrderJobDetails?.job?.latestManagerReadyDate
        ?? '',
      ).trim() || null,
      managerReadyUpdatedAt: String(
        detailsOrder?.managerReadyUpdatedAt
        ?? selectedOrderJobDetails?.job?.latestManagerReadyUpdatedAt
        ?? '',
      ).trim() || null,
      mondayBoardId: String(
        detailsOrder?.mondayBoardId
        ?? selectedOrderJobDetails?.job?.mondayBoardId
        ?? '',
      ).trim() || null,
      mondayBoardName: String(
        detailsOrder?.mondayBoardName
        ?? selectedOrderJobDetails?.job?.mondayBoardName
        ?? '',
      ).trim() || null,
      mondayItemId: String(
        detailsOrder?.mondayItemId
        ?? selectedOrderJobDetails?.job?.mondayItemId
        ?? fallbackOrder?.id
        ?? '',
      ).trim() || null,
      mondayItemUrl: String(
        detailsOrder?.mondayItemUrl
        ?? selectedOrderJobDetails?.job?.mondayItemUrl
        ?? fallbackOrder?.itemUrl
        ?? '',
      ).trim() || null,
      mondayUpdatedAt: String(
        detailsOrder?.mondayUpdatedAt
        ?? selectedOrderJobDetails?.job?.mondayUpdatedAt
        ?? '',
      ).trim() || null,
      hasMondayRecord:
        typeof detailsOrder?.hasMondayRecord === 'boolean'
          ? detailsOrder.hasMondayRecord
          : null,
      hasQuickBooksRecord:
        typeof detailsOrder?.hasQuickBooksRecord === 'boolean'
          ? detailsOrder.hasQuickBooksRecord
          : null,
      inDesign:
        typeof detailsOrder?.inDesign === 'boolean'
          ? detailsOrder.inDesign
          : null,
      isShipped:
        typeof detailsOrder?.isShipped === 'boolean'
          ? detailsOrder.isShipped
          : Boolean(fallbackOrder?.movedToShippedAt || fallbackOrder?.shippedAt),
      shippedAtInferred:
        typeof detailsOrder?.shippedAtInferred === 'boolean'
          ? detailsOrder.shippedAtInferred
          : null,
      quickBooksProjectId: String(detailsOrder?.quickBooksProjectId ?? '').trim() || null,
      quickBooksProjectName: String(detailsOrder?.quickBooksProjectName ?? '').trim() || null,
      quickBooksProjectIds,
      quickBooksProjectNames,
      hazardReason: String(detailsOrder?.hazardReason ?? '').trim() || null,
      statusHistory,
    }
  }, [selectedOrderForDetails, selectedOrderJobDetails])

  const statusHistoryWorkersByDate = useMemo(() => {
    const groupedByDate = new Map<string, Map<string, number>>()
    const entries = Array.isArray(selectedOrderJobDetails?.entries)
      ? selectedOrderJobDetails.entries
      : []

    entries.forEach((entry) => {
      const normalizedDate = normalizeIsoDate(entry.date) || normalizeIsoDate(entry.date ? `${entry.date}T12:00:00` : '')

      if (!normalizedDate) {
        return
      }

      const workerName = String(entry.workerName ?? '').trim() || t('Unknown worker', 'Trabajador desconocido')
      const totalHours = Number(entry.totalHours)
      const safeHours = Number.isFinite(totalHours) ? totalHours : 0
      const currentWorkerTotals = groupedByDate.get(normalizedDate) ?? new Map<string, number>()

      currentWorkerTotals.set(workerName, (currentWorkerTotals.get(workerName) ?? 0) + safeHours)
      groupedByDate.set(normalizedDate, currentWorkerTotals)
    })

    const normalized = new Map<string, Array<{ workerName: string; totalHours: number }>>()

    groupedByDate.forEach((workerTotals, dateKey) => {
      const rows = Array.from(workerTotals.entries())
        .map(([workerName, totalHours]) => ({ workerName, totalHours }))
        .sort((left, right) => right.totalHours - left.totalHours)

      normalized.set(dateKey, rows)
    })

    return normalized
  }, [selectedOrderJobDetails?.entries, t])

  useEffect(() => {
    setExpandedOrderStatusHistoryRowKey(null)
  }, [selectedOrderIdForDetails])

  useEffect(() => {
    if (!selectedOrderIdForDetails) {
      setIsOrderDetailsLoading(false)
      return
    }

    if (orderJobDetailsByOrderId[selectedOrderIdForDetails]) {
      setIsOrderDetailsLoading(false)
      return
    }

    let isCancelled = false

    setIsOrderDetailsLoading(true)

    void requestWithSession<OrderJobDetailsSnapshot>(
      `/api/orders/job-details?mondayItemId=${encodeURIComponent(selectedOrderIdForDetails)}`,
      false,
    )
      .then((payload) => {
        if (isCancelled) {
          return
        }

        setOrderJobDetailsByOrderId((previous) => ({
          ...previous,
          [selectedOrderIdForDetails]: payload,
        }))
      })
      .catch((error) => {
        if (isCancelled) {
          return
        }

        setOrdersDetailMessage(
          getErrorMessage(
            error,
            'Could not load admin order details.',
            'No se pudieron cargar los detalles admin de la orden.',
          ),
        )
      })
      .finally(() => {
        if (isCancelled) {
          return
        }

        setIsOrderDetailsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [getErrorMessage, orderJobDetailsByOrderId, requestWithSession, selectedOrderIdForDetails])

  const selectedTimesheetDate = useMemo(() => {
    const parsed = new Date(`${timesheetDate.trim()}T12:00:00`)

    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }

    return parsed
  }, [timesheetDate])

  const isTimesheetDateEditable = timesheetDate.trim() === formatDateInput(new Date())

  const handleTimesheetDateChange = useCallback((event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') {
      setIsTimesheetDatePickerOpen(false)
    }

    if (event.type !== 'set' || !value) {
      return
    }

    setTimesheetDate(formatDateInput(value))
  }, [])

  const selectedManagerDate = useMemo(() => {
    const parsed = new Date(`${managerDate.trim()}T12:00:00`)

    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }

    return parsed
  }, [managerDate])

  const handleManagerDateChange = useCallback((event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') {
      setIsManagerDatePickerOpen(false)
    }

    if (event.type !== 'set' || !value) {
      return
    }

    setManagerDate(formatDateInput(value))
    setManagerMessage(null)
  }, [])

  const selectedAdminReportRangeStartDate = useMemo(() => {
    const normalized = normalizeIsoDate(adminReportDateRangeStart)
    const parsed = normalized ? new Date(`${normalized}T12:00:00`) : new Date()

    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }

    return parsed
  }, [adminReportDateRangeStart])

  const selectedAdminReportRangeEndDate = useMemo(() => {
    const normalized = normalizeIsoDate(adminReportDateRangeEnd)
    const parsed = normalized ? new Date(`${normalized}T12:00:00`) : new Date()

    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }

    return parsed
  }, [adminReportDateRangeEnd])

  const isAdminReportDateRangeAscending = selectedAdminReportRangeStartDate.getTime()
    <= selectedAdminReportRangeEndDate.getTime()

  const handleAdminReportDateRangeChange = useCallback((
    target: 'start' | 'end',
    event: DateTimePickerEvent,
    value?: Date,
  ) => {
    if (Platform.OS === 'android') {
      setAdminDatePickerTarget(null)
    }

    if (event.type !== 'set' || !value) {
      return
    }

    const formatted = formatDateInput(value)

    if (target === 'start') {
      setAdminReportDateRangeStart(formatted)
    } else {
      setAdminReportDateRangeEnd(formatted)
    }

    if (Platform.OS !== 'android') {
      setAdminDatePickerTarget(null)
    }
  }, [])

  useEffect(() => {
    if (activeScreen !== 'manager') {
      return
    }

    const nextDraftByJob: Record<string, string> = {}
    const normalizedManagerDate = managerDate.trim()

    managerDayJobs.forEach((jobName) => {
      const key = `${normalizedManagerDate}:${normalizeJobName(jobName)}`
      const progress = managerProgressByDateJobKey.get(key)
      nextDraftByJob[jobName] = progress ? String(progress.readyPercent) : '0'
    })

    setManagerProgressByJob(nextDraftByJob)
  }, [activeScreen, managerDate, managerDayJobs, managerProgressByDateJobKey])

  const handleManagerProgressChange = useCallback((jobName: string, value: string) => {
    setManagerProgressByJob((current) => ({
      ...current,
      [jobName]: value,
    }))
  }, [])

  const handleOpenManagerShopDrawingPreview = useCallback(async (row: {
    mondayOrderId: string | null
    shopDrawingCachedUrl?: string | null
  }) => {
    const cachedPreviewUrl = String(row.shopDrawingCachedUrl ?? '').trim()
    const orderId = String(row.mondayOrderId ?? '').trim()

    if (!cachedPreviewUrl && !orderId) {
      setManagerMessage(
        t(
          'This order is not linked to Monday yet.',
          'Esta orden aun no esta vinculada con Monday.',
        ),
      )
      return
    }

    setManagerMessage(null)

    try {
      if (cachedPreviewUrl) {
        await WebBrowser.openBrowserAsync(cachedPreviewUrl)
        return
      }

      const query = new URLSearchParams({
        orderId,
        inline: '1',
      })
      await WebBrowser.openBrowserAsync(
        `${API_BASE_URL}/api/dashboard/monday/shop-drawing/download?${query.toString()}`,
      )
    } catch (error) {
      setManagerMessage(
        getErrorMessage(
          error,
          'Could not open shop drawing preview.',
          'No se pudo abrir la vista previa del shop drawing.',
        ),
      )
    }
  }, [getErrorMessage, t])

  const closeOrderDetails = useCallback(() => {
    setSelectedOrderForDetails(null)
    setSelectedOrderDetailsView('overview')
    setOrdersDetailMessage(null)

    if (isOrderDetailsFromDashboardMetric) {
      setOrdersSearchQuery('')
      setOrdersPage(1)
      setIsOrderDetailsFromDashboardMetric(false)
    }
  }, [isOrderDetailsFromDashboardMetric])

  const handleOpenOrderDocumentUrl = useCallback(async (
    rawUrl: string | null | undefined,
    missingMessageEnglish: string,
    missingMessageSpanish: string,
    errorMessageEnglish: string,
    errorMessageSpanish: string,
  ) => {
    const targetUrl = String(rawUrl ?? '').trim()

    if (!targetUrl) {
      setOrdersDetailMessage(t(missingMessageEnglish, missingMessageSpanish))
      return
    }

    setOrdersDetailMessage(null)

    try {
      await WebBrowser.openBrowserAsync(targetUrl)
    } catch (error) {
      setOrdersDetailMessage(
        getErrorMessage(
          error,
          errorMessageEnglish,
          errorMessageSpanish,
        ),
      )
    }
  }, [getErrorMessage, t])

  const handleOpenOrderShopDrawing = useCallback(async (
    order: DashboardOrder,
    detailsSnapshot: OrderJobDetailsSnapshot | null,
  ) => {
    const detailsOrder = detailsSnapshot?.order ?? null
    const cachedPreviewUrl = String(detailsOrder?.shopDrawingCachedUrl ?? order.shopDrawingCachedUrl ?? '').trim()
    const orderId = String(detailsOrder?.mondayItemId ?? order.id ?? '').trim()

    if (!cachedPreviewUrl && !orderId) {
      setOrdersDetailMessage(
        t(
          'This order is not linked to Monday yet.',
          'Esta orden aun no esta vinculada con Monday.',
        ),
      )
      return
    }

    setOrdersDetailMessage(null)

    try {
      if (cachedPreviewUrl) {
        await WebBrowser.openBrowserAsync(cachedPreviewUrl)
        return
      }

      const query = new URLSearchParams({
        orderId,
        inline: '1',
      })
      await WebBrowser.openBrowserAsync(
        `${API_BASE_URL}/api/dashboard/monday/shop-drawing/download?${query.toString()}`,
      )
    } catch (error) {
      setOrdersDetailMessage(
        getErrorMessage(
          error,
          'Could not open shop drawing preview.',
          'No se pudo abrir la vista previa del shop drawing.',
        ),
      )
    }
  }, [getErrorMessage, t])

  const handleOpenOrderCutList = useCallback(async (detailsSnapshot: OrderJobDetailsSnapshot | null) => {
    const detailsOrder = detailsSnapshot?.order ?? null
    const cachedUrl = String(detailsOrder?.cutListCachedUrl ?? '').trim()
    const sourceUrl = String(detailsOrder?.cutListUrl ?? '').trim()
    const orderId = String(
      detailsOrder?.mondayItemId
      ?? detailsSnapshot?.job?.mondayItemId
      ?? '',
    ).trim()

    if (!cachedUrl && !sourceUrl && !orderId) {
      setOrdersDetailMessage(
        t(
          'Cut list is not available for this order yet.',
          'La lista de corte aun no esta disponible para esta orden.',
        ),
      )
      return
    }

    setOrdersDetailMessage(null)

    try {
      if (cachedUrl) {
        await WebBrowser.openBrowserAsync(cachedUrl)
        return
      }

      if (orderId) {
        const query = new URLSearchParams({
          orderId,
          resolveOnly: '1',
        })
        const payload = await requestWithSession<{ cachedUrl?: string }>(
          `/api/dashboard/monday/cut-list/download?${query.toString()}`,
        )
        const resolvedUrl = String(payload?.cachedUrl ?? '').trim()

        if (resolvedUrl) {
          await WebBrowser.openBrowserAsync(resolvedUrl)
          return
        }
      }

      if (sourceUrl) {
        await WebBrowser.openBrowserAsync(sourceUrl)
        return
      }

      setOrdersDetailMessage(
        t(
          'Cut list is not available for this order yet.',
          'La lista de corte aun no esta disponible para esta orden.',
        ),
      )
    } catch (error) {
      setOrdersDetailMessage(
        getErrorMessage(
          error,
          'Could not open cut list.',
          'No se pudo abrir la lista de corte.',
        ),
      )
    }
  }, [getErrorMessage, requestWithSession, t])

  const handleSaveManagerProgress = useCallback(async () => {
    if (!hasManagerSheetAccess) {
      setManagerMessage(
        t(
          'Manager access is required.',
          'Se requiere acceso de gerente.',
        ),
      )
      return
    }

    const normalizedDate = managerDate.trim()

    if (!normalizedDate) {
      setManagerMessage(t('Date is required.', 'La fecha es obligatoria.'))
      return
    }

    if (managerDayJobs.length === 0) {
      setManagerMessage(
        t(
          'No orders found for this date.',
          'No se encontraron ordenes para esta fecha.',
        ),
      )
      return
    }

    const invalidJobs: string[] = []

    managerDayJobs.forEach((jobName) => {
      const rawValue = String(managerProgressByJob[jobName] ?? '').trim()
      const readyPercent = Number(rawValue)

      if (!rawValue || !Number.isFinite(readyPercent) || readyPercent < 0 || readyPercent > 100) {
        invalidJobs.push(jobName)
      }
    })

    if (invalidJobs.length > 0) {
      setManagerMessage(
        t(
          `Enter ready % from 0 to 100 for: ${invalidJobs.join(', ')}`,
          `Ingresa listo % de 0 a 100 para: ${invalidJobs.join(', ')}`,
        ),
      )
      return
    }

    setIsManagerSaving(true)
    setManagerMessage(null)

    try {
      await Promise.all(
        managerDayJobs.map((jobName) =>
          requestWithSession<{ progress: MobileManagerOrderProgress }>(
            '/api/timesheet/order-progress',
            false,
            {
              method: 'PUT',
              body: JSON.stringify({
                date: normalizedDate,
                jobName,
                readyPercent: Number(String(managerProgressByJob[jobName] ?? '').trim()),
              }),
            },
          ),
        ),
      )

      await loadManagerSheet()
      setManagerMessage(
        t(
          'Manager progress saved.',
          'Progreso de gerente guardado.',
        ),
      )
    } catch (error) {
      setManagerMessage(
        getErrorMessage(
          error,
          'Could not save manager progress.',
          'No se pudo guardar el progreso de gerente.',
        ),
      )
    } finally {
      setIsManagerSaving(false)
    }
  }, [
    getErrorMessage,
    hasManagerSheetAccess,
    loadManagerSheet,
    managerDate,
    managerDayJobs,
    managerProgressByJob,
    requestWithSession,
    t,
  ])

  const handleTakePicture = useCallback(async () => {
    if (!selectedPictureOrder) {
      setPictureMessage(t('Select an order first.', 'Selecciona una orden primero.'))
      return
    }

    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync()

      if (permissionResult.status !== 'granted') {
        setPictureMessage(
          t(
            'Camera permission is required to take order pictures.',
            'Se requiere permiso de camara para tomar fotos de ordenes.',
          ),
        )
        return
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.68,
        base64: true,
      })

      if (result.canceled || !result.assets?.length) {
        return
      }

      const capturedAsset = result.assets[0]

      if (!capturedAsset.base64) {
        setPictureMessage(
          t(
            'Could not process picture data. Please try again.',
            'No se pudieron procesar los datos de la foto. Intenta de nuevo.',
          ),
        )
        return
      }

      const queuedPicture = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        base64: capturedAsset.base64,
        mimeType: capturedAsset.mimeType || 'image/jpeg',
        previewUri: capturedAsset.uri,
      }

      setPendingPictures((previous) => [...previous, queuedPicture])
      setPictureMessage(
        t(
          `Picture added. ${pendingPictureCount + 1} ready to upload.`,
          `Foto agregada. ${pendingPictureCount + 1} listas para subir.`,
        ),
      )
    } catch {
      setPictureMessage(
        t('Could not capture picture. Try again.', 'No se pudo capturar la foto. Intenta de nuevo.'),
      )
    }
  }, [pendingPictureCount, selectedPictureOrder, t])

  const handleRemovePendingPicture = useCallback((pictureId: string) => {
    setPendingPictures((previous) => previous.filter((picture) => picture.id !== pictureId))
  }, [])

  const handleClearPendingPictures = useCallback(() => {
    if (pendingPictureCount === 0) {
      return
    }

    setPendingPictures([])
    setPictureMessage(t('Pending pictures cleared.', 'Fotos pendientes eliminadas.'))
  }, [pendingPictureCount, t])

  const handleUploadPendingPictures = useCallback(async () => {
    if (!selectedPictureOrder) {
      setPictureMessage(t('Select an order first.', 'Selecciona una orden primero.'))
      return
    }

    if (pendingPictures.length === 0) {
      setPictureMessage(
        t(
          'Take one or more pictures first, then upload.',
          'Primero toma una o mas fotos y luego subelas.',
        ),
      )
      return
    }

    const queuedPictures = pendingPictures
    const uploadErrorMessage = t(
      'Could not upload pictures. Check connection and try again.',
      'No se pudieron subir las fotos. Revisa la conexion e intenta de nuevo.',
    )

    setIsUploadingPicture(true)
    setPictureMessage(
      t(
        `Uploading ${queuedPictures.length} pictures...`,
        `Subiendo ${queuedPictures.length} fotos...`,
      ),
    )

    try {
      const uploadResults = await Promise.allSettled(
        queuedPictures.map((queuedPicture) =>
          requestWithSession<{ photo: OrderPhoto }>(
            `/api/orders/${encodeURIComponent(selectedPictureOrder.id)}/photos`,
            false,
            {
              method: 'POST',
              body: JSON.stringify({
                imageBase64: queuedPicture.base64,
                mimeType: queuedPicture.mimeType,
              }),
            },
          ),
        ),
      )

      const uploadedPhotos: OrderPhoto[] = []
      const failedPictureIds: string[] = []

      uploadResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          uploadedPhotos.push(result.value.photo)
          return
        }

        failedPictureIds.push(queuedPictures[index].id)
      })

      if (uploadedPhotos.length > 0) {
        setOrderPhotosByOrderId((previous) => ({
          ...previous,
          [selectedPictureOrder.id]: [
            ...uploadedPhotos,
            ...(previous[selectedPictureOrder.id] ?? []),
          ],
        }))
      }

      setPendingPictures(queuedPictures.filter((queuedPicture) => failedPictureIds.includes(queuedPicture.id)))

      if (uploadedPhotos.length === queuedPictures.length) {
        setPictureMessage(
          t(
            `Uploaded ${uploadedPhotos.length} pictures for this order.`,
            `Se subieron ${uploadedPhotos.length} fotos para esta orden.`,
          ),
        )
        return
      }

      if (uploadedPhotos.length > 0) {
        setPictureMessage(
          t(
            `Uploaded ${uploadedPhotos.length} of ${queuedPictures.length} pictures. Failed pictures stayed in queue.`,
            `Se subieron ${uploadedPhotos.length} de ${queuedPictures.length} fotos. Las que fallaron quedaron en cola.`,
          ),
        )
        return
      }

      setPictureMessage(
        uploadErrorMessage,
      )
    } catch {
      setPictureMessage(uploadErrorMessage)
    } finally {
      setIsUploadingPicture(false)
    }
  }, [pendingPictures, requestWithSession, selectedPictureOrder, t])

  useEffect(() => {
    if (activeScreen !== 'pictures') {
      setIsPicturesModalOpen(false)
      setPendingPictures([])
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeScreen !== 'orders') {
      setSelectedOrderForDetails(null)
      setSelectedOrderDetailsView('overview')
      setOrdersDetailMessage(null)
      setIsOrderDetailsFromDashboardMetric(false)
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeScreen !== 'chat' && chatViewMode !== 'list') {
      setChatViewMode('list')
    }
  }, [activeScreen, chatViewMode])

  useEffect(() => {
    if (chatViewMode === 'thread' && !selectedChatThread) {
      setChatViewMode('list')
    }
  }, [chatViewMode, selectedChatThread])

  const handleSelectScreen = useCallback((nextScreen: AppScreen) => {
    setActiveScreen(nextScreen)
    setDetailSelection(null)
    clearDashboardMetricZoomTimeout()
    setDashboardMetricZoomOrderId(null)

    if (nextScreen !== 'pictures') {
      closePicturesModal()
    }

    if (nextScreen !== 'orders') {
      setSelectedOrderForDetails(null)
      setSelectedOrderDetailsView('overview')
      setOrdersDetailMessage(null)
      setIsOrderDetailsFromDashboardMetric(false)
    }

    if (nextScreen !== 'settings') {
      closeSettingsMenu()
    }

    if (nextScreen !== 'chat') {
      setChatViewMode('list')
      setChatComposerText('')
      setChatAttachmentDraft(null)
      setChatMessage(null)
      void unloadActiveVoiceSound()
    }

    setIsAccountMenuOpen(false)
  }, [clearDashboardMetricZoomTimeout, closePicturesModal, closeSettingsMenu, unloadActiveVoiceSound])

  const hasGoogleClientId = !isExpoGo && Boolean(GOOGLE_WEB_CLIENT_ID)
  const googleClientIdHint = isExpoGo
    ? t(
        'Google sign-in in this app uses the native SDK and is not available in Expo Go. Use a development or production build.',
        'El inicio de sesion con Google en esta app usa el SDK nativo y no esta disponible en Expo Go. Usa un build de desarrollo o produccion.',
      )
    : t(
        'Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
        'Falta EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
      )

  if (!isAuthResolved) {
    return (
      <AuthShell>
        <Text style={styles.authTitle}>Arnold Mobile</Text>
        <Text style={styles.authSubtitle}>{t('Preparing secure login...', 'Preparando inicio de sesion seguro...')}</Text>
        <ActivityIndicator size="small" color="#7fa2ff" />
      </AuthShell>
    )
  }

  if (!firebaseUser) {
    const isEmailLoginDisabled = isEmailSigningIn || isSigningIn || !emailSignInValue.trim() || !passwordSignInValue

    return (
      <AuthShell>
        <Text style={styles.authTitle}>{t('Sign in to Arnold', 'Inicia sesion en Arnold')}</Text>
        <Text style={styles.authSubtitle}>
          {t(
            'Use email/password, Google, or Apple to access dashboard, support, and pictures from your phone.',
            'Usa correo/contrasena, Google o Apple para acceder al panel, soporte y fotos desde tu telefono.',
          )}
        </Text>

        <TextInput
          value={emailSignInValue}
          onChangeText={setEmailSignInValue}
          placeholder={t('Email', 'Correo')}
          placeholderTextColor="#7f92c4"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.authInput}
        />

        <TextInput
          value={passwordSignInValue}
          onChangeText={setPasswordSignInValue}
          placeholder={t('Password', 'Contrasena')}
          placeholderTextColor="#7f92c4"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.authInput}
        />

        <AuthButton
          label={
            isEmailSigningIn
              ? t('Signing in...', 'Iniciando sesion...')
              : t('Sign in with Email', 'Entrar con correo')
          }
          onPress={() => {
            void handleStartEmailPasswordLogin()
          }}
          disabled={isEmailLoginDisabled}
        />

        <Text style={styles.authDividerText}>{t('or', 'o')}</Text>

        <AuthButton
          label={
            isSigningIn
              ? t('Signing in...', 'Iniciando sesion...')
              : t('Continue with Google', 'Continuar con Google')
          }
          onPress={() => {
            void handleStartGoogleLogin()
          }}
          disabled={isSigningIn || !hasGoogleClientId}
        />

        {Platform.OS === 'ios' ? (
          <AuthButton
            label={
              isSigningIn
                ? t('Signing in...', 'Iniciando sesion...')
                : t('Continue with Apple', 'Continuar con Apple')
            }
            variant="secondary"
            textVariant="secondary"
            onPress={() => {
              void handleStartAppleLogin()
            }}
            disabled={isSigningIn || !isAppleSignInAvailable}
          />
        ) : null}

        {!hasGoogleClientId ? (
          <Text style={styles.authCaption}>
            {googleClientIdHint}
          </Text>
        ) : null}

        {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
      </AuthShell>
    )
  }

  if (!authProfile) {
    return (
      <AuthShell>
        {isCheckingApproval ? (
          <>
            <Text style={styles.authTitle}>{t('Checking Access', 'Verificando acceso')}</Text>
            <Text style={styles.authSubtitle}>{t('Verifying your approval status...', 'Verificando tu estado de aprobacion...')}</Text>
            <ActivityIndicator size="small" color="#7fa2ff" />
            {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
          </>
        ) : (
          <>
            <Text style={styles.authTitle}>{t('Could not verify access', 'No se pudo verificar el acceso')}</Text>
            <Text style={styles.authSubtitle}>
              {authMessage || t('We could not reach the approval service.', 'No se pudo conectar con el servicio de aprobacion.')}
            </Text>

            <AuthButton
              label={t('Retry', 'Reintentar')}
              onPress={() => {
                void syncAuthProfile()
              }}
            />

            <AuthButton
              label={t('Sign out', 'Cerrar sesion')}
              variant="secondary"
              textVariant="secondary"
              onPress={() => {
                void handleSignOut()
              }}
            />
          </>
        )}
      </AuthShell>
    )
  }

  if (!authProfile.isApproved) {
    return (
      <AuthShell>
        <Text style={styles.authTitle}>{t('Approval Pending', 'Aprobacion pendiente')}</Text>
        <Text style={styles.authSubtitle}>
          {t(
            'Your account is waiting for admin approval in the website Admin Users page.',
            'Tu cuenta esta esperando aprobacion del administrador en la pagina Admin Users del sitio web.',
          )}
        </Text>
        {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}

        <AuthButton
          label={t('Refresh Approval Status', 'Actualizar estado de aprobacion')}
          onPress={() => {
            void syncAuthProfile()
          }}
        />

        <AuthButton
          label={t('Sign Out', 'Cerrar sesion')}
          variant="secondary"
          textVariant="primary"
          onPress={() => {
            void handleSignOut()
          }}
        />
      </AuthShell>
    )
  }

  if (isBiometricLocked) {
    return (
      <AuthShell>
        <Text style={styles.authTitle}>{t('Sign in to continue', 'Inicia sesion para continuar')}</Text>
        <Text style={styles.authSubtitle}>
          {t(
            'Use biometrics to unlock quickly, or sign in with Google instead.',
            'Usa biometria para desbloquear rapido, o inicia sesion con Google.',
          )}
        </Text>

        <AuthButton
          label={isAuthenticatingBiometric ? t('Verifying...', 'Verificando...') : t('Use Biometrics', 'Usar biometria')}
          onPress={() => {
            void handleAuthenticateBiometric()
          }}
          disabled={isAuthenticatingBiometric}
        />

        <AuthButton
          label={t('Use Google Instead', 'Usar Google en su lugar')}
          variant="secondary"
          textVariant="secondary"
          onPress={handleUseGoogleSessionUnlock}
          disabled={isSigningIn || !hasGoogleClientId}
        />

        {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
      </AuthShell>
    )
  }

  const usesNestedListScroll = activeScreen === 'pictures' || activeScreen === 'orders' || activeScreen === 'alerts' || activeScreen === 'chat' || activeScreen === 'admin'
  const isRefreshBusy =
    isRefreshing
    || (activeScreen === 'timesheet' && isTimesheetLoading)
    || (activeScreen === 'manager' && (isManagerLoading || isManagerSaving))
    || (activeScreen === 'alerts' && isAlertsLoading)
    || (activeScreen === 'chat' && (isChatLoading || isChatMessagesLoading || isChatSendingMessage || isChatProcessingVoice))
    || (activeScreen === 'settings' && (isCheckingForUpdates || isInstallingUpdate))
  const isChatThreadScreen = activeScreen === 'chat' && chatViewMode === 'thread' && Boolean(selectedChatThread)
  const ScreenContent = isChatThreadScreen ? View : ScrollView

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.shell}>
        <View style={styles.contentPane}>
          <ScreenContent
            {...(isChatThreadScreen
              ? {
                style: [styles.picturesScreenScroll, styles.scrollContent, styles.scrollContentPictures],
              }
              : {
                ref: screenScrollRef,
                style: usesNestedListScroll ? styles.picturesScreenScroll : undefined,
                contentContainerStyle: [
                  styles.scrollContent,
                  usesNestedListScroll ? styles.scrollContentPictures : null,
                ],
                scrollEnabled: !usesNestedListScroll,
              })}
          >
            {!isChatThreadScreen ? (
              <View style={styles.topBarCard}>
              <View style={styles.topBarLeftGroup}>
                {activeScreen !== 'dashboard' ? (
                  <Pressable
                    style={styles.topBarBackButton}
                    onPress={() => handleSelectScreen('dashboard')}
                  >
                    <Ionicons name="chevron-back" size={20} color="#1f3567" />
                  </Pressable>
                ) : null}
                <Text style={styles.topBarSyncText}>{t('Last sync', 'Ultima sincronizacion')} {latestSyncText}</Text>
              </View>

              <View style={styles.topBarRightGroup}>
                <Pressable
                  style={[styles.refreshButton, isRefreshBusy ? styles.buttonDisabled : null]}
                  onPress={() => {
                    handleRefreshActiveScreen()
                  }}
                  disabled={isRefreshBusy}
                >
                  <View style={styles.refreshButtonContent}>
                    <Ionicons
                      name={isRefreshBusy ? 'sync' : 'refresh'}
                      size={16}
                      color="#ffffff"
                    />
                    <Text style={styles.refreshButtonText}>
                      {isRefreshBusy ? t('Refreshing', 'Actualizando') : t('Refresh', 'Actualizar')}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  style={styles.profileAvatarButton}
                  onPress={() => setIsAccountMenuOpen((current) => !current)}
                >
                  {profilePhotoUrl ? (
                    <Image source={{ uri: profilePhotoUrl }} style={styles.profileAvatarImage} resizeMode="contain" />
                  ) : (
                    <View style={styles.profileAvatarFallback}>
                      <Text style={styles.profileAvatarFallbackText}>{profileInitial}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
              </View>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {activeScreen === 'dashboard' && isLoading && !mondaySnapshot && !zendeskSnapshot ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#335ad8" />
                <Text style={styles.loadingText}>{t('Loading dashboard...', 'Cargando panel...')}</Text>
              </View>
            ) : null}

            {activeScreen === 'dashboard' ? (
              <DashboardSection
                dashboardUnreadSummary={dashboardUnreadSummary}
                orderMetrics={orderMetrics}
                ticketMetrics={ticketMetrics}
                t={t}
                onSelectOrderMetric={(key, label) => {
                  setDetailSelection({
                    type: 'order',
                    key,
                    label,
                  })
                }}
                onSelectTicketMetric={(key, label) => {
                  setDetailSelection({
                    type: 'ticket',
                    key,
                    label,
                  })
                }}
              />
            ) : null}

            {activeScreen === 'pictures' ? (
              <PicturesSection
                t={t}
                allOrdersForPictures={allOrdersForPictures}
                filteredOrdersForPictures={filteredOrdersForPictures}
                orderSearchQuery={orderSearchQuery}
                onOrderSearchQueryChange={setOrderSearchQuery}
                picturesCardHeight={picturesCardHeight}
                onOpenPicturesModalForOrder={openPicturesModalForOrder}
              />
            ) : null}

            {activeScreen === 'orders' ? (
              <OrdersSection
                t={t}
                locale={locale}
                allOrders={allOrdersForPictures}
                filteredOrders={paginatedOrdersForList}
                totalMatchingOrders={filteredOrdersForList.length}
                ordersRangeStart={ordersRangeStart}
                ordersRangeEnd={ordersRangeEnd}
                orderSearchQuery={ordersSearchQuery}
                onOrderSearchQueryChange={setOrdersSearchQuery}
                orderViewFilter={ordersViewFilter}
                onOrderViewFilterChange={setOrdersViewFilter}
                showOrderViewTabs={!isStandardUser}
                hidePoNumber={isShopWorker}
                poNumberByOrderId={poNumberByOrderId}
                ordersCardHeight={ordersCardHeight}
                managerInsightsByOrderId={orderManagerInsightsByOrderId}
                ordersPage={ordersPage}
                ordersTotalPages={ordersTotalPages}
                onPreviousOrdersPage={() => {
                  setOrdersPage((current) => Math.max(1, current - 1))
                }}
                onNextOrdersPage={() => {
                  setOrdersPage((current) => Math.min(ordersTotalPages, current + 1))
                }}
                onOpenOrderDetails={(order) => {
                  setSelectedOrderForDetails(order)
                  setSelectedOrderDetailsView('overview')
                  setOrdersDetailMessage(null)
                  setIsOrderDetailsFromDashboardMetric(false)
                }}
              />
            ) : null}

            {activeScreen === 'timesheet' ? (
              <TimesheetSection
                t={t}
                locale={locale}
                timesheetWorker={timesheetWorker}
                timesheetDate={timesheetDate}
                isTimesheetDateEditable={isTimesheetDateEditable}
                onOpenDatePicker={() => setIsTimesheetDatePickerOpen(true)}
                isTimesheetDatePickerOpen={isTimesheetDatePickerOpen}
                selectedTimesheetDate={selectedTimesheetDate}
                onTimesheetDateChange={handleTimesheetDateChange}
                timesheetStages={timesheetStages}
                timesheetStageId={timesheetStageId}
                onTimesheetStageIdChange={setTimesheetStageId}
                timesheetJobNumber={timesheetJobNumber}
                onTimesheetJobNumberChange={setTimesheetJobNumber}
                timesheetHours={timesheetHours}
                onTimesheetHoursChange={setTimesheetHours}
                timesheetNotes={timesheetNotes}
                onTimesheetNotesChange={setTimesheetNotes}
                isTimesheetSaving={isTimesheetSaving}
                onSaveTimesheetEntry={() => {
                  void handleSaveTimesheetEntry()
                }}
                timesheetMessage={timesheetMessage}
                isTimesheetLoading={isTimesheetLoading}
                timesheetEntriesForSelectedDate={timesheetEntriesForSelectedDate}
                timesheetStageNamesById={timesheetStageNamesById}
              />
            ) : null}

            {activeScreen === 'manager' && hasManagerSheetAccess ? (
              <ManagerSheetSection
                t={t}
                locale={locale}
                managerDate={managerDate}
                onOpenManagerDatePicker={() => setIsManagerDatePickerOpen(true)}
                isManagerDatePickerOpen={isManagerDatePickerOpen}
                selectedManagerDate={selectedManagerDate}
                onManagerDateChange={handleManagerDateChange}
                isManagerLoading={isManagerLoading}
                managerRows={managerRows}
                managerMessage={managerMessage}
                isManagerSaving={isManagerSaving}
                onManagerProgressChange={handleManagerProgressChange}
                onSaveManagerProgress={() => {
                  void handleSaveManagerProgress()
                }}
                onOpenManagerShopDrawingPreview={(row) => {
                  void handleOpenManagerShopDrawingPreview(row)
                }}
              />
            ) : null}

            {activeScreen === 'alerts' ? (
              <AlertsSection
                t={t}
                locale={locale}
                alertsCardHeight={alertsCardHeight}
                isAlertsLoading={isAlertsLoading}
                alerts={alerts}
                alertsMessage={alertsMessage}
                showReadAlerts={showReadAlerts}
                onShowReadAlertsChange={setShowReadAlerts}
                onMarkAlertAsRead={(alertItem) => {
                  void markAlertAsRead(alertItem)
                }}
                onMarkAlertAsUnread={(alertItem) => {
                  void markAlertAsUnread(alertItem)
                }}
              />
            ) : null}

            {activeScreen === 'chat' ? (
              <ChatSection
                chatAttachmentDraft={chatAttachmentDraft}
                chatCardHeight={chatCardHeight}
                chatComposerText={chatComposerText}
                chatMessage={chatMessage}
                chatPlayingMessageId={chatPlayingMessageId}
                chatThreadCardHeight={chatThreadCardHeight}
                chatViewMode={chatViewMode}
                currentUserEmail={String(firebaseUser?.email ?? '')}
                currentUserUid={String(firebaseUser?.uid ?? '')}
                isAdminUser={isAdminUser}
                canStartDirectChat={canStartDirectChat}
                availableChatUsers={chatUsers}
                isChatLoading={isChatLoading}
                isChatMessagesLoading={isChatMessagesLoading}
                isChatProcessingVoice={isChatProcessingVoice}
                isChatRecordingVoice={isChatRecordingVoice}
                isChatSendingMessage={isChatSendingMessage}
                locale={locale}
                onBackToList={() => {
                  setChatViewMode('list')
                }}
                onStartChat={(targetUid) => {
                  void handleStartDirectChat(targetUid)
                }}
                onCreateGroup={(name, memberUids) => {
                  void handleCreateGroupChat(name, memberUids)
                }}
                onSetPinned={(threadId, pinned) => {
                  void handleSetChatPinned(threadId, pinned)
                }}
                onDeleteThread={(threadId) => {
                  void handleDeleteChatThread(threadId)
                }}
                onComposerTextChange={setChatComposerText}
                onDeleteMessage={(messageId) => {
                  void handleDeleteChatMessage(messageId)
                }}
                onAttachImage={(source) => {
                  void handleAttachChatImage(source)
                }}
                onRemoveAttachmentDraft={() => {
                  setChatAttachmentDraft(null)
                }}
                onSelectThread={(threadId) => {
                  setChatSelectedThreadId(threadId)
                  setChatMessage(null)
                  setChatViewMode('thread')
                }}
                onSendMessage={(text) => {
                  void handleSendChatMessage(text)
                }}
                onStartVoiceRecording={() => {
                  void handleStartVoiceNoteRecording()
                }}
                onStopVoiceRecording={(sendImmediately) => {
                  void handleStopVoiceNoteRecording(sendImmediately)
                }}
                onToggleVoicePlayback={(messageId, dataUrl) => {
                  void handleToggleVoicePlayback(messageId, dataUrl)
                }}
                resolveChatThreadSubtitle={resolveChatThreadSubtitle}
                resolveChatThreadTitle={resolveChatThreadTitle}
                selectedChatMessages={selectedChatMessages}
                selectedChatThread={selectedChatThread}
                sortedChatThreads={sortedChatThreads}
                t={t}
              />
            ) : null}

            {activeScreen === 'admin' && isAdminUser ? (
              <>
                <Text style={styles.sectionTitle}>{t('Admin', 'Admin')}</Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.adminWorkspaceTabsScroll}
                  contentContainerStyle={styles.adminWorkspaceTabsContent}
                >
                  {ADMIN_PORTAL_PAGES.map((adminPage) => {
                    const isActive = selectedAdminPortalPage.path === adminPage.path

                    return (
                      <Pressable
                        key={adminPage.path}
                        style={[styles.adminWorkspaceTab, isActive ? styles.adminWorkspaceTabActive : null]}
                        onPress={() => {
                          void handleOpenAdminPortalPage(adminPage.path)
                        }}
                      >
                        <Ionicons
                          name={adminPage.icon}
                          size={15}
                          color={isActive ? '#ffffff' : '#365792'}
                        />
                        <Text style={[styles.adminWorkspaceTabText, isActive ? styles.adminWorkspaceTabTextActive : null]}>
                          {t(adminPage.labelEn, adminPage.labelEs)}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>

                <View style={[styles.adminWorkspaceCard, { height: adminWorkspaceHeight }]}> 
                  <View style={styles.adminWorkspaceHeader}>
                    <View style={styles.adminWorkspaceHeaderTextWrap}>
                      <Text style={styles.adminWorkspaceHeaderTitle} numberOfLines={1}>
                        {t(selectedAdminPortalPage.labelEn, selectedAdminPortalPage.labelEs)}
                      </Text>
                      {selectedAdminPortalPage.path !== '/admin/cash' ? (
                        <Text style={styles.adminWorkspaceHeaderMeta} numberOfLines={1}>
                          {t('Direct API + database data in native app UI.', 'Datos directos API + base de datos en UI nativa.')}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.adminWorkspaceHeaderActions}>
                      <Pressable
                        style={[
                          styles.adminWorkspaceHeaderButton,
                          isAdminWorkspaceLoading ? styles.adminWorkspaceHeaderButtonDisabled : null,
                        ]}
                        onPress={handleAdminWorkspaceRefresh}
                        disabled={isAdminWorkspaceLoading}
                      >
                        <Ionicons name="refresh" size={16} color={isAdminWorkspaceLoading ? '#90a3c9' : '#1f3567'} />
                      </Pressable>
                    </View>
                  </View>

                  {isAdminWorkspaceLoading ? (
                    <View style={styles.adminPortalLoadingWrap}>
                      <ActivityIndicator size="small" color="#2b60db" />
                      <Text style={styles.adminPortalLoadingText}>{t('Loading admin data...', 'Cargando datos admin...')}</Text>
                    </View>
                  ) : selectedAdminWorkspaceData ? (
                    <ScrollView
                      style={styles.adminWorkspaceBodyScroll}
                      contentContainerStyle={styles.adminWorkspaceBodyContent}
                      showsVerticalScrollIndicator={false}
                    >
                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminPortalPage.path !== '/admin/reports' && selectedAdminWorkspaceData.note ? (
                        <Text style={styles.adminWorkspaceBodyNote}>{selectedAdminWorkspaceData.note}</Text>
                      ) : null}

                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminPortalPage.path !== '/admin/reports' && selectedAdminWorkspaceData.updatedAt ? (
                        <Text style={styles.adminWorkspaceBodyUpdatedAt}>
                          {t('Updated', 'Actualizado')}: {formatSyncTimestamp(selectedAdminWorkspaceData.updatedAt, locale)}
                        </Text>
                      ) : null}

                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminPortalPage.path !== '/admin/reports' && selectedAdminWorkspaceData.stats.length > 0 ? (
                        <View style={styles.adminWorkspaceStatsWrap}>
                          {selectedAdminWorkspaceData.stats.map((stat) => (
                            <View
                              key={`${stat.id || stat.label}-${stat.value}`}
                              style={styles.adminWorkspaceStatChip}
                            >
                              <Text style={styles.adminWorkspaceStatLabel}>{stat.label}</Text>
                              <Text style={styles.adminWorkspaceStatValue}>{stat.value}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {selectedAdminPortalPage.path === '/admin/users' ? (
                        <View style={styles.adminWorkspaceSectionCard}>
                          <Text style={styles.adminWorkspaceSectionTitle}>{t('User access controls', 'Controles de acceso de usuario')}</Text>

                          {adminUsersForAccess.length === 0 ? (
                            <Text style={styles.adminWorkspaceSectionEmpty}>{t('No users found.', 'No hay usuarios.')}</Text>
                          ) : (
                            adminUsersForAccess.map((user) => {
                              const isSaving = adminUserSavingUid === user.uid
                              const accessModeLabel =
                                user.clientAccessMode === 'web_only'
                                  ? t('Web only', 'Solo web')
                                  : user.clientAccessMode === 'app_only'
                                    ? t('App only', 'Solo app')
                                    : t('Web + App', 'Web + App')

                              return (
                                <View key={`access-${user.uid}`} style={styles.adminWorkspaceRowCard}>
                                  <View style={styles.adminWorkspaceRowHeaderRow}>
                                    <View style={styles.adminWorkspaceRowHeaderTextWrap}>
                                      <Text style={styles.adminWorkspaceRowTitle}>{user.displayName || user.email}</Text>
                                      <Text style={styles.adminWorkspaceRowSubtitle}>{user.email}</Text>
                                    </View>

                                    <Pressable
                                      style={[styles.adminWorkspaceMenuButton, isSaving ? styles.buttonDisabled : null]}
                                      disabled={isSaving}
                                      onPress={() => {
                                        setAdminAccessMenuUserUid(user.uid)
                                      }}
                                    >
                                      <Ionicons name="ellipsis-horizontal" size={18} color="#23457f" />
                                    </Pressable>
                                  </View>

                                  <Text style={styles.adminWorkspaceUserMeta}>
                                    {`${t('Role', 'Rol')}: ${normalizeTextValue(user.role).toUpperCase()} - ${user.isApproved ? t('Approved', 'Aprobado') : t('Pending', 'Pendiente')}`}
                                  </Text>
                                  <Text style={styles.adminWorkspaceUserMeta}>
                                    {`${t('Access mode', 'Modo acceso')}: ${accessModeLabel} - ${t('Last login', 'Ultimo acceso')}: ${formatSyncTimestamp(user.lastLoginAt, locale)}`}
                                  </Text>

                                  <Pressable
                                    style={[
                                      styles.adminWorkspaceApprovalButton,
                                      user.isApproved ? styles.adminWorkspaceApprovalButtonDanger : null,
                                      isSaving ? styles.buttonDisabled : null,
                                    ]}
                                    disabled={isSaving}
                                    onPress={() => {
                                      void handleToggleAdminUserApproval(user)
                                    }}
                                  >
                                    <Text style={styles.adminWorkspaceApprovalButtonText}>
                                      {isSaving
                                        ? t('Saving...', 'Guardando...')
                                        : user.isApproved
                                          ? t('Remove access', 'Quitar acceso')
                                          : t('Grant access', 'Dar acceso')}
                                    </Text>
                                  </Pressable>
                                </View>
                              )
                            })
                          )}
                        </View>
                      ) : null}

                      {selectedAdminPortalPage.path === '/admin/reports' ? (
                        <View style={styles.adminWorkspaceSectionCard}>
                          <View style={styles.adminWorkspaceReportsWarningBox}>
                            <Text style={styles.adminWorkspaceReportsWarningText}>The reports are not yet accurate.</Text>
                          </View>

                          <View style={styles.adminWorkspaceReportOptionGrid}>
                            <Pressable
                              style={[
                                styles.adminWorkspaceReportOptionButton,
                                styles.adminWorkspaceReportOptionTile,
                                { backgroundColor: '#fbfefc' },
                              ]}
                              onPress={() => {
                                setAdminReportMonthStatId('summary')
                                setAdminSelectedMonthProjectRowId(null)
                                setAdminExpandedWorkspaceRowId(null)
                                setAdminReportMonthListModalState(null)
                                setAdminReportDetailsModalState(null)
                                setAdminReportWorkerDrilldownModalState(null)
                                setAdminReportsView('month')
                              }}
                            >
                              <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by month', 'Reporte por mes')}</Text>
                            </Pressable>

                            <Pressable
                              style={[
                                styles.adminWorkspaceReportOptionButton,
                                styles.adminWorkspaceReportOptionTile,
                                { backgroundColor: '#fcfbff' },
                              ]}
                              onPress={() => {
                                setAdminExpandedWorkspaceRowId(null)
                                setAdminReportMonthListModalState(null)
                                setAdminReportDetailsModalState(null)
                                setAdminReportWorkerDrilldownModalState(null)
                                setAdminReportsView('job')
                              }}
                            >
                              <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by job', 'Reporte por trabajo')}</Text>
                            </Pressable>

                            <Pressable
                              style={[
                                styles.adminWorkspaceReportOptionButton,
                                styles.adminWorkspaceReportOptionTile,
                                { backgroundColor: '#f9fcff' },
                              ]}
                              onPress={() => {
                                setAdminExpandedWorkspaceRowId(null)
                                setAdminReportMonthListModalState(null)
                                setAdminReportDetailsModalState(null)
                                setAdminReportWorkerDrilldownModalState(null)
                                setAdminReportsView('worker')
                              }}
                            >
                              <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by worker', 'Reporte por trabajador')}</Text>
                            </Pressable>

                            <Pressable
                              style={[
                                styles.adminWorkspaceReportOptionButton,
                                styles.adminWorkspaceReportOptionTile,
                                { backgroundColor: '#fffef9' },
                              ]}
                              onPress={() => {
                                setAdminExpandedWorkspaceRowId(null)
                                setAdminReportMonthListModalState(null)
                                setAdminReportDetailsModalState(null)
                                setAdminReportWorkerDrilldownModalState(null)
                                setAdminReportsView('date')
                              }}
                            >
                              <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by date', 'Reporte por fecha')}</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}

                      {selectedAdminPortalPage.path !== '/admin/reports' ? visibleAdminSections.map((section) => (
                        <View key={section.id} style={styles.adminWorkspaceSectionCard}>
                          <Text style={styles.adminWorkspaceSectionTitle}>{section.title}</Text>

                          {section.rows.length === 0 ? (
                            <Text style={styles.adminWorkspaceSectionEmpty}>{section.emptyText}</Text>
                          ) : (
                            section.rows.map((row) => (
                              <Pressable
                                key={`${section.id}-${row.id}`}
                                style={styles.adminWorkspaceRowCard}
                                onPress={() => {
                                  const rowKey = `${section.id}-${row.id}`
                                  const canExpand = Array.isArray(row.details) && row.details.length > 0
                                  const isCashPage = selectedAdminPortalPage.path === '/admin/cash'

                                  if (!canExpand) {
                                    return
                                  }

                                  if (isCashPage) {
                                    setAdminCashAccountModalRow(row)
                                    return
                                  }

                                  setAdminExpandedWorkspaceRowId((current) => (current === rowKey ? null : rowKey))
                                }}
                              >
                                <Text style={styles.adminWorkspaceRowTitle}>{row.title}</Text>
                                <Text style={styles.adminWorkspaceRowSubtitle}>{row.subtitle}</Text>
                                {row.meta ? <Text style={styles.adminWorkspaceRowMeta}>{row.meta}</Text> : null}

                                {Array.isArray(row.metrics) && row.metrics.length > 0 ? (
                                  <View style={styles.adminWorkspaceRowMetricsWrap}>
                                    {row.metrics.map((metric) => (
                                      <View key={`${row.id}-${metric.label}`} style={styles.adminWorkspaceRowMetricChip}>
                                        <Text style={styles.adminWorkspaceRowMetricLabel}>{metric.label}</Text>
                                        <Text style={styles.adminWorkspaceRowMetricValue}>{metric.value}</Text>
                                      </View>
                                    ))}
                                  </View>
                                ) : null}

                                {Array.isArray(row.details) && row.details.length > 0 ? (
                                  <>
                                    <Text style={styles.adminWorkspaceRowExpandHint}>
                                      {selectedAdminPortalPage.path === '/admin/cash'
                                        ? t('Open details', 'Abrir detalles')
                                        : adminExpandedWorkspaceRowId === `${section.id}-${row.id}`
                                          ? t('Hide details', 'Ocultar detalles')
                                          : t('Open details', 'Abrir detalles')}
                                    </Text>

                                    {selectedAdminPortalPage.path !== '/admin/cash'
                                      && adminExpandedWorkspaceRowId === `${section.id}-${row.id}`
                                      ? row.details.map((detailLine, detailIndex) => (
                                        <Text key={`${row.id}-detail-${detailIndex}`} style={styles.adminWorkspaceRowDetailLine}>
                                          {detailLine}
                                        </Text>
                                      ))
                                      : null}
                                  </>
                                ) : null}
                              </Pressable>
                            ))
                          )}
                        </View>
                      )) : null}
                    </ScrollView>
                  ) : (
                    <View style={styles.adminWorkspaceEmptyWrap}>
                      <Text style={styles.adminWorkspaceEmptyText}>
                        {t('Select an admin page from the bars above.', 'Selecciona una pagina admin desde las barras de arriba.')}
                      </Text>
                    </View>
                  )}
                </View>

                {adminPortalMessage ? <Text style={styles.settingsInlineStatus}>{adminPortalMessage}</Text> : null}
              </>
            ) : null}

            {activeScreen === 'settings' ? (
              <SettingsOverviewSection
                settingsMenuItems={settingsMenuItems}
                onSelectSettingsMenu={setActiveSettingsMenuId}
              />
            ) : null}
          </ScreenContent>
        </View>

        {!isChatThreadScreen ? (
          <View style={styles.bottomNavBar}>
            {bottomNavItems.map((item) => {
              const isActive = activeScreen === item.id
              const iconColor = isActive ? '#0c3f8f' : '#4e5f79'

              return (
                <Pressable
                  key={item.id}
                  style={[styles.bottomNavItem, isActive ? styles.bottomNavItemActive : null]}
                  onPress={() => handleSelectScreen(item.id)}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={iconColor}
                  />
                  <Text style={[styles.bottomNavLabel, isActive ? styles.bottomNavLabelActive : null]}>
                    {item.label}
                  </Text>
                  {item.id === 'alerts' && alertsUnreadCount > 0 ? (
                    <View style={styles.bottomNavBadge}>
                      <Text style={styles.bottomNavBadgeText}>
                        {alertsUnreadCount > 99 ? '99+' : String(alertsUnreadCount)}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        ) : null}

        <Modal
          visible={Boolean(detailSelection)}
          transparent
          animationType="fade"
          onRequestClose={() => setDetailSelection(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{detailSelection?.label ?? t('Details', 'Detalles')}</Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => setDetailSelection(null)}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {detailSelection?.type === 'order' ? (
                  detailOrders.length > 0 ? (
                    detailOrders.map((order) => (
                      <Pressable
                        key={`${order.id}-${order.name}`}
                        style={({ pressed }) => [
                          styles.detailRow,
                          dashboardMetricZoomOrderId === order.id ? styles.detailRowZoomed : null,
                          pressed ? styles.detailRowPressed : null,
                        ]}
                        onPress={() => {
                          handleToggleDashboardMetricOrderZoom(order.id)
                        }}
                      >
                        <Text style={styles.detailPrimary} numberOfLines={1}>
                          {order.name || `Order ${order.id}`}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {t('Order', 'Orden')} #{order.id} • {order.groupTitle || t('No group', 'Sin grupo')}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {order.statusLabel || t('No status', 'Sin estado')} • {t('Due', 'Vence')} {formatDisplayDate(order.effectiveDueDate, locale)}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {t('Tap to highlight, then Open', 'Toca para resaltar y luego Abrir')}
                        </Text>
                        {dashboardMetricZoomOrderId === order.id ? (
                          <Pressable
                            style={styles.detailOpenButton}
                            onPress={() => {
                              handleOpenDashboardOrderFromMetrics(order)
                            }}
                          >
                            <Text style={styles.detailOpenButtonText}>{t('Open', 'Abrir')}</Text>
                          </Pressable>
                        ) : null}
                      </Pressable>
                    ))
                  ) : (
                    <Text style={styles.emptyDetailText}>{t('No orders in this section.', 'No hay ordenes en esta seccion.')}</Text>
                  )
                ) : detailTickets.length > 0 ? (
                  detailTickets.map((ticket) => (
                    <View key={String(ticket.id)} style={styles.detailRow}>
                      <Text style={styles.detailPrimary} numberOfLines={1}>
                        {t('Ticket', 'Ticket')} #{ticket.id} • {ticket.assigneeName || t('Unassigned', 'Sin asignar')}
                      </Text>
                      <Text style={styles.detailSecondary} numberOfLines={2}>
                        {ticket.subject || t('No subject', 'Sin asunto')}
                      </Text>
                      {ticket.orderNumber ? (
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {t('Order', 'Orden')} #{ticket.orderNumber}
                        </Text>
                      ) : null}
                    </View>
                  ))
                ) : (
                    <Text style={styles.emptyDetailText}>{t('No tickets in this section.', 'No hay tickets en esta seccion.')}</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={isAdminReportsDetailModalOpen}
          transparent={false}
          animationType="slide"
          onRequestClose={() => {
            if (adminReportWorkerDrilldownModalState) {
              setAdminReportWorkerDrilldownModalState(null)
              return
            }

            if (adminReportDetailsModalState) {
              setAdminReportDetailsModalState(null)
              setAdminReportWorkerDrilldownModalState(null)
              return
            }

            if (adminReportsView === 'month' && adminSelectedMonthProjectRowId) {
              setAdminSelectedMonthProjectRowId(null)
              setAdminExpandedWorkspaceRowId(null)
              setAdminReportMonthListModalState(null)
              setAdminReportDetailsModalState(null)
              setAdminReportWorkerDrilldownModalState(null)
              return
            }

            if (adminReportsView === 'month' && adminReportMonthListModalState) {
              setAdminReportMonthListModalState(null)
              setAdminReportMonthStatId('summary')
              setAdminExpandedWorkspaceRowId(null)
              setAdminReportDetailsModalState(null)
              setAdminReportWorkerDrilldownModalState(null)
              return
            }

            if (adminReportsView === 'month' && adminReportMonthStatId !== 'summary') {
              setAdminReportMonthStatId('summary')
              setAdminExpandedWorkspaceRowId(null)
              setAdminReportMonthListModalState(null)
              setAdminReportDetailsModalState(null)
              setAdminReportWorkerDrilldownModalState(null)
              return
            }

            setAdminReportMonthListModalState(null)
            setAdminReportDetailsModalState(null)
            setAdminReportWorkerDrilldownModalState(null)
            setAdminReportsView('menu')
          }}
        >
          <SafeAreaView style={styles.orderDetailScreen} edges={['top']}>
            <View style={styles.orderDetailScreenHeader}>
              <Pressable
                style={styles.orderDetailScreenBackButton}
                onPress={() => {
                  if (adminReportWorkerDrilldownModalState) {
                    setAdminReportWorkerDrilldownModalState(null)
                    return
                  }

                  if (adminReportDetailsModalState) {
                    setAdminReportDetailsModalState(null)
                    setAdminReportWorkerDrilldownModalState(null)
                    return
                  }

                  if (adminReportsView === 'month' && adminSelectedMonthProjectRowId) {
                    setAdminSelectedMonthProjectRowId(null)
                    setAdminExpandedWorkspaceRowId(null)
                    setAdminReportMonthListModalState(null)
                    setAdminReportDetailsModalState(null)
                    setAdminReportWorkerDrilldownModalState(null)
                    return
                  }

                  if (adminReportsView === 'month' && adminReportMonthListModalState) {
                    setAdminReportMonthListModalState(null)
                    setAdminReportMonthStatId('summary')
                    setAdminExpandedWorkspaceRowId(null)
                    setAdminReportDetailsModalState(null)
                    setAdminReportWorkerDrilldownModalState(null)
                    return
                  }

                  if (adminReportsView === 'month' && adminReportMonthStatId !== 'summary') {
                    setAdminReportMonthStatId('summary')
                    setAdminExpandedWorkspaceRowId(null)
                    setAdminReportMonthListModalState(null)
                    setAdminReportDetailsModalState(null)
                    setAdminReportWorkerDrilldownModalState(null)
                    return
                  }

                  setAdminReportMonthListModalState(null)
                  setAdminReportDetailsModalState(null)
                  setAdminReportWorkerDrilldownModalState(null)
                  setAdminReportsView('menu')
                }}
              >
                <Ionicons name="chevron-back" size={20} color="#1f3567" />
              </Pressable>

              <View style={styles.orderDetailScreenHeaderTextWrap}>
                <Text style={styles.orderDetailScreenHeaderTitle} numberOfLines={1}>
                  {adminReportsView === 'month' && adminSelectedMonthProjectRowId
                    ? (selectedAdminMonthProjectProfitRow?.title || t('Project order details', 'Detalles de orden del proyecto'))
                    : adminReportsView === 'worker'
                    ? t('Report by worker', 'Reporte por trabajador')
                    : adminReportsView === 'month'
                      ? t('Report by month', 'Reporte por mes')
                      : adminReportsView === 'job'
                        ? t('Report by job', 'Reporte por trabajo')
                        : t('Report by date', 'Reporte por fecha')}
                </Text>
                <Text style={styles.orderDetailScreenHeaderMeta} numberOfLines={1}>
                  {adminReportsView === 'month' && adminSelectedMonthProjectRowId
                    ? t('Project profit details', 'Detalles de ganancia del proyecto')
                    : t('Full report page', 'Pagina completa de reporte')}
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.orderDetailScreenScroll}
              contentContainerStyle={styles.orderDetailScreenContent}
            >
              {adminReportsView === 'month' ? (
                <>
                  <View
                    style={[
                      styles.adminWorkspaceMonthViewWrap,
                      { minHeight: Math.max(260, adminWorkspaceHeight - 176) },
                    ]}
                  >
                    <View style={styles.adminWorkspaceMonthSummaryGrid}>
                      {adminReportMonthSummaryCards.map((card) => (
                        <Pressable
                          key={card.id}
                          style={[
                            styles.adminWorkspaceMonthSummaryCard,
                            adminReportMonthStatId === card.id ? styles.adminWorkspaceMonthSummaryCardActive : null,
                          ]}
                          onPress={() => {
                            const sectionForCard = adminReportMonthSectionsByCardId[card.id]

                            if (!sectionForCard) {
                              return
                            }

                            setAdminReportMonthStatId(card.id)
                            setAdminSelectedMonthProjectRowId(null)
                            setAdminExpandedWorkspaceRowId(null)
                            setAdminReportDetailsModalState(null)
                            setAdminReportWorkerDrilldownModalState(null)
                            setAdminReportMonthListModalState({
                              statId: card.id,
                              title: card.label,
                              section: sectionForCard,
                            })
                          }}
                        >
                          <Text style={styles.adminWorkspaceMonthSummaryLabel}>{card.label}</Text>
                          <Text style={styles.adminWorkspaceMonthSummaryValue}>{card.value}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {adminReportMonthStatId === 'summary' ? (
                      <Text style={styles.adminWorkspaceSectionEmpty}>
                        {t('Select one of the month summary cards to open its report list.', 'Selecciona una tarjeta del resumen mensual para abrir su lista de reporte.')}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}

              {adminReportsView === 'worker' ? (
                <>
                  <TextInput
                    value={adminReportWorkerSearch}
                    onChangeText={setAdminReportWorkerSearch}
                    placeholder={t('Search worker or select overall.', 'Buscar trabajador o ver resumen.')}
                    placeholderTextColor="#6a7ea8"
                    style={styles.adminWorkspaceFilterInput}
                  />

                  <View style={styles.adminWorkspaceMiniStatCard}>
                    <Text style={styles.adminWorkspaceMiniStatTitle}>{t('Overall workers', 'Resumen de trabajadores')}</Text>
                    <Text style={styles.adminWorkspaceMiniStatText}>
                      {`${t('Workers', 'Trabajadores')}: ${adminReportWorkerRows.length}`}
                    </Text>
                  </View>

                  {selectedAdminWorkerReportRow ? (
                    <View style={styles.adminWorkspaceMiniStatCard}>
                      <Text style={styles.adminWorkspaceMiniStatTitle}>{selectedAdminWorkerReportRow.title}</Text>
                      <Text style={styles.adminWorkspaceMiniStatText}>{selectedAdminWorkerReportRow.subtitle}</Text>
                      {selectedAdminWorkerReportRow.meta ? (
                        <Text style={styles.adminWorkspaceMiniStatText}>{selectedAdminWorkerReportRow.meta}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}

              {adminReportsView === 'job' ? (
                <TextInput
                  value={adminReportJobSearch}
                  onChangeText={setAdminReportJobSearch}
                  placeholder={t('Search by job #, profit, or labor.', 'Buscar por trabajo #, ganancia o labor.')}
                  placeholderTextColor="#6a7ea8"
                  style={styles.adminWorkspaceFilterInput}
                />
              ) : null}

              {adminReportsView === 'date' ? (
                <View style={styles.adminWorkspaceDateRangeWrap}>
                  <View style={styles.adminWorkspaceDateRangeRow}>
                    <View style={styles.adminWorkspaceDateRangeField}>
                      <Text style={styles.adminWorkspaceDateRangeLabel}>{t('From', 'Desde')}</Text>
                      <Pressable
                        style={styles.adminWorkspaceDateFilterInput}
                        onPress={() => setAdminDatePickerTarget('start')}
                      >
                        <Text style={styles.adminWorkspaceDateFilterValue}>
                          {adminReportDateRangeStart || 'YYYY-MM-DD'}
                        </Text>
                        <Ionicons name="calendar-outline" size={16} color="#315489" />
                      </Pressable>
                    </View>

                    <View style={styles.adminWorkspaceDateRangeField}>
                      <Text style={styles.adminWorkspaceDateRangeLabel}>{t('To', 'Hasta')}</Text>
                      <Pressable
                        style={styles.adminWorkspaceDateFilterInput}
                        onPress={() => setAdminDatePickerTarget('end')}
                      >
                        <Text style={styles.adminWorkspaceDateFilterValue}>
                          {adminReportDateRangeEnd || 'YYYY-MM-DD'}
                        </Text>
                        <Ionicons name="calendar-outline" size={16} color="#315489" />
                      </Pressable>
                    </View>
                  </View>

                  {adminDatePickerTarget === 'start' ? (
                    <DateTimePicker
                      value={selectedAdminReportRangeStartDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                      maximumDate={isAdminReportDateRangeAscending ? selectedAdminReportRangeEndDate : undefined}
                      onChange={(event, value) => {
                        handleAdminReportDateRangeChange('start', event, value)
                      }}
                    />
                  ) : null}

                  {adminDatePickerTarget === 'end' ? (
                    <DateTimePicker
                      value={selectedAdminReportRangeEndDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                      minimumDate={isAdminReportDateRangeAscending ? selectedAdminReportRangeStartDate : undefined}
                      onChange={(event, value) => {
                        handleAdminReportDateRangeChange('end', event, value)
                      }}
                    />
                  ) : null}

                  <Text style={styles.adminWorkspaceDateRangeHint}>
                    {t('Filter reports by custom date range.', 'Filtra reportes por rango de fechas personalizado.')}
                  </Text>
                </View>
              ) : null}

              {visibleAdminSections.map((section) => (
                <View key={`report-modal-${section.id}`} style={styles.adminWorkspaceSectionCard}>
                  <Text style={styles.adminWorkspaceSectionTitle}>{section.title}</Text>

                  {section.rows.length === 0 ? (
                    <Text style={styles.adminWorkspaceSectionEmpty}>{section.emptyText}</Text>
                  ) : (
                    section.rows.map((row) => (
                      <Pressable
                        key={`report-modal-${section.id}-${row.id}`}
                        style={styles.adminWorkspaceRowCard}
                        onPress={() => {
                          const canOpenDetails = (Array.isArray(row.details) && row.details.length > 0)
                            || (Array.isArray(row.workerDetails) && row.workerDetails.length > 0)
                          const isWorkerReportRow = section.id === 'report_worker'

                          if (isWorkerReportRow) {
                            setAdminSelectedWorkerReportRowId(row.id)
                          }

                          if (!canOpenDetails) {
                            return
                          }

                          setAdminReportDetailsModalState({
                            sectionTitle: section.title,
                            row,
                          })
                          setAdminReportWorkerDrilldownModalState(null)
                        }}
                      >
                        <Text
                          style={[
                            styles.adminWorkspaceRowTitle,
                            section.id === 'report_job' ? styles.adminWorkspaceRowTitleLarge : null,
                          ]}
                        >
                          {row.title}
                        </Text>
                        <Text style={styles.adminWorkspaceRowSubtitle}>{row.subtitle}</Text>
                        {row.meta ? <Text style={styles.adminWorkspaceRowMeta}>{row.meta}</Text> : null}

                        {Array.isArray(row.metrics) && row.metrics.length > 0 ? (
                          <View style={styles.adminWorkspaceRowMetricsWrap}>
                            {row.metrics.map((metric) => (
                              <View key={`report-modal-${row.id}-${metric.label}`} style={styles.adminWorkspaceRowMetricChip}>
                                <Text style={styles.adminWorkspaceRowMetricLabel}>{metric.label}</Text>
                                <Text style={styles.adminWorkspaceRowMetricValue}>{metric.value}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        {(Array.isArray(row.details) && row.details.length > 0)
                          || (Array.isArray(row.workerDetails) && row.workerDetails.length > 0)
                          ? (
                            <Text style={styles.adminWorkspaceRowExpandHint}>
                              {t('Open details', 'Abrir detalles')}
                            </Text>
                          )
                          : null}
                      </Pressable>
                    ))
                  )}
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>

        <Modal
          visible={Boolean(adminReportMonthListModalState)}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setAdminReportMonthListModalState(null)
            setAdminReportMonthStatId('summary')
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.adminReportDetailsModalCard]}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>
                  {adminReportMonthListModalState?.title || t('Month report details', 'Detalles del reporte mensual')}
                </Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => {
                    setAdminReportMonthListModalState(null)
                    setAdminReportMonthStatId('summary')
                  }}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              {adminReportMonthListModalState ? (
                <Text style={styles.adminReportDetailsSectionText}>{adminReportMonthListModalState.section.title}</Text>
              ) : null}

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {adminReportMonthListModalState ? (
                  adminReportMonthListModalState.section.rows.length === 0 ? (
                    <Text style={styles.adminWorkspaceSectionEmpty}>{adminReportMonthListModalState.section.emptyText}</Text>
                  ) : (
                    adminReportMonthListModalState.section.rows.map((row) => (
                      <Pressable
                        key={`report-month-modal-${adminReportMonthListModalState.statId}-${row.id}`}
                        style={styles.adminWorkspaceRowCard}
                        onPress={() => {
                          const canOpenDetails = (Array.isArray(row.details) && row.details.length > 0)
                            || (Array.isArray(row.workerDetails) && row.workerDetails.length > 0)

                          if (!canOpenDetails) {
                            return
                          }

                          setAdminSelectedMonthProjectRowId(null)
                          setAdminExpandedWorkspaceRowId(null)
                          setAdminReportDetailsModalState({
                            sectionTitle: adminReportMonthListModalState.section.title,
                            row,
                          })
                          setAdminReportWorkerDrilldownModalState(null)
                        }}
                      >
                        <Text style={styles.adminWorkspaceRowTitle}>{row.title}</Text>
                        <Text style={styles.adminWorkspaceRowSubtitle}>{row.subtitle}</Text>
                        {row.meta ? <Text style={styles.adminWorkspaceRowMeta}>{row.meta}</Text> : null}

                        {Array.isArray(row.metrics) && row.metrics.length > 0 ? (
                          <View style={styles.adminWorkspaceRowMetricsWrap}>
                            {row.metrics.map((metric) => (
                              <View key={`report-month-modal-${row.id}-${metric.label}`} style={styles.adminWorkspaceRowMetricChip}>
                                <Text style={styles.adminWorkspaceRowMetricLabel}>{metric.label}</Text>
                                <Text style={styles.adminWorkspaceRowMetricValue}>{metric.value}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        {(Array.isArray(row.details) && row.details.length > 0)
                          || (Array.isArray(row.workerDetails) && row.workerDetails.length > 0)
                          ? (
                            <Text style={styles.adminWorkspaceRowExpandHint}>
                              {t('Open details', 'Abrir detalles')}
                            </Text>
                          )
                          : null}
                      </Pressable>
                    ))
                  )
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(adminReportDetailsModalState)}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setAdminReportDetailsModalState(null)
            setAdminReportWorkerDrilldownModalState(null)
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.adminReportDetailsModalCard]}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>
                  {adminReportDetailsModalState?.row.title || t('Details', 'Detalles')}
                </Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => {
                    setAdminReportDetailsModalState(null)
                    setAdminReportWorkerDrilldownModalState(null)
                  }}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              {adminReportDetailsModalState?.sectionTitle ? (
                <Text style={styles.adminReportDetailsSectionText}>{adminReportDetailsModalState.sectionTitle}</Text>
              ) : null}

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {adminReportDetailsModalState ? (
                  <>
                    <View style={styles.adminWorkspaceMiniStatCard}>
                      <Text style={styles.adminWorkspaceMiniStatTitle}>{adminReportDetailsModalState.row.title}</Text>
                      <Text style={styles.adminWorkspaceMiniStatText}>{adminReportDetailsModalState.row.subtitle}</Text>
                      {adminReportDetailsModalState.row.meta ? (
                        <Text style={styles.adminWorkspaceMiniStatText}>{adminReportDetailsModalState.row.meta}</Text>
                      ) : null}
                    </View>

                    {Array.isArray(adminReportDetailsModalState.row.metrics)
                      && adminReportDetailsModalState.row.metrics.length > 0 ? (
                        <View style={styles.adminWorkspaceRowMetricsWrap}>
                          {adminReportDetailsModalState.row.metrics.map((metric) => (
                            <View key={`report-detail-${adminReportDetailsModalState.row.id}-${metric.label}`} style={styles.adminWorkspaceRowMetricChip}>
                              <Text style={styles.adminWorkspaceRowMetricLabel}>{metric.label}</Text>
                              <Text style={styles.adminWorkspaceRowMetricValue}>{metric.value}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                    {Array.isArray(adminReportDetailsModalState.row.details)
                      && adminReportDetailsModalState.row.details.length > 0
                      ? adminReportDetailsModalState.row.details.map((detailLine, detailIndex) => (
                        <Text key={`report-detail-line-${adminReportDetailsModalState.row.id}-${detailIndex}`} style={styles.adminWorkspaceRowDetailLine}>
                          {detailLine}
                        </Text>
                      ))
                      : null}

                    {Array.isArray(adminReportDetailsModalState.row.workerDetails)
                      && adminReportDetailsModalState.row.workerDetails.length > 0 ? (
                        <View style={styles.adminReportWorkerDetailsWrap}>
                          <Text style={styles.adminWorkspaceMiniStatTitle}>{t('Workers', 'Trabajadores')}</Text>

                          {adminReportDetailsModalState.row.workerDetails.map((workerRow) => (
                            <Pressable
                              key={`report-worker-${adminReportDetailsModalState.row.id}-${workerRow.workerId}`}
                              style={styles.adminReportWorkerDetailsButton}
                              onPress={() => {
                                setAdminReportWorkerDrilldownModalState({
                                  parentRowTitle: adminReportDetailsModalState.row.title,
                                  worker: workerRow,
                                })
                              }}
                            >
                              <Text style={styles.adminReportWorkerDetailsTitle}>{workerRow.workerName}</Text>
                              <Text style={styles.adminReportWorkerDetailsMeta}>
                                {`${t('Hours', 'Horas')}: ${workerRow.totalHours.toFixed(2)} - ${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(workerRow.totalLaborCost, locale)}`}
                              </Text>
                              <Text style={styles.adminWorkspaceRowExpandHint}>{t('Open details', 'Abrir detalles')}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                  </>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(adminReportWorkerDrilldownModalState)}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setAdminReportWorkerDrilldownModalState(null)
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.adminReportDetailsModalCard]}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>
                  {adminReportWorkerDrilldownModalState?.worker.workerName || t('Worker details', 'Detalles del trabajador')}
                </Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => {
                    setAdminReportWorkerDrilldownModalState(null)
                  }}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {adminReportWorkerDrilldownModalState ? (
                  <>
                    <View style={styles.adminWorkspaceMiniStatCard}>
                      <Text style={styles.adminWorkspaceMiniStatTitle}>{adminReportWorkerDrilldownModalState.parentRowTitle}</Text>
                      <Text style={styles.adminWorkspaceMiniStatText}>
                        {`${t('Hours', 'Horas')}: ${adminReportWorkerDrilldownModalState.worker.totalHours.toFixed(2)}`}
                      </Text>
                      <Text style={styles.adminWorkspaceMiniStatText}>
                        {`${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(adminReportWorkerDrilldownModalState.worker.totalLaborCost, locale)}`}
                      </Text>
                    </View>

                    {adminReportWorkerDrilldownModalState.worker.dateEntries.length === 0 ? (
                      <Text style={styles.emptyDetailText}>{t('No rows found for this report.', 'No se encontraron filas para este reporte.')}</Text>
                    ) : (
                      adminReportWorkerDrilldownModalState.worker.dateEntries.map((dateEntry) => (
                        <View key={`worker-date-${adminReportWorkerDrilldownModalState.worker.workerId}-${dateEntry.date}`} style={styles.detailRow}>
                          <Text style={styles.detailPrimary}>{formatDisplayDate(dateEntry.date, locale)}</Text>
                          <Text style={styles.detailSecondary}>{`${t('Hours', 'Horas')}: ${dateEntry.hours.toFixed(2)}`}</Text>
                          <Text style={styles.detailSecondary}>
                            {`${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(dateEntry.laborCost, locale)}`}
                          </Text>
                        </View>
                      ))
                    )}
                  </>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(selectedOrderForDetails)}
          transparent={false}
          animationType="slide"
          onRequestClose={closeOrderDetails}
        >
          <SafeAreaView style={styles.orderDetailScreen} edges={['top']}>
            <View style={styles.orderDetailScreenHeader}>
              <Pressable
                style={styles.orderDetailScreenBackButton}
                onPress={closeOrderDetails}
              >
                <Ionicons name="chevron-back" size={20} color="#1f3567" />
              </Pressable>

              <View style={styles.orderDetailScreenHeaderTextWrap}>
                <Text style={styles.orderDetailScreenHeaderTitle} numberOfLines={1}>
                  {selectedOrderOverviewDetails.orderName
                    || (selectedOrderForDetails
                      ? `${t('Order', 'Orden')} ${selectedOrderForDetails.id}`
                      : t('Order details', 'Detalles de la orden'))}
                </Text>
                <Text style={styles.orderDetailScreenHeaderMeta} numberOfLines={1}>
                  {t('Order', 'Orden')} #{selectedOrderOverviewDetails.orderNumber || selectedOrderForDetails?.id || '-'}
                </Text>
              </View>
            </View>

            {selectedOrderForDetails ? (
              <ScrollView
                style={styles.orderDetailScreenScroll}
                contentContainerStyle={styles.orderDetailScreenContent}
              >
                  <View style={styles.orderDetailSummaryCard}>
                    <Text style={styles.orderDetailSummaryTitle}>
                      {selectedOrderOverviewDetails.orderName || `${t('Order', 'Orden')} ${selectedOrderForDetails.id}`}
                    </Text>
                    <Text style={styles.orderDetailSummaryMeta}>
                      {t('Order', 'Orden')}: #{selectedOrderOverviewDetails.orderNumber || selectedOrderForDetails.id}
                    </Text>
                    {!isShopWorker && selectedOrderOverviewDetails.mondayStatus ? (
                      <Text style={styles.orderDetailSummaryMeta}>
                        {t('Monday status', 'Estado de Monday')}: {selectedOrderOverviewDetails.mondayStatus}
                      </Text>
                    ) : null}
                    {isShopWorker && selectedOrderOverviewDetails.managerReadyPercent !== null ? (
                      <Text style={styles.orderDetailSummaryMeta}>
                        {t('Ready', 'Listo')}: {selectedOrderOverviewDetails.managerReadyPercent}%
                        {selectedOrderOverviewDetails.managerReadyDate
                          ? ` • ${formatDisplayDate(selectedOrderOverviewDetails.managerReadyDate, locale)}`
                          : ''}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.orderDetailTabsRow}>
                    <Pressable
                      style={[
                        styles.orderDetailTabButton,
                        selectedOrderDetailsView !== 'admin' ? styles.orderDetailTabButtonActive : null,
                      ]}
                      onPress={() => setSelectedOrderDetailsView('overview')}
                    >
                      <Text
                        style={[
                          styles.orderDetailTabLabel,
                          selectedOrderDetailsView !== 'admin' ? styles.orderDetailTabLabelActive : null,
                        ]}
                      >
                        {t('Overview', 'Resumen')}
                      </Text>
                    </Pressable>

                    {hasAdminOrderDetailsAccess ? (
                      <Pressable
                        style={[
                          styles.orderDetailTabButton,
                          selectedOrderDetailsView === 'admin' ? styles.orderDetailTabButtonActive : null,
                        ]}
                        onPress={() => setSelectedOrderDetailsView('admin')}
                      >
                        <Text
                          style={[
                            styles.orderDetailTabLabel,
                            selectedOrderDetailsView === 'admin' ? styles.orderDetailTabLabelActive : null,
                          ]}
                        >
                          {t('Admin', 'Admin')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {selectedOrderDetailsView !== 'admin' ? (
                    <>
                      <View style={styles.orderDetailActionsRow}>
                        <Pressable
                          style={[
                            styles.orderDetailActionButton,
                            (!selectedOrderOverviewDetails.drawingCachedUrl
                              && !selectedOrderOverviewDetails.drawingUrl
                              && !selectedOrderForDetails.id)
                              ? styles.orderDetailActionButtonDisabled
                              : null,
                          ]}
                          onPress={() => {
                            void handleOpenOrderShopDrawing(selectedOrderForDetails, selectedOrderJobDetails)
                          }}
                        >
                          <Text style={styles.orderDetailActionButtonText}>
                            {t('Drawing', 'Dibujo')}
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.orderDetailActionButton,
                            (!selectedOrderOverviewDetails.cutListCachedUrl && !selectedOrderOverviewDetails.cutListUrl)
                              ? styles.orderDetailActionButtonDisabled
                              : null,
                          ]}
                          onPress={() => {
                            void handleOpenOrderCutList(selectedOrderJobDetails)
                          }}
                        >
                          <Text style={styles.orderDetailActionButtonText}>
                            {t('Cut List', 'Lista de corte')}
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.orderDetailActionButton,
                            !selectedOrderOverviewDetails.bolCachedUrl
                              ? styles.orderDetailActionButtonDisabled
                              : null,
                          ]}
                          onPress={() => {
                            void handleOpenOrderDocumentUrl(
                              selectedOrderOverviewDetails.bolCachedUrl,
                              'BOL is not cached yet. Tap Refresh to sync it from Monday.',
                              'El BOL aun no esta en cache. Toca Actualizar para sincronizarlo desde Monday.',
                              'Could not open BOL.',
                              'No se pudo abrir el BOL.',
                            )
                          }}
                        >
                          <Text style={styles.orderDetailActionButtonText}>
                            BOL
                          </Text>
                        </Pressable>
                      </View>

                      <View style={styles.orderDetailInfoCard}>
                        <Text style={styles.orderDetailSectionTitle}>{t('Order basics', 'Datos basicos de la orden')}</Text>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Order', 'Orden')}</Text>
                          <Text style={styles.orderDetailInfoValue}>#{selectedOrderOverviewDetails.orderNumber || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Order name', 'Nombre de orden')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.orderName || '-'}</Text>
                        </View>
                        {!isShopWorker ? (
                          <>
                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('P.O. number', 'Numero de P.O.')}</Text>
                              <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.poNumber || '-'}</Text>
                            </View>
                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Monday status', 'Estado de Monday')}</Text>
                              <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.mondayStatus || '-'}</Text>
                            </View>
                          </>
                        ) : null}
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Lead time', 'Lead time')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {formatDisplayDate(selectedOrderOverviewDetails.dueDate, locale)}
                          </Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Order date', 'Fecha de orden')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.orderDate, locale)}</Text>
                        </View>
                      </View>

                      <View style={styles.orderDetailInfoCard}>
                        <Text style={styles.orderDetailSectionTitle}>{t('Progress', 'Progreso')}</Text>
                        {!isShopWorker ? (
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Monday status', 'Estado de Monday')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.mondayStatus || '-'}</Text>
                          </View>
                        ) : null}
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Ready', 'Listo')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {selectedOrderOverviewDetails.managerReadyPercent !== null
                              ? `${selectedOrderOverviewDetails.managerReadyPercent}%`
                              : '-'}
                          </Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Updated', 'Actualizado')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {formatDisplayDate(
                              selectedOrderOverviewDetails.managerReadyDate
                                || selectedOrderOverviewDetails.managerReadyUpdatedAt,
                              locale,
                            )}
                          </Text>
                        </View>
                      </View>

                      {!isShopWorker ? (
                        <View style={styles.orderDetailInfoCard}>
                          <Text style={styles.orderDetailSectionTitle}>{t('Finance', 'Finanzas')}</Text>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Paid in full', 'Pagado completo')}</Text>
                            <Text style={styles.orderDetailInfoValue}>
                              {selectedOrderOverviewDetails.paidInFull === null
                                ? t('Unknown', 'Desconocido')
                                : selectedOrderOverviewDetails.paidInFull
                                  ? t('Yes', 'Si')
                                  : t('No', 'No')}
                            </Text>
                          </View>
                        </View>
                      ) : null}

                      {(selectedOrderOverviewDetails.shippedAt
                        || selectedOrderOverviewDetails.shipTo
                        || selectedOrderOverviewDetails.shipNotes
                        || selectedOrderOverviewDetails.shippedAtInferred !== null) ? (
                        <View style={styles.orderDetailPaidCard}>
                          <Text style={styles.orderDetailSectionTitle}>{t('Shipping', 'Envio')}</Text>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Shipped date', 'Fecha de envio')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.shippedAt, locale)}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Shipped (inferred)', 'Envio inferido')}</Text>
                            <Text style={styles.orderDetailInfoValue}>
                              {selectedOrderOverviewDetails.shippedAtInferred === null
                                ? '-'
                                : selectedOrderOverviewDetails.shippedAtInferred
                                  ? t('Yes', 'Si')
                                  : t('No', 'No')}
                            </Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Ship to', 'Enviar a')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.shipTo || '-'}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Shipping notes', 'Notas de envio')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.shipNotes || '-'}</Text>
                          </View>
                        </View>
                      ) : null}

                      <View style={styles.orderDetailHistoryCard}>
                        <Text style={styles.orderDetailSectionTitle}>{t('Status history', 'Historial de estado')}</Text>
                        {selectedOrderOverviewDetails.statusHistory.length > 0 ? (
                          <ScrollView
                            style={styles.orderDetailHistoryScroll}
                            contentContainerStyle={styles.orderDetailHistoryScrollContent}
                            nestedScrollEnabled
                          >
                            {selectedOrderOverviewDetails.statusHistory.slice(0, 40).map((historyRow, index) => {
                              const historyDateRaw = String(historyRow.date ?? historyRow.updatedAt ?? '').trim()
                              const historyDateKey = normalizeIsoDate(historyDateRaw) || null
                              const rowKey = `${historyRow.id ?? 'history'}-${historyDateKey ?? historyDateRaw ?? 'unknown'}-${index}`
                              const workerRows = historyDateKey
                                ? statusHistoryWorkersByDate.get(historyDateKey) ?? []
                                : []
                              const isExpanded = expandedOrderStatusHistoryRowKey === rowKey

                              return (
                                <Pressable
                                  key={rowKey}
                                  style={styles.orderDetailHistoryRow}
                                  onPress={() => {
                                    setExpandedOrderStatusHistoryRowKey((current) => (current === rowKey ? null : rowKey))
                                  }}
                                >
                                  <View style={styles.orderDetailHistoryHeaderRow}>
                                    <Text style={styles.orderDetailHistoryPrimary}>
                                      {formatDisplayDate(historyRow.date || historyRow.updatedAt, locale)}
                                      {'  '}•{'  '}
                                      {historyRow.readyPercent !== null && historyRow.readyPercent !== undefined
                                        ? `${historyRow.readyPercent}%`
                                        : t('No %', 'Sin %')}
                                    </Text>
                                    {!isShopWorker ? (
                                      <Text style={styles.orderDetailHistoryExpandText}>
                                        {isExpanded
                                          ? t('Hide', 'Ocultar')
                                          : t('Workers', 'Trabajadores')}
                                      </Text>
                                    ) : null}
                                  </View>

                                  <Text style={styles.orderDetailHistorySecondary}>
                                    {historyRow.jobName || selectedOrderOverviewDetails.orderName || t('Order', 'Orden')}
                                  </Text>

                                  {!isShopWorker && isExpanded ? (
                                    <View style={styles.orderDetailHistoryWorkersList}>
                                      {workerRows.length > 0 ? (
                                        workerRows.map((workerRow) => (
                                          <View
                                            key={`${rowKey}-${workerRow.workerName}`}
                                            style={styles.orderDetailHistoryWorkerRow}
                                          >
                                            <Text style={styles.orderDetailHistoryWorkerName} numberOfLines={1}>
                                              {workerRow.workerName}
                                            </Text>
                                            <Text style={styles.orderDetailHistoryWorkerHours} numberOfLines={1}>
                                              {workerRow.totalHours.toFixed(2)}h
                                            </Text>
                                          </View>
                                        ))
                                      ) : (
                                        <Text style={styles.orderDetailHistoryWorkerEmpty}>
                                          {t(
                                            'No worker hour entries for this day.',
                                            'No hay entradas de horas de trabajadores para este dia.',
                                          )}
                                        </Text>
                                      )}
                                    </View>
                                  ) : null}
                                </Pressable>
                              )
                            })}
                          </ScrollView>
                        ) : (
                          <Text style={styles.orderDetailHintText}>
                            {t('No status history found for this order yet.', 'Aun no hay historial de estado para esta orden.')}
                          </Text>
                        )}
                      </View>
                    </>
                  ) : (
                    <>
                      {isOrderDetailsLoading && !selectedOrderJobDetails ? (
                        <InlineLoading label={t('Loading admin order details...', 'Cargando detalles admin de la orden...')} />
                      ) : null}

                      {selectedOrderJobDetails ? (
                        <>
                          <View style={styles.detailRow}>
                            <Text style={styles.detailPrimary}>
                              {selectedOrderJobDetails.job.orderName || selectedOrderForDetails.name || `${t('Order', 'Orden')} ${selectedOrderForDetails.id}`}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Entries', 'Entradas')}: {selectedOrderJobDetails.summary.entryCount}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Workers', 'Trabajadores')}: {selectedOrderJobDetails.summary.workerCount}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Regular hours', 'Horas regulares')}: {selectedOrderJobDetails.summary.totalRegularHours.toFixed(2)}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Overtime hours', 'Horas extra')}: {selectedOrderJobDetails.summary.totalOvertimeHours.toFixed(2)}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Total hours', 'Horas totales')}: {selectedOrderJobDetails.summary.totalHours.toFixed(2)}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Labor cost', 'Costo mano de obra')}: ${selectedOrderJobDetails.summary.totalLaborCost.toFixed(2)}
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Latest manager ready', 'Ultimo avance gerente')}: {selectedOrderJobDetails.job.latestManagerReadyPercent ?? 0}%
                            </Text>
                            <Text style={styles.detailSecondary}>
                              {t('Monday board', 'Tablero de Monday')}: {selectedOrderJobDetails.job.mondayBoardName || '-'}
                            </Text>
                          </View>

                          {selectedOrderJobDetails.workers.length > 0 ? (
                            <View style={styles.orderDetailWorkersCard}>
                              <Text style={styles.orderDetailWorkersTitle}>{t('Worker totals', 'Totales por trabajador')}</Text>
                              {selectedOrderJobDetails.workers.slice(0, 12).map((worker) => (
                                <Text key={`${worker.workerId}-${worker.workerName}`} style={styles.orderDetailWorkerRow}>
                                  {worker.workerName}: {worker.totalHours.toFixed(2)}h
                                </Text>
                              ))}
                            </View>
                          ) : (
                            <Text style={styles.orderDetailHintText}>
                              {t('No worker hour entries found for this order yet.', 'Aun no hay entradas de horas para esta orden.')}
                            </Text>
                          )}

                          <View style={styles.orderDetailWorkersCard}>
                            <Text style={styles.orderDetailWorkersTitle}>{t('Admin finance columns', 'Columnas financieras admin')}</Text>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Purchase orders', 'Ordenes de compra')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.poAmount === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.poAmount, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Bills', 'Facturas recibidas')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.billedAmount === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.billedAmount, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Invoice total', 'Total factura')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.invoiceAmount === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.invoiceAmount, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Bill balance', 'Balance de facturas')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.billBalanceAmount === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.billBalanceAmount, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Amount owed', 'Monto adeudado')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.amountOwed === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.amountOwed, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Labor cost', 'Costo mano de obra')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.totalLaborCost === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(selectedOrderOverviewDetails.totalLaborCost, locale)}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('Total profit', 'Ganancia total')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.invoiceAmount === null
                                  ? '-'
                                  : formatCurrencyAmountPrecise(
                                    selectedOrderOverviewDetails.invoiceAmount
                                      - (selectedOrderOverviewDetails.billedAmount ?? 0)
                                      - (selectedOrderOverviewDetails.totalLaborCost ?? 0),
                                    locale,
                                  )}
                              </Text>
                            </View>

                            <View style={styles.orderDetailInfoRow}>
                              <Text style={styles.orderDetailInfoLabel}>{t('QuickBooks projects', 'Proyectos QuickBooks')}</Text>
                              <Text style={styles.orderDetailInfoValue}>
                                {selectedOrderOverviewDetails.quickBooksProjectNames.length > 0
                                  ? selectedOrderOverviewDetails.quickBooksProjectNames.join(', ')
                                  : selectedOrderOverviewDetails.quickBooksProjectName || '-'}
                              </Text>
                            </View>
                          </View>
                        </>
                      ) : null}

                      {!isOrderDetailsLoading && !selectedOrderJobDetails ? (
                        <Text style={styles.orderDetailHintText}>
                          {t(
                            'Admin details are not available yet for this order.',
                            'Los detalles admin aun no estan disponibles para esta orden.',
                          )}
                        </Text>
                      ) : null}
                    </>
                  )}

                  {ordersDetailMessage ? (
                    <Text style={styles.orderDetailMessage}>{ordersDetailMessage}</Text>
                  ) : null}
              </ScrollView>
            ) : null}
          </SafeAreaView>
        </Modal>

        <Modal
          visible={Boolean(adminCashAccountModalRow)}
          transparent
          animationType="fade"
          onRequestClose={() => setAdminCashAccountModalRow(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.adminCashDetailsModalCard]}>
              <View style={styles.adminCashDetailsSummaryCard}>
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>{adminCashAccountModalRow?.title || t('Cash account', 'Cuenta de caja')}</Text>
                  <Pressable
                    style={styles.detailCloseButton}
                    onPress={() => setAdminCashAccountModalRow(null)}
                  >
                    <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                  </Pressable>
                </View>

                {adminCashAccountModalRow?.subtitle ? (
                  <Text style={styles.adminCashDetailsModalSubtitle}>{adminCashAccountModalRow.subtitle}</Text>
                ) : null}

                {adminCashAccountModalRow?.meta ? (
                  <Text style={styles.adminCashDetailsModalMeta}>{adminCashAccountModalRow.meta}</Text>
                ) : null}
              </View>

              <View style={styles.adminCashDetailsHistoryCard}>
                <View style={styles.adminCashDetailsHistoryHeader}>
                  <Text style={styles.adminCashDetailsHistoryTitle}>{t('History', 'Historial')}</Text>
                  <Text style={styles.adminCashDetailsHistoryHint}>
                    {t('Scroll to view all movements.', 'Desliza para ver todos los movimientos.')}
                  </Text>
                </View>

                <ScrollView
                  style={styles.adminCashDetailsModalScroll}
                  contentContainerStyle={styles.adminCashDetailsModalContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  persistentScrollbar
                >
                  {Array.isArray(adminCashAccountModalRow?.details) && adminCashAccountModalRow.details.length > 0
                    ? adminCashAccountModalRow.details.map((detailLine, detailIndex) => (
                      <Text
                        key={`cash-detail-${detailIndex}`}
                        style={styles.adminCashDetailsModalLine}
                      >
                        {detailLine}
                      </Text>
                    ))
                    : (
                      <Text style={styles.emptyDetailText}>
                        {t('No transaction details found.', 'No se encontraron detalles de movimientos.')}
                      </Text>
                    )}
                </ScrollView>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(activeSettingsMenuId)}
          transparent
          animationType="fade"
          onRequestClose={closeSettingsMenu}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{activeSettingsMenuItem?.title ?? t('Settings', 'Configuracion')}</Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={closeSettingsMenu}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {activeSettingsMenuItem?.subtitle ? (
                  <Text style={styles.settingsSubtitle}>{activeSettingsMenuItem.subtitle}</Text>
                ) : null}

                {activeSettingsMenuId === 'security' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('Biometric Sign-In', 'Inicio biometrico')}</Text>
                    <Text style={styles.settingsSubtitle}>
                      {isBiometricEnabled
                        ? t(
                            'Biometrics are enabled. You will verify on login.',
                            'La biometria esta activada. Verificaras al iniciar sesion.',
                          )
                        : t('Biometrics are currently turned off.', 'La biometria esta desactivada.')}
                    </Text>
                    <Pressable
                      style={styles.settingsToggleButton}
                      onPress={() => {
                        void handleToggleBiometricFromSettings()
                      }}
                    >
                      <Text style={styles.settingsToggleButtonText}>
                        {isBiometricEnabled ? t('Turn Off Biometrics', 'Desactivar biometria') : t('Turn On Biometrics', 'Activar biometria')}
                      </Text>
                    </Pressable>
                  </>
                ) : null}

                {activeSettingsMenuId === 'language' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('Language', 'Idioma')}</Text>
                    <View style={styles.settingsLanguageRow}>
                      <Pressable
                        style={[styles.settingsLanguageButton, language === 'en' ? styles.settingsLanguageButtonActive : null]}
                        onPress={() => {
                          void handleChangeLanguage('en')
                        }}
                      >
                        <Text style={styles.settingsLanguageButtonText}>English</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.settingsLanguageButton, language === 'es' ? styles.settingsLanguageButtonActive : null]}
                        onPress={() => {
                          void handleChangeLanguage('es')
                        }}
                      >
                        <Text style={styles.settingsLanguageButtonText}>Espanol</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.settingsLanguageButton, language === 'he' ? styles.settingsLanguageButtonActive : null]}
                        onPress={() => {
                          void handleChangeLanguage('he')
                        }}
                      >
                        <Text style={styles.settingsLanguageButtonText}>עברית</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}

                {activeSettingsMenuId === 'notifications' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('Push Notifications', 'Notificaciones push')}</Text>
                    <Text style={styles.settingsSubtitle}>
                      {isNotificationsEnabled
                        ? t(
                            'Notifications are enabled for this app session.',
                            'Las notificaciones estan activadas para esta sesion de la app.',
                          )
                        : t(
                            'Notifications are blocked for this app session.',
                            'Las notificaciones estan bloqueadas para esta sesion de la app.',
                          )}
                    </Text>

                    {isNotificationsEnabled ? (
                      <Pressable
                        style={styles.settingsDangerButton}
                        onPress={() => {
                          void handleDisableNotifications()
                        }}
                      >
                        <Text style={styles.settingsDangerButtonText}>
                          {t('Disable Notifications', 'Desactivar notificaciones')}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={styles.settingsToggleButton}
                        onPress={() => {
                          void handleEnableNotifications()
                        }}
                      >
                        <Text style={styles.settingsToggleButtonText}>
                          {t('Enable Notifications', 'Activar notificaciones')}
                        </Text>
                      </Pressable>
                    )}

                    <Pressable
                      style={[styles.settingsToggleButton, styles.settingsToggleButtonSecondary]}
                      onPress={() => {
                        void handleOpenDeviceNotificationSettings()
                      }}
                    >
                      <Text style={styles.settingsToggleButtonText}>
                        {t('Open Device Notification Settings', 'Abrir configuracion de notificaciones del dispositivo')}
                      </Text>
                    </Pressable>

                    {alertsMessage ? <Text style={styles.settingsInlineStatus}>{alertsMessage}</Text> : null}
                  </>
                ) : null}

                {activeSettingsMenuId === 'updates' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('App Updates', 'Actualizaciones de la app')}</Text>

                    <View style={styles.settingsActionsRow}>
                      <Pressable
                        style={[styles.settingsToggleButton, isCheckingForUpdates ? styles.buttonDisabled : null]}
                        disabled={isCheckingForUpdates}
                        onPress={() => {
                          void handleCheckForUpdates()
                        }}
                      >
                        <Text style={styles.settingsToggleButtonText}>
                          {isCheckingForUpdates
                            ? t('Checking...', 'Buscando...')
                            : t('Check for Updates', 'Buscar actualizaciones')}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={[
                          styles.settingsToggleButton,
                          styles.settingsToggleButtonSecondary,
                          (!resolvedUpdateUrl || isInstallingUpdate || isCheckingForUpdates)
                            ? styles.buttonDisabled
                            : null,
                        ]}
                        disabled={!resolvedUpdateUrl || isInstallingUpdate || isCheckingForUpdates}
                        onPress={() => {
                          void handleInstallUpdate()
                        }}
                      >
                        <Text style={styles.settingsToggleButtonText}>
                          {isInstallingUpdate
                            ? t('Installing...', 'Instalando...')
                            : t('Install Update', 'Instalar actualizacion')}
                        </Text>
                      </Pressable>
                    </View>

                    {updateMessage ? <Text style={styles.settingsUpdateMessage}>{updateMessage}</Text> : null}
                  </>
                ) : null}

                {activeSettingsMenuId === 'admin' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('Admin Workspace', 'Area admin')}</Text>
                    <Text style={styles.settingsSubtitle}>
                      {t(
                        'Open each admin page in native app screens backed by direct API/database data.',
                        'Abre cada pagina admin en pantallas nativas con datos directos de API/base de datos.',
                      )}
                    </Text>

                    <View style={styles.settingsAdminGrid}>
                      {ADMIN_PORTAL_PAGES.map((adminPage) => (
                        <Pressable
                          key={adminPage.path}
                          style={styles.settingsAdminBubble}
                          onPress={() => {
                            void handleOpenAdminPortalPage(adminPage.path)
                          }}
                        >
                          <Text style={styles.settingsAdminBubbleText}>{t(adminPage.labelEn, adminPage.labelEs)}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {adminPortalMessage ? <Text style={styles.settingsInlineStatus}>{adminPortalMessage}</Text> : null}
                  </>
                ) : null}

                {activeSettingsMenuId === 'account' ? (
                  <>
                    <Text style={styles.settingsTitle}>{t('Session', 'Sesion')}</Text>
                    <Text style={styles.settingsSubtitle}>
                      {t(
                        'Sign out from this device when you finish your shift.',
                        'Cierra sesion en este dispositivo cuando termines tu turno.',
                      )}
                    </Text>
                    <Pressable
                      style={styles.settingsDangerButton}
                      onPress={() => {
                        void handleSignOut()
                      }}
                    >
                      <Text style={styles.settingsDangerButtonText}>{t('Sign Out', 'Cerrar sesion')}</Text>
                    </Pressable>
                  </>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={isPicturesModalOpen}
          transparent
          animationType="fade"
          onRequestClose={closePicturesModal}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <View style={styles.pictureOrderTextBlock}>
                  <Text style={styles.detailTitle} numberOfLines={1}>
                    {selectedPictureOrder?.name ?? t('Order pictures', 'Fotos de orden')}
                  </Text>
                  <Text style={styles.pictureOrderMeta} numberOfLines={1}>
                    {t('Order', 'Orden')} #{selectedPictureOrder?.id ?? '-'}
                  </Text>
                </View>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={closePicturesModal}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              <View style={styles.pictureModalActionRow}>
                <Pressable
                  style={[
                    styles.takePictureButton,
                    !selectedPictureOrder || isUploadingPicture ? styles.buttonDisabled : null,
                  ]}
                  onPress={() => {
                    void handleTakePicture()
                  }}
                  disabled={!selectedPictureOrder || isUploadingPicture}
                >
                  <Text style={styles.takePictureButtonText}>
                    {t('Take picture', 'Tomar foto')}
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.uploadQueueButton,
                    !selectedPictureOrder || pendingPictureCount === 0 || isUploadingPicture
                      ? styles.buttonDisabled
                      : null,
                  ]}
                  onPress={() => {
                    void handleUploadPendingPictures()
                  }}
                  disabled={!selectedPictureOrder || pendingPictureCount === 0 || isUploadingPicture}
                >
                  <Text style={styles.uploadQueueButtonText}>
                    {isUploadingPicture
                      ? t('Uploading...', 'Subiendo...')
                      : t(`Upload (${pendingPictureCount})`, `Subir (${pendingPictureCount})`)}
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.clearQueueButton,
                    pendingPictureCount === 0 || isUploadingPicture ? styles.buttonDisabled : null,
                  ]}
                  onPress={handleClearPendingPictures}
                  disabled={pendingPictureCount === 0 || isUploadingPicture}
                >
                  <Text style={styles.clearQueueButtonText}>
                    {t('Clear', 'Limpiar')}
                  </Text>
                </Pressable>
              </View>

              {pictureMessage ? <Text style={styles.pictureMessage}>{pictureMessage}</Text> : null}

              <View style={styles.pendingQueueCard}>
                <Text style={styles.pendingQueueTitle}>
                  {t(
                    `Ready to upload (${pendingPictureCount})`,
                    `Listas para subir (${pendingPictureCount})`,
                  )}
                </Text>

                {pendingPictureCount === 0 ? (
                  <Text style={styles.pendingQueueHint}>
                    {t(
                      'Take as many pictures as you want, then tap Upload.',
                      'Toma todas las fotos que quieras y luego toca Subir.',
                    )}
                  </Text>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pendingQueueGrid}
                  >
                    {pendingPictures.map((queuedPicture, index) => (
                      <View key={queuedPicture.id} style={styles.pendingQueueItem}>
                        <Image source={{ uri: queuedPicture.previewUri }} style={styles.pendingQueueImage} />
                        <Pressable
                          style={styles.pendingQueueRemoveButton}
                          onPress={() => {
                            handleRemovePendingPicture(queuedPicture.id)
                          }}
                          disabled={isUploadingPicture}
                        >
                          <Text style={styles.pendingQueueRemoveButtonText}>x</Text>
                        </Pressable>
                        <Text style={styles.pendingQueueItemLabel}>{t('Photo', 'Foto')} {index + 1}</Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {isLoadingOrderPhotos ? (
                  <InlineLoading label={t('Loading saved pictures...', 'Cargando fotos guardadas...')} />
                ) : selectedOrderPhotos.length === 0 ? (
                    <Text style={styles.emptyDetailText}>{t('No pictures saved for this order yet.', 'Aun no hay fotos guardadas para esta orden.')}</Text>
                ) : (
                  <View style={styles.photoGrid}>
                    {selectedOrderPhotos.map((photo, index) => (
                      <View key={`${photo.path}-${index}`} style={styles.photoTile}>
                        <Image source={{ uri: photo.url }} style={styles.photoImage} />
                        <Text style={styles.photoTileCaption}>
                          {formatDisplayDate(photo.createdAt, locale)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={Boolean(selectedAdminAccessMenuUser)}
          transparent
          animationType="fade"
          onRequestClose={() => setAdminAccessMenuUserUid(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, styles.adminAccessModalCard]}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{t('Change access', 'Cambiar acceso')}</Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => setAdminAccessMenuUserUid(null)}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                <Text style={styles.settingsSubtitle}>{selectedAdminAccessMenuUser?.displayName || selectedAdminAccessMenuUser?.email}</Text>
                <Text style={styles.settingsSubtitle}>{selectedAdminAccessMenuUser?.email}</Text>
                <Text style={styles.settingsSubtitle}>{t('Select access mode for this user.', 'Selecciona el modo de acceso para este usuario.')}</Text>
                <Text style={styles.settingsInlineStatus}>
                  {t('Current mode', 'Modo actual')}: {
                    selectedAdminAccessMenuUser?.clientAccessMode === 'web_only'
                      ? t('Web only', 'Solo web')
                      : selectedAdminAccessMenuUser?.clientAccessMode === 'app_only'
                        ? t('App only', 'Solo app')
                        : t('Web + App', 'Web + App')
                  }
                </Text>

                {[
                  { mode: 'web_and_app' as const, label: t('Web + App', 'Web + App') },
                  { mode: 'web_only' as const, label: t('Web only', 'Solo web') },
                  { mode: 'app_only' as const, label: t('App only', 'Solo app') },
                ].map((option) => {
                  const isSaving = adminUserSavingUid === selectedAdminAccessMenuUser?.uid
                  const isCurrent = selectedAdminAccessMenuUser?.clientAccessMode === option.mode

                  return (
                    <Pressable
                      key={`admin-access-option-${option.mode}`}
                      style={[
                        styles.adminWorkspaceAccessOptionButton,
                        isCurrent ? styles.adminWorkspaceAccessOptionButtonActive : null,
                        isSaving ? styles.buttonDisabled : null,
                      ]}
                      disabled={!selectedAdminAccessMenuUser || isSaving || isCurrent}
                      onPress={() => {
                        if (!selectedAdminAccessMenuUser) {
                          return
                        }

                        setAdminAccessMenuUserUid(null)
                        void handleUpdateAdminUserAccess(selectedAdminAccessMenuUser.uid, option.mode)
                      }}
                    >
                      <Text
                        style={[
                          styles.adminWorkspaceAccessOptionText,
                          isCurrent ? styles.adminWorkspaceAccessOptionTextActive : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={isDisableBiometricConfirmOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsDisableBiometricConfirmOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{t('Turn off biometrics?', 'Desactivar biometria?')}</Text>
              <Text style={styles.confirmText}>
                {t(
                  'Are you sure you want to turn off biometric login for this app?',
                  'Seguro que deseas desactivar el inicio biometrico para esta aplicacion?',
                )}
              </Text>

              <View style={styles.confirmActions}>
                <Pressable
                  style={styles.confirmCancelButton}
                  onPress={() => setIsDisableBiometricConfirmOpen(false)}
                >
                  <Text style={styles.confirmCancelButtonText}>{t('Cancel', 'Cancelar')}</Text>
                </Pressable>
                <Pressable
                  style={styles.confirmDangerButton}
                  onPress={() => {
                    void handleConfirmDisableBiometric()
                  }}
                >
                  <Text style={styles.confirmDangerButtonText}>{t('Yes, turn off', 'Si, desactivar')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={isBiometricPromptOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            // Keep prompt visible until user authenticates or skips.
          }}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{t('Use biometrics?', 'Usar biometria?')}</Text>
              <Text style={styles.confirmText}>
                {t(
                  'Verify with Face ID, fingerprint, or device passcode to continue.',
                  'Verifica con Face ID, huella o codigo del dispositivo para continuar.',
                )}
              </Text>
              {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}

              <View style={styles.confirmActions}>
                <Pressable
                  style={styles.confirmCancelButton}
                  onPress={() => {
                    handleSkipBiometricPrompt()
                  }}
                >
                  <Text style={styles.confirmCancelButtonText}>{t('Skip', 'Omitir')}</Text>
                </Pressable>
                <AuthButton
                  label={isAuthenticatingBiometric ? t('Verifying...', 'Verificando...') : t('Use Biometrics', 'Usar biometria')}
                  onPress={() => {
                    void handleAuthenticateBiometric()
                  }}
                  disabled={isAuthenticatingBiometric}
                />
              </View>
            </View>
          </View>
        </Modal>

        {isAccountMenuOpen ? (
          <>
            <Pressable style={styles.accountMenuScrim} onPress={() => setIsAccountMenuOpen(false)} />
            <View style={styles.accountMenuCard}>
              <View style={styles.accountMenuProfileRow}>
                {profilePhotoUrl ? (
                  <Image source={{ uri: profilePhotoUrl }} style={styles.accountMenuProfileImage} />
                ) : (
                  <View style={styles.accountMenuProfileFallback}>
                    <Text style={styles.accountMenuProfileFallbackText}>{profileInitial}</Text>
                  </View>
                )}
                <View style={styles.accountMenuProfileTextWrap}>
                  <Text style={styles.accountMenuProfileName} numberOfLines={1}>{profileDisplayName}</Text>
                  {profileEmail ? (
                    <Text style={styles.accountMenuProfileEmail} numberOfLines={1}>{profileEmail}</Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                style={styles.accountMenuActionButton}
                onPress={() => {
                  setActiveScreen('settings')
                  setActiveSettingsMenuId(null)
                  setIsAccountMenuOpen(false)
                }}
              >
                <Text style={styles.accountMenuActionText}>{t('Settings', 'Configuracion')}</Text>
              </Pressable>

              <Pressable
                style={styles.accountMenuSignOutButton}
                onPress={() => {
                  setIsAccountMenuOpen(false)
                  void handleSignOut()
                }}
              >
                <Text style={styles.accountMenuSignOutText}>{t('Sign Out', 'Cerrar sesion')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
        </View>
      </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}
