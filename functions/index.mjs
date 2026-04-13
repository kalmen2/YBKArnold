import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import * as functions from 'firebase-functions/v1'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { registerAlertsRoutes } from './src/routes/alerts-routes.mjs'
import { registerAuthRoutes } from './src/routes/auth-routes.mjs'
import { registerDashboardSupportRoutes } from './src/routes/dashboard-support-routes.mjs'
import { registerOrderPhotoRoutes } from './src/routes/order-photos-routes.mjs'
import { registerTimesheetRoutes } from './src/routes/timesheet-routes.mjs'
import { createAuthUtils } from './src/services/auth-utils.mjs'
import { createAuthActivityService } from './src/services/auth-activity-service.mjs'
import { createAuthRequestService } from './src/services/auth-request-service.mjs'
import { createDashboardCacheService } from './src/services/dashboard-cache-service.mjs'
import { createMondayDashboardService } from './src/services/monday-dashboard-service.mjs'
import { createMondayOrderPersistenceService } from './src/services/monday-order-persistence-service.mjs'
import { createMondaySnapshotService } from './src/services/monday-snapshot-service.mjs'
import { createMongoCollectionsService } from './src/services/mongo-collections-service.mjs'
import { createOrderPhotoService } from './src/services/order-photo-service.mjs'
import { createPlatformConfigService } from './src/services/platform-config-service.mjs'
import { createPushAlertService } from './src/services/push-alert-service.mjs'
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

app.use(cors({ origin: true }))
app.use(express.json({ limit: '12mb' }))

const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_system'
const mondayApiUrl = process.env.MONDAY_API_URL ?? 'https://api.monday.com/v2'
const mondayApiToken = String(process.env.MONDAY_API_TOKEN ?? '').trim()
const mondayBoardId = String(process.env.MONDAY_BOARD_ID ?? '').trim()
const mondayBoardUrl = String(process.env.MONDAY_BOARD_URL ?? '').trim()
const zendeskApiToken = String(process.env.ZENDESK_API_TOKEN ?? '').trim()
const zendeskEmail = String(process.env.ZENDESK_EMAIL ?? '').trim()
const zendeskUrl = String(process.env.ZENDESK_URL ?? '').trim()
const firebaseProjectId = String(
  process.env.FIREBASE_PROJECT_ID
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCLOUD_PROJECT
    ?? 'ybkarnold-b7ec0',
).trim()
const firebaseStorageBucketName = String(
  process.env.FIREBASE_STORAGE_BUCKET ?? 'ybkarnold-b7ec0.firebasestorage.app',
).trim()
const ownerEmail = 'kal@ybkarnold.com'
const authRoleStandard = 'standard'
const authRoleManager = 'manager'
const authRoleAdmin = 'admin'
const authApprovalPending = 'pending'
const authApprovalApproved = 'approved'
const authActivityTypeApiRequest = 'api_request'
const authActivityTypeUiEvent = 'ui_event'
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
const defaultMobileAndroidUpdateUrl = 'https://ybkarnold-b7ec0.web.app/apk/YBK-APP-local-release.apk'
const defaultMobileIosUpdateUrl = 'https://ybkarnold-b7ec0.web.app/ios-update.html'
const defaultMobileAndroidLatestBuild = 5
const defaultMobileIosLatestBuild = 6
const defaultMobileLatestVersion = '1.2'
const expoPushApiUrl = 'https://exp.host/--/api/v2/push/send'
const zendeskTicketFieldCacheTtlMs = 30 * 60 * 1000
const zendeskTicketFieldErrorCacheTtlMs = 5 * 60 * 1000

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

const mondayProgressStatusConfig = [
  { key: 'priority', titleKeywords: ['priority'], weight: 0 },
  { key: 'design', titleKeywords: ['design'], weight: 13 },
  { key: 'baseForm', titleKeywords: ['base/form', 'base form'], weight: 13 },
  { key: 'build', titleKeywords: ['build'], weight: 13 },
  { key: 'sandOrLam', titleKeywords: ['sand or lam', 'sand', 'lam'], weight: 13 },
  { key: 'sealer', titleKeywords: ['sealer'], weight: 12 },
  { key: 'lacquer', titleKeywords: ['lacquer'], weight: 12 },
  { key: 'ready', titleKeywords: ['ready'], weight: 12 },
  { key: 'invoiced', titleKeywords: ['invoiced'], weight: 12 },
]

const {
  buildBucketCounts,
  compareOrdersByUrgency,
  detectMondayColumns,
  normalizeMondayOrder,
} = createMondayDashboardService({
  mondayBoardUrl,
  mondayProgressStatusConfig,
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
  createZendeskSupportTicket,
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
  clearSupportSnapshotCache,
  getDashboardSnapshotFromCache,
  isDashboardRefreshRequested,
  setDashboardSnapshotCache,
} = createDashboardCacheService({
  getCollections,
})

const {
  extractRequestIpAddress,
  extractRequestUserAgent,
  writeAuthActivityLog,
  writeAuthApiRequestLog,
} = createAuthActivityService({
  authActivityTypeApiRequest,
  authActivityTypeUiEvent,
  getCollections,
  randomUUID,
})

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

const { fetchMondayDashboardSnapshot } = createMondaySnapshotService({
  ensureMondayConfiguration,
  mondayApiUrl,
  mondayApiToken,
  mondayBoardId,
  mondayBoardUrl,
  mondayItemsPageQuery,
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
  getCollections,
})

const {
  requireAdminRole,
  requireApprovedLinkedWorker,
  requireFirebaseAuth,
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
  writeAuthApiRequestLog,
  extractRequestUserAgent,
})

const routeDeps = {
  allocateWorkerNumbers,
  authAccessTimeZoneNewJersey,
  authActivityTypeApiRequest,
  authActivityTypeUiEvent,
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeWebAndApp,
  authClientPlatformApp,
  authRoleAdmin,
  authRoleStandard,
  buildOrderPhotoDownloadFileName,
  clearSupportSnapshotCache,
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
  extractRequestUserAgent,
  fetchMondayDashboardSnapshot,
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
  persistNewMondayOrders,
  randomUUID,
  redactPushTokenForLog,
  requireAdminRole,
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
  writeAuthActivityLog,
}

registerAuthRoutes(app, routeDeps)
registerAlertsRoutes(app, routeDeps)
registerDashboardSupportRoutes(app, routeDeps)
registerOrderPhotoRoutes(app, routeDeps)
registerTimesheetRoutes(app, routeDeps)
app.use((error, _req, res, _next) => {
  const status = Number(error?.status ?? 500)
  const message =
    error?.message || error?.details || 'Unexpected server error occurred.'

  res.status(status).json({ error: message })
})

export async function closeMongoConnections() {
  await mongoCollectionsService.closeMongoConnections()
}

export const apiV1 = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onRequest(app)
