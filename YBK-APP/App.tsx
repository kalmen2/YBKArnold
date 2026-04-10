import AsyncStorage from '@react-native-async-storage/async-storage'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Picker } from '@react-native-picker/picker'
import * as Google from 'expo-auth-session/providers/google'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import * as ImagePicker from 'expo-image-picker'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Updates from 'expo-updates/build/index'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type User,
} from 'firebase/auth'
import { mobileAuth } from './firebase'

WebBrowser.maybeCompleteAuthSession()

const API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'
const API_REQUEST_TIMEOUT_MS = 15000
const MOBILE_BIOMETRIC_ENABLED_KEY = 'ybk.mobile.biometric.enabled'
const MOBILE_LANGUAGE_KEY = 'ybk.mobile.language'
const MOBILE_ANDROID_PACKAGE = 'com.ybk.arnold'
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? ''
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? ''
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? ''
const GOOGLE_EXPO_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_IOS_CLIENT_ID ?? ''
const GOOGLE_EXPO_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_ANDROID_CLIENT_ID ?? ''
const GOOGLE_ANDROID_REDIRECT_URI = `${MOBILE_ANDROID_PACKAGE}:/oauthredirect`
const APP_UPDATE_URL = process.env.EXPO_PUBLIC_APP_UPDATE_URL ?? ''
const ANDROID_APK_UPDATE_URL = process.env.EXPO_PUBLIC_ANDROID_APK_UPDATE_URL ?? ''
const ANDROID_PLAY_STORE_URL = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL ?? ''
const IOS_APP_STORE_URL = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? ''

type DashboardOrder = {
  id: string
  name: string
  groupTitle: string
  statusLabel: string
  stageLabel: string
  readyLabel: string
  leadTimeDays: number | null
  progressPercent: number | null
  orderDate: string | null
  shippedAt: string | null
  dueDate: string | null
  computedDueDate: string | null
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isDone: boolean
  isLate: boolean
  daysLate: number
  updatedAt: string | null
  itemUrl: string | null
}

type MondayDashboardSnapshot = {
  board: {
    id: string
    name: string
    url: string | null
  }
  generatedAt: string
  metrics: {
    totalOrders: number
    activeOrders: number
    completedOrders: number
    lateOrders: number
    dueSoonOrders: number
    missingDueDateOrders: number
    averageLeadTimeDays: number | null
  }
  details: {
    lateOrders: DashboardOrder[]
    dueSoonOrders: DashboardOrder[]
    activeOrders: DashboardOrder[]
    completedOrders: DashboardOrder[]
    missingDueDateOrders: DashboardOrder[]
  }
  orders: DashboardOrder[]
}

type ZendeskTicketSummarySnapshot = {
  generatedAt: string
  agentUrl: string | null
  metrics: {
    newTickets: number
    inProgressTickets: number
    openTickets: number
    pendingTickets: number
    solvedTickets: number
    openTotalTickets: number
  }
}

type SupportTicket = {
  id: number
  subject: string
  orderNumber: string | null
  status: string
  statusLabel: string
  priority: string
  requesterName: string
  assigneeName: string
  createdAt: string
  updatedAt: string
  url: string | null
}

type SupportTicketsSnapshot = {
  generatedAt: string
  agentUrl: string | null
  tickets: SupportTicket[]
}

type OrderPhoto = {
  path: string
  url: string
  createdAt: string
}

type MobileTimesheetWorker = {
  id: string
  workerNumber: string
  fullName: string
  role: string
  email: string
  phone: string
  hourlyRate: number
}

type MobileTimesheetEntry = {
  id: string
  workerId: string
  date: string
  jobName: string
  stageId?: string
  hours: number
  notes: string
  createdAt: string
}

type MobileTimesheetStage = {
  id: string
  name: string
  sortOrder: number
}

type MobileAuthUser = {
  uid: string
  email: string
  displayName: string | null
  role: 'standard' | 'admin'
  isApproved: boolean
  approvalStatus: 'pending' | 'approved'
  linkedWorkerId: string | null
  linkedWorkerNumber: string | null
  linkedWorkerName: string | null
}

type MetricTone = {
  cardBackground: string
  borderColor: string
  labelColor: string
  valueColor: string
}

type AppScreen = 'dashboard' | 'pictures' | 'timesheet' | 'settings'
type AppLanguage = 'en' | 'es'
type OrderMetricKey =
  | 'lateOrders'
  | 'dueThisWeekOrders'
  | 'dueInTwoWeeksOrders'
  | 'activeOrders'
  | 'missingDueDateOrders'
type TicketMetricKey =
  | 'newTickets'
  | 'inProgressTickets'
  | 'openTickets'
  | 'pendingTickets'
  | 'solvedTickets'

type DetailSelection =
  | {
      type: 'order'
      key: OrderMetricKey
      label: string
    }
  | {
      type: 'ticket'
      key: TicketMetricKey
      label: string
    }
  | null

const ORDER_TONES: MetricTone[] = [
  {
    cardBackground: '#e8f7ff',
    borderColor: '#9cd4f4',
    labelColor: '#21507a',
    valueColor: '#0a2f52',
  },
  {
    cardBackground: '#eaf6ee',
    borderColor: '#9fd8b2',
    labelColor: '#1d5f37',
    valueColor: '#0f3f24',
  },
  {
    cardBackground: '#fff4e8',
    borderColor: '#f2c999',
    labelColor: '#7a4d1f',
    valueColor: '#5b330b',
  },
  {
    cardBackground: '#fff9e8',
    borderColor: '#efd98d',
    labelColor: '#705718',
    valueColor: '#574107',
  },
  {
    cardBackground: '#ffeef1',
    borderColor: '#efb2bf',
    labelColor: '#7f2740',
    valueColor: '#5e1330',
  },
]

const TICKET_TONES: MetricTone[] = [
  {
    cardBackground: '#f0efff',
    borderColor: '#b5b0f0',
    labelColor: '#3d2f8a',
    valueColor: '#281a66',
  },
  {
    cardBackground: '#f2fbf8',
    borderColor: '#9edcc8',
    labelColor: '#1b6850',
    valueColor: '#0f4a37',
  },
  {
    cardBackground: '#ecf4ff',
    borderColor: '#9ec1ea',
    labelColor: '#224f84',
    valueColor: '#14335d',
  },
  {
    cardBackground: '#fff5f1',
    borderColor: '#f3c1ac',
    labelColor: '#7a3f2a',
    valueColor: '#582712',
  },
  {
    cardBackground: '#eff7ee',
    borderColor: '#b4d6a8',
    labelColor: '#325f27',
    valueColor: '#1e4617',
  },
]

const SIDEBAR_ITEMS: Array<{ id: AppScreen; shortLabel: string }> = [
  { id: 'dashboard', shortLabel: 'DB' },
  { id: 'pictures', shortLabel: 'PH' },
  { id: 'timesheet', shortLabel: 'TS' },
  { id: 'settings', shortLabel: 'ST' },
]

function withRefreshQuery(path: string, refreshRequested: boolean) {
  if (!refreshRequested) {
    return `${API_BASE_URL}${path}`
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${API_BASE_URL}${path}${separator}refresh=1`
}

async function request<T>(
  path: string,
  refreshRequested = false,
  init: RequestInit = {},
) {
  const timeoutController = init.signal ? null : new AbortController()
  const timeoutId = timeoutController
    ? setTimeout(() => {
        timeoutController.abort()
      }, API_REQUEST_TIMEOUT_MS)
    : null

  let response: Response
  let payload: unknown = {}

  try {
    response = await fetch(withRefreshQuery(path, refreshRequested), {
      ...init,
      signal: init.signal ?? timeoutController?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    payload = await response.json().catch(() => ({}))
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Check your network connection and try again.')
    }

    throw error
  }

  if (timeoutId) {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const requestError = new Error(
      String((payload as { error?: string }).error ?? 'Request failed.'),
    ) as Error & { status?: number }
    requestError.status = response.status
    throw requestError
  }

  return payload as T
}

function formatSyncTimestamp(value: string | null | undefined, locale = 'en-US') {
  const isSpanishLocale = locale.toLowerCase().startsWith('es')

  if (!value) {
    return isSpanishLocale ? 'Desconocido' : 'Unknown'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function formatDisplayDate(value: string | null | undefined, locale = 'en-US') {
  const isSpanishLocale = locale.toLowerCase().startsWith('es')

  if (!value) {
    return isSpanishLocale ? 'Sin fecha' : 'Not set'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizeTicketStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function resolveDaysUntilDue(order: DashboardOrder) {
  if (typeof order.daysUntilDue === 'number' && Number.isFinite(order.daysUntilDue)) {
    return order.daysUntilDue
  }

  const rawDueDate = String(order.effectiveDueDate ?? '').trim()

  if (!rawDueDate) {
    return null
  }

  const parsedDueDate = new Date(rawDueDate)

  if (Number.isNaN(parsedDueDate.getTime())) {
    return null
  }

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dueDateStart = new Date(
    parsedDueDate.getFullYear(),
    parsedDueDate.getMonth(),
    parsedDueDate.getDate(),
  )

  return Math.round((dueDateStart.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000))
}

function MetricCard({
  label,
  value,
  helper,
  actionLabel,
  tone,
  onPress,
}: {
  label: string
  value: string
  helper?: string
  actionLabel: string
  tone: MetricTone
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.metricCard,
        {
          backgroundColor: tone.cardBackground,
          borderColor: tone.borderColor,
        },
        pressed ? styles.metricCardPressed : null,
      ]}
    >
      <Text style={[styles.metricLabel, { color: tone.labelColor }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: tone.valueColor }]}>{value}</Text>
      {helper ? <Text style={[styles.metricHelper, { color: tone.labelColor }]}>{helper}</Text> : null}
      <Text style={styles.metricActionText}>{actionLabel}</Text>
    </Pressable>
  )
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
  const [authMessage, setAuthMessage] = useState<string | null>(null)
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [mondaySnapshot, setMondaySnapshot] = useState<MondayDashboardSnapshot | null>(null)
  const [zendeskSnapshot, setZendeskSnapshot] = useState<ZendeskTicketSummarySnapshot | null>(null)
  const [supportTicketsSnapshot, setSupportTicketsSnapshot] = useState<SupportTicketsSnapshot | null>(null)

  const [detailSelection, setDetailSelection] = useState<DetailSelection>(null)

  const [selectedPictureOrderId, setSelectedPictureOrderId] = useState<string | null>(null)
  const [isPicturesModalOpen, setIsPicturesModalOpen] = useState(false)
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const [orderPhotosByOrderId, setOrderPhotosByOrderId] = useState<Record<string, OrderPhoto[]>>({})
  const [isLoadingOrderPhotos, setIsLoadingOrderPhotos] = useState(false)
  const [isUploadingPicture, setIsUploadingPicture] = useState(false)
  const [pictureMessage, setPictureMessage] = useState<string | null>(null)

  const [timesheetWorker, setTimesheetWorker] = useState<MobileTimesheetWorker | null>(null)
  const [timesheetEntries, setTimesheetEntries] = useState<MobileTimesheetEntry[]>([])
  const [timesheetStages, setTimesheetStages] = useState<MobileTimesheetStage[]>([])
  const [isTimesheetLoading, setIsTimesheetLoading] = useState(false)
  const [isTimesheetSaving, setIsTimesheetSaving] = useState(false)
  const [timesheetMessage, setTimesheetMessage] = useState<string | null>(null)
  const [timesheetDate, setTimesheetDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [timesheetJobNumber, setTimesheetJobNumber] = useState('')
  const [timesheetStageId, setTimesheetStageId] = useState('')
  const [timesheetHours, setTimesheetHours] = useState('')
  const [timesheetNotes, setTimesheetNotes] = useState('')
  const [isTimesheetDatePickerOpen, setIsTimesheetDatePickerOpen] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)

  const isSpanish = language === 'es'
  const locale = isSpanish ? 'es-ES' : 'en-US'
  const t = useCallback((english: string, spanish: string) => (isSpanish ? spanish : english), [isSpanish])

  const localizedScreenLabels = useMemo<Record<AppScreen, string>>(
    () => ({
      dashboard: t('Dashboard', 'Panel'),
      pictures: t('Pictures', 'Fotos'),
      timesheet: t('Timesheet', 'Horas'),
      settings: t('Settings', 'Configuracion'),
    }),
    [t],
  )

  const appVersionLabel = useMemo(() => {
    const version = Constants.expoConfig?.version ?? 'unknown'
    const build =
      Platform.OS === 'android'
        ? Constants.expoConfig?.android?.versionCode
        : Constants.expoConfig?.ios?.buildNumber

    return build ? `v${version} (${build})` : `v${version}`
  }, [])

  const appUpdateUrl = useMemo(() => {
    const candidates =
      Platform.OS === 'android'
        ? [ANDROID_PLAY_STORE_URL, ANDROID_APK_UPDATE_URL, APP_UPDATE_URL]
        : [IOS_APP_STORE_URL, APP_UPDATE_URL]

    return candidates.map((value) => String(value ?? '').trim()).find((value) => value.length > 0) ?? ''
  }, [])

  const canUseOtaUpdates = useMemo(() => !__DEV__ && Updates.isEnabled, [])
  const otaChannelLabel = useMemo(() => {
    const configuredChannel = String(Updates.channel ?? '').trim()

    return configuredChannel || 'production'
  }, [])

  const requestWithSession = useCallback(
    async <T,>(path: string, refreshRequested = false, init: RequestInit = {}) => {
      const idToken = firebaseUser ? await firebaseUser.getIdToken() : null

      try {
        return await request<T>(path, refreshRequested, {
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
      } catch (error) {
        const status = (error as { status?: number })?.status

        if (status === 401 || status === 403) {
          await signOut(mobileAuth)
          setAuthProfile(null)
          setHasBiometricSessionAuth(false)
          setHasSkippedBiometricPrompt(false)
          setIsBiometricPromptOpen(false)
        }

        throw error
      }
    },
    [firebaseUser],
  )

  const syncAuthProfile = useCallback(async () => {
    if (!firebaseUser) {
      setAuthProfile(null)
      setIsCheckingApproval(false)
      return
    }

    setIsCheckingApproval(true)

    try {
      const idToken = await firebaseUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'x-client-platform': 'app',
        },
      })
      const payload = await response.json().catch(() => ({}))

      if (response.status === 401) {
        await signOut(mobileAuth)
        setAuthProfile(null)
        setHasBiometricSessionAuth(false)
        setAuthMessage(t('Your session expired. Please sign in again.', 'Tu sesion expiro. Inicia sesion otra vez.'))
        return
      }

      if (response.status === 403) {
        await signOut(mobileAuth)
        setAuthProfile(null)
        setHasBiometricSessionAuth(false)
        setIsBiometricPromptOpen(false)
        setHasSkippedBiometricPrompt(false)
        setAuthMessage(
          typeof payload?.error === 'string'
            ? payload.error
            : t(
                'Access is blocked outside your allowed login hours.',
                'El acceso esta bloqueado fuera de tu horario permitido de inicio de sesion.',
              ),
        )
        return
      }

      if (!response.ok) {
        setAuthProfile(null)

        setAuthMessage(
          typeof payload?.error === 'string'
            ? payload.error
            : t('Unable to verify account approval.', 'No se pudo verificar la aprobacion de la cuenta.'),
        )
        return
      }

      setAuthProfile(payload.user as MobileAuthUser)
      setAuthMessage(null)
    } catch (error) {
      setAuthProfile(null)
      setAuthMessage(
        error instanceof Error
          ? error.message
          : t('Could not verify account access.', 'No se pudo verificar el acceso de la cuenta.'),
      )
    } finally {
      setIsCheckingApproval(false)
    }
  }, [firebaseUser, t])

  const handleAuthenticateBiometric = useCallback(async () => {
    setIsAuthenticatingBiometric(true)

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync()
      const isEnrolled = await LocalAuthentication.isEnrolledAsync()

      if (!hasHardware || !isEnrolled) {
        setIsBiometricEnabled(false)
        setIsBiometricPromptOpen(false)
        setHasBiometricSessionAuth(true)
        setHasSkippedBiometricPrompt(false)
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
        promptMessage: t('Use biometrics for YBK', 'Usar biometria para YBK'),
        fallbackLabel: t('Use device passcode', 'Usar codigo del dispositivo'),
        disableDeviceFallback: false,
      })

      if (result.success) {
        setHasBiometricSessionAuth(true)
        setHasSkippedBiometricPrompt(false)
        setIsBiometricPromptOpen(false)
        setAuthMessage(null)
        return
      }

      setAuthMessage(
        t('Biometric verification was cancelled. Try again or skip.', 'La verificacion biometrica se cancelo. Intenta de nuevo o omitir.'),
      )
    } catch (error) {
      setAuthMessage(
        error instanceof Error
          ? error.message
          : t('Could not verify biometrics.', 'No se pudo verificar la biometria.'),
      )
    } finally {
      setIsAuthenticatingBiometric(false)
    }
  }, [t])

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
    setHasBiometricSessionAuth(true)
    setHasSkippedBiometricPrompt(false)
    setIsBiometricPromptOpen(false)
    setAuthMessage(null)
  }, [])

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
    setHasBiometricSessionAuth(false)
    setHasSkippedBiometricPrompt(false)
    await AsyncStorage.setItem(MOBILE_BIOMETRIC_ENABLED_KEY, 'true')

    if (authProfile?.isApproved) {
      setIsBiometricPromptOpen(true)
    }
  }, [authProfile?.isApproved, isBiometricEnabled])

  const openAppUpdateUrl = useCallback(async () => {
    if (!appUpdateUrl) {
      setUpdateMessage(
        t(
          'Update link is not configured yet. Ask admin to set EXPO_PUBLIC_ANDROID_PLAY_STORE_URL or EXPO_PUBLIC_ANDROID_APK_UPDATE_URL.',
          'El enlace de actualizacion no esta configurado. Pide al administrador que configure EXPO_PUBLIC_ANDROID_PLAY_STORE_URL o EXPO_PUBLIC_ANDROID_APK_UPDATE_URL.',
        ),
      )
      return false
    }

    try {
      const canOpen = await Linking.canOpenURL(appUpdateUrl)

      if (!canOpen) {
        setUpdateMessage(
          t(
            'This device cannot open the update link. Contact support.',
            'Este dispositivo no puede abrir el enlace de actualizacion. Contacta soporte.',
          ),
        )
        return false
      }

      await Linking.openURL(appUpdateUrl)
      setUpdateMessage(
        t(
          'Update link opened. Install the new version when prompted.',
          'Se abrio el enlace de actualizacion. Instala la nueva version cuando se te pida.',
        ),
      )
      return true
    } catch (error) {
      setUpdateMessage(
        error instanceof Error
          ? error.message
          : t('Could not open update link.', 'No se pudo abrir el enlace de actualizacion.'),
      )
      return false
    }
  }, [appUpdateUrl, t])

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateMessage(null)
    setIsCheckingForUpdates(true)

    try {
      if (canUseOtaUpdates) {
        const updateCheckResult = await Updates.checkForUpdateAsync()

        if (updateCheckResult.isAvailable) {
          setUpdateMessage(
            t(
              'Update found. Installing now...',
              'Actualizacion encontrada. Instalando ahora...',
            ),
          )
          await Updates.fetchUpdateAsync()
          await Updates.reloadAsync()
          return
        }

        if (appUpdateUrl) {
          await openAppUpdateUrl()
          return
        }

        setUpdateMessage(
          t(
            'You already have the latest version.',
            'Ya tienes la version mas reciente.',
          ),
        )
        return
      }

      await openAppUpdateUrl()
    } catch (error) {
      setUpdateMessage(
        error instanceof Error
          ? error.message
          : t('Could not check for updates.', 'No se pudo buscar actualizaciones.'),
      )
    } finally {
      setIsCheckingForUpdates(false)
    }
  }, [appUpdateUrl, canUseOtaUpdates, openAppUpdateUrl, t])

  const handleConfirmDisableBiometric = useCallback(async () => {
    setIsBiometricEnabled(false)
    setHasBiometricSessionAuth(true)
    setHasSkippedBiometricPrompt(false)
    setIsBiometricPromptOpen(false)
    setIsDisableBiometricConfirmOpen(false)
    await AsyncStorage.setItem(MOBILE_BIOMETRIC_ENABLED_KEY, 'false')
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut(mobileAuth)
    setAuthProfile(null)
    setDetailSelection(null)
    setIsPicturesModalOpen(false)
    setIsSidebarOpen(false)
    setHasBiometricSessionAuth(false)
    setHasSkippedBiometricPrompt(false)
    setIsBiometricPromptOpen(false)
    setIsDisableBiometricConfirmOpen(false)
    setLastAutoBiometricAttemptAt(0)
    setTimesheetMessage(null)
    setAuthMessage(null)
  }, [])

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
      setAuthMessage(error instanceof Error ? error.message : t('Google sign-in failed.', 'Fallo el inicio de sesion con Google.'))
    }
  }, [googleRequest, promptGoogleSignIn, t])

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
        setAuthMessage(error instanceof Error ? error.message : t('Mobile auth failed to initialize.', 'La autenticacion movil no pudo iniciarse.'))
        setIsAuthResolved(true)
      }

      clearTimeout(resolveTimeoutId)
    }

    return () => {
      isMounted = false
      clearTimeout(resolveTimeoutId)
      subscription()
    }
  }, [t])

  useEffect(() => {
    let isMounted = true

    Promise.all([
      AsyncStorage.getItem(MOBILE_BIOMETRIC_ENABLED_KEY),
      AsyncStorage.getItem(MOBILE_LANGUAGE_KEY),
    ])
      .then(([storedBiometricValue, storedLanguageValue]) => {
        if (!isMounted) {
          return
        }

        if (storedBiometricValue === 'false') {
          setIsBiometricEnabled(false)
        }

        if (storedLanguageValue === 'es' || storedLanguageValue === 'en') {
          setLanguage(storedLanguageValue)
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
        setAuthMessage(error instanceof Error ? error.message : t('Google sign-in failed.', 'Fallo el inicio de sesion con Google.'))
      })
      .finally(() => {
        setIsSigningIn(false)
      })
  }, [googleResponse, t])

  useEffect(() => {
    if (!firebaseUser) {
      setAuthProfile(null)
      setIsCheckingApproval(false)
      setHasBiometricSessionAuth(false)
      setHasSkippedBiometricPrompt(false)
      setIsBiometricPromptOpen(false)
      setLastAutoBiometricAttemptAt(0)
      return
    }

    setHasBiometricSessionAuth(false)
    setHasSkippedBiometricPrompt(false)
    void syncAuthProfile()
  }, [firebaseUser, syncAuthProfile])

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
      setHasBiometricSessionAuth(true)
      setIsBiometricPromptOpen(false)
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
  ])

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
        error instanceof Error
          ? error.message
          : t('Failed to load data.', 'No se pudieron cargar los datos.'),
      )
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [requestWithSession, t])

  useEffect(() => {
    if (!authProfile?.isApproved || (isBiometricEnabled && !hasBiometricSessionAuth)) {
      return
    }

    void loadDashboard(false)
  }, [authProfile?.isApproved, hasBiometricSessionAuth, isBiometricEnabled, loadDashboard])

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
      setTimesheetMessage(error instanceof Error ? error.message : t('Could not load your timesheet.', 'No se pudo cargar tu hoja de horas.'))
    } finally {
      setIsTimesheetLoading(false)
    }
  }, [requestWithSession, t])

  useEffect(() => {
    if (activeScreen !== 'timesheet') {
      return
    }

    if (!authProfile?.isApproved || (isBiometricEnabled && !hasBiometricSessionAuth)) {
      return
    }

    void loadTimesheet()
  }, [activeScreen, authProfile?.isApproved, hasBiometricSessionAuth, isBiometricEnabled, loadTimesheet])

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
      setTimesheetMessage(error instanceof Error ? error.message : t('Could not save timesheet entry.', 'No se pudo guardar la entrada de horas.'))
    } finally {
      setIsTimesheetSaving(false)
    }
  }, [requestWithSession, t, timesheetDate, timesheetHours, timesheetJobNumber, timesheetNotes, timesheetStageId])

  const handleRefreshActiveScreen = useCallback(() => {
    if (activeScreen === 'timesheet') {
      void loadTimesheet()
      return
    }

    if (activeScreen === 'settings') {
      void syncAuthProfile()
      return
    }

    void loadDashboard(true)
  }, [activeScreen, loadDashboard, loadTimesheet, syncAuthProfile])

  useEffect(() => {
    const firstOrderId = mondaySnapshot?.orders?.[0]?.id ?? null

    setSelectedPictureOrderId((previous) => {
      if (previous && mondaySnapshot?.orders?.some((order) => order.id === previous)) {
        return previous
      }

      return firstOrderId
    })
  }, [mondaySnapshot])

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
        value: (mondaySnapshot?.orders ?? []).filter((order) => {
          if (order.isDone) {
            return false
          }

          const daysUntilDue = resolveDaysUntilDue(order)

          return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7
        }).length,
        helper: t('Not shipped, due in 7 days', 'No enviadas, vencen en 7 dias'),
        tone: ORDER_TONES[1],
      },
      {
        key: 'dueInTwoWeeksOrders' as const,
        label: t('Due In 2 Weeks', 'Vencen en 2 semanas'),
        value: (mondaySnapshot?.orders ?? []).filter((order) => {
          if (order.isDone) {
            return false
          }

          const daysUntilDue = resolveDaysUntilDue(order)

          return daysUntilDue !== null && daysUntilDue > 7 && daysUntilDue <= 14
        }).length,
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
    [mondaySnapshot, t],
  )

  const orderBuckets = useMemo(() => {
    const allOrders = mondaySnapshot?.orders ?? []
    const dueThisWeekOrders = allOrders.filter((order) => {
      if (order.isDone) {
        return false
      }

      const daysUntilDue = resolveDaysUntilDue(order)

      return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7
    })

    const dueInTwoWeeksOrders = allOrders.filter((order) => {
      if (order.isDone) {
        return false
      }

      const daysUntilDue = resolveDaysUntilDue(order)

      return daysUntilDue !== null && daysUntilDue > 7 && daysUntilDue <= 14
    })

    return {
      dueThisWeekOrders,
      dueInTwoWeeksOrders,
    }
  }, [mondaySnapshot])

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

    return formatSyncTimestamp(newestRaw, locale)
  }, [locale, mondaySnapshot, supportTicketsSnapshot, t, zendeskSnapshot])

  const detailOrders = useMemo(() => {
    if (!mondaySnapshot || !detailSelection || detailSelection.type !== 'order') {
      return [] as DashboardOrder[]
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
        return [] as DashboardOrder[]
    }
  }, [detailSelection, mondaySnapshot, orderBuckets])

  const detailTickets = useMemo(() => {
    if (!supportTicketsSnapshot || !detailSelection || detailSelection.type !== 'ticket') {
      return [] as SupportTicket[]
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

  const allOrdersForPictures = useMemo(() => mondaySnapshot?.orders ?? [], [mondaySnapshot])

  const filteredOrdersForPictures = useMemo(() => {
    const normalizedQuery = orderSearchQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return allOrdersForPictures
    }

    return allOrdersForPictures.filter((order) =>
      String(order.id).toLowerCase().includes(normalizedQuery),
    )
  }, [allOrdersForPictures, orderSearchQuery])

  const selectedPictureOrder = useMemo(
    () => allOrdersForPictures.find((order) => order.id === selectedPictureOrderId) ?? null,
    [allOrdersForPictures, selectedPictureOrderId],
  )

  const picturesCardHeight = useMemo(
    () => Math.max(320, windowHeight - 330),
    [windowHeight],
  )

  const selectedOrderPhotos = useMemo(() => {
    if (!selectedPictureOrder) {
      return [] as OrderPhoto[]
    }

    return orderPhotosByOrderId[selectedPictureOrder.id] ?? []
  }, [orderPhotosByOrderId, selectedPictureOrder])

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
        quality: 0.75,
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

      setIsUploadingPicture(true)

      const payload = await requestWithSession<{ photo: OrderPhoto }>(
        `/api/orders/${encodeURIComponent(selectedPictureOrder.id)}/photos`,
        false,
        {
          method: 'POST',
          body: JSON.stringify({
            imageBase64: capturedAsset.base64,
            mimeType: capturedAsset.mimeType || 'image/jpeg',
          }),
        },
      )

      setOrderPhotosByOrderId((previous) => ({
        ...previous,
        [selectedPictureOrder.id]: [
          payload.photo,
          ...(previous[selectedPictureOrder.id] ?? []),
        ],
      }))
      setPictureMessage(
        `${t('Saved picture for order', 'Foto guardada para la orden')} ${selectedPictureOrder.name}.`,
      )
    } catch {
      setPictureMessage(
        t('Could not upload picture. Try again.', 'No se pudo subir la foto. Intenta de nuevo.'),
      )
    } finally {
      setIsUploadingPicture(false)
    }
  }, [requestWithSession, selectedPictureOrder, t])

  useEffect(() => {
    if (activeScreen !== 'pictures') {
      setIsPicturesModalOpen(false)
    }
  }, [activeScreen])

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
      <SafeAreaView style={styles.authShell}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>YBK Mobile</Text>
          <Text style={styles.authSubtitle}>{t('Preparing secure login...', 'Preparando inicio de sesion seguro...')}</Text>
          <ActivityIndicator size="small" color="#7fa2ff" />
        </View>
      </SafeAreaView>
    )
  }

  if (!firebaseUser) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>{t('Sign in to YBK', 'Inicia sesion en YBK')}</Text>
          <Text style={styles.authSubtitle}>
            {t(
              'Use Google to access dashboard, support, and pictures from your phone.',
              'Usa Google para acceder al panel, soporte y fotos desde tu telefono.',
            )}
          </Text>

          <Pressable
            style={[styles.authButtonPrimary, (isSigningIn || !hasGoogleClientId) ? styles.buttonDisabled : null]}
            onPress={() => {
              void handleStartGoogleLogin()
            }}
            disabled={isSigningIn || !hasGoogleClientId}
          >
            <Text style={styles.authButtonText}>
              {isSigningIn
                ? t('Signing in...', 'Iniciando sesion...')
                : t('Continue with Google', 'Continuar con Google')}
            </Text>
          </Pressable>

          {!hasGoogleClientId ? (
            <Text style={styles.authCaption}>
              {googleClientIdHint}
            </Text>
          ) : null}

          {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
        </View>
      </SafeAreaView>
    )
  }

  if (!authProfile) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
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

              <Pressable
                style={styles.authButtonPrimary}
                onPress={() => {
                  void syncAuthProfile()
                }}
              >
                <Text style={styles.authButtonText}>{t('Retry', 'Reintentar')}</Text>
              </Pressable>

              <Pressable
                style={styles.authButtonSecondary}
                onPress={() => {
                  void handleSignOut()
                }}
              >
                <Text style={styles.authButtonSecondaryText}>{t('Sign out', 'Cerrar sesion')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    )
  }

  if (!authProfile.isApproved) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>{t('Approval Pending', 'Aprobacion pendiente')}</Text>
          <Text style={styles.authSubtitle}>
            {t(
              'Your account is waiting for admin approval in the website Admin Users page.',
              'Tu cuenta esta esperando aprobacion del administrador en la pagina Admin Users del sitio web.',
            )}
          </Text>
          {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}

          <Pressable
            style={styles.authButtonPrimary}
            onPress={() => {
              void syncAuthProfile()
            }}
          >
            <Text style={styles.authButtonText}>{t('Refresh Approval Status', 'Actualizar estado de aprobacion')}</Text>
          </Pressable>

          <Pressable
            style={styles.authButtonSecondary}
            onPress={() => {
              void handleSignOut()
            }}
          >
            <Text style={styles.authButtonText}>{t('Sign Out', 'Cerrar sesion')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (isBiometricEnabled && !hasBiometricSessionAuth) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>{t('Sign in to continue', 'Inicia sesion para continuar')}</Text>
          <Text style={styles.authSubtitle}>
            {t(
              'Use biometrics to unlock quickly, or sign in with Google instead.',
              'Usa biometria para desbloquear rapido, o inicia sesion con Google.',
            )}
          </Text>

          <Pressable
            style={[styles.authButtonPrimary, isAuthenticatingBiometric ? styles.buttonDisabled : null]}
            onPress={() => {
              void handleAuthenticateBiometric()
            }}
            disabled={isAuthenticatingBiometric}
          >
            <Text style={styles.authButtonText}>
              {isAuthenticatingBiometric ? t('Verifying...', 'Verificando...') : t('Use Biometrics', 'Usar biometria')}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.authButtonSecondary, isSigningIn || !hasGoogleClientId ? styles.buttonDisabled : null]}
            onPress={handleUseGoogleSessionUnlock}
            disabled={isSigningIn || !hasGoogleClientId}
          >
            <Text style={styles.authButtonSecondaryText}>{t('Use Google Instead', 'Usar Google en su lugar')}</Text>
          </Pressable>

          {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
        </View>
      </SafeAreaView>
    )
  }

  const isPicturesScreen = activeScreen === 'pictures'
  const isRefreshBusy = isRefreshing || (activeScreen === 'timesheet' && isTimesheetLoading)

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <View style={styles.contentPane}>
          <ScrollView
            style={isPicturesScreen ? styles.picturesScreenScroll : undefined}
            contentContainerStyle={[
              styles.scrollContent,
              isPicturesScreen ? styles.scrollContentPictures : null,
            ]}
            scrollEnabled={!isPicturesScreen}
          >
            <View style={styles.topBarCard}>
              <View style={styles.topBarLeftGroup}>
                <Pressable
                  style={styles.menuButton}
                  onPress={() => setIsSidebarOpen(true)}
                >
                  <View style={styles.menuIconWrap}>
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                  </View>
                </Pressable>
                <Text style={styles.topBarSyncText}>{t('Last sync', 'Ultima sincronizacion')} {latestSyncText}</Text>
              </View>

              <Pressable
                style={[styles.refreshButton, isRefreshBusy ? styles.buttonDisabled : null]}
                onPress={() => {
                  handleRefreshActiveScreen()
                }}
                disabled={isRefreshBusy}
              >
                <Text style={styles.refreshButtonText}>
                  {isRefreshBusy ? t('Refreshing', 'Actualizando') : t('Refresh', 'Actualizar')}
                </Text>
              </Pressable>
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
              <>
                <Text style={styles.sectionTitle}>{t('Order Snapshot', 'Resumen de ordenes')}</Text>
                <View style={styles.metricsGrid}>
                  {orderMetrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={String(metric.value)}
                      helper={metric.helper}
                      actionLabel={t('Tap to view', 'Tocar para ver')}
                      tone={metric.tone}
                      onPress={() =>
                        setDetailSelection({
                          type: 'order',
                          key: metric.key,
                          label: metric.label,
                        })
                      }
                    />
                  ))}
                </View>

                <Text style={styles.sectionTitle}>{t('Ticket Progress', 'Progreso de tickets')}</Text>
                <View style={styles.metricsGrid}>
                  {ticketMetrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={String(metric.value)}
                      actionLabel={t('Tap to view', 'Tocar para ver')}
                      tone={metric.tone}
                      onPress={() =>
                        setDetailSelection({
                          type: 'ticket',
                          key: metric.key,
                          label: metric.label,
                        })
                      }
                    />
                  ))}
                </View>
              </>
            ) : null}

            {activeScreen === 'pictures' ? (
              <>
                <Text style={styles.sectionTitle}>{t('Pictures', 'Fotos')}</Text>
                <Text style={styles.sectionSubtitle}>
                  {t(
                    'Search an order number, then tap an order to open its pictures popup.',
                    'Busca un numero de orden y toca una orden para abrir su ventana de fotos.',
                  )}
                </Text>

                {allOrdersForPictures.length === 0 ? (
                  <View style={styles.emptyPicturesBox}>
                    <Text style={styles.emptyDetailText}>
                      {t('No orders loaded yet. Refresh to pull current orders.', 'Aun no hay ordenes cargadas. Actualiza para traer las ordenes actuales.')}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.ordersListCard, { height: picturesCardHeight }]}> 
                    <TextInput
                      value={orderSearchQuery}
                      onChangeText={setOrderSearchQuery}
                      placeholder={t('Search by order #', 'Buscar por orden #')}
                      placeholderTextColor="#6a7ea8"
                      style={styles.orderSearchInput}
                      keyboardType="number-pad"
                    />

                    {filteredOrdersForPictures.length === 0 ? (
                      <Text style={styles.emptyDetailText}>{t('No orders match your search.', 'No hay ordenes que coincidan con tu busqueda.')}</Text>
                    ) : (
                      <ScrollView
                        style={styles.ordersListScroll}
                        contentContainerStyle={styles.ordersListContent}
                      >
                        {filteredOrdersForPictures.map((order) => (
                          <Pressable
                            key={order.id}
                            style={styles.orderListItem}
                            onPress={() => {
                              setSelectedPictureOrderId(order.id)
                              setPictureMessage(null)
                              setIsPicturesModalOpen(true)
                              void loadOrderPhotos(order.id)
                            }}
                          >
                            <Text style={styles.orderListName} numberOfLines={1}>
                              {order.name || `Order ${order.id}`}
                            </Text>
                            <Text style={styles.orderListMeta} numberOfLines={1}>
                              {t('Order', 'Orden')} #{order.id}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </>
            ) : null}

            {activeScreen === 'timesheet' ? (
              <>
                <Text style={styles.sectionTitle}>{t('My Daily Timesheet', 'Mi hoja diaria de horas')}</Text>
                <Text style={styles.sectionSubtitle}>
                  {t(
                    'Submit your own daily entries. Reports are managed on the website.',
                    'Envia tus propias entradas diarias. Los reportes se manejan en el sitio web.',
                  )}
                </Text>

                <View style={styles.timesheetCard}>
                  <Text style={styles.timesheetWorkerText}>
                    {timesheetWorker
                      ? `${t('Worker', 'Trabajador')} #${timesheetWorker.workerNumber} • ${timesheetWorker.fullName}`
                      : t('No linked worker profile found yet.', 'Aun no se encontro un perfil de trabajador vinculado.')}
                  </Text>

                  <Pressable
                    style={styles.timesheetDateButton}
                    onPress={() => setIsTimesheetDatePickerOpen(true)}
                  >
                    <Text style={styles.timesheetDateButtonText}>{t('Date', 'Fecha')}: {formatDisplayDate(timesheetDate, locale)}</Text>
                    <Text style={styles.timesheetDateHint}>{timesheetDate}</Text>
                  </Pressable>

                  {isTimesheetDatePickerOpen ? (
                    <View style={styles.timesheetDatePickerWrap}>
                      <DateTimePicker
                        value={selectedTimesheetDate}
                        mode="date"
                        display={Platform.OS === 'android' ? 'calendar' : 'default'}
                        onChange={handleTimesheetDateChange}
                      />
                    </View>
                  ) : null}

                  <View style={styles.timesheetStagePickerWrap}>
                    <Picker
                      selectedValue={timesheetStageId}
                      onValueChange={(value) => setTimesheetStageId(String(value ?? ''))}
                      enabled={timesheetStages.length > 0}
                      style={styles.timesheetStagePicker}
                    >
                      <Picker.Item
                        label={timesheetStages.length > 0 ? t('Select stage', 'Seleccionar etapa') : t('No stages available', 'No hay etapas disponibles')}
                        value=""
                      />
                      {timesheetStages.map((stage) => (
                        <Picker.Item key={stage.id} label={stage.name} value={stage.id} />
                      ))}
                    </Picker>
                  </View>

                  {timesheetStages.length === 0 ? (
                    <Text style={styles.timesheetInlineHint}>
                      {t('No stages found. Add stages on the website first.', 'No se encontraron etapas. Agrega etapas primero en el sitio web.')}
                    </Text>
                  ) : null}

                  <TextInput
                    value={timesheetJobNumber}
                    onChangeText={setTimesheetJobNumber}
                    placeholder={t('Job number', 'Numero de trabajo')}
                    placeholderTextColor="#6a7ea8"
                    style={styles.orderSearchInput}
                  />

                  <TextInput
                    value={timesheetHours}
                    onChangeText={setTimesheetHours}
                    placeholder={t('Hours', 'Horas')}
                    placeholderTextColor="#6a7ea8"
                    style={styles.orderSearchInput}
                    keyboardType="decimal-pad"
                  />

                  <TextInput
                    value={timesheetNotes}
                    onChangeText={setTimesheetNotes}
                    placeholder={t('Notes (optional)', 'Notas (opcional)')}
                    placeholderTextColor="#6a7ea8"
                    style={[styles.orderSearchInput, styles.timesheetNotesInput]}
                    multiline
                  />

                  <Pressable
                    style={[styles.authButtonPrimary, isTimesheetSaving ? styles.buttonDisabled : null]}
                    onPress={() => {
                      void handleSaveTimesheetEntry()
                    }}
                    disabled={isTimesheetSaving || !timesheetWorker || !timesheetStageId || timesheetStages.length === 0}
                  >
                    <Text style={styles.authButtonText}>
                      {isTimesheetSaving ? t('Saving...', 'Guardando...') : t('Save Daily Entry', 'Guardar entrada diaria')}
                    </Text>
                  </Pressable>

                  {timesheetMessage ? <Text style={styles.timesheetMessage}>{timesheetMessage}</Text> : null}
                </View>

                <View style={styles.timesheetCard}>
                  <Text style={styles.timesheetListTitle}>
                    {t('Entries for', 'Entradas para')} {timesheetDate.trim() || t('selected date', 'fecha seleccionada')}
                  </Text>
                  {isTimesheetLoading ? (
                    <View style={styles.inlineLoadingBox}>
                      <ActivityIndicator size="small" color="#335ad8" />
                      <Text style={styles.loadingText}>{t('Loading your entries...', 'Cargando tus entradas...')}</Text>
                    </View>
                  ) : timesheetEntriesForSelectedDate.length === 0 ? (
                    <Text style={styles.emptyDetailText}>{t('No entries for this date yet.', 'Aun no hay entradas para esta fecha.')}</Text>
                  ) : (
                    <View style={styles.timesheetList}>
                      {timesheetEntriesForSelectedDate.map((entry) => (
                        <View key={entry.id} style={styles.timesheetEntryRow}>
                          <Text style={styles.detailPrimary}>{entry.jobName}</Text>
                          <Text style={styles.detailSecondary}>
                            {t('Stage', 'Etapa')}: {timesheetStageNamesById[String(entry.stageId ?? '')] || t('Not set', 'Sin definir')}
                          </Text>
                          <Text style={styles.detailSecondary}>{entry.hours} {t('hours', 'horas')}</Text>
                          {entry.notes ? (
                            <Text style={styles.detailSecondary}>{entry.notes}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </>
            ) : null}

            {activeScreen === 'settings' ? (
              <>
                <Text style={styles.sectionTitle}>{t('Settings', 'Configuracion')}</Text>
                <View style={styles.settingsCard}>
                  <Text style={styles.settingsTitle}>{t('Biometric Sign-In', 'Inicio biometrico')}</Text>
                  <Text style={styles.settingsSubtitle}>
                    {isBiometricEnabled
                      ? t('Biometrics are enabled. You will be asked to verify on login.', 'La biometria esta activada. Se te pedira verificar al iniciar sesion.')
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
                </View>

                <View style={styles.settingsCard}>
                  <Text style={styles.settingsTitle}>{t('Language', 'Idioma')}</Text>
                  <Text style={styles.settingsSubtitle}>
                    {t('Choose your app language.', 'Elige el idioma de la aplicacion.')}
                  </Text>

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
                  </View>
                </View>

                <View style={styles.settingsCard}>
                  <Text style={styles.settingsTitle}>{t('App Updates', 'Actualizaciones')}</Text>
                  <Text style={styles.settingsSubtitle}>
                    {t('Current version', 'Version actual')}: {appVersionLabel}
                  </Text>
                  <Text style={styles.settingsSubtitle}>
                    {canUseOtaUpdates
                      ? t(
                          `Live updates are enabled on channel: ${otaChannelLabel}.`,
                          `Las actualizaciones en vivo estan activadas en el canal: ${otaChannelLabel}.`,
                        )
                      : appUpdateUrl
                      ? t(
                          'Tap below to open your update link and install the newest build.',
                          'Toca abajo para abrir el enlace de actualizacion e instalar la version mas nueva.',
                        )
                      : t(
                          'No update link is configured yet.',
                          'Aun no hay un enlace de actualizacion configurado.',
                        )}
                  </Text>

                  <Pressable
                    style={[styles.settingsToggleButton, isCheckingForUpdates ? styles.buttonDisabled : null]}
                    disabled={isCheckingForUpdates}
                    onPress={() => {
                      void handleCheckForUpdates()
                    }}
                  >
                    <Text style={styles.settingsToggleButtonText}>
                      {isCheckingForUpdates
                        ? t('Checking for updates...', 'Buscando actualizaciones...')
                        : t('Check for Updates', 'Buscar actualizaciones')}
                    </Text>
                  </Pressable>

                  {updateMessage ? <Text style={styles.settingsUpdateMessage}>{updateMessage}</Text> : null}
                </View>
              </>
            ) : null}
          </ScrollView>
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
                      <View key={`${order.id}-${order.name}`} style={styles.detailRow}>
                        <Text style={styles.detailPrimary} numberOfLines={1}>
                          {order.name || `Order ${order.id}`}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {t('Order', 'Orden')} #{order.id} • {order.groupTitle || t('No group', 'Sin grupo')}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {order.statusLabel || t('No status', 'Sin estado')} • {t('Due', 'Vence')} {formatDisplayDate(order.effectiveDueDate, locale)}
                        </Text>
                      </View>
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
          visible={isPicturesModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsPicturesModalOpen(false)}
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
                  onPress={() => setIsPicturesModalOpen(false)}
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
                    {isUploadingPicture ? t('Saving...', 'Guardando...') : t('Take picture', 'Tomar foto')}
                  </Text>
                </Pressable>
              </View>

              {pictureMessage ? <Text style={styles.pictureMessage}>{pictureMessage}</Text> : null}

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {isLoadingOrderPhotos ? (
                  <View style={styles.inlineLoadingBox}>
                    <ActivityIndicator size="small" color="#335ad8" />
                      <Text style={styles.loadingText}>{t('Loading saved pictures...', 'Cargando fotos guardadas...')}</Text>
                  </View>
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
                <Pressable
                  style={[styles.authButtonPrimary, isAuthenticatingBiometric ? styles.buttonDisabled : null]}
                  onPress={() => {
                    void handleAuthenticateBiometric()
                  }}
                  disabled={isAuthenticatingBiometric}
                >
                  <Text style={styles.authButtonText}>
                    {isAuthenticatingBiometric ? t('Verifying...', 'Verificando...') : t('Use Biometrics', 'Usar biometria')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {isSidebarOpen ? (
          <>
            <Pressable style={styles.sidebarScrim} onPress={() => setIsSidebarOpen(false)} />
            <View style={styles.sidebarDrawer}>
              <View style={styles.sidebarBrandBox}>
                <Text style={styles.sidebarBrandA}>A</Text>
                <Text style={styles.sidebarBrandText}>Arnold</Text>
              </View>

              <View style={styles.sidebarNav}>
                {SIDEBAR_ITEMS.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.sidebarItem, activeScreen === item.id ? styles.sidebarItemActive : null]}
                    onPress={() => {
                      setActiveScreen(item.id)
                      if (item.id !== 'dashboard') {
                        setDetailSelection(null)
                      }
                      if (item.id !== 'pictures') {
                        setIsPicturesModalOpen(false)
                      }
                      setIsSidebarOpen(false)
                    }}
                  >
                    <Text style={styles.sidebarItemShort}>{item.shortLabel}</Text>
                    <Text style={styles.sidebarItemLabel}>{localizedScreenLabels[item.id]}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.sidebarActions}>
                <Pressable
                  style={styles.sidebarSignOutButton}
                  onPress={() => {
                    void handleSignOut()
                  }}
                >
                  <Text style={styles.sidebarSignOutText}>{t('Sign Out', 'Cerrar sesion')}</Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  authShell: {
    flex: 1,
    backgroundColor: '#0b1232',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  authCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#334d9f',
    borderRadius: 14,
    backgroundColor: '#131f4a',
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 10,
  },
  authTitle: {
    color: '#f3f7ff',
    fontSize: 20,
    fontWeight: '800',
  },
  authSubtitle: {
    color: '#c8d7ff',
    fontSize: 13,
    lineHeight: 19,
  },
  authMessage: {
    color: '#ffd5de',
    fontSize: 12,
    fontWeight: '600',
  },
  authCaption: {
    color: '#9fb6ff',
    fontSize: 11,
  },
  authButtonPrimary: {
    backgroundColor: '#3d65ef',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  authButtonSecondary: {
    backgroundColor: '#203063',
    borderColor: '#3c5ec7',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  authButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  authButtonSecondaryText: {
    color: '#d9e5ff',
    fontSize: 13,
    fontWeight: '700',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1232',
  },
  shell: {
    flex: 1,
    position: 'relative',
  },
  contentPane: {
    flex: 1,
    backgroundColor: '#eef2ff',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    paddingBottom: 40,
    gap: 8,
  },
  scrollContentPictures: {
    flexGrow: 1,
  },
  picturesScreenScroll: {
    flex: 1,
  },
  topBarCard: {
    backgroundColor: '#111f4b',
    borderRadius: 14,
    borderColor: '#3559db',
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  topBarLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  menuButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3b57b5',
    backgroundColor: '#1a2b68',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconWrap: {
    gap: 3,
  },
  menuLine: {
    width: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#d5e0ff',
  },
  topBarSyncText: {
    color: '#b7c8ff',
    fontWeight: '600',
    flexShrink: 1,
  },
  refreshButton: {
    backgroundColor: '#3d65ef',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 95,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  refreshButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  loadingBox: {
    backgroundColor: '#f9fbff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cdd8f5',
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#445889',
  },
  errorBox: {
    marginBottom: 8,
    backgroundColor: '#ffe8ec',
    borderColor: '#ee9db0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#8e233f',
    fontWeight: '500',
  },
  sectionTitle: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a2550',
    marginBottom: 6,
  },
  sectionSubtitle: {
    color: '#425485',
    marginBottom: 4,
  },
  timesheetCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 8,
  },
  timesheetWorkerText: {
    color: '#1b2a59',
    fontSize: 12,
    fontWeight: '700',
  },
  timesheetDateButton: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  timesheetDateButtonText: {
    color: '#1b2a59',
    fontWeight: '700',
    fontSize: 13,
  },
  timesheetDateHint: {
    color: '#536895',
    fontSize: 11,
  },
  timesheetDatePickerWrap: {
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  timesheetStagePickerWrap: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  timesheetStagePicker: {
    color: '#1b2a59',
  },
  timesheetInlineHint: {
    color: '#6b7fa8',
    fontSize: 12,
  },
  timesheetNotesInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  timesheetMessage: {
    color: '#204fc2',
    fontSize: 12,
    fontWeight: '600',
  },
  timesheetListTitle: {
    color: '#1b2a59',
    fontSize: 14,
    fontWeight: '700',
  },
  timesheetList: {
    gap: 8,
    marginTop: 6,
  },
  timesheetEntryRow: {
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  settingsCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 10,
  },
  settingsTitle: {
    color: '#1a2550',
    fontSize: 16,
    fontWeight: '800',
  },
  settingsSubtitle: {
    color: '#4e6294',
    fontSize: 13,
    lineHeight: 18,
  },
  settingsToggleButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#203063',
    borderColor: '#3c5ec7',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  settingsToggleButtonText: {
    color: '#d9e5ff',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsLanguageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  settingsLanguageButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    alignItems: 'center',
  },
  settingsLanguageButtonActive: {
    borderColor: '#3c5ec7',
    backgroundColor: '#e8eeff',
  },
  settingsLanguageButtonText: {
    color: '#22366f',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsUpdateMessage: {
    color: '#204fc2',
    fontSize: 12,
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 116,
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: '#1a2345',
    shadowOpacity: 0.09,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  metricCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    marginTop: 4,
    fontWeight: '800',
    fontSize: 24,
  },
  metricHelper: {
    marginTop: 4,
    fontSize: 11,
  },
  metricActionText: {
    marginTop: 6,
    fontSize: 11,
    color: '#1a2550',
    fontWeight: '700',
  },
  detailPanel: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 8,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  detailTitle: {
    color: '#1a2550',
    fontWeight: '800',
    fontSize: 17,
    flexShrink: 1,
  },
  detailCloseButton: {
    backgroundColor: '#273c84',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailCloseButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  detailRow: {
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  detailPrimary: {
    color: '#1b2a59',
    fontWeight: '700',
    fontSize: 13,
  },
  detailSecondary: {
    color: '#536895',
    fontSize: 12,
  },
  emptyDetailText: {
    color: '#5a6f99',
    fontSize: 13,
  },
  emptyPicturesBox: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
  },
  ordersListCard: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 10,
  },
  orderSearchInput: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    color: '#1b2a59',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontWeight: '600',
  },
  ordersListScroll: {
    flex: 1,
  },
  ordersListContent: {
    gap: 8,
    paddingBottom: 8,
  },
  orderListItem: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    gap: 2,
  },
  orderListName: {
    color: '#22366f',
    fontSize: 13,
    fontWeight: '700',
  },
  orderListMeta: {
    color: '#4e6294',
    fontSize: 12,
    fontWeight: '600',
  },
  orderPickerChip: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    maxWidth: 210,
  },
  orderPickerChipSelected: {
    borderColor: '#3f63e8',
    backgroundColor: '#dce6ff',
  },
  orderPickerChipText: {
    color: '#22366f',
    fontSize: 12,
    fontWeight: '600',
  },
  orderPickerChipTextSelected: {
    color: '#1a2f72',
  },
  pictureActionCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 8,
  },
  pictureActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pictureOrderTextBlock: {
    flex: 1,
    gap: 1,
  },
  pictureOrderTitle: {
    color: '#1b2a59',
    fontWeight: '800',
    fontSize: 14,
  },
  pictureOrderMeta: {
    color: '#4e6294',
    fontSize: 12,
  },
  takePictureButton: {
    backgroundColor: '#204fc2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  takePictureButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  pictureMessage: {
    color: '#204fc2',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  pictureModalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 4,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  photoTile: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#e2e8ff',
  },
  photoTileCaption: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#4b6191',
    fontWeight: '600',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 16, 46, 0.46)',
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  modalCard: {
    maxHeight: '82%',
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 14,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 10,
  },
  confirmCard: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 14,
    backgroundColor: '#f9fbff',
    padding: 14,
    gap: 10,
  },
  confirmTitle: {
    color: '#1a2550',
    fontSize: 18,
    fontWeight: '800',
  },
  confirmText: {
    color: '#4e6294',
    fontSize: 13,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  confirmCancelButton: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  confirmCancelButtonText: {
    color: '#38508a',
    fontSize: 12,
    fontWeight: '700',
  },
  confirmDangerButton: {
    borderWidth: 1,
    borderColor: '#9d4a63',
    borderRadius: 10,
    backgroundColor: '#512037',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  confirmDangerButtonText: {
    color: '#ffdbe5',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBodyContent: {
    gap: 8,
    paddingBottom: 8,
  },
  sidebarScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 18, 50, 0.28)',
  },
  sidebarDrawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 220,
    backgroundColor: '#101836',
    borderRightWidth: 1,
    borderRightColor: '#1f2a56',
    paddingTop: 46,
    paddingHorizontal: 10,
  },
  sidebarBrandBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  sidebarBrandA: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#3c62f0',
    color: '#ffffff',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '800',
    overflow: 'hidden',
  },
  sidebarBrandText: {
    color: '#ced8ff',
    fontSize: 18,
    fontWeight: '700',
  },
  sidebarNav: {
    gap: 10,
  },
  sidebarActions: {
    marginTop: 18,
    gap: 10,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a376f',
    backgroundColor: '#16224a',
  },
  sidebarItemActive: {
    borderColor: '#7fa2ff',
    backgroundColor: '#2a3f8e',
  },
  sidebarItemShort: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#0f1739',
    color: '#c8d4ff',
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
  sidebarItemLabel: {
    marginLeft: 10,
    color: '#d2dcff',
    fontWeight: '600',
  },
  sidebarActionButton: {
    borderWidth: 1,
    borderColor: '#3c5ec7',
    borderRadius: 10,
    backgroundColor: '#18295e',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  sidebarActionLabel: {
    color: '#d9e3ff',
    fontWeight: '700',
    fontSize: 12,
  },
  sidebarSignOutButton: {
    borderWidth: 1,
    borderColor: '#9d4a63',
    borderRadius: 10,
    backgroundColor: '#512037',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  sidebarSignOutText: {
    color: '#ffdbe5',
    fontWeight: '700',
    fontSize: 12,
  },
})
