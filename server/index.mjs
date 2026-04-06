import dotenv from 'dotenv'

dotenv.config()

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
