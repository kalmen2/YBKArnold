import dotenv from 'dotenv'
import { statSync } from 'node:fs'

dotenv.config()

const googleApplicationCredentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim()

if (googleApplicationCredentialsPath) {
  try {
    const credentialsPathStat = statSync(googleApplicationCredentialsPath)

    if (!credentialsPathStat.isFile()) {
      throw new Error('Path is not a file.')
    }
  } catch {
    console.warn(
      `Ignoring invalid GOOGLE_APPLICATION_CREDENTIALS path: ${googleApplicationCredentialsPath}`,
    )
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  }
}

const port = Number(process.env.PORT ?? 8787)
const { app, closeMongoConnections } = await import('../functions/index.mjs')

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

let isShuttingDown = false

async function shutdown() {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true

  try {
    await closeMongoConnections()
  } catch (error) {
    console.error('Failed to close MongoDB connection:', error)
  }

  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  void shutdown()
})

process.on('SIGTERM', () => {
  void shutdown()
})
