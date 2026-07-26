import { randomBytes } from 'node:crypto'
import { createTokenCryptoService } from '../services/token-crypto-service.mjs'
import { normalizeText, nowIso } from '../utils/value-utils.mjs'

const trimbleIdentityBaseUrl = 'https://id.trimble.com'
const trimbleApiBaseUrl = 'https://app.connect.trimble.com/tc/api/2.0'
const trimbleViewerBaseUrl = 'https://web.connect.trimble.com'
const connectionId = 'arnold-contract-primary'
const defaultProjectName = 'Arnold Contract – Customer 3D Models'
const maxModelBytes = 2 * 1024 * 1024 * 1024
const maxPublishedModels = 5
const oauthStateLifetimeMs = 10 * 60 * 1000
const { decryptSecret, encryptSecret } = createTokenCryptoService({
  missingSecretContext: 'Trimble OAuth token encryption',
})

const text = (value, maxLength = 4000) => normalizeText(value, maxLength)

function modelViewLabel(fileName, storedLabel = '', index = 0) {
  const normalizedFileName = text(fileName, 500).replaceAll('\\', '/').split('/').at(-1) || ''
  const fileLabel = normalizedFileName.replace(/\.skp$/i, '').trim()
  const normalizedStoredLabel = text(storedLabel, 160)

  if (normalizedStoredLabel && !/^(?:option\s*\d+|primary\s+view)$/i.test(normalizedStoredLabel)) {
    return normalizedStoredLabel
  }

  return fileLabel || `Sketch${index + 1}`
}

function describeViewerDevice(userAgentInput) {
  const userAgent = text(userAgentInput, 500)
  const browser = /edg\//i.test(userAgent)
    ? 'Microsoft Edge'
    : /chrome\//i.test(userAgent)
      ? 'Google Chrome'
      : /safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)
        ? 'Safari'
        : /firefox\//i.test(userAgent)
          ? 'Firefox'
          : 'Unknown browser'
  const operatingSystem = /iphone|ipad|ipod/i.test(userAgent)
    ? 'iOS / iPadOS'
    : /android/i.test(userAgent)
      ? 'Android'
      : /windows/i.test(userAgent)
        ? 'Windows'
        : /mac os x|macintosh/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown OS'
  const deviceType = /ipad|tablet/i.test(userAgent)
    ? 'Tablet'
    : /mobile|iphone|ipod|android/i.test(userAgent)
      ? 'Mobile'
      : 'Desktop'
  return { browser, operatingSystem, deviceType }
}

function trimbleConfig() {
  const clientId = text(process.env.TRIMBLE_CLIENT_ID, 1000)
  const clientSecret = text(process.env.TRIMBLE_CLIENT_SECRET, 4000)
  const appName = text(process.env.TRIMBLE_APP_NAME, 240) || 'ArnoldContract3DQuoteViewer'
  const redirectUri = text(process.env.TRIMBLE_REDIRECT_URI, 2000)
    || 'https://ybkarnold.com/auth/trimble/callback'
  const projectName = text(process.env.TRIMBLE_PROJECT_NAME, 500) || defaultProjectName

  if (!clientId || !clientSecret) {
    const error = new Error('Trimble integration credentials are not configured.')
    error.status = 503
    throw error
  }

  return { appName, clientId, clientSecret, projectName, redirectUri }
}

function basicAuthorization(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`
}

async function readJsonResponse(response, context) {
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = text(body?.message || body?.error_description || body?.error, 1000)
    const error = new Error(detail ? `${context}: ${detail}` : `${context} (${response.status}).`)
    error.status = response.status === 401 ? 401 : 502
    throw error
  }

  return body
}

async function exchangeAuthorizationCode(code) {
  const config = trimbleConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    tenantDomain: 'trimble.com',
  })
  const response = await fetch(`${trimbleIdentityBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthorization(config.clientId, config.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  })

  return readJsonResponse(response, 'Trimble authorization failed')
}

async function refreshConnectionTokens(collection, connection) {
  const refreshToken = decryptSecret(connection?.refreshTokenEncrypted)

  if (!refreshToken) {
    const error = new Error('Trimble must be connected again.')
    error.status = 401
    throw error
  }

  const config = trimbleConfig()
  const response = await fetch(`${trimbleIdentityBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthorization(config.clientId, config.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      tenantDomain: 'trimble.com',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const tokens = await readJsonResponse(response, 'Trimble session refresh failed')
  const updatedAt = nowIso()
  const expiresIn = Math.max(60, Number(tokens?.expires_in ?? 3600))
  const updates = {
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    refreshTokenEncrypted: encryptSecret(tokens.refresh_token || refreshToken),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    lastRefreshedAt: updatedAt,
    updatedAt,
  }

  await collection.updateOne({ id: connectionId }, { $set: updates })
  return { ...connection, ...updates }
}

async function accessTokenFor(collection) {
  let connection = await collection.findOne({ id: connectionId })

  if (!connection) {
    const error = new Error('Connect the Arnold Trimble account before uploading a 3D model.')
    error.status = 409
    throw error
  }

  const expiresAt = Date.parse(String(connection.expiresAt || ''))
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    connection = await refreshConnectionTokens(collection, connection)
  }

  const accessToken = decryptSecret(connection.accessTokenEncrypted)
  if (!accessToken) {
    const error = new Error('Trimble must be connected again.')
    error.status = 401
    throw error
  }

  return { accessToken, connection }
}

async function trimbleRequest(path, accessToken, options = {}) {
  const response = await fetch(`${trimbleApiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(60_000),
  })
  return readJsonResponse(response, 'Trimble Connect request failed')
}

async function resolveProject(accessToken, projectName) {
  const projects = await trimbleRequest('/projects?fullyLoaded=true', accessToken, {
    headers: { Range: 'items=0-999' },
  })
  const normalizedTarget = projectName.trim().toLowerCase()
  const project = (Array.isArray(projects) ? projects : []).find(
    (candidate) => String(candidate?.name || '').trim().toLowerCase() === normalizedTarget,
  )

  if (!project?.id || !project?.rootId) {
    const error = new Error(`Trimble project “${projectName}” was not found for the connected account.`)
    error.status = 409
    throw error
  }

  return project
}

async function resolveQuoteFolder(accessToken, project, quote) {
  const quoteLabel = text(quote?.quoteNumber || quote?.id, 120).replace(/[^a-z0-9._-]+/gi, '-')
  const folderName = `Quote-${quoteLabel || '3D-Model'}`
  const entries = await trimbleRequest(`/folders/${encodeURIComponent(project.rootId)}/items`, accessToken)
  const existing = (Array.isArray(entries) ? entries : []).find(
    (entry) => entry?.type === 'FOLDER' && String(entry?.name || '').trim().toLowerCase() === folderName.toLowerCase(),
  )

  if (existing?.id) return existing

  return trimbleRequest('/folders', accessToken, {
    method: 'POST',
    body: JSON.stringify({ name: folderName, parentId: project.rootId }),
  })
}

function publicViewerUrl(slug) {
  return `https://ybkarnold.com/3d/${encodeURIComponent(slug)}`
}

function safeModelSummary(model) {
  if (!model || typeof model !== 'object') return null
  const models = Array.isArray(model.models) && model.models.length
    ? model.models
    : (model.fileName ? [model] : [])
  return {
    fileName: text(model.fileName, 500) || null,
    uploadedAt: text(model.uploadedAt, 100) || null,
    uploadedByEmail: text(model.uploadedByEmail, 320) || null,
    viewerUrl: text(model.viewerUrl, 2000) || null,
    status: text(model.status, 80) || null,
    models: models.map((entry, index) => ({
      fileName: text(entry?.fileName, 500) || `3D option ${index + 1}`,
      label: modelViewLabel(entry?.fileName, entry?.label, index),
    })),
  }
}

function existingShareIds(model) {
  const ids = [model?.shareId]
  if (Array.isArray(model?.models)) ids.push(...model.models.map((entry) => entry?.shareId))
  return [...new Set(ids.map((value) => text(value, 500)).filter(Boolean))]
}

function requestedRevisionNumber(request) {
  const rawValue = request?.body?.revisionNumber ?? request?.query?.revisionNumber
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  const parsed = Number.parseInt(String(rawValue), 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function quoteAtRevision(quote, revisionNumber) {
  if (revisionNumber === null) return quote
  const revision = (Array.isArray(quote?.revisions) ? quote.revisions : []).find(
    (entry) => Number(entry?.revisionNumber) === revisionNumber,
  )
  if (!revision) return null
  return {
    ...quote,
    ...revision,
    id: quote.id,
    documents: quote.documents,
    revisions: quote.revisions,
    activeRevisionNumber: quote.activeRevisionNumber,
  }
}

async function setQuoteRevisionModel(crmQuotesCollection, quote, quoteId, revisionNumber, model, updatedAt) {
  if (revisionNumber === null || !Array.isArray(quote?.revisions)) {
    await crmQuotesCollection.updateOne(
      { id: quoteId },
      { $set: { trimble3d: model, updatedAt } },
    )
    return
  }

  const setUpdates = {
    'revisions.$[revision].trimble3d': model,
    'revisions.$[revision].updatedAt': updatedAt,
    updatedAt,
  }
  if (Number(quote.activeRevisionNumber) === revisionNumber) {
    setUpdates.trimble3d = model
  }
  await crmQuotesCollection.updateOne(
    { id: quoteId },
    { $set: setUpdates },
    { arrayFilters: [{ 'revision.revisionNumber': revisionNumber }] },
  )
}

async function unsetQuoteRevisionModel(crmQuotesCollection, quote, quoteId, revisionNumber, updatedAt) {
  if (revisionNumber === null || !Array.isArray(quote?.revisions)) {
    await crmQuotesCollection.updateOne(
      { id: quoteId },
      { $unset: { trimble3d: '' }, $set: { updatedAt } },
    )
    return
  }

  const unsetUpdates = { 'revisions.$[revision].trimble3d': '' }
  if (Number(quote.activeRevisionNumber) === revisionNumber) {
    unsetUpdates.trimble3d = ''
  }
  await crmQuotesCollection.updateOne(
    { id: quoteId },
    {
      $unset: unsetUpdates,
      $set: {
        'revisions.$[revision].updatedAt': updatedAt,
        updatedAt,
      },
    },
    { arrayFilters: [{ 'revision.revisionNumber': revisionNumber }] },
  )
}

async function removeTrimbleShares(accessToken, shareIds) {
  await Promise.all(shareIds.map(async (shareId) => {
    const response = await fetch(`${trimbleApiBaseUrl}/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok && response.status !== 404) await readJsonResponse(response, 'Trimble share removal failed')
  }))
}

async function publishFilesForQuote({ accessToken, authUser, crmQuotesCollection, files, quote, rootQuote, quoteId, revisionNumber = null }) {
  const previousModel = quote?.trimble3d
  const createdShares = []

  try {
    for (const [index, file] of files.entries()) {
      const share = await trimbleRequest('/shares', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'PUBLIC',
          projectId: file.projectId,
          permission: 'VIEW',
          objects: [{ id: file.fileId, type: 'FILE', useLatestVersion: true }],
          message: `Arnold Contract quote ${text(quote.quoteNumber || quote.id, 120)} – ${modelViewLabel(file.fileName, file.label, index)}`,
        }),
      })
      const objectUrl = text(share?.objects?.[0]?.url, 4000)
      const shareToken = objectUrl.split('/').filter(Boolean).at(-1)
      if (!share?.id || !shareToken) throw new Error('Trimble created the model but did not return a viewer share token.')
      createdShares.push({
        fileId: file.fileId,
        versionId: file.versionId || null,
        fileName: file.fileName,
        fileSize: file.fileSize || null,
        label: modelViewLabel(file.fileName, file.label, index),
        shareId: share.id,
        shareToken,
      })
    }
  } catch (error) {
    await removeTrimbleShares(accessToken, createdShares.map((entry) => entry.shareId)).catch(() => {})
    throw error
  }

  const primary = createdShares[0]
  const uploadedAt = nowIso()
  const publicSlug = text(previousModel?.publicSlug, 500) || randomBytes(24).toString('base64url')
  const model = {
    status: 'ready',
    projectId: files[0].projectId,
    models: createdShares,
    fileId: primary.fileId,
    versionId: primary.versionId,
    fileName: primary.fileName,
    fileSize: primary.fileSize,
    shareId: primary.shareId,
    shareToken: primary.shareToken,
    publicSlug,
    viewerUrl: publicViewerUrl(publicSlug),
    uploadedAt,
    uploadedByUid: text(authUser?.uid, 200) || null,
    uploadedByEmail: text(authUser?.email, 320) || null,
  }
  await setQuoteRevisionModel(
    crmQuotesCollection,
    rootQuote || quote,
    quoteId,
    revisionNumber,
    model,
    uploadedAt,
  )

  const newShareIds = new Set(createdShares.map((entry) => entry.shareId))
  const retiredShareIds = existingShareIds(previousModel).filter((shareId) => !newShareIds.has(shareId))
  if (retiredShareIds.length) await removeTrimbleShares(accessToken, retiredShareIds).catch(() => {})
  return model
}

async function uploadSavedRenderingToTrimble({ accessToken, documentUrl, fileName, folder, project }) {
  let sourceUrl
  try {
    sourceUrl = new URL(documentUrl)
  } catch {
    const error = new Error('The saved rendering URL is invalid.')
    error.status = 400
    throw error
  }
  if (sourceUrl.hostname !== 'firebasestorage.googleapis.com') {
    const error = new Error('The saved rendering must be stored in Arnold Firebase Storage.')
    error.status = 400
    throw error
  }

  const sourceResponse = await fetch(documentUrl, { signal: AbortSignal.timeout(240_000) })
  if (!sourceResponse.ok || !sourceResponse.body) {
    const error = new Error('The saved SketchUp rendering could not be downloaded.')
    error.status = 400
    throw error
  }
  const contentLength = Number(sourceResponse.headers.get('content-length') || 0)
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    const error = new Error('The saved SketchUp rendering did not report a valid file size.')
    error.status = 400
    throw error
  }
  if (contentLength > maxModelBytes) {
    const error = new Error('The SketchUp rendering exceeds the 2 GB upload limit.')
    error.status = 400
    throw error
  }

  const upload = await trimbleRequest('/files/fs/initiate', accessToken, {
    method: 'POST',
    body: JSON.stringify({ parentId: folder.id, parentType: 'FOLDER', name: fileName }),
  })
  if (!upload?.uploadId || !upload?.uploadURL) throw new Error('Trimble did not create an upload session.')

  const storageUploadResponse = await fetch(upload.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Length': String(contentLength) },
    body: sourceResponse.body,
    duplex: 'half',
    signal: AbortSignal.timeout(240_000),
  })
  if (!storageUploadResponse.ok) throw new Error(`Trimble file transfer failed (${storageUploadResponse.status}).`)

  const file = await trimbleRequest('/files/fs/commit', accessToken, {
    method: 'POST',
    body: JSON.stringify({ uploadId: upload.uploadId }),
  })
  if (!file?.id) throw new Error('Trimble did not return the uploaded file.')
  return {
    fileId: file.id,
    versionId: file.versionId || null,
    fileName,
    fileSize: contentLength,
    projectId: project.id,
  }
}

async function commitUploadAndPublishViewer({
  accessToken,
  crmQuotesCollection,
  pending,
  quote,
  quoteId,
  uploadId,
  authUser,
  rootQuote,
  revisionNumber,
}) {
  const file = await trimbleRequest('/files/fs/commit', accessToken, {
    method: 'POST',
    body: JSON.stringify({ uploadId }),
  })
  if (!file?.id) throw new Error('Trimble did not return the uploaded file.')
  return publishFilesForQuote({
    accessToken,
    authUser,
    crmQuotesCollection,
    files: [{
      fileId: file.id,
      versionId: file.versionId,
      fileName: pending.fileName,
      fileSize: pending.fileSize,
      projectId: pending.projectId,
      label: modelViewLabel(pending.fileName),
    }],
    quote,
    rootQuote,
    quoteId,
    revisionNumber,
  })
}

export function registerTrimbleRoutes(app, deps) {
  const { authApprovalApproved, extractRequestIpAddress, getCollections, requireFirebaseAuth } = deps

  app.get('/api/trimble/status', requireFirebaseAuth, async (_req, res, next) => {
    try {
      const { trimbleOauthConnectionsCollection } = await getCollections()
      const connection = await trimbleOauthConnectionsCollection.findOne(
        { id: connectionId },
        { projection: { _id: 0, accessTokenEncrypted: 0, refreshTokenEncrypted: 0 } },
      )
      return res.json({
        connected: Boolean(connection),
        projectName: connection?.projectName || trimbleConfig().projectName,
        connectedAt: connection?.connectedAt || null,
        connectedByEmail: connection?.connectedByEmail || null,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/trimble/oauth/start', requireFirebaseAuth, async (req, res, next) => {
    try {
      const config = trimbleConfig()
      const { trimbleOauthStatesCollection } = await getCollections()
      const state = randomBytes(32).toString('base64url')
      const createdAt = nowIso()
      await trimbleOauthStatesCollection.insertOne({
        id: state,
        uid: text(req.authUser?.uid, 200) || null,
        email: text(req.authUser?.email, 320) || null,
        createdAt,
        expiresAt: new Date(Date.now() + oauthStateLifetimeMs),
      })
      const query = new URLSearchParams({
        client_id: config.clientId,
        scope: `openid ${config.appName}`,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        state,
      })
      return res.json({ authorizationUrl: `${trimbleIdentityBaseUrl}/oauth/authorize?${query}` })
    } catch (error) {
      next(error)
    }
  })

  app.get('/auth/trimble/callback', async (req, res) => {
    const state = text(req.query?.state, 500)
    const code = text(req.query?.code, 4000)

    try {
      if (!state || !code) throw new Error('Trimble did not return a valid authorization response.')
      const { trimbleOauthConnectionsCollection, trimbleOauthStatesCollection } = await getCollections()
      const stateRecord = await trimbleOauthStatesCollection.findOneAndDelete({
        id: state,
        expiresAt: { $gt: new Date() },
      })
      if (!stateRecord) throw new Error('This Trimble sign-in request expired. Start the connection again.')

      const tokens = await exchangeAuthorizationCode(code)
      const accessToken = text(tokens?.access_token, 12000)
      const refreshToken = text(tokens?.refresh_token, 12000)
      if (!accessToken || !refreshToken) throw new Error('Trimble did not return the required tokens.')
      const config = trimbleConfig()
      const project = await resolveProject(accessToken, config.projectName)
      const updatedAt = nowIso()

      await trimbleOauthConnectionsCollection.updateOne(
        { id: connectionId },
        {
          $set: {
            id: connectionId,
            accessTokenEncrypted: encryptSecret(accessToken),
            refreshTokenEncrypted: encryptSecret(refreshToken),
            expiresAt: new Date(Date.now() + Math.max(60, Number(tokens?.expires_in ?? 3600)) * 1000).toISOString(),
            projectId: project.id,
            projectRootId: project.rootId,
            projectName: project.name,
            connectedByUid: stateRecord.uid || null,
            connectedByEmail: stateRecord.email || null,
            connectedAt: updatedAt,
            updatedAt,
          },
        },
        { upsert: true },
      )

      return res.redirect(302, '/sales?trimble=connected')
    } catch (error) {
      console.error('Trimble OAuth callback failed.', { message: error instanceof Error ? error.message : String(error) })
      const message = encodeURIComponent(error instanceof Error ? error.message : 'Trimble connection failed.')
      return res.redirect(302, `/sales?trimble=error&message=${message}`)
    }
  })

  app.post('/api/trimble/quotes/:quoteId/uploads/initiate', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = text(req.params.quoteId, 200)
      const fileName = text(req.body?.fileName, 500)
      const fileSize = Number(req.body?.fileSize ?? 0)
      if (!quoteId || !fileName.toLowerCase().endsWith('.skp')) {
        return res.status(400).json({ error: 'Select a SketchUp .skp file.' })
      }
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxModelBytes) {
        return res.status(400).json({ error: 'The SketchUp file must be between 1 byte and 2 GB.' })
      }

      const { crmQuotesCollection, trimbleOauthConnectionsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!rootQuote) return res.status(404).json({ error: 'Quote not found.' })
      const revisionNumber = requestedRevisionNumber(req)
      const quote = quoteAtRevision(rootQuote, revisionNumber)
      if (!quote) return res.status(404).json({ error: 'Quote revision not found.' })

      const { accessToken } = await accessTokenFor(trimbleOauthConnectionsCollection)
      const project = await resolveProject(accessToken, trimbleConfig().projectName)
      const folder = await resolveQuoteFolder(accessToken, project, quote)
      const upload = await trimbleRequest('/files/fs/initiate', accessToken, {
        method: 'POST',
        body: JSON.stringify({ parentId: folder.id, parentType: 'FOLDER', name: fileName }),
      })
      if (!upload?.uploadId || !upload?.uploadURL) throw new Error('Trimble did not create an upload session.')

      const pendingUpload = {
        uploadId: upload.uploadId,
        fileName,
        fileSize,
        projectId: project.id,
        folderId: folder.id,
        createdAt: nowIso(),
        createdByUid: text(req.authUser?.uid, 200) || null,
      }
      await setQuoteRevisionModel(
        crmQuotesCollection,
        rootQuote,
        quoteId,
        revisionNumber,
        { ...(quote.trimble3d || {}), pendingUpload },
        nowIso(),
      )
      return res.json({ uploadId: upload.uploadId, uploadUrl: upload.uploadURL })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/trimble/quotes/:quoteId/uploads/commit', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = text(req.params.quoteId, 200)
      const uploadId = text(req.body?.uploadId, 4000)
      const { crmQuotesCollection, trimbleOauthConnectionsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!rootQuote) return res.status(404).json({ error: 'Quote not found.' })
      const revisionNumber = requestedRevisionNumber(req)
      const quote = quoteAtRevision(rootQuote, revisionNumber)
      if (!quote) return res.status(404).json({ error: 'Quote revision not found.' })
      const pending = quote?.trimble3d?.pendingUpload
      if (!uploadId || uploadId !== pending?.uploadId) return res.status(409).json({ error: 'The model upload session is no longer valid.' })

      const { accessToken } = await accessTokenFor(trimbleOauthConnectionsCollection)
      const model = await commitUploadAndPublishViewer({
        accessToken,
        authUser: req.authUser,
        crmQuotesCollection,
        pending,
        quote,
        rootQuote,
        quoteId,
        revisionNumber,
        uploadId,
      })
      return res.json({ model: safeModelSummary(model) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/trimble/quotes/:quoteId/uploads/from-document', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = text(req.params.quoteId, 200)
      const documentUrl = text(req.body?.documentUrl, 4000)
      const requestedName = text(req.body?.fileName, 500)
      const { crmQuotesCollection, trimbleOauthConnectionsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!rootQuote) return res.status(404).json({ error: 'Quote not found.' })
      const revisionNumber = requestedRevisionNumber(req)
      const quote = quoteAtRevision(rootQuote, revisionNumber)
      if (!quote) return res.status(404).json({ error: 'Quote revision not found.' })

      const storedDocument = (Array.isArray(quote.documents) ? quote.documents : []).find(
        (document) => text(document?.url, 4000) === documentUrl,
      )
      if (!storedDocument) return res.status(400).json({ error: 'The selected rendering is not attached to this quote.' })
      const fileName = (requestedName || text(storedDocument.name, 500)).split('/').at(-1)?.trim()
      if (!fileName || !fileName.toLowerCase().endsWith('.skp')) {
        return res.status(400).json({ error: 'Select a saved SketchUp .skp rendering.' })
      }

      const { accessToken } = await accessTokenFor(trimbleOauthConnectionsCollection)
      const project = await resolveProject(accessToken, trimbleConfig().projectName)
      const folder = await resolveQuoteFolder(accessToken, project, quote)
      const uploadedFile = await uploadSavedRenderingToTrimble({
        accessToken,
        documentUrl,
        fileName,
        folder,
        project,
      })
      const model = await publishFilesForQuote({
        accessToken,
        authUser: req.authUser,
        crmQuotesCollection,
        files: [{ ...uploadedFile, label: modelViewLabel(fileName) }],
        quote,
        rootQuote,
        quoteId,
        revisionNumber,
      })
      return res.json({ model: safeModelSummary(model) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/trimble/quotes/:quoteId/uploads/from-documents', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = text(req.params.quoteId, 200)
      const requestedDocuments = Array.isArray(req.body?.documents) ? req.body.documents : []
      if (!requestedDocuments.length || requestedDocuments.length > maxPublishedModels) {
        return res.status(400).json({ error: `Select between 1 and ${maxPublishedModels} SketchUp renderings.` })
      }

      const { crmQuotesCollection, trimbleOauthConnectionsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!rootQuote) return res.status(404).json({ error: 'Quote not found.' })
      const revisionNumber = requestedRevisionNumber(req)
      const quote = quoteAtRevision(rootQuote, revisionNumber)
      if (!quote) return res.status(404).json({ error: 'Quote revision not found.' })
      const quoteDocuments = Array.isArray(rootQuote.documents) ? rootQuote.documents : []
      const seenUrls = new Set()
      const selections = []

      for (const [index, requested] of requestedDocuments.entries()) {
        const documentUrl = text(requested?.documentUrl, 4000)
        if (!documentUrl || seenUrls.has(documentUrl)) return res.status(400).json({ error: 'Each rendering may only be selected once.' })
        seenUrls.add(documentUrl)
        const storedDocument = quoteDocuments.find((document) => text(document?.url, 4000) === documentUrl)
        if (!storedDocument) return res.status(400).json({ error: 'A selected rendering is no longer attached to this quote.' })
        const fileName = (text(requested?.fileName, 500) || text(storedDocument.name, 500)).split('/').at(-1)?.trim()
        if (!fileName || !fileName.toLowerCase().endsWith('.skp')) {
          return res.status(400).json({ error: 'Every selected rendering must be a SketchUp .skp file.' })
        }
        selections.push({
          documentUrl,
          fileName,
          label: modelViewLabel(fileName, requested?.label, index),
        })
      }

      const { accessToken } = await accessTokenFor(trimbleOauthConnectionsCollection)
      const project = await resolveProject(accessToken, trimbleConfig().projectName)
      const folder = await resolveQuoteFolder(accessToken, project, quote)
      const uploadedFiles = []
      for (const selection of selections) {
        const uploadedFile = await uploadSavedRenderingToTrimble({
          accessToken,
          documentUrl: selection.documentUrl,
          fileName: selection.fileName,
          folder,
          project,
        })
        uploadedFiles.push({ ...uploadedFile, label: selection.label })
      }
      const model = await publishFilesForQuote({
        accessToken,
        authUser: req.authUser,
        crmQuotesCollection,
        files: uploadedFiles,
        quote,
        rootQuote,
        quoteId,
        revisionNumber,
      })
      return res.json({ model: safeModelSummary(model) })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/trimble/quotes/:quoteId/model', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = text(req.params.quoteId, 200)
      const { crmQuotesCollection, trimbleOauthConnectionsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!rootQuote) return res.status(404).json({ error: 'Quote not found.' })
      const revisionNumber = requestedRevisionNumber(req)
      const quote = quoteAtRevision(rootQuote, revisionNumber)
      if (!quote) return res.status(404).json({ error: 'Quote revision not found.' })
      const shareIds = existingShareIds(quote.trimble3d)
      if (shareIds.length) {
        const { accessToken } = await accessTokenFor(trimbleOauthConnectionsCollection)
        await removeTrimbleShares(accessToken, shareIds)
      }
      await unsetQuoteRevisionModel(
        crmQuotesCollection,
        rootQuote,
        quoteId,
        revisionNumber,
        nowIso(),
      )
      return res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/public/3d/:slug', async (req, res, next) => {
    try {
      const slug = text(req.params.slug, 200)
      const { authUsersCollection, crmQuotesCollection, mobileAlertsCollection } = await getCollections()
      const rootQuote = await crmQuotesCollection.findOne(
        {
          $or: [
            { 'trimble3d.publicSlug': slug, 'trimble3d.status': 'ready' },
            { revisions: { $elemMatch: { 'trimble3d.publicSlug': slug, 'trimble3d.status': 'ready' } } },
          ],
        },
        { projection: { _id: 0, id: 1, quoteNumber: 1, title: 1, companyName: 1, dealerName: 1, salesRep: 1, opportunityDate: 1, sentAt: 1, createdAt: 1, lastFollowedUpAt: 1, trimble3d: 1, revisions: 1 } },
      )
      if (!rootQuote) return res.status(404).json({ error: 'This 3D model link is unavailable.' })
      const matchingRevision = (Array.isArray(rootQuote.revisions) ? rootQuote.revisions : []).find(
        (revision) => revision?.trimble3d?.publicSlug === slug && revision?.trimble3d?.status === 'ready',
      )
      const quote = matchingRevision
        ? { ...rootQuote, ...matchingRevision, id: rootQuote.id, revisions: rootQuote.revisions }
        : rootQuote
      const openedAt = nowIso()
      const activityId = randomBytes(16).toString('hex')
      const userAgent = text(req.get('user-agent'), 500) || null
      const device = describeViewerDevice(userAgent)
      const activity = {
        id: activityId,
        type: 'public_3d_opened',
        occurredAt: openedAt,
        link: `/3d/${slug}`,
        ipAddress: text(extractRequestIpAddress(req), 120) || null,
        userAgent,
        browser: device.browser,
        operatingSystem: device.operatingSystem,
        deviceType: device.deviceType,
        referrer: text(req.get('referer'), 1000) || null,
        acceptLanguage: text(req.get('accept-language'), 300) || null,
        location: {
          city: text(req.get('x-appengine-city'), 160) || null,
          region: text(req.get('x-appengine-region'), 160) || null,
          country: text(req.get('x-appengine-country'), 80) || null,
          coordinates: text(req.get('x-appengine-citylatlong'), 100) || null,
        },
      }
      await crmQuotesCollection.updateOne(
        { id: quote.id },
        {
          $set: { lastLinkOpenedAt: openedAt },
          $inc: { linkOpenCount: 1 },
          $push: {
            linkOpenLogs: { $each: [activity], $slice: -1000 },
            activityLog: { $each: [activity], $slice: -1000 },
          },
        },
      )

      const salesRepName = text(quote.salesRep, 200)
      {
        const assignedUsers = await authUsersCollection.find(
          {
            approvalStatus: authApprovalApproved,
            'quoteReminderSettings.rules.0': { $exists: true },
          },
          { projection: { _id: 0, uid: 1, linkedSalesRepName: 1, quoteReminderSettings: 1 } },
        ).toArray()
        const recipientUids = [...new Set(assignedUsers.flatMap((user) => {
          const linkedName = text(user?.linkedSalesRepName, 200).toLowerCase()
          if (linkedName && linkedName !== salesRepName.toLowerCase()) return []
          const linkRules = Array.isArray(user?.quoteReminderSettings?.rules)
            ? user.quoteReminderSettings.rules.filter((rule) => rule?.kind === 'link_opened')
            : []
          const matchedRule = linkRules.find((rule) => {
            const referenceValue = rule?.base === 'last_follow_up'
              ? quote.lastFollowedUpAt
              : quote.opportunityDate || quote.sentAt || quote.createdAt
            const referenceTime = referenceValue ? new Date(referenceValue).getTime() : Number.NaN
            if (!Number.isFinite(referenceTime)) return false
            const ageDays = Math.max(0, Math.floor((Date.now() - referenceTime) / 86400000))
            return ageDays >= Math.min(365, Math.max(0, Number(rule?.days ?? 0)))
          })
          return matchedRule ? [text(user.uid, 160)] : []
        }).filter(Boolean))]
        if (recipientUids.length > 0) {
          await mobileAlertsCollection.insertOne({
            id: randomBytes(16).toString('hex'),
            title: `3D link opened: ${text(quote.quoteNumber, 120) || text(quote.title, 200) || 'Quote'}`,
            message: 'The customer opened the tracked 3D quote link and it matched one of your reminder rules.',
            isUpdate: false,
            targetMode: 'selected',
            targetUserUids: recipientUids,
            createdByUid: null,
            createdByEmail: null,
            delivery: { targetUserCount: recipientUids.length, pushTokenCount: 0, pushAcceptedCount: 0, pushErrorCount: 0, errorSamples: [] },
            metadata: { source: 'crm_quote_link_opened', quoteId: quote.id, quoteNumber: quote.quoteNumber || null, activityId, openedAt },
            createdAt: openedAt,
            updatedAt: openedAt,
          })
        }
      }
      const model = quote.trimble3d
      const hasStoredModels = Array.isArray(model.models) && model.models.length
      const storedModels = hasStoredModels ? model.models : [model]
      const publicModels = storedModels.map((entry, index) => ({
        label: modelViewLabel(entry?.fileName, entry?.label, index),
        fileName: text(entry?.fileName, 500) || `3D option ${index + 1}`,
        embedUrl: `${trimbleViewerBaseUrl}/projects/${encodeURIComponent(model.projectId)}/viewer/3d/?embed=true&stoken=${encodeURIComponent(entry.shareToken)}`,
      }))
      const embedUrl = publicModels[0]?.embedUrl
      if (!embedUrl) return res.status(404).json({ error: 'This 3D model link is unavailable.' })
      res.set('Cache-Control', 'private, no-store')
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
      return res.json({
        quoteNumber: text(quote.quoteNumber, 120) || null,
        projectName: text(quote.title, 240) || 'Custom furniture project',
        customerName: text(quote.companyName || quote.dealerName, 240) || null,
        fileName: text(model.fileName, 500) || null,
        embedUrl,
        models: publicModels,
      })
    } catch (error) {
      next(error)
    }
  })
}
