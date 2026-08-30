// Parts list derived from the built geometry.
//
// This is the bridge to pricing: identical parts collapse into a quantity, and
// face area is reported so sheet-goods and finish costs can be applied later.
// It is generated from the same geometry the customer sees, so the drawing and
// the quote cannot describe different cabinets.

import { formatDimension, fromMetres } from './units.mjs'
import { FINISHES } from './materials.mjs'

const SQ_M_PER_SQ_FT = 0.092903

export function buildCutList(parts, units) {
  const grouped = new Map()

  for (const part of parts) {
    const [w, h, d] = part.size
    const key = `${part.material}|${w.toFixed(5)}|${h.toFixed(5)}|${d.toFixed(5)}`
    const existing = grouped.get(key)
    if (existing) {
      existing.qty += 1
      existing.names.push(part.name)
    } else {
      grouped.set(key, { material: part.material, size: part.size, qty: 1, names: [part.name] })
    }
  }

  const rows = [...grouped.values()].map((row) => {
    const [w, h, d] = row.size
    // Largest face is the one that gets veneered / finished.
    const faceArea = Math.max(w * h, w * d, h * d)
    return {
      description: collapseNames(row.names),
      qty: row.qty,
      material: row.material,
      materialLabel: FINISHES[row.material]?.label ?? row.material,
      width: formatDimension(w, units),
      height: formatDimension(h, units),
      depth: formatDimension(d, units),
      widthRaw: round(fromMetres(w, units)),
      heightRaw: round(fromMetres(h, units)),
      depthRaw: round(fromMetres(d, units)),
      faceAreaSqFt: round((faceArea * row.qty) / SQ_M_PER_SQ_FT),
    }
  })

  rows.sort((a, b) => a.material.localeCompare(b.material) || a.description.localeCompare(b.description))

  const byFinish = new Map()
  for (const row of rows) {
    byFinish.set(row.material, round((byFinish.get(row.material) ?? 0) + row.faceAreaSqFt))
  }

  return {
    rows,
    totals: {
      partCount: rows.reduce((sum, row) => sum + row.qty, 0),
      faceAreaSqFtByFinish: Object.fromEntries(byFinish),
    },
  }
}

// "door 1", "door 2", "door 3" -> "door (3)"; leaves distinct names alone.
function collapseNames(names) {
  if (names.length === 1) return names[0]
  const stems = new Set(names.map((name) => name.replace(/\s+\d+$/, '')))
  return stems.size === 1 ? [...stems][0] : names.join(', ')
}

const round = (value) => Math.round(value * 1000) / 1000
