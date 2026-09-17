// Subitems that were created and never named.
//
// Monday lets a subitem be added with no name, and a handful were. They arrive
// here reading "Subitem" with no vendor, no dates and no description, so they
// have to be called out rather than printed as though they were a real part.
const PLACEHOLDER_NAMES = new Set(['', 'item', 'subitem', 'buy', 'new subitem'])

export function isPlaceholderItemName(value: string | null | undefined) {
  return PLACEHOLDER_NAMES.has(String(value ?? '').trim().toLowerCase())
}
