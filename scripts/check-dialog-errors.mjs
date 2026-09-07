#!/usr/bin/env node
// Fails when a dialog has an action button but no way to show an error.
//
// This is the shape of bug that keeps reaching users: a handler calls
// setError(...) and returns early, but the only place that error renders is a
// page-level banner sitting behind the open modal. The button does nothing and
// says nothing. Catch it here instead of in production.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/pages', 'src/features', 'src/components']
const OPEN = /<Dialog(?:[\s>]|$)/
const CLOSE = /<\/Dialog>/g
const ACTION = />\s*(Save|Submit|Create|Add|Send|Convert|Delete|Remove|Update|Approve|Confirm|Ship|Generate|Apply)\b/i
const ERROR_SURFACE = /severity="error"|DialogFeedback|color="error"/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

function dialogBlocks(lines) {
  const blocks = []
  let depth = 0
  let start = null

  lines.forEach((line, index) => {
    const opens = OPEN.test(line) ? (line.match(/<Dialog(?=[\s>]|$)/g) || []).length : 0
    const closes = (line.match(CLOSE) || []).length

    if (opens && depth === 0) start = index
    depth = Math.max(0, depth + opens - closes)

    if (depth === 0 && start !== null) {
      blocks.push([start, index])
      start = null
    }
  })

  return blocks
}

const offenders = []
const exempt = []
let dialogCount = 0
let actionCount = 0

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')

    for (const [from, to] of dialogBlocks(lines)) {
      dialogCount += 1
      const body = lines.slice(from, to + 1).join('\n')
      if (!ACTION.test(body)) continue
      actionCount += 1
      if (ERROR_SURFACE.test(body)) continue
      // A dialog that genuinely writes nothing can opt out, but it has to say
      // why in the code rather than quietly failing to report failures.
      const optOut = lines.slice(Math.max(0, from - 3), from + 2).join('\n').match(/no-error-surface:\s*([^*}\n]+)/)
      if (optOut) {
        exempt.push({ file, line: from + 1, reason: optOut[1].trim() })
        continue
      }

      const title = body.match(/<DialogTitle[^>]*>\s*\n?\s*([^<\n{]{3,44})/)
      offenders.push({ file, line: from + 1, title: title ? title[1].trim() : '(untitled)' })
    }
  }
}

console.log(`dialogs: ${dialogCount}   with an action: ${actionCount}   without an error surface: ${offenders.length}   exempt: ${exempt.length}`)
for (const { file, line, reason } of exempt) console.log(`  exempt  ${file}:${line}  ${reason}`)

if (offenders.length > 0) {
  console.error('\nThese dialogs can fail silently. Render <DialogFeedback error={...} /> next to their actions:\n')
  for (const { file, line, title } of offenders) {
    console.error(`  ${file}:${line}  ${title}`)
  }
  process.exit(1)
}

console.log('every action dialog can show an error.')
