import { createHash, createPublicKey, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, exportJWK, importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const SCOPE = 'arnold.read'
const b64 = (value) => Buffer.from(value).toString('base64url')
const hash = (value) => createHash('sha256').update(String(value)).digest('base64url')
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max)

function config() {
  const baseUrl = clean(process.env.MCP_OAUTH_ISSUER)
  const privateKeyPem = String(process.env.MCP_OAUTH_ES256_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim()
  const googleClientId = clean(process.env.MCP_GOOGLE_CLIENT_ID)
  const googleClientSecret = clean(process.env.MCP_GOOGLE_CLIENT_SECRET)
  if (!baseUrl || !privateKeyPem || !googleClientId || !googleClientSecret) throw Object.assign(new Error('MCP OAuth is not configured.'), { status: 503 })
  return { baseUrl: baseUrl.replace(/\/$/, ''), audience: clean(process.env.MCP_OAUTH_AUDIENCE) || `${baseUrl.replace(/\/$/, '')}/mcp`, privateKeyPem, googleClientId, googleClientSecret }
}

async function verifyChatGptClient(clientId, redirectUri) {
  const url = new URL(clean(clientId))
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || !url.pathname.startsWith('/oauth/')) throw Object.assign(new Error('Untrusted OAuth client.'), { status: 400 })
  // The verified OpenAI CIMD document is the authority for callbacks. Codex
  // may use a local callback URI, so no separate scheme or hostname rule is
  // applied here; the exact URI must still be published by OpenAI's metadata.
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  const metadata = response.ok ? await response.json() : null
  const redirectMatches = metadata && Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.some((published) => {
    if (published === redirectUri) return true
    try {
      const expected = new URL(published)
      const actual = new URL(redirectUri)
      // Native Codex uses a random loopback port. The CIMD document safely
      // commits to the host and callback path, while the OS selects the port.
      return expected.protocol === 'http:' && actual.protocol === 'http:'
        && ['127.0.0.1', 'localhost'].includes(expected.hostname)
        && expected.hostname === actual.hostname
        && !expected.port && Boolean(actual.port)
        && expected.pathname === actual.pathname
    } catch { return false }
  })
  if (!redirectMatches) {
    console.warn('MCP OAuth client metadata mismatch', { clientId, redirectUri, publishedRedirectUris: Array.isArray(metadata?.redirect_uris) ? metadata.redirect_uris : [] })
    throw Object.assign(new Error('Invalid client metadata.'), { status: 400 })
  }
}

async function approvedPrincipal(db, uid, email, ownerEmail) {
  const normalizedEmail = clean(email, 320).toLowerCase()
  const user = await db.collection('auth_users').findOne({ $or: [{ uid }, { emailLower: normalizedEmail }] }, { projection: { _id: 0, uid: 1, approvalStatus: 1, role: 1, isOwner: 1 } })
  const isOwner = Boolean(user?.isOwner) || normalizedEmail === clean(ownerEmail, 320).toLowerCase()
  if (!isOwner && user?.approvalStatus !== 'approved') throw Object.assign(new Error('An approved Arnold account is required.'), { status: 403 })
  return { uid: clean(user?.uid || uid, 240), email: normalizedEmail }
}

export function registerMcpOAuthRoutes(app, { getCollections, ownerEmail }) {
  async function getDb() { return (await getCollections()).databasesByDomain.auth }
  async function tokenIdentity(token) {
    const c = config(); const key = await importSPKI(createPublicKey(c.privateKeyPem).export({ type: 'spki', format: 'pem' }), 'ES256')
    const { payload } = await jwtVerify(clean(token, 12000), key, { issuer: c.baseUrl, audience: c.audience, typ: 'at+jwt' })
    if (!clean(payload.scope, 200).split(/\s+/).includes(SCOPE) || !clean(payload.sub) || !clean(payload.email)) throw Object.assign(new Error('Invalid MCP access token.'), { status: 401 })
    return approvedPrincipal(await getDb(), clean(payload.sub, 240), clean(payload.email, 320), ownerEmail)
  }
  const protectedResourceMetadata = (_req, res) => { const c = config(); res.json({ resource: c.audience, authorization_servers: [c.baseUrl], scopes_supported: [SCOPE] }) }
  // Clients use both the direct and path-qualified RFC 9728 discovery forms.
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata)
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata)
  app.get('/mcp/.well-known/oauth-protected-resource', protectedResourceMetadata)
  const authorizationMetadata = async (_req, res, next) => { try { const c = config(); res.json({ issuer: c.baseUrl, authorization_endpoint: `${c.baseUrl}/oauth/authorize`, token_endpoint: `${c.baseUrl}/oauth/token`, jwks_uri: `${c.baseUrl}/oauth/jwks`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true, scopes_supported: [SCOPE] }) } catch (e) { next(e) } }
  app.get('/.well-known/oauth-authorization-server', authorizationMetadata)
  app.get('/.well-known/oauth-authorization-server/mcp', authorizationMetadata)
  app.get('/.well-known/openid-configuration', authorizationMetadata)
  app.get('/mcp/.well-known/oauth-authorization-server', authorizationMetadata)
  app.get('/mcp/.well-known/openid-configuration', authorizationMetadata)
  const jwks = async (_req, res, next) => { try { const c = config(); const jwk = await exportJWK(await importSPKI(createPublicKey(c.privateKeyPem).export({ type: 'spki', format: 'pem' }), 'ES256')); res.json({ keys: [{ ...jwk, use: 'sig', alg: 'ES256', kid: 'arnold-mcp-1' }] }) } catch (e) { next(e) } }
  app.get('/oauth/jwks', jwks)
  app.get('/oauth/jwks.json', jwks)
  app.get('/oauth/authorize', async (req, res, next) => { try { const c = config(); const clientId = clean(req.query.client_id); const redirectUri = clean(req.query.redirect_uri); const state = clean(req.query.state); const challenge = clean(req.query.code_challenge); const resource = clean(req.query.resource, 2000); if (!state || resource !== c.audience || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || clean(req.query.code_challenge_method) !== 'S256' || !clean(req.query.scope).split(/\s+/).includes(SCOPE)) throw Object.assign(new Error('Invalid authorization request.'), { status: 400 }); await verifyChatGptClient(clientId, redirectUri); const id = b64(randomBytes(32)); await (await getDb()).collection('mcp_oauth_transactions').insertOne({ id, clientId, redirectUri, state, challenge, resource, expiresAt: new Date(Date.now() + 10 * 60_000), createdAt: new Date() }); const callback = `${c.baseUrl}/oauth/google/callback`; const u = new URL(GOOGLE_AUTH); u.searchParams.set('client_id', c.googleClientId); u.searchParams.set('redirect_uri', callback); u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', 'openid email profile'); u.searchParams.set('state', id); u.searchParams.set('prompt', 'select_account'); res.redirect(u.toString()) } catch (e) { next(e) } })
  app.get('/oauth/google/callback', async (req, res, next) => { try { const c = config(); const id = clean(req.query.state); const googleCode = clean(req.query.code, 2000); const txResult = id ? await (await getDb()).collection('mcp_oauth_transactions').findOneAndDelete({ id, expiresAt: { $gt: new Date() } }) : null; const tx = txResult?.value ?? txResult; if (!tx || !googleCode) throw Object.assign(new Error('Login session expired.'), { status: 400 }); const form = new URLSearchParams({ code: googleCode, client_id: c.googleClientId, client_secret: c.googleClientSecret, redirect_uri: `${c.baseUrl}/oauth/google/callback`, grant_type: 'authorization_code' }); const exchange = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }); const body = await exchange.json(); if (!exchange.ok || !body.id_token) throw Object.assign(new Error('Google login failed.'), { status: 401 }); const google = await jwtVerify(body.id_token, GOOGLE_JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: c.googleClientId }); if (google.payload.email_verified !== true) throw Object.assign(new Error('A verified Google email is required.'), { status: 403 }); const principal = await approvedPrincipal(await getDb(), clean(google.payload.sub, 240), clean(google.payload.email, 320), ownerEmail); const code = b64(randomBytes(32)); await (await getDb()).collection('mcp_oauth_codes').insertOne({ id: hash(code), clientId: tx.clientId, redirectUri: tx.redirectUri, challenge: tx.challenge, resource: tx.resource, uid: principal.uid, email: principal.email, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() }); const done = new URL(tx.redirectUri); done.searchParams.set('code', code); done.searchParams.set('state', tx.state); done.searchParams.set('iss', c.baseUrl); res.redirect(done.toString()) } catch (e) { next(e) } })
  app.post('/oauth/token', async (req, res, next) => { try { const c = config(); const code = clean(req.body?.code, 2000); const clientId = clean(req.body?.client_id); const redirectUri = clean(req.body?.redirect_uri); const verifier = clean(req.body?.code_verifier); const resource = clean(req.body?.resource, 2000); const foundResult = await (await getDb()).collection('mcp_oauth_codes').findOneAndDelete({ id: hash(code), clientId, redirectUri, expiresAt: { $gt: new Date() }, challenge: hash(verifier) }); const found = foundResult?.value ?? foundResult; if (!found || resource !== found.resource || resource !== c.audience) throw Object.assign(new Error('Invalid authorization code.'), { status: 400 }); const key = await importPKCS8(c.privateKeyPem, 'ES256'); const accessToken = await new SignJWT({ email: found.email, scope: SCOPE }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'arnold-mcp-1' }).setIssuer(c.baseUrl).setAudience(resource).setSubject(found.uid).setIssuedAt().setExpirationTime('10m').sign(key); res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 600, scope: SCOPE }) } catch (e) { next(e) } })
  return { tokenIdentity }
}
