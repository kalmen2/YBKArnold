// Parameter validation — the "don't assume, but don't interrogate" rule.
//
// Parameters come in two tiers:
//
//   PRIMARY  Carries commercial or functional intent: overall size, how many
//            doors, which finish, what kind of base. These must come from the
//            customer. Missing one stops the build and produces the question.
//
//   DETAIL   Proportion and construction detail: reveals, overhangs, panel
//            thickness, pull sizing. These derive from the primaries via a
//            stated rule. Asking about every one of them is how a five-minute
//            sketch turns into a forty-question interview.
//
// A derived value is NOT a silent assumption. Every one is reported back with
// the rule that produced it, so a wrong proportion gets caught by eye. Any
// detail parameter can be pinned by putting it in the spec — an explicit value
// always wins over its rule.
//
// `default` remains forbidden. A default is a number with no stated reasoning
// that nobody sees; a derive rule is visible arithmetic on confirmed inputs.
// That distinction is the whole point.

import { toMetres } from './units.mjs'
import { resolveFinish } from './materials.mjs'

export class SpecIncompleteError extends Error {
  constructor(missing, invalid, productType) {
    const lines = []
    if (missing.length) {
      lines.push(`Missing ${missing.length} required parameter(s) for "${productType}".`)
      lines.push('Ask the customer for these — they are design decisions, not proportions:')
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
    lines.push('Nothing was generated. No primary dimension was guessed.')
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
      if (typeof raw !== 'boolean') throw new Error(`must be true or false, got ${JSON.stringify(raw)}`)
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
 * @returns {{params: object, derived: Array, unknown: string[]}}
 */
export function resolveParams(productDef, raw, units) {
  const supplied = raw ?? {}
  const resolved = {}
  const derived = []
  const missing = []
  const invalid = []

  for (const param of productDef.params) {
    if (param.default !== undefined) {
      throw new Error(`schema bug: "${param.key}" declares a default; use a derive rule so the value is disclosed`)
    }
    if (param.derive && !param.rule) {
      throw new Error(`schema bug: "${param.key}" derives a value without a \`rule\` string to disclose it`)
    }

    // `when` sees values resolved so far, so a schema must list the controlling
    // parameter before anything conditional on it.
    if (param.when && !param.when(resolved)) continue

    const value = supplied[param.key]

    if (value === undefined || value === null) {
      if (param.derive) {
        try {
          resolved[param.key] = param.derive(resolved)
          derived.push({
            key: param.key,
            value: resolved[param.key],
            rule: param.rule,
            type: param.type,
            confirm: Boolean(param.confirm),
          })
        } catch (error) {
          invalid.push({ key: param.key, reason: `derive rule failed: ${error.message}` })
        }
      } else {
        missing.push(param)
      }
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

  return { params: resolved, derived, unknown }
}
