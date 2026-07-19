import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import express from 'express'

const app = express()
const port = Number(process.env.PORT || 8080)
const conversionToken = String(process.env.CONVERSION_TOKEN || '').trim()
const allowedExtensions = new Set(['.xls', '.xlsx', '.xlsm', '.ods'])
const maxWorkbookBytes = 25 * 1024 * 1024

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'quote-workbook-converter' })
})

app.post('/convert', express.raw({ type: '*/*', limit: maxWorkbookBytes }), async (req, res) => {
  const suppliedToken = String(req.get('x-conversion-token') || '').trim()

  if (!conversionToken || suppliedToken !== conversionToken) {
    return res.status(401).json({ error: 'Unauthorized.' })
  }

  const requestedName = String(req.get('x-file-name') || 'quote.xlsx').trim()
  const extension = path.extname(requestedName).toLowerCase()

  if (!allowedExtensions.has(extension)) {
    return res.status(400).json({ error: 'Only XLS, XLSX, XLSM, and ODS workbooks are supported.' })
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Workbook body is required.' })
  }

  const jobId = randomUUID()
  const jobDirectory = path.join('/tmp', `quote-conversion-${jobId}`)
  const inputPath = path.join(jobDirectory, `source${extension}`)
  const outputPath = path.join(jobDirectory, 'quote.pdf')

  try {
    await mkdir(jobDirectory, { recursive: true })
    await writeFile(inputPath, req.body)

    await new Promise((resolve, reject) => {
      const processHandle = spawn('python3', ['/app/convert.py', inputPath, outputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      processHandle.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      processHandle.once('error', reject)
      processHandle.once('exit', (exitCode) => {
        if (exitCode === 0) {
          resolve()
        } else {
          reject(new Error(stderr.trim() || `Converter exited with code ${exitCode}.`))
        }
      })
    })

    const pdf = await readFile(outputPath)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="quote.pdf"')
    res.setHeader('Cache-Control', 'no-store')
    return res.send(pdf)
  } catch (error) {
    console.error('Workbook conversion failed.', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Workbook conversion failed.',
    })
  } finally {
    await rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Quote workbook converter listening on ${port}`)
})
