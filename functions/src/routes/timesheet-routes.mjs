export function registerTimesheetRoutes(app, deps) {
  const {
    allocateWorkerNumbers,
    ensureEntriesHavePayRates,
    ensureWorkersHaveWorkerNumbers,
    getCollections,
    normalizeJobName,
    normalizeStageName,
    randomUUID,
    requireApprovedLinkedWorker,
    requireFirebaseAuth,
    validateEntryFields,
    validateEntryInput,
    validateWorkerInput,
  } = deps


app.get('/api/timesheet/state', async (_req, res, next) => {
  try {
    const {
      workersCollection,
      entriesCollection,
      stagesCollection,
      orderProgressCollection,
      missingWorkerReviewsCollection,
    } = await getCollections()

    const [workers, entries, stages, orderProgress, missingWorkerReviews] = await Promise.all([
      workersCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ fullName: 1 })
        .toArray(),
      entriesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedName: 0,
            },
          },
        )
        .sort({ sortOrder: 1, name: 1 })
        .toArray(),
      orderProgressCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedJobName: 0,
            },
          },
        )
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
      missingWorkerReviewsCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, updatedAt: -1 })
        .toArray(),
    ])

    const workersWithNumbers = await ensureWorkersHaveWorkerNumbers(workersCollection, workers)
    const entriesWithPayRates = await ensureEntriesHavePayRates(
      entriesCollection,
      workersCollection,
      entries,
    )

    res.json({
      workers: workersWithNumbers,
      entries: entriesWithPayRates,
      stages,
      orderProgress,
      missingWorkerReviews,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/timesheet/missing-worker-reviews', async (req, res, next) => {
  try {
    const { workersCollection, missingWorkerReviewsCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const workerId = String(req.body?.workerId ?? '').trim()
    const note = String(req.body?.note ?? '').trim()
    const approved = req.body?.approved === true

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    if (note.length > 2000) {
      return res.status(400).json({ error: 'note is too long.' })
    }

    const workerExists = await workersCollection.countDocuments({ id: workerId })

    if (workerExists === 0) {
      return res.status(400).json({ error: 'workerId is invalid.' })
    }

    const now = new Date().toISOString()
    const updateOperation = approved
      ? {
          $set: {
            date,
            workerId,
            note,
            approved: true,
            approvedAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        }
      : {
          $set: {
            date,
            workerId,
            note,
            approved: false,
            updatedAt: now,
          },
          $unset: {
            approvedAt: '',
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        }

    await missingWorkerReviewsCollection.updateOne(
      {
        date,
        workerId,
      },
      updateOperation,
      {
        upsert: true,
      },
    )

    const review = await missingWorkerReviewsCollection.findOne(
      {
        date,
        workerId,
      },
      {
        projection: {
          _id: 0,
        },
      },
    )

    return res.json({ review })
  } catch (error) {
    next(error)
  }
})

app.put('/api/timesheet/order-progress', async (req, res, next) => {
  try {
    const { orderProgressCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const jobName = String(req.body?.jobName ?? '').trim()
    const readyPercent = Number(req.body?.readyPercent)

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-mm-dd.' })
    }

    if (!jobName) {
      return res.status(400).json({ error: 'jobName is required.' })
    }

    if (!Number.isFinite(readyPercent) || readyPercent < 0 || readyPercent > 100) {
      return res.status(400).json({ error: 'readyPercent must be between 0 and 100.' })
    }

    const normalizedJobName = normalizeJobName(jobName)
    const roundedReadyPercent = Number(readyPercent.toFixed(2))
    const now = new Date().toISOString()

    await orderProgressCollection.updateOne(
      {
        date,
        normalizedJobName,
      },
      {
        $set: {
          date,
          jobName,
          normalizedJobName,
          readyPercent: roundedReadyPercent,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      {
        upsert: true,
      },
    )

    const progress = await orderProgressCollection.findOne(
      {
        date,
        normalizedJobName,
      },
      {
        projection: {
          _id: 0,
          normalizedJobName: 0,
        },
      },
    )

    return res.json({ progress })
  } catch (error) {
    next(error)
  }
})

app.get('/api/timesheet/my-state', requireFirebaseAuth, requireApprovedLinkedWorker, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const linkedWorkerId = String(req.authLinkedWorkerId ?? '').trim()
    const worker = await workersCollection.findOne(
      { id: linkedWorkerId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!worker) {
      return res.status(404).json({
        error: 'Linked worker profile was not found. Contact an admin.',
      })
    }

    const [entries, workersWithNumbers, stages] = await Promise.all([
      entriesCollection
        .find(
          { workerId: linkedWorkerId },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ date: -1, createdAt: -1 })
        .toArray(),
      ensureWorkersHaveWorkerNumbers(workersCollection, [worker]),
      stagesCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              normalizedName: 0,
            },
          },
        )
        .sort({ sortOrder: 1, name: 1 })
        .toArray(),
    ])
    const entriesWithPayRates = await ensureEntriesHavePayRates(
      entriesCollection,
      workersCollection,
      entries,
    )

    return res.json({
      worker: workersWithNumbers[0] ?? worker,
      entries: entriesWithPayRates,
      stages,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/my-entries', requireFirebaseAuth, requireApprovedLinkedWorker, async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const linkedWorkerId = String(req.authLinkedWorkerId ?? '').trim()
    const date = String(req.body?.date ?? '').trim()
    const stageId = String(req.body?.stageId ?? '').trim()
    const worker = await workersCollection.findOne(
      { id: linkedWorkerId },
      {
        projection: {
          _id: 0,
          id: 1,
          hourlyRate: 1,
        },
      },
    )

    if (!worker) {
      return res.status(404).json({
        error: 'Linked worker profile was not found. Contact an admin.',
      })
    }

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required.' })
    }

    const stageExists = await stagesCollection.countDocuments({ id: stageId })

    if (stageExists === 0) {
      return res.status(400).json({ error: 'stageId is invalid.' })
    }

    const entry = validateEntryInput(
      {
        ...req.body,
        workerId: linkedWorkerId,
      },
      date,
      'entry',
    )

    const workerRate = Number(worker.hourlyRate)

    if (Number.isFinite(workerRate) && workerRate > 0) {
      entry.payRate = workerRate
    }

    await entriesCollection.insertOne(entry)

    return res.status(201).json({ entry })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/stages', async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const name = String(req.body?.name ?? '').trim()

    if (!name) {
      return res.status(400).json({ error: 'stage name is required.' })
    }

    const normalizedName = normalizeStageName(name)
    const duplicate = await stagesCollection.findOne(
      { normalizedName },
      { projection: { _id: 0, id: 1 } },
    )

    if (duplicate) {
      return res.status(400).json({ error: 'Stage already exists.' })
    }

    const now = new Date().toISOString()
    const highestSortOrderStage = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            sortOrder: 1,
          },
        },
      )
      .sort({ sortOrder: -1 })
      .limit(1)
      .toArray()
    const nextSortOrder = Number.isInteger(highestSortOrderStage[0]?.sortOrder)
      ? Number(highestSortOrderStage[0].sortOrder) + 1
      : 0

    const stage = {
      id: randomUUID(),
      name,
      normalizedName,
      sortOrder: nextSortOrder,
      createdAt: now,
      updatedAt: now,
    }

    await stagesCollection.insertOne(stage)

    return res.status(201).json({
      stage: {
        id: stage.id,
        name: stage.name,
        sortOrder: stage.sortOrder,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/stages/:stageId', async (req, res, next) => {
  try {
    const { stagesCollection, entriesCollection } = await getCollections()
    const stageId = String(req.params.stageId ?? '').trim()

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required.' })
    }

    const inUseCount = await entriesCollection.countDocuments({ stageId })

    if (inUseCount > 0) {
      return res.status(400).json({
        error: 'Cannot remove stage with existing entries. Update or remove those entries first.',
      })
    }

    const result = await stagesCollection.deleteOne({ id: stageId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Stage not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/stages/reorder', async (req, res, next) => {
  try {
    const { stagesCollection } = await getCollections()
    const stageIds = Array.isArray(req.body?.stageIds) ? req.body.stageIds : []

    if (stageIds.length === 0) {
      return res.status(400).json({ error: 'stageIds array is required.' })
    }

    const uniqueStageIds = [...new Set(stageIds.map((value) => String(value ?? '').trim()))].filter(Boolean)

    if (uniqueStageIds.length !== stageIds.length) {
      return res.status(400).json({ error: 'stageIds must be unique and non-empty.' })
    }

    const existingStages = await stagesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )
      .toArray()

    if (existingStages.length !== uniqueStageIds.length) {
      return res.status(400).json({ error: 'stageIds must include all existing stages.' })
    }

    const existingSet = new Set(existingStages.map((stage) => String(stage.id)))
    const allPresent = uniqueStageIds.every((id) => existingSet.has(id))

    if (!allPresent) {
      return res.status(400).json({ error: 'One or more stage IDs are invalid.' })
    }

    const now = new Date().toISOString()
    const writes = uniqueStageIds.map((id, index) => ({
      updateOne: {
        filter: { id },
        update: {
          $set: {
            sortOrder: index,
            updatedAt: now,
          },
        },
      },
    }))

    await stagesCollection.bulkWrite(writes, { ordered: true })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers', async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const input = req.body ?? {}
    const workerFields = validateWorkerInput(input)
    const [workerNumber] = await allocateWorkerNumbers(workersCollection, 1)
    const now = new Date().toISOString()
    const worker = {
      id: randomUUID(),
      workerNumber,
      ...workerFields,
      createdAt: now,
      updatedAt: now,
    }

    await workersCollection.insertOne(worker)

    res.status(201).json({ worker })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/workers/bulk', async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const payloadWorkers = Array.isArray(req.body?.workers) ? req.body.workers : []

    if (payloadWorkers.length === 0) {
      return res.status(400).json({ error: 'workers array is required.' })
    }

    const workerFieldsList = payloadWorkers.map((entry, index) =>
      validateWorkerInput(entry, `workers[${index}]`),
    )
    const workerNumbers = await allocateWorkerNumbers(workersCollection, workerFieldsList.length)
    const now = new Date().toISOString()
    const workers = workerFieldsList.map((workerFields, index) => ({
      id: randomUUID(),
      workerNumber: workerNumbers[index],
      ...workerFields,
      createdAt: now,
      updatedAt: now,
    }))

    await workersCollection.insertMany(workers)

    return res.status(201).json({ insertedCount: workers.length })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/workers/:workerId', async (req, res, next) => {
  try {
    const { workersCollection } = await getCollections()
    const workerId = String(req.params.workerId ?? '').trim()

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    const existingWorker = await workersCollection.findOne(
      { id: workerId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingWorker) {
      return res.status(404).json({ error: 'Worker not found.' })
    }

    const mergedInput = {
      fullName: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'fullName')
        ? req.body.fullName
        : existingWorker.fullName,
      role: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        ? req.body.role
        : existingWorker.role,
      email: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'email')
        ? req.body.email
        : existingWorker.email,
      phone: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'phone')
        ? req.body.phone
        : existingWorker.phone,
      hourlyRate: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'hourlyRate')
        ? req.body.hourlyRate
        : existingWorker.hourlyRate,
    }

    const workerFields = validateWorkerInput(mergedInput)
    const now = new Date().toISOString()

    await workersCollection.updateOne(
      { id: workerId },
      {
        $set: {
          ...workerFields,
          updatedAt: now,
        },
      },
    )

    return res.json({
      worker: {
        ...existingWorker,
        ...workerFields,
        updatedAt: now,
      },
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/workers/:workerId', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection } = await getCollections()
    const workerId = String(req.params.workerId ?? '')

    if (!workerId) {
      return res.status(400).json({ error: 'workerId is required.' })
    }

    const usedInEntries = await entriesCollection.countDocuments({ workerId })

    if (usedInEntries > 0) {
      return res.status(400).json({
        error: 'Cannot remove worker with existing entries. Remove entries first.',
      })
    }

    await workersCollection.deleteOne({ id: workerId })

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/timesheet/entries/bulk', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const date = String(req.body?.date ?? '').trim()
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required.' })
    }

    const entries = rows.map((row, index) =>
      validateEntryInput(row, date, `rows[${index}]`),
    )

    const workerIds = [...new Set(entries.map((entry) => entry.workerId))]
    const validWorkers = await workersCollection
      .find(
        {
          id: {
            $in: workerIds,
          },
        },
        {
          projection: {
            _id: 0,
            id: 1,
            hourlyRate: 1,
          },
        },
      )
      .toArray()

    if (validWorkers.length !== workerIds.length) {
      return res.status(400).json({ error: 'One or more worker IDs are invalid.' })
    }

    const stageIds = [...new Set(entries.map((entry) => entry.stageId).filter(Boolean))]

    if (stageIds.length > 0) {
      const validStages = await stagesCollection
        .find(
          {
            id: {
              $in: stageIds,
            },
          },
          {
            projection: {
              _id: 0,
              id: 1,
            },
          },
        )
        .toArray()

      if (validStages.length !== stageIds.length) {
        return res.status(400).json({ error: 'One or more stage IDs are invalid.' })
      }
    }

    const workerRateById = new Map(
      validWorkers.map((worker) => [String(worker.id), Number(worker.hourlyRate)]),
    )

    entries.forEach((entry) => {
      const workerRate = workerRateById.get(String(entry.workerId ?? '').trim())

      if (Number.isFinite(workerRate) && workerRate > 0) {
        entry.payRate = workerRate
      }
    })

    await entriesCollection.insertMany(entries)

    return res.status(201).json({ insertedCount: entries.length })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/timesheet/entries/:entryId', async (req, res, next) => {
  try {
    const { workersCollection, entriesCollection, stagesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const existingEntry = await entriesCollection.findOne(
      { id: entryId },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!existingEntry) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    const date = String(req.body?.date ?? '').trim()

    if (!date) {
      return res.status(400).json({ error: 'date is required.' })
    }

    const updatedFields = validateEntryFields(req.body, date)
    const worker = await workersCollection.findOne({
      id: updatedFields.workerId,
    }, {
      projection: {
        _id: 0,
        id: 1,
        hourlyRate: 1,
      },
    })

    if (!worker) {
      return res.status(400).json({ error: 'workerId is invalid.' })
    }

    const workerRate = Number(worker.hourlyRate)
    const existingEntryPayRate = Number(existingEntry.payRate)
    const workerChanged = String(existingEntry.workerId ?? '') !== updatedFields.workerId

    if (workerChanged) {
      if (Number.isFinite(workerRate) && workerRate > 0) {
        updatedFields.payRate = workerRate
      }
    } else if (Number.isFinite(existingEntryPayRate) && existingEntryPayRate > 0) {
      updatedFields.payRate = existingEntryPayRate
    } else if (Number.isFinite(workerRate) && workerRate > 0) {
      updatedFields.payRate = workerRate
    }

    if (updatedFields.stageId) {
      const stageExists = await stagesCollection.countDocuments({
        id: updatedFields.stageId,
      })

      if (stageExists === 0) {
        return res.status(400).json({ error: 'stageId is invalid.' })
      }
    }

    const hasStageField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'stageId')
    const shouldUnsetStage = hasStageField && !updatedFields.stageId
    const updateOperation = shouldUnsetStage
      ? {
          $set: updatedFields,
          $unset: {
            stageId: '',
          },
        }
      : {
          $set: updatedFields,
        }

    await entriesCollection.updateOne(
      { id: entryId },
      updateOperation,
    )

    const nextEntry = {
      ...existingEntry,
      ...updatedFields,
    }

    if (shouldUnsetStage) {
      delete nextEntry.stageId
    }

    return res.json({
      entry: nextEntry,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/timesheet/entries/:entryId', async (req, res, next) => {
  try {
    const { entriesCollection } = await getCollections()
    const entryId = String(req.params.entryId ?? '').trim()

    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' })
    }

    const result = await entriesCollection.deleteOne({ id: entryId })

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Entry not found.' })
    }

    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
}
