// spec -> { glb, cutList, summary }

import { MeshBuilder } from './mesh.mjs'
import { buildGlb } from './gltf.mjs'
import { buildCutList } from './cutlist.mjs'
import { resolveParams } from './validate.mjs'
import { SUPPORTED_UNITS, formatDimension } from './units.mjs'
import { getProduct } from '../catalog/index.mjs'
import { buildDrawing } from './drawing.mjs'

export async function generate(spec, { date } = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('spec must be a JSON object')

  const units = spec.units
  if (!SUPPORTED_UNITS.includes(units)) {
    throw new Error(`spec.units is required and must be one of: ${SUPPORTED_UNITS.join(', ')}`)
  }

  const description = spec.project?.description
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('spec.project.description is required — it names the model and titles the sketch')
  }

  const product = getProduct(spec.product?.type)
  const { params, derived, unknown } = resolveParams(product, spec.product?.params, units)

  const mesh = new MeshBuilder()
  product.build(mesh, params)

  const glb = await buildGlb(mesh, { name: description.trim() })
  const cutList = buildCutList(mesh.parts, units)
  const bounds = mesh.bounds()

  const derivedReport = derived.map((item) => ({
    key: item.key,
    rule: item.rule,
    confirm: item.confirm,
    value:
      item.type === 'dimension' ? formatDimension(item.value, units)
      : item.type === 'finish' ? item.value
      : String(item.value),
  }))

  const summaryForSheet = {
    description: description.trim(),
    client: spec.project?.client ?? null,
    quoteNumber: spec.project?.quoteNumber ?? null,
    itemNumber: spec.project?.itemNumber ?? null,
  }
  const { dxf } = buildDrawing(mesh.parts, summaryForSheet, { date })

  return {
    glb,
    dxf: dxf.toString(),
    cutList,
    derived: derivedReport,
    summary: {
      description: description.trim(),
      productType: product.type,
      productLabel: product.label,
      units,
      quoteNumber: spec.project?.quoteNumber ?? null,
      client: spec.project?.client ?? null,
      itemNumber: spec.project?.itemNumber ?? null,
      overall: {
        width: formatDimension(bounds.size[0], units),
        height: formatDimension(bounds.size[1], units),
        depth: formatDimension(bounds.size[2], units),
      },
      triangles: mesh.triangleCount(),
      glbBytes: glb.byteLength,
      unknownParams: unknown,
      derivedCount: derived.length,
    },
  }
}

/** The full question list for a product type, for use before a spec exists. */
export function questionsFor(type) {
  const product = getProduct(type)
  return product.params.map((param) => ({
    key: param.key,
    ask: param.ask ?? null,
    type: param.type,
    values: param.values ?? null,
    conditional: Boolean(param.when),
    derived: Boolean(param.derive),
    confirm: Boolean(param.confirm),
    rule: param.rule ?? null,
    note: param.note ?? null,
  }))
}
