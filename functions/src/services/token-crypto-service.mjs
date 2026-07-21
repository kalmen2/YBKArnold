// AES-256-GCM helpers for third-party OAuth tokens stored in Mongo
// (email_oauth_connections and related records). Every module that reads or
// writes those records must use this service so stored payloads stay mutually
// decryptable: the payload format is base64(iv).base64(authTag).base64(cipher)
// and the key is SHA-256 of the shared encryption secret.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { AppError } from '../utils/app-error.mjs'
import { normalizeText } from '../utils/value-utils.mjs'

let cachedEncryptionSecret = ''
let cachedEncryptionKey = null

export function resolveTokenEncryptionSecret() {
  return normalizeText(
    process.env.TRIMBLE_TOKEN_ENCRYPTION_KEY
      || process.env.EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY
      || process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY,
    4000,
  )
}

export function createTokenCryptoService({ missingSecretContext = '' } = {}) {
  const missingSecretMessage = missingSecretContext
    ? `Missing EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY (or GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY) for ${missingSecretContext}.`
    : 'Missing EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY (or GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY).'

  function getTokenEncryptionKey() {
    const encryptionSecret = resolveTokenEncryptionSecret()

    if (!encryptionSecret) {
      throw new AppError(missingSecretMessage, 500)
    }

    if (cachedEncryptionKey && cachedEncryptionSecret === encryptionSecret) {
      return cachedEncryptionKey
    }

    cachedEncryptionSecret = encryptionSecret
    cachedEncryptionKey = createHash('sha256').update(encryptionSecret).digest()

    return cachedEncryptionKey
  }

  function encryptSecret(value) {
    const normalizedValue = String(value ?? '').trim()

    if (!normalizedValue) {
      return null
    }

    const key = getTokenEncryptionKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(normalizedValue, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`
  }

  function decryptSecret(value) {
    const normalizedValue = String(value ?? '').trim()

    if (!normalizedValue) {
      return null
    }

    const [ivPart = '', authTagPart = '', encryptedPart = ''] = normalizedValue.split('.')

    if (!ivPart || !authTagPart || !encryptedPart) {
      throw new Error('Stored token payload is malformed.')
    }

    const key = getTokenEncryptionKey()
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivPart, 'base64'),
    )

    decipher.setAuthTag(Buffer.from(authTagPart, 'base64'))

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  return {
    decryptSecret,
    encryptSecret,
    getTokenEncryptionKey,
  }
}
