const MONGO_DOMAIN_KEYS = Object.freeze([
  'platform',
  'orders',
  'crm',
  'timesheet',
  'auth',
  'ai',
  'purchasing',
  'integrations',
])

const MONGO_DOMAIN_SUFFIX_BY_KEY = Object.freeze({
  platform: 'platform',
  orders: 'orders',
  crm: 'crm',
  timesheet: 'timesheet',
  auth: 'auth',
  ai: 'ai',
  purchasing: 'purchasing',
  integrations: 'integrations',
})

const MONGO_DOMAIN_DB_ENV_VAR_BY_KEY = Object.freeze({
  platform: 'MONGODB_DB_PLATFORM',
  orders: 'MONGODB_DB_ORDERS',
  crm: 'MONGODB_DB_CRM',
  timesheet: 'MONGODB_DB_TIMESHEET',
  auth: 'MONGODB_DB_AUTH',
  ai: 'MONGODB_DB_AI',
  purchasing: 'MONGODB_DB_PURCHASING',
  integrations: 'MONGODB_DB_INTEGRATIONS',
})

const MONGO_DOMAIN_URI_ENV_VAR_BY_KEY = Object.freeze({
  platform: 'MONGODB_URI_PLATFORM',
  orders: 'MONGODB_URI_ORDERS',
  crm: 'MONGODB_URI_CRM',
  timesheet: 'MONGODB_URI_TIMESHEET',
  auth: 'MONGODB_URI_AUTH',
  ai: 'MONGODB_URI_AI',
  purchasing: 'MONGODB_URI_PURCHASING',
  integrations: 'MONGODB_URI_INTEGRATIONS',
})

const MONGO_DOMAIN_COLLECTIONS = Object.freeze({
  platform: Object.freeze([
    'dashboard_snapshots',
  ]),
  orders: Object.freeze([
    'monday_orders',
    'orders_unified',
  ]),
  crm: Object.freeze([
    'crm_import_runs',
    'crm_accounts',
    'crm_contacts',
    'crm_sales_reps',
    'crm_duplicate_queue',
    'crm_quotes',
    'crm_orders',
  ]),
  timesheet: Object.freeze([
    'workers',
    'timesheet_entries',
    'timesheet_stages',
    'timesheet_order_progress',
    'timesheet_missing_worker_reviews',
  ]),
  auth: Object.freeze([
    'auth_users',
    'mobile_push_tokens',
    'mobile_alerts',
    'mobile_alert_reads',
  ]),
  ai: Object.freeze([
    'ai_rules',
    'ai_comment_summaries',
  ]),
  purchasing: Object.freeze([
    'purchasing_items',
    'purchasing_transactions',
  ]),
  integrations: Object.freeze([
    'quickbooks_oauth_tokens',
    'quickbooks_oauth_states',
  ]),
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function resolveMongoDomainConfiguration({
  mongoDbName,
  mongoUri,
  env = process.env,
}) {
  const normalizedMongoDbName = normalizeText(mongoDbName) || 'arnold_orders'
  const normalizedMongoUri = normalizeText(mongoUri)

  const domains = {}

  for (const domainKey of MONGO_DOMAIN_KEYS) {
    const dbEnvVar = MONGO_DOMAIN_DB_ENV_VAR_BY_KEY[domainKey]
    const uriEnvVar = MONGO_DOMAIN_URI_ENV_VAR_BY_KEY[domainKey]
    const resolvedDbName = normalizeText(env?.[dbEnvVar]) || `${normalizedMongoDbName}_${MONGO_DOMAIN_SUFFIX_BY_KEY[domainKey]}`
    const resolvedUri = normalizeText(env?.[uriEnvVar]) || normalizedMongoUri

    domains[domainKey] = {
      key: domainKey,
      dbName: resolvedDbName,
      uri: resolvedUri,
      dbEnvVar,
      uriEnvVar,
    }
  }

  const isSplitDeployment = MONGO_DOMAIN_KEYS.some((domainKey) => {
    const domainConfig = domains[domainKey]

    return domainConfig.dbName !== normalizedMongoDbName || domainConfig.uri !== normalizedMongoUri
  })

  return {
    base: {
      dbName: normalizedMongoDbName,
      uri: normalizedMongoUri,
    },
    domains,
    domainKeys: [...MONGO_DOMAIN_KEYS],
    isSplitDeployment,
  }
}

export function findMissingMongoDomainUris(mongoDomainConfig) {
  if (!mongoDomainConfig?.domains) {
    return []
  }

  return MONGO_DOMAIN_KEYS
    .map((domainKey) => {
      const domain = mongoDomainConfig.domains[domainKey]

      return {
        domainKey,
        uri: normalizeText(domain?.uri),
        uriEnvVar: domain?.uriEnvVar,
      }
    })
    .filter((entry) => !entry.uri)
}

export {
  MONGO_DOMAIN_COLLECTIONS,
  MONGO_DOMAIN_DB_ENV_VAR_BY_KEY,
  MONGO_DOMAIN_KEYS,
  MONGO_DOMAIN_URI_ENV_VAR_BY_KEY,
}
