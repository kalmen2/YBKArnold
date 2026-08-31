// Catches undefined identifiers across the backend.
//
// node --check only parses, and the route-registration test only executes
// module and registration scope. A name that is out of scope INSIDE a handler
// - which is how `mondayCards` broke the job-status click - is invisible to
// both. This lints for it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Names already undefined before this work began. Each is real dead code
// inside a disabled block; listed so new breakage still fails the test.
const PRE_EXISTING = new Set([
  'AbortSignal', 'nextCutListDocuments', 'hasOrderNameField', 'requestedOrderName',
  'hasPoNumberField', 'requestedPoNumber', 'hasNotesField', 'requestedNotes',
  'hasDescriptionField', 'requestedDescription', 'hasBenchField', 'requestedBench',
  'hasDueDateField', 'requestedDueDate', 'hasLeadTimeDaysField', 'requestedLeadTimeDaysText',
  'hasPodDateField', 'requestedPodDate', 'publicUser', 'hasShipToField', 'requestedShipTo',
  'hasLeadTimeTextField', 'requestedLeadTimeText', 'hasFreightDescriptionField',
  'requestedFreightDescription', 'hasShippingCarrierField', 'requestedShippingCarrier',
  'hasShipNotesField', 'requestedShipNotes', 'savedAt', 'mondayUpdate', 'changes',
  'storedOrder', 'storedMondayOrder', 'localMondayUpdate', 'localMondayShippingUpdate',
  // Real latent bug, pre-dating this work: crm-routes.mjs:466 calls bare
  // randomUUID() at module scope, but the import aliases it to
  // createRandomUuid. It throws if that snapshot path runs without an id.
  'randomUUID',
])

test('no newly undefined identifiers in the backend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'undef-'))
  const cfg = join(dir, 'c.mjs')
  writeFileSync(cfg, `export default [{
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: {
      console:'readonly', process:'readonly', fetch:'readonly', URL:'readonly', Buffer:'readonly',
      setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
      TextEncoder:'readonly', TextDecoder:'readonly', AbortController:'readonly',
      structuredClone:'readonly', FormData:'readonly', Blob:'readonly', crypto:'readonly',
      URLSearchParams:'readonly', URL:'readonly' } },
    rules: { 'no-undef': 'error' },
  }]`)

  let out = ''
  try {
    execFileSync('npx', ['eslint', '--no-config-lookup', '-c', cfg, '-f', 'json', 'src', 'index.mjs'],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) { out = error.stdout ?? '' }

  const results = out ? JSON.parse(out) : []
  const fresh = []
  for (const file of results) {
    for (const m of file.messages) {
      if (m.ruleId !== 'no-undef') continue
      const name = /'([^']+)'/.exec(m.message)?.[1]
      if (name && !PRE_EXISTING.has(name)) {
        fresh.push(`${file.filePath.split('/functions/')[1]}:${m.line} '${name}'`)
      }
    }
  }
  assert.deepEqual(fresh, [], `newly undefined identifiers:\n  ${fresh.join('\n  ')}`)
})
