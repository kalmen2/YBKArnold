// Copying a quote line to the clipboard, and reading one back.
//
// The copy button used to duplicate a line in place, which only ever helped
// inside one quote. What was wanted is an actual copy: take a line here, paste
// it into a different line, a different quote, or a different browser tab.
//
// Two formats go on the clipboard at once, in one string:
//   line 1  a tab-separated row, so the same copy pastes into Excel
//   line 2  a marker plus JSON, so pasting back in restores every field exactly
// Anything pasted from elsewhere still lands sensibly: a tab-separated row from
// a spreadsheet splits into the same columns, and plain text becomes the
// description.
import type { QuoteLineFormState } from './quoteLines'

const MARKER = '#arnold-quote-line-v1:'

export type QuoteLineClipboardPayload = {
  detailLabel: string
  description: string
  qty: string
  unitPrice: string
}

export function encodeQuoteLine(line: QuoteLineFormState): string {
  const payload: QuoteLineClipboardPayload = {
    detailLabel: line.detailLabel ?? '',
    description: line.description ?? '',
    qty: line.qty ?? '',
    unitPrice: line.unitPrice ?? '',
  }

  // Newlines in the description would break the spreadsheet row, so they are
  // flattened there only. The JSON below keeps the real text.
  const spreadsheetRow = [
    payload.detailLabel,
    payload.description.replace(/\r\n?|\n/g, ' '),
    payload.qty,
    payload.unitPrice,
  ].join('\t')

  return `${spreadsheetRow}\n${MARKER}${JSON.stringify(payload)}`
}

export function decodeQuoteLine(text: string): QuoteLineClipboardPayload | null {
  const raw = String(text ?? '')

  if (!raw.trim()) {
    return null
  }

  const markerIndex = raw.indexOf(MARKER)

  if (markerIndex >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(markerIndex + MARKER.length).trim()) as unknown

      if (parsed && typeof parsed === 'object') {
        const source = parsed as Partial<QuoteLineClipboardPayload>

        return {
          detailLabel: String(source.detailLabel ?? ''),
          description: String(source.description ?? ''),
          qty: String(source.qty ?? ''),
          unitPrice: String(source.unitPrice ?? ''),
        }
      }
    } catch {
      // Falls through to the spreadsheet reading below, which is the better
      // guess for text that only looked like ours.
    }
  }

  const firstRow = raw.split(/\r\n?|\n/)[0] ?? ''

  if (firstRow.includes('\t')) {
    const [detailLabel = '', description = '', qty = '', unitPrice = ''] = firstRow.split('\t')

    return { detailLabel, description, qty, unitPrice }
  }

  return { detailLabel: '', description: raw.trim(), qty: '', unitPrice: '' }
}

/**
 * Kept alongside the system clipboard because reading that one needs a
 * permission the browser may refuse. Within a session this always works.
 */
let lastCopiedLine: QuoteLineClipboardPayload | null = null

export async function copyQuoteLineToClipboard(line: QuoteLineFormState) {
  lastCopiedLine = {
    detailLabel: line.detailLabel ?? '',
    description: line.description ?? '',
    qty: line.qty ?? '',
    unitPrice: line.unitPrice ?? '',
  }

  try {
    await navigator.clipboard.writeText(encodeQuoteLine(line))
  } catch {
    // No clipboard permission. The in-session copy above still works, so the
    // button did its job for everything except another tab.
  }
}

export async function readQuoteLineFromClipboard(): Promise<QuoteLineClipboardPayload | null> {
  try {
    const decoded = decodeQuoteLine(await navigator.clipboard.readText())

    if (decoded) {
      return decoded
    }
  } catch {
    // Reading was refused; fall back to whatever was copied in this session.
  }

  return lastCopiedLine
}

export function hasCopiedQuoteLine() {
  return lastCopiedLine !== null
}
