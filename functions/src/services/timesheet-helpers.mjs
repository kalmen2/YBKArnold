import { randomUUID } from 'node:crypto'
import { AppError } from '../utils/app-error.mjs'

export function normalizeWorkerNumber(value) {
  const normalized = String(value ?? '').trim()

  if (!/^[0-9]{4}$/.test(normalized)) {
    return null
  }

  return normalized
}

export async function allocateWorkerNumbers(workersCollection, requestedCount) {
  const count = Number(requestedCount)

  if (!Number.isInteger(count) || count <= 0) {
    return []
  }

  const existingWorkers = await workersCollection
    .find(
      {},
      {
        projection: {
          _id: 0,
          workerNumber: 1,
        },
      },
    )
    .toArray()
  const usedNumbers = new Set(
    existingWorkers
      .map((worker) => normalizeWorkerNumber(worker.workerNumber))
      .filter(Boolean),
  )

  if (usedNumbers.size + count > 9000) {
    throw new AppError('No available worker IDs remain.', 500)
  }

  const allocatedNumbers = []
  const startOffset = Math.floor(Math.random() * 9000)

  for (let index = 0; index < 9000 && allocatedNumbers.length < count; index += 1) {
    const numericValue = 1000 + ((startOffset + index) % 9000)
    const candidate = String(numericValue).padStart(4, '0')

    if (usedNumbers.has(candidate)) {
      continue
    }

    usedNumbers.add(candidate)
    allocatedNumbers.push(candidate)
  }

  if (allocatedNumbers.length !== count) {
    throw new AppError('Unable to allocate worker IDs.', 500)
  }

  return allocatedNumbers
}

export async function ensureWorkersHaveWorkerNumbers(workersCollection, workers) {
  const workerList = Array.isArray(workers) ? workers : []
  const workersMissingNumbers = workerList.filter(
    (worker) => !normalizeWorkerNumber(worker.workerNumber),
  )

  if (workersMissingNumbers.length === 0) {
    return workerList
  }

  const allocatedNumbers = await allocateWorkerNumbers(workersCollection, workersMissingNumbers.length)
  const now = new Date().toISOString()
  const allocatedByWorkerId = new Map()

  workersMissingNumbers.forEach((worker, index) => {
    allocatedByWorkerId.set(String(worker.id), allocatedNumbers[index])
  })

  await workersCollection.bulkWrite(
    workersMissingNumbers.map((worker) => ({
      updateOne: {
        filter: { id: String(worker.id) },
        update: {
          $set: {
            workerNumber: allocatedByWorkerId.get(String(worker.id)),
            updatedAt: now,
          },
        },
      },
    })),
    { ordered: false },
  )

  return workerList.map((worker) => {
    const workerId = String(worker.id)
    const allocatedNumber = allocatedByWorkerId.get(workerId)

    if (!allocatedNumber) {
      return worker
    }

    return {
      ...worker,
      workerNumber: allocatedNumber,
      updatedAt: now,
    }
  })
}

export function normalizeJobName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export async function ensureEntriesHavePayRates(entriesCollection, workersCollection, entries) {
  const entryList = Array.isArray(entries) ? entries : []
  const entriesMissingPayRate = entryList.filter(
    (entry) => !Number.isFinite(Number(entry?.payRate)),
  )

  if (entriesMissingPayRate.length === 0) {
    return entryList
  }

  const workerIds = [...new Set(entriesMissingPayRate.map((entry) => String(entry.workerId ?? '').trim()).filter(Boolean))]

  if (workerIds.length === 0) {
    return entryList
  }

  const workers = await workersCollection
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
  const hourlyRateByWorkerId = new Map(
    workers.map((worker) => [String(worker.id), Number(worker.hourlyRate)]),
  )

  const writes = []

  entriesMissingPayRate.forEach((entry) => {
    const workerId = String(entry.workerId ?? '').trim()
    const workerRate = hourlyRateByWorkerId.get(workerId)

    if (!Number.isFinite(workerRate) || workerRate <= 0) {
      return
    }

    writes.push({
      updateOne: {
        filter: { id: String(entry.id ?? '').trim() },
        update: {
          $set: {
            payRate: Number(workerRate),
          },
        },
      },
    })
  })

  if (writes.length > 0) {
    await entriesCollection.bulkWrite(writes, { ordered: false })
  }

  return entryList.map((entry) => {
    const existingPayRate = Number(entry?.payRate)

    if (Number.isFinite(existingPayRate) && existingPayRate > 0) {
      return entry
    }

    const workerRate = hourlyRateByWorkerId.get(String(entry.workerId ?? '').trim())

    if (!Number.isFinite(workerRate) || workerRate <= 0) {
      return entry
    }

    return {
      ...entry,
      payRate: Number(workerRate),
    }
  })
}

export function validateWorkerInput(input, path = 'worker') {
  const fullName = String(input?.fullName ?? '').trim()
  const role = String(input?.role ?? '').trim()
  const email = String(input?.email ?? '').trim()
  const phone = String(input?.phone ?? '').trim()
  const hourlyRate = Number(input?.hourlyRate)

  if (!fullName) {
    throw new AppError(`${path}.fullName is required.`, 400)
  }

  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    throw new AppError(`${path}.hourlyRate must be a positive number.`, 400)
  }

  return {
    fullName,
    role,
    email,
    phone,
    hourlyRate,
  }
}

export function validateEntryInput(input, date, path = 'entry') {
  const fields = validateEntryFields(input, date, path)

  return {
    id: randomUUID(),
    ...fields,
    createdAt: new Date().toISOString(),
  }
}

export function validateEntryFields(input, date, path = 'entry') {
  const normalizedDate = String(date ?? '').trim()
  const workerId = String(input?.workerId ?? '').trim()
  const stageId = String(input?.stageId ?? '').trim()
  const jobName = String(input?.jobName ?? '').trim()
  const hours = Number(input?.hours)
  const overtimeHoursRaw = input?.overtimeHours
  const overtimeHours = overtimeHoursRaw === undefined
    ? 0
    : Number(overtimeHoursRaw)
  const notes = String(input?.notes ?? '').trim()

  if (!normalizedDate) {
    throw new AppError('date is required.', 400)
  }

  if (!workerId) {
    throw new AppError(`${path}.workerId is required.`, 400)
  }

  if (!jobName) {
    throw new AppError(`${path}.jobName is required.`, 400)
  }

  if (!Number.isFinite(hours) || hours < 0) {
    throw new AppError(`${path}.hours must be a non-negative number.`, 400)
  }

  if (!Number.isFinite(overtimeHours) || overtimeHours < 0) {
    throw new AppError(`${path}.overtimeHours must be a non-negative number.`, 400)
  }

  if (hours <= 0 && overtimeHours <= 0) {
    throw new AppError(`${path}.hours or ${path}.overtimeHours must be greater than zero.`, 400)
  }

  const fields = {
    workerId,
    date: normalizedDate,
    jobName,
    hours,
    overtimeHours,
    notes,
  }

  if (stageId) {
    fields.stageId = stageId
  }

  return fields
}

export function normalizeStageName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
