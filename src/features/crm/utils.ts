type ContactNameLike = {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
}

type QuoteTimestampLike = {
  createdAt?: string | null
  updatedAt?: string | null
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

export function resolveQuoteAgeDays(quote: QuoteTimestampLike) {
  const rawTimestamp = String(quote.createdAt || quote.updatedAt || '')
  const timestamp = new Date(rawTimestamp)

  if (Number.isNaN(timestamp.getTime())) {
    return 0
  }

  const diffMs = Date.now() - timestamp.getTime()

  if (diffMs <= 0) {
    return 0
  }

  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}
