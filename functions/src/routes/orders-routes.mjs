// Orders endpoints — overview (DB only), refresh (the one place the manual
// trigger does live Monday + QuickBooks pulls), and job-details (DB only,
// Mongo-side prefilter on jobName).

export function registerOrdersRoutes(app, deps) {
  const {
    getCollections,
    refreshOrdersUnifiedCollection,
    requireFirebaseAuth,
    requireManagerOrAdminRole,
  } = deps
  const laborLookupsCacheTtlMs = 30 * 1000
  let cachedLaborLookups = null
  let cachedLaborLookupsExpiresAt = 0

  // ---- Helpers ----------------------------------------------------------

  function normalizeJobLookupValue(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  }

  function extractJobDigits(value) {
    const digits = String(value ?? '').replace(/\D+/g, '').trim()
    return digits || null
  }

  function buildJobLookupValues(values) {
    const normalizedValues = new Set()
    const digitValues = new Set()

    ;(Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = normalizeJobLookupValue(value)
      if (normalized) {
        normalizedValues.add(normalized)
      }
      const digits = extractJobDigits(value)
      if (digits) {
        digitValues.add(digits)
      }
    })

    return { normalizedValues, digitValues }
  }

  function doesJobNameMatchLookup(jobName, lookup) {
    const normalized = normalizeJobLookupValue(jobName)
    if (normalized && lookup.normalizedValues.has(normalized)) {
      return true
    }
    const digits = extractJobDigits(jobName)
    return digits ? lookup.digitValues.has(digits) : false
  }

  function getEntryRegularHours(entry) {
    const value = Number(entry?.hours)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  function getEntryOvertimeHours(entry) {
    const value = Number(entry?.overtimeHours)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  function getEntryRate(entry, workerDocument) {
    const snapshot = Number(entry?.payRate)
    if (Number.isFinite(snapshot) && snapshot > 0) {
      return snapshot
    }
    const fallback = Number(workerDocument?.hourlyRate)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  }

  function toMoney(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
  }

  function extractJobNumber(orderDocument) {
    const explicit = String(orderDocument?.jobNumber ?? '').trim()
    if (explicit) {
      return explicit
    }
    const matched = String(orderDocument?.orderName ?? '').trim().match(/\b\d{4,}\b/)
    if (matched?.[0]) {
      return matched[0]
    }
    return String(orderDocument?.mondayItemId ?? '').trim()
  }

  function upsertLaborTotals(targetMap, key, totals) {
    if (!key) {
      return
    }
    const existing = targetMap.get(key) ?? { totalHours: 0, totalLaborCost: 0 }
    existing.totalHours += Number(totals?.totalHours ?? 0)
    existing.totalLaborCost = toMoney(existing.totalLaborCost + Number(totals?.totalLaborCost ?? 0))
    targetMap.set(key, existing)
  }

  function resolveBestLaborTotals(candidates, byNormalizedJob, byDigits) {
    const normalizedValues = candidates?.normalizedValues instanceof Set
      ? [...candidates.normalizedValues]
      : []
    const digitValues = candidates?.digitValues instanceof Set
      ? [...candidates.digitValues]
      : []

    const normalizedMatches = normalizedValues
      .map((value) => byNormalizedJob.get(value))
      .filter(Boolean)
    if (normalizedMatches.length > 0) {
      return normalizedMatches.reduce((best, next) => {
        if (!best) {
          return next
        }
        return Number(next.totalHours) > Number(best.totalHours) ? next : best
      }, null)
    }

    const digitMatches = digitValues
      .map((value) => byDigits.get(value))
      .filter(Boolean)

    if (digitMatches.length > 0) {
      return digitMatches.reduce((best, next) => {
        if (!best) {
          return next
        }
        return Number(next.totalHours) > Number(best.totalHours) ? next : best
      }, null)
    }

    return null
  }

  async function buildLaborTotalsLookups(entriesCollection, workersCollection) {
    const [entryDocuments, workerDocuments] = await Promise.all([
      entriesCollection.find(
        {},
        {
          projection: {
            _id: 0,
            workerId: 1,
            jobName: 1,
            hours: 1,
            overtimeHours: 1,
            payRate: 1,
          },
        },
      ).toArray(),
      workersCollection.find({}, { projection: { _id: 0, id: 1, hourlyRate: 1 } }).toArray(),
    ])

    const workersById = new Map(workerDocuments.map((worker) => [String(worker?.id ?? '').trim(), worker]))
    const byNormalizedJob = new Map()
    const byDigits = new Map()

    for (const entry of entryDocuments) {
      const jobName = String(entry?.jobName ?? '').trim()
      const normalizedJobName = normalizeJobLookupValue(jobName)
      if (!normalizedJobName) {
        continue
      }

      const regularHours = getEntryRegularHours(entry)
      const overtimeHours = getEntryOvertimeHours(entry)
      const totalHours = regularHours + overtimeHours
      const worker = workersById.get(String(entry?.workerId ?? '').trim()) ?? null
      const rate = getEntryRate(entry, worker)
      const totalLaborCost = toMoney(regularHours * rate + overtimeHours * rate * 1.5)
      const totals = { totalHours, totalLaborCost }

      upsertLaborTotals(byNormalizedJob, normalizedJobName, totals)

      const digits = extractJobDigits(jobName)
      if (digits) {
        upsertLaborTotals(byDigits, digits, totals)
      }
    }

    return { byDigits, byNormalizedJob }
  }

  async function getLaborTotalsLookups(entriesCollection, workersCollection) {
    const now = Date.now()

    if (cachedLaborLookups && now < cachedLaborLookupsExpiresAt) {
      return cachedLaborLookups
    }

    const freshLookups = await buildLaborTotalsLookups(entriesCollection, workersCollection)
    cachedLaborLookups = freshLookups
    cachedLaborLookupsExpiresAt = now + laborLookupsCacheTtlMs

    return freshLookups
  }

  function mapUnifiedOrderDocumentToOverviewRow(orderDocument, laborLookups) {
    const hasMondayRecord = Boolean(orderDocument?.has_monday_record)
    const hasQuickBooksRecord = Boolean(orderDocument?.has_quickbooks_record)
    const orderNumber = String(orderDocument?.order_number ?? '').trim()
    const mondayItemId = String(orderDocument?.monday_item_id ?? '').trim()
    const quickBooksProjectId = String(orderDocument?.qb_project_id ?? '').trim()
    const quickBooksProjectName = String(orderDocument?.qb_project_name ?? '').trim()
    const quickBooksProjectIds = [
      ...new Set(
        [
          quickBooksProjectId,
          ...(Array.isArray(orderDocument?.qb_project_ids)
            ? orderDocument.qb_project_ids.map((value) => String(value ?? '').trim())
            : []),
        ].filter(Boolean),
      ),
    ]
    const quickBooksProjectNames = [
      ...new Set(
        [
          quickBooksProjectName,
          ...(Array.isArray(orderDocument?.qb_project_names)
            ? orderDocument.qb_project_names.map((value) => String(value ?? '').trim())
            : []),
        ].filter(Boolean),
      ),
    ]
    const primaryQuickBooksProjectId = quickBooksProjectIds[0] || ''
    const primaryQuickBooksProjectName = quickBooksProjectNames[0] || ''
    const resolvedOrderNumber = orderNumber || mondayItemId || primaryQuickBooksProjectId
    const statusHistory = (Array.isArray(orderDocument?.status) ? orderDocument.status : [])
      .map((entry) => ({
        id: String(entry?.id ?? '').trim() || null,
        date: String(entry?.date ?? '').trim() || null,
        jobName: String(entry?.jobName ?? '').trim() || null,
        readyPercent: Number.isFinite(Number(entry?.readyPercent)) ? Number(entry.readyPercent) : null,
        updatedAt: String(entry?.updatedAt ?? '').trim() || null,
      }))

    const sourceValue = String(orderDocument?.source ?? '').trim().toLowerCase()
    const source =
      sourceValue === 'quickbooks' || sourceValue === 'monday' || sourceValue === 'merged'
        ? sourceValue
        : hasMondayRecord
          ? 'monday'
          : 'quickbooks'

    const isShipped = Boolean(orderDocument?.is_shipped)
    const mondayStatus = String(orderDocument?.Monday_status ?? '').trim() || null
    const inDesign = Boolean(orderDocument?.in_design)
    const hazardReason = String(orderDocument?.hazard_reason ?? '').trim()
      || (!hasMondayRecord && !inDesign
        ? 'Not found in Monday Order Track.'
        : !hasQuickBooksRecord
          ? 'Not found in QuickBooks projects.'
          : null)
    const amountOwed = Number.isFinite(Number(orderDocument?.amountOwed))
      ? Number(orderDocument.amountOwed)
      : null
    const billBalanceAmount =
      orderDocument?.billBalanceAmount !== null
      && orderDocument?.billBalanceAmount !== undefined
      && Number.isFinite(Number(orderDocument?.billBalanceAmount))
      ? Number(orderDocument.billBalanceAmount)
      : null
    const paidInFull =
      typeof orderDocument?.paidInFull === 'boolean'
        ? Boolean(orderDocument.paidInFull)
        : Number.isFinite(amountOwed)
          ? amountOwed <= 0.004
          : null
    const rowStatus = !hasMondayRecord && !inDesign
      ? 'Not in Monday'
      : isShipped
        ? 'Shipped'
        : inDesign
          ? 'In Design'
          : mondayStatus || 'Open'
    const laborCandidates = buildJobLookupValues([
      resolvedOrderNumber,
      String(orderDocument?.order_name ?? '').trim(),
      mondayItemId,
      ...quickBooksProjectIds,
      ...quickBooksProjectNames,
    ])
    const laborTotals = laborLookups
      ? resolveBestLaborTotals(
        laborCandidates,
        laborLookups.byNormalizedJob,
        laborLookups.byDigits,
      )
      : null

    return {
      id: String(orderDocument?.orderKey ?? resolvedOrderNumber).trim() || resolvedOrderNumber,
      mondayItemId,
      orderNumber: resolvedOrderNumber,
      jobNumber: resolvedOrderNumber,
      orderName: String(orderDocument?.order_name ?? '').trim() || null,
      poAmount: Number.isFinite(Number(orderDocument?.poAmount)) ? Number(orderDocument.poAmount) : null,
      billedAmount: Number.isFinite(Number(orderDocument?.billedAmount))
        ? Number(orderDocument.billedAmount)
        : Number.isFinite(Number(orderDocument?.billAmount))
          ? Number(orderDocument.billAmount)
          : null,
      invoiceAmount: Number.isFinite(Number(orderDocument?.invoiceAmount)) ? Number(orderDocument.invoiceAmount) : null,
      invoiceNumber: String(orderDocument?.invoiceNumber ?? '').trim() || null,
      paidInFull,
      amountOwed,
      billBalanceAmount,
      totalAmountOwed: amountOwed,
      totalHours: laborTotals ? Number(Number(laborTotals.totalHours).toFixed(2)) : null,
      totalLaborCost: laborTotals ? toMoney(laborTotals.totalLaborCost) : null,
      orderDate: String(orderDocument?.order_date ?? '').trim() || null,
      mondayStatus,
      rowStatus,
      managerReadyPercent: Number.isFinite(Number(orderDocument?.manager_ready_percent))
        ? Number(orderDocument.manager_ready_percent)
        : null,
      managerReadyDate: String(orderDocument?.manager_ready_date ?? '').trim() || null,
      managerReadyUpdatedAt: String(orderDocument?.manager_ready_updated_at ?? '').trim() || null,
      progressPercent: Number.isFinite(Number(orderDocument?.progress_percent))
        ? Number(orderDocument.progress_percent)
        : null,
      leadTimeDays: Number.isFinite(Number(orderDocument?.Lead_time_days))
        ? Number(orderDocument.Lead_time_days)
        : null,
      statusHistory,
      isShipped,
      shippedAt: String(orderDocument?.shipped_at ?? '').trim() || null,
      mondayBoardId: String(orderDocument?.monday_board_id ?? '').trim() || null,
      mondayBoardName: String(orderDocument?.monday_board_name ?? '').trim() || null,
      mondayUpdatedAt: String(orderDocument?.monday_updated_at ?? '').trim() || null,
      mondayItemUrl: String(orderDocument?.Monday_url ?? '').trim() || null,
      dueDate: String(orderDocument?.Due_date ?? '').trim() || null,
      shopDrawingCachedUrl: String(orderDocument?.Shop_drawing_cached ?? '').trim() || null,
      shopDrawingUrl:
        String(orderDocument?.Shop_drawing_source ?? '').trim()
        || String(orderDocument?.Shop_drawing ?? '').trim()
        || null,
      source,
      hasMondayRecord,
      hasQuickBooksRecord,
      inDesign,
      quickBooksProjectId: primaryQuickBooksProjectId || null,
      quickBooksProjectName: primaryQuickBooksProjectName || null,
      quickBooksProjectIds,
      quickBooksProjectNames,
      hazardReason,
    }
  }

  // ---- Routes -----------------------------------------------------------

  // GET /api/orders/overview — pure DB read. Never triggers Monday/QB.
  app.get('/api/orders/overview', requireFirebaseAuth, requireManagerOrAdminRole, async (_req, res, next) => {
    try {
      const {
        dashboardSnapshotsCollection,
        entriesCollection,
        ordersUnifiedCollection,
        workersCollection,
      } = await getCollections()

      const unifiedOrderDocuments = await ordersUnifiedCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              monday_item_id: 1,
              Monday_url: 1,
              Monday_status: 1,
              order_name: 1,
              is_shipped: 1,
              status: 1,
              Due_date: 1,
              Lead_time_days: 1,
              progress_percent: 1,
              order_date: 1,
              Shop_drawing: 1,
              Shop_drawing_cached: 1,
              Shop_drawing_source: 1,
              amountOwed: 1,
              billBalanceAmount: 1,
              billAmount: 1,
              billedAmount: 1,
              invoiceNumber: 1,
              invoiceAmount: 1,
              paymentAmount: 1,
              paidInFull: 1,
              poAmount: 1,
              shipped_at: 1,
              has_monday_record: 1,
              has_quickbooks_record: 1,
              in_design: 1,
              hazard_reason: 1,
              source: 1,
              qb_project_id: 1,
              qb_project_name: 1,
              qb_project_ids: 1,
              qb_project_names: 1,
              monday_board_id: 1,
              monday_board_name: 1,
              monday_updated_at: 1,
              manager_ready_percent: 1,
              manager_ready_date: 1,
              manager_ready_updated_at: 1,
              quickbooks_synced_at: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ is_shipped: 1, Due_date: 1, order_number: 1, updatedAt: -1 })
        .toArray()

      const lastRefreshDoc = await dashboardSnapshotsCollection.findOne(
        { snapshotKey: 'orders_unified_refresh' },
        { projection: { _id: 0, snapshot: 1, updatedAt: 1 } },
      )
      const lastRefresh = lastRefreshDoc?.snapshot ?? null
      const quickBooksSyncedAtFromRows = unifiedOrderDocuments.find((doc) =>
        String(doc?.quickbooks_synced_at ?? '').trim()
      )?.quickbooks_synced_at
      const laborLookups = await getLaborTotalsLookups(entriesCollection, workersCollection)

      const rows = unifiedOrderDocuments.map((doc) => mapUnifiedOrderDocumentToOverviewRow(doc, laborLookups))
      const shippedCount = rows.filter((row) => row.isShipped).length
      const hazardCount = rows.filter((row) => Boolean(row.hazardReason)).length
      const mondayOnlyCount = rows.filter((row) => row.hasMondayRecord && !row.hasQuickBooksRecord).length
      const quickBooksOnlyCount = rows.filter((row) => !row.hasMondayRecord && row.hasQuickBooksRecord).length

      return res.json({
        generatedAt: new Date().toISOString(),
        lastRefreshedAt:
          String(lastRefresh?.refreshedAt ?? lastRefreshDoc?.updatedAt ?? '').trim() || null,
        lastRefreshWarnings: Array.isArray(lastRefresh?.warnings) ? lastRefresh.warnings : [],
        quickBooksSyncedAt:
          String(lastRefresh?.quickBooksSyncedAt ?? '').trim()
          || String(quickBooksSyncedAtFromRows ?? '').trim()
          || null,
        counts: {
          total: rows.length,
          shipped: shippedCount,
          nonShipped: rows.length - shippedCount,
          hazard: hazardCount,
          mondayOnly: mondayOnlyCount,
          quickBooksOnly: quickBooksOnlyCount,
        },
        orders: rows,
      })
    } catch (error) {
      next(error)
    }
  })

  // POST /api/orders/refresh — the one place users explicitly trigger live
  // Monday + QuickBooks pulls. Rate-limited at the app level (1 / 2 min).
  app.post(
    '/api/orders/refresh',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (_req, res, next) => {
      try {
        const summary = await refreshOrdersUnifiedCollection()
        const { dashboardSnapshotsCollection } = await getCollections()
        await dashboardSnapshotsCollection.updateOne(
          { snapshotKey: 'orders_unified_refresh' },
          {
            $set: {
              snapshotKey: 'orders_unified_refresh',
              snapshot: summary,
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        )
        return res.json({ ok: true, summary })
      } catch (error) {
        next(error)
      }
    },
  )

  // GET /api/orders/job-details — DB only. Mongo-side prefilter on jobName
  // (digit-token + normalized regex) keeps this off the full-collection scan.
  app.get(
    '/api/orders/job-details',
    requireFirebaseAuth,
    requireManagerOrAdminRole,
    async (req, res, next) => {
      try {
        const mondayItemId = String(req.query?.mondayItemId ?? '').trim()
        const jobNumber = String(req.query?.jobNumber ?? '').trim()
        const orderName = String(req.query?.orderName ?? '').trim()

        if (!mondayItemId && !jobNumber && !orderName) {
          return res.status(400).json({
            error: 'At least one of mondayItemId, jobNumber, or orderName is required.',
          })
        }

        const {
          mondayOrdersCollection,
          entriesCollection,
          workersCollection,
          stagesCollection,
          orderProgressCollection,
        } = await getCollections()

        const orderDocument = mondayItemId
          ? await mondayOrdersCollection.findOne(
            { mondayItemId },
            {
              projection: {
                _id: 0,
                mondayItemId: 1,
                orderName: 1,
                jobNumber: 1,
                statusLabel: 1,
                movedToShippedAt: 1,
                shippedAt: 1,
                mondayItemUrl: 1,
                mondayBoardName: 1,
                mondayBoardId: 1,
                mondayUpdatedAt: 1,
              },
            },
          )
          : null

        const resolvedJobNumber =
          jobNumber || extractJobNumber(orderDocument) || String(mondayItemId ?? '').trim()

        const lookup = buildJobLookupValues([
          resolvedJobNumber,
          orderName,
          mondayItemId,
          String(orderDocument?.jobNumber ?? '').trim(),
          String(orderDocument?.orderName ?? '').trim(),
        ])

        if (lookup.normalizedValues.size === 0 && lookup.digitValues.size === 0) {
          return res.status(400).json({
            error: 'Could not build a valid job lookup from the provided values.',
          })
        }

        const escapeRegex = (value) =>
          String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const jobNameOrFilters = []

        for (const digitValue of lookup.digitValues) {
          const escaped = escapeRegex(digitValue)
          if (escaped) {
            jobNameOrFilters.push({ jobName: { $regex: escaped } })
          }
        }
        for (const normalizedValue of lookup.normalizedValues) {
          const escaped = escapeRegex(normalizedValue)
          if (escaped) {
            jobNameOrFilters.push({ jobName: { $regex: escaped, $options: 'i' } })
          }
        }
        const jobNameFilter = jobNameOrFilters.length > 0 ? { $or: jobNameOrFilters } : {}

        const [entries, workers, stages, orderProgressDocuments] = await Promise.all([
          entriesCollection
            .find(jobNameFilter, {
              projection: {
                _id: 0,
                id: 1,
                workerId: 1,
                stageId: 1,
                date: 1,
                jobName: 1,
                hours: 1,
                overtimeHours: 1,
                payRate: 1,
                notes: 1,
                createdAt: 1,
              },
            })
            .sort({ date: -1, createdAt: -1 })
            .toArray(),
          workersCollection
            .find({}, { projection: { _id: 0, id: 1, fullName: 1, hourlyRate: 1 } })
            .toArray(),
          stagesCollection.find({}, { projection: { _id: 0, id: 1, name: 1 } }).toArray(),
          orderProgressCollection
            .find(jobNameFilter, {
              projection: { _id: 0, id: 1, date: 1, jobName: 1, readyPercent: 1, updatedAt: 1 },
            })
            .sort({ date: -1, updatedAt: -1 })
            .toArray(),
        ])

        const workersById = new Map(workers.map((w) => [String(w.id ?? '').trim(), w]))
        const stagesById = new Map(stages.map((s) => [String(s.id ?? '').trim(), s]))

        const matchedEntries = entries
          .filter((entry) => doesJobNameMatchLookup(entry?.jobName, lookup))
          .map((entry) => {
            const workerDocument = workersById.get(String(entry?.workerId ?? '').trim()) ?? null
            const stageDocument = stagesById.get(String(entry?.stageId ?? '').trim()) ?? null
            const regularHours = getEntryRegularHours(entry)
            const overtimeHours = getEntryOvertimeHours(entry)
            const totalHours = regularHours + overtimeHours
            const rate = getEntryRate(entry, workerDocument)
            const laborCost = toMoney(regularHours * rate + overtimeHours * rate * 1.5)
            return {
              ...entry,
              workerName: String(workerDocument?.fullName ?? '').trim() || 'Unknown worker',
              stageName: String(stageDocument?.name ?? '').trim() || null,
              regularHours,
              overtimeHours,
              totalHours,
              rate,
              laborCost,
            }
          })

        const workerTotalsById = new Map()
        let totalRegularHours = 0
        let totalOvertimeHours = 0
        let totalHours = 0
        let totalLaborCost = 0

        matchedEntries.forEach((entry) => {
          const workerId = String(entry.workerId ?? '').trim()
          const existing = workerTotalsById.get(workerId) ?? {
            workerId,
            workerName: entry.workerName,
            totalRegularHours: 0,
            totalOvertimeHours: 0,
            totalHours: 0,
            totalLaborCost: 0,
          }
          existing.totalRegularHours += entry.regularHours
          existing.totalOvertimeHours += entry.overtimeHours
          existing.totalHours += entry.totalHours
          existing.totalLaborCost = toMoney(existing.totalLaborCost + entry.laborCost)
          workerTotalsById.set(workerId, existing)

          totalRegularHours += entry.regularHours
          totalOvertimeHours += entry.overtimeHours
          totalHours += entry.totalHours
          totalLaborCost = toMoney(totalLaborCost + entry.laborCost)
        })

        const managerHistory = orderProgressDocuments
          .filter((progress) => doesJobNameMatchLookup(progress?.jobName, lookup))
          .map((progress) => ({
            id: String(progress?.id ?? '').trim() || null,
            date: String(progress?.date ?? '').trim() || null,
            jobName: String(progress?.jobName ?? '').trim() || null,
            readyPercent: Number.isFinite(Number(progress?.readyPercent))
              ? Number(progress.readyPercent)
              : null,
            updatedAt: String(progress?.updatedAt ?? '').trim() || null,
          }))

        const latestManagerStatus = managerHistory[0] ?? null

        return res.json({
          generatedAt: new Date().toISOString(),
          job: {
            mondayItemId: String(orderDocument?.mondayItemId ?? mondayItemId).trim() || null,
            jobNumber: resolvedJobNumber || null,
            orderName: String(orderDocument?.orderName ?? orderName).trim() || null,
            mondayStatusLabel: String(orderDocument?.statusLabel ?? '').trim() || null,
            mondayItemUrl: String(orderDocument?.mondayItemUrl ?? '').trim() || null,
            mondayBoardId: String(orderDocument?.mondayBoardId ?? '').trim() || null,
            mondayBoardName: String(orderDocument?.mondayBoardName ?? '').trim() || null,
            mondayUpdatedAt: String(orderDocument?.mondayUpdatedAt ?? '').trim() || null,
            latestManagerReadyPercent: latestManagerStatus?.readyPercent ?? null,
            latestManagerReadyDate: latestManagerStatus?.date ?? null,
            latestManagerReadyUpdatedAt: latestManagerStatus?.updatedAt ?? null,
          },
          summary: {
            entryCount: matchedEntries.length,
            workerCount: workerTotalsById.size,
            totalRegularHours,
            totalOvertimeHours,
            totalHours,
            totalLaborCost,
          },
          workers: [...workerTotalsById.values()].sort(
            (left, right) =>
              right.totalHours - left.totalHours
              || left.workerName.localeCompare(right.workerName),
          ),
          entries: matchedEntries,
          managerHistory,
        })
      } catch (error) {
        next(error)
      }
    },
  )
}
