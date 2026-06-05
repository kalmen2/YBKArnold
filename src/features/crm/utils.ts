type ContactNameLike = {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
}

type QuoteTimestampLike = {
  opportunityDate?: string | null
}

export function displayContactName(contact: ContactNameLike) {
  if (contact.name) {
    return contact.name
  }

  const combined = [contact.firstName, contact.lastName]
    .filter((entry) => Boolean(entry && entry.trim()))
    .join(' ')

  return combined || 'Unnamed contact'
}

export function parseNonNegativeAmount(input: string) {
  const parsed = Number(input)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function parseOpportunityDate(rawValue: string) {
  const normalized = rawValue.trim()

  if (!normalized) {
    return null
  }

  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (isoDateMatch) {
    const year = Number(isoDateMatch[1])
    const month = Number(isoDateMatch[2])
    const day = Number(isoDateMatch[3])
    const parsedDate = new Date(year, month - 1, day)

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
  }

  const parsedDate = new Date(normalized)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

export function resolveQuoteAgeDays(quote: QuoteTimestampLike) {
  const rawQuoteDate = String(quote.opportunityDate || '')
  const timestamp = parseOpportunityDate(rawQuoteDate)

  if (!timestamp) {
    return 0
  }

  const diffMs = Date.now() - timestamp.getTime()

  if (diffMs <= 0) {
    return 0
  }

  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}
