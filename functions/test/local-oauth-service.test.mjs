import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createLocalOAuthService, CHATGPT_REDIRECT_URI, READ_SCOPE, sha256Base64Url } from '../src/mcp/local-oauth-service.mjs'
import { __testables } from '../src/routes/mcp-readonly-routes.mjs'

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicKey = keys.publicKey
const issuer = 'https://localhost.example.test/mcpReadOnly'
const audience = `${issuer}/mcp`
const clientId = 'https://chatgpt.com/oauth/codex/test/client.json'
const verifier = 'a'.repeat(64)
const createService = (clock = () => Date.now()) => createLocalOAuthService({ issuer, audience, privateKeyPem, now: clock, fetchClientMetadata: async () => ({ ok: true, json: async () => ({ redirect_uris: [CHATGPT_REDIRECT_URI], token_endpoint_auth_method: 'none' }) }) })

test('issues a short-lived token and rejects code reuse', async () => {
  const service = createService()
  const code = service.createAuthorizationCode({ clientId, redirectUri: CHATGPT_REDIRECT_URI, codeChallenge: sha256Base64Url(verifier), codeChallengeMethod: 'S256', scope: READ_SCOPE, subject: 'admin-uid', email: 'admin@example.com' })
  const token = await service.exchangeCode({ code, clientId, redirectUri: CHATGPT_REDIRECT_URI, codeVerifier: verifier })
  assert.equal((await service.verifyAccessToken(token.access_token, publicKey)).uid, 'admin-uid')
  await assert.rejects(() => service.exchangeCode({ code, clientId, redirectUri: CHATGPT_REDIRECT_URI, codeVerifier: verifier }))
})

test('rejects expired code, bad PKCE, invalid metadata, and bad redirect URI', async () => {
  let now = 0
  const service = createService(() => now)
  const code = service.createAuthorizationCode({ clientId, redirectUri: CHATGPT_REDIRECT_URI, codeChallenge: sha256Base64Url(verifier), codeChallengeMethod: 'S256', scope: READ_SCOPE, subject: 'u', email: 'u@example.com' })
  now = 60_001
  await assert.rejects(() => service.exchangeCode({ code, clientId, redirectUri: CHATGPT_REDIRECT_URI, codeVerifier: verifier }))
  assert.throws(() => service.createAuthorizationCode({ clientId, redirectUri: 'https://bad.example', codeChallenge: sha256Base64Url(verifier), codeChallengeMethod: 'S256', scope: READ_SCOPE, subject: 'u', email: 'u@example.com' }))
  await assert.rejects(() => service.validateClientMetadata('https://evil.example/client.json'))
})

test('applies sales-rep, shop-worker, and admin record restrictions', () => {
  assert.deepEqual([...__testables.allowedTypesFor({ role: 'sales_rep' })].sort(), ['contacts', 'customers', 'quotes', 'sales_reps'])
  assert.equal(__testables.allowedTypesFor({ role: 'shop_worker' }).has('purchasing_transactions'), false)
  assert.equal(__testables.allowedTypesFor({ role: 'admin' }).has('chat_messages'), true)
})

test('does not allow a user to query another user’s app chats', async () => {
  const calls = []
  const threads = { find(filter) { calls.push(filter); return { limit() { return { toArray: async () => [{ id: 'chat-owned-by-user-a' }] } } } } }
  const filter = await __testables.chatVisibilityFilter({ recordType: 'chat_messages', definition: { privateToMember: true }, collections: { databasesByDomain: { auth: { collection: () => threads } } }, principal: { uid: 'user-a', role: 'shop_worker' } })
  assert.deepEqual(calls, [{ memberUids: 'user-a' }])
  assert.deepEqual(filter, { chatId: { $in: ['chat-owned-by-user-a'] } })
})
