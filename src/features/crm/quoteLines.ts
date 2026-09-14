// Quote line logic, pulled out of SalesOpportunitiesPage.
//
// Lines are stored flat. A main line is followed immediately by its sublines,
// which point back at it through parentLineId. Every operation here has to
// respect that: moving, duplicating or removing a line means acting on the
// whole block, never a single row, or sublines end up under the wrong parent.
import type { CrmQuoteLineImage } from './api'
import { evaluateQuoteFormula, isQuoteFormula } from './quoteFormula'

export type QuoteLineFormState = {
  id: string
  parentLineId: string | null
  itemNumber: string
  detailLabel: string
  description: string
  qty: string
  unitPrice: string
  extPrice: string
  images: CrmQuoteLineImage[]
}

/**
 * The product label is one line beside the description, so it has to stay short
 * enough that the column it sets does not eat the description's width. Twenty-two
 * characters fits "large reception desk" and stops well before a sentence.
 */
export const QUOTE_PRODUCT_MAX_LENGTH = 22

export type QuoteLinePricingField = 'detailLabel' | 'description' | 'qty' | 'unitPrice' | 'extPrice'

export function createEmptyQuoteLine(parentLineId: string | null = null): QuoteLineFormState {
  return {
    id: crypto.randomUUID(),
    parentLineId,
    itemNumber: '',
    detailLabel: '',
    description: '',
    qty: '',
    unitPrice: '',
    extPrice: '',
    images: [],
  }
}

/**
 * The heading is the first line of the description; everything after the first
 * newline is the detail body. They are stored as one string.
 */
export function splitQuoteLineDescription(value: string) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n')
  const newlineIndex = normalized.indexOf('\n')

  if (newlineIndex < 0) {
    return { heading: normalized, details: '' }
  }

  return {
    heading: normalized.slice(0, newlineIndex),
    details: normalized.slice(newlineIndex + 1),
  }
}

export function joinQuoteLineDescription(heading: string, details: string) {
  return details ? `${heading}\n${details}` : heading
}

/** Both sides accept arithmetic, so "48/12" feet times "35.5" resolves here. */
export function calculateExtendedPrice(qty: string, unitPrice: string) {
  const quantity = evaluateQuoteFormula(qty)
  const price = evaluateQuoteFormula(unitPrice)

  return quantity !== null && price !== null
    ? String(Number((quantity * price).toFixed(2)))
    : ''
}

export function updateQuoteLinePricing(
  line: QuoteLineFormState,
  field: QuoteLinePricingField,
  value: string,
): QuoteLineFormState {
  const next = { ...line, [field]: value }

  if (field === 'qty' || field === 'unitPrice') {
    next.extPrice = calculateExtendedPrice(next.qty, next.unitPrice)
  }

  return next
}

/** Shows what a typed formula works out to, the way Excel shows the result. */
export function quoteFormulaHint(value: string) {
  if (!isQuoteFormula(value)) {
    return undefined
  }

  const result = evaluateQuoteFormula(value)

  return result === null ? 'Check this formula' : result.toLocaleString()
}

/** Index one past the end of the block starting at `start` (line + sublines). */
function blockEndIndex(lines: QuoteLineFormState[], start: number) {
  let end = start + 1

  while (lines[end]?.parentLineId === lines[start]?.id) {
    end += 1
  }

  return end
}

/**
 * Move a main line up or down, carrying its sublines with it. Sublines
 * themselves never move alone — they belong to their parent.
 */
export function moveQuoteLineBlock(
  lines: QuoteLineFormState[],
  index: number,
  direction: 'up' | 'down',
): QuoteLineFormState[] {
  const line = lines[index]

  if (!line || line.parentLineId) {
    return lines
  }

  const end = blockEndIndex(lines, index)
  const block = lines.slice(index, end)

  if (direction === 'up') {
    let previous = index - 1

    while (previous >= 0 && lines[previous]?.parentLineId) {
      previous -= 1
    }

    if (previous < 0) {
      return lines
    }

    return [
      ...lines.slice(0, previous),
      ...block,
      ...lines.slice(previous, index),
      ...lines.slice(end),
    ]
  }

  if (end >= lines.length) {
    return lines
  }

  const nextEnd = blockEndIndex(lines, end)

  return [
    ...lines.slice(0, index),
    ...lines.slice(end, nextEnd),
    ...block,
    ...lines.slice(nextEnd),
  ]
}

/**
 * Copy a line and its sublines, inserted directly beneath the original.
 *
 * Every id is regenerated and parentLineId remapped through the new ids: a copy
 * sharing identifiers with its source would collide on save and cross the
 * parent links between the two.
 */
export function duplicateQuoteLineBlock(
  lines: QuoteLineFormState[],
  index: number,
): QuoteLineFormState[] {
  const line = lines[index]

  if (!line || line.parentLineId) {
    return lines
  }

  const end = blockEndIndex(lines, index)
  const block = lines.slice(index, end)
  const idBySourceId = new Map<string, string>()

  block.forEach((entry) => {
    idBySourceId.set(String(entry.id), crypto.randomUUID())
  })

  const copies = block.map((entry) => ({
    ...entry,
    id: idBySourceId.get(String(entry.id)) ?? crypto.randomUUID(),
    parentLineId: entry.parentLineId
      ? (idBySourceId.get(String(entry.parentLineId)) ?? null)
      : null,
    // Images are shared references to already-uploaded files, so the copy
    // points at the same ones rather than re-uploading them.
    images: [...entry.images],
  }))

  return [...lines.slice(0, end), ...copies, ...lines.slice(end)]
}

/**
 * Copy one subline, inserted directly beneath it, under the same parent.
 *
 * Separate from duplicating a block: sometimes the whole desk is being repeated
 * and sometimes it is just one more drawer on the desk already there.
 */
export function duplicateQuoteSubline(
  lines: QuoteLineFormState[],
  index: number,
): QuoteLineFormState[] {
  const line = lines[index]

  if (!line || !line.parentLineId) {
    return lines
  }

  const copy: QuoteLineFormState = {
    ...line,
    id: crypto.randomUUID(),
    images: [...line.images],
  }

  return [...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)]
}

/**
 * Turn a main line's own detail row into a subline carrying the same text.
 *
 * That row reads as the first subline but belongs to the parent, so copying it
 * has to create a real subline rather than duplicate the whole block.
 */
export function copyQuoteLineDetailToSubline(
  lines: QuoteLineFormState[],
  index: number,
): QuoteLineFormState[] {
  const line = lines[index]

  if (!line || line.parentLineId) {
    return lines
  }

  const subline: QuoteLineFormState = {
    ...createEmptyQuoteLine(line.id),
    detailLabel: line.detailLabel,
    description: splitQuoteLineDescription(line.description).details,
  }

  // Sublines sit directly after their parent's existing ones.
  let insertAt = index + 1

  while (lines[insertAt]?.parentLineId === line.id) {
    insertAt += 1
  }

  return [...lines.slice(0, insertAt), subline, ...lines.slice(insertAt)]
}
