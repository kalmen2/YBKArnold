import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  isExpiredAt,
  normalizeText,
  nowIso,
} from '../utils/value-utils.mjs'

const googleAuthorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
const googleTokenUrl = 'https://oauth2.googleapis.com/token'
const googleUserInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo'
const googleGmailSendUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const googleGmailSendAsListUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs'
const googleProviderId = 'google'
const microsoftProviderId = 'microsoft'
const microsoftGraphApiBaseUrl = 'https://graph.microsoft.com/v1.0'
const googleOauthStateTtlMs = 10 * 60 * 1000
const googleAccessTokenRefreshSkewMs = 2 * 60 * 1000
const googleSendAsRefreshSkewMs = 30 * 60 * 1000
const microsoftAccessTokenRefreshSkewMs = 2 * 60 * 1000
const googleRequiredScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
]
const microsoftRequiredScopes = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.Send',
]
const googleScopesDefault = googleRequiredScopes.join(' ')
const microsoftScopesDefault = microsoftRequiredScopes.join(' ')
const googleDefaultRedirectPath = '/admin/settings?tab=email'

let cachedEncryptionSecret = ''
let cachedEncryptionKey = null

function resolveTokenEncryptionSecret() {
  return normalizeText(
    process.env.EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY,
    4000,
  )
}

function splitHeaderValue(value, maxLength = 320) {
  const normalized = normalizeText(value, maxLength)

  if (!normalized) {
    return ''
  }

  return normalized.split(',')[0].trim()
}

function resolveRequestHost(req) {
  return splitHeaderValue(req.headers?.['x-forwarded-host'], 320)
    || normalizeText(req.get('host'), 320)
}

function resolveRequestProtocol(req) {
  return splitHeaderValue(req.headers?.['x-forwarded-proto'], 40)
    || normalizeText(req.protocol, 20)
    || 'https'
}

function sanitizeRedirectPath(value) {
  const trimmed = normalizeText(value, 220)

  if (!trimmed.startsWith('/')) {
    return googleDefaultRedirectPath
  }

  if (trimmed.startsWith('//')) {
    return googleDefaultRedirectPath
  }

  return trimmed
}

function normalizeGoogleScopes(rawScopes) {
  const scopeSource = normalizeText(rawScopes, 1500)
  const requestedScopes = scopeSource
    ? scopeSource
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    : []
  const normalizedScopes = [...new Set([
    ...googleRequiredScopes,
    ...requestedScopes,
  ])]

  return normalizedScopes.join(' ')
}

function resolveGoogleRedirectUri(req) {
  const configuredRedirectUri = normalizeText(process.env.GOOGLE_REDIRECT_URI, 1000)

  if (configuredRedirectUri) {
    return configuredRedirectUri
  }

  const host = resolveRequestHost(req)

  if (!host) {
    throw {
      status: 500,
      message: 'Unable to resolve Google redirect URI host.',
    }
  }

  const protocol = resolveRequestProtocol(req)

  return `${protocol}://${host}/auth/google/callback`
}

function getGoogleConfig(req) {
  const clientId = normalizeText(
    process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID,
    320,
  )
  const clientSecret = normalizeText(
    process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET,
    320,
  )

  if (!clientId || !clientSecret) {
    throw {
      status: 500,
      message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    }
  }

  return {
    clientId,
    clientSecret,
    redirectUri: resolveGoogleRedirectUri(req),
    scopes: normalizeGoogleScopes(process.env.GOOGLE_OAUTH_SCOPES),
  }
}

function normalizeMicrosoftScopes(rawScopes) {
  const scopeSource = normalizeText(rawScopes, 1500)
  const requestedScopes = scopeSource
    ? scopeSource
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    : []
  const normalizedScopes = [...new Set([
    ...microsoftRequiredScopes,
    ...requestedScopes,
  ])]

  return normalizedScopes.join(' ')
}

function resolveMicrosoftTenantId() {
  return normalizeText(process.env.MICROSOFT_TENANT_ID, 200)
    || normalizeText(process.env.OUTLOOK_TENANT_ID, 200)
    || 'common'
}

function resolveMicrosoftRedirectUri(req) {
  const configuredRedirectUri = normalizeText(
    process.env.MICROSOFT_REDIRECT_URI || process.env.OUTLOOK_REDIRECT_URI,
    1000,
  )

  if (configuredRedirectUri) {
    return configuredRedirectUri
  }

  const host = resolveRequestHost(req)

  if (!host) {
    throw {
      status: 500,
      message: 'Unable to resolve Microsoft redirect URI host.',
    }
  }

  const protocol = resolveRequestProtocol(req)

  return `${protocol}://${host}/auth/microsoft/callback`
}

function getMicrosoftConfig(req) {
  const clientId = normalizeText(
    process.env.MICROSOFT_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID,
    320,
  )
  const clientSecret = normalizeText(
    process.env.MICROSOFT_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET,
    320,
  )

  if (!clientId || !clientSecret) {
    throw {
      status: 500,
      message: 'Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.',
    }
  }

  const tenantId = resolveMicrosoftTenantId()

  return {
    clientId,
    clientSecret,
    tenantId,
    redirectUri: resolveMicrosoftRedirectUri(req),
    scopes: normalizeMicrosoftScopes(process.env.MICROSOFT_OAUTH_SCOPES || process.env.OUTLOOK_OAUTH_SCOPES),
    authorizeUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  }
}

function getTokenEncryptionKey() {
  const encryptionSecret = resolveTokenEncryptionSecret()

  if (!encryptionSecret) {
    throw {
      status: 500,
      message: 'Missing EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY (or GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY) for email token encryption.',
    }
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

function isStaleState(createdAtIso) {
  const createdAtMs = Date.parse(normalizeText(createdAtIso, 80))

  if (!Number.isFinite(createdAtMs)) {
    return true
  }

  return Date.now() - createdAtMs > googleOauthStateTtlMs
}

function toEmailCallbackHtml({
  provider,
  providerTitle,
  redirectPath,
  status,
  message,
}) {
  const normalizedPath = sanitizeRedirectPath(redirectPath)
  const separator = normalizedPath.includes('?') ? '&' : '?'
  const redirectLocation = `${normalizedPath}${separator}${encodeURIComponent(provider)}=${encodeURIComponent(status)}&${encodeURIComponent(provider)}Message=${encodeURIComponent(message)}`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Connection</title>
    <meta http-equiv="refresh" content="0;url=${redirectLocation}" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #0f172a; }
      .box { max-width: 560px; margin: 0 auto; border: 1px solid #dbe3ef; border-radius: 12px; padding: 16px; }
      .title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
      .message { color: #334155; margin-bottom: 12px; }
      a { color: #2563eb; text-decoration: none; }
    </style>
    <script>
      window.location.replace(${JSON.stringify(redirectLocation)})
    </script>
  </head>
  <body>
    <div class="box">
      <div class="title">${providerTitle} Connection</div>
      <div class="message">${message}</div>
      <a href="${redirectLocation}">Continue</a>
    </div>
  </body>
</html>`
}

function toGoogleCallbackHtml({
  redirectPath,
  status,
  message,
}) {
  return toEmailCallbackHtml({
    provider: googleProviderId,
    providerTitle: 'Google',
    redirectPath,
    status,
    message,
  })
}

function toMicrosoftCallbackHtml({
  redirectPath,
  status,
  message,
}) {
  return toEmailCallbackHtml({
    provider: microsoftProviderId,
    providerTitle: 'Microsoft',
    redirectPath,
    status,
    message,
  })
}

function normalizeEmailAddress(value, normalizeEmail) {
  const candidate = normalizeEmail
    ? normalizeEmail(value)
    : normalizeText(value, 320).toLowerCase()

  return normalizeText(candidate, 320).toLowerCase()
}

function normalizeEmailList(value, normalizeEmail, maxCount = 50) {
  const inputValues = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[\n,;]+/)

  const normalizedValues = inputValues
    .map((item) => normalizeEmailAddress(item, normalizeEmail))
    .filter(Boolean)

  return [...new Set(normalizedValues)].slice(0, maxCount)
}

function resolveGoogleErrorMessage(payload, fallbackMessage) {
  const topLevel = normalizeText(payload?.error_description, 500)

  if (topLevel) {
    return topLevel
  }

  const nestedMessage = normalizeText(payload?.error?.message, 500)

  if (nestedMessage) {
    return nestedMessage
  }

  const nestedError = normalizeText(payload?.error, 500)

  if (nestedError) {
    return nestedError
  }

  return fallbackMessage
}

function resolveMicrosoftErrorMessage(payload, fallbackMessage) {
  const topLevel = normalizeText(payload?.error_description, 500)

  if (topLevel) {
    return topLevel
  }

  const nestedDescription = normalizeText(payload?.error?.error_description, 500)

  if (nestedDescription) {
    return nestedDescription
  }

  const nestedMessage = normalizeText(payload?.error?.message, 500)

  if (nestedMessage) {
    return nestedMessage
  }

  const nestedCode = normalizeText(payload?.error?.code, 200)

  if (nestedCode) {
    return nestedCode
  }

  const nestedError = normalizeText(payload?.error, 500)

  if (nestedError) {
    return nestedError
  }

  return fallbackMessage
}

function parseScopeSet(scopeValue) {
  return new Set(
    String(scopeValue ?? '')
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function getMissingGoogleScopes(scopeValue) {
  const grantedScopes = parseScopeSet(scopeValue)

  return googleRequiredScopes.filter((scope) => !grantedScopes.has(scope))
}

function getMissingMicrosoftScopes(scopeValue) {
  const grantedScopes = parseScopeSet(scopeValue)

  return microsoftRequiredScopes.filter((scope) => !grantedScopes.has(scope))
}

function normalizeSendAsAliasEntry(rawAlias, normalizeEmail) {
  const sendAsEmail = normalizeEmailAddress(rawAlias?.sendAsEmail, normalizeEmail)

  if (!sendAsEmail) {
    return null
  }

  const verificationStatus = normalizeText(rawAlias?.verificationStatus, 80).toLowerCase() || null

  return {
    sendAsEmail,
    displayName: normalizeText(rawAlias?.displayName, 240) || null,
    replyToAddress: normalizeEmailAddress(rawAlias?.replyToAddress, normalizeEmail) || null,
    isPrimary: Boolean(rawAlias?.isPrimary),
    isDefault: Boolean(rawAlias?.isDefault),
    treatAsAlias: Boolean(rawAlias?.treatAsAlias),
    verificationStatus,
    isVerified: verificationStatus === 'accepted' || verificationStatus === null,
  }
}

function normalizeSendAsAliases(rawAliases, normalizeEmail, fallbackEmail) {
  const aliases = (Array.isArray(rawAliases) ? rawAliases : [])
    .map((item) => normalizeSendAsAliasEntry(item, normalizeEmail))
    .filter(Boolean)
  const fallback = normalizeEmailAddress(fallbackEmail, normalizeEmail)

  if (fallback && !aliases.some((item) => item.sendAsEmail === fallback)) {
    aliases.push({
      sendAsEmail: fallback,
      displayName: null,
      replyToAddress: null,
      isPrimary: true,
      isDefault: true,
      treatAsAlias: false,
      verificationStatus: null,
      isVerified: true,
    })
  }

  const deduped = []
  const seen = new Set()

  for (const alias of aliases) {
    if (seen.has(alias.sendAsEmail)) {
      continue
    }

    seen.add(alias.sendAsEmail)
    deduped.push(alias)
  }

  deduped.sort((left, right) => {
    const leftWeight = Number(Boolean(left.isDefault)) * 2 + Number(Boolean(left.isPrimary))
    const rightWeight = Number(Boolean(right.isDefault)) * 2 + Number(Boolean(right.isPrimary))

    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight
    }

    return left.sendAsEmail.localeCompare(right.sendAsEmail)
  })

  return deduped.slice(0, 100)
}

function resolveSelectedFromEmail({
  requestedFromEmail,
  connection,
  normalizeEmail,
}) {
  const connectedEmail = normalizeEmailAddress(connection?.connectedEmail, normalizeEmail)
  const sendAsAliases = normalizeSendAsAliases(
    connection?.sendAsAliases,
    normalizeEmail,
    connectedEmail,
  )
  const verifiedAliases = sendAsAliases.filter((alias) => alias.isVerified)
  const allowedAliases = verifiedAliases.length > 0 ? verifiedAliases : sendAsAliases
  const allowedEmails = new Set(allowedAliases.map((alias) => alias.sendAsEmail))

  if (requestedFromEmail) {
    const normalizedRequestedFromEmail = normalizeEmailAddress(requestedFromEmail, normalizeEmail)

    if (!allowedEmails.has(normalizedRequestedFromEmail)) {
      throw {
        status: 400,
        message: 'Selected sender is not available in Gmail Send As aliases for this account.',
      }
    }

    return normalizedRequestedFromEmail
  }

  const defaultAlias = allowedAliases.find((alias) => alias.isDefault)
    || allowedAliases.find((alias) => alias.isPrimary)
    || allowedAliases[0]

  if (defaultAlias?.sendAsEmail) {
    return defaultAlias.sendAsEmail
  }

  if (connectedEmail) {
    return connectedEmail
  }

  throw {
    status: 409,
    message: 'Connected Gmail account is missing a usable sender address. Reconnect Gmail.',
  }
}

async function exchangeGoogleToken({
  clientId,
  clientSecret,
  grantType,
  code,
  redirectUri,
  refreshToken,
}) {
  const formData = new URLSearchParams()

  formData.set('client_id', clientId)
  formData.set('client_secret', clientSecret)
  formData.set('grant_type', grantType)

  if (grantType === 'authorization_code') {
    formData.set('code', normalizeText(code, 1600))
    formData.set('redirect_uri', normalizeText(redirectUri, 1000))
  } else {
    formData.set('refresh_token', normalizeText(refreshToken, 8000))
  }

  const response = await fetch(googleTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Google token request failed: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return payload
}

function mapGoogleTokenPayload(payload, existingRefreshToken) {
  const accessToken = normalizeText(payload?.access_token, 8000)
  const refreshToken = normalizeText(payload?.refresh_token, 8000) || existingRefreshToken || null
  const expiresInSeconds = Number(payload?.expires_in)

  if (!accessToken) {
    throw {
      status: 502,
      message: 'Google token response did not include an access token.',
    }
  }

  if (!refreshToken) {
    throw {
      status: 502,
      message: 'Google token response did not include a refresh token. Reconnect and grant consent again.',
    }
  }

  return {
    accessToken,
    refreshToken,
    tokenType: normalizeText(payload?.token_type, 50) || 'Bearer',
    scope: normalizeText(payload?.scope, 1500) || null,
    accessTokenExpiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null,
  }
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(googleUserInfoUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Could not fetch Google profile: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  const email = normalizeText(payload?.email, 320).toLowerCase()

  if (!email) {
    throw {
      status: 502,
      message: 'Google profile did not include an email address.',
    }
  }

  return {
    email,
    name: normalizeText(payload?.name, 240) || null,
    pictureUrl: normalizeText(payload?.picture, 1200) || null,
  }
}

async function sendGoogleRawEmail({
  accessToken,
  raw,
}) {
  const response = await fetch(googleGmailSendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ raw }),
  })

  const responseText = await response.text().catch(() => '')
  let payload = {}

  if (responseText) {
    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = {}
    }
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message: `Gmail send failed: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return payload
}

async function fetchGoogleSendAsAliases(accessToken) {
  const response = await fetch(googleGmailSendAsListUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Could not fetch Gmail Send As aliases: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return Array.isArray(payload?.sendAs) ? payload.sendAs : []
}

function buildGmailRawMessage({
  fromEmail,
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody,
}) {
  const normalizedSubject = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  const normalizedText = String(textBody ?? '').replace(/\r\n/g, '\n')
  const normalizedHtml = String(htmlBody ?? '').replace(/\r\n/g, '\n')

  const headers = [
    `From: ${fromEmail}`,
    `To: ${to.join(', ')}`,
    'MIME-Version: 1.0',
    `Subject: ${normalizedSubject}`,
  ]

  if (cc.length > 0) {
    headers.push(`Cc: ${cc.join(', ')}`)
  }

  if (bcc.length > 0) {
    headers.push(`Bcc: ${bcc.join(', ')}`)
  }

  let mimeBody = ''

  if (normalizedHtml) {
    const boundary = `arnold_${randomBytes(10).toString('hex')}`

    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

    mimeBody = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      normalizedText || ' ',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      normalizedHtml,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n')
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"')

    mimeBody = `${normalizedText || ' '}\r\n`
  }

  const mimeMessage = `${headers.join('\r\n')}\r\n\r\n${mimeBody}`

  return Buffer
    .from(mimeMessage, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function mapEmailRecipients(recipients) {
  return recipients.map((address) => ({
    emailAddress: {
      address,
    },
  }))
}

async function exchangeMicrosoftToken({
  microsoftConfig,
  grantType,
  code,
  refreshToken,
}) {
  const formData = new URLSearchParams()

  formData.set('client_id', microsoftConfig.clientId)
  formData.set('client_secret', microsoftConfig.clientSecret)
  formData.set('grant_type', grantType)
  formData.set('redirect_uri', microsoftConfig.redirectUri)
  formData.set('scope', microsoftConfig.scopes)

  if (grantType === 'authorization_code') {
    formData.set('code', normalizeText(code, 1800))
  } else {
    formData.set('refresh_token', normalizeText(refreshToken, 8000))
  }

  const response = await fetch(microsoftConfig.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Microsoft token request failed: ${resolveMicrosoftErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return payload
}

function mapMicrosoftTokenPayload(payload, existingRefreshToken) {
  const accessToken = normalizeText(payload?.access_token, 8000)
  const refreshToken = normalizeText(payload?.refresh_token, 8000) || existingRefreshToken || null
  const expiresInSeconds = Number(payload?.expires_in)

  if (!accessToken) {
    throw {
      status: 502,
      message: 'Microsoft token response did not include an access token.',
    }
  }

  if (!refreshToken) {
    throw {
      status: 502,
      message: 'Microsoft token response did not include a refresh token. Reconnect Microsoft account and grant consent again.',
    }
  }

  return {
    accessToken,
    refreshToken,
    tokenType: normalizeText(payload?.token_type, 50) || 'Bearer',
    scope: normalizeText(payload?.scope, 1500) || null,
    accessTokenExpiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null,
  }
}

async function fetchMicrosoftProfile(accessToken) {
  const response = await fetch(`${microsoftGraphApiBaseUrl}/me?$select=id,displayName,mail,userPrincipalName`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: 502,
      message: `Could not fetch Microsoft profile: ${resolveMicrosoftErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  const email = normalizeText(payload?.mail, 320).toLowerCase()
    || normalizeText(payload?.userPrincipalName, 320).toLowerCase()

  if (!email) {
    throw {
      status: 502,
      message: 'Microsoft profile did not include a usable email address.',
    }
  }

  return {
    id: normalizeText(payload?.id, 200) || null,
    email,
    userPrincipalName: normalizeText(payload?.userPrincipalName, 320).toLowerCase() || null,
    name: normalizeText(payload?.displayName, 240) || null,
  }
}

function normalizeMicrosoftSendAsAliases(profile, normalizeEmail) {
  const connectedEmail = normalizeEmailAddress(profile?.email, normalizeEmail)

  if (!connectedEmail) {
    return []
  }

  return [{
    sendAsEmail: connectedEmail,
    displayName: normalizeText(profile?.name, 240) || null,
    replyToAddress: null,
    isPrimary: true,
    isDefault: true,
    treatAsAlias: false,
    verificationStatus: 'accepted',
    isVerified: true,
  }]
}

function resolveSelectedFromMicrosoftEmail({
  requestedFromEmail,
  connection,
  normalizeEmail,
}) {
  const connectedEmail = normalizeEmailAddress(connection?.connectedEmail, normalizeEmail)

  if (!connectedEmail) {
    throw {
      status: 409,
      message: 'Connected Microsoft account is missing a sender email. Reconnect Microsoft account.',
    }
  }

  if (!requestedFromEmail) {
    return connectedEmail
  }

  const normalizedRequestedFromEmail = normalizeEmailAddress(requestedFromEmail, normalizeEmail)

  if (normalizedRequestedFromEmail !== connectedEmail) {
    throw {
      status: 400,
      message: 'Selected sender must match the connected Microsoft mailbox.',
    }
  }

  return normalizedRequestedFromEmail
}

function buildMicrosoftSendMailPayload({
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody,
}) {
  const normalizedSubject = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  const normalizedText = String(textBody ?? '').replace(/\r\n/g, '\n')
  const normalizedHtml = String(htmlBody ?? '').replace(/\r\n/g, '\n')
  const bodyContent = normalizedHtml || normalizedText || ' '

  const payload = {
    message: {
      subject: normalizedSubject,
      body: {
        contentType: normalizedHtml ? 'HTML' : 'Text',
        content: bodyContent,
      },
      toRecipients: mapEmailRecipients(to),
    },
    saveToSentItems: true,
  }

  if (cc.length > 0) {
    payload.message.ccRecipients = mapEmailRecipients(cc)
  }

  if (bcc.length > 0) {
    payload.message.bccRecipients = mapEmailRecipients(bcc)
  }

  return payload
}

async function sendMicrosoftMail({
  accessToken,
  payload,
}) {
  const response = await fetch(`${microsoftGraphApiBaseUrl}/me/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 202 || response.status === 200) {
    return { ok: true }
  }

  const responseText = await response.text().catch(() => '')
  let responsePayload = {}

  if (responseText) {
    try {
      responsePayload = JSON.parse(responseText)
    } catch {
      responsePayload = {}
    }
  }

  throw {
    status: response.status,
    message: `Microsoft send failed: ${resolveMicrosoftErrorMessage(responsePayload, `status ${response.status}`)}`,
  }
}

export function registerEmailRoutes(app, deps) {
  const {
    getCollections,
    normalizeEmail,
    randomUUID,
    requireFirebaseAuth,
    toPublicAuthUser,
  } = deps

  async function getGoogleCollections() {
    const {
      emailConnectionsCollection,
      emailOauthStatesCollection,
    } = await getCollections()

    return {
      emailConnectionsCollection,
      emailOauthStatesCollection,
    }
  }

  function resolveConnectionUpdateFilter(connection) {
    const connectionId = normalizeText(connection?.id, 200)
    const provider = normalizeText(connection?.provider, 40) || googleProviderId

    if (connectionId) {
      return { id: connectionId }
    }

    return {
      provider,
      uid: normalizeText(connection?.uid, 200),
    }
  }

  async function refreshGoogleAccessToken({
    emailConnectionsCollection,
    connection,
    googleConfig,
  }) {
    const refreshToken = decryptSecret(connection?.refreshTokenEncrypted)

    if (!refreshToken) {
      throw {
        status: 409,
        message: 'Google account is missing a refresh token. Reconnect Gmail to continue.',
      }
    }

    const refreshPayload = await exchangeGoogleToken({
      clientId: googleConfig.clientId,
      clientSecret: googleConfig.clientSecret,
      grantType: 'refresh_token',
      refreshToken,
    })
    const normalizedToken = mapGoogleTokenPayload(refreshPayload, refreshToken)
    const now = nowIso()
    const accessTokenEncrypted = encryptSecret(normalizedToken.accessToken)
    const refreshTokenEncrypted = encryptSecret(normalizedToken.refreshToken)

    await emailConnectionsCollection.updateOne(
      resolveConnectionUpdateFilter(connection),
      {
        $set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
          tokenType: normalizedToken.tokenType,
          scope: normalizedToken.scope || connection.scope || null,
          updatedAt: now,
          lastRefreshAt: now,
        },
      },
    )

    return {
      ...connection,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
      tokenType: normalizedToken.tokenType,
      scope: normalizedToken.scope || connection.scope || null,
      updatedAt: now,
      lastRefreshAt: now,
    }
  }

  async function resolveGoogleAccessToken({
    emailConnectionsCollection,
    connection,
    googleConfig,
    forceRefresh = false,
  }) {
    if (!connection) {
      throw {
        status: 404,
        message: 'No Gmail account is connected for this user yet.',
      }
    }

    const shouldRefresh = forceRefresh
      || isExpiredAt(connection.accessTokenExpiresAt, googleAccessTokenRefreshSkewMs)
      || !connection.accessTokenEncrypted

    if (!shouldRefresh) {
      const accessToken = decryptSecret(connection.accessTokenEncrypted)

      if (accessToken) {
        return {
          connection,
          accessToken,
        }
      }
    }

    const refreshedConnection = await refreshGoogleAccessToken({
      emailConnectionsCollection,
      connection,
      googleConfig,
    })

    return {
      connection: refreshedConnection,
      accessToken: decryptSecret(refreshedConnection.accessTokenEncrypted),
    }
  }

  async function refreshMicrosoftAccessToken({
    emailConnectionsCollection,
    connection,
    microsoftConfig,
  }) {
    const refreshToken = decryptSecret(connection?.refreshTokenEncrypted)

    if (!refreshToken) {
      throw {
        status: 409,
        message: 'Microsoft account is missing a refresh token. Reconnect Microsoft account to continue.',
      }
    }

    const refreshPayload = await exchangeMicrosoftToken({
      microsoftConfig,
      grantType: 'refresh_token',
      refreshToken,
    })
    const normalizedToken = mapMicrosoftTokenPayload(refreshPayload, refreshToken)
    const now = nowIso()
    const accessTokenEncrypted = encryptSecret(normalizedToken.accessToken)
    const refreshTokenEncrypted = encryptSecret(normalizedToken.refreshToken)

    await emailConnectionsCollection.updateOne(
      resolveConnectionUpdateFilter(connection),
      {
        $set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
          tokenType: normalizedToken.tokenType,
          scope: normalizedToken.scope || connection.scope || null,
          updatedAt: now,
          lastRefreshAt: now,
        },
      },
    )

    return {
      ...connection,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
      tokenType: normalizedToken.tokenType,
      scope: normalizedToken.scope || connection.scope || null,
      updatedAt: now,
      lastRefreshAt: now,
    }
  }

  async function resolveMicrosoftAccessToken({
    emailConnectionsCollection,
    connection,
    microsoftConfig,
    forceRefresh = false,
  }) {
    if (!connection) {
      throw {
        status: 404,
        message: 'No Microsoft account is connected for this user yet.',
      }
    }

    const shouldRefresh = forceRefresh
      || isExpiredAt(connection.accessTokenExpiresAt, microsoftAccessTokenRefreshSkewMs)
      || !connection.accessTokenEncrypted

    if (!shouldRefresh) {
      const accessToken = decryptSecret(connection.accessTokenEncrypted)

      if (accessToken) {
        return {
          connection,
          accessToken,
        }
      }
    }

    const refreshedConnection = await refreshMicrosoftAccessToken({
      emailConnectionsCollection,
      connection,
      microsoftConfig,
    })

    return {
      connection: refreshedConnection,
      accessToken: decryptSecret(refreshedConnection.accessTokenEncrypted),
    }
  }

  async function syncGoogleSendAsAliases({
    emailConnectionsCollection,
    connection,
    accessToken,
  }) {
    const sendAsAliasesRaw = await fetchGoogleSendAsAliases(accessToken)
    const sendAsAliases = normalizeSendAsAliases(
      sendAsAliasesRaw,
      normalizeEmail,
      connection?.connectedEmail,
    )
    const now = nowIso()

    await emailConnectionsCollection.updateOne(
      resolveConnectionUpdateFilter(connection),
      {
        $set: {
          sendAsAliases,
          sendAsSyncedAt: now,
          sendAsSyncError: null,
          sendAsSyncErrorAt: null,
          updatedAt: now,
        },
      },
    )

    return {
      sendAsAliases,
      sendAsSyncedAt: now,
    }
  }

  app.get('/api/admin/email/google/status', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { emailConnectionsCollection } = await getGoogleCollections()
      const connection = await emailConnectionsCollection.findOne(
        {
          provider: googleProviderId,
          uid: normalizeText(req.authUser?.uid, 200),
        },
        {
          projection: {
            _id: 0,
            accessTokenEncrypted: 0,
            refreshTokenEncrypted: 0,
          },
        },
      )

      const hasOauthConfig = Boolean(
        normalizeText(process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID, 320)
        && normalizeText(process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET, 320)
        && resolveTokenEncryptionSecret(),
      )
      const configuredScopes = normalizeGoogleScopes(process.env.GOOGLE_OAUTH_SCOPES)
      const configuredMissingScopes = getMissingGoogleScopes(configuredScopes)

      if (!connection) {
        return res.json({
          isConfigured: hasOauthConfig,
          oauthConfigHasRequiredScopes: configuredMissingScopes.length === 0,
          oauthConfigMissingScopes: configuredMissingScopes,
          connected: false,
          sendAsAliases: [],
        })
      }

      const sendAsAliases = normalizeSendAsAliases(
        connection.sendAsAliases,
        normalizeEmail,
        connection.connectedEmail,
      )
      const grantedMissingScopes = getMissingGoogleScopes(connection.scope)

      return res.json({
        isConfigured: hasOauthConfig,
        oauthConfigHasRequiredScopes: configuredMissingScopes.length === 0,
        oauthConfigMissingScopes: configuredMissingScopes,
        connected: true,
        provider: connection.provider,
        connectedEmail: normalizeText(connection.connectedEmail, 320) || null,
        connectedDisplayName: normalizeText(connection.connectedDisplayName, 240) || null,
        scope: normalizeText(connection.scope, 1500) || null,
        grantedHasRequiredScopes: grantedMissingScopes.length === 0,
        grantedMissingScopes,
        sendAsAliases,
        sendAsSyncedAt: normalizeText(connection.sendAsSyncedAt, 80) || null,
        sendAsSyncError: normalizeText(connection.sendAsSyncError, 900) || null,
        connectedAt: normalizeText(connection.connectedAt, 80) || null,
        updatedAt: normalizeText(connection.updatedAt, 80) || null,
        accessTokenExpiresAt: normalizeText(connection.accessTokenExpiresAt, 80) || null,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/google/oauth/start', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const googleConfig = getGoogleConfig(req)
      const { emailOauthStatesCollection } = await getGoogleCollections()
      const now = nowIso()
      const cutoffIso = new Date(Date.now() - googleOauthStateTtlMs).toISOString()
      const stateId = randomUUID()
      const redirectPath = sanitizeRedirectPath(req.query?.redirectPath || googleDefaultRedirectPath)

      await emailOauthStatesCollection.deleteMany({
        createdAt: {
          $lt: cutoffIso,
        },
      })

      await emailOauthStatesCollection.insertOne({
        id: stateId,
        provider: googleProviderId,
        redirectPath,
        requestedByUid: normalizeText(req.authUser?.uid, 200) || null,
        requestedByEmail: normalizeText(req.authUser?.email, 320).toLowerCase() || null,
        createdAt: now,
      })

      const authorizeUrl = new URL(googleAuthorizeUrl)
      authorizeUrl.searchParams.set('client_id', googleConfig.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', googleConfig.redirectUri)
      authorizeUrl.searchParams.set('scope', googleConfig.scopes)
      authorizeUrl.searchParams.set('access_type', 'offline')
      authorizeUrl.searchParams.set('include_granted_scopes', 'true')
      authorizeUrl.searchParams.set('prompt', 'consent')
      authorizeUrl.searchParams.set('state', stateId)

      return res.json({
        authorizeUrl: authorizeUrl.toString(),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/auth/google/callback', async (req, res) => {
    let redirectPath = googleDefaultRedirectPath

    try {
      const googleConfig = getGoogleConfig(req)
      const stateId = normalizeText(req.query?.state, 220)
      const code = normalizeText(req.query?.code, 1800)
      const oauthError = normalizeText(req.query?.error, 140)
      const oauthErrorDescription = normalizeText(req.query?.error_description, 800)
      const {
        emailConnectionsCollection,
        emailOauthStatesCollection,
      } = await getGoogleCollections()
      const stateDoc = stateId
        ? await emailOauthStatesCollection.findOne({
          id: stateId,
          provider: googleProviderId,
        })
        : null

      redirectPath = sanitizeRedirectPath(stateDoc?.redirectPath || googleDefaultRedirectPath)

      if (stateDoc?.id) {
        await emailOauthStatesCollection.deleteOne({ id: stateDoc.id })
      }

      if (!stateDoc || isStaleState(stateDoc.createdAt)) {
        throw {
          status: 400,
          message: 'Google connection state expired. Please try again.',
        }
      }

      if (oauthError) {
        const message = oauthErrorDescription || `Google authorization failed: ${oauthError}`
        const html = toGoogleCallbackHtml({
          redirectPath,
          status: 'error',
          message,
        })

        return res.status(200).type('html').send(html)
      }

      if (!code) {
        throw {
          status: 400,
          message: 'Missing Google authorization code.',
        }
      }

      if (!stateDoc.requestedByUid) {
        throw {
          status: 400,
          message: 'Google connection state is missing user context.',
        }
      }

      const tokenPayload = await exchangeGoogleToken({
        clientId: googleConfig.clientId,
        clientSecret: googleConfig.clientSecret,
        grantType: 'authorization_code',
        code,
        redirectUri: googleConfig.redirectUri,
      })
      const normalizedToken = mapGoogleTokenPayload(tokenPayload, null)
      const profile = await fetchGoogleProfile(normalizedToken.accessToken)
      const now = nowIso()
      let sendAsAliases = normalizeSendAsAliases([], normalizeEmail, profile.email)
      let sendAsSyncedAt = null
      let sendAsSyncError = null

      try {
        const sendAsAliasesRaw = await fetchGoogleSendAsAliases(normalizedToken.accessToken)
        sendAsAliases = normalizeSendAsAliases(sendAsAliasesRaw, normalizeEmail, profile.email)
        sendAsSyncedAt = now
      } catch (sendAsError) {
        sendAsSyncError = normalizeText(sendAsError?.message, 900)
      }

      await emailConnectionsCollection.updateOne(
        {
          provider: googleProviderId,
          uid: normalizeText(stateDoc.requestedByUid, 200),
        },
        {
          $set: {
            provider: googleProviderId,
            uid: normalizeText(stateDoc.requestedByUid, 200),
            userEmailLower: normalizeText(stateDoc.requestedByEmail, 320).toLowerCase() || null,
            connectedEmail: profile.email,
            connectedEmailLower: profile.email,
            connectedDisplayName: profile.name,
            connectedPictureUrl: profile.pictureUrl,
            tokenType: normalizedToken.tokenType,
            scope: normalizedToken.scope || googleConfig.scopes,
            accessTokenEncrypted: encryptSecret(normalizedToken.accessToken),
            refreshTokenEncrypted: encryptSecret(normalizedToken.refreshToken),
            accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
            sendAsAliases,
            sendAsSyncedAt,
            sendAsSyncError,
            sendAsSyncErrorAt: sendAsSyncError ? now : null,
            connectedAt: now,
            updatedAt: now,
            connectedByUid: normalizeText(stateDoc.requestedByUid, 200),
            connectedByEmail: normalizeText(stateDoc.requestedByEmail, 320).toLowerCase() || null,
            lastErrorAt: null,
            lastErrorMessage: null,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      )

      const html = toGoogleCallbackHtml({
        redirectPath,
        status: 'connected',
        message: `Gmail connected successfully: ${profile.email}`,
      })

      return res.status(200).type('html').send(html)
    } catch (error) {
      const html = toGoogleCallbackHtml({
        redirectPath,
        status: 'error',
        message: normalizeText(error?.message, 900) || 'Google connection failed. Please try again.',
      })

      return res.status(200).type('html').send(html)
    }
  })

  app.post('/api/admin/email/google/disconnect', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { emailConnectionsCollection } = await getGoogleCollections()
      const result = await emailConnectionsCollection.deleteOne({
        provider: googleProviderId,
        uid: normalizeText(req.authUser?.uid, 200),
      })

      return res.json({
        ok: true,
        disconnected: result.deletedCount > 0,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/google/send', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const to = normalizeEmailList(req.body?.to, normalizeEmail, 60)
      const cc = normalizeEmailList(req.body?.cc, normalizeEmail, 30)
      const bcc = normalizeEmailList(req.body?.bcc, normalizeEmail, 30)
      const requestedFromEmail = normalizeEmailAddress(req.body?.fromEmail, normalizeEmail)
      const subject = normalizeText(req.body?.subject, 998)
      const textBody = String(req.body?.text ?? '').trim().slice(0, 30000)
      const htmlBody = String(req.body?.html ?? '').trim().slice(0, 150000)

      if (to.length === 0) {
        return res.status(400).json({
          error: 'At least one "to" recipient is required.',
        })
      }

      if (!textBody && !htmlBody) {
        return res.status(400).json({
          error: 'Message content is required (text or html).',
        })
      }

      const {
        emailConnectionsCollection,
      } = await getGoogleCollections()
      const connection = await emailConnectionsCollection.findOne(
        {
          provider: googleProviderId,
          uid: normalizeText(req.authUser?.uid, 200),
        },
      )

      if (!connection) {
        return res.status(404).json({
          error: 'No Gmail account is connected for this user yet.',
        })
      }

      const googleConfig = getGoogleConfig(req)
      let tokenResolution = await resolveGoogleAccessToken({
        emailConnectionsCollection,
        connection,
        googleConfig,
      })
      let activeConnection = tokenResolution.connection
      let sendAsAliases = normalizeSendAsAliases(
        activeConnection.sendAsAliases,
        normalizeEmail,
        activeConnection.connectedEmail,
      )
      const shouldRefreshSendAsAliases = sendAsAliases.length === 0
        || isExpiredAt(activeConnection.sendAsSyncedAt, googleSendAsRefreshSkewMs)

      if (shouldRefreshSendAsAliases) {
        try {
          const sendAsSyncResult = await syncGoogleSendAsAliases({
            emailConnectionsCollection,
            connection: activeConnection,
            accessToken: tokenResolution.accessToken,
          })

          sendAsAliases = sendAsSyncResult.sendAsAliases
          activeConnection = {
            ...activeConnection,
            sendAsAliases,
            sendAsSyncedAt: sendAsSyncResult.sendAsSyncedAt,
            sendAsSyncError: null,
            sendAsSyncErrorAt: null,
          }
        } catch (sendAsSyncError) {
          const now = nowIso()
          const sendAsSyncErrorMessage =
            normalizeText(sendAsSyncError?.message, 900)
            || 'Could not refresh Gmail Send As aliases.'

          await emailConnectionsCollection.updateOne(
            resolveConnectionUpdateFilter(activeConnection),
            {
              $set: {
                sendAsSyncError: sendAsSyncErrorMessage,
                sendAsSyncErrorAt: now,
                updatedAt: now,
              },
            },
          )

          activeConnection = {
            ...activeConnection,
            sendAsSyncError: sendAsSyncErrorMessage,
            sendAsSyncErrorAt: now,
          }
        }
      }

      const fromEmail = resolveSelectedFromEmail({
        requestedFromEmail,
        connection: {
          ...activeConnection,
          sendAsAliases,
        },
        normalizeEmail,
      })

      const rawMessage = buildGmailRawMessage({
        fromEmail,
        to,
        cc,
        bcc,
        subject,
        textBody,
        htmlBody,
      })
      let sendPayload = null

      try {
        sendPayload = await sendGoogleRawEmail({
          accessToken: tokenResolution.accessToken,
          raw: rawMessage,
        })
      } catch (sendError) {
        if (Number(sendError?.status) !== 401) {
          throw sendError
        }

        tokenResolution = await resolveGoogleAccessToken({
          emailConnectionsCollection,
          connection: activeConnection,
          googleConfig,
          forceRefresh: true,
        })
        activeConnection = tokenResolution.connection

        sendPayload = await sendGoogleRawEmail({
          accessToken: tokenResolution.accessToken,
          raw: rawMessage,
        })
      }

      const now = nowIso()

      await emailConnectionsCollection.updateOne(
        resolveConnectionUpdateFilter(activeConnection),
        {
          $set: {
            updatedAt: now,
            lastUsedAt: now,
            lastUsedFromEmail: fromEmail,
            lastErrorAt: null,
            lastErrorMessage: null,
          },
        },
      )

      return res.status(201).json({
        ok: true,
        provider: googleProviderId,
        connectedEmail: normalizeText(activeConnection.connectedEmail, 320) || fromEmail,
        fromEmail,
        messageId: normalizeText(sendPayload?.id, 200) || null,
        threadId: normalizeText(sendPayload?.threadId, 200) || null,
        sentAt: now,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/microsoft/status', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { emailConnectionsCollection } = await getGoogleCollections()
      const connection = await emailConnectionsCollection.findOne(
        {
          provider: microsoftProviderId,
          uid: normalizeText(req.authUser?.uid, 200),
        },
        {
          projection: {
            _id: 0,
            accessTokenEncrypted: 0,
            refreshTokenEncrypted: 0,
          },
        },
      )

      const hasOauthConfig = Boolean(
        normalizeText(process.env.MICROSOFT_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID, 320)
        && normalizeText(process.env.MICROSOFT_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET, 320)
        && resolveTokenEncryptionSecret(),
      )
      const configuredScopes = normalizeMicrosoftScopes(process.env.MICROSOFT_OAUTH_SCOPES || process.env.OUTLOOK_OAUTH_SCOPES)
      const configuredMissingScopes = getMissingMicrosoftScopes(configuredScopes)

      if (!connection) {
        return res.json({
          isConfigured: hasOauthConfig,
          oauthConfigHasRequiredScopes: configuredMissingScopes.length === 0,
          oauthConfigMissingScopes: configuredMissingScopes,
          connected: false,
          sendAsAliases: [],
        })
      }

      const sendAsAliases = normalizeSendAsAliases(
        connection.sendAsAliases,
        normalizeEmail,
        connection.connectedEmail,
      )
      const grantedMissingScopes = getMissingMicrosoftScopes(connection.scope)

      return res.json({
        isConfigured: hasOauthConfig,
        oauthConfigHasRequiredScopes: configuredMissingScopes.length === 0,
        oauthConfigMissingScopes: configuredMissingScopes,
        connected: true,
        provider: connection.provider,
        connectedEmail: normalizeText(connection.connectedEmail, 320) || null,
        connectedDisplayName: normalizeText(connection.connectedDisplayName, 240) || null,
        scope: normalizeText(connection.scope, 1500) || null,
        grantedHasRequiredScopes: grantedMissingScopes.length === 0,
        grantedMissingScopes,
        sendAsAliases,
        sendAsSyncedAt: normalizeText(connection.sendAsSyncedAt, 80) || null,
        sendAsSyncError: normalizeText(connection.sendAsSyncError, 900) || null,
        connectedAt: normalizeText(connection.connectedAt, 80) || null,
        updatedAt: normalizeText(connection.updatedAt, 80) || null,
        accessTokenExpiresAt: normalizeText(connection.accessTokenExpiresAt, 80) || null,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/microsoft/oauth/start', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const microsoftConfig = getMicrosoftConfig(req)
      const { emailOauthStatesCollection } = await getGoogleCollections()
      const now = nowIso()
      const cutoffIso = new Date(Date.now() - googleOauthStateTtlMs).toISOString()
      const stateId = randomUUID()
      const redirectPath = sanitizeRedirectPath(req.query?.redirectPath || googleDefaultRedirectPath)

      await emailOauthStatesCollection.deleteMany({
        createdAt: {
          $lt: cutoffIso,
        },
      })

      await emailOauthStatesCollection.insertOne({
        id: stateId,
        provider: microsoftProviderId,
        redirectPath,
        requestedByUid: normalizeText(req.authUser?.uid, 200) || null,
        requestedByEmail: normalizeText(req.authUser?.email, 320).toLowerCase() || null,
        createdAt: now,
      })

      const authorizeUrl = new URL(microsoftConfig.authorizeUrl)
      authorizeUrl.searchParams.set('client_id', microsoftConfig.clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', microsoftConfig.redirectUri)
      authorizeUrl.searchParams.set('response_mode', 'query')
      authorizeUrl.searchParams.set('scope', microsoftConfig.scopes)
      authorizeUrl.searchParams.set('prompt', 'consent')
      authorizeUrl.searchParams.set('state', stateId)

      return res.json({
        authorizeUrl: authorizeUrl.toString(),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/auth/microsoft/callback', async (req, res) => {
    let redirectPath = googleDefaultRedirectPath

    try {
      const microsoftConfig = getMicrosoftConfig(req)
      const stateId = normalizeText(req.query?.state, 220)
      const code = normalizeText(req.query?.code, 1800)
      const oauthError = normalizeText(req.query?.error, 140)
      const oauthErrorDescription = normalizeText(req.query?.error_description, 800)
      const {
        emailConnectionsCollection,
        emailOauthStatesCollection,
      } = await getGoogleCollections()
      const stateDoc = stateId
        ? await emailOauthStatesCollection.findOne({
          id: stateId,
          provider: microsoftProviderId,
        })
        : null

      redirectPath = sanitizeRedirectPath(stateDoc?.redirectPath || googleDefaultRedirectPath)

      if (stateDoc?.id) {
        await emailOauthStatesCollection.deleteOne({ id: stateDoc.id })
      }

      if (!stateDoc || isStaleState(stateDoc.createdAt)) {
        throw {
          status: 400,
          message: 'Microsoft connection state expired. Please try again.',
        }
      }

      if (oauthError) {
        const message = oauthErrorDescription || `Microsoft authorization failed: ${oauthError}`
        const html = toMicrosoftCallbackHtml({
          redirectPath,
          status: 'error',
          message,
        })

        return res.status(200).type('html').send(html)
      }

      if (!code) {
        throw {
          status: 400,
          message: 'Missing Microsoft authorization code.',
        }
      }

      if (!stateDoc.requestedByUid) {
        throw {
          status: 400,
          message: 'Microsoft connection state is missing user context.',
        }
      }

      const tokenPayload = await exchangeMicrosoftToken({
        microsoftConfig,
        grantType: 'authorization_code',
        code,
      })
      const normalizedToken = mapMicrosoftTokenPayload(tokenPayload, null)
      const profile = await fetchMicrosoftProfile(normalizedToken.accessToken)
      const now = nowIso()
      const sendAsAliases = normalizeMicrosoftSendAsAliases(profile, normalizeEmail)

      await emailConnectionsCollection.updateOne(
        {
          provider: microsoftProviderId,
          uid: normalizeText(stateDoc.requestedByUid, 200),
        },
        {
          $set: {
            provider: microsoftProviderId,
            uid: normalizeText(stateDoc.requestedByUid, 200),
            userEmailLower: normalizeText(stateDoc.requestedByEmail, 320).toLowerCase() || null,
            connectedEmail: profile.email,
            connectedEmailLower: profile.email,
            connectedDisplayName: profile.name,
            connectedPictureUrl: null,
            tokenType: normalizedToken.tokenType,
            scope: normalizedToken.scope || microsoftConfig.scopes,
            accessTokenEncrypted: encryptSecret(normalizedToken.accessToken),
            refreshTokenEncrypted: encryptSecret(normalizedToken.refreshToken),
            accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
            sendAsAliases,
            sendAsSyncedAt: now,
            sendAsSyncError: null,
            sendAsSyncErrorAt: null,
            connectedAt: now,
            updatedAt: now,
            connectedByUid: normalizeText(stateDoc.requestedByUid, 200),
            connectedByEmail: normalizeText(stateDoc.requestedByEmail, 320).toLowerCase() || null,
            lastErrorAt: null,
            lastErrorMessage: null,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        },
        {
          upsert: true,
        },
      )

      const html = toMicrosoftCallbackHtml({
        redirectPath,
        status: 'connected',
        message: `Microsoft connected successfully: ${profile.email}`,
      })

      return res.status(200).type('html').send(html)
    } catch (error) {
      const html = toMicrosoftCallbackHtml({
        redirectPath,
        status: 'error',
        message: normalizeText(error?.message, 900) || 'Microsoft connection failed. Please try again.',
      })

      return res.status(200).type('html').send(html)
    }
  })

  app.post('/api/admin/email/microsoft/disconnect', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { emailConnectionsCollection } = await getGoogleCollections()
      const result = await emailConnectionsCollection.deleteOne({
        provider: microsoftProviderId,
        uid: normalizeText(req.authUser?.uid, 200),
      })

      return res.json({
        ok: true,
        disconnected: result.deletedCount > 0,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/microsoft/send', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const to = normalizeEmailList(req.body?.to, normalizeEmail, 60)
      const cc = normalizeEmailList(req.body?.cc, normalizeEmail, 30)
      const bcc = normalizeEmailList(req.body?.bcc, normalizeEmail, 30)
      const requestedFromEmail = normalizeEmailAddress(req.body?.fromEmail, normalizeEmail)
      const subject = normalizeText(req.body?.subject, 998)
      const textBody = String(req.body?.text ?? '').trim().slice(0, 30000)
      const htmlBody = String(req.body?.html ?? '').trim().slice(0, 150000)

      if (to.length === 0) {
        return res.status(400).json({
          error: 'At least one "to" recipient is required.',
        })
      }

      if (!textBody && !htmlBody) {
        return res.status(400).json({
          error: 'Message content is required (text or html).',
        })
      }

      const {
        emailConnectionsCollection,
      } = await getGoogleCollections()
      const connection = await emailConnectionsCollection.findOne(
        {
          provider: microsoftProviderId,
          uid: normalizeText(req.authUser?.uid, 200),
        },
      )

      if (!connection) {
        return res.status(404).json({
          error: 'No Microsoft account is connected for this user yet.',
        })
      }

      const microsoftConfig = getMicrosoftConfig(req)
      let tokenResolution = await resolveMicrosoftAccessToken({
        emailConnectionsCollection,
        connection,
        microsoftConfig,
      })
      let activeConnection = tokenResolution.connection

      const fromEmail = resolveSelectedFromMicrosoftEmail({
        requestedFromEmail,
        connection: activeConnection,
        normalizeEmail,
      })

      const sendPayload = buildMicrosoftSendMailPayload({
        to,
        cc,
        bcc,
        subject,
        textBody,
        htmlBody,
      })

      try {
        await sendMicrosoftMail({
          accessToken: tokenResolution.accessToken,
          payload: sendPayload,
        })
      } catch (sendError) {
        if (Number(sendError?.status) !== 401) {
          throw sendError
        }

        tokenResolution = await resolveMicrosoftAccessToken({
          emailConnectionsCollection,
          connection: activeConnection,
          microsoftConfig,
          forceRefresh: true,
        })
        activeConnection = tokenResolution.connection

        await sendMicrosoftMail({
          accessToken: tokenResolution.accessToken,
          payload: sendPayload,
        })
      }

      const now = nowIso()

      await emailConnectionsCollection.updateOne(
        resolveConnectionUpdateFilter(activeConnection),
        {
          $set: {
            updatedAt: now,
            lastUsedAt: now,
            lastUsedFromEmail: fromEmail,
            lastErrorAt: null,
            lastErrorMessage: null,
          },
        },
      )

      return res.status(201).json({
        ok: true,
        provider: microsoftProviderId,
        connectedEmail: normalizeText(activeConnection.connectedEmail, 320) || fromEmail,
        fromEmail,
        messageId: null,
        threadId: null,
        sentAt: now,
      })
    } catch (error) {
      next(error)
    }
  })
}
