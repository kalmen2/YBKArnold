import { randomUUID } from 'node:crypto'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import * as functions from 'firebase-functions/v1'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { registerAiRoutes } from './src/routes/ai-routes.mjs'
import { registerAlertsRoutes } from './src/routes/alerts-routes.mjs'
import { registerAuthRoutes } from './src/routes/auth-routes.mjs'
import { registerCrmRoutes } from './src/routes/crm-routes.mjs'
import { registerDashboardSupportRoutes } from './src/routes/dashboard-support-routes.mjs'
import { registerOrderPhotoRoutes } from './src/routes/order-photos-routes.mjs'
import { registerOrdersRoutes } from './src/routes/orders-routes.mjs'
import { registerPurchasingRoutes } from './src/routes/purchasing-routes.mjs'
import { registerQuickBooksRoutes } from './src/routes/quickbooks-routes.mjs'
import { registerTimesheetRoutes } from './src/routes/timesheet-routes.mjs'
import { createAuthUtils } from './src/services/auth-utils.mjs'
import { createAuthActivityService } from './src/services/auth-activity-service.mjs'
import { createAuthRequestService } from './src/services/auth-request-service.mjs'
import { createDashboardCacheService } from './src/services/dashboard-cache-service.mjs'
import { createMondayDashboardService } from './src/services/monday-dashboard-service.mjs'
import { createMondayOrderPersistenceService } from './src/services/monday-order-persistence-service.mjs'
import { createMondaySnapshotService } from './src/services/monday-snapshot-service.mjs'
import { createMongoCollectionsService } from './src/services/mongo-collections-service.mjs'
import { createOrdersUnifiedService } from './src/services/orders-unified-service.mjs'
import { createOrderPhotoService } from './src/services/order-photo-service.mjs'
import { createPlatformConfigService } from './src/services/platform-config-service.mjs'
import { createPushAlertService } from './src/services/push-alert-service.mjs'
import { createOpenAiService } from './src/services/openai-service.mjs'
import { createZendeskDashboardService } from './src/services/zendesk-dashboard-service.mjs'
import { createZendeskHelperService } from './src/services/zendesk-helper-service.mjs'
import {
  allocateWorkerNumbers,
  ensureEntriesHavePayRates,
  ensureWorkersHaveWorkerNumbers,
  normalizeJobName,
  normalizeStageName,
  normalizeWorkerNumber,
  validateEntryFields,
  validateEntryInput,
  validateWorkerInput,
} from './src/services/timesheet-helpers.mjs'
import {
  normalizeLookupValue,
  normalizeOptionalBuildNumber,
  normalizeOptionalShortText,
  toBoundedInteger,
  toNonNegativeInteger,
} from './src/utils/value-utils.mjs'

export const app = express()

const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '').trim()
  ? String(process.env.ALLOWED_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean)
  : []

// Gzip compress all API responses — reduces payload size by 60-80% on large
// dealer/contact lists, cutting both transfer time and Firebase egress costs.
app.use(compression())

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
}))
app.use(express.json({ limit: '12mb' }))

// General API rate limit: 300 requests per minute per IP
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}))

// Tighter limit on expensive write/import operations
const heavyOperationsLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})
app.use('/api/crm/imports', heavyOperationsLimit)
app.use('/api/orders/:orderId/photos', heavyOperationsLimit)

// /api/orders/refresh hits Monday + QuickBooks live. Capped at 1 per 2 minutes
// per IP — refreshing more often risks hitting Monday's rate limits.
const ordersRefreshLimit = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Refresh is rate-limited to once every 2 minutes.' },
})
app.use('/api/orders/refresh', ordersRefreshLimit)

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
    res.set('Surrogate-Control', 'no-store')
  }

  next()
})

const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_system'
const mondayApiUrl = process.env.MONDAY_API_URL ?? 'https://api.monday.com/v2'
const mondayApiToken = String(process.env.MONDAY_API_TOKEN ?? '').trim()
const mondayBoardId = String(process.env.MONDAY_BOARD_ID ?? '').trim()
const mondayBoardUrl = String(process.env.MONDAY_BOARD_URL ?? '').trim()
const mondayOrderDateColumnId = String(process.env.MONDAY_ORDER_DATE_COLUMN_ID ?? '').trim()
const mondayDueDateColumnId = String(process.env.MONDAY_DUE_DATE_COLUMN_ID ?? '').trim()
const mondayLeadTimeColumnId = String(process.env.MONDAY_LEAD_TIME_COLUMN_ID ?? '').trim()
const mondayShipDateColumnId = String(process.env.MONDAY_SHIP_DATE_COLUMN_ID ?? '').trim()
const mondayShippedBoardId = String(process.env.MONDAY_SHIPPED_BOARD_ID ?? '').trim()
const mondayShippedBoardUrl = String(process.env.MONDAY_SHIPPED_BOARD_URL ?? '').trim()
const mondayPreproductionBoardId = String(
  process.env.MONDAY_PREPRODUCTION_BOARD_ID
  ?? '1064270065',
).trim()
const mondayPreproductionBoardUrl = String(
  process.env.MONDAY_PREPRODUCTION_BOARD_URL
  ?? 'https://arnoldcontract.monday.com/boards/1064270065',
).trim()
const zendeskApiToken = String(process.env.ZENDESK_API_TOKEN ?? '').trim()
const zendeskEmail = String(process.env.ZENDESK_EMAIL ?? '').trim()
const zendeskUrl = String(process.env.ZENDESK_URL ?? '').trim()
const firebaseProjectId = String(
  process.env.FIREBASE_PROJECT_ID
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCLOUD_PROJECT
    ?? '',
).trim()
const firebaseStorageBucketName = String(
  process.env.APP_STORAGE_BUCKET ?? '',
).trim()
const ownerEmail = String(process.env.OWNER_EMAIL ?? '').trim()
const authRoleStandard = 'standard'
const authRoleManager = 'manager'
const authRoleAdmin = 'admin'
const authApprovalPending = 'pending'
const authApprovalApproved = 'approved'
const authAccessTimeZoneUtc = 'UTC'
const authAccessTimeZoneNewJersey = 'America/New_York'
const authClientPlatformWeb = 'web'
const authClientPlatformApp = 'app'
const authClientAccessModeWebAndApp = 'web_and_app'
const authClientAccessModeWebOnly = 'web_only'
const authClientAccessModeAppOnly = 'app_only'
const mobileAlertTargetModeAll = 'all'
const mobileAlertTargetModeSelected = 'selected'
const mobilePushTokenProviderExpo = 'expo'
const mobilePushTokenProviderFcm = 'fcm'
const defaultMobileAndroidUpdateUrl = String(process.env.MOBILE_ANDROID_UPDATE_URL ?? '').trim()
const defaultMobileIosUpdateUrl = String(process.env.MOBILE_IOS_UPDATE_URL ?? '').trim()
const defaultMobileAndroidLatestBuild = Number(process.env.MOBILE_ANDROID_LATEST_BUILD ?? 0)
const defaultMobileIosLatestBuild = Number(process.env.MOBILE_IOS_LATEST_BUILD ?? 0)
const defaultMobileLatestVersion = String(process.env.MOBILE_LATEST_VERSION ?? '').trim()
const expoPushApiUrl = 'https://exp.host/--/api/v2/push/send'
const openAiApiKey = String(process.env.OPENAI_API_KEY ?? '').trim()
const zendeskTicketFieldCacheTtlMs = 30 * 60 * 1000
const zendeskTicketFieldErrorCacheTtlMs = 5 * 60 * 1000
const dashboardDailyRefreshCron = String(process.env.DASHBOARD_DAILY_REFRESH_CRON ?? '0 17 * * *').trim() || '0 17 * * *'
const dashboardDailyRefreshTimeZone =
  String(process.env.DASHBOARD_DAILY_REFRESH_TIMEZONE ?? authAccessTimeZoneNewJersey).trim()
  || authAccessTimeZoneNewJersey
const shipTransitionRecentWindowHours = Number(process.env.MONDAY_SHIP_TRANSITION_WINDOW_HOURS ?? 72)
const systemRunLogsSnapshotKey = 'system_run_logs'
const maxSystemRunLogs = 300

// Validate required environment variables at startup
const missingEnvVars = [
  !mongoUri && 'MONGODB_URI',
  !ownerEmail && 'OWNER_EMAIL',
  !firebaseStorageBucketName && 'APP_STORAGE_BUCKET',
].filter(Boolean)

const isCloudFunctionsRuntime = Boolean(
  process.env.K_SERVICE
  || process.env.FUNCTION_TARGET
  || process.env.FUNCTION_NAME,
)

if (isCloudFunctionsRuntime && missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '))
}

if (getApps().length === 0) {
  const firebaseAdminOptions = {}

  if (firebaseProjectId) {
    firebaseAdminOptions.projectId = firebaseProjectId
  }

  if (firebaseStorageBucketName) {
    firebaseAdminOptions.storageBucket = firebaseStorageBucketName
  }

  initializeApp(Object.keys(firebaseAdminOptions).length > 0 ? firebaseAdminOptions : undefined)
}

const reviewerLoginEmails = String(
  process.env.MOBILE_REVIEWER_EMAILS
    ?? process.env.MOBILE_REVIEWER_EMAIL
    ?? '',
)

const {
  formatAuthLoginHoursWindow,
  isAllowedByAuthLoginHours,
  isApprovedAdminUser,
  isReviewerLoginEmail,
  normalizeAuthAccessTimeZone,
  normalizeAuthClientAccessMode,
  normalizeAuthClientPlatform,
  normalizeAuthRole,
  normalizeEmail,
  parseOptionalAuthAccessTimeZone,
  parseOptionalAuthHour,
  resolveAuthClientPlatformFromRequest,
  toPublicAuthUser,
} = createAuthUtils({
  authAccessTimeZoneNewJersey,
  authAccessTimeZoneUtc,
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeAppOnly,
  authClientAccessModeWebAndApp,
  authClientAccessModeWebOnly,
  authClientPlatformApp,
  authClientPlatformWeb,
  authRoleAdmin,
  authRoleManager,
  authRoleStandard,
  normalizeWorkerNumber,
  ownerEmail,
  reviewerLoginEmails,
})

const {
  buildOrderPhotoDownloadFileName,
  decodeBase64Image,
  deleteOrderPhotoRecord,
  getOrderPhotosBucket,
  isSupportedPhotoMimeType,
  listAllOrderPhotoGroups,
  listOrderPhotoRecords,
  normalizeOrderPhotoOrderId,
  normalizeOrderPhotoPath,
  saveOrderPhotoRecord,
} = createOrderPhotoService({
  firebaseStorageBucketName,
})

const {
  isPushTokenUnregisteredError,
  normalizeAnyPushToken,
  normalizeMobileAlertTargetMode,
  redactPushTokenForLog,
  sendExpoPushMessages,
  sendFcmPushMessages,
  toPublicMobileAlert,
} = createPushAlertService({
  expoPushApiUrl,
  mobileAlertTargetModeAll,
  mobileAlertTargetModeSelected,
  mobilePushTokenProviderExpo,
  mobilePushTokenProviderFcm,
})

const {
  buildZendeskAgentUrl,
  buildZendeskApiBaseUrl,
  buildZendeskAuthorizationHeader,
  buildZendeskOrigin,
  ensureMondayConfiguration,
  ensureZendeskConfiguration,
} = createPlatformConfigService({
  mondayApiToken,
  mondayBoardId,
  zendeskApiToken,
  zendeskEmail,
  zendeskUrl,
})

const {
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
} = createMondayDashboardService({
  columnOverrides: {
    dueDateColumnId: mondayDueDateColumnId || null,
    leadTimeColumnId: mondayLeadTimeColumnId || null,
    orderDateColumnId: mondayOrderDateColumnId || null,
    shipDateColumnId: mondayShipDateColumnId || null,
  },
  mondayBoardUrl,
  normalizeLookupValue,
})

const {
  buildZendeskCustomStatusMap,
  buildZendeskStatusQueries,
  isZendeskOrderNumberTicketField,
  normalizeZendeskSupportTicket,
  resolveZendeskCustomStatusId,
} = createZendeskHelperService({
  buildZendeskOrigin,
  normalizeLookupValue,
})

const {
  createZendeskTicketReply,
  createZendeskSupportTicket,
  fetchZendeskSupportAgentById,
  fetchZendeskSupportAgents,
  fetchZendeskSupportAlertTicketsSnapshot,
  fetchZendeskSupportAlerts,
  fetchZendeskSupportTicketsSnapshot,
  fetchZendeskTicketConversation,
  fetchZendeskTicketSummary,
} = createZendeskDashboardService({
  buildZendeskAgentUrl,
  buildZendeskApiBaseUrl,
  buildZendeskAuthorizationHeader,
  ensureZendeskConfiguration,
  buildZendeskCustomStatusMap,
  buildZendeskStatusQueries,
  isZendeskOrderNumberTicketField,
  normalizeZendeskSupportTicket,
  resolveZendeskCustomStatusId,
  toBoundedInteger,
  zendeskEmail,
  zendeskTicketFieldCacheTtlMs,
  zendeskTicketFieldErrorCacheTtlMs,
})

const {
  generateSupportReply,
  batchSummarizeComments,
  chatForRules,
  findExactItemPurchaseOptions,
  resolvePurchasingItemSearchMatches,
} = createOpenAiService({ openAiApiKey })

const {
  clearSupportSnapshotCache,
  getDashboardSnapshotFromCache,
  isDashboardRefreshRequested,
  setDashboardSnapshotCache,
} = createDashboardCacheService({
  getCollections,
})

const {
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
} = createAuthActivityService()

const mondayItemsPageQuery = `
query GetBoardItems($boardId: ID!, $limit: Int!, $cursor: String) {
  boards(ids: [$boardId]) {
    id
    name
    items_page(limit: $limit, cursor: $cursor) {
      cursor
      items {
        id
        name
        created_at
        updated_at
        group {
          id
          title
        }
        column_values {
          id
          type
          text
          value
          column {
            title
          }
        }
      }
    }
  }
}
`

function buildMondayItemsPageQuery(columnIds) {
  const ids = Array.isArray(columnIds)
    ? columnIds
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0)
    : []

  if (ids.length === 0) {
    return mondayItemsPageQuery
  }

  const idsLiteral = `[${ids.map((id) => JSON.stringify(id)).join(', ')}]`

  return `
query GetBoardItems($boardId: ID!, $limit: Int!, $cursor: String) {
  boards(ids: [$boardId]) {
    id
    name
    items_page(limit: $limit, cursor: $cursor) {
      cursor
      items {
        id
        name
        created_at
        updated_at
        group {
          id
          title
        }
        column_values(ids: ${idsLiteral}) {
          id
          type
          text
          value
          column {
            title
          }
        }
      }
    }
  }
}
`
}

const {
  fetchMondayAssetDownloadInfo,
  fetchMondayBoardItemNames,
  fetchMondayBoardItemsByIds,
  fetchMondayDashboardSnapshot,
  invalidateMondayBoardNamesCache,
} = createMondaySnapshotService({
  ensureMondayConfiguration,
  mondayApiUrl,
  mondayApiToken,
  mondayBoardId,
  mondayBoardUrl,
  mondayItemsPageQuery,
  buildMondayItemsPageQuery,
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
})

const mongoCollectionsService = createMongoCollectionsService({
  mongoDbName,
  mongoUri,
})

async function getCollections() {
  return mongoCollectionsService.getCollections()
}

const { persistNewMondayOrders } = createMondayOrderPersistenceService({
  fetchMondayAssetDownloadInfo,
  getCollections,
  getOrderPhotosBucket,
  mondayBoardId,
  mondayShippedBoardId,
  randomUUID,
})

const { refreshOrdersUnifiedCollection } = createOrdersUnifiedService({
  fetchMondayBoardItemNames,
  fetchMondayBoardItemsByIds,
  fetchMondayDashboardSnapshot,
  getCollections,
  invalidateMondayBoardNamesCache,
  mondayBoardId,
  mondayBoardUrl,
  mondayPreproductionBoardId,
  mondayPreproductionBoardUrl,
  mondayShippedBoardId,
  mondayShippedBoardUrl,
  persistNewMondayOrders,
  setDashboardSnapshotCache,
})

const {
  requireAdminRole,
  requireManagerOrAdminRole,
  requireApprovedLinkedWorker,
  requireFirebaseAuth,
  invalidateAuthUserCache,
} = createAuthRequestService({
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeAppOnly,
  authClientAccessModeWebAndApp,
  authClientPlatformWeb,
  authRoleAdmin,
  authRoleStandard,
  formatAuthLoginHoursWindow,
  getAuth,
  getCollections,
  isAllowedByAuthLoginHours,
  isApprovedAdminUser,
  isReviewerLoginEmail,
  normalizeEmail,
  ownerEmail,
  resolveAuthClientPlatformFromRequest,
  toPublicAuthUser,
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
})

const routeDeps = {
  batchSummarizeComments,
  chatForRules,
  findExactItemPurchaseOptions,
  resolvePurchasingItemSearchMatches,
  generateSupportReply,
  allocateWorkerNumbers,
  authAccessTimeZoneNewJersey,
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeWebAndApp,
  authClientPlatformApp,
  authRoleAdmin,
  authRoleStandard,
  buildOrderPhotoDownloadFileName,
  clearSupportSnapshotCache,
  createZendeskTicketReply,
  createZendeskSupportTicket,
  decodeBase64Image,
  defaultMobileAndroidLatestBuild,
  defaultMobileAndroidUpdateUrl,
  defaultMobileIosLatestBuild,
  defaultMobileIosUpdateUrl,
  defaultMobileLatestVersion,
  deleteOrderPhotoRecord,
  ensureEntriesHavePayRates,
  ensureWorkersHaveWorkerNumbers,
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
  fetchMondayAssetDownloadInfo,
  fetchZendeskSupportAgentById,
  fetchZendeskSupportAgents,
  fetchZendeskSupportAlertTicketsSnapshot,
  fetchZendeskSupportAlerts,
  fetchZendeskSupportTicketsSnapshot,
  fetchZendeskTicketConversation,
  fetchZendeskTicketSummary,
  getCollections,
  getDashboardSnapshotFromCache,
  getOrderPhotosBucket,
  isDashboardRefreshRequested,
  isPushTokenUnregisteredError,
  isSupportedPhotoMimeType,
  listAllOrderPhotoGroups,
  listOrderPhotoRecords,
  mobileAlertTargetModeAll,
  mobileAlertTargetModeSelected,
  mobilePushTokenProviderExpo,
  mobilePushTokenProviderFcm,
  normalizeAnyPushToken,
  normalizeAuthAccessTimeZone,
  normalizeAuthClientAccessMode,
  normalizeAuthClientPlatform,
  normalizeAuthRole,
  normalizeEmail,
  normalizeJobName,
  normalizeMobileAlertTargetMode,
  normalizeOptionalBuildNumber,
  normalizeOptionalShortText,
  normalizeOrderPhotoOrderId,
  normalizeOrderPhotoPath,
  normalizeStageName,
  normalizeWorkerNumber,
  ownerEmail,
  parseOptionalAuthAccessTimeZone,
  parseOptionalAuthHour,
  refreshOrdersUnifiedCollection,
  randomUUID,
  redactPushTokenForLog,
  invalidateAuthUserCache,
  requireAdminRole,
  requireManagerOrAdminRole,
  requireApprovedLinkedWorker,
  requireFirebaseAuth,
  saveOrderPhotoRecord,
  sendExpoPushMessages,
  sendFcmPushMessages,
  setDashboardSnapshotCache,
  toBoundedInteger,
  toNonNegativeInteger,
  toPublicAuthUser,
  toPublicMobileAlert,
  validateEntryFields,
  validateEntryInput,
  validateWorkerInput,
}

function hasDashboardRefreshErrors(summary) {
  const sections = [
    summary?.ordersUnified,
    summary?.zendesk,
    summary?.supportAlerts,
    summary?.supportTickets,
    summary?.supportAlertTickets,
  ]

  return sections.some((section) => Boolean(section?.error))
}

function resolveSystemRunStatus(summary) {
  return hasDashboardRefreshErrors(summary) ? 'completed_with_issues' : 'success'
}

function buildRunLogId() {
  if (typeof randomUUID === 'function') {
    return randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

async function appendSystemRunLog({
  startedAt,
  completedAt,
  status,
  message,
  summary = null,
  errorMessage = null,
}) {
  const { dashboardSnapshotsCollection } = await getCollections()
  const now = new Date().toISOString()
  const normalizedStatus = String(status ?? '').trim() || 'failed'
  const logEntry = {
    id: buildRunLogId(),
    jobName: 'dailyDashboardRefresh',
    trigger: 'scheduled',
    startedAt: String(startedAt ?? '').trim() || null,
    completedAt: String(completedAt ?? '').trim() || null,
    status: normalizedStatus,
    message: String(message ?? '').trim() || null,
    summary: summary && typeof summary === 'object' ? summary : null,
    errorMessage: String(errorMessage ?? '').trim() || null,
    createdAt: now,
  }

  await dashboardSnapshotsCollection.updateOne(
    { snapshotKey: systemRunLogsSnapshotKey },
    {
      $set: {
        snapshotKey: systemRunLogsSnapshotKey,
        updatedAt: now,
      },
      $push: {
        logs: {
          $each: [logEntry],
          $position: 0,
          $slice: maxSystemRunLogs,
        },
      },
    },
    { upsert: true },
  )
}

async function refreshDashboardSnapshotsAndTrackShippingMoves() {
  const refreshStartedAt = new Date().toISOString()
  const summary = {
    startedAt: refreshStartedAt,
    ordersUnified: { refreshed: false },
    zendesk: { refreshed: false },
    supportAlerts: { refreshed: false },
    supportTickets: { refreshed: false },
    supportAlertTickets: { refreshed: false },
  }

  // Orders unified is the single source of truth for Monday + QuickBooks pulls.
  // It owns the targeted shipped + design lookups and the carryover-to-shipped
  // transition logic, so the cron does not pull boards directly anymore.
  try {
    const ordersUnifiedRefreshSummary = await refreshOrdersUnifiedCollection()

    summary.ordersUnified = {
      refreshed: true,
      mergedOrderCount: Number(ordersUnifiedRefreshSummary?.mergedOrderCount ?? 0),
      orderTrackOrderCount: Number(ordersUnifiedRefreshSummary?.orderTrackOrderCount ?? 0),
      quickBooksProjectCount: Number(ordersUnifiedRefreshSummary?.quickBooksProjectCount ?? 0),
      designBoardMatchedCount: Number(ordersUnifiedRefreshSummary?.designBoardMatchedCount ?? 0),
      carryoverMarkedShippedCount: Number(ordersUnifiedRefreshSummary?.carryoverMarkedShippedCount ?? 0),
      carryoverHazardCount: Number(ordersUnifiedRefreshSummary?.carryoverHazardCount ?? 0),
      warnings: Array.isArray(ordersUnifiedRefreshSummary?.warnings)
        ? ordersUnifiedRefreshSummary.warnings
        : [],
    }
  } catch (error) {
    summary.ordersUnified = {
      refreshed: false,
      error: error instanceof Error ? error.message : 'Orders unified refresh failed.',
    }
    console.error('dailyDashboardRefresh orders unified refresh failed.', error)
  }

  try {
    const zendeskSnapshot = await fetchZendeskTicketSummary()
    await setDashboardSnapshotCache('zendesk', zendeskSnapshot)
    summary.zendesk = {
      refreshed: true,
      totalTickets: Number(zendeskSnapshot?.metrics?.total ?? 0),
    }
  } catch (error) {
    summary.zendesk = {
      refreshed: false,
      error: error instanceof Error ? error.message : 'Zendesk refresh failed.',
    }
    console.error('dailyDashboardRefresh Zendesk ticket summary refresh failed.', error)
  }

  try {
    const supportAlertsSnapshot = await fetchZendeskSupportAlerts()
    await setDashboardSnapshotCache('support_alerts', supportAlertsSnapshot)
    summary.supportAlerts = {
      refreshed: true,
      totalAlerts: Number(supportAlertsSnapshot?.metrics?.totalAlerts ?? 0),
    }
  } catch (error) {
    summary.supportAlerts = {
      refreshed: false,
      error: error instanceof Error ? error.message : 'Support alerts refresh failed.',
    }
    console.error('dailyDashboardRefresh support alerts refresh failed.', error)
  }

  try {
    const supportTicketsLimit = 50
    const supportTicketsSnapshot = await fetchZendeskSupportTicketsSnapshot(supportTicketsLimit)
    await setDashboardSnapshotCache(`support_tickets_${supportTicketsLimit}`, supportTicketsSnapshot)
    summary.supportTickets = {
      refreshed: true,
      totalTickets: Array.isArray(supportTicketsSnapshot?.tickets)
        ? supportTicketsSnapshot.tickets.length
        : 0,
    }
  } catch (error) {
    summary.supportTickets = {
      refreshed: false,
      error: error instanceof Error ? error.message : 'Support tickets refresh failed.',
    }
    console.error('dailyDashboardRefresh support tickets refresh failed.', error)
  }

  try {
    const supportAlertTicketsLimitPerBucket = 100
    const supportAlertTicketsSnapshot = await fetchZendeskSupportAlertTicketsSnapshot(
      supportAlertTicketsLimitPerBucket,
    )
    await setDashboardSnapshotCache(
      `support_alert_tickets_${supportAlertTicketsLimitPerBucket}`,
      supportAlertTicketsSnapshot,
    )
    summary.supportAlertTickets = {
      refreshed: true,
      totalTickets: Number(supportAlertTicketsSnapshot?.metrics?.totalTickets ?? 0),
    }
  } catch (error) {
    summary.supportAlertTickets = {
      refreshed: false,
      error: error instanceof Error ? error.message : 'Support alert-ticket refresh failed.',
    }
    console.error('dailyDashboardRefresh support alert-ticket refresh failed.', error)
  }

  summary.completedAt = new Date().toISOString()

  return summary
}

registerAiRoutes(app, routeDeps)
registerAuthRoutes(app, routeDeps)
registerAlertsRoutes(app, routeDeps)
registerCrmRoutes(app, routeDeps)
registerOrdersRoutes(app, routeDeps)
registerDashboardSupportRoutes(app, routeDeps)
registerOrderPhotoRoutes(app, routeDeps)
registerPurchasingRoutes(app, routeDeps)
registerQuickBooksRoutes(app, routeDeps)
registerTimesheetRoutes(app, routeDeps)
app.use((error, _req, res, _next) => {
  const status = Number(error?.status ?? 500)
  const message =
    error?.message || error?.details || 'Unexpected server error occurred.'

  if (status >= 500) {
    console.error('apiV1 request failed', {
      code: error?.code ?? null,
      codeName: error?.codeName ?? null,
      message,
      stack: error?.stack ?? null,
      status,
    })
  }

  res.status(status).json({ error: message })
})

export async function closeMongoConnections() {
  await mongoCollectionsService.closeMongoConnections()
}

export const dailyDashboardRefresh = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub.schedule(dashboardDailyRefreshCron)
  .timeZone(dashboardDailyRefreshTimeZone)
  .onRun(async () => {
    const startedAt = new Date().toISOString()

    try {
      const summary = await refreshDashboardSnapshotsAndTrackShippingMoves()
      const completedAt = String(summary?.completedAt ?? '').trim() || new Date().toISOString()
      const status = resolveSystemRunStatus(summary)
      const message =
        status === 'success'
          ? 'Daily dashboard refresh completed successfully.'
          : 'Daily dashboard refresh completed with issues.'

      await appendSystemRunLog({
        startedAt: String(summary?.startedAt ?? '').trim() || startedAt,
        completedAt,
        status,
        message,
        summary,
      })

      console.info('dailyDashboardRefresh completed.', summary)

      return summary
    } catch (error) {
      const completedAt = new Date().toISOString()
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Daily dashboard refresh failed unexpectedly.'

      try {
        await appendSystemRunLog({
          startedAt,
          completedAt,
          status: 'failed',
          message: 'Daily dashboard refresh failed.',
          summary: null,
          errorMessage,
        })
      } catch (logError) {
        console.error('dailyDashboardRefresh failed to persist system run log.', logError)
      }

      console.error('dailyDashboardRefresh failed.', error)
      throw error
    }
  })

export const apiV1 = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 300,
    memory: '512MB',
  })
  .https.onRequest(app)
