// Parameter validation — the "Claude may not assume anything" rule, enforced.
//
// Schemas here deliberately have NO default values. If a parameter applies and
// the spec does not supply it, generation fails. The failure lists every
// missing parameter at once, each with the question to put to the customer, so
// the gap is closed in a single conversation rather than a dozen round trips.
//
// A parameter may be conditional (`when`), but it can never be optional-with-a-
// fallback. That distinction is the whole point: a conditional parameter does
// not apply, whereas an optional one would mean the generator picked a number
// nobody approved.

import { toMetres } from './units.mjs'
import { resolveFinish } from './materials.mjs'

export class SpecIncompleteError extends Error {
  constructor(missing, invalid, productType) {
    const lines = []
    if (missing.length) {
      lines.push(`Missing ${missing.length} required parameter(s) for "${productType}".`)
      lines.push('Ask the customer / estimator these, then add them to the spec:')
      for (const item of missing) {
        lines.push(`  • ${item.key} — ${item.ask}`)
        if (item.note) lines.push(`      note: ${item.note}`)
      }
    }
    if (invalid.length) {
      if (lines.length) lines.push('')
      lines.push(`${invalid.length} parameter(s) present but unusable:`)
      for (const item of invalid) lines.push(`  • ${item.key} — ${item.reason}`)
    }
    lines.push('')
    lines.push('Nothing was generated. No values were guessed.')
    super(lines.join('\n'))
    this.name = 'SpecIncompleteError'
    this.missing = missing
    this.invalid = invalid
  }
}

function coerce(param, raw, units) {
  switch (param.type) {
    case 'dimension': {
      const metres = toMetres(raw, units, param.key)
      if (metres <= 0) throw new Error(`must be greater than zero, got ${raw}`)
      return metres
    }
    case 'integer': {
      if (!Number.isInteger(raw)) throw new Error(`must be a whole number, got ${JSON.stringify(raw)}`)
      if (param.min != null && raw < param.min) throw new Error(`must be at least ${param.min}, got ${raw}`)
      if (param.max != null && raw > param.max) throw new Error(`must be at most ${param.max}, got ${raw}`)
      return raw
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new Error(`must be a number, got ${JSON.stringify(raw)}`)
      }
      return raw
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') {
        throw new Error(`must be true or false, got ${JSON.stringify(raw)}`)
      }
      return raw
    }
    case 'enum': {
      if (!param.values.includes(raw)) {
        throw new Error(`must be one of ${param.values.join(' | ')}, got ${JSON.stringify(raw)}`)
      }
      return raw
    }
    case 'finish':
      return resolveFinish(raw, param.key).key
    case 'string': {
      if (typeof raw !== 'string' || raw.trim() === '') throw new Error('must be a non-empty string')
      return raw.trim()
    }
    default:
      throw new Error(`schema bug: unknown parameter type "${param.type}"`)
  }
}

/**
 * Resolve a product's raw params against its schema.
 * @param {{type: string, params: Array}} productDef catalog entry
 * @param {Record<string, unknown>} raw params straight from the spec file
 * @param {'in'|'mm'} units
 */
export function resolveParams(productDef, raw, units) {
  const supplied = raw ?? {}
  const resolved = {}
  const missing = []
  const invalid = []

  for (const param of productDef.params) {
    if (param.default !== undefined) {
      throw new Error(`schema bug: "${param.key}" declares a default; defaults are forbidden in this catalog`)
    }

    // `when` is evaluated against values resolved so far, so schemas must list
    // the controlling parameter before anything conditional on it.
    if (param.when && !param.when(resolved)) continue

    const value = supplied[param.key]
    if (value === undefined || value === null) {
      missing.push(param)
      continue
    }

    try {
      resolved[param.key] = coerce(param, value, units)
    } catch (error) {
      invalid.push({ key: param.key, reason: error.message })
    }
  }

  const known = new Set(productDef.params.map((param) => param.key))
  const unknown = Object.keys(supplied).filter((key) => !known.has(key))

  if (missing.length || invalid.length) throw new SpecIncompleteError(missing, invalid, productDef.type)

  return { params: resolved, unknown }
}
