// The frontend's single source of truth for Arnold's seven production stages
// and the website's stage-status vocabulary.
//
// Mirror of functions/src/orders/stage-registry.mjs (backend) — if you change
// one, change both.

export type OrderProgressStageKey =
  | 'design'
  | 'baseform'
  | 'build'
  | 'sandorlam'
  | 'sealer'
  | 'lacquer'
  | 'ready'

export type OrderProgressStatusKey = 'working' | 'done' | 'stuck'

export const ORDER_PROGRESS_STAGES = [
  { key: 'design', label: 'Design', weight: 13 },
  { key: 'baseform', label: 'Base/Form', weight: 13 },
  { key: 'build', label: 'Build', weight: 13 },
  { key: 'sandorlam', label: 'Sand or lam', weight: 13 },
  { key: 'sealer', label: 'Sealer', weight: 12 },
  { key: 'lacquer', label: 'Lacquer', weight: 12 },
  { key: 'ready', label: 'Ready', weight: 12 },
] as const satisfies ReadonlyArray<{
  key: OrderProgressStageKey
  label: string
  weight: number
}>

export const ORDER_PROGRESS_STAGE_LABEL_BY_KEY = new Map<string, string>(
  ORDER_PROGRESS_STAGES.map((stage) => [stage.key, stage.label]),
)

// Normalizes a stage identifier (key or label) to its canonical stage key:
// "Base/Form" -> "baseform", "Sand or lam" -> "sandorlam".
export function normalizeProgressStageKey(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

// Normalizes a Monday status label to the website's three-state vocabulary:
// working / done / stuck. Returns null for untracked labels. "stock" is a
// common shop-floor typo for "stuck"; "ready" counts as done.
export function normalizeProgressStageStatus(
  value: string | null | undefined,
): OrderProgressStatusKey | null {
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
