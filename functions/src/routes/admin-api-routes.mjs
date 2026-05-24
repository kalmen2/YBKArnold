import { NO_ID, nowIso } from '../utils/value-utils.mjs'

const apiKeysLimitDefault = 200
const apiKeysLimitMax = 1000

function normalizeShortText(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function toPublicApiKey(document) {
  const keyPrefix = normalizeShortText(document?.keyPrefix, 24) || null
  const keyPreview = keyPrefix ? `${keyPrefix}...` : null
  const revokedAt = normalizeShortText(document?.revokedAt, 80) || null

  return {
    id: normalizeShortText(document?.id, 120),
    name: normalizeShortText(document?.name, 180) || null,
    keyPrefix,
    keyPreview,
    createdAt: normalizeShortText(document?.createdAt, 80) || null,
    updatedAt: normalizeShortText(document?.updatedAt, 80) || null,
    lastUsedAt: normalizeShortText(document?.lastUsedAt, 80) || null,
    lastUsedClientPlatform: normalizeShortText(document?.lastUsedClientPlatform, 20) || null,
    lastUsedIpAddress: normalizeShortText(document?.lastUsedIpAddress, 80) || null,
    revokedAt,
    isRevoked: Boolean(revokedAt),
    createdBy: {
      uid: normalizeShortText(document?.createdByUid, 160) || null,
      email: normalizeShortText(document?.createdByEmail, 320) || null,
      displayName: normalizeShortText(document?.createdByDisplayName, 180) || null,
    },
    revokedBy: {
      uid: normalizeShortText(document?.revokedByUid, 160) || null,
      email: normalizeShortText(document?.revokedByEmail, 320) || null,
      displayName: normalizeShortText(document?.revokedByDisplayName, 180) || null,
    },
  }
}

function resolveBaseUrl(req) {
  const configuredBaseUrl = normalizeShortText(process.env.API_PUBLIC_BASE_URL, 320)
    .replace(/\/+$/, '')

  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  const forwardedProtoRaw = normalizeShortText(req.headers?.['x-forwarded-proto'], 32)
  const forwardedProto = forwardedProtoRaw
    ? forwardedProtoRaw.split(',')[0].trim()
    : ''
  const protocol = forwardedProto || normalizeShortText(req.protocol, 12) || 'https'
  const forwardedHostRaw = normalizeShortText(req.headers?.['x-forwarded-host'], 320)
  const forwardedHost = forwardedHostRaw
    ? forwardedHostRaw.split(',')[0].trim()
    : ''
  const host = forwardedHost || normalizeShortText(req.headers?.host, 320)

  if (!host) {
    return '/api'
  }

  const normalizedHost = host
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  const isCloudFunctionsHost = /\.cloudfunctions\.net$/i.test(normalizedHost)

  if (isCloudFunctionsHost) {
    const firebaseProjectId = normalizeShortText(
      process.env.FIREBASE_PROJECT_ID
      || process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT,
      120,
    )

    if (firebaseProjectId) {
      return `${protocol}://${firebaseProjectId}.web.app/api`
    }

    const functionName = normalizeShortText(
      process.env.FUNCTION_TARGET || process.env.K_SERVICE,
      120,
    )

    if (functionName) {
      return `${protocol}://${normalizedHost}/${functionName}/api`
    }
  }

  return `${protocol}://${normalizedHost}/api`
}

export function registerAdminApiRoutes(app, deps) {
  const {
    generateApiKeyValue,
    getCollections,
    hashApiKeyValue,
    listRegisteredApiRoutes,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
    toBoundedInteger,
    toPublicAuthUser,
  } = deps

app.get('/api/admin/api-docs', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const endpoints = Array.isArray(listRegisteredApiRoutes?.())
      ? listRegisteredApiRoutes()
      : []

    const sectionsMap = new Map()

    for (const endpoint of endpoints) {
      const sectionId = normalizeShortText(endpoint?.section?.id, 80) || 'general'

      if (!sectionsMap.has(sectionId)) {
        sectionsMap.set(sectionId, {
          id: sectionId,
          title: normalizeShortText(endpoint?.section?.title, 160) || 'General',
          description: normalizeShortText(endpoint?.section?.description, 480) || 'General API operations.',
        })
      }
    }

    const sections = [...sectionsMap.values()]
      .sort((left, right) => left.title.localeCompare(right.title))

    return res.json({
      title: 'API DAX full documentation',
      version: 'v1',
      baseUrl: resolveBaseUrl(req),
      overview: 'Comprehensive API reference for all currently registered platform endpoints.',
      authentication: {
        firebaseBearer: {
          header: 'Authorization: Bearer <firebase-id-token>',
          description: 'Use a Firebase ID token for user-scoped API access tied to account role and approvals.',
        },
        apiKey: {
          header: 'x-api-key: <api-key>',
          alternativeBearer: 'Authorization: Bearer <api-key>',
          description: 'Admin API keys are treated as admin-equivalent access across authenticated endpoints.',
        },
      },
      sections,
      endpoints,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/api-keys', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const limit = toBoundedInteger(
      req.query?.limit,
      1,
      apiKeysLimitMax,
      apiKeysLimitDefault,
    )
    const { apiKeysCollection } = await getCollections()
    const keys = await apiKeysCollection
      .find(
        {},
        NO_ID,
      )
      .sort({ createdAt: -1, updatedAt: -1 })
      .limit(limit)
      .toArray()

    return res.json({
      generatedAt: nowIso(),
      keys: keys.map((document) => toPublicApiKey(document)),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/api-keys', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved || !publicUser?.isAdmin) {
      return res.status(403).json({ error: 'Admin access is required.' })
    }

    const name = normalizeShortText(req.body?.name, 180) || null
    const now = nowIso()
    const { apiKeysCollection } = await getCollections()

    let createdDocument = null
    let plainTextKey = ''

    for (let attempt = 0; attempt < 4; attempt += 1) {
      plainTextKey = generateApiKeyValue()
      const keyHash = hashApiKeyValue(plainTextKey)
      const keyPrefix = normalizeShortText(plainTextKey, 14)

      if (!keyHash || !keyPrefix) {
        continue
      }

      const candidateDocument = {
        id: randomUUID(),
        name,
        keyHash,
        keyPrefix,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        lastUsedClientPlatform: null,
        lastUsedIpAddress: null,
        revokedAt: null,
        revokedByUid: null,
        revokedByEmail: null,
        revokedByDisplayName: null,
        createdByUid: normalizeShortText(publicUser.uid, 160),
        createdByEmail: normalizeShortText(publicUser.email, 320),
        createdByDisplayName: normalizeShortText(publicUser.displayName, 180) || null,
      }

      try {
        await apiKeysCollection.insertOne(candidateDocument)
        createdDocument = candidateDocument
        break
      } catch (error) {
        if (Number(error?.code) !== 11000) {
          throw error
        }
      }
    }

    if (!createdDocument || !plainTextKey) {
      throw {
        status: 500,
        message: 'Unable to generate API key. Please try again.',
      }
    }

    return res.status(201).json({
      key: toPublicApiKey(createdDocument),
      plainTextKey,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/api-keys/:keyId/revoke', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
  try {
    const keyId = normalizeShortText(req.params?.keyId, 120)

    if (!keyId) {
      return res.status(400).json({ error: 'keyId is required.' })
    }

    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved || !publicUser?.isAdmin) {
      return res.status(403).json({ error: 'Admin access is required.' })
    }

    const { apiKeysCollection } = await getCollections()
    const existingKey = await apiKeysCollection.findOne(
      {
        id: keyId,
      },
      NO_ID,
    )

    if (!existingKey) {
      return res.status(404).json({ error: 'API key not found.' })
    }

    if (String(existingKey?.revokedAt ?? '').trim()) {
      return res.json({
        ok: true,
        key: toPublicApiKey(existingKey),
      })
    }

    const now = nowIso()
    const revokedKey = await apiKeysCollection.findOneAndUpdate(
      {
        id: keyId,
      },
      {
        $set: {
          revokedAt: now,
          revokedByUid: normalizeShortText(publicUser.uid, 160),
          revokedByEmail: normalizeShortText(publicUser.email, 320),
          revokedByDisplayName: normalizeShortText(publicUser.displayName, 180) || null,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'after',
        ...NO_ID,
      },
    )

    return res.json({
      ok: true,
      key: toPublicApiKey(revokedKey),
    })
  } catch (error) {
    next(error)
  }
})
}
