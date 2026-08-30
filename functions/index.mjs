import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import * as functions from 'firebase-functions/v1'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { registerAiRoutes } from './src/routes/ai-routes.mjs'
import { registerAiCouncilRoutes } from './src/routes/ai-council-routes.mjs'
import { registerAlertsRoutes } from './src/routes/alerts-routes.mjs'
import { registerAuthRoutes } from './src/routes/auth-routes.mjs'
import { registerChatRoutes } from './src/routes/chat-routes.mjs'
import { registerCrmRoutes } from './src/routes/crm-routes.mjs'
import { registerEmailIntakeRoutes } from './src/routes/email-intake-routes.mjs'
import { registerDashboardSupportRoutes } from './src/routes/dashboard-support-routes.mjs'
import { registerDiagnosticReportsRoutes } from './src/routes/diagnostic-reports-routes.mjs'
import { registerEmailRoutes } from './src/routes/email-routes.mjs'
import { registerOrderPhotoRoutes } from './src/routes/order-photos-routes.mjs'
import { registerReadOnlyMcpRoutes } from './src/routes/mcp-readonly-routes.mjs'
import { registerMcpOAuthRoutes } from './src/routes/mcp-oauth-routes.mjs'
import { registerOrdersRoutes } from './src/routes/orders-routes.mjs'
import { registerPurchasingRoutes } from './src/routes/purchasing-routes.mjs'
import { registerQuickBooksRoutes } from './src/routes/quickbooks-routes.mjs'
import { registerSlackRoutes } from './src/routes/slack-routes.mjs'
import { registerSmsBridgeRoutes } from './src/routes/sms-bridge-routes.mjs'
import { registerTimesheetRoutes } from './src/routes/timesheet-routes.mjs'
import { registerTrimbleRoutes } from './src/routes/trimble-routes.mjs'
import { registerVisitorsRoutes } from './src/routes/visitors-routes.mjs'
import { createAuthUtils } from './src/services/auth-utils.mjs'
import { createAuthActivityService } from './src/services/auth-activity-service.mjs'
import { createAuthRequestService } from './src/services/auth-request-service.mjs'
import { createDashboardCacheService } from './src/services/dashboard-cache-service.mjs'
import { createMondayDashboardService } from './src/services/monday-dashboard-service.mjs'
import { createMondayOrderPersistenceService } from './src/services/monday-order-persistence-service.mjs'
import { createMondaySnapshotService } from './src/services/monday-snapshot-service.mjs'
import { createMongoCollectionsService } from './src/services/mongo-collections-service.mjs'
import {
  findMissingMongoDomainUris,
  resolveMongoDomainConfiguration,
} from './src/services/mongo-domain-config.mjs'
import { createOrdersUnifiedService } from './src/services/orders-unified-service.mjs'
import { createMondayLinkService } from './src/orders/monday-link-service.mjs'
import { createOrderPhotoService } from './src/services/order-photo-service.mjs'
import { createPlatformConfigService } from './src/services/platform-config-service.mjs'
import { createPushAlertService } from './src/services/push-alert-service.mjs'
import { createAnthropicService } from './src/services/anthropic-service.mjs'
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
app.set('trust proxy', 1)

// Deliberately separate from apiV1: this app registers only the read-only MCP
// protocol endpoint and has no business routes that can change data.
const mcpReadOnlyApp = express()
mcpReadOnlyApp.set('trust proxy', 1)
mcpReadOnlyApp.use(cors({
  origin: true,
  methods: ['POST', 'GET', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
  maxAge: 600,
}))
mcpReadOnlyApp.use(express.json({ limit: '1mb' }))
mcpReadOnlyApp.use((req, res, next) => {
  res.on('finish', () => {
    console.info('MCP request', { method: req.method, path: req.path, status: res.statusCode })
  })
  next()
})

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

    // Fail closed: browser origins are only allowed when explicitly listed in
    // ALLOWED_ORIGINS. An empty list blocks all cross-origin browser access.
    if (allowedOrigins.length === 0) {
      return callback(new Error('CORS origin list is not configured.'))
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`))
  },
  credentials: true,
}))
app.use('/api/diagnostic-reports', express.json({ limit: '10mb' }))
app.use(express.json({
  limit: '12mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf
  },
}))

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

// Purchasing refresh can trigger expensive QuickBooks sync work.
const purchasingRefreshLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Purchasing refresh is rate-limited. Please wait a few minutes.' },
})
app.use('/api/purchasing/refresh', purchasingRefreshLimit)

// AI support reply generation is compute-heavy and should be burst-limited.
const aiSupportReplyGenerationLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI reply generation is rate-limited. Please slow down.' },
})
app.use('/api/ai/support/generate-reply', aiSupportReplyGenerationLimit)

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

app.use((req, res, next) => {
  const sessionId = String(req.get('X-Diagnostic-Session-Id') ?? '').trim()

  if (!sessionId || sessionId.length > 100 || !req.path.startsWith('/api/')) {
    next()
    return
  }

  const requestId = randomUUID()
  const startedAt = Date.now()
  res.set('X-Request-Id', requestId)
  res.on('finish', () => {
    void (async () => {
      try {
        const { diagnosticRequestEventsCollection } = await getCollections()
        await diagnosticRequestEventsCollection.insertOne({
          id: randomUUID(),
          sessionId,
          requestId,
          method: String(req.method ?? '').slice(0, 20),
          path: String(req.originalUrl ?? req.path ?? '').slice(0, 2000),
          status: Number(res.statusCode) || 0,
          durationMs: Math.max(0, Date.now() - startedAt),
          userUid: String(req.authUser?.uid ?? '').slice(0, 200),
          createdAt: new Date(),
        })
      } catch (diagnosticError) {
        console.warn('Could not persist diagnostic request event.', {
          message: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
        })
      }
    })()
  })
  next()
})

const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_orders'
const mongoDomainConfig = resolveMongoDomainConfiguration({
  mongoDbName,
  mongoUri,
})
const missingMongoDomainUris = findMissingMongoDomainUris(mongoDomainConfig)
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
const authRoleStandard = 'office_worker'
const authRoleShopWorker = 'shop_worker'
const authRoleManager = 'manager'
const authRoleAdmin = 'admin'
const authRoleSalesRep = 'sales_rep'
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
const anthropicApiKey = String(process.env.ANTHROPIC_API_KEY ?? '').trim()
const slackSigningSecret = String(process.env.SLACK_SIGNING_SECRET ?? '').trim()
const slackBotToken = String(process.env.SLACK_BOT_TOKEN ?? '').trim()
const slackAllowedChannelIds = String(process.env.SLACK_ALLOWED_CHANNEL_IDS ?? '').trim()
const zendeskTicketFieldCacheTtlMs = 30 * 60 * 1000
const zendeskTicketFieldErrorCacheTtlMs = 5 * 60 * 1000
// Orders/dashboard refresh pulls Monday + QuickBooks twice a day: 6 AM before
// the shop starts, 3 PM mid-afternoon. Manual refresh stays available anytime.
const dashboardDailyRefreshCron = String(process.env.DASHBOARD_DAILY_REFRESH_CRON ?? '0 6,15 * * *').trim() || '0 6,15 * * *'
const dashboardDailyRefreshTimeZone =
  String(process.env.DASHBOARD_DAILY_REFRESH_TIMEZONE ?? authAccessTimeZoneNewJersey).trim()
  || authAccessTimeZoneNewJersey
const crmReminderDispatchCron = String(process.env.CRM_REMINDER_DISPATCH_CRON ?? '0 * * * *').trim() || '0 * * * *'
const crmReminderDispatchTimeZone =
  String(process.env.CRM_REMINDER_DISPATCH_TIMEZONE ?? authAccessTimeZoneNewJersey).trim()
  || authAccessTimeZoneNewJersey
const emailIntakeSyncCron = String(process.env.EMAIL_INTAKE_SYNC_CRON ?? '*/10 * * * *').trim() || '*/10 * * * *'
const emailIntakeSyncTimeZone =
  String(process.env.EMAIL_INTAKE_SYNC_TIMEZONE ?? authAccessTimeZoneNewJersey).trim()
  || authAccessTimeZoneNewJersey
const ordersProgressStatusQueueCron = String(
  process.env.ORDERS_PROGRESS_STATUS_QUEUE_CRON ?? '*/1 * * * *',
).trim() || '*/1 * * * *'
const ordersProgressStatusQueueTimeZone =
  String(process.env.ORDERS_PROGRESS_STATUS_QUEUE_TIMEZONE ?? authAccessTimeZoneNewJersey).trim()
  || authAccessTimeZoneNewJersey
const emailIntakeScheduledSyncEnabled = /^(1|true|yes|on)$/i.test(
  String(process.env.EMAIL_INTAKE_SCHEDULED_SYNC_ENABLED ?? '').trim(),
)
const shipTransitionRecentWindowHours = Number(process.env.MONDAY_SHIP_TRANSITION_WINDOW_HOURS ?? 72)
const systemRunLogsSnapshotKey = 'system_run_logs'
const maxSystemRunLogs = 300

// Validate required environment variables at startup
const missingEnvVars = [
  ...(missingMongoDomainUris.length > 0
    ? [
      `Mongo domain URI(s): ${missingMongoDomainUris
        .map((entry) => entry.uriEnvVar)
        .join(', ')}`,
    ]
    : []),
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
  authRoleSalesRep,
  authRoleShopWorker,
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
  callOpenAi,
  callOpenAiWebSearch,
  generateSupportReply,
  generateSlackReply,
  classifyEmailIntakeSuggestion,
  batchSummarizeComments,
  chatForRules,
  findExactItemPurchaseOptions,
  resolvePurchasingItemSearchMatches,
} = createOpenAiService({ openAiApiKey })

const {
  callClaude,
} = createAnthropicService({ anthropicApiKey })

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
        subitems {
          id
          name
          created_at
          updated_at
          column_values { id type text value column { title } }
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
        subitems {
          id
          name
          created_at
          updated_at
          column_values { id type text value column { title } }
        }
      }
    }
  }
}
`
}

const {
  createMondayItem,
  createMondaySubitem,
  deleteMondayItem,
  fetchMondayAssetDownloadInfo,
  fetchMondayBoardColumns,
  fetchMondayBoardItemNames,
  fetchMondayBoardItemsByIds,
  fetchMondayBoardSelectedColumns,
  fetchMondayBoardsCatalog,
  fetchMondayDashboardSnapshot,
  fetchMondayStatusColumnOptions,
  invalidateMondayBoardNamesCache,
  moveMondayItemToBoard,
  updateMondayItemJsonColumn,
  updateMondayItemName,
  updateMondayItemStatusColumn,
  updateMondayItemTextColumn,
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

async function getReadOnlyCollections() {
  return mongoCollectionsService.getReadOnlyCollections()
}

const { persistNewMondayOrders } = createMondayOrderPersistenceService({
  fetchMondayAssetDownloadInfo,
  getCollections,
  getReadOnlyCollections,
  getOrderPhotosBucket,
  mondayBoardId,
  mondayShippedBoardId,
  randomUUID,
})

const {
  assertMondayLink,
  buildLinkFields: buildMondayLinkFields,
  buildLinkHistoryEntry: buildMondayLinkHistoryEntry,
  invalidateMondayLinkCache,
  resolveMondayLink,
} = createMondayLinkService({
  fetchMondayBoardSelectedColumns,
})

const { refreshOrdersUnifiedCollection } = createOrdersUnifiedService({
  fetchMondayBoardItemsByIds,
  fetchMondayBoardSelectedColumns,
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
  requireOfficeManagerOrAdminRole,
  requireSalesManagerOrAdminRole,
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
  authRoleSalesRep,
  authRoleShopWorker,
  authRoleStandard,
  formatAuthLoginHoursWindow,
  getAuth,
  getCollections,
  isAllowedByAuthLoginHours,
  isApprovedAdminUser,
  isReviewerLoginEmail,
  normalizeEmail,
  ownerEmail,
  slackAllowedChannelIds,
  slackBotToken,
  slackSigningSecret,
  resolveAuthClientPlatformFromRequest,
  toPublicAuthUser,
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
})

function listRegisteredApiRoutes() {
  const operationActionByMethod = {
    GET: 'Retrieve',
    POST: 'Create',
    PUT: 'Replace',
    PATCH: 'Update',
    DELETE: 'Delete',
  }
  const operationActionByKeyword = {
    approval: 'Approve',
    assign: 'Assign',
    bootstrap: 'Load',
    chat: 'Send',
    download: 'Download',
    import: 'Import',
    link: 'Link',
    preview: 'Preview',
    refresh: 'Refresh',
    revoke: 'Revoke',
    upload: 'Upload',
  }
  const sectionDefinitions = {
    admin: {
      id: 'admin',
      title: 'Administration',
      description: 'Administrative controls, user governance, and system-level management operations.',
    },
    ai: {
      id: 'ai',
      title: 'AI',
      description: 'AI-powered business workflows, assistant responses, and summarization tools.',
    },
    alerts: {
      id: 'alerts',
      title: 'Alerts',
      description: 'System and mobile alert delivery, read state tracking, and notification management.',
    },
    auth: {
      id: 'auth',
      title: 'Authentication',
      description: 'Identity, account access, user approval, and access-policy controls.',
    },
    crm: {
      id: 'crm',
      title: 'CRM',
      description: 'Accounts, contacts, opportunities, quote/order lifecycle, and CRM workflows.',
    },
    dashboard: {
      id: 'dashboard',
      title: 'Dashboard',
      description: 'Operational dashboard data, order intelligence, and support snapshots.',
    },
    orders: {
      id: 'orders',
      title: 'Orders',
      description: 'Order retrieval, status synchronization, fulfillment progress, and related assets.',
    },
    purchasing: {
      id: 'purchasing',
      title: 'Purchasing',
      description: 'Purchasing spend analysis, item details, transactions, and refresh utilities.',
    },
    quickbooks: {
      id: 'quickbooks',
      title: 'QuickBooks',
      description: 'QuickBooks connectivity, OAuth handling, and accounting synchronization endpoints.',
    },
    timesheet: {
      id: 'timesheet',
      title: 'Timesheet',
      description: 'Timesheet entries, workers, stage management, and production reporting.',
    },
    visitors: {
      id: 'visitors',
      title: 'Visitors',
      description: 'Visitor check-in operations, shared saved visitors, and visitor history reporting.',
    },
    default: {
      id: 'general',
      title: 'General',
      description: 'General API endpoints.',
    },
  }
  const routeSourceFilePaths = [
    'src/routes/ai-routes.mjs',
    'src/routes/admin-api-routes.mjs',
    'src/routes/alerts-routes.mjs',
    'src/routes/auth-routes.mjs',
    'src/routes/chat-routes.mjs',
    'src/routes/crm-routes.mjs',
    'src/routes/dashboard-support-routes.mjs',
    'src/routes/email-routes.mjs',
    'src/routes/email-intake-routes.mjs',
    'src/routes/order-photos-routes.mjs',
    'src/routes/orders-routes.mjs',
    'src/routes/purchasing-routes.mjs',
    'src/routes/quickbooks-routes.mjs',
    'src/routes/sms-bridge-routes.mjs',
    'src/routes/timesheet-routes.mjs',
    'src/routes/visitors-routes.mjs',
  ]

  function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right))
  }

  function normalizeInputTarget(value) {
    if (value === 'params') {
      return 'path'
    }

    if (value === 'query') {
      return 'query'
    }

    return 'body'
  }

  function normalizeConstraintValue(value) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    if (normalized === 'true') {
      return true
    }

    if (normalized === 'false') {
      return false
    }

    const parsed = Number(normalized)

    if (Number.isFinite(parsed)) {
      return parsed
    }

    return normalized
  }

  function cleanErrorExpression(value) {
    let normalized = String(value ?? '').replace(/\s+/g, ' ').trim()

    if (!normalized) {
      return ''
    }

    if (
      (normalized.startsWith('"') && normalized.endsWith('"'))
      || (normalized.startsWith("'") && normalized.endsWith("'"))
      || (normalized.startsWith('`') && normalized.endsWith('`'))
    ) {
      normalized = normalized.slice(1, -1)
    }

    normalized = normalized.replace(/\$\{[^}]+\}/g, '...')

    return normalized.trim()
  }

  function humanizeToken(input) {
    const raw = String(input ?? '').trim()

    if (!raw) {
      return ''
    }

    return raw
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase())
  }

  function resolveSection(path) {
    const segments = String(path ?? '')
      .split('/')
      .filter(Boolean)
    const first = String(segments[1] ?? '').trim().toLowerCase()

    if (first === 'admin') {
      const second = String(segments[2] ?? '').trim().toLowerCase()

      if (second && sectionDefinitions[second]) {
        return sectionDefinitions[second]
      }
    }

    return sectionDefinitions[first] ?? sectionDefinitions.default
  }

  function collectPathParams(path) {
    const matches = [...String(path ?? '').matchAll(/:([A-Za-z0-9_]+)/g)]

    return uniqueSorted(matches.map((match) => String(match[1] ?? '').trim()).filter(Boolean))
  }

  function collectReferencedFieldNames(source, target) {
    const dotMatches = [...String(source ?? '').matchAll(
      new RegExp(`req\\.${target}\\?\\.([A-Za-z0-9_]+)`, 'g'),
    )]
      .map((match) => String(match[1] ?? '').trim())
      .filter(Boolean)
    const bracketMatches = [...String(source ?? '').matchAll(
      new RegExp(`req\\.${target}\\?\\.\\[['\"]([^'\"]+)['\"]\\]`, 'g'),
    )]
      .map((match) => String(match[1] ?? '').trim())
      .filter(Boolean)

    return uniqueSorted([...dotMatches, ...bracketMatches])
  }

  function collectStatusCodes(source, method) {
    const explicitCodes = uniqueSorted(
      [...String(source ?? '').matchAll(/res\.status\((\d{3})\)/g)]
        .map((match) => String(match[1] ?? '').trim())
        .filter(Boolean),
    )

    if (explicitCodes.length > 0) {
      return explicitCodes
    }

    if (method === 'POST') {
      return ['201']
    }

    if (method === 'DELETE') {
      return ['200', '204']
    }

    return ['200']
  }

  function normalizePathTemplate(path) {
    return String(path ?? '').replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  }

  function parseStringLiteralValues(value) {
    return uniqueSorted(
      [...String(value ?? '').matchAll(/['\"]([^'\"]+)['\"]/g)]
        .map((match) => String(match[1] ?? '').trim())
        .filter(Boolean),
    )
  }

  function extractConstantsByName(source) {
    const constantsByName = new Map()
    const setRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/g

    for (const match of source.matchAll(setRegex)) {
      const constantName = String(match[1] ?? '').trim()
      const values = parseStringLiteralValues(match[2])

      if (!constantName || values.length === 0) {
        continue
      }

      constantsByName.set(constantName, values)
    }

    const arrayRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*\[([\s\S]*?)\]/g

    for (const match of source.matchAll(arrayRegex)) {
      const constantName = String(match[1] ?? '').trim()

      if (!constantName || constantsByName.has(constantName)) {
        continue
      }

      const values = parseStringLiteralValues(match[2])

      if (values.length === 0 || values.length > 80) {
        continue
      }

      constantsByName.set(constantName, values)
    }

    return constantsByName
  }

  function extractRouteSnippetsByKey(source) {
    const routeRegex = /app\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"]/g
    const matches = [...source.matchAll(routeRegex)]
    const snippetsByRouteKey = new Map()

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]
      const method = String(match[1] ?? '').trim().toUpperCase()
      const path = String(match[2] ?? '').trim()
      const start = Number(match.index ?? 0)
      const nextStart = index < matches.length - 1
        ? Number(matches[index + 1].index ?? source.length)
        : source.length

      if (!method || !path) {
        continue
      }

      const routeKey = `${method} ${path}`

      if (!snippetsByRouteKey.has(routeKey)) {
        snippetsByRouteKey.set(routeKey, source.slice(start, nextStart))
      }
    }

    return snippetsByRouteKey
  }

  const routeSourceMetadata = routeSourceFilePaths
    .map((relativePath) => {
      try {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')

        return {
          relativePath,
          source,
          constantsByName: extractConstantsByName(source),
          snippetsByRouteKey: extractRouteSnippetsByKey(source),
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  function resolveConstantValues(constantName, preferredMetadata) {
    const key = String(constantName ?? '').trim()

    if (!key) {
      return []
    }

    const preferredValues = preferredMetadata?.constantsByName?.get(key)

    if (Array.isArray(preferredValues) && preferredValues.length > 0) {
      return preferredValues
    }

    for (const metadata of routeSourceMetadata) {
      const values = metadata?.constantsByName?.get(key)

      if (Array.isArray(values) && values.length > 0) {
        return values
      }
    }

    return []
  }

  function resolveRouteSourceInfo(method, path, fallbackSource) {
    const routeKey = `${method} ${path}`

    for (const metadata of routeSourceMetadata) {
      const snippet = metadata?.snippetsByRouteKey?.get(routeKey)

      if (snippet) {
        return {
          source: snippet,
          metadata,
        }
      }
    }

    return {
      source: fallbackSource,
      metadata: null,
    }
  }

  function parseVariableBindings(source) {
    const bindings = new Map()
    const declarationRegex = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*([\s\S]{0,600}?);/g

    for (const match of String(source ?? '').matchAll(declarationRegex)) {
      const variableName = String(match[1] ?? '').trim()
      const expression = String(match[2] ?? '').trim()

      if (!variableName || !expression) {
        continue
      }

      const dotMatch = expression.match(/req\.(params|query|body)\?\.([A-Za-z0-9_]+)/)
      const bracketMatch = expression.match(/req\.(params|query|body)\?\.\[['\"]([^'\"]+)['\"]\]/)
      const sourceTarget = dotMatch?.[1] ?? bracketMatch?.[1]
      const fieldName = dotMatch?.[2] ?? bracketMatch?.[2]

      if (!sourceTarget || !fieldName) {
        continue
      }

      bindings.set(variableName, {
        variableName,
        source: normalizeInputTarget(sourceTarget),
        fieldName: String(fieldName).trim(),
        expression,
      })
    }

    return bindings
  }

  function inferFieldType(fieldName, bindingExpression, sourceName) {
    const expression = String(bindingExpression ?? '')
    const normalizedFieldName = String(fieldName ?? '').trim().toLowerCase()

    if (
      expression.includes('toBoundedInteger(')
      || expression.includes('toNonNegativeInteger(')
      || expression.includes('Number(')
    ) {
      return 'number'
    }

    if (expression.includes('Boolean(')) {
      return 'boolean'
    }

    if (normalizedFieldName.endsWith('ids') || normalizedFieldName.endsWith('uids') || normalizedFieldName.endsWith('states')) {
      return 'array'
    }

    if (normalizedFieldName.startsWith('is') || normalizedFieldName.startsWith('has')) {
      return 'boolean'
    }

    if (sourceName === 'path') {
      return 'string'
    }

    return 'string'
  }

  function collectBoundedConstraints(source) {
    const constraintsByFieldKey = new Map()
    const boundedRegex = /toBoundedInteger\(\s*req\.(params|query|body)\?\.([A-Za-z0-9_]+)\s*,\s*([^,\n]+)\s*,\s*([^,\n]+)\s*,\s*([^)\n]+)\)/g

    for (const match of String(source ?? '').matchAll(boundedRegex)) {
      const sourceTarget = normalizeInputTarget(String(match[1] ?? '').trim())
      const fieldName = String(match[2] ?? '').trim()
      const key = `${sourceTarget}:${fieldName}`

      constraintsByFieldKey.set(key, {
        minimum: normalizeConstraintValue(match[3]),
        maximum: normalizeConstraintValue(match[4]),
        defaultValue: normalizeConstraintValue(match[5]),
      })
    }

    const nonNegativeRegex = /toNonNegativeInteger\(\s*req\.(params|query|body)\?\.([A-Za-z0-9_]+)\s*,\s*([^)\n]+)\)/g

    for (const match of String(source ?? '').matchAll(nonNegativeRegex)) {
      const sourceTarget = normalizeInputTarget(String(match[1] ?? '').trim())
      const fieldName = String(match[2] ?? '').trim()
      const key = `${sourceTarget}:${fieldName}`

      if (!constraintsByFieldKey.has(key)) {
        constraintsByFieldKey.set(key, {
          minimum: 0,
          maximum: null,
          defaultValue: normalizeConstraintValue(match[3]),
        })
      }
    }

    return constraintsByFieldKey
  }

  function collectRequiredFieldDetails(source, variableBindings) {
    const requiredByFieldKey = new Map()
    const variableRequiredRegex = /if\s*\(\s*!\s*([A-Za-z0-9_]+)\s*\)\s*\{?[\s\S]{0,260}?res\.status\((\d{3})\)\.json\(\s*\{\s*error:\s*([\s\S]{0,220}?)\s*\}\s*\)/g

    for (const match of String(source ?? '').matchAll(variableRequiredRegex)) {
      const variableName = String(match[1] ?? '').trim()
      const binding = variableBindings.get(variableName)

      if (!binding) {
        continue
      }

      const key = `${binding.source}:${binding.fieldName}`

      requiredByFieldKey.set(key, {
        required: true,
        message: cleanErrorExpression(match[3]),
      })
    }

    const directRequiredRegex = /if\s*\(\s*!\s*req\.(params|query|body)\?\.([A-Za-z0-9_]+)\s*\)\s*\{?[\s\S]{0,260}?res\.status\((\d{3})\)\.json\(\s*\{\s*error:\s*([\s\S]{0,220}?)\s*\}\s*\)/g

    for (const match of String(source ?? '').matchAll(directRequiredRegex)) {
      const sourceTarget = normalizeInputTarget(String(match[1] ?? '').trim())
      const fieldName = String(match[2] ?? '').trim()
      const key = `${sourceTarget}:${fieldName}`

      if (!requiredByFieldKey.has(key)) {
        requiredByFieldKey.set(key, {
          required: true,
          message: cleanErrorExpression(match[4]),
        })
      }
    }

    return requiredByFieldKey
  }

  function collectEnumFieldDetails(source, variableBindings, metadata) {
    const enumsByFieldKey = new Map()
    const setHasRegex = /([A-Za-z0-9_]+)\.has\(\s*([A-Za-z0-9_]+)\s*\)/g

    for (const match of String(source ?? '').matchAll(setHasRegex)) {
      const constantName = String(match[1] ?? '').trim()
      const variableName = String(match[2] ?? '').trim()
      const binding = variableBindings.get(variableName)

      if (!binding) {
        continue
      }

      const enumValues = resolveConstantValues(constantName, metadata)

      if (enumValues.length === 0) {
        continue
      }

      enumsByFieldKey.set(
        `${binding.source}:${binding.fieldName}`,
        enumValues,
      )
    }

    const includesRegex = /([A-Za-z0-9_]+)\.includes\(\s*([A-Za-z0-9_]+)\s*\)/g

    for (const match of String(source ?? '').matchAll(includesRegex)) {
      const constantName = String(match[1] ?? '').trim()
      const variableName = String(match[2] ?? '').trim()
      const binding = variableBindings.get(variableName)

      if (!binding) {
        continue
      }

      const enumValues = resolveConstantValues(constantName, metadata)

      if (enumValues.length === 0) {
        continue
      }

      const key = `${binding.source}:${binding.fieldName}`

      if (!enumsByFieldKey.has(key)) {
        enumsByFieldKey.set(key, enumValues)
      }
    }

    const templatedEnumRegex = /([A-Za-z0-9_]+)\s+must be one of:\s*\$\{\s*([A-Za-z0-9_]+)\.join\(/g

    for (const match of String(source ?? '').matchAll(templatedEnumRegex)) {
      const fieldName = String(match[1] ?? '').trim()
      const constantName = String(match[2] ?? '').trim()
      const enumValues = resolveConstantValues(constantName, metadata)

      if (enumValues.length === 0) {
        continue
      }

      for (const sourceTarget of ['path', 'query', 'body']) {
        const key = `${sourceTarget}:${fieldName}`

        if (!enumsByFieldKey.has(key)) {
          enumsByFieldKey.set(key, enumValues)
        }
      }
    }

    return enumsByFieldKey
  }

  function collectErrorDetails(source) {
    const rawErrors = []
    const errorRegex = /res\.status\((\d{3})\)\.json\(\s*\{\s*error:\s*([\s\S]{0,220}?)\s*\}\s*\)/g

    for (const match of String(source ?? '').matchAll(errorRegex)) {
      const statusCode = String(match[1] ?? '').trim()
      const message = cleanErrorExpression(match[2])

      if (!statusCode || !message) {
        continue
      }

      rawErrors.push({
        statusCode,
        message,
      })
    }

    const dedupedMap = new Map()

    for (const error of rawErrors) {
      dedupedMap.set(`${error.statusCode}:${error.message}`, error)
    }

    return [...dedupedMap.values()].sort((left, right) => {
      const codeCompare = left.statusCode.localeCompare(right.statusCode)

      if (codeCompare !== 0) {
        return codeCompare
      }

      return left.message.localeCompare(right.message)
    })
  }

  function collectResponseTopLevelFields(source) {
    const responseKeys = []
    const responseObjectRegex = /res(?:\.status\(\d{3}\))?\.json\(\s*\{([\s\S]{0,1600}?)\}\s*\)/g

    for (const match of String(source ?? '').matchAll(responseObjectRegex)) {
      const objectBody = String(match[1] ?? '')
      const keys = [...objectBody.matchAll(/([A-Za-z0-9_]+)\s*:/g)]
        .map((entry) => String(entry[1] ?? '').trim())
        .filter(Boolean)

      responseKeys.push(...keys)
    }

    return uniqueSorted(responseKeys)
  }

  function buildFieldSpec({
    inputTarget,
    fieldName,
    isPathParam = false,
    variableBindings,
    requiredByFieldKey,
    enumsByFieldKey,
    constraintsByFieldKey,
  }) {
    const sourceName = normalizeInputTarget(inputTarget)
    const key = `${sourceName}:${fieldName}`
    const binding = [...variableBindings.values()].find((entry) => (
      entry.source === sourceName && entry.fieldName === fieldName
    ))
    const requirement = requiredByFieldKey.get(key)
    const enumValues = enumsByFieldKey.get(key) ?? []
    const constraints = constraintsByFieldKey.get(key) ?? null
    const type = isPathParam
      ? 'string'
      : inferFieldType(fieldName, binding?.expression, sourceName)

    return {
      name: fieldName,
      in: sourceName,
      type,
      required: isPathParam ? true : Boolean(requirement?.required),
      description:
        requirement?.message
        || (sourceName === 'path'
          ? 'Path parameter.'
          : sourceName === 'query'
            ? 'Query string parameter.'
            : 'Request body field.'),
      enumValues,
      minimum: constraints?.minimum ?? null,
      maximum: constraints?.maximum ?? null,
      defaultValue: constraints?.defaultValue ?? null,
    }
  }

  function sampleValueForField(field) {
    if (Array.isArray(field?.enumValues) && field.enumValues.length > 0) {
      return field.enumValues[0]
    }

    if (field?.defaultValue !== null && field?.defaultValue !== undefined) {
      return field.defaultValue
    }

    const fieldName = String(field?.name ?? '').trim().toLowerCase()

    if (field?.type === 'number') {
      if (typeof field?.minimum === 'number') {
        return field.minimum
      }

      return 1
    }

    if (field?.type === 'boolean') {
      return true
    }

    if (field?.type === 'array') {
      return ['value']
    }

    if (fieldName.includes('email')) {
      return 'user@example.com'
    }

    if (fieldName.includes('date') || fieldName.endsWith('at') || fieldName.includes('time')) {
      return '2026-01-01T00:00:00.000Z'
    }

    if (fieldName.includes('id') || fieldName.includes('uid')) {
      return 'resource-id'
    }

    if (fieldName.includes('name') || fieldName.includes('title')) {
      return 'Example value'
    }

    if (fieldName.includes('message') || fieldName.includes('note') || fieldName.includes('search')) {
      return 'Example text'
    }

    return 'value'
  }

  function buildOperationTitle(method, pathTemplate, pathParams) {
    const segments = String(pathTemplate)
      .split('/')
      .filter(Boolean)
      .slice(1)
      .filter((segment) => !segment.startsWith('{'))
    const lastSegment = String(segments[segments.length - 1] ?? '').toLowerCase()
    const previousSegment = String(segments[segments.length - 2] ?? '').toLowerCase()
    const keywordAction = operationActionByKeyword[lastSegment]

    if (keywordAction) {
      const target = humanizeToken(previousSegment || 'resource')
      return `${keywordAction} ${target}`
    }

    const baseAction = operationActionByMethod[method] ?? 'Call'
    const labelSegments = segments.length > 0 ? segments : ['endpoint']
    const noun = humanizeToken(labelSegments.join(' '))

    if (method === 'GET' && pathParams.length === 0) {
      return `List ${noun}`
    }

    return `${baseAction} ${noun}`
  }

  function buildOperationDescription({
    title,
    access,
    requestFields,
  }) {
    const descriptionParts = [`${title}.`]
    const requiredFieldNames = requestFields
      .filter((field) => field.required)
      .map((field) => field.name)

    if (requiredFieldNames.length > 0) {
      descriptionParts.push(`Required fields: ${requiredFieldNames.join(', ')}.`)
    }

    if (access.adminOnly) {
      descriptionParts.push('Requires admin privileges.')
    } else if (access.managerOrAdminOnly) {
      descriptionParts.push('Requires manager or admin privileges.')
    } else if (access.salesManagerOrAdminOnly) {
      descriptionParts.push('Requires sales, manager, or admin privileges.')
    } else if (access.approvedLinkedWorkerOnly) {
      descriptionParts.push('Requires an approved account linked to a worker profile.')
    } else if (access.requiresAuth) {
      descriptionParts.push('Requires an authenticated approved account.')
    } else {
      descriptionParts.push('Accessible without authentication.')
    }

    return descriptionParts.join(' ')
  }

  function buildExampleCurl({
    method,
    pathTemplate,
    requestFields,
  }) {
    const queryFields = requestFields
      .filter((field) => field.in === 'query')
      .slice(0, 4)
    const bodyFields = requestFields
      .filter((field) => field.in === 'body')
      .slice(0, 8)
    const sampleQueryString = queryFields.length > 0
      ? queryFields
        .map((field) => `${encodeURIComponent(field.name)}=${encodeURIComponent(String(sampleValueForField(field)))}`)
        .join('&')
      : ''
    const url = sampleQueryString
      ? `${pathTemplate}?${sampleQueryString}`
      : pathTemplate
    const lines = [
      `curl -X ${method} "${url}"`,
      '  -H "x-api-key: YOUR_API_KEY"',
    ]

    if (bodyFields.length > 0 && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const sampleBody = Object.fromEntries(
        bodyFields.map((field) => [field.name, sampleValueForField(field)]),
      )

      lines.push('  -H "Content-Type: application/json"')
      lines.push(`  -d '${JSON.stringify(sampleBody, null, 2)}'`)
    }

    return lines.join(' \\\n')
  }

  const router = app?._router ?? app?.router
  const stack = Array.isArray(router?.stack) ? router.stack : []
  const routes = []

  for (const layer of stack) {
    const route = layer?.route

    if (!route) {
      continue
    }

    const rawPath = route.path
    const routePaths = Array.isArray(rawPath)
      ? rawPath
      : [rawPath]
    const methods = Object.entries(route.methods ?? {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([method]) => String(method).toUpperCase())

    const middlewareNames = Array.isArray(route.stack)
      ? route.stack
        .map((entry) => String(entry?.name ?? '').trim())
        .filter(Boolean)
      : []
    const handlerSource = Array.isArray(route.stack)
      ? route.stack
        .map((entry) => {
          const handler = entry?.handle

          return typeof handler === 'function'
            ? String(handler)
            : ''
        })
        .join('\n')
      : ''

    for (const routePath of routePaths) {
      const path = String(routePath ?? '').trim()

      if (!path) {
        continue
      }

      for (const method of methods) {
        const access = {
          requiresAuth: middlewareNames.includes('requireFirebaseAuth'),
          adminOnly: middlewareNames.includes('requireAdminRole'),
          managerOrAdminOnly: middlewareNames.includes('requireManagerOrAdminRole'),
          salesManagerOrAdminOnly: middlewareNames.includes('requireSalesManagerOrAdminRole'),
          approvedLinkedWorkerOnly: middlewareNames.includes('requireApprovedLinkedWorker'),
        }
        const routeSourceInfo = resolveRouteSourceInfo(method, path, handlerSource)
        const analysisSource = String(routeSourceInfo?.source ?? handlerSource)
        const pathParams = collectPathParams(path)
        const queryParamNames = collectReferencedFieldNames(analysisSource, 'query')
        const bodyFieldNames = collectReferencedFieldNames(analysisSource, 'body')
        const pathTemplate = normalizePathTemplate(path)
        const section = resolveSection(path)
        const title = buildOperationTitle(method, pathTemplate, pathParams)
        const variableBindings = parseVariableBindings(analysisSource)
        const requiredByFieldKey = collectRequiredFieldDetails(analysisSource, variableBindings)
        const enumsByFieldKey = collectEnumFieldDetails(
          analysisSource,
          variableBindings,
          routeSourceInfo?.metadata,
        )
        const constraintsByFieldKey = collectBoundedConstraints(analysisSource)
        const requestFields = [
          ...pathParams.map((fieldName) => buildFieldSpec({
            inputTarget: 'path',
            fieldName,
            isPathParam: true,
            variableBindings,
            requiredByFieldKey,
            enumsByFieldKey,
            constraintsByFieldKey,
          })),
          ...queryParamNames.map((fieldName) => buildFieldSpec({
            inputTarget: 'query',
            fieldName,
            variableBindings,
            requiredByFieldKey,
            enumsByFieldKey,
            constraintsByFieldKey,
          })),
          ...bodyFieldNames.map((fieldName) => buildFieldSpec({
            inputTarget: 'body',
            fieldName,
            variableBindings,
            requiredByFieldKey,
            enumsByFieldKey,
            constraintsByFieldKey,
          })),
        ].sort((left, right) => {
          const inputOrder = {
            path: 0,
            query: 1,
            body: 2,
          }
          const inCompare = (inputOrder[left.in] ?? 9) - (inputOrder[right.in] ?? 9)

          if (inCompare !== 0) {
            return inCompare
          }

          return left.name.localeCompare(right.name)
        })
        const statusCodes = collectStatusCodes(analysisSource, method)
        const responseTopLevelFields = collectResponseTopLevelFields(analysisSource)
        const errors = collectErrorDetails(analysisSource)

        routes.push({
          operationId: `${method}_${pathTemplate.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
          method,
          path,
          pathTemplate,
          title,
          summary: title,
          description: buildOperationDescription({
            title,
            access,
            requestFields,
          }),
          section,
          pathParams,
          queryParams: queryParamNames,
          bodyFields: bodyFieldNames,
          statusCodes,
          request: {
            fields: requestFields,
            path: requestFields.filter((field) => field.in === 'path'),
            query: requestFields.filter((field) => field.in === 'query'),
            body: requestFields.filter((field) => field.in === 'body'),
          },
          response: {
            statusCodes,
            topLevelFields: responseTopLevelFields,
          },
          errors,
          exampleCurl: buildExampleCurl({
            method,
            pathTemplate,
            requestFields,
          }),
          middleware: middlewareNames,
          access,
        })
      }
    }
  }

  return routes.sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path)

    if (pathCompare !== 0) {
      return pathCompare
    }

    return left.method.localeCompare(right.method)
  })
}

const routeDeps = {
  assertMondayLink,
  buildMondayLinkFields,
  buildMondayLinkHistoryEntry,
  invalidateMondayLinkCache,
  resolveMondayLink,
  batchSummarizeComments,
  callClaude,
  callOpenAi,
  callOpenAiWebSearch,
  classifyEmailIntakeSuggestion,
  chatForRules,
  findExactItemPurchaseOptions,
  resolvePurchasingItemSearchMatches,
  generateSupportReply,
  generateSlackReply,
  allocateWorkerNumbers,
  authAccessTimeZoneNewJersey,
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeAppOnly,
  authClientAccessModeWebOnly,
  authClientAccessModeWebAndApp,
  authClientPlatformApp,
  authRoleAdmin,
  authRoleSalesRep,
  authRoleShopWorker,
  authRoleStandard,
  buildOrderPhotoDownloadFileName,
  clearSupportSnapshotCache,
  createMondayItem,
  createMondaySubitem,
  createZendeskTicketReply,
  createZendeskSupportTicket,
  decodeBase64Image,
  defaultMobileAndroidLatestBuild,
  defaultMobileAndroidUpdateUrl,
  defaultMobileIosLatestBuild,
  defaultMobileIosUpdateUrl,
  defaultMobileLatestVersion,
  deleteMondayItem,
  deleteOrderPhotoRecord,
  ensureEntriesHavePayRates,
  ensureWorkersHaveWorkerNumbers,
  extractRequestIpAddress,
  extractRequestLocalIpAddress,
  extractRequestUserAgent,
  fetchMondayAssetDownloadInfo,
  fetchMondayBoardColumns,
  fetchMondayBoardItemNames,
  fetchMondayBoardItemsByIds,
  fetchMondayBoardsCatalog,
  fetchMondayStatusColumnOptions,
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
  invalidateMondayBoardNamesCache,
  isDashboardRefreshRequested,
  isPushTokenUnregisteredError,
  isSupportedPhotoMimeType,
  listAllOrderPhotoGroups,
  listOrderPhotoRecords,
  mobileAlertTargetModeAll,
  mobileAlertTargetModeSelected,
  mobilePushTokenProviderExpo,
  mobilePushTokenProviderFcm,
  moveMondayItemToBoard,
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
  listRegisteredApiRoutes,
  requireAdminRole,
  requireManagerOrAdminRole,
  requireOfficeManagerOrAdminRole,
  requireSalesManagerOrAdminRole,
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
  updateMondayItemJsonColumn,
  updateMondayItemName,
  updateMondayItemStatusColumn,
  updateMondayItemTextColumn,
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

function formatDateForTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(date)
}

function normalizeUidListForDispatch(input, maxItems = 25) {
  const sourceItems = Array.isArray(input)
    ? input
    : [input]
  const seen = new Set()
  const normalized = []

  for (const rawValue of sourceItems) {
    const value = String(rawValue ?? '').trim()

    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)

    if (normalized.length >= maxItems) {
      break
    }
  }

  return normalized
}

async function dispatchDueChatRemindersForCollection({
  asOfDate,
  now,
  chatsCollection,
  authUsersCollection,
  mobileAlertsCollection,
  projection,
  buildAlert,
  buildMetadata,
}) {
  const dueReminderMessages = await chatsCollection
    .find(
      {
        reminder: {
          $type: 'object',
        },
        'reminder.dueDate': {
          $lte: asOfDate,
        },
        'reminder.targetUserUids.0': {
          $exists: true,
        },
        $or: [
          {
            'reminder.notifiedAt': {
              $exists: false,
            },
          },
          {
            'reminder.notifiedAt': null,
          },
          {
            'reminder.notifiedAt': '',
          },
        ],
      },
      {
        projection,
      },
    )
    .sort({ 'reminder.dueDate': 1, createdAt: 1 })
    .limit(1000)
    .toArray()

  if (dueReminderMessages.length === 0) {
    return {
      scannedCount: 0,
      alertedCount: 0,
      alertDocumentCount: 0,
    }
  }

  const allRequestedUids = normalizeUidListForDispatch(
    dueReminderMessages.flatMap((message) => normalizeUidListForDispatch(message?.reminder?.targetUserUids, 50)),
    5000,
  )

  const approvedUsers = allRequestedUids.length > 0
    ? await authUsersCollection
      .find(
        {
          uid: {
            $in: allRequestedUids,
          },
          approvalStatus: authApprovalApproved,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      .toArray()
    : []

  const approvedUsersByUid = new Map(
    approvedUsers
      .map((document) => toPublicAuthUser(document))
      .filter((user) => Boolean(user?.uid))
      .map((user) => [user.uid, user]),
  )

  const alertDocuments = []
  const chatReminderUpdateOps = []
  let alertedCount = 0

  for (const chatMessage of dueReminderMessages) {
    const reminder = chatMessage?.reminder && typeof chatMessage.reminder === 'object'
      ? chatMessage.reminder
      : null

    if (!reminder) {
      continue
    }

    const requestedRecipientUids = normalizeUidListForDispatch(reminder.targetUserUids)
    const recipientUids = requestedRecipientUids.filter((uid) => approvedUsersByUid.has(uid))

    if (recipientUids.length > 0) {
      const alert = buildAlert({
        chatMessage,
        reminder,
        recipientUids,
        now,
      })

      alertDocuments.push({
        ...alert,
        metadata: buildMetadata({ chatMessage, reminder }),
      })

      alertedCount += recipientUids.length
    }

    chatReminderUpdateOps.push({
      updateOne: {
        filter: {
          id: String(chatMessage.id ?? '').trim(),
        },
        update: {
          $set: {
            'reminder.notifiedAt': now,
            'reminder.notifiedRecipientUids': recipientUids,
          },
        },
      },
    })
  }

  if (alertDocuments.length > 0) {
    await mobileAlertsCollection.insertMany(alertDocuments)
  }

  if (chatReminderUpdateOps.length > 0) {
    await chatsCollection.bulkWrite(chatReminderUpdateOps, {
      ordered: false,
    })
  }

  return {
    scannedCount: dueReminderMessages.length,
    alertedCount,
    alertDocumentCount: alertDocuments.length,
  }
}

// Shared alert envelope for due chat reminders; CRM and orders reminders only
// differ by the subject label in the title and their metadata payloads.
function buildDueReminderAlert({ chatMessage, reminder, recipientUids, now, subjectLabel }) {
  const actor = String(chatMessage.createdByName || chatMessage.createdByEmail || 'A teammate').trim()
  const reminderNote = String(reminder.note ?? '').trim()

  return {
    id: randomUUID(),
    title: `Reminder due today: ${subjectLabel}`,
    message: reminderNote
      ? `${actor} reminder is due today: ${reminderNote.slice(0, 300)}`
      : `${actor} reminder is due today.`,
    isUpdate: false,
    targetMode: mobileAlertTargetModeSelected,
    targetUserUids: recipientUids,
    createdByUid: String(chatMessage.createdByUid ?? '').trim() || null,
    createdByEmail: String(chatMessage.createdByEmail ?? '').trim() || null,
    delivery: {
      targetUserCount: recipientUids.length,
      pushTokenCount: 0,
      pushAcceptedCount: 0,
      pushErrorCount: 0,
      errorSamples: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}

async function dispatchDueCrmChatReminders({ asOfDate }) {
  const { databasesByDomain, authUsersCollection, mobileAlertsCollection } = await getCollections()
  const crmAccountChatsCollection = databasesByDomain.crm.collection('crm_account_chats')
  const ordersChatsCollection = databasesByDomain.orders.collection('orders_chats')
  const now = new Date().toISOString()

  const [crmSummary, ordersSummary] = await Promise.all([
    dispatchDueChatRemindersForCollection({
      asOfDate,
      now,
      chatsCollection: crmAccountChatsCollection,
      authUsersCollection,
      mobileAlertsCollection,
      projection: {
        _id: 0,
        id: 1,
        dealerSourceId: 1,
        createdByUid: 1,
        createdByEmail: 1,
        createdByName: 1,
        reminder: 1,
      },
      buildAlert: ({ chatMessage, reminder, recipientUids }) => buildDueReminderAlert({
        chatMessage,
        reminder,
        recipientUids,
        now,
        subjectLabel: String(chatMessage.dealerSourceId ?? '').trim() || 'Account',
      }),
      buildMetadata: ({ chatMessage, reminder }) => ({
        source: 'crm_chat_reminder_due',
        dealerSourceId: String(chatMessage.dealerSourceId ?? '').trim() || null,
        chatMessageId: String(chatMessage.id ?? '').trim() || null,
        reminderId: String(reminder.id ?? '').trim() || null,
        dueDate: String(reminder.dueDate ?? '').trim() || null,
      }),
    }),
    dispatchDueChatRemindersForCollection({
      asOfDate,
      now,
      chatsCollection: ordersChatsCollection,
      authUsersCollection,
      mobileAlertsCollection,
      projection: {
        _id: 0,
        id: 1,
        orderId: 1,
        orderNumber: 1,
        mondayItemId: 1,
        orderName: 1,
        createdByUid: 1,
        createdByEmail: 1,
        createdByName: 1,
        reminder: 1,
      },
      buildAlert: ({ chatMessage, reminder, recipientUids }) => buildDueReminderAlert({
        chatMessage,
        reminder,
        recipientUids,
        now,
        subjectLabel: String(chatMessage.orderNumber ?? '').trim()
          || String(chatMessage.orderName ?? '').trim()
          || String(chatMessage.orderId ?? '').trim()
          || 'Order',
      }),
      buildMetadata: ({ chatMessage, reminder }) => ({
        source: 'orders_chat_reminder_due',
        orderId: String(chatMessage.orderId ?? '').trim() || null,
        orderNumber: String(chatMessage.orderNumber ?? '').trim() || null,
        mondayItemId: String(chatMessage.mondayItemId ?? '').trim() || null,
        orderName: String(chatMessage.orderName ?? '').trim() || null,
        chatMessageId: String(chatMessage.id ?? '').trim() || null,
        reminderId: String(reminder.id ?? '').trim() || null,
        dueDate: String(reminder.dueDate ?? '').trim() || null,
      }),
    }),
  ])

  return {
    scannedCount: crmSummary.scannedCount + ordersSummary.scannedCount,
    alertedCount: crmSummary.alertedCount + ordersSummary.alertedCount,
    alertDocumentCount: crmSummary.alertDocumentCount + ordersSummary.alertDocumentCount,
    crm: crmSummary,
    orders: ordersSummary,
  }
}

async function dispatchDueQuoteFollowUpReminders() {
  const { authUsersCollection, crmQuotesCollection, mobileAlertsCollection } = await getCollections()
  const now = new Date()
  const nowIsoValue = now.toISOString()
  const [users, quotes] = await Promise.all([
    authUsersCollection.find(
      {
        approvalStatus: authApprovalApproved,
        'quoteReminderSettings.rules.0': { $exists: true },
      },
      { projection: { _id: 0, uid: 1, email: 1, linkedSalesRepName: 1, quoteReminderSettings: 1 } },
    ).toArray(),
    crmQuotesCollection.find(
      { status: { $in: ['draft', 'sent'] } },
      { projection: { _id: 0, id: 1, quoteNumber: 1, title: 1, salesRep: 1, opportunityDate: 1, sentAt: 1, createdAt: 1, lastFollowedUpAt: 1, followUpReminderNotifications: 1 } },
    ).limit(5000).toArray(),
  ])

  const alerts = []
  const quoteUpdates = []

  for (const user of users) {
    const uid = String(user.uid ?? '').trim()
    const linkedSalesRepName = String(user.linkedSalesRepName ?? '').trim().toLowerCase()
    if (!uid) continue
    const rules = Array.isArray(user?.quoteReminderSettings?.rules)
      ? user.quoteReminderSettings.rules.filter((rule) => rule?.kind === 'follow_up_due')
      : []

    for (const quote of quotes) {
      if (linkedSalesRepName && String(quote.salesRep ?? '').trim().toLowerCase() !== linkedSalesRepName) continue
      for (const rule of rules) {
        const ruleId = String(rule?.id ?? '').trim()
        if (!ruleId) continue
        const referenceAt = String(
          rule?.base === 'last_follow_up'
            ? quote.lastFollowedUpAt || ''
            : quote.opportunityDate || quote.sentAt || quote.createdAt || '',
        ).trim()
        const referenceTime = referenceAt ? new Date(referenceAt).getTime() : Number.NaN
        if (!Number.isFinite(referenceTime)) continue
        const afterDays = Math.min(365, Math.max(0, Number(rule?.days ?? 10)))
        const ageDays = Math.max(0, Math.floor((now.getTime() - referenceTime) / 86400000))
        if (ageDays < afterDays) continue
        const alreadyNotified = Array.isArray(quote.followUpReminderNotifications)
          && quote.followUpReminderNotifications.some((entry) => String(entry?.uid ?? '').trim() === uid && String(entry?.ruleId ?? '').trim() === ruleId && String(entry?.referenceAt ?? '').trim() === referenceAt)
        if (alreadyNotified) continue

        const quoteLabel = String(quote.quoteNumber || quote.title || 'Quote').trim()
        alerts.push({
          id: randomUUID(),
          title: `Quote follow-up due: ${quoteLabel}`,
          message: `${quoteLabel} reached your ${afterDays}-day follow-up reminder.`,
          isUpdate: false,
          targetMode: mobileAlertTargetModeSelected,
          targetUserUids: [uid],
          createdByUid: null,
          createdByEmail: null,
          delivery: { targetUserCount: 1, pushTokenCount: 0, pushAcceptedCount: 0, pushErrorCount: 0, errorSamples: [] },
          metadata: { source: 'crm_quote_follow_up_due', quoteId: quote.id, quoteNumber: quote.quoteNumber || null, ruleId, referenceAt, ageDays },
          createdAt: nowIsoValue,
          updatedAt: nowIsoValue,
        })
        quoteUpdates.push({
          updateOne: {
            filter: { id: quote.id },
            update: { $push: { followUpReminderNotifications: { $each: [{ uid, ruleId, referenceAt, notifiedAt: nowIsoValue }], $slice: -500 } } },
          },
        })
      }
    }
  }

  if (alerts.length > 0) await mobileAlertsCollection.insertMany(alerts)
  if (quoteUpdates.length > 0) await crmQuotesCollection.bulkWrite(quoteUpdates, { ordered: false })
  return { alertedCount: alerts.length, updatedQuoteCount: quoteUpdates.length }
}

async function dispatchMissingCustomerSignedBolReminders() {
  const {
    authUsersCollection,
    ordersUnifiedCollection,
    mobileAlertsCollection,
  } = await getCollections()
  const now = new Date()
  const nowIsoValue = now.toISOString()
  const [users, orders] = await Promise.all([
    authUsersCollection.find(
      {
        approvalStatus: authApprovalApproved,
        'quoteReminderSettings.rules': {
          $elemMatch: { kind: 'customer_signed_bol_missing' },
        },
      },
      {
        projection: {
          _id: 0,
          uid: 1,
          quoteReminderSettings: 1,
        },
      },
    ).toArray(),
    ordersUnifiedCollection.find(
      {
        is_cancelled: { $ne: true },
        is_deleted: { $ne: true },
        is_shipped: true,
      },
      {
        projection: {
          _id: 0,
          orderKey: 1,
          order_number: 1,
          order_name: 1,
          shipped_at: 1,
          customer_signed_bol: 1,
          Customer_Signed_BOL: 1,
          Customer_Signed_BOL_source: 1,
          customer_signed_bol_reminder_notifications: 1,
        },
      },
    ).limit(5000).toArray(),
  ])

  const alerts = []
  const orderUpdates = []

  for (const user of users) {
    const uid = String(user?.uid ?? '').trim()
    if (!uid) continue

    const rules = Array.isArray(user?.quoteReminderSettings?.rules)
      ? user.quoteReminderSettings.rules.filter((rule) => rule?.kind === 'customer_signed_bol_missing')
      : []

    for (const order of orders) {
      const hasCustomerSignedBol = Boolean(
        String(order?.customer_signed_bol ?? '').trim()
        || String(order?.Customer_Signed_BOL_source ?? '').trim()
        || String(order?.Customer_Signed_BOL ?? '').trim(),
      )
      if (hasCustomerSignedBol) continue

      const referenceAt = String(order?.shipped_at ?? '').trim()
      const referenceTime = referenceAt ? new Date(referenceAt).getTime() : Number.NaN
      if (!Number.isFinite(referenceTime)) continue

      for (const rule of rules) {
        const ruleId = String(rule?.id ?? '').trim()
        if (!ruleId) continue

        const afterDays = Math.min(365, Math.max(0, Number(rule?.days ?? 10)))
        const ageDays = Math.max(0, Math.floor((now.getTime() - referenceTime) / 86400000))
        if (ageDays < afterDays) continue

        const alreadyNotified = Array.isArray(order?.customer_signed_bol_reminder_notifications)
          && order.customer_signed_bol_reminder_notifications.some((entry) =>
            String(entry?.uid ?? '').trim() === uid
            && String(entry?.ruleId ?? '').trim() === ruleId
            && String(entry?.referenceAt ?? '').trim() === referenceAt
          )
        if (alreadyNotified) continue

        const orderLabel = String(order?.order_number || order?.order_name || 'Order').trim()
        const orderKey = String(order?.orderKey ?? '').trim()
        const orderNumber = String(order?.order_number ?? '').trim()
        if (!orderKey && !orderNumber) continue

        alerts.push({
          id: randomUUID(),
          title: `Customer Signed BOL missing: ${orderLabel}`,
          message: `${orderLabel} was shipped ${ageDays} day${ageDays === 1 ? '' : 's'} ago and is still missing the Customer Signed BOL.`,
          isUpdate: false,
          targetMode: mobileAlertTargetModeSelected,
          targetUserUids: [uid],
          createdByUid: null,
          createdByEmail: null,
          delivery: {
            targetUserCount: 1,
            pushTokenCount: 0,
            pushAcceptedCount: 0,
            pushErrorCount: 0,
            errorSamples: [],
          },
          metadata: {
            source: 'orders_customer_signed_bol_missing',
            orderKey: String(order?.orderKey ?? '').trim() || null,
            orderNumber: String(order?.order_number ?? '').trim() || null,
            ruleId,
            referenceAt,
            ageDays,
          },
          createdAt: nowIsoValue,
          updatedAt: nowIsoValue,
        })
        orderUpdates.push({
          updateOne: {
            filter: orderKey ? { orderKey } : { order_number: orderNumber },
            update: {
              $push: {
                customer_signed_bol_reminder_notifications: {
                  $each: [{ uid, ruleId, referenceAt, notifiedAt: nowIsoValue }],
                  $slice: -500,
                },
              },
            },
          },
        })
      }
    }
  }

  if (alerts.length > 0) await mobileAlertsCollection.insertMany(alerts)
  if (orderUpdates.length > 0) await ordersUnifiedCollection.bulkWrite(orderUpdates, { ordered: false })

  return {
    alertedCount: alerts.length,
    updatedOrderCount: orderUpdates.length,
  }
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
registerAiCouncilRoutes(app, routeDeps)
registerAuthRoutes(app, routeDeps)
registerAlertsRoutes(app, routeDeps)
registerChatRoutes(app, routeDeps)
registerCrmRoutes(app, routeDeps)
const ordersRoutesRuntime = registerOrdersRoutes(app, routeDeps) || {}
registerDashboardSupportRoutes(app, routeDeps)
registerDiagnosticReportsRoutes(app, routeDeps)
registerEmailRoutes(app, routeDeps)
const { runEmailIntakeSyncCycle } = registerEmailIntakeRoutes(app, routeDeps)
registerOrderPhotoRoutes(app, routeDeps)
const { tokenIdentity: verifyMcpAccessToken } = registerMcpOAuthRoutes(mcpReadOnlyApp, {
  getCollections,
  ownerEmail,
})
registerReadOnlyMcpRoutes(mcpReadOnlyApp, {
  ...routeDeps,
  getReadOnlyCollections,
  verifyMcpAccessToken,
})
mcpReadOnlyApp.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500
  console[status >= 500 ? 'error' : 'warn']('MCP OAuth request failed.', { status, message: error?.message || 'Unknown error' })
  res.status(status).json({ error: String(error?.message || 'MCP OAuth request failed.') })
})
registerPurchasingRoutes(app, routeDeps)
registerQuickBooksRoutes(app, routeDeps)
registerSlackRoutes(app, routeDeps)
registerSmsBridgeRoutes(app, routeDeps)
registerTimesheetRoutes(app, routeDeps)
registerTrimbleRoutes(app, routeDeps)
registerVisitorsRoutes(app, routeDeps)
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

export const dispatchCrmReminderNotifications = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub.schedule(crmReminderDispatchCron)
  .timeZone(crmReminderDispatchTimeZone)
  .onRun(async () => {
    const asOfDate = formatDateForTimeZone(new Date(), crmReminderDispatchTimeZone)
    const [chatSummary, quoteSummary, orderDocumentSummary] = await Promise.all([
      dispatchDueCrmChatReminders({ asOfDate }),
      dispatchDueQuoteFollowUpReminders(),
      dispatchMissingCustomerSignedBolReminders(),
    ])
    const summary = {
      chat: chatSummary,
      quotes: quoteSummary,
      orderDocuments: orderDocumentSummary,
    }

    console.info('dispatchCrmReminderNotifications completed.', {
      asOfDate,
      ...summary,
    })

    return {
      asOfDate,
      ...summary,
    }
  })

export const scheduledEmailIntakeSync = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub.schedule(emailIntakeSyncCron)
  .timeZone(emailIntakeSyncTimeZone)
  .onRun(async () => {
    if (!emailIntakeScheduledSyncEnabled) {
      const summary = {
        skipped: true,
        reason: 'Scheduled email intake sync is disabled. Use manual Sync from Admin Email Review.',
        completedAt: new Date().toISOString(),
      }

      console.info('scheduledEmailIntakeSync skipped.', summary)

      return summary
    }

    const summary = await runEmailIntakeSyncCycle({
      maxConnections: 80,
    })

    console.info('scheduledEmailIntakeSync completed.', summary)

    return summary
  })

export const processOrdersProgressStatusQueue = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub.schedule(ordersProgressStatusQueueCron)
  .timeZone(ordersProgressStatusQueueTimeZone)
  .onRun(async () => {
    const processQueue = ordersRoutesRuntime?.processQueuedMondayProgressStatusUpdates

    if (typeof processQueue !== 'function') {
      const summary = {
        skipped: true,
        reason: 'Orders progress-status queue processor is unavailable.',
        completedAt: new Date().toISOString(),
      }

      console.warn('processOrdersProgressStatusQueue skipped.', summary)

      return summary
    }

    const summary = await processQueue({
      maxJobs: 120,
      source: 'scheduled',
    })

    if (Number(summary?.processedCount ?? 0) > 0 || Number(summary?.failedCount ?? 0) > 0) {
      console.info('processOrdersProgressStatusQueue completed.', summary)
    }

    return summary
  })

export const processOrdersMondayDetailsQueue = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub.schedule(ordersProgressStatusQueueCron)
  .timeZone(ordersProgressStatusQueueTimeZone)
  .onRun(async () => {
    const processQueue = ordersRoutesRuntime?.processQueuedMondayOrderDetailsUpdates

    if (typeof processQueue !== 'function') {
      return {
        skipped: true,
        reason: 'Orders Monday-details queue processor is unavailable.',
        completedAt: new Date().toISOString(),
      }
    }

    const summary = await processQueue({
      maxJobs: 80,
      source: 'scheduled',
    })

    if (Number(summary?.processedCount ?? 0) > 0 || Number(summary?.failedCount ?? 0) > 0) {
      console.info('processOrdersMondayDetailsQueue completed.', summary)
    }

    return summary
  })

export const apiV1 = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 300,
    // 3D model preparation (draco encode + texture recompression) needs the
    // extra headroom on larger SketchUp exports.
    memory: '1GB',
  })
  .https.onRequest(app)

export const mcpReadOnly = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: [
      'MCP_GOOGLE_CLIENT_ID',
      'MCP_GOOGLE_CLIENT_SECRET',
      'MCP_OAUTH_ES256_PRIVATE_KEY',
      'MCP_OAUTH_ISSUER',
      'MCP_OAUTH_AUDIENCE',
    ],
  })
  .https.onRequest(mcpReadOnlyApp)
