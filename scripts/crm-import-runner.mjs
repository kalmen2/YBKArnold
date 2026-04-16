import 'dotenv/config'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { registerCrmRoutes } from '../functions/src/routes/crm-routes.mjs'
import { createMongoCollectionsService } from '../functions/src/services/mongo-collections-service.mjs'

function parseArguments(argv) {
  const parsed = {
    jsonPath: '',
    commit: false,
    confirmText: 'I_UNDERSTAND_IMPORT_OVERWRITES',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] ?? '').trim()

    if (!current) {
      continue
    }

    if (current === '--commit') {
      parsed.commit = true
      continue
    }

    if (current.startsWith('--json=')) {
      parsed.jsonPath = current.slice('--json='.length).trim()
      continue
    }

    if (current === '--json') {
      parsed.jsonPath = String(argv[index + 1] ?? '').trim()
      index += 1
      continue
    }

    if (current.startsWith('--confirm=')) {
      parsed.confirmText = current.slice('--confirm='.length)
      continue
    }

    if (current === '--confirm') {
      parsed.confirmText = String(argv[index + 1] ?? '')
      index += 1
      continue
    }
  }

  return parsed
}

async function run() {
  const args = parseArguments(process.argv.slice(2))
  const jsonPath = args.jsonPath

  if (!jsonPath) {
    throw new Error('Missing --json <path-to-export.json>.')
  }

  const mongoUri = String(process.env.MONGODB_URI ?? '').trim()
  const mongoDbName = String(process.env.MONGODB_DB ?? 'arnold_system').trim()

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI in environment.')
  }

  const mongoCollectionsService = createMongoCollectionsService({
    mongoUri,
    mongoDbName,
  })

  const app = express()
  app.use(express.json({ limit: '30mb' }))

  const requireFirebaseAuth = (req, _res, next) => {
    req.authUser = {
      uid: 'local-crm-import-script',
      email: 'kal@ybkarnold.com',
    }
    next()
  }

  const requireAdminRole = (_req, _res, next) => {
    next()
  }

  registerCrmRoutes(app, {
    getCollections: () => mongoCollectionsService.getCollections(),
    randomUUID,
    requireFirebaseAuth,
    requireAdminRole,
  })

  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer))
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null

  if (!port) {
    throw new Error('Could not resolve temporary server port.')
  }

  const baseUrl = `http://127.0.0.1:${port}`

  try {
    const payload = JSON.parse(await readFile(jsonPath, 'utf8'))

    const previewResponse = await fetch(`${baseUrl}/api/crm/imports/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ payload }),
    })

    const previewData = await previewResponse.json().catch(() => ({}))

    if (!previewResponse.ok) {
      throw new Error(`Preview failed: ${JSON.stringify(previewData)}`)
    }

    console.log('preview_ok: true')
    console.log('db_name:', mongoDbName)
    console.log('accounts:', previewData.summary?.counts?.accounts)
    console.log('contacts:', previewData.summary?.counts?.contacts)
    console.log('conflict_groups_total:', previewData.conflictGroupCounts?.totalConflictGroups)
    console.log('validation_skipped_accounts_missing_id:', previewData.summary?.validation?.skippedAccountsMissingSourceId)
    console.log('validation_skipped_accounts_missing_name:', previewData.summary?.validation?.skippedAccountsMissingName)
    console.log('validation_skipped_contacts_missing_id:', previewData.summary?.validation?.skippedContactsMissingSourceId)

    if (args.commit) {
      const commitResponse = await fetch(`${baseUrl}/api/crm/imports/commit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          payload,
          confirmText: args.confirmText,
          previewFingerprint: String(previewData.importFingerprint ?? ''),
        }),
      })

      const commitData = await commitResponse.json().catch(() => ({}))

      if (!commitResponse.ok) {
        throw new Error(`Commit failed: ${JSON.stringify(commitData)}`)
      }

      console.log('commit_ok: true')
      console.log('import_run_id:', commitData.importRun?.id)
      console.log('account_upserted:', commitData.importRun?.writeSummary?.accountUpsertedCount)
      console.log('contact_upserted:', commitData.importRun?.writeSummary?.contactUpsertedCount)
      console.log('duplicate_queue_inserted:', commitData.importRun?.writeSummary?.duplicateQueueInsertedCount)
    } else {
      console.log('commit_skipped: true')
    }

    const overviewResponse = await fetch(`${baseUrl}/api/crm/overview`)
    const overviewData = await overviewResponse.json().catch(() => ({}))

    if (!overviewResponse.ok) {
      throw new Error(`Overview failed: ${JSON.stringify(overviewData)}`)
    }

    console.log('overview_dealers_total_accounts:', overviewData?.dealers?.totalAccounts)
    console.log('overview_dealers_total_contacts:', overviewData?.dealers?.totalContacts)
    console.log('overview_open_conflicts:', overviewData?.dealers?.openConflictCount)
    console.log('overview_quotes_total:', overviewData?.quotes?.totalQuotes)
    console.log('overview_orders_total:', overviewData?.orders?.totalOrders)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(undefined)
      })
    })

    await mongoCollectionsService.closeMongoConnections()
  }
}

run().catch((error) => {
  console.error('crm_import_runner_error:', error?.message ?? error)
  process.exitCode = 1
})
