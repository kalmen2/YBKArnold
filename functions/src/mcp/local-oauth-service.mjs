import { createHash, randomBytes } from 'node:crypto'
import { importPKCS8, jwtVerify, SignJWT } from 'jose'

const CHATGPT_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
const READ_SCOPE = 'arnold.read'

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function sha256Base64Url(value) {
  return createHash('sha256').update(value).digest('base64url')
}

function text(value, maximum = 4000) {
  return String(value ?? '').trim().slice(0, maximum)
}

export function createLocalOAuthService({
  issuer,
  audience,
  privateKeyPem,
  now = () => Date.now(),
  fetchClientMetadata = globalThis.fetch,
}) {
  if (!issuer || !audience || !privateKeyPem) throw new Error('Local OAuth issuer, audience, and private key are required.')
  const codes = new Map()

  async function validateClientMetadata(clientId) {
    const url = new URL(text(clientId, 2000))
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid client metadata URL.')
    if (url.hostname !== 'chatgpt.com' || !url.pathname.startsWith('/oauth/')) throw new Error('Untrusted client metadata URL.')
    const response = await fetchClientMetadata(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    if (!response?.ok) throw new Error('Client metadata could not be retrieved.')
    const metadata = await response.json()
    const redirects = Array.isArray(metadata?.redirect_uris) ? metadata.redirect_uris : []
    if (!redirects.includes(CHATGPT_REDIRECT_URI)) throw new Error('Client metadata has an invalid redirect URI.')
    if (metadata?.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') throw new Error('Only public PKCE clients are allowed.')
    return { clientId: url.toString(), redirectUri: CHATGPT_REDIRECT_URI }
  }

  function createAuthorizationCode({ clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, subject, email }) {
    if (redirectUri !== CHATGPT_REDIRECT_URI) throw new Error('Invalid redirect URI.')
    if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(text(codeChallenge, 160))) throw new Error('PKCE S256 is required.')
    if (!text(scope, 200).split(/\s+/).includes(READ_SCOPE)) throw new Error('arnold.read scope is required.')
    const code = base64Url(randomBytes(32))
    codes.set(sha256Base64Url(code), {
      clientId: text(clientId, 2000), redirectUri, codeChallenge, subject: text(subject, 240), email: text(email, 320).toLowerCase(),
      expiresAt: now() + 60_000, used: false,
    })
    return code
  }

  async function exchangeCode({ code, clientId, redirectUri, codeVerifier }) {
    const key = sha256Base64Url(text(code, 1000))
    const record = codes.get(key)
    if (!record || record.used || record.expiresAt <= now()) throw new Error('Invalid, used, or expired authorization code.')
    if (record.clientId !== text(clientId, 2000) || record.redirectUri !== redirectUri) throw new Error('Authorization code client mismatch.')
    if (sha256Base64Url(text(codeVerifier, 160)) !== record.codeChallenge) throw new Error('Invalid PKCE verifier.')
    record.used = true
    const privateKey = await importPKCS8(privateKeyPem, 'ES256')
    const accessToken = await new SignJWT({ email: record.email, scope: READ_SCOPE })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
      .setIssuer(issuer).setAudience(audience).setSubject(record.subject)
      .setIssuedAt(Math.floor(now() / 1000)).setExpirationTime(Math.floor(now() / 1000) + 600)
      .sign(privateKey)
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 600, scope: READ_SCOPE }
  }

  async function verifyAccessToken(token, publicKey) {
    const result = await jwtVerify(text(token, 12000), publicKey, { issuer, audience, typ: 'at+jwt' })
    const scopes = text(result.payload.scope, 200).split(/\s+/)
    if (!scopes.includes(READ_SCOPE) || !text(result.payload.sub, 240) || !text(result.payload.email, 320)) throw new Error('Invalid access-token claims.')
    return { uid: text(result.payload.sub, 240), email: text(result.payload.email, 320).toLowerCase(), scopes }
  }

  return { validateClientMetadata, createAuthorizationCode, exchangeCode, verifyAccessToken, codeCount: () => codes.size }
}

export { CHATGPT_REDIRECT_URI, READ_SCOPE, sha256Base64Url }
