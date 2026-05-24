import { createHash, randomBytes } from 'node:crypto'

export function createApiKeyService({
  apiKeyPepper,
}) {
  const normalizedPepper = String(apiKeyPepper ?? '').trim()

  function normalizeApiKeyValue(input) {
    if (Array.isArray(input)) {
      return normalizeApiKeyValue(input[0])
    }

    return String(input ?? '').trim()
  }

  function hashApiKeyValue(input) {
    const apiKeyValue = normalizeApiKeyValue(input)

    if (!apiKeyValue) {
      return ''
    }

    return createHash('sha256')
      .update(`arnold-api-key:${normalizedPepper}:${apiKeyValue}`)
      .digest('hex')
  }

  function generateApiKeyValue() {
    return `ak_${randomBytes(32).toString('hex')}`
  }

  function buildApiKeyPreview(input) {
    const apiKeyValue = normalizeApiKeyValue(input)

    if (!apiKeyValue) {
      return ''
    }

    if (apiKeyValue.length <= 12) {
      return apiKeyValue
    }

    return `${apiKeyValue.slice(0, 8)}...${apiKeyValue.slice(-4)}`
  }

  return {
    buildApiKeyPreview,
    generateApiKeyValue,
    hashApiKeyValue,
    normalizeApiKeyValue,
  }
}
