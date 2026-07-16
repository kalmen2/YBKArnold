import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

dotenv.config({ path: '.env' })

function parseArgs(argv) {
	const args = {
		apply: false,
		fromMonth: null,
		toMonth: null,
		sampleSize: 25,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const token = String(argv[index] ?? '').trim()

		if (!token) {
			continue
		}

		if (token === '--apply') {
			args.apply = true
			continue
		}

		if (token.startsWith('--from-month=')) {
			args.fromMonth = token.slice('--from-month='.length).trim()
			continue
		}

		if (token === '--from-month') {
			args.fromMonth = String(argv[index + 1] ?? '').trim()
			index += 1
			continue
		}

		if (token.startsWith('--to-month=')) {
			args.toMonth = token.slice('--to-month='.length).trim()
			continue
		}

		if (token === '--to-month') {
			args.toMonth = String(argv[index + 1] ?? '').trim()
			index += 1
			continue
		}

		if (token.startsWith('--sample-size=')) {
			args.sampleSize = Number(token.slice('--sample-size='.length).trim())
			continue
		}

		if (token === '--sample-size') {
			args.sampleSize = Number(String(argv[index + 1] ?? '').trim())
			index += 1
		}
	}

	return args
}

function formatMonth(date) {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	return `${year}-${month}`
}

function previousMonth(monthKey) {
	const match = String(monthKey ?? '').trim().match(/^(\d{4})-(\d{2})$/)

	if (!match) {
		return null
	}

	const year = Number(match[1])
	const month = Number(match[2])

	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
		return null
	}

	const date = new Date(year, month - 1, 1)
	date.setMonth(date.getMonth() - 1)
	return formatMonth(date)
}

function isValidMonthKey(value) {
	return /^(\d{4})-(\d{2})$/.test(String(value ?? '').trim())
}

function monthDayCount(monthKey) {
	const match = String(monthKey ?? '').trim().match(/^(\d{4})-(\d{2})$/)

	if (!match) {
		return 0
	}

	const year = Number(match[1])
	const month = Number(match[2])
	return new Date(year, month, 0).getDate()
}

function normalizeJobName(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ')
}

function buildTargetDate(fromDate, toMonth) {
	const match = String(fromDate ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)

	if (!match) {
		return null
	}

	const day = Number(match[3])
	const maxDay = monthDayCount(toMonth)

	if (!Number.isFinite(day) || day < 1 || day > maxDay) {
		return null
	}

	return `${toMonth}-${String(day).padStart(2, '0')}`
}

function pickLatestIso(left, right) {
	const leftValue = String(left ?? '').trim()
	const rightValue = String(right ?? '').trim()

	if (!leftValue) {
		return rightValue || null
	}

	if (!rightValue) {
		return leftValue || null
	}

	return rightValue > leftValue ? rightValue : leftValue
}

async function main() {
	const cli = parseArgs(process.argv.slice(2))
	const now = new Date()
	const defaultFromMonth = formatMonth(now)
	const defaultToMonth = previousMonth(defaultFromMonth)
	const fromMonth = cli.fromMonth || defaultFromMonth
	const toMonth = cli.toMonth || defaultToMonth

	if (!isValidMonthKey(fromMonth)) {
		throw new Error(`Invalid --from-month value: ${fromMonth || '(empty)'}`)
	}

	if (!isValidMonthKey(toMonth)) {
		throw new Error(`Invalid --to-month value: ${toMonth || '(empty)'}`)
	}

	const sampleSize = Number.isFinite(cli.sampleSize) && cli.sampleSize > 0
		? Math.floor(cli.sampleSize)
		: 25

	const uri = process.env.MONGODB_URI
	const databaseName = process.env.MONGODB_DB

	if (!uri || !databaseName) {
		throw new Error('Missing MONGODB_URI or MONGODB_DB in functions/.env')
	}

	const client = new MongoClient(uri)
	await client.connect()

	try {
		const db = client.db(databaseName)
		const orderProgressCollection = db.collection('timesheet_order_progress')

		const candidates = await orderProgressCollection
			.find(
				{
					date: {
						$regex: new RegExp(`^${fromMonth}-`),
					},
				},
				{
					projection: {
						_id: 1,
						id: 1,
						date: 1,
						normalizedJobName: 1,
						jobName: 1,
						readyPercent: 1,
						isWarranty: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				},
			)
			.toArray()

		const targetMonthDocs = await orderProgressCollection
			.find(
				{
					date: {
						$regex: new RegExp(`^${toMonth}-`),
					},
				},
				{
					projection: {
						_id: 1,
						id: 1,
						date: 1,
						normalizedJobName: 1,
						jobName: 1,
						readyPercent: 1,
						isWarranty: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				},
			)
			.toArray()

		const targetByDateJob = new Map()

		targetMonthDocs.forEach((row) => {
			const normalizedJobName = normalizeJobName(row.normalizedJobName || row.jobName)

			if (!row.date || !normalizedJobName) {
				return
			}

			targetByDateJob.set(`${row.date}::${normalizedJobName}`, row)
		})

		const nowIso = new Date().toISOString()
		const updateOps = []
		const deleteOps = []
		let skippedInvalidDate = 0
		let skippedNoJob = 0
		let updateInPlaceCount = 0
		let mergeIntoExistingCount = 0
		const samples = []

		candidates.forEach((sourceRow) => {
			const sourceDate = String(sourceRow.date ?? '').trim()
			const normalizedJobName = normalizeJobName(sourceRow.normalizedJobName || sourceRow.jobName)
			const targetDate = buildTargetDate(sourceDate, toMonth)

			if (!normalizedJobName) {
				skippedNoJob += 1
				return
			}

			if (!targetDate) {
				skippedInvalidDate += 1
				return
			}

			const targetKey = `${targetDate}::${normalizedJobName}`
			const existingTarget = targetByDateJob.get(targetKey)
			const isSameDocument = existingTarget && String(existingTarget._id) === String(sourceRow._id)

			if (!existingTarget || isSameDocument) {
				updateInPlaceCount += 1

				updateOps.push({
					updateOne: {
						filter: { _id: sourceRow._id },
						update: {
							$set: {
								date: targetDate,
								normalizedJobName,
								updatedAt: nowIso,
							},
						},
					},
				})

				targetByDateJob.set(targetKey, {
					...sourceRow,
					date: targetDate,
					normalizedJobName,
				})

				if (samples.length < sampleSize) {
					samples.push({
						action: 'move',
						jobName: sourceRow.jobName,
						sourceDate,
						targetDate,
						sourceId: sourceRow.id,
					})
				}

				return
			}

			mergeIntoExistingCount += 1

			const sourceReadyPercent = Number(sourceRow.readyPercent)
			const targetReadyPercent = Number(existingTarget.readyPercent)
			const mergedReadyPercent = Number.isFinite(sourceReadyPercent) && Number.isFinite(targetReadyPercent)
				? Math.max(sourceReadyPercent, targetReadyPercent)
				: (Number.isFinite(sourceReadyPercent) ? sourceReadyPercent : targetReadyPercent)

			const mergedWarranty = Boolean(existingTarget.isWarranty) || Boolean(sourceRow.isWarranty)
			const mergedUpdatedAt = pickLatestIso(existingTarget.updatedAt, sourceRow.updatedAt) || nowIso
			const mergedCreatedAt = pickLatestIso(existingTarget.createdAt, sourceRow.createdAt) || nowIso
			const mergedJobName = String(existingTarget.jobName ?? '').trim() || String(sourceRow.jobName ?? '').trim() || null

			updateOps.push({
				updateOne: {
					filter: { _id: existingTarget._id },
					update: {
						$set: {
							readyPercent: mergedReadyPercent,
							isWarranty: mergedWarranty,
							updatedAt: mergedUpdatedAt,
							createdAt: mergedCreatedAt,
							jobName: mergedJobName,
							normalizedJobName,
						},
					},
				},
			})

			deleteOps.push({
				deleteOne: {
					filter: { _id: sourceRow._id },
				},
			})

			if (samples.length < sampleSize) {
				samples.push({
					action: 'merge-and-delete-source',
					jobName: sourceRow.jobName,
					sourceDate,
					targetDate,
					sourceId: sourceRow.id,
					targetId: existingTarget.id,
				})
			}
		})

		const summary = {
			mode: cli.apply ? 'apply' : 'dry-run',
			fromMonth,
			toMonth,
			candidateCount: candidates.length,
			updateInPlaceCount,
			mergeIntoExistingCount,
			skippedInvalidDate,
			skippedNoJob,
			plannedUpdates: updateOps.length,
			plannedDeletes: deleteOps.length,
		}

		console.log('Manager progress month shift repair summary:')
		console.log(JSON.stringify(summary, null, 2))

		if (samples.length > 0) {
			console.log('Sample actions:')
			samples.forEach((row) => console.log(JSON.stringify(row)))
		} else {
			console.log('Sample actions: none')
		}

		if (!cli.apply) {
			console.log('Dry-run complete. Re-run with --apply to write changes.')
			return
		}

		if (updateOps.length > 0) {
			const updateResult = await orderProgressCollection.bulkWrite(updateOps, { ordered: false })
			console.log('Applied updates:', {
				matchedCount: Number(updateResult?.matchedCount ?? 0),
				modifiedCount: Number(updateResult?.modifiedCount ?? 0),
				upsertedCount: Number(updateResult?.upsertedCount ?? 0),
			})
		} else {
			console.log('Applied updates: none')
		}

		if (deleteOps.length > 0) {
			const deleteResult = await orderProgressCollection.bulkWrite(deleteOps, { ordered: false })
			console.log('Applied deletes:', {
				deletedCount: Number(deleteResult?.deletedCount ?? 0),
			})
		} else {
			console.log('Applied deletes: none')
		}

		console.log('Repair script finished.')
	} finally {
		await client.close()
	}
}

main().catch((error) => {
	console.error('Repair script failed:', error?.message || error)
	process.exitCode = 1
})
