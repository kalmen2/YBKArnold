import AsyncStorage from '@react-native-async-storage/async-storage'
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as Google from 'expo-auth-session/providers/google'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import * as ImagePicker from 'expo-image-picker'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import { SafeAreaView } from 'react-native-safe-area-context'
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

WebBrowser.maybeCompleteAuthSession()

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
const MOBILE_ANDROID_PACKAGE = 'com.ybk.arnold'
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? ''
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? ''
const GOOGLE_EXPO_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_IOS_CLIENT_ID ?? ''
const GOOGLE_EXPO_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_ANDROID_CLIENT_ID ?? ''
const GOOGLE_ANDROID_REDIRECT_URI = `${MOBILE_ANDROID_PACKAGE}:/oauthredirect`
const ORDERS_PAGE_SIZE = 30
const ADMIN_PORTAL_PAGES = [
  { path: '/admin/cash', labelEn: 'Cash Accounts', labelEs: 'Cuentas de caja', icon: 'cash-outline' as const },
  { path: '/admin/reports', labelEn: 'Reports', labelEs: 'Reportes', icon: 'bar-chart-outline' as const },
  { path: '/admin/users', labelEn: 'Users', labelEs: 'Usuarios', icon: 'people-outline' as const },
] as const

const HEBREW_TRANSLATIONS: Record<string, string> = {
  Orders: 'הזמנות',
  Pictures: 'תמונות',
  Notifications: 'התראות',
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
type AdminReportsView = 'menu' | 'worker' | 'month'

type AppUpdateStatusResponse = {
  url?: string | null
  build?: number | string | null
  version?: string | null
}

type AdminWorkspaceStat = {
  label: string
  value: string
}

type AdminWorkspaceRow = {
  id: string
  title: string
  subtitle: string
  meta?: string
  details?: string[]
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
type BottomNavScreen = 'orders' | 'pictures' | 'timesheet' | 'manager' | 'alerts' | 'admin'

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
  const resolvedIosClientId = isExpoGo
    ? GOOGLE_EXPO_IOS_CLIENT_ID || 'missing-expo-ios-client-id'
    : GOOGLE_IOS_CLIENT_ID || GOOGLE_WEB_CLIENT_ID || 'missing-ios-client-id'
  const resolvedAndroidClientId = isExpoGo
    ? GOOGLE_EXPO_ANDROID_CLIENT_ID || 'missing-expo-android-client-id'
    : GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID || 'missing-android-client-id'

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

  const [googleRequest, googleResponse, promptGoogleSignIn] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    iosClientId: resolvedIosClientId,
    androidClientId: resolvedAndroidClientId,
    redirectUri: Platform.OS === 'android' ? GOOGLE_ANDROID_REDIRECT_URI : undefined,
  })

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
        { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
        { id: 'admin', label: t('Admin', 'Admin'), icon: 'settings-outline' },
      ]
    }

    if (hasManagerSheetAccess) {
      return [
        { id: 'orders', label: t('Orders', 'Ordenes'), icon: 'receipt-outline' },
        { id: 'pictures', label: t('Pictures', 'Fotos'), icon: 'images-outline' },
        { id: 'manager', label: t('Manager Sheet', 'Hoja gerente'), icon: 'clipboard-outline' },
        { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
      ]
    }

    return [
      { id: 'orders', label: t('Orders', 'Ordenes'), icon: 'receipt-outline' },
      { id: 'pictures', label: t('Pictures', 'Fotos'), icon: 'images-outline' },
      { id: 'timesheet', label: t('Time Sheet', 'Horas'), icon: 'time-outline' },
      { id: 'alerts', label: t('Notifications', 'Notificaciones'), icon: 'notifications-outline' },
    ]
  }, [hasManagerSheetAccess, isAdminUser, t])

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

    if (nativeVersion) {
      return nativeVersion
    }

    if (!isExpoGo) {
      return 'unknown'
    }

    const fallbackVersion = String(Constants.expoConfig?.version ?? '').trim()

    return fallbackVersion || 'unknown'
  }, [isExpoGo])

  const installedNativeBuildLabel = useMemo(() => {
    const nativeBuild = String(Constants.nativeBuildVersion ?? '').trim()

    if (nativeBuild) {
      return nativeBuild
    }

    if (!isExpoGo) {
      return ''
    }

    const fallbackBuild =
      Platform.OS === 'android'
        ? Constants.expoConfig?.android?.versionCode
        : Constants.expoConfig?.ios?.buildNumber

    return String(fallbackBuild ?? '').trim()
  }, [isExpoGo])

  const installedNativeBuildNumber = useMemo(() => {
    return parseBuildNumberLike(installedNativeBuildLabel)
  }, [installedNativeBuildLabel])

  const appVersionLabel = useMemo(() => {
    return installedNativeBuildLabel
      ? `v${installedNativeVersion} (${installedNativeBuildLabel})`
      : `v${installedNativeVersion}`
  }, [installedNativeBuildLabel, installedNativeVersion])

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
          subtitle: t('Check and install the latest build.', 'Busca e instala la compilacion mas reciente.'),
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
            const payload = await requestWithSession<{
              generatedAt?: string
              totals?: Record<string, unknown>
              loanSummaries?: Array<Record<string, unknown>>
            }>('/api/quickbooks/overview')

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
              }>('/api/quickbooks/overview?full=1'),
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

            const workerTotals = new Map<string, { label: string; hours: number; entryCount: number }>()
            const monthJobs = new Map<string, Map<string, {
              jobName: string
              totalHours: number
              totalLaborCost: number
            }>>()
            const monthKeysSet = new Set<string>()

            let totalHours = 0
            let totalLaborCost = 0

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

              totalHours += combinedHours
              totalLaborCost += laborCost

              const fallbackWorkerLabel = t('Unlinked worker', 'Trabajador sin enlace')
              const workerLabel = workerNameById.get(workerId) || fallbackWorkerLabel
              const workerKey = workerId || `worker-fallback-${index + 1}`
              const workerCurrent = workerTotals.get(workerKey) ?? {
                label: workerLabel,
                hours: 0,
                entryCount: 0,
              }
              workerCurrent.hours += combinedHours
              workerCurrent.entryCount += 1
              workerTotals.set(workerKey, workerCurrent)

              const normalizedDate = normalizeIsoDate(normalizeTextValue(entry.date))
              const monthKey = normalizedDate ? normalizedDate.slice(0, 7) : ''

              if (!monthKey) {
                return
              }

              monthKeysSet.add(monthKey)

              const jobName = normalizeTextValue(entry.jobName) || t('Unnamed job', 'Trabajo sin nombre')
              const jobKey = normalizeJobName(jobName) || `job-${index + 1}`
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

            const billsPaidByJobKey = new Map<string, number>()
            const paymentsByMonthJobKey = new Map<string, number>()
            const nonOrderByMonthCategory = new Map<string, Map<MobileNonOrderCategory, {
              billedAmount: number
              paidAmount: number
            }>>()

            quickBooksBills.forEach((bill) => {
              const projectId = normalizeTextValue((bill as Record<string, unknown>).projectId)
              const projectName = normalizeTextValue((bill as Record<string, unknown>).projectName)
              const txnDate = normalizeIsoDate(normalizeTextValue((bill as Record<string, unknown>).txnDate))
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

              billsPaidByJobKey.set(
                jobKey,
                Number(((billsPaidByJobKey.get(jobKey) ?? 0) + paidAmount).toFixed(2)),
              )

              if (!txnDate) {
                return
              }

              const monthKey = txnDate.slice(0, 7)
              const nonOrderCategory = projectLookup?.nonOrderCategory
                ?? resolveMobileNonOrderCategory(projectName, fallbackProjectNumber)

              if (!nonOrderCategory) {
                return
              }

              const categoryTotals = nonOrderByMonthCategory.get(monthKey) ?? new Map<
                MobileNonOrderCategory,
                { billedAmount: number; paidAmount: number }
              >()
              const current = categoryTotals.get(nonOrderCategory) ?? {
                billedAmount: 0,
                paidAmount: 0,
              }

              current.billedAmount += normalizedTotalAmount
              current.paidAmount += paidAmount
              categoryTotals.set(nonOrderCategory, current)
              nonOrderByMonthCategory.set(monthKey, categoryTotals)
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

              const aggregateKey = `${monthKey}:${jobKey}`
              paymentsByMonthJobKey.set(
                aggregateKey,
                Number(((paymentsByMonthJobKey.get(aggregateKey) ?? 0) + normalizedTotalAmount).toFixed(2)),
              )
            })

            const monthKeys = [...monthKeysSet].sort((left, right) => right.localeCompare(left))

            const workerRows = [...workerTotals.values()]
              .sort((left, right) => right.hours - left.hours)
              .slice(0, 80)
              .map((row, index) => ({
                id: `worker-report-${index + 1}`,
                title: row.label,
                subtitle: `${t('Hours', 'Horas')}: ${row.hours.toFixed(1)}`,
                meta: `${t('Entries', 'Entradas')}: ${row.entryCount}`,
              }))

            const monthRows = monthKeys
              .slice(0, 24)
              .map((monthKey, monthIndex) => {
                const jobsByKey = monthJobs.get(monthKey) ?? new Map<string, {
                  jobName: string
                  totalHours: number
                  totalLaborCost: number
                }>()
                const monthRange = resolveMonthRange(monthKey)
                const monthStart = monthRange?.start ?? `${monthKey}-01`
                const previousDate = shiftIsoDateByDays(monthStart, -1) ?? monthStart

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
                    const billsPaidTotal = billsPaidByJobKey.get(jobKey) ?? 0

                    return {
                      id: `month-job-${monthIndex + 1}-${jobIndex + 1}`,
                      jobName: jobData.jobName,
                      totalHours: jobData.totalHours,
                      totalLaborCost: jobData.totalLaborCost,
                      previousReadyPercent,
                      endReadyPercent,
                      progressDeltaPercent,
                      contractAmount,
                      expectedEarnedAmount,
                      billsAmount: financialTotals.billAmount,
                      billsPaidTotal,
                      receivedTotal: financialTotals.paymentAmount,
                      receivedThisMonth,
                    }
                  })
                  .sort((left, right) => {
                    if (right.expectedEarnedAmount !== left.expectedEarnedAmount) {
                      return right.expectedEarnedAmount - left.expectedEarnedAmount
                    }

                    if (right.progressDeltaPercent !== left.progressDeltaPercent) {
                      return right.progressDeltaPercent - left.progressDeltaPercent
                    }

                    return left.jobName.localeCompare(right.jobName)
                  })

                const monthHours = jobRows.reduce((sum, row) => sum + row.totalHours, 0)
                const monthCost = jobRows.reduce((sum, row) => sum + row.totalLaborCost, 0)
                const monthExpected = jobRows.reduce((sum, row) => sum + row.expectedEarnedAmount, 0)
                const monthReceived = jobRows.reduce((sum, row) => sum + row.receivedThisMonth, 0)
                const details = jobRows.length > 0
                  ? jobRows.slice(0, 120).map((row) => (
                    `${clipTextValue(row.jobName, 32)} - ${t('Hours', 'Horas')}: ${row.totalHours.toFixed(1)} - ${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(row.totalLaborCost, locale)} - ${t('Bills', 'Facturas')}: ${formatCurrencyAmountPrecise(row.billsAmount, locale)} - ${t('Bills paid', 'Facturas pagadas')}: ${formatCurrencyAmountPrecise(row.billsPaidTotal, locale)} - ${t('Received', 'Recibido')}: ${formatCurrencyAmountPrecise(row.receivedTotal, locale)} - ${t('Progress', 'Progreso')}: ${row.previousReadyPercent.toFixed(1)}% -> ${row.endReadyPercent.toFixed(1)}% (+${row.progressDeltaPercent.toFixed(1)}%) - ${t('Should earn', 'Debe ganar')}: ${formatCurrencyAmountPrecise(row.expectedEarnedAmount, locale)}`
                  ))
                  : [t('No jobs found for this month.', 'No se encontraron trabajos para este mes.')]

                return {
                  id: `month-report-${monthIndex + 1}`,
                  title: formatMonthBucketLabel(monthKey, locale),
                  subtitle: `${t('Jobs', 'Trabajos')}: ${jobRows.length} - ${t('Hours', 'Horas')}: ${monthHours.toFixed(1)} - ${t('Labor', 'Mano de obra')}: ${formatCurrencyAmountPrecise(monthCost, locale)}`,
                  meta: `${t('Should earn', 'Debe ganar')}: ${formatCurrencyAmountPrecise(monthExpected, locale)} - ${t('Received this month', 'Recibido este mes')}: ${formatCurrencyAmountPrecise(monthReceived, locale)}`,
                  details,
                }
              })

            const nonOrderMonthRows = monthKeys
              .slice(0, 24)
              .map((monthKey, index) => {
                const categoryTotals = nonOrderByMonthCategory.get(monthKey)
                const details = MOBILE_NON_ORDER_CATEGORY_CONFIG.map((config) => {
                  const totals = categoryTotals?.get(config.category) ?? {
                    billedAmount: 0,
                    paidAmount: 0,
                  }

                  return `${config.label} - ${t('Billed', 'Facturado')}: ${formatCurrencyAmountPrecise(totals.billedAmount, locale)} - ${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(totals.paidAmount, locale)}`
                })
                const billedTotal = details.reduce((sum, _detail, detailIndex) => {
                  const config = MOBILE_NON_ORDER_CATEGORY_CONFIG[detailIndex]
                  const totals = categoryTotals?.get(config.category)
                  return sum + (totals?.billedAmount ?? 0)
                }, 0)
                const paidTotal = details.reduce((sum, _detail, detailIndex) => {
                  const config = MOBILE_NON_ORDER_CATEGORY_CONFIG[detailIndex]
                  const totals = categoryTotals?.get(config.category)
                  return sum + (totals?.paidAmount ?? 0)
                }, 0)

                return {
                  id: `month-non-order-${index + 1}`,
                  title: formatMonthBucketLabel(monthKey, locale),
                  subtitle: `${t('Billed', 'Facturado')}: ${formatCurrencyAmountPrecise(billedTotal, locale)}`,
                  meta: `${t('Paid', 'Pagado')}: ${formatCurrencyAmountPrecise(paidTotal, locale)}`,
                  details,
                }
              })

            const uniqueJobCount = new Set(
              [...monthJobs.values()].flatMap((jobsByKey) => [...jobsByKey.keys()]),
            ).size

            panelData = {
              updatedAt: normalizeTextValue(quickBooksPayload.generatedAt) || new Date().toISOString(),
              note: t(
                'Reports are grouped by worker and month. Monthly rows include job-level bills, paid bills, actual received, and progress-based expected earnings.',
                'Los reportes se agrupan por trabajador y mes. Las filas mensuales incluyen facturas por trabajo, facturas pagadas, cobros reales y ganancia esperada por progreso.',
              ),
              stats: [
                {
                  label: t('Workers', 'Trabajadores'),
                  value: String(workers.length),
                },
                {
                  label: t('Entries', 'Entradas'),
                  value: String(entries.length),
                },
                {
                  label: t('Hours', 'Horas'),
                  value: totalHours.toFixed(1),
                },
                {
                  label: t('Labor cost', 'Costo de mano de obra'),
                  value: formatCurrencyAmountPrecise(totalLaborCost, locale),
                },
                {
                  label: t('Jobs', 'Trabajos'),
                  value: String(uniqueJobCount),
                },
                {
                  label: t('Months', 'Meses'),
                  value: String(monthKeys.length),
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
                  title: t('Monthly jobs and earnings', 'Trabajos y ganancias por mes'),
                  emptyText: t('No month report rows.', 'No hay filas por mes.'),
                  rows: monthRows,
                },
                {
                  id: 'report_month_non_order',
                  title: t('Monthly non-order spending', 'Gasto mensual no relacionado a ordenes'),
                  emptyText: t('No monthly non-order spending found.', 'No se encontro gasto no relacionado a ordenes.'),
                  rows: nonOrderMonthRows,
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
        }
      }>('/api/auth/me')

      const approvalValue = payload?.user?.isApproved

      if (typeof approvalValue !== 'boolean') {
        setAuthMessage(t('Unable to verify account approval.', 'No se pudo verificar la aprobacion de la cuenta.'))
        return
      }

      const roleValue = String(payload?.user?.role ?? '').trim().toLowerCase()
      const normalizedRole = ['standard', 'manager', 'admin'].includes(roleValue)
        ? (roleValue as 'standard' | 'manager' | 'admin')
        : 'standard'
      const isAdmin = payload?.user?.isAdmin === true || normalizedRole === 'admin'
      const isManager = payload?.user?.isManager === true || normalizedRole === 'manager'

      setAuthProfile({
        isApproved: approvalValue,
        role: normalizedRole,
        isAdmin,
        isManager,
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
      const hasComparableBuilds = latestBuildNumber !== null && installedNativeBuildNumber !== null
      const hasNewNativeBuild = hasComparableBuilds
        ? latestBuildNumber > installedNativeBuildNumber
        : Boolean(candidateUpdateUrl)

      if (!candidateUpdateUrl) {
        setUpdateMessage(
          t(
            'Update link is not configured yet.',
            'El enlace de actualizacion aun no esta configurado.',
          ),
        )
        return
      }

      if (hasComparableBuilds && !hasNewNativeBuild) {
        const currentBuildText = installedNativeBuildLabel || String(installedNativeBuildNumber)

        setUpdateMessage(
          t(
            `You already have the latest native build (${currentBuildText}).`,
            `Ya tienes la compilacion nativa mas reciente (${currentBuildText}).`,
          ),
        )
        return
      }

      setResolvedUpdateUrl(candidateUpdateUrl)
      if (latestVersion && latestBuildNumber !== null) {
        setUpdateMessage(
          t(
            `Native update found (v${latestVersion} build ${latestBuildNumber}). Tap Install Update.`,
            `Se encontro actualizacion nativa (v${latestVersion} build ${latestBuildNumber}). Toca Instalar actualizacion.`,
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
  }, [getErrorMessage, installedNativeBuildLabel, installedNativeBuildNumber, requestWithSession, t])

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
    if (!googleRequest) {
      setAuthMessage(t('Google sign-in is not configured yet for mobile.', 'El inicio de sesion con Google aun no esta configurado para movil.'))
      return
    }

    setAuthMessage(null)
    setIsSigningIn(true)

    try {
      const result = await promptGoogleSignIn()

      if (result.type !== 'success') {
        setIsSigningIn(false)
      }
    } catch (error) {
      setIsSigningIn(false)
      setAuthMessage(getErrorMessage(error, 'Google sign-in failed.', 'Fallo el inicio de sesion con Google.'))
    }
  }, [getErrorMessage, googleRequest, promptGoogleSignIn, t])

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
    if (!googleResponse) {
      return
    }

    if (googleResponse.type !== 'success') {
      setIsSigningIn(false)
      return
    }

    const idToken = String(googleResponse.params?.id_token ?? '').trim()

    if (!idToken) {
      setIsSigningIn(false)
      setAuthMessage(t('Google sign-in did not return an ID token.', 'Google no devolvio un ID token al iniciar sesion.'))
      return
    }

    const credential = GoogleAuthProvider.credential(idToken)

    signInWithCredential(mobileAuth, credential)
      .then(() => {
        setAuthMessage(null)
      })
      .catch((error) => {
        setAuthMessage(getErrorMessage(error, 'Google sign-in failed.', 'Fallo el inicio de sesion con Google.'))
      })
      .finally(() => {
        setIsSigningIn(false)
      })
  }, [getErrorMessage, googleResponse, t])

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
    if (activeSettingsMenuId !== 'admin') {
      setAdminPortalMessage(null)
    }
  }, [activeSettingsMenuId])

  useEffect(() => {
    setAdminExpandedWorkspaceRowId(null)
    setAdminAccessMenuUserUid(null)
    setAdminReportsView('menu')
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
      const nextStages = Array.isArray(payload.stages) ? payload.stages : []

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
    const normalizedJobNumber = timesheetJobNumber.trim()
    const normalizedNotes = timesheetNotes.trim()
    const hours = Number(timesheetHours)

    if (!normalizedDate) {
      setTimesheetMessage(t('Date is required.', 'La fecha es obligatoria.'))
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
    const candidates = [
      mondaySnapshot?.generatedAt,
      zendeskSnapshot?.generatedAt,
      supportTicketsSnapshot?.generatedAt,
    ].filter((value): value is string => Boolean(value))

    if (!candidates.length) {
      return t('Unknown', 'Desconocido')
    }

    const newestRaw = candidates.reduce((latest, current) => {
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

    const parsedNewest = new Date(newestRaw)

    if (Number.isNaN(parsedNewest.getTime())) {
      return newestRaw
    }

    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsedNewest)
  }, [locale, mondaySnapshot, supportTicketsSnapshot, t, zendeskSnapshot])

  const detailOrders = useMemo(() => {
    if (!mondaySnapshot || !detailSelection || detailSelection.type !== 'order') {
      return []
    }

    switch (detailSelection.key) {
      case 'lateOrders':
        return mondaySnapshot.details.lateOrders
      case 'dueThisWeekOrders':
        return orderBuckets.dueThisWeekOrders
      case 'dueInTwoWeeksOrders':
        return orderBuckets.dueInTwoWeeksOrders
      case 'activeOrders':
        return mondaySnapshot.details.activeOrders
      case 'missingDueDateOrders':
        return mondaySnapshot.details.missingDueDateOrders
      default:
        return []
    }
  }, [detailSelection, mondaySnapshot, orderBuckets])

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

  const allOrdersForPictures = useMemo(() => mondaySnapshot?.orders ?? [], [mondaySnapshot])

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

  const ordersTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOrdersForList.length / ORDERS_PAGE_SIZE)),
    [filteredOrdersForList.length],
  )

  const paginatedOrdersForList = useMemo(() => {
    const safePage = Math.min(Math.max(ordersPage, 1), ordersTotalPages)
    const start = (safePage - 1) * ORDERS_PAGE_SIZE

    return filteredOrdersForList.slice(start, start + ORDERS_PAGE_SIZE)
  }, [filteredOrdersForList, ordersPage, ordersTotalPages])

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
    () => Math.max(400, windowHeight - 300),
    [windowHeight],
  )

  const alertsCardHeight = useMemo(
    () => Math.max(400, windowHeight - 300),
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
      }
    }

    const sections = selectedAdminWorkspaceData?.sections ?? []

    return {
      worker: sections.find((section) => section.id === 'report_worker') ?? null,
      month: sections.find((section) => section.id === 'report_month') ?? null,
    }
  }, [selectedAdminPortalPage.path, selectedAdminWorkspaceData])

  const visibleAdminSections = useMemo(() => {
    const sections = selectedAdminWorkspaceData?.sections ?? []

    if (selectedAdminPortalPage.path !== '/admin/reports') {
      return sections
    }

    if (adminReportsView === 'menu') {
      return []
    }

    if (adminReportsView === 'worker') {
      return sections.filter((section) => section.id === 'report_worker')
    }

    return sections.filter(
      (section) => section.id === 'report_month' || section.id === 'report_month_non_order',
    )
  }, [adminReportsView, selectedAdminPortalPage.path, selectedAdminWorkspaceData])

  useEffect(() => {
    if (selectedAdminPortalPage.path !== '/admin/cash') {
      setAdminCashAccountModalRow(null)
    }
  }, [selectedAdminPortalPage.path])

  const isAdminWorkspaceLoading = adminWorkspaceLoadingPath === selectedAdminPortalPage.path

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
    const sourcePreviewUrl = String(detailsOrder?.shopDrawingUrl ?? order.shopDrawingUrl ?? '').trim()
    const orderId = String(detailsOrder?.mondayItemId ?? order.id ?? '').trim()

    if (!cachedPreviewUrl && !sourcePreviewUrl && !orderId) {
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

      if (sourcePreviewUrl) {
        await WebBrowser.openBrowserAsync(sourcePreviewUrl)
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

    if (!cachedUrl && !sourceUrl) {
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
      await WebBrowser.openBrowserAsync(cachedUrl || sourceUrl)
    } catch (error) {
      setOrdersDetailMessage(
        getErrorMessage(
          error,
          'Could not open cut list.',
          'No se pudo abrir la lista de corte.',
        ),
      )
    }
  }, [getErrorMessage, t])

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

    setIsAccountMenuOpen(false)
  }, [clearDashboardMetricZoomTimeout, closePicturesModal, closeSettingsMenu])

  const hasGoogleClientId =
    Platform.OS === 'ios'
      ? isExpoGo
        ? Boolean(GOOGLE_EXPO_IOS_CLIENT_ID)
        : Boolean(GOOGLE_IOS_CLIENT_ID || GOOGLE_WEB_CLIENT_ID)
      : Platform.OS === 'android'
        ? isExpoGo
          ? Boolean(GOOGLE_EXPO_ANDROID_CLIENT_ID)
          : Boolean(GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID)
        : Boolean(GOOGLE_WEB_CLIENT_ID)
  const googleClientIdHint =
    Platform.OS === 'ios'
      ? isExpoGo
        ? t(
            'Expo Go on iOS uses bundle id host.exp.Exponent. Best path: run a development build and use EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.',
            'Expo Go en iOS usa el bundle id host.exp.Exponent. La mejor opcion es usar un build de desarrollo con EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.',
          )
        : t(
            'Missing EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID fallback).',
            'Falta EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (o el respaldo EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).',
          )
      : Platform.OS === 'android'
        ? isExpoGo
          ? t(
              'Expo Go on Android uses package host.exp.exponent and Expo Go signing SHA-1. Best path: run a development build and use EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID.',
              'Expo Go en Android usa el paquete host.exp.exponent y el SHA-1 de firma de Expo Go. La mejor opcion es usar un build de desarrollo con EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID.',
            )
          : t(
              'Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID (or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID fallback).',
              'Falta EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID (o el respaldo EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).',
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

  const usesNestedListScroll = activeScreen === 'pictures' || activeScreen === 'orders' || activeScreen === 'alerts' || activeScreen === 'admin'
  const isRefreshBusy =
    isRefreshing
    || (activeScreen === 'timesheet' && isTimesheetLoading)
    || (activeScreen === 'manager' && (isManagerLoading || isManagerSaving))
    || (activeScreen === 'alerts' && isAlertsLoading)
    || (activeScreen === 'settings' && (isCheckingForUpdates || isInstallingUpdate))

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.shell}>
        <View style={styles.contentPane}>
          <ScrollView
            style={usesNestedListScroll ? styles.picturesScreenScroll : undefined}
            contentContainerStyle={[
              styles.scrollContent,
              usesNestedListScroll ? styles.scrollContentPictures : null,
            ]}
            scrollEnabled={!usesNestedListScroll}
          >
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
                    <Image source={{ uri: profilePhotoUrl }} style={styles.profileAvatarImage} />
                  ) : (
                    <View style={styles.profileAvatarFallback}>
                      <Text style={styles.profileAvatarFallbackText}>{profileInitial}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>

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
                orderSearchQuery={ordersSearchQuery}
                onOrderSearchQueryChange={setOrdersSearchQuery}
                orderViewFilter={ordersViewFilter}
                onOrderViewFilterChange={setOrdersViewFilter}
                poNumberByOrderId={poNumberByOrderId}
                ordersCardHeight={ordersCardHeight}
                hasManagerInsights={hasManagerSheetAccess}
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
                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminWorkspaceData.note ? (
                        <Text style={styles.adminWorkspaceBodyNote}>{selectedAdminWorkspaceData.note}</Text>
                      ) : null}

                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminWorkspaceData.updatedAt ? (
                        <Text style={styles.adminWorkspaceBodyUpdatedAt}>
                          {t('Updated', 'Actualizado')}: {formatSyncTimestamp(selectedAdminWorkspaceData.updatedAt, locale)}
                        </Text>
                      ) : null}

                      {selectedAdminPortalPage.path !== '/admin/cash' && selectedAdminWorkspaceData.stats.length > 0 ? (
                        <View style={styles.adminWorkspaceStatsWrap}>
                          {selectedAdminWorkspaceData.stats.map((stat) => (
                            <View key={`${stat.label}-${stat.value}`} style={styles.adminWorkspaceStatChip}>
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
                          {adminReportsView === 'menu' ? (
                            <>
                              <Text style={styles.adminWorkspaceSectionTitle}>{t('Report options', 'Opciones de reportes')}</Text>

                              <Pressable
                                style={[
                                  styles.adminWorkspaceReportOptionButton,
                                  !selectedAdminReportSections.worker ? styles.buttonDisabled : null,
                                ]}
                                disabled={!selectedAdminReportSections.worker}
                                onPress={() => setAdminReportsView('worker')}
                              >
                                <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by worker', 'Reporte por trabajador')}</Text>
                                <Text style={styles.adminWorkspaceReportOptionSubtitle}>{t('Open worker report', 'Abrir reporte de trabajador')}</Text>
                              </Pressable>

                              <Pressable
                                style={[
                                  styles.adminWorkspaceReportOptionButton,
                                  !selectedAdminReportSections.month ? styles.buttonDisabled : null,
                                ]}
                                disabled={!selectedAdminReportSections.month}
                                onPress={() => setAdminReportsView('month')}
                              >
                                <Text style={styles.adminWorkspaceReportOptionTitle}>{t('Report by month', 'Reporte por mes')}</Text>
                                <Text style={styles.adminWorkspaceReportOptionSubtitle}>{t('Open month report', 'Abrir reporte por mes')}</Text>
                              </Pressable>
                            </>
                          ) : (
                            <Pressable
                              style={styles.adminWorkspaceBackButton}
                              onPress={() => setAdminReportsView('menu')}
                            >
                              <Ionicons name="chevron-back" size={16} color="#24467c" />
                              <Text style={styles.adminWorkspaceBackButtonText}>{t('Back to report options', 'Volver a opciones de reportes')}</Text>
                            </Pressable>
                          )}
                        </View>
                      ) : null}

                      {visibleAdminSections.map((section) => (
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
                      ))}
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
          </ScrollView>
        </View>

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
                    {selectedOrderOverviewDetails.mondayStatus ? (
                      <Text style={styles.orderDetailSummaryMeta}>
                        {t('Monday status', 'Estado de Monday')}: {selectedOrderOverviewDetails.mondayStatus}
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
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('P.O. number', 'Numero de P.O.')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.poNumber || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Monday status', 'Estado de Monday')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.mondayStatus || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Lead time', 'Lead time')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {selectedOrderOverviewDetails.leadTimeDays !== null
                              ? `${selectedOrderOverviewDetails.leadTimeDays} ${t('days', 'dias')}`
                              : '-'}
                          </Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Order date', 'Fecha de orden')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.orderDate, locale)}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Due date', 'Fecha limite')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.dueDate, locale)}</Text>
                        </View>
                      </View>

                      <View style={styles.orderDetailInfoCard}>
                        <Text style={styles.orderDetailSectionTitle}>{t('Status and progress', 'Estado y progreso')}</Text>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Monday status', 'Estado de Monday')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.mondayStatus || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Row status', 'Estado de fila')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.rowStatus || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Progress', 'Progreso')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {selectedOrderOverviewDetails.progressPercent !== null
                              ? `${selectedOrderOverviewDetails.progressPercent}%`
                              : '-'}
                          </Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Manager ready', 'Avance gerente')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {selectedOrderOverviewDetails.managerReadyPercent !== null
                              ? `${selectedOrderOverviewDetails.managerReadyPercent}%`
                              : '-'}
                          </Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('Source', 'Fuente')}</Text>
                          <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.source || '-'}</Text>
                        </View>
                        <View style={styles.orderDetailInfoRow}>
                          <Text style={styles.orderDetailInfoLabel}>{t('In design', 'En diseno')}</Text>
                          <Text style={styles.orderDetailInfoValue}>
                            {selectedOrderOverviewDetails.inDesign === null
                              ? '-'
                              : selectedOrderOverviewDetails.inDesign
                                ? t('Yes', 'Si')
                                : t('No', 'No')}
                          </Text>
                        </View>
                      </View>

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

                      {(selectedOrderOverviewDetails.notes
                        || selectedOrderOverviewDetails.description
                        || selectedOrderOverviewDetails.hazardReason
                        || selectedOrderOverviewDetails.invoiceNumber
                        || selectedOrderOverviewDetails.managerReadyDate
                        || selectedOrderOverviewDetails.managerReadyUpdatedAt
                        || selectedOrderOverviewDetails.mondayUpdatedAt) ? (
                        <View style={styles.orderDetailInfoCard}>
                          <Text style={styles.orderDetailSectionTitle}>{t('Notes and timestamps', 'Notas y tiempos')}</Text>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Invoice #', 'Factura #')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.invoiceNumber || '-'}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Manager ready date', 'Fecha avance gerente')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.managerReadyDate, locale)}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Manager ready updated', 'Actualizacion avance gerente')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.managerReadyUpdatedAt, locale)}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Monday updated', 'Monday actualizado')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{formatDisplayDate(selectedOrderOverviewDetails.mondayUpdatedAt, locale)}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Hazard reason', 'Razon de riesgo')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.hazardReason || '-'}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Notes', 'Notas')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.notes || '-'}</Text>
                          </View>
                          <View style={styles.orderDetailInfoRow}>
                            <Text style={styles.orderDetailInfoLabel}>{t('Description', 'Descripcion')}</Text>
                            <Text style={styles.orderDetailInfoValue}>{selectedOrderOverviewDetails.description || '-'}</Text>
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
                                    <Text style={styles.orderDetailHistoryExpandText}>
                                      {isExpanded
                                        ? t('Hide', 'Ocultar')
                                        : t('Workers', 'Trabajadores')}
                                    </Text>
                                  </View>

                                  <Text style={styles.orderDetailHistorySecondary}>
                                    {historyRow.jobName || selectedOrderOverviewDetails.orderName || t('Order', 'Orden')}
                                  </Text>

                                  {isExpanded ? (
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

              <ScrollView
                style={styles.adminCashDetailsModalScroll}
                contentContainerStyle={styles.adminCashDetailsModalContent}
                nestedScrollEnabled
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
  )
}

