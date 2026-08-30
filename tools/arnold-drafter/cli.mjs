#!/usr/bin/env node
// Arnold drafter CLI.
//
//   node tools/arnold-drafter/cli.mjs build <spec.json> [--out <dir>]
//   node tools/arnold-drafter/cli.mjs questions <product.type>
//   node tools/arnold-drafter/cli.mjs list
//
// `build` writes <name>.glb and <name>.spec-sheet.json, and exits non-zero
// with the full list of unanswered questions if the spec is incomplete.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { generate, questionsFor } from './lib/generate.mjs'
import { CATALOG } from './catalog/index.mjs'
import { finishNames } from './lib/materials.mjs'

const [command, ...rest] = process.argv.slice(2)

function flag(name, fallback) {
  const index = rest.indexOf(`--${name}`)
  return index === -1 ? fallback : rest[index + 1]
}

const slug = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model'

try {
  if (command === 'list') {
    console.log('Product types:')
    for (const [type, product] of CATALOG) console.log(`  ${type.padEnd(24)} ${product.label}`)
    console.log('\nFinishes:')
    for (const name of finishNames()) console.log(`  ${name}`)
  } else if (command === 'questions') {
    const type = rest[0]
    const questions = questionsFor(type)
    console.log(`Questions for ${type} (${questions.length} parameters, none optional):\n`)
    for (const question of questions) {
      const kind = question.values ? question.values.join(' | ') : question.type
      console.log(`${question.conditional ? '  ~ ' : '  • '}${question.key}  [${kind}]`)
      console.log(`      ${question.ask}`)
      if (question.note) console.log(`      note: ${question.note}`)
    }
    console.log('\n  ~ marks a parameter that only applies depending on an earlier answer.')
  } else if (command === 'build') {
    const specPath = rest[0]
    if (!specPath) throw new Error('usage: build <spec.json> [--out <dir>]')

    const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'))
    const result = await generate(spec)

    const outDir = resolve(flag('out', join(process.cwd(), 'tools/arnold-drafter/out')))
    mkdirSync(outDir, { recursive: true })

    const name = slug(spec.project?.quoteNumber ? `${spec.project.quoteNumber}-${result.summary.description}` : result.summary.description)
    const glbPath = join(outDir, `${name}.glb`)
    const sheetPath = join(outDir, `${name}.spec-sheet.json`)

    writeFileSync(glbPath, result.glb)
    writeFileSync(sheetPath, JSON.stringify({ summary: result.summary, cutList: result.cutList, spec }, null, 2))

    const { overall, triangles, glbBytes, unknownParams } = result.summary
    console.log(`✓ ${result.summary.productLabel} — ${result.summary.description}`)
    console.log(`  overall  ${overall.width} W x ${overall.depth} D x ${overall.height} H`)
    console.log(`  parts    ${result.cutList.totals.partCount}`)
    for (const [finish, sqft] of Object.entries(result.cutList.totals.faceAreaSqFtByFinish)) {
      console.log(`           ${finish}: ${sqft} sq ft face area`)
    }
    console.log(`  model    ${triangles} triangles, ${(glbBytes / 1024).toFixed(1)} KB`)
    console.log(`  ${basename(glbPath)}`)
    console.log(`  ${basename(sheetPath)}`)
    if (unknownParams.length) {
      console.log(`\n  ⚠ ignored unknown params: ${unknownParams.join(', ')}`)
    }
  } else {
    console.log('commands: build <spec.json> [--out <dir>] | questions <product.type> | list')
    process.exit(1)
  }
} catch (error) {
  console.error(`\n${error.message}\n`)
  process.exit(1)
}
