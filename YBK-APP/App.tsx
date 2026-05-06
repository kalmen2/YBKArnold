import AsyncStorage from '@react-native-async-storage/async-storage'
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import * as Google from 'expo-auth-session/providers/google'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import * as ImagePicker from 'expo-image-picker'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'
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
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
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
import { ORDER_TONES, SIDEBAR_ITEMS, TICKET_TONES } from './appConstants'
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
const ORDERS_PAGE_SIZE = 10

type AppUpdateStatusResponse = {
  url?: string | null
  build?: number | string | null
  version?: string | null
}

type SettingsMenuId = 'security' | 'language' | 'notifications' | 'updates' | 'account'

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

function toTimestampMs(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? '').trim())

  return Number.isFinite(timestamp) ? timestamp : null
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
  const [ordersSearchQuery, setOrdersSearchQuery] = useState('')
  const [ordersPage, setOrdersPage] = useState(1)
  const [selectedOrderForDetails, setSelectedOrderForDetails] = useState<DashboardOrder | null>(null)
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
  const [registeredPushToken, setRegisteredPushToken] = useState<string | null>(null)
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(true)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [resolvedUpdateUrl, setResolvedUpdateUrl] = useState('')
  const [activeSettingsMenuId, setActiveSettingsMenuId] = useState<SettingsMenuId | null>(null)

  const isSpanish = language === 'es'
  const locale = isSpanish ? 'es-ES' : 'en-US'
  const t = useCallback((english: string, spanish: string) => (isSpanish ? spanish : english), [isSpanish])
  const getErrorMessage = useCallback(
    (error: unknown, englishFallback: string, spanishFallback: string) => {
      return error instanceof Error ? error.message : t(englishFallback, spanishFallback)
    },
    [t],
  )
  const isBiometricLocked = isBiometricEnabled && !hasBiometricSessionAuth
  const hasApprovedSessionAccess = Boolean(authProfile?.isApproved) && !isBiometricLocked
  const hasManagerSheetAccess = Boolean(authProfile?.isAdmin || authProfile?.isManager)

  const localizedScreenLabels = useMemo<Record<AppScreen, string>>(
    () => ({
      dashboard: t('Dashboard', 'Panel'),
      orders: t('Orders', 'Ordenes'),
      pictures: t('Pictures', 'Fotos'),
      timesheet: t('Timesheet', 'Horas'),
      manager: t('Manager Sheet', 'Hoja gerente'),
      alerts: t('Notifications', 'Notificaciones'),
      settings: t('Settings', 'Configuracion'),
    }),
    [t],
  )

  const sidebarItems = useMemo(
    () => SIDEBAR_ITEMS.filter((item) => item.id !== 'manager' || hasManagerSheetAccess),
    [hasManagerSheetAccess],
  )

  const dashboardUnreadSummary = useMemo(() => {
    if (alertsUnreadCount <= 0) {
      return null
    }

    if (isSpanish) {
      return alertsUnreadCount === 1
        ? 'Tienes 1 mensaje sin leer.'
        : `Tienes ${alertsUnreadCount} mensajes sin leer.`
    }

    return alertsUnreadCount === 1
      ? 'You have 1 unread message.'
      : `You have ${alertsUnreadCount} unread messages.`
  }, [alertsUnreadCount, isSpanish])

  const installedNativeVersion = useMemo(
    () => String(Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? 'unknown').trim() || 'unknown',
    [],
  )

  const installedNativeBuildLabel = useMemo(() => {
    const nativeBuild = String(Constants.nativeBuildVersion ?? '').trim()

    if (nativeBuild) {
      return nativeBuild
    }

    const fallbackBuild =
      Platform.OS === 'android'
        ? Constants.expoConfig?.android?.versionCode
        : Constants.expoConfig?.ios?.buildNumber

    return String(fallbackBuild ?? '').trim()
  }, [])

  const installedNativeBuildNumber = useMemo(() => {
    const parsed = Number(installedNativeBuildLabel)

    return Number.isFinite(parsed) ? parsed : null
  }, [installedNativeBuildLabel])

  const appVersionLabel = useMemo(() => {
    return installedNativeBuildLabel
      ? `v${installedNativeVersion} (${installedNativeBuildLabel})`
      : `v${installedNativeVersion}`
  }, [installedNativeBuildLabel, installedNativeVersion])

  const settingsMenuItems = useMemo<Array<{ id: SettingsMenuId; title: string; subtitle: string; status: string }>>(
    () => [
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
        status: language === 'es' ? 'Espanol' : 'English',
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
      {
        id: 'account',
        title: t('Account', 'Cuenta'),
        subtitle: t('Sign-out and session actions.', 'Acciones de sesion y cierre de sesion.'),
        status: t('Open', 'Abrir'),
      },
    ],
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
      const latestBuildNumber = Number(payload?.build)
      const candidateUpdateUrl = withBuildQuery(backendUpdateUrl, latestBuildNumber)
      const latestVersion = String(payload?.version ?? '').trim()
      const hasComparableBuilds = Number.isFinite(latestBuildNumber) && installedNativeBuildNumber !== null
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
      if (latestVersion && Number.isFinite(latestBuildNumber)) {
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
    setIsSidebarOpen(false)
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

        if (storedLanguageValue === 'es' || storedLanguageValue === 'en') {
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
      setAlertsMessage(null)
      lockBiometricSession()
      setLastAutoBiometricAttemptAt(0)
      return
    }

    setPasswordSignInValue('')
    lockBiometricSession()
    void syncAuthProfile()
  }, [closeSettingsMenu, firebaseUser, lockBiometricSession, syncAuthProfile])

  useEffect(() => {
    if (activeScreen === 'manager' && !hasManagerSheetAccess) {
      setActiveScreen('dashboard')
    }
  }, [activeScreen, hasManagerSheetAccess])

  useEffect(() => {
    if (activeScreen !== 'manager') {
      setIsManagerDatePickerOpen(false)
    }
  }, [activeScreen])

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
      }>('/api/timesheet/state')

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

    void loadDashboard(true)
  }, [activeScreen, handleCheckForUpdates, loadAlerts, loadDashboard, loadManagerSheet, loadTimesheet, syncAuthProfile])

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

    return formatSyncTimestamp(newestRaw, locale)
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

  const filteredOrdersForList = useMemo(() => {
    const normalizedQuery = ordersSearchQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return allOrdersForPictures
    }

    return allOrdersForPictures.filter((order) => {
      const orderId = String(order.id ?? '').toLowerCase()
      const orderName = String(order.name ?? '').toLowerCase()
      return orderId.includes(normalizedQuery) || orderName.includes(normalizedQuery)
    })
  }, [allOrdersForPictures, ordersSearchQuery])

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
  }, [ordersSearchQuery])

  useEffect(() => {
    setOrdersPage((current) => Math.min(current, ordersTotalPages))
  }, [ordersTotalPages])

  const selectedPictureOrder = useMemo(
    () => allOrdersForPictures.find((order) => order.id === selectedPictureOrderId) ?? null,
    [allOrdersForPictures, selectedPictureOrderId],
  )

  const picturesCardHeight = useMemo(
    () => Math.max(320, windowHeight - 330),
    [windowHeight],
  )

  const ordersCardHeight = useMemo(
    () => Math.max(360, windowHeight - 330),
    [windowHeight],
  )

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

      insightsByOrderId[orderId] = {
        readyPercent: sameDayRow?.savedReadyPercent ?? latestProgress?.readyPercent ?? null,
        workerCount: sameDayRow?.workerCount ?? 0,
        totalHours: sameDayRow?.totalHours ?? 0,
        updatedAt: sameDayRow?.updatedAt ?? latestProgress?.updatedAt ?? null,
      }
    })

    return insightsByOrderId
  }, [allOrdersForPictures, latestManagerProgressByOrderId, managerRowByOrderId])

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

  const handleOpenOrderShopDrawing = useCallback(async (order: DashboardOrder) => {
    const cachedPreviewUrl = String(order.shopDrawingCachedUrl ?? '').trim()
    const orderId = String(order.id ?? '').trim()

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
      setOrdersDetailMessage(null)
    }
  }, [activeScreen])

  const handleSelectSidebarItem = useCallback((nextScreen: AppScreen) => {
    setActiveScreen(nextScreen)

    if (nextScreen !== 'dashboard') {
      setDetailSelection(null)
    }

    if (nextScreen !== 'pictures') {
      closePicturesModal()
    }

    if (nextScreen !== 'orders') {
      setSelectedOrderForDetails(null)
      setOrdersDetailMessage(null)
    }

    if (nextScreen !== 'settings') {
      closeSettingsMenu()
    }

    setIsSidebarOpen(false)
  }, [closePicturesModal, closeSettingsMenu])

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

  const usesNestedListScroll = activeScreen === 'pictures' || activeScreen === 'orders'
  const isRefreshBusy =
    isRefreshing
    || (activeScreen === 'timesheet' && isTimesheetLoading)
    || (activeScreen === 'manager' && (isManagerLoading || isManagerSaving))
    || (activeScreen === 'alerts' && isAlertsLoading)
    || (activeScreen === 'settings' && (isCheckingForUpdates || isInstallingUpdate))

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
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
                  setOrdersDetailMessage(null)
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
                isAlertsLoading={isAlertsLoading}
                alerts={alerts}
                alertsMessage={alertsMessage}
                onMarkAlertAsRead={(alertItem) => {
                  void markAlertAsRead(alertItem)
                }}
              />
            ) : null}

            {activeScreen === 'settings' ? (
              <SettingsOverviewSection
                t={t}
                appVersionLabel={appVersionLabel}
                isNotificationsEnabled={isNotificationsEnabled}
                settingsMenuItems={settingsMenuItems}
                onSelectSettingsMenu={setActiveSettingsMenuId}
              />
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
          visible={Boolean(selectedOrderForDetails)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedOrderForDetails(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>
                  {selectedOrderForDetails
                    ? `${t('Order', 'Orden')} #${selectedOrderForDetails.id}`
                    : t('Order details', 'Detalles de la orden')}
                </Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => setSelectedOrderForDetails(null)}
                >
                  <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
                </Pressable>
              </View>

              {selectedOrderForDetails ? (
                <ScrollView contentContainerStyle={styles.modalBodyContent}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailPrimary}>
                      {selectedOrderForDetails.name || `${t('Order', 'Orden')} ${selectedOrderForDetails.id}`}
                    </Text>
                    <Text style={styles.detailSecondary}>
                      {t('Status', 'Estado')}: {selectedOrderForDetails.statusLabel || t('No status', 'Sin estado')}
                    </Text>
                    <Text style={styles.detailSecondary}>
                      {t('Group', 'Grupo')}: {selectedOrderForDetails.groupTitle || t('No group', 'Sin grupo')}
                    </Text>
                    <Text style={styles.detailSecondary}>
                      {t('Due', 'Vence')}: {formatDisplayDate(selectedOrderForDetails.effectiveDueDate, locale)}
                    </Text>
                  </View>

                  <Pressable
                    style={[
                      styles.orderDetailActionButton,
                      (!selectedOrderForDetails.shopDrawingCachedUrl && !selectedOrderForDetails.id)
                        ? styles.orderDetailActionButtonDisabled
                        : null,
                    ]}
                    onPress={() => {
                      void handleOpenOrderShopDrawing(selectedOrderForDetails)
                    }}
                  >
                    <Text style={styles.orderDetailActionButtonText}>
                      {t('Open Shop Drawing', 'Abrir Shop Drawing')}
                    </Text>
                  </Pressable>

                  {ordersDetailMessage ? (
                    <Text style={styles.orderDetailMessage}>{ordersDetailMessage}</Text>
                  ) : null}
                </ScrollView>
              ) : null}
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

        {isSidebarOpen ? (
          <>
            <Pressable style={styles.sidebarScrim} onPress={() => setIsSidebarOpen(false)} />
            <View style={styles.sidebarDrawer}>
              <View style={styles.sidebarBrandBox}>
                <Text style={styles.sidebarBrandA}>A</Text>
                <Text style={styles.sidebarBrandText}>Arnold</Text>
              </View>

              <View style={styles.sidebarNav}>
                {sidebarItems.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.sidebarItem, activeScreen === item.id ? styles.sidebarItemActive : null]}
                    onPress={() => handleSelectSidebarItem(item.id)}
                  >
                    <Text style={styles.sidebarItemShort}>{item.shortLabel}</Text>
                    <View style={styles.sidebarItemLabelRow}>
                      <Text style={styles.sidebarItemLabel}>{localizedScreenLabels[item.id]}</Text>
                      {item.id === 'alerts' && alertsUnreadCount > 0 ? (
                        <View style={styles.sidebarAlertBadge}>
                          <Text style={styles.sidebarAlertBadgeText}>
                            {alertsUnreadCount > 99 ? '99+' : String(alertsUnreadCount)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
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

