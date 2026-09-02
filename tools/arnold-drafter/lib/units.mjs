// Unit handling for Arnold specs.
//
// glTF is metres, Y-up. The shop floor is inches. Every conversion goes through
// here so no builder ever hard-codes a factor.
//
// A spec MUST declare `units` at the top level ("in" or "mm"). Bare numbers are
// read in those units. Strings may carry an explicit unit and override it, so a
// millimetre hardware dimension can sit inside an inch spec without ambiguity.
// Nothing here guesses: an unparseable value throws rather than defaulting.

const M_PER_IN = 0.0254
const M_PER_MM = 0.001

export const SUPPORTED_UNITS = ['in', 'mm']

// 48 | 48.5 | 48" | 1220mm | 6' | 6'-6" | 6' 6 1/2" | 3/4"
const FEET_INCHES = /^(\d+(?:\.\d+)?)\s*'\s*(?:-\s*)?(.*)$/
const FRACTION = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/

function parseInchValue(text) {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const feet = FEET_INCHES.exec(trimmed)
  if (feet) {
    const inchPart = feet[2].replace(/"$/, '').trim()
    const inches = inchPart === '' ? 0 : parseInchValue(inchPart)
    if (inches === null) return null
    return Number(feet[1]) * 12 + inches
  }

  const bare = trimmed.replace(/"$/, '').trim()

  const fraction = FRACTION.exec(bare)
  if (fraction) {
    const whole = fraction[1] ? Number(fraction[1]) : 0
    const denominator = Number(fraction[3])
    if (denominator === 0) return null
    return whole + Number(fraction[2]) / denominator
  }

  if (/^\d+(?:\.\d+)?$/.test(bare)) return Number(bare)
  return null
}

/**
 * Convert a spec dimension to metres.
 * @param {number|string} value
 * @param {'in'|'mm'} specUnits units for bare numbers
 * @param {string} label field name, used in error messages
 */
export function toMetres(value, specUnits, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label}: not a finite number (${value})`)
    return value * (specUnits === 'mm' ? M_PER_MM : M_PER_IN)
  }

  if (typeof value !== 'string') {
    throw new Error(`${label}: expected a number or a dimension string, got ${typeof value}`)
  }

  const text = value.trim()

  const mm = /^(\d+(?:\.\d+)?)\s*mm$/i.exec(text)
  if (mm) return Number(mm[1]) * M_PER_MM

  const cm = /^(\d+(?:\.\d+)?)\s*cm$/i.exec(text)
  if (cm) return Number(cm[1]) * 10 * M_PER_MM

  const metres = /^(\d+(?:\.\d+)?)\s*m$/i.exec(text)
  if (metres) return Number(metres[1])

  const inches = parseInchValue(text)
  if (inches !== null) {
    // A bare string in a mm spec is still mm; only inch marks force inches.
    const forcedInches = /["']/.test(text)
    return forcedInches || specUnits === 'in' ? inches * M_PER_IN : inches * M_PER_MM
  }

  throw new Error(`${label}: cannot read "${value}" as a dimension`)
}

/** Metres back to the spec's own units, for cut lists and dimension strings. */
export function fromMetres(metres, specUnits) {
  return specUnits === 'mm' ? metres / M_PER_MM : metres / M_PER_IN
}

/** Render metres as a shop-readable string, e.g. 18 3/4" or 476 mm. */
export function formatDimension(metres, specUnits, { fractionDenominator = 16 } = {}) {
  if (specUnits === 'mm') return `${Math.round(metres / M_PER_MM)} mm`

  const totalInches = metres / M_PER_IN
  const whole = Math.floor(totalInches + 1e-9)
  const remainder = totalInches - whole
  let numerator = Math.round(remainder * fractionDenominator)
  let denominator = fractionDenominator

  if (numerator === denominator) return `${whole + 1}"`
  if (numerator === 0) return `${whole}"`

  while (numerator % 2 === 0 && denominator % 2 === 0) {
    numerator /= 2
    denominator /= 2
  }
  return whole === 0 ? `${numerator}/${denominator}"` : `${whole} ${numerator}/${denominator}"`
}

/** Metre constants, so catalog derive rules can state shop standards plainly. */
export const IN = 0.0254
export const MM = 0.001
