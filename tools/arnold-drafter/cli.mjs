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
import { spawnSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { generate, questionsFor } from './lib/generate.mjs'
import { CATALOG } from './catalog/index.mjs'
import { finishNames } from './lib/materials.mjs'
import { dxfToSvg } from './lib/dxf-preview.mjs'

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
    const primary = questions.filter((q) => !q.derived)
    const derived = questions.filter((q) => q.derived)

    console.log(`\nASK THE CUSTOMER — ${primary.length} parameter(s), never guessed:\n`)
    for (const question of primary) {
      const kind = question.values ? question.values.join(' | ') : question.type
      console.log(`${question.conditional ? '  ~ ' : '  • '}${question.key}  [${kind}]`)
      console.log(`      ${question.ask}`)
      if (question.note) console.log(`      note: ${question.note}`)
    }

    console.log(`\nDERIVED — ${derived.length} parameter(s), scale from the answers above.`)
    console.log('Do not ask for these. Put one in the spec only to override its rule.\n')
    for (const question of derived) {
      const mark = question.confirm ? '  ! ' : '  · '
      console.log(`${mark}${question.key.padEnd(26)} ${question.rule}`)
    }
    console.log('\n  ~ only applies depending on an earlier answer.')
    console.log('  ! derived, but a headline dimension — show it to the customer to confirm.')
  } else if (command === 'preview') {
    const dxfPath = rest[0]
    if (!dxfPath) throw new Error('usage: preview <file.dxf> [--out <file.svg>]')
    const svg = dxfToSvg(readFileSync(resolve(dxfPath), 'utf8'))
    const svgPath = resolve(flag('out', dxfPath.replace(/\.dxf$/i, '.svg')))
    writeFileSync(svgPath, svg)
    console.log(`  ${svgPath}`)
  } else if (command === 'build') {
    const specPath = rest[0]
    if (!specPath) throw new Error('usage: build <spec.json> [--out <dir>]')

    const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'))
    const today = new Date().toISOString().slice(0, 10)
    const result = await generate(spec, { date: today })

    const outDir = resolve(flag('out', join(process.cwd(), 'tools/arnold-drafter/out')))
    mkdirSync(outDir, { recursive: true })

    const name = slug(spec.project?.quoteNumber ? `${spec.project.quoteNumber}-${result.summary.description}` : result.summary.description)
    const glbPath = join(outDir, `${name}.glb`)
    const dxfPath = join(outDir, `${name}.dxf`)
    const sheetPath = join(outDir, `${name}.spec-sheet.json`)

    writeFileSync(glbPath, result.glb)
    writeFileSync(dxfPath, result.dxf)
    writeFileSync(sheetPath, JSON.stringify({ summary: result.summary, cutList: result.cutList, spec }, null, 2))

    const { overall, triangles, glbBytes, unknownParams } = result.summary
    console.log(`✓ ${result.summary.productLabel} — ${result.summary.description}`)
    console.log(`  overall  ${overall.width} W x ${overall.depth} D x ${overall.height} H`)
    console.log(`  parts    ${result.cutList.totals.partCount}`)
    for (const [finish, sqft] of Object.entries(result.cutList.totals.faceAreaSqFtByFinish)) {
      console.log(`           ${finish}: ${sqft} sq ft face area`)
    }
    console.log(`  model    ${triangles} triangles, ${(glbBytes / 1024).toFixed(1)} KB`)

    const confirmable = result.derived.filter((item) => item.confirm)
    const details = result.derived.filter((item) => !item.confirm)
    if (confirmable.length) {
      console.log('\n  CONFIRM WITH THE CUSTOMER — derived headline dimensions:')
      for (const item of confirmable) {
        console.log(`    ${item.key.padEnd(20)} ${item.value.padEnd(12)} (${item.rule})`)
      }
    }
    if (details.length) {
      console.log(`\n  Derived detail (${details.length}) — override by adding to the spec:`)
      for (const item of details) {
        console.log(`    ${item.key.padEnd(20)} ${item.value.padEnd(12)} (${item.rule})`)
      }
    }
    console.log(`\n  ${basename(dxfPath)}   <- open this in AutoCAD`)
    console.log(`  ${basename(glbPath)}`)
    console.log(`  ${basename(sheetPath)}`)
    if (rest.includes('--render')) {
      const script = resolve(join(process.cwd(), 'scripts/render-presentation.mjs'))
      const views = flag('views', 'hero,left,front,detail')
      console.log('\n  rendering presentation views...')
      const run = spawnSync(process.execPath, [script, glbPath, '--views', views], { stdio: 'inherit' })
      if (run.status !== 0) console.log('  ⚠ presentation render failed; the GLB and DXF are still written')
    }

    if (unknownParams.length) {
      console.log(`\n  ⚠ ignored unknown params: ${unknownParams.join(', ')}`)
    }
  } else {
    console.log('commands:')
    console.log('  build <spec.json> [--out <dir>] [--render] [--views hero,left,front,detail]')
    console.log('  preview <file.dxf>   |   questions <product.type>   |   list')
    process.exit(1)
  }
} catch (error) {
  console.error(`\n${error.message}\n`)
  process.exit(1)
}
