import { randomUUID } from 'node:crypto'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { MongoClient } from 'mongodb'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8787)
const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB ?? 'arnold_system'

if (!mongoUri) {
	throw new Error('Missing MONGODB_URI in environment configuration.')
}

const mongoClient = new MongoClient(mongoUri)
await mongoClient.connect()

const database = mongoClient.db(mongoDbName)
const workersCollection = database.collection('workers')
const entriesCollection = database.collection('timesheet_entries')

await workersCollection.createIndex({ id: 1 }, { unique: true })
await entriesCollection.createIndex({ id: 1 }, { unique: true })
await entriesCollection.createIndex({ workerId: 1 })
await entriesCollection.createIndex({ date: -1 })

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', async (_req, res, next) => {
	try {
		await database.command({ ping: 1 })
		res.json({ ok: true })
	} catch (error) {
		next(error)
	}
})

app.get('/api/timesheet/state', async (_req, res, next) => {
	try {
		const [workers, entries] = await Promise.all([
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
		])

		res.json({ workers, entries })
	} catch (error) {
		next(error)
	}
})

app.post('/api/timesheet/workers', async (req, res, next) => {
	try {
		const input = req.body ?? {}
		const worker = validateWorkerInput(input)

		await workersCollection.insertOne(worker)

		res.status(201).json({ worker })
	} catch (error) {
		next(error)
	}
})

app.post('/api/timesheet/workers/bulk', async (req, res, next) => {
	try {
		const payloadWorkers = Array.isArray(req.body?.workers) ? req.body.workers : []

		if (payloadWorkers.length === 0) {
			return res.status(400).json({ error: 'workers array is required.' })
		}

		const workers = payloadWorkers.map((entry, index) =>
			validateWorkerInput(entry, `workers[${index}]`),
		)

		await workersCollection.insertMany(workers)

		return res.status(201).json({ insertedCount: workers.length })
	} catch (error) {
		next(error)
	}
})

app.delete('/api/timesheet/workers/:workerId', async (req, res, next) => {
	try {
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
					},
				},
			)
			.toArray()

		if (validWorkers.length !== workerIds.length) {
			return res.status(400).json({ error: 'One or more worker IDs are invalid.' })
		}

		await entriesCollection.insertMany(entries)

		return res.status(201).json({ insertedCount: entries.length })
	} catch (error) {
		next(error)
	}
})

app.patch('/api/timesheet/entries/:entryId', async (req, res, next) => {
	try {
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
		const workerExists = await workersCollection.countDocuments({
			id: updatedFields.workerId,
		})

		if (workerExists === 0) {
			return res.status(400).json({ error: 'workerId is invalid.' })
		}

		await entriesCollection.updateOne(
			{ id: entryId },
			{
				$set: updatedFields,
			},
		)

		return res.json({
			entry: {
				...existingEntry,
				...updatedFields,
			},
		})
	} catch (error) {
		next(error)
	}
})

app.delete('/api/timesheet/entries/:entryId', async (req, res, next) => {
	try {
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

app.use((error, _req, res, _next) => {
	const status = Number(error?.status ?? 500)
	const message =
		error?.message || error?.details || 'Unexpected server error occurred.'

	res.status(status).json({ error: message })
})

app.listen(port, () => {
	console.log(`Timesheet API listening on http://localhost:${port}`)
})

process.on('SIGINT', async () => {
	await mongoClient.close()
	process.exit(0)
})

process.on('SIGTERM', async () => {
	await mongoClient.close()
	process.exit(0)
})

function validateWorkerInput(input, path = 'worker') {
	const fullName = String(input?.fullName ?? '').trim()
	const role = String(input?.role ?? '').trim()
	const email = String(input?.email ?? '').trim()
	const phone = String(input?.phone ?? '').trim()
	const hourlyRate = Number(input?.hourlyRate)

	if (!fullName) {
		throw {
			status: 400,
			message: `${path}.fullName is required.`,
		}
	}

	if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
		throw {
			status: 400,
			message: `${path}.hourlyRate must be a positive number.`,
		}
	}

	const now = new Date().toISOString()

	return {
		id: randomUUID(),
		fullName,
		role,
		email,
		phone,
		hourlyRate,
		createdAt: now,
		updatedAt: now,
	}
}

function validateEntryInput(input, date, path = 'entry') {
	const fields = validateEntryFields(input, date, path)

	return {
		id: randomUUID(),
		...fields,
		createdAt: new Date().toISOString(),
	}
}

function validateEntryFields(input, date, path = 'entry') {
	const normalizedDate = String(date ?? '').trim()
	const workerId = String(input?.workerId ?? '').trim()
	const jobName = String(input?.jobName ?? '').trim()
	const hours = Number(input?.hours)
	const notes = String(input?.notes ?? '').trim()

	if (!normalizedDate) {
		throw {
			status: 400,
			message: 'date is required.',
		}
	}

	if (!workerId) {
		throw {
			status: 400,
			message: `${path}.workerId is required.`,
		}
	}

	if (!jobName) {
		throw {
			status: 400,
			message: `${path}.jobName is required.`,
		}
	}

	if (!Number.isFinite(hours) || hours <= 0) {
		throw {
			status: 400,
			message: `${path}.hours must be a positive number.`,
		}
	}

	return {
		workerId,
		date: normalizedDate,
		jobName,
		hours,
		notes,
	}
}
