// The single source of truth for Arnold's seven production stages and the
// website's stage-status vocabulary.
//
// Every place that needs the stage route (order progress tracking, bulk
// updates, progress bars) imports from here. The frontend mirror lives at
// src/features/orders/stage-registry.ts — if you change one, change both.

export const ORDER_PROGRESS_STAGES = Object.freeze([
  Object.freeze({ key: 'design', label: 'Design', weight: 13 }),
  Object.freeze({ key: 'baseform', label: 'Base/Form', weight: 13 }),
  Object.freeze({ key: 'build', label: 'Build', weight: 13 }),
  Object.freeze({ key: 'sandorlam', label: 'Sand or lam', weight: 13 }),
  Object.freeze({ key: 'sealer', label: 'Sealer', weight: 12 }),
  Object.freeze({ key: 'lacquer', label: 'Lacquer', weight: 12 }),
  Object.freeze({ key: 'ready', label: 'Ready', weight: 12 }),
])

export const ORDER_PROGRESS_STAGE_KEYS = Object.freeze(
  ORDER_PROGRESS_STAGES.map((stage) => stage.key),
)

const stageKeySet = new Set(ORDER_PROGRESS_STAGE_KEYS)

export function isOrderProgressStageKey(value) {
  return stageKeySet.has(String(value ?? ''))
}

// Normalizes a stage identifier (key or label) to its canonical stage key:
// "Base/Form" -> "baseform", "Sand or lam" -> "sandorlam".
export function normalizeProgressStageKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

// Normalizes a Monday status label to the website's three-state vocabulary:
// working / done / stuck. Returns null for untracked labels. "stock" is a
// common shop-floor typo for "stuck"; "ready" counts as done.
export function normalizeProgressStageStatus(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (!normalized) {
    return null
  }

  if (normalized === 'working on it' || normalized === 'working') {
    return 'working'
  }

  if (normalized === 'done' || normalized === 'ready') {
    return 'done'
  }

  if (normalized === 'stuck' || normalized === 'stock') {
    return 'stuck'
  }

  return null
}
