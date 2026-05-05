import { MongoClient } from 'mongodb'

const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_system'
const clientId = process.env.QUICKBOOKS_CLIENT_ID
const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
const apiBaseUrl = String(
  process.env.QUICKBOOKS_API_BASE_URL || 'https://quickbooks.api.intuit.com',
).replace(/\/$/, '')

const targetProjectId = '747'
const quickBooksTokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const quickBooksQueryPageSize = 500
const quickBooksMaxQueryPages = 8
const quickBooksMaxDetailRowsPerType = 1200

function normalizeText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function extractRefValue(refValue) {
  if (typeof refValue === 'string') {
    return normalizeText(refValue, 160)
  }

  if (!refValue || typeof refValue !== 'object') {
    return ''
  }

  return normalizeText(refValue.value, 160) || normalizeText(refValue.id, 160) || ''
}

function collectCustomerRefsDeep(input, refsSet, depth = 0) {
  if (depth > 6 || !input) {
    return
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectCustomerRefsDeep(item, refsSet, depth + 1))
    return
  }

  if (typeof input !== 'object') {
    return
  }

  Object.entries(input).forEach(([key, value]) => {
    if (key === 'CustomerRef') {
      const ref = extractRefValue(value)

      if (ref) {
        refsSet.add(ref)
      }
    }

    if (value && typeof value === 'object') {
      collectCustomerRefsDeep(value, refsSet, depth + 1)
    }
  })
}

function extractProjectRefsFromTxn(transaction) {
  const refs = new Set()
  collectCustomerRefsDeep(transaction, refs)
  return [...refs]
}

function toTimestampMs(value) {
  const ts = Date.parse(normalizeText(value, 80))
  return Number.isFinite(ts) ? ts : null
}

async function exchangeRefreshToken({ refreshToken }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams()

  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', normalizeText(refreshToken, 8000))

  const response = await fetch(quickBooksTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      `refresh_failed_${response.status}: ${payload?.error_description || payload?.error || 'unknown'}`,
    )
  }

  return {
    accessToken: normalizeText(payload?.access_token, 8000),
    refreshToken: normalizeText(payload?.refresh_token, 8000),
    accessTokenExpiresAt: Number.isFinite(Number(payload?.expires_in))
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null,
  }
}

async function runQuery({ realmId, accessToken, query }) {
  const endpoint = `${apiBaseUrl}/v3/company/${encodeURIComponent(realmId)}/query?minorversion=75&query=${encodeURIComponent(query)}`

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      `query_failed_${response.status}: ${payload?.Fault?.Error?.[0]?.Detail || payload?.Fault?.Error?.[0]?.Message || 'unknown'}`,
    )
  }

  return payload
}

async function queryAll(entityName, queryFn) {
  const rows = []
  let startPosition = 1
  let page = 0

  while (page < quickBooksMaxQueryPages) {
    const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${quickBooksQueryPageSize}`
    const payload = await queryFn(query)
    const batchRows = Array.isArray(payload?.QueryResponse?.[entityName])
      ? payload.QueryResponse[entityName]
      : []

    rows.push(...batchRows)
    page += 1

    if (batchRows.length < quickBooksQueryPageSize) {
      break
    }

    startPosition += quickBooksQueryPageSize
  }

  return { rows }
}

if (!mongoUri || !clientId || !clientSecret) {
  throw new Error('Missing required env vars (mongo/quickbooks).')
}

const mongo = new MongoClient(mongoUri)
await mongo.connect()

try {
  const db = mongo.db(mongoDbName)
  const tokens = db.collection('quickbooks_oauth_tokens')
  let tokenDoc = await tokens.findOne({ id: 'primary' })

  if (!tokenDoc) {
    throw new Error('missing quickbooks token doc')
  }

  const accessExpMs = toTimestampMs(tokenDoc.accessTokenExpiresAt)

  if (!accessExpMs || Date.now() >= accessExpMs - 120000) {
    const refreshed = await exchangeRefreshToken({ refreshToken: tokenDoc.refreshToken })

    await tokens.updateOne(
      { id: 'primary' },
      {
        $set: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          updatedAt: new Date().toISOString(),
          lastRefreshAt: new Date().toISOString(),
        },
      },
    )

    tokenDoc = { ...tokenDoc, ...refreshed }
  }

  const realmId = normalizeText(tokenDoc.realmId, 160)
  const queryFn = (query) => runQuery({ realmId, accessToken: tokenDoc.accessToken, query })

  const [customersResult, billsResult] = await Promise.all([
    queryAll('Customer', queryFn),
    queryAll('Bill', queryFn),
  ])

  const projectsById = new Map()

  for (const customer of customersResult.rows) {
    if (customer?.Job !== true) {
      continue
    }

    const id = normalizeText(customer?.Id, 160)

    if (!id) {
      continue
    }

    projectsById.set(id, {
      projectName:
        normalizeText(customer?.FullyQualifiedName, 260)
        || normalizeText(customer?.DisplayName, 260)
        || id,
    })
  }

  const projectIdsSet = new Set(projectsById.keys())
  const serviceLikeTargetBillDetails = []
  const routeLikeTargetBillDetails = []
  const routeLikeUnlinkedTargetCandidates = []

  for (const bill of billsResult.rows) {
    const refsRaw = extractProjectRefsFromTxn(bill)
      .map((value) => normalizeText(value, 160))
      .filter(Boolean)
    const refsMatchedToProjects = refsRaw.filter((value) => projectIdsSet.has(value))

    const detailBase = {
      id: normalizeText(bill?.Id, 160) || null,
      docNumber: normalizeText(bill?.DocNumber, 160) || normalizeText(bill?.Id, 160) || null,
      txnDate: normalizeText(bill?.TxnDate, 40) || null,
      totalAmount: Number(bill?.TotalAmt ?? 0),
      refsRaw,
      refsMatchedToProjects,
    }

    // Service path (`quickbooks-projects-service`) behavior:
    // filter refs to known project ids, then require exactly one.
    if (refsMatchedToProjects.length === 1 && refsMatchedToProjects[0] === targetProjectId) {
      serviceLikeTargetBillDetails.push({
        ...detailBase,
        projectId: targetProjectId,
        projectName: projectsById.get(targetProjectId)?.projectName ?? null,
      })
    }

    // Route path (`quickbooks-routes`) behavior:
    // use raw refs, require exactly one raw ref, then lookup project.
    if (refsRaw.length === 1 && refsRaw[0] === targetProjectId) {
      routeLikeTargetBillDetails.push({
        ...detailBase,
        projectId: targetProjectId,
        projectName: projectsById.get(targetProjectId)?.projectName ?? null,
      })
    } else if (refsMatchedToProjects.includes(targetProjectId)) {
      routeLikeUnlinkedTargetCandidates.push(detailBase)
    }
  }

  console.log('projects_total:', projectsById.size)
  console.log('bills_total_raw:', billsResult.rows.length)
  console.log('target_project_id:', targetProjectId)
  console.log('target_project_name:', projectsById.get(targetProjectId)?.projectName ?? null)
  console.log('service_like_target_bills_count:', serviceLikeTargetBillDetails.length)
  console.log(
    'service_like_target_bills_amount:',
    Number(serviceLikeTargetBillDetails.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0).toFixed(2)),
  )
  console.log('route_like_target_bills_count:', routeLikeTargetBillDetails.length)
  console.log(
    'route_like_target_bills_amount:',
    Number(routeLikeTargetBillDetails.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0).toFixed(2)),
  )
  console.log('route_like_unlinked_target_candidates_count:', routeLikeUnlinkedTargetCandidates.length)
  console.log(
    'route_like_unlinked_target_candidates_docs:',
    routeLikeUnlinkedTargetCandidates
      .map((row) => `${row.docNumber}:${Number(row.totalAmount).toFixed(2)} refs=${row.refsRaw.join('|')}`)
      .join(', '),
  )
  console.log(
    'service_like_target_docs:',
    serviceLikeTargetBillDetails.map((row) => `${row.docNumber}:${Number(row.totalAmount).toFixed(2)}`).join(', '),
  )
  console.log(
    'route_like_target_docs:',
    routeLikeTargetBillDetails.map((row) => `${row.docNumber}:${Number(row.totalAmount).toFixed(2)}`).join(', '),
  )
} finally {
  await mongo.close()
}
