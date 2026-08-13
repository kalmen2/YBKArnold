const MAX_RECORDING_BYTES = 6 * 1024 * 1024
const MAX_DIAGNOSTICS_JSON_BYTES = 1024 * 1024
const REPORT_STATUSES = new Set(['open', 'investigating', 'resolved'])
const ALLOWED_RECORDING_TYPES = new Set(['video/webm', 'video/mp4', 'application/octet-stream'])
const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|session/i

function normalizeText(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit)
}

function serverRedact(value, depth = 0) {
  if (depth > 8) return '[Maximum depth reached]'
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 12000)
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => serverRedact(item, depth + 1))
  if (typeof value === 'object') {
    const result = {}
    Object.entries(value).slice(0, 500).forEach(([key, item]) => {
      const normalizedKey = normalizeText(key, 300)
      result[normalizedKey] = SENSITIVE_KEY_PATTERN.test(normalizedKey)
        ? '[REDACTED]'
        : serverRedact(item, depth + 1)
    })
    return result
  }
  return normalizeText(value, 12000)
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function sanitizeStorageSegment(value, fallback = 'unknown') {
  return normalizeText(value, 200).replace(/[^a-zA-Z0-9_.-]/g, '_') || fallback
}

function serializeReport(document, includeDiagnostics = false) {
  const diagnostics = document?.diagnostics && typeof document.diagnostics === 'object'
    ? document.diagnostics
    : {}
  const recording = document?.recording && typeof document.recording === 'object'
    ? {
        fileName: normalizeText(document.recording.fileName, 300) || null,
        contentType: normalizeText(document.recording.contentType, 200) || null,
        size: Number(document.recording.size) || 0,
      }
    : null
  const result = {
    id: normalizeText(document?.id, 120),
    reference: normalizeText(document?.reference, 100),
    summary: normalizeText(document?.summary, 240),
    details: normalizeText(document?.details, 4000),
    status: REPORT_STATUSES.has(document?.status) ? document.status : 'open',
    context: document?.context && typeof document.context === 'object' ? document.context : {},
    createdBy: document?.createdBy && typeof document.createdBy === 'object' ? document.createdBy : {},
    createdAt: normalizeText(document?.createdAt, 80) || null,
    updatedAt: normalizeText(document?.updatedAt, 80) || null,
    resolutionExplanation: normalizeText(document?.resolutionExplanation, 4000),
    resolvedAt: normalizeText(document?.resolvedAt, 80) || null,
    resolvedBy: document?.resolvedBy && typeof document.resolvedBy === 'object' ? document.resolvedBy : null,
    recording,
    consoleCount: Number(document?.consoleCount) || (Array.isArray(diagnostics.console) ? diagnostics.console.length : 0),
    networkCount: Number(document?.networkCount) || (Array.isArray(diagnostics.network) ? diagnostics.network.length : 0),
    interactionCount: Number(document?.interactionCount) || (Array.isArray(diagnostics.interactions) ? diagnostics.interactions.length : 0),
    durationMs: Number(document?.durationMs) || Number(diagnostics.durationMs) || 0,
  }
  if (includeDiagnostics) result.diagnostics = diagnostics
  return result
}

export function registerDiagnosticReportsRoutes(app, deps) {
  const {
    getCollections,
    getOrderPhotosBucket,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
    toPublicAuthUser,
  } = deps

  app.post('/api/diagnostic-reports', requireFirebaseAuth, async (req, res, next) => {
    try {
      const summary = normalizeText(req.body?.summary, 240)
      if (!summary) return res.status(400).json({ error: 'Summary is required.' })

      const publicUser = toPublicAuthUser(req.authUser)
      if (!publicUser?.isApproved) return res.status(403).json({ error: 'Approved access is required.' })

      const context = serverRedact(req.body?.context && typeof req.body.context === 'object' ? req.body.context : {})
      const diagnosticsInput = req.body?.diagnostics && typeof req.body.diagnostics === 'object'
        ? req.body.diagnostics
        : {}
      if (jsonByteLength(diagnosticsInput) > MAX_DIAGNOSTICS_JSON_BYTES) {
        return res.status(413).json({ error: 'Diagnostic details are too large.' })
      }
      const diagnostics = serverRedact(diagnosticsInput)
      const sessionId = normalizeText(diagnosticsInput?.id, 100)
      const { diagnosticReportsCollection, diagnosticRequestEventsCollection } = await getCollections()

      if (sessionId) {
        diagnostics.serverEvents = await diagnosticRequestEventsCollection
          .find({ sessionId, userUid: normalizeText(publicUser.uid, 200) }, { projection: { _id: 0, sessionId: 0, userUid: 0 } })
          .sort({ createdAt: 1 })
          .limit(500)
          .toArray()
      }

      const now = new Date().toISOString()
      const reportId = randomUUID()
      const reference = `ISSUE-${now.slice(2, 10).replace(/-/g, '')}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
      let recording = null
      const recordingInput = req.body?.recording
      if (recordingInput && typeof recordingInput === 'object') {
        const contentType = normalizeText(recordingInput.contentType, 200).toLowerCase() || 'application/octet-stream'
        if (!ALLOWED_RECORDING_TYPES.has(contentType) && !contentType.startsWith('video/webm')) {
          return res.status(400).json({ error: 'Recording must be WEBM or MP4 video.' })
        }
        const encoded = String(recordingInput.dataBase64 ?? '').replace(/\s+/g, '')
        if (!encoded || !/^[a-zA-Z0-9+/=]+$/.test(encoded)) {
          return res.status(400).json({ error: 'Recording data is invalid.' })
        }
        const content = Buffer.from(encoded, 'base64')
        if (!content.length) return res.status(400).json({ error: 'Recording is empty.' })
        if (content.length > MAX_RECORDING_BYTES) return res.status(413).json({ error: 'Recording exceeds the 6 MB limit.' })

        const extension = contentType.includes('mp4') ? 'mp4' : 'webm'
        const storagePath = `diagnostic-reports/${now.slice(0, 10).replace(/-/g, '/')}/${reference}/${sanitizeStorageSegment(publicUser.uid || publicUser.email)}-${randomUUID().slice(0, 10)}.${extension}`
        const bucket = getOrderPhotosBucket()
        await bucket.file(storagePath).save(content, {
          resumable: false,
          metadata: {
            contentType,
            metadata: { diagnosticReport: reference, uploadedByUid: normalizeText(publicUser.uid, 200) },
          },
        })
        recording = {
          storagePath,
          fileName: normalizeText(recordingInput.fileName, 300) || `${reference}.${extension}`,
          contentType,
          size: content.length,
        }
      }

      const document = {
        id: reportId,
        reference,
        summary,
        details: normalizeText(req.body?.details, 4000),
        status: 'open',
        context,
        diagnostics,
        consoleCount: Array.isArray(diagnostics.console) ? diagnostics.console.length : 0,
        networkCount: Array.isArray(diagnostics.network) ? diagnostics.network.length : 0,
        interactionCount: Array.isArray(diagnostics.interactions) ? diagnostics.interactions.length : 0,
        durationMs: Number(diagnostics.durationMs) || 0,
        recording,
        createdBy: {
          uid: normalizeText(publicUser.uid, 200) || null,
          email: normalizeText(publicUser.email, 320).toLowerCase() || null,
          name: normalizeText(publicUser.displayName || publicUser.email, 320) || null,
        },
        createdAt: now,
        updatedAt: now,
      }
      await diagnosticReportsCollection.insertOne(document)
      return res.status(201).json({ ok: true, id: reportId, reference })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/diagnostic-reports', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const status = normalizeText(req.query?.status, 30).toLowerCase()
      if (status && !REPORT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid report status.' })
      const limit = Math.max(1, Math.min(Number(req.query?.limit) || 100, 250))
      const { diagnosticReportsCollection } = await getCollections()
      const documents = await diagnosticReportsCollection.aggregate([
        { $match: status ? { status } : {} },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $set: {
            consoleCount: { $ifNull: ['$consoleCount', { $size: { $ifNull: ['$diagnostics.console', []] } }] },
            networkCount: { $ifNull: ['$networkCount', { $size: { $ifNull: ['$diagnostics.network', []] } }] },
            interactionCount: { $ifNull: ['$interactionCount', { $size: { $ifNull: ['$diagnostics.interactions', []] } }] },
            durationMs: { $ifNull: ['$durationMs', { $ifNull: ['$diagnostics.durationMs', 0] }] },
          },
        },
        { $project: { diagnostics: 0 } },
      ]).toArray()
      return res.json({ reports: documents.map((document) => serializeReport(document)) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/diagnostic-reports/my', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      if (!publicUser?.isApproved) return res.status(403).json({ error: 'Approved access is required.' })

      const uid = normalizeText(publicUser.uid, 200)
      if (!uid) return res.status(400).json({ error: 'Your user account could not be identified.' })
      const limit = Math.max(1, Math.min(Number(req.query?.limit) || 100, 200))
      const { diagnosticReportsCollection } = await getCollections()
      const documents = await diagnosticReportsCollection
        .find({ 'createdBy.uid': uid }, { projection: { diagnostics: 0, 'recording.storagePath': 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
      return res.json({ reports: documents.map((document) => serializeReport(document)) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/diagnostic-reports/:reportId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const { diagnosticReportsCollection } = await getCollections()
      const document = await diagnosticReportsCollection.findOne({ id: normalizeText(req.params.reportId, 120) })
      if (!document) return res.status(404).json({ error: 'Issue report not found.' })
      return res.json({ report: serializeReport(document, true) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/diagnostic-reports/:reportId/recording', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const { diagnosticReportsCollection } = await getCollections()
      const document = await diagnosticReportsCollection.findOne(
        { id: normalizeText(req.params.reportId, 120) },
        { projection: { recording: 1 } },
      )
      if (!document) return res.status(404).json({ error: 'Issue report not found.' })
      const storagePath = normalizeText(document?.recording?.storagePath, 2000)
      if (!storagePath) return res.status(404).json({ error: 'This report has no screen recording.' })
      const [content] = await getOrderPhotosBucket().file(storagePath).download()
      res.setHeader('Content-Type', normalizeText(document.recording.contentType, 200) || 'video/webm')
      res.setHeader('Content-Disposition', `inline; filename="${normalizeText(document.recording.fileName, 300).replace(/"/g, '') || 'issue-recording.webm'}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).send(content)
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/admin/diagnostic-reports/:reportId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const status = normalizeText(req.body?.status, 30).toLowerCase()
      if (!REPORT_STATUSES.has(status)) return res.status(400).json({ error: 'Status must be open, investigating, or resolved.' })
      const resolutionExplanation = normalizeText(req.body?.resolutionExplanation, 4000)
      const { diagnosticReportsCollection, mobileAlertsCollection } = await getCollections()
      const reportId = normalizeText(req.params.reportId, 120)
      const existing = await diagnosticReportsCollection.findOne({ id: reportId })
      if (!existing) return res.status(404).json({ error: 'Issue report not found.' })
      const now = new Date().toISOString()
      const updatedBy = { uid: normalizeText(req.authUser?.uid, 200), email: normalizeText(req.authUser?.email, 320) }
      const statusFields = status === 'resolved'
        ? {
            resolutionExplanation,
            resolvedAt: existing.status === 'resolved' && existing.resolvedAt ? existing.resolvedAt : now,
            resolvedBy: existing.status === 'resolved' && existing.resolvedBy ? existing.resolvedBy : updatedBy,
          }
        : { resolutionExplanation: '', resolvedAt: null, resolvedBy: null }
      const updateResult = await diagnosticReportsCollection.findOneAndUpdate(
        { id: reportId },
        { $set: { status, updatedAt: now, updatedBy, ...statusFields } },
        { returnDocument: 'after', projection: { diagnostics: 0 } },
      )

      const recipientUid = normalizeText(existing?.createdBy?.uid, 200)
      if (status === 'resolved' && existing.status !== 'resolved' && recipientUid) {
        const reference = normalizeText(existing.reference, 100) || 'Your issue report'
        await mobileAlertsCollection.insertOne({
          id: randomUUID(),
          title: `Issue solved: ${reference}`,
          message: resolutionExplanation
            ? `Your issue report was marked solved. ${resolutionExplanation}`
            : 'Your issue report was marked solved.',
          isUpdate: true,
          targetMode: 'selected',
          targetUserUids: [recipientUid],
          createdByUid: updatedBy.uid || null,
          createdByEmail: updatedBy.email || null,
          delivery: { targetUserCount: 1, pushTokenCount: 0, pushAcceptedCount: 0, pushErrorCount: 0, errorSamples: [] },
          metadata: { source: 'diagnostic_report_resolved', diagnosticReportId: reportId, reference },
          createdAt: now,
          updatedAt: now,
        })
      }
      return res.json({ ok: true, report: serializeReport(updateResult) })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/admin/diagnostic-reports/:reportId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const reportId = normalizeText(req.params.reportId, 120)
      const { diagnosticReportsCollection, diagnosticRequestEventsCollection } = await getCollections()
      const document = await diagnosticReportsCollection.findOne({ id: reportId })
      if (!document) return res.status(404).json({ error: 'Issue report not found.' })
      const storagePath = normalizeText(document?.recording?.storagePath, 2000)
      if (storagePath) await getOrderPhotosBucket().file(storagePath).delete({ ignoreNotFound: true })
      await diagnosticReportsCollection.deleteOne({ id: reportId })
      const sessionId = normalizeText(document?.diagnostics?.id, 100)
      if (sessionId) await diagnosticRequestEventsCollection.deleteMany({ sessionId })
      return res.json({ ok: true, deletedId: reportId, reference: normalizeText(document.reference, 100) })
    } catch (error) {
      next(error)
    }
  })
}
