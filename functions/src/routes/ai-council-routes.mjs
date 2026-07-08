import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'

const aiCouncilMembers = ['chatgpt', 'claude']
const ruleMembers = ['chatgpt', 'claude', 'moderator']
const absoluteMaxDiscussionRounds = 8
const googleProviderId = 'google'
const googleTokenUrl = 'https://oauth2.googleapis.com/token'
const googleDriveFilesUrl = 'https://www.googleapis.com/drive/v3/files'
const googleDriveScope = 'https://www.googleapis.com/auth/drive.readonly'
const googleAccessTokenRefreshSkewMs = 2 * 60 * 1000
const defaultDriveBrainFolderId = '1z1b8vec2vkuIqFAzTXKxKvP6xqmoXbMn'
const maxDriveBrainFiles = 18
const maxDriveBrainChars = 30000

let cachedEncryptionSecret = ''
let cachedEncryptionKey = null

const defaultCouncilRules = {
  moderator: {
    label: 'Moderator',
    role: 'Flow Controller',
    provider: 'openai',
    model: 'none',
    instructions:
      'You are the simple Moderator of Kal\'s AI Council. You do not use an AI model and you do not give opinions. Your only job is to tag the exact next speaker so the discussion is easy to follow. You must spell the names exactly: @ChatGPT and @Claude. First tag @ChatGPT, then @Claude, then back and forth until Claude reaches agreement or stops the discussion as Executive Manager. When agreement is reached, tag @Claude to write the final answer to Kal. Keep Moderator notes short.',
    maxDiscussionRounds: 4,
    tags: {
      mentionClaude: '@Claude, please answer Kal directly.',
      mentionChatGPT: '@ChatGPT, please answer Kal directly.',
      chatgptFirst: '@ChatGPT, start the discussion with Claude.',
      chatgptContinue: '@ChatGPT, respond to Claude so you can reach agreement.',
      researchStart: '@ChatGPT, start research. Bring findings and gaps to Claude.',
      researchReview: '@Claude, review ChatGPT research. Challenge gaps, ask for more if needed, or end with AGREED.',
      researchContinue: "@ChatGPT, continue the research discussion and fill Claude's gaps.",
      chatgptIssue: '@Kal, ChatGPT has an issue, so I am stopping here. Please check the AI response, OpenAI key, or Google Drive brain connection before continuing.',
      claudeDiscuss: '@Claude, respond to ChatGPT. If you are aligned, end with AGREED. If this is going nowhere, stop the discussion and end with AGREED.',
      claudeFinalAgreed: '@Claude, you and ChatGPT agree. Give Kal the final answer.',
      claudeFinalForced: '@Claude, maximum discussion rounds reached. Give Kal the final answer now.',
      chatgptFinal: '@ChatGPT, add one brief final point only if genuinely needed. Otherwise say Done.',
    },
    runtimeInstructions: {
      loadedBrain:
        'Runtime fact: the Google Drive company brain has already been loaded into this prompt as Company Brain context. Do not say you need to access, reattempt, confirm, reconnect, or check the brain. If the brain were unavailable, the server would stop before your turn. Use the loaded brain now. If the loaded brain lacks a specific fact, name the missing fact directly instead of discussing the connection.',
      correction:
        'Correction: your previous draft incorrectly talked about checking, confirming, reconnecting, or reattempting the Google Drive brain. Do not do that. The brain is already loaded in this prompt. Use the loaded brain now and answer the actual topic.',
    },
  },
  chatgpt: {
    label: 'ChatGPT',
    role: 'Strategic Adviser',
    provider: 'openai',
    model: 'gpt-4o',
    instructions:
      'You are ChatGPT, Strategic Adviser in Kal\'s AI Council.\nBefore every response the brain from Google Drive is loaded into your context automatically.\nRead it carefully. Every fact you need is there.\nNever answer from memory or make up facts.\nNever discuss checking, reconnecting, reattempting, or accessing the brain. The server already did that before your turn.\nIf a specific fact is not in the loaded brain, name that missing fact directly and continue with the best next action.\n\nIn internal discussion talk directly to Claude.\nStart with Claude, and bring concrete findings, concrete assumptions, and concrete next actions.\nDo not give generic advice like "use SAM.gov tools" unless you include exact search terms, filters, decision criteria, or research tasks.\nIf live web/SAM.gov search is needed and the tool is not available, say exactly what search you would run and what evidence Claude should require.\nKeep it concise - one clear point per message.\nDo not wait for the Moderator after being tagged. Respond immediately to Claude.\n\nDiscussion controls you may use only when truly needed:\n1) If Claude is repeatedly incorrect or acting in bad faith after you already corrected it, end with token OBJECTION: <one-sentence reason>.\n2) If Kal must know a critical caveat that is not an objection, add NOTE_TO_KAL: <short note>. Use this rarely.\n\nWhen called for a final addition say exactly: Done\nunless you have something genuinely new to add.\nNever make financial or legal commitments.',
    turnInstructions: {
      mention: 'Kal mentioned you directly. Respond only to Kal. Start with "Kal," and be clear and actionable.',
      discussion: 'Write your thoughts directed at Claude. Start your message with "Claude,". Bring one concrete recommendation, evidence from the loaded brain if available, and the next action Claude should take. Do not wait for another tag. If Claude is repeatedly incorrect after correction, end with OBJECTION: <one-sentence reason>. Only when Kal needs a rare caveat, add NOTE_TO_KAL: <short note>.',
      research: 'Research mode. Start with "Claude,". Your job is to gather and organize facts for Claude from the loaded Google Drive brain, conversation history, and live web research results when available. Do not talk about checking whether the brain is connected. Do not give generic SAM.gov advice. Bring concrete findings, source gaps, exact filters, target agencies or NAICS/product/service clues from the brain, profit-screen criteria, and evidence needed. If Claude is repeatedly incorrect after correction, end with OBJECTION: <one-sentence reason>. Only when Kal needs a rare caveat, add NOTE_TO_KAL: <short note>.',
      webResearch: 'Live web research mode. Use the loaded Google Drive brain and original topic to search the live web broadly. For government contract work, search SAM.gov and supporting public sources such as agency procurement pages, forecast pages, SBA/subcontracting sources, and relevant bid portals when useful. Return concrete candidates, not a plan. For each candidate include title, agency, notice or solicitation ID if available, due date if available, set-aside, NAICS, place of performance, link, why it fits Arnold/YBK, likely money/profit screen, and missing source gaps. Separate confirmed facts from assumptions. If no good candidates are found, state which searches were run and what the next search should be. Never invent deals, deadlines, agencies, prices, or contract numbers.',
      researchDirect: 'Kal mentioned you directly and the request needs research. Start with "Kal,". Use the Google Drive brain and conversation history first. If the needed facts are not in the brain or conversation, clearly say what outside source/tool is needed and do not invent deals, agencies, deadlines, contract numbers, prices, or facts. If you need more time or an external research agent, say that directly and list the exact research tasks.',
      final: 'Claude gave the final answer. Add ONE brief point to Kal if genuinely needed, or say exactly: Done.',
    },
  },
  claude: {
    label: 'Claude',
    role: 'Executive Manager',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    instructions:
      'You are Claude, Executive Manager of Kal\'s AI Council.\nBefore every response the brain from Google Drive is loaded into your context automatically.\nRead it carefully. Every fact you need is there.\nNever answer from memory or make up facts.\nNever discuss checking, reconnecting, reattempting, or accessing the brain. The server already did that before your turn.\nIf a specific fact is not in the loaded brain, name that missing fact directly and continue with the best next action.\n\nIn internal discussion talk directly to ChatGPT.\nChallenge, agree, or build on ChatGPT\'s points using the loaded brain.\nDo not repeat ChatGPT or summarize ChatGPT unless you are converting the discussion into a final answer for Kal.\nYou own the next step as Executive Manager. If ChatGPT gives generic advice, reject it and tell ChatGPT exactly what concrete research, filters, criteria, or evidence to produce next.\nDo not come back to Kal with "we should do X" when the council can define and assign X internally.\nIf a tool is missing, define the task for the future research agent and the exact evidence required.\nWhen fully aligned, or when you decide to stop the discussion, end your message with: AGREED\n\nManager controls you may use only when truly needed:\n1) If discussion is repeating with no new information, end with LOOP_DETECTED: <reason + your best answer to Kal>.\n2) If ChatGPT is repeatedly incorrect or acting in bad faith after correction, end with OBJECTION: <one-sentence reason>.\n3) If Kal must know a critical caveat that is not an objection, add NOTE_TO_KAL: <short note>. Use this rarely.\n\nWhen delivering the final answer start with Kal,\nand be specific using real facts from the brain.\nNever be generic.\nGive Kal either: 1) the completed recommendation, 2) the exact assigned research task and why tool access is blocking completion, or 3) the one decision only Kal can make.\nNever make financial or legal commitments.\nFlag money and legal issues to Kal immediately.\nKal is the final authority on everything.',
    turnInstructions: {
      mention: 'Kal mentioned you directly. Respond only to Kal. Start with "Kal," and be clear and actionable.',
      discussion: 'Respond directly to ChatGPT. Start with "ChatGPT,". Agree, challenge, add, or stop the discussion if it is going nowhere. Do not repeat ChatGPT. If aligned or stopping as Executive Manager, end with exactly: AGREED. If discussion is repeating with no new information, end with LOOP_DETECTED: <reason + your best answer to Kal>. If ChatGPT is repeatedly incorrect after correction, end with OBJECTION: <one-sentence reason>. Only when Kal needs a rare caveat, add NOTE_TO_KAL: <short note>.',
      discussionFinalRound: 'Respond directly to ChatGPT. Start with "ChatGPT,". This is the maximum discussion round, so stop the discussion as Executive Manager and end with exactly: AGREED',
      research: 'Research review mode. Start with "ChatGPT,". Act as Executive Manager: audit ChatGPT research for real facts, missing sources, weak assumptions, profit-screen criteria, and next actions. Do not repeat ChatGPT. If ChatGPT is generic, tell ChatGPT exactly what to research next: search terms, filters, agencies, NAICS/product/service clues, evidence, and profitability checks. If the current research is enough for Kal, end with exactly: AGREED. If research is repeating with no new information, end with LOOP_DETECTED: <reason + your best answer to Kal>. If ChatGPT is repeatedly incorrect after correction, end with OBJECTION: <one-sentence reason>. Only when Kal needs a rare caveat, add NOTE_TO_KAL: <short note>.',
      webResearch: 'Executive live web research mode. Use the loaded Google Drive brain, ChatGPT findings, and the original topic to independently verify and expand the research using the live web. Do not only review. Search broadly when facts, current opportunities, deadlines, source links, agencies, prices, or contract identifiers are needed. For government contract work, verify with SAM.gov and supporting public sources where useful. Return what is confirmed, what is weak, what is missing, and the exact recommendation to Kal. Never invent deals, deadlines, agencies, prices, or contract numbers.',
      researchDirect: 'Kal mentioned you directly and the request needs research. Start with "Kal,". Act as Executive Manager: separate confirmed facts from missing sources, identify weak assumptions, and give exact next research actions. If the needed facts are not in the brain or conversation, clearly say what outside source/tool is needed and do not invent deals, agencies, deadlines, contract numbers, prices, or facts.',
      researchFinalRound: 'Research review mode. Start with "ChatGPT,". This is the final research round, so stop the discussion as Executive Manager, state the remaining source gaps if any, and end with exactly: AGREED',
      finalAgreed: 'You and ChatGPT have reached agreement. Now write the final answer directly to Kal. Start with "Kal," - be clear and actionable. Do not say you need to check or access the brain; it is already loaded. Use it now. Do not return generic advice. If the council cannot complete the task because live SAM.gov/web search is not available, say that plainly and provide the exact research assignment that should be run next.',
      finalForced: 'You stopped the discussion or reached the maximum discussion rounds. Now write the final answer directly to Kal. Start with "Kal," - be clear and actionable. Do not say you need to check or access the brain; it is already loaded. Use it now.',
      researchFinal: 'You and ChatGPT have finished the research discussion. Now write directly to Kal. Start with "Kal,". Separate confirmed facts from research gaps. If no real outside research was performed, say that clearly and give the exact next research tasks instead of pretending to have found deals.',
    },
  },
}

function normalizeText(value, maxLength = 10000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeLongText(value, maxLength = 60000) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function nowIso() {
  return new Date().toISOString()
}

function resolveTokenEncryptionSecret() {
  return normalizeText(
    process.env.EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY,
    4000,
  )
}

function getEncryptionKey() {
  const encryptionSecret = resolveTokenEncryptionSecret()

  if (!encryptionSecret) {
    throw {
      status: 500,
      message: 'Missing EMAIL_OAUTH_TOKEN_ENCRYPTION_KEY (or GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY) for Google token encryption.',
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
  const normalizedValue = String(value ?? '')

  if (!normalizedValue) {
    return ''
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(normalizedValue, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`
}

function decryptSecret(value) {
  const normalizedValue = normalizeText(value, 12000)

  if (!normalizedValue) {
    return ''
  }

  const [ivPart = '', authTagPart = '', encryptedPart = ''] = normalizedValue.split('.')

  if (!ivPart || !authTagPart || !encryptedPart) {
    return ''
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivPart, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

function isExpiredAt(value, skewMs = 0) {
  const timestamp = Date.parse(String(value ?? ''))

  if (!Number.isFinite(timestamp)) {
    return true
  }

  return Date.now() >= timestamp - skewMs
}

function parseScopeSet(scopeValue) {
  return new Set(
    String(scopeValue ?? '')
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  )
}

function hasDriveScope(scopeValue) {
  const scopes = parseScopeSet(scopeValue)
  return scopes.has(googleDriveScope)
    || scopes.has('https://www.googleapis.com/auth/drive.file')
    || scopes.has('https://www.googleapis.com/auth/drive')
}

function resolveDriveBrainFolderId() {
  return normalizeText(
    process.env.AI_COUNCIL_DRIVE_FOLDER_ID
      || process.env.GOOGLE_DRIVE_BRAIN_FOLDER_ID
      || process.env.GOOGLE_DRIVE_FOLDER_ID,
    260,
  ) || defaultDriveBrainFolderId
}

function resolveGoogleConfig() {
  const clientId = normalizeText(process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID, 320)
  const clientSecret = normalizeText(process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET, 320)

  if (!clientId || !clientSecret) {
    throw {
      status: 500,
      message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    }
  }

  return { clientId, clientSecret }
}

function getRequestActor(req) {
  return {
    uid: normalizeText(req.authUser?.uid, 200) || null,
    email: normalizeText(req.authUser?.email, 320).toLowerCase() || null,
  }
}

function normalizeChatType(value) {
  return String(value ?? '').toLowerCase() === 'direct' ? 'direct' : 'council'
}

function normalizeTargetMember(value) {
  const normalized = normalizeText(value, 40).toLowerCase()
  return aiCouncilMembers.includes(normalized) ? normalized : null
}

function publicChatDoc(doc) {
  return {
    id: doc.id,
    title: doc.title || 'New Chat',
    chatType: normalizeChatType(doc.chatType),
    targetMember: normalizeTargetMember(doc.targetMember),
    pinned: Boolean(doc.pinned),
    status: doc.status || 'active',
    outcome: doc.outcome || null,
    outcomeReason: doc.outcomeReason || null,
    outcomeByMember: doc.outcomeByMember || null,
    outcomeAt: doc.outcomeAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    finishedAt: doc.finishedAt || null,
    processingMember: doc.processingMember || null,
  }
}

function publicMessageDoc(doc) {
  return {
    id: doc.id,
    chatId: doc.chatId,
    sender: doc.sender || 'AI Council',
    text: doc.text || '',
    type: doc.type || 'message',
    provider: normalizeText(doc.provider, 40).toLowerCase() || null,
    member: normalizeText(doc.member, 40).toLowerCase() || null,
    createdAt: doc.createdAt || null,
  }
}

function sanitizePersistedCouncilRule(member, existing) {
  const fallback = defaultCouncilRules[member]
  const existingInstructions = normalizeLongText(existing?.instructions)
  const existingMaxDiscussionRounds = Number(existing?.maxDiscussionRounds)
  const shouldUseModeratorDefaultRounds = member === 'moderator'
    && (!Number.isFinite(existingMaxDiscussionRounds) || existingMaxDiscussionRounds === 8)
  const requiredMarkers = {
    moderator: 'tag the exact next speaker',
    chatgpt: 'OBJECTION',
    claude: 'LOOP_DETECTED',
  }
  const hasLegacyInstruction = /neutral traffic|Arnold Contract|Kal Kamionka|always speak|strategic advice/i.test(existingInstructions)
    || /can you add it|i do not have that in the brain/i.test(existingInstructions)
  const isMissingRequiredBehavior = requiredMarkers[member]
    ? !existingInstructions.includes(requiredMarkers[member])
    : false
  const shouldUseFallbackPrompts = !existingInstructions || hasLegacyInstruction || isMissingRequiredBehavior

  return {
    ...fallback,
    ...existing,
    member,
    label: fallback.label,
    role: fallback.role,
    provider:
      normalizeText(existing?.provider, 40).toLowerCase() === 'anthropic'
        ? 'anthropic'
        : normalizeText(existing?.provider, 40).toLowerCase() === 'openai'
          ? 'openai'
          : fallback.provider,
    model: fallback.model,
    instructions: shouldUseFallbackPrompts
      ? fallback.instructions
      : existingInstructions,
    tags: shouldUseFallbackPrompts && fallback.tags ? fallback.tags : { ...(fallback.tags || {}), ...(existing?.tags || {}) },
    runtimeInstructions: shouldUseFallbackPrompts && fallback.runtimeInstructions
      ? fallback.runtimeInstructions
      : { ...(fallback.runtimeInstructions || {}), ...(existing?.runtimeInstructions || {}) },
    turnInstructions: shouldUseFallbackPrompts && fallback.turnInstructions
      ? fallback.turnInstructions
      : { ...(fallback.turnInstructions || {}), ...(existing?.turnInstructions || {}) },
    maxDiscussionRounds: member === 'moderator'
      ? shouldUseModeratorDefaultRounds
        ? fallback.maxDiscussionRounds
        : toBoundedInteger(existing?.maxDiscussionRounds, 1, absoluteMaxDiscussionRounds, fallback.maxDiscussionRounds)
      : undefined,
  }
}

function getRuleText(rule, path, fallback = '') {
  const parts = path.split('.')
  let value = rule

  for (const part of parts) {
    value = value?.[part]
  }

  return normalizeLongText(value, 4000) || fallback
}

function getSafeAiErrorMessage(error) {
  const rawMessage = normalizeText(
    error?.message || error?.error?.message || 'The AI call failed before a response was saved.',
    1000,
  )

  return rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
}

function isAiIssueResponse(value) {
  const text = normalizeText(value, 4000).toLowerCase()

  return !text
    || text.length < 20
    || text.includes('i do not have that in the brain')
    || text.includes('can you add it')
    || isBrainAccessMetaResponse(text)
    || text.includes('no api key')
    || text.includes('api key')
    || text.includes('unavailable')
    || text.includes('i cannot')
    || text.includes("i'm not able")
    || text.includes('error')
}

function isBrainAccessMetaResponse(value) {
  const text = normalizeText(value, 4000).toLowerCase()

  return /\b(?:re)?attempt\b.{0,80}\b(?:access|read|check|load)\b.{0,80}\bbrain\b/.test(text)
    || /\b(?:confirm|check|ensure|reconnect|connect|access|read|load)\b.{0,80}\b(?:google drive|drive|brain)\b.{0,80}\b(?:connection|connected|active|working|available)\b/.test(text)
    || /\b(?:brain|google drive|drive)\b.{0,80}\b(?:connection|connected|active|working|available)\b/.test(text)
}

function isResearchRequest(value) {
  return /\b(research|deep research|find (good )?deals|government contracts?|bid on|bids?|rfp|sam\.gov|opportunit(?:y|ies)|procurement|take (your|the) time|investigate|look (it|this|them) up)\b/i
    .test(String(value ?? ''))
}

function parseTokenPayload(text, token) {
  const normalizedText = String(text ?? '')
  const escapedToken = String(token ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tokenPattern = new RegExp(`${escapedToken}\\s*:?\\s*([\\s\\S]*)`, 'i')
  const match = normalizedText.match(tokenPattern)

  if (!match) {
    return null
  }

  const tokenValue = normalizeLongText(match[1], 2000)
  return tokenValue || null
}

function stripControlTokens(text) {
  return String(text ?? '')
    .replace(/\b(LOOP_DETECTED|OBJECTION|NOTE_TO_KAL)\b\s*:?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isMissingFallbackObjectFields(existing, fallback, field) {
  const fallbackValue = fallback?.[field]

  if (!fallbackValue || typeof fallbackValue !== 'object') {
    return false
  }

  const existingValue = existing?.[field]

  if (!existingValue || typeof existingValue !== 'object') {
    return true
  }

  return Object.keys(fallbackValue).some((key) => !normalizeLongText(existingValue[key], 4000))
}

function getMaxDiscussionRounds(rules) {
  const configured = Number(rules?.moderator?.maxDiscussionRounds)

  if (!Number.isFinite(configured) || configured < 1) {
    return defaultCouncilRules.moderator.maxDiscussionRounds
  }

  return Math.min(absoluteMaxDiscussionRounds, Math.floor(configured))
}

function getCouncilCollections(collections) {
  const aiDatabase = collections.databasesByDomain.ai

  return {
    chatsCollection: aiDatabase.collection('ai_council_chats'),
    messagesCollection: aiDatabase.collection('ai_council_messages'),
    rulesCollection: aiDatabase.collection('ai_council_rules'),
  }
}

async function ensureCouncilIndexes({ chatsCollection, messagesCollection, rulesCollection }) {
  await Promise.all([
    chatsCollection.createIndex({ id: 1 }, { unique: true }),
    chatsCollection.createIndex({ pinned: -1, updatedAt: -1 }),
    chatsCollection.createIndex({ chatType: 1, targetMember: 1, updatedAt: -1 }),
    messagesCollection.createIndex({ id: 1 }, { unique: true }),
    messagesCollection.createIndex({ chatId: 1, createdAt: 1 }),
    rulesCollection.createIndex({ member: 1 }, { unique: true }),
  ])
}

async function loadCouncilRules(rulesCollection) {
  const now = new Date().toISOString()
  const docs = await rulesCollection
    .find({ member: { $in: ruleMembers } }, { projection: { _id: 0 } })
    .toArray()
  const docsByMember = new Map(docs.map((doc) => [doc.member, doc]))
  const rules = {}
  const missingWrites = []

  for (const member of ruleMembers) {
    const existing = docsByMember.get(member)
    const fallback = defaultCouncilRules[member]

    if (existing) {
      rules[member] = sanitizePersistedCouncilRule(member, existing)
      if (
        rules[member].instructions !== normalizeLongText(existing.instructions)
        || isMissingFallbackObjectFields(existing, fallback, 'tags')
        || isMissingFallbackObjectFields(existing, fallback, 'runtimeInstructions')
        || isMissingFallbackObjectFields(existing, fallback, 'turnInstructions')
        || normalizeText(existing.provider, 40).toLowerCase() !== rules[member].provider
        || normalizeText(existing.model, 120) !== rules[member].model
        || (member === 'moderator' && Number(existing.maxDiscussionRounds) !== fallback.maxDiscussionRounds)
      ) {
        missingWrites.push({
          updateOne: {
            filter: { member },
            update: {
              $set: {
                ...rules[member],
                updatedAt: now,
              },
            },
            upsert: true,
          },
        })
      }
      continue
    }

    rules[member] = {
      member,
      ...fallback,
      createdAt: now,
      updatedAt: now,
    }
    missingWrites.push({
      updateOne: {
        filter: { member },
        update: { $setOnInsert: rules[member] },
        upsert: true,
      },
    })
  }

  if (missingWrites.length > 0) {
    await rulesCollection.bulkWrite(missingWrites, { ordered: false })
  }
  return rules
}

function buildConversationText(messages) {
  return messages
    .map((message) => `${message.sender}: ${message.text}`)
    .join('\n')
    .slice(-12000)
}

async function generateChatTitle({ callOpenAi, text }) {
  try {
    const title = await callOpenAi(
      [
        {
          role: 'system',
          content:
            'Name this AI Council chat from the conversation. Return only a short title, maximum 7 words. No punctuation at the end.',
        },
        { role: 'user', content: text.slice(0, 6000) },
      ],
      { maxTokens: 30, temperature: 0.2, modelQuality: 'better' },
    )

    return normalizeText(title.replace(/^["']|["']$/g, ''), 80) || 'AI Council Chat'
  } catch (error) {
    console.warn('AI Council title generation failed.', error)
    return 'AI Council Chat'
  }
}

async function generateCouncilResponse({
  callOpenAi,
  callClaude,
  rules,
  member,
  messages,
  topic,
  extraInstruction = '',
  maxTokens = 700,
}) {
  const memberRule = rules[member]
  const context = buildConversationText(messages)
  const label = memberRule.label || member
  const loadedBrainInstruction = getRuleText(rules.moderator, 'runtimeInstructions.loadedBrain')
  const extra = normalizeLongText(`${loadedBrainInstruction}\n\n${extraInstruction}`, 5000)
  const provider = normalizeText(memberRule.provider, 40).toLowerCase() === 'anthropic'
    ? 'anthropic'
    : 'openai'
  const promptMessages = [
    {
      role: 'user',
      content: `Original topic:\n${topic}\n\nConversation so far:\n${context}\n\nRespond now as ${label}.`,
    },
  ]
  const model = normalizeText(memberRule.model, 120)

  if (provider === 'anthropic') {
    if (typeof callClaude !== 'function') {
      throw {
        status: 503,
        message: 'Anthropic Claude transport is not wired yet. Add ANTHROPIC_API_KEY and callClaude dependency.',
      }
    }

    return callClaude(promptMessages, {
      systemPrompt: `${memberRule.instructions}\n\n${extra}`.trim(),
      maxTokens,
      temperature: 0.45,
      modelQuality: 'better',
      model,
    })
  }

  return callOpenAi(
    [
      {
        role: 'system',
        content: `${memberRule.instructions}\n\n${extra}`.trim(),
      },
      ...promptMessages,
    ],
    {
      maxTokens,
      temperature: 0.45,
      modelQuality: 'better',
      model,
    },
  )
}

function buildCouncilWebResearchPrompt({
  rules,
  member,
  messages,
  topic,
  extraInstruction = '',
}) {
  const memberRule = rules[member]
  const context = buildConversationText(messages)
  const label = memberRule.label || member
  const loadedBrainInstruction = getRuleText(rules.moderator, 'runtimeInstructions.loadedBrain')
  const webResearchInstruction = getRuleText(memberRule, 'turnInstructions.webResearch')
  const instructions = normalizeLongText(
    [
      memberRule.instructions,
      loadedBrainInstruction,
      extraInstruction,
      webResearchInstruction,
      'You have live web search available in this turn. Use it now. Do not give Kal or Claude only a plan to search. Search and return sourced findings.',
    ].filter(Boolean).join('\n\n'),
    12000,
  )

  return [
    `You are ${label} in Kal's AI Council.`,
    instructions,
    `Original topic:\n${topic}`,
    `Conversation and loaded Company Brain context:\n${context}`,
    member === 'chatgpt'
      ? `Respond now as ${label}. Start with "Claude," unless Kal mentioned you directly. Include source links for live findings.`
      : `Respond now as ${label}. Start with "ChatGPT," for internal discussion unless Kal mentioned you directly. Include source links for live findings. If the research is sufficient or you decide to stop, end with exactly: AGREED`,
  ].join('\n\n')
}

async function exchangeGoogleRefreshToken({ clientId, clientSecret, refreshToken }) {
  const formData = new URLSearchParams()
  formData.set('client_id', clientId)
  formData.set('client_secret', clientSecret)
  formData.set('grant_type', 'refresh_token')
  formData.set('refresh_token', refreshToken)

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
      message: `Google token refresh failed: ${normalizeText(payload?.error_description || payload?.error || response.statusText, 500)}`,
    }
  }

  const accessToken = normalizeText(payload?.access_token, 8000)

  if (!accessToken) {
    throw { status: 502, message: 'Google token refresh did not return an access token.' }
  }

  const expiresInSeconds = Number(payload?.expires_in)

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

async function resolveGoogleAccessToken({ emailConnectionsCollection, connection }) {
  if (!connection) {
    throw {
      status: 409,
      message: 'Google is not connected yet. Connect Google in Admin Settings > Email, then reopen AI Council.',
    }
  }

  if (!isExpiredAt(connection.accessTokenExpiresAt, googleAccessTokenRefreshSkewMs) && connection.accessTokenEncrypted) {
    const accessToken = decryptSecret(connection.accessTokenEncrypted)

    if (accessToken) {
      return accessToken
    }
  }

  const refreshToken = decryptSecret(connection.refreshTokenEncrypted)

  if (!refreshToken) {
    throw {
      status: 409,
      message: 'Google connection is missing a refresh token. Reconnect Google to continue.',
    }
  }

  const googleConfig = resolveGoogleConfig()
  const normalizedToken = await exchangeGoogleRefreshToken({
    clientId: googleConfig.clientId,
    clientSecret: googleConfig.clientSecret,
    refreshToken,
  })
  const updatedAt = nowIso()
  const accessTokenEncrypted = encryptSecret(normalizedToken.accessToken)
  const refreshTokenEncrypted = encryptSecret(normalizedToken.refreshToken)

  await emailConnectionsCollection.updateOne(
    { provider: googleProviderId, uid: connection.uid },
    {
      $set: {
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt: normalizedToken.accessTokenExpiresAt,
        tokenType: normalizedToken.tokenType,
        scope: normalizedToken.scope || connection.scope || null,
        updatedAt,
        lastRefreshAt: updatedAt,
      },
    },
  )

  return normalizedToken.accessToken
}

async function fetchGoogleDriveJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: response.status === 403 ? 409 : 502,
      message: `Google Drive request failed: ${normalizeText(payload?.error?.message || response.statusText, 800)}`,
    }
  }

  return payload
}

async function fetchGoogleDriveText(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/plain',
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw {
      status: response.status === 403 ? 409 : 502,
      message: `Google Drive file read failed: ${normalizeText(payload?.error?.message || response.statusText, 800)}`,
    }
  }

  return response.text()
}

async function listDriveFilesInFolder({ accessToken, folderId, prefix = '', visitedFolders = new Set() }) {
  if (visitedFolders.has(folderId) || visitedFolders.size > 80) {
    return []
  }

  visitedFolders.add(folderId)
  const files = []
  let pageToken = ''

  do {
    const url = new URL(googleDriveFilesUrl)
    url.searchParams.set('q', `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`)
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, modifiedTime)')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('orderBy', 'folder,name')

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const payload = await fetchGoogleDriveJson(url, accessToken)
    const entries = Array.isArray(payload.files) ? payload.files : []

    for (const entry of entries) {
      const name = normalizeText(entry?.name, 260)
      const mimeType = normalizeText(entry?.mimeType, 200)
      const id = normalizeText(entry?.id, 260)

      if (!id || !name) {
        continue
      }

      if (mimeType === 'application/vnd.google-apps.folder') {
        files.push(...await listDriveFilesInFolder({
          accessToken,
          folderId: id,
          prefix: `${prefix}${name}/`,
          visitedFolders,
        }))
        continue
      }

      files.push({
        id,
        name,
        path: `${prefix}${name}`,
        mimeType,
        modifiedTime: normalizeText(entry?.modifiedTime, 80) || null,
      })

      if (files.length >= maxDriveBrainFiles) {
        return files
      }
    }

    pageToken = normalizeText(payload.nextPageToken, 500)
  } while (pageToken && files.length < maxDriveBrainFiles)

  return files
}

function isReadableDriveBrainFile(file) {
  const name = String(file?.name ?? '').toLowerCase()
  return name.endsWith('.md')
    || name.endsWith('.txt')
    || file.mimeType === 'text/markdown'
    || file.mimeType === 'text/plain'
    || file.mimeType === 'application/vnd.google-apps.document'
}

async function readDriveBrainFile({ accessToken, file }) {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const url = new URL(`${googleDriveFilesUrl}/${encodeURIComponent(file.id)}/export`)
    url.searchParams.set('mimeType', 'text/plain')
    return fetchGoogleDriveText(url, accessToken)
  }

  const url = new URL(`${googleDriveFilesUrl}/${encodeURIComponent(file.id)}`)
  url.searchParams.set('alt', 'media')
  return fetchGoogleDriveText(url, accessToken)
}

async function buildDriveBrainContext({ emailConnectionsCollection, uid }) {
  const connection = await emailConnectionsCollection.findOne({
    provider: googleProviderId,
    uid,
  })
  const accessToken = await resolveGoogleAccessToken({ emailConnectionsCollection, connection })
  const folderId = resolveDriveBrainFolderId()
  const files = (await listDriveFilesInFolder({ accessToken, folderId }))
    .filter(isReadableDriveBrainFile)
    .slice(0, maxDriveBrainFiles)
  const sections = []
  let totalChars = 0

  for (const file of files) {
    if (totalChars >= maxDriveBrainChars) {
      break
    }

    try {
      const rawText = await readDriveBrainFile({ accessToken, file })
      const remainingChars = maxDriveBrainChars - totalChars
      const text = normalizeLongText(rawText, remainingChars)

      if (!text) {
        continue
      }

      const section = `--- ${file.path} ---\n${text}`
      sections.push(section)
      totalChars += section.length
    } catch (error) {
      console.warn('Unable to read Drive brain file.', { file: file.path, error })
    }
  }

  return {
    folderId,
    filesRead: sections.length,
    context: sections.length > 0
      ? `=== GOOGLE DRIVE COMPANY BRAIN CONTEXT ===\n${sections.join('\n\n')}\n=== END GOOGLE DRIVE COMPANY BRAIN CONTEXT ===`
      : '',
  }
}

function createSystemMessage({ chatId, text, type = 'error' }) {
  return {
    id: randomUUID(),
    chatId,
    sender: 'System',
    text,
    type,
    createdAt: nowIso(),
  }
}

async function getGoogleDriveStatus(req, emailConnectionsCollection) {
  const configuredScopes = String(process.env.GOOGLE_OAUTH_SCOPES ?? '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
  const host = normalizeText(req.get?.('x-forwarded-host') || req.get?.('host'), 500)
  const protocol = normalizeText(req.get?.('x-forwarded-proto'), 20) || req.protocol || 'https'
  const uid = normalizeText(req.authUser?.uid, 200)
  const connection = uid
    ? await emailConnectionsCollection.findOne(
      { provider: googleProviderId, uid },
      { projection: { _id: 0, accessTokenEncrypted: 0, refreshTokenEncrypted: 0 } },
    )
    : null
  let brainFilesRead = 0
  let brainReadable = false
  let brainReadError = null

  if (connection && hasDriveScope(connection.scope)) {
    try {
      const driveBrain = await buildDriveBrainContext({ emailConnectionsCollection, uid })
      brainFilesRead = driveBrain.filesRead
      brainReadable = Boolean(driveBrain.context)
    } catch (error) {
      brainReadError = getSafeAiErrorMessage(error)
    }
  }

  return {
    googleClientConfigured: Boolean(
      normalizeText(process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID, 320)
      && normalizeText(process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET, 320),
    ),
    tokenEncryptionConfigured: Boolean(resolveTokenEncryptionSecret()),
    driveScopeConfigured: hasDriveScope([...configuredScopes, googleDriveScope].join(' ')),
    connected: Boolean(connection),
    connectedEmail: normalizeText(connection?.connectedEmail, 320) || null,
    grantedDriveScope: hasDriveScope(connection?.scope),
    grantedScopes: normalizeText(connection?.scope, 1500) || null,
    brainReadable,
    brainFilesRead,
    brainReadError,
    configuredRedirectUri:
      normalizeText(process.env.GOOGLE_REDIRECT_URI, 1000)
      || (host ? `${protocol}://${host}/auth/google/callback` : null),
    brainFolderId: resolveDriveBrainFolderId(),
    requiredDriveScope: googleDriveScope,
  }
}

export function registerAiCouncilRoutes(app, deps) {
  const {
    requireFirebaseAuth,
    requireAdminRole,
    getCollections,
    callClaude,
    callOpenAi,
    callOpenAiWebSearch,
  } = deps

  async function getStores() {
    const collections = await getCollections()
    const stores = getCouncilCollections(collections)
    await ensureCouncilIndexes(stores)
    return stores
  }

  app.get('/api/ai-council/status', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const { emailConnectionsCollection } = await getCollections()
      res.json({ googleDrive: await getGoogleDriveStatus(req, emailConnectionsCollection) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/ai-council/rules', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
    try {
      const { rulesCollection } = await getStores()
      const rules = await loadCouncilRules(rulesCollection)
      res.json({ rules })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/ai-council/rules/:member', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const member = normalizeText(req.params.member, 40).toLowerCase()

      if (!ruleMembers.includes(member)) {
        throw { status: 400, message: 'Unsupported council member.' }
      }

      const instructions = normalizeLongText(req.body?.instructions, 40000)
      const turnInstructions = req.body?.turnInstructions && typeof req.body.turnInstructions === 'object'
        ? req.body.turnInstructions
        : undefined
      const tags = req.body?.tags && typeof req.body.tags === 'object'
        ? req.body.tags
        : undefined
      const runtimeInstructions = req.body?.runtimeInstructions && typeof req.body.runtimeInstructions === 'object'
        ? req.body.runtimeInstructions
        : undefined

      if (!instructions) {
        throw { status: 400, message: 'Instructions cannot be empty.' }
      }

      const now = new Date().toISOString()
      const nextRule = {
        ...defaultCouncilRules[member],
        member,
        instructions,
        updatedAt: now,
      }

      if (turnInstructions) {
        nextRule.turnInstructions = turnInstructions
      }

      if (tags) {
        nextRule.tags = tags
      }

      if (runtimeInstructions) {
        nextRule.runtimeInstructions = runtimeInstructions
      }

      const { rulesCollection } = await getStores()
      await rulesCollection.updateOne(
        { member },
        {
          $set: nextRule,
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      )

      const rules = await loadCouncilRules(rulesCollection)
      res.json({ rule: rules[member], rules })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/ai-council/chats', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
    try {
      const requestedChatType = normalizeText(_req.query?.chatType, 40).toLowerCase()
      const requestedTargetMember = normalizeTargetMember(_req.query?.targetMember)
      const filters = { deletedAt: { $exists: false } }

      if (requestedChatType !== 'all') {
        if (requestedChatType === 'direct') {
          filters.chatType = 'direct'
        } else {
          filters.$or = [
            { chatType: 'council' },
            { chatType: { $exists: false } },
          ]
        }
      }

      if (filters.chatType === 'direct' && requestedTargetMember) {
        filters.targetMember = requestedTargetMember
      }

      const { chatsCollection } = await getStores()
      const chats = await chatsCollection
        .find(filters, { projection: { _id: 0 } })
        .sort({ pinned: -1, updatedAt: -1 })
        .limit(80)
        .toArray()

      res.json({ chats: chats.map(publicChatDoc) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/ai-council/chats', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const now = new Date().toISOString()
      const actor = getRequestActor(req)
      const chatType = normalizeChatType(req.body?.chatType)
      const targetMember = chatType === 'direct'
        ? normalizeTargetMember(req.body?.targetMember)
        : null

      if (chatType === 'direct' && !targetMember) {
        throw { status: 400, message: 'Direct chat requires targetMember (chatgpt or claude).' }
      }

      const defaultTitle = chatType === 'direct'
        ? `Direct: ${targetMember === 'claude' ? 'Claude' : 'ChatGPT'}`
        : 'New Chat'
      const chat = {
        id: randomUUID(),
        title: normalizeText(req.body?.title, 80) || defaultTitle,
        chatType,
        targetMember,
        pinned: false,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdByUid: actor.uid,
        createdByEmail: actor.email,
      }
      const { chatsCollection } = await getStores()
      await chatsCollection.insertOne(chat)
      res.status(201).json({ chat: publicChatDoc(chat) })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/ai-council/chats/:chatId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const now = new Date().toISOString()
      const updates = { updatedAt: now }

      if (typeof req.body?.pinned === 'boolean') {
        updates.pinned = req.body.pinned
      }

      if (req.body?.status === 'finished' || req.body?.status === 'active') {
        updates.status = req.body.status

        if (req.body.status === 'finished') {
          updates.finishedAt = now
        }
      }

      const { chatsCollection } = await getStores()
      const result = await chatsCollection.findOneAndUpdate(
        { id: chatId, deletedAt: { $exists: false } },
        { $set: updates },
        { returnDocument: 'after', projection: { _id: 0 } },
      )

      if (!result) {
        throw { status: 404, message: 'Chat not found.' }
      }

      res.json({ chat: publicChatDoc(result) })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/ai-council/chats/:chatId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const now = new Date().toISOString()
      const { chatsCollection } = await getStores()
      await chatsCollection.updateOne(
        { id: chatId },
        { $set: { deletedAt: now, updatedAt: now, status: 'deleted' } },
      )
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/ai-council/chats/:chatId/messages', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const { chatsCollection, messagesCollection } = await getStores()
      const chat = await chatsCollection.findOne(
        { id: chatId, deletedAt: { $exists: false } },
        { projection: { _id: 0 } },
      )

      if (!chat) {
        throw { status: 404, message: 'Chat not found.' }
      }

      const messages = await messagesCollection
        .find({ chatId }, { projection: { _id: 0 } })
        .sort({ createdAt: 1 })
        .limit(300)
        .toArray()

      res.json({ chat: publicChatDoc(chat), messages: messages.map(publicMessageDoc) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/ai-council/chats/:chatId/messages', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const text = normalizeLongText(req.body?.text, 16000)

      if (!text) {
        throw { status: 400, message: 'Message cannot be empty.' }
      }

      const now = new Date().toISOString()
      const actor = getRequestActor(req)
      const collections = await getCollections()
      const { chatsCollection, messagesCollection, rulesCollection } = getCouncilCollections(collections)
      await ensureCouncilIndexes({ chatsCollection, messagesCollection, rulesCollection })
      const chat = await chatsCollection.findOne(
        { id: chatId, deletedAt: { $exists: false } },
        { projection: { _id: 0 } },
      )

      if (!chat) {
        throw { status: 404, message: 'Chat not found.' }
      }

      const userMessage = {
        id: randomUUID(),
        chatId,
        sender: 'Kal',
        text,
        type: 'user',
        member: 'kal',
        createdAt: now,
        createdByUid: actor.uid,
        createdByEmail: actor.email,
      }

      await messagesCollection.insertOne(userMessage)

      const messages = await messagesCollection
        .find({ chatId }, { projection: { _id: 0 } })
        .sort({ createdAt: 1 })
        .limit(300)
        .toArray()

      const defaultTitle = normalizeChatType(chat.chatType) === 'direct'
        ? `Direct: ${normalizeTargetMember(chat.targetMember) === 'claude' ? 'Claude' : 'ChatGPT'}`
        : 'AI Council Chat'

      const nextTitle = !chat.title || /^New Chat\b/i.test(chat.title)
        ? normalizeText(text, 70) || defaultTitle
        : chat.title

      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            title: nextTitle,
            status: 'processing',
            processingMember: normalizeChatType(chat.chatType) === 'direct'
              ? (normalizeTargetMember(chat.targetMember) || 'chatgpt')
              : 'chatgpt',
            updatedAt: new Date().toISOString(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      res.json({
        chat: publicChatDoc(updatedChat),
        messages: [userMessage].map(publicMessageDoc),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/ai-council/chats/:chatId/moderator', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const text = normalizeLongText(req.body?.text, 1200)

      if (!text) {
        throw { status: 400, message: 'Moderator note cannot be empty.' }
      }

      const { chatsCollection, messagesCollection } = await getStores()
      const chat = await chatsCollection.findOne(
        { id: chatId, deletedAt: { $exists: false } },
        { projection: { _id: 0 } },
      )

      if (!chat) {
        throw { status: 404, message: 'Chat not found.' }
      }

      const message = {
        id: randomUUID(),
        chatId,
        sender: 'Moderator',
        text,
        type: 'moderator',
        createdAt: nowIso(),
      }

      await messagesCollection.insertOne(message)
      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: 'processing',
            processingMember: 'moderator',
            updatedAt: nowIso(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      res.json({
        chat: publicChatDoc(updatedChat),
        messages: [message].map(publicMessageDoc),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/ai-council/chats/:chatId/research-note', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const text = normalizeLongText(req.body?.text, 1600)

      if (!text) {
        throw { status: 400, message: 'Research note cannot be empty.' }
      }

      const { chatsCollection, messagesCollection } = await getStores()
      const chat = await chatsCollection.findOne(
        { id: chatId, deletedAt: { $exists: false } },
        { projection: { _id: 0 } },
      )

      if (!chat) {
        throw { status: 404, message: 'Chat not found.' }
      }

      const message = {
        id: randomUUID(),
        chatId,
        sender: 'Research',
        text,
        type: 'research',
        createdAt: nowIso(),
      }

      await messagesCollection.insertOne(message)
      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: 'researching',
            processingMember: 'research',
            updatedAt: nowIso(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      res.json({
        chat: publicChatDoc(updatedChat),
        messages: [message].map(publicMessageDoc),
      })
    } catch (error) {
      next(error)
    }
  })

  async function insertCouncilNote({
    chatId,
    sender,
    text,
    type,
    member = null,
    provider = null,
    status = 'processing',
    processingMember = null,
  }) {
    const normalizedText = normalizeLongText(text, 1800)

    if (!normalizedText) {
      return null
    }

    const { chatsCollection, messagesCollection } = await getStores()
    const chat = await chatsCollection.findOne(
      { id: chatId, deletedAt: { $exists: false } },
      { projection: { _id: 0 } },
    )

    if (!chat) {
      throw { status: 404, message: 'Chat not found.' }
    }

    const message = {
      id: randomUUID(),
      chatId,
      sender,
      text: normalizedText,
      type,
      member: normalizeText(member, 40).toLowerCase() || null,
      provider: normalizeText(provider, 40).toLowerCase() || null,
      createdAt: nowIso(),
    }

    await messagesCollection.insertOne(message)
    await chatsCollection.updateOne(
      { id: chatId },
      {
        $set: {
          status,
          processingMember,
          updatedAt: nowIso(),
        },
      },
    )

    return message
  }

  async function executeCouncilTurn({ req, chatId, member, options = {} }) {
    if (!aiCouncilMembers.includes(member)) {
      throw { status: 400, message: 'Unsupported council member.' }
    }

    const phase = normalizeText(options.phase, 40).toLowerCase()
    const reachedAgreement = options.agreed !== false
    const normalizedPhase = ['discussion', 'final', 'mention', 'research'].includes(phase) ? phase : 'discussion'

    const actor = getRequestActor(req)
    const collections = await getCollections()
    const { emailConnectionsCollection } = collections
    const { chatsCollection, messagesCollection, rulesCollection } = getCouncilCollections(collections)
    await ensureCouncilIndexes({ chatsCollection, messagesCollection, rulesCollection })
    const chat = await chatsCollection.findOne(
      { id: chatId, deletedAt: { $exists: false } },
      { projection: { _id: 0 } },
    )

    if (!chat) {
      throw { status: 404, message: 'Chat not found.' }
    }

    let messages = await messagesCollection
      .find({ chatId }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 })
      .limit(300)
      .toArray()
    const rules = await loadCouncilRules(rulesCollection)
    const maxDiscussionRounds = getMaxDiscussionRounds(rules)
    const round = Math.max(1, Math.min(maxDiscussionRounds, Number(options.round) || 1))
    const label = rules[member].label || member
    const memberRule = rules[member]
    const provider = normalizeText(memberRule.provider, 40).toLowerCase() === 'anthropic'
      ? 'anthropic'
      : 'openai'
    const topic = messages.find((message) => message.sender === 'Kal')?.text || ''
    let driveContext = ''
    let driveFilesRead = 0
    let driveErrorMessage = ''

    try {
      const driveBrain = await buildDriveBrainContext({
        emailConnectionsCollection,
        uid: actor.uid,
      })
      driveContext = driveBrain.context
      driveFilesRead = driveBrain.filesRead
    } catch (error) {
      driveErrorMessage = getSafeAiErrorMessage(error)
      console.warn('AI Council Drive context unavailable.', error)
    }

    if (!driveContext) {
      const text = driveErrorMessage
        ? `Google Drive brain is not available for this AI turn. ${driveErrorMessage}`
        : `Google Drive brain is connected, but no readable brain files were loaded from folder ${resolveDriveBrainFolderId()}. Add readable .md, .txt, or Google Docs files to that folder, or check that this Google account has access.`
      const errorMessage = createSystemMessage({ chatId, text })

      await messagesCollection.insertOne(errorMessage)
      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: 'active',
            processingMember: null,
            updatedAt: nowIso(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      return {
        chat: publicChatDoc(updatedChat),
        messages: [errorMessage].map(publicMessageDoc),
        error: text,
        failedMember: member,
        driveFilesRead,
        agreed: false,
      }
    }

    messages = [
      {
        id: 'drive-context',
        chatId,
        sender: 'Company Brain',
        text: driveContext,
        type: 'context',
        createdAt: nowIso(),
      },
      ...messages,
    ]

    await chatsCollection.updateOne(
      { id: chatId },
      {
        $set: {
          status: 'processing',
          processingMember: member,
          updatedAt: nowIso(),
        },
      },
    )

    let extraInstruction = ''
    let messageType = 'discussion'
    let maxTokens = 700

    if (normalizedPhase === 'mention') {
      messageType = 'final'
      extraInstruction = getRuleText(memberRule, 'turnInstructions.mention')
    } else if (normalizedPhase === 'research' && member === 'chatgpt') {
      messageType = 'research'
      maxTokens = 1100
      extraInstruction = options.direct === true
        ? getRuleText(memberRule, 'turnInstructions.researchDirect')
        : getRuleText(memberRule, 'turnInstructions.research')
    } else if (normalizedPhase === 'research' && member === 'claude') {
      messageType = 'research'
      maxTokens = 1100
      extraInstruction = options.direct === true
        ? getRuleText(memberRule, 'turnInstructions.researchDirect')
        : round >= maxDiscussionRounds
          ? getRuleText(memberRule, 'turnInstructions.researchFinalRound')
          : getRuleText(memberRule, 'turnInstructions.research')
    } else if (normalizedPhase === 'final' && member === 'claude') {
      messageType = 'final'
      maxTokens = 900
      extraInstruction = options.research === true
        ? getRuleText(memberRule, 'turnInstructions.researchFinal')
        : reachedAgreement
          ? getRuleText(memberRule, 'turnInstructions.finalAgreed')
          : getRuleText(memberRule, 'turnInstructions.finalForced')
    } else if (normalizedPhase === 'final' && member === 'chatgpt') {
      messageType = 'final'
      maxTokens = 220
      extraInstruction = getRuleText(memberRule, 'turnInstructions.final')
    } else if (member === 'chatgpt') {
      extraInstruction = getRuleText(memberRule, 'turnInstructions.discussion')
    } else {
      extraInstruction = round >= maxDiscussionRounds
        ? getRuleText(memberRule, 'turnInstructions.discussionFinalRound')
        : getRuleText(memberRule, 'turnInstructions.discussion')
    }

    let aiText = ''

    try {
      const isWebResearchTurn = normalizedPhase === 'research'
      const shouldUseWebSearch = isWebResearchTurn && member === 'chatgpt'

      if (shouldUseWebSearch) {
        if (typeof callOpenAiWebSearch !== 'function') {
          throw {
            status: 503,
            message: `Live web research is not wired for AI Council yet. ${label} research cannot continue without the web search tool.`,
          }
        }

        aiText = await callOpenAiWebSearch(
          buildCouncilWebResearchPrompt({
            rules,
            member,
            messages,
            topic,
            extraInstruction,
          }),
          {
            maxOutputTokens: 3000,
            searchContextSize: 'high',
            forceSearch: true,
          },
        )
      } else {
        aiText = await generateCouncilResponse({
          callClaude,
          callOpenAi,
          rules,
          member,
          messages,
          topic,
          extraInstruction,
          maxTokens,
        })
      }

      if (isBrainAccessMetaResponse(aiText)) {
        const correctedExtraInstruction = `${extraInstruction}\n\n${getRuleText(rules.moderator, 'runtimeInstructions.correction')}`

        if (shouldUseWebSearch) {
          aiText = await callOpenAiWebSearch(
            buildCouncilWebResearchPrompt({
              rules,
              member,
              messages,
              topic,
              extraInstruction: correctedExtraInstruction,
            }),
            {
              maxOutputTokens: 3000,
              searchContextSize: 'high',
              forceSearch: true,
            },
          )
        } else {
          aiText = await generateCouncilResponse({
            callClaude,
            callOpenAi,
            rules,
            member,
            messages,
            topic,
            extraInstruction: correctedExtraInstruction,
            maxTokens,
          })
        }
      }
    } catch (error) {
      const safeErrorMessage = getSafeAiErrorMessage(error)
      console.warn('AI Council turn failed.', {
        chatId,
        member,
        phase: normalizedPhase,
        error: safeErrorMessage,
      })

      const errorMessage = createSystemMessage({
        chatId,
        text: `${label} did not respond. ${safeErrorMessage}`,
      })

      await messagesCollection.insertOne(errorMessage)
      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: 'active',
            processingMember: null,
            updatedAt: nowIso(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      return {
        chat: publicChatDoc(updatedChat),
        messages: [errorMessage].map(publicMessageDoc),
        error: safeErrorMessage,
        failedMember: member,
        agreed: false,
      }
    }

    const normalizedAiText = normalizeLongText(aiText, 12000) || `${label} did not return a response.`
    const objectionReason = parseTokenPayload(normalizedAiText, 'OBJECTION')
    const loopDetectedReason = member === 'claude'
      ? parseTokenPayload(normalizedAiText, 'LOOP_DETECTED')
      : null
    const noteToKal = parseTokenPayload(normalizedAiText, 'NOTE_TO_KAL')
    const cleanedAiText = stripControlTokens(normalizedAiText) || normalizedAiText
    const aiIssue = member === 'chatgpt'
      && normalizedPhase !== 'final'
      && isAiIssueResponse(cleanedAiText)

    if (normalizedPhase === 'final' && member === 'chatgpt' && cleanedAiText.trim() === 'Done') {
      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: 'active',
            processingMember: null,
            updatedAt: nowIso(),
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })
      return {
        chat: publicChatDoc(updatedChat),
        messages: [],
        skipped: true,
        agreed: false,
      }
    }

    const message = {
      id: randomUUID(),
      chatId,
      sender: label,
      text: cleanedAiText,
      type: messageType,
      member,
      provider,
      createdAt: nowIso(),
    }
    const aiNoteMessage = noteToKal
      ? {
        id: randomUUID(),
        chatId,
        sender: 'AI Note',
        text: noteToKal,
        type: 'ai_note',
        member,
        provider,
        createdAt: nowIso(),
      }
      : null
    const isFinalTurn = normalizedPhase === 'final'
    const shouldStopDiscussion = Boolean(objectionReason || loopDetectedReason)
    const shouldFinishProcessing = (isFinalTurn && (member === 'chatgpt' || options.research === true))
      || (normalizedPhase === 'research' && options.direct === true)
      || normalizedPhase === 'mention'
      || shouldStopDiscussion
    const agreed = /(^|\b)AGREED(\b|$)/i.test(normalizedAiText)

    await messagesCollection.insertOne(message)

    if (aiNoteMessage) {
      await messagesCollection.insertOne(aiNoteMessage)
    }

    await chatsCollection.updateOne(
      { id: chatId },
      {
        $set: {
          status: shouldFinishProcessing ? 'active' : 'processing',
          processingMember: shouldFinishProcessing || isFinalTurn ? null : member,
          updatedAt: nowIso(),
        },
      },
    )

    const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

    const responseMessages = aiNoteMessage
      ? [message, aiNoteMessage]
      : [message]

    return {
      chat: publicChatDoc(updatedChat),
      messages: responseMessages.map(publicMessageDoc),
      agreed,
      aiIssue,
      objectionReason,
      loopDetectedReason,
      noteToKal,
    }
  }

  app.post('/api/ai-council/chats/:chatId/run', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const collections = await getCollections()
      const { chatsCollection, messagesCollection, rulesCollection } = getCouncilCollections(collections)
      await ensureCouncilIndexes({ chatsCollection, messagesCollection, rulesCollection })
      const chat = await chatsCollection.findOne(
        { id: chatId, deletedAt: { $exists: false } },
        { projection: { _id: 0 } },
      )

      if (!chat) {
        throw { status: 404, message: 'Chat not found.' }
      }

      const chatType = normalizeChatType(chat.chatType)
      const rules = await loadCouncilRules(rulesCollection)
      const tags = rules.moderator?.tags || {}
      const moderatorTag = (key, fallback) => normalizeLongText(tags[key], 1200) || fallback
      const existingMessages = await messagesCollection
        .find({ chatId }, { projection: { _id: 0 } })
        .sort({ createdAt: 1 })
        .limit(300)
        .toArray()
      const originalText = normalizeLongText(
        req.body?.text || [...existingMessages].reverse().find((message) => message.sender === 'Kal')?.text,
        16000,
      )
      const mentionTarget = originalText.match(/^@(Claude|ChatGPT)\b/i)?.[1]?.toLowerCase()
      const researchMode = isResearchRequest(originalText)
      const writtenMessages = []
      const memberLabel = (member) => (member === 'claude' ? 'Claude' : 'ChatGPT')

      const setChatOutcome = async ({ status, outcome, reason = '', byMember = null }) => {
        const now = nowIso()
        await chatsCollection.updateOne(
          { id: chatId },
          {
            $set: {
              status,
              outcome,
              outcomeReason: normalizeLongText(reason, 1600) || null,
              outcomeByMember: normalizeTargetMember(byMember),
              outcomeAt: now,
              finishedAt: now,
              processingMember: null,
              updatedAt: now,
            },
          },
        )

        return chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })
      }

      const settleActiveChat = async () => {
        await chatsCollection.updateOne(
          { id: chatId },
          {
            $set: {
              status: 'active',
              processingMember: null,
              updatedAt: nowIso(),
            },
            $unset: {
              outcome: '',
              outcomeReason: '',
              outcomeByMember: '',
              outcomeAt: '',
            },
          },
        )

        return chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })
      }

      const attachOutcomePayload = async (payload, spec) => {
        const updatedChat = await setChatOutcome(spec)

        return {
          ...payload,
          chat: publicChatDoc(updatedChat),
          outcome: spec.outcome,
          outcomeReason: normalizeLongText(spec.reason, 1600) || null,
          outcomeByMember: normalizeTargetMember(spec.byMember),
          writtenMessages,
        }
      }

      const maybeStopForControlToken = async (payload, member) => {
        const normalizedMember = normalizeTargetMember(member) || member

        if (payload?.objectionReason) {
          const reason = payload.objectionReason
          await writeModerator(`@Kal, ${memberLabel(normalizedMember)} raised OBJECTION and stopped this chat. Reason: ${reason}`)

          return attachOutcomePayload(payload, {
            status: 'ended_by_objection',
            outcome: 'ended_by_objection',
            reason,
            byMember: normalizedMember,
          })
        }

        if (normalizedMember === 'claude' && payload?.loopDetectedReason) {
          const reason = payload.loopDetectedReason
          await writeModerator(`@Kal, Claude ended the discussion with LOOP_DETECTED. ${reason}`)

          return attachOutcomePayload(payload, {
            status: 'ended_by_manager',
            outcome: 'ended_by_manager',
            reason,
            byMember: 'claude',
          })
        }

        return null
      }

      const writeModerator = async (text) => {
        const message = await insertCouncilNote({
          chatId,
          sender: 'Moderator',
          text,
          type: 'moderator',
          status: 'processing',
          processingMember: 'moderator',
        })

        if (message) writtenMessages.push(publicMessageDoc(message))
      }
      const writeResearch = async (text) => {
        const message = await insertCouncilNote({
          chatId,
          sender: 'Research',
          text,
          type: 'research',
          status: 'researching',
          processingMember: 'research',
        })

        if (message) writtenMessages.push(publicMessageDoc(message))
      }
      const stopForChatGptIssue = async () => {
        await writeModerator(moderatorTag(
          'chatgptIssue',
          '@Kal, ChatGPT has an issue, so I am stopping here. Please check the AI response, OpenAI key, or Google Drive brain connection before continuing.',
        ))
        await settleActiveChat()
      }

      if (chatType === 'direct') {
        const directMember = normalizeTargetMember(chat.targetMember) || mentionTarget || 'chatgpt'

        if (!directMember) {
          throw { status: 400, message: 'Direct chat has no valid targetMember.' }
        }

        if (researchMode) {
          await writeResearch(`${memberLabel(directMember)} direct research mode started.`)
          const payload = await executeCouncilTurn({
            req,
            chatId,
            member: directMember,
            options: { phase: 'research', round: 1, direct: true },
          })

          if (payload.error) {
            return res.json({ ...payload, writtenMessages })
          }

          const controlStopPayload = await maybeStopForControlToken(payload, directMember)

          if (controlStopPayload) {
            return res.json(controlStopPayload)
          }

          const updatedChat = await settleActiveChat()
          return res.json({ ...payload, chat: publicChatDoc(updatedChat), writtenMessages })
        }

        await writeModerator(`@${memberLabel(directMember)}, direct mode. Reply to Kal now.`)
        const payload = await executeCouncilTurn({
          req,
          chatId,
          member: directMember,
          options: { phase: 'mention' },
        })

        if (payload.error) {
          return res.json({ ...payload, writtenMessages })
        }

        const controlStopPayload = await maybeStopForControlToken(payload, directMember)

        if (controlStopPayload) {
          return res.json(controlStopPayload)
        }

        const updatedChat = await settleActiveChat()
        return res.json({ ...payload, chat: publicChatDoc(updatedChat), writtenMessages })
      }

      if (mentionTarget === 'claude' || mentionTarget === 'chatgpt') {
        if (researchMode) {
          await writeResearch(
            `${mentionTarget === 'claude' ? 'Claude' : 'ChatGPT'} direct research mode started. The response must separate confirmed facts from source gaps and must not invent deals, deadlines, agencies, prices, or contract numbers.`,
          )
          const payload = await executeCouncilTurn({
            req,
            chatId,
            member: mentionTarget,
            options: { phase: 'research', round: 1, direct: true },
          })

          if (payload.error) {
            return res.json({ ...payload, writtenMessages })
          }

          const controlStopPayload = await maybeStopForControlToken(payload, mentionTarget)

          if (controlStopPayload) {
            return res.json(controlStopPayload)
          }

          const updatedChat = await settleActiveChat()
          return res.json({ ...payload, chat: publicChatDoc(updatedChat), writtenMessages })
        }

        await writeModerator(moderatorTag(
          mentionTarget === 'claude' ? 'mentionClaude' : 'mentionChatGPT',
          mentionTarget === 'claude' ? '@Claude, please answer Kal directly.' : '@ChatGPT, please answer Kal directly.',
        ))
        const payload = await executeCouncilTurn({
          req,
          chatId,
          member: mentionTarget,
          options: { phase: 'mention' },
        })

        if (payload.error) {
          return res.json({ ...payload, writtenMessages })
        }

        const controlStopPayload = await maybeStopForControlToken(payload, mentionTarget)

        if (controlStopPayload) {
          return res.json(controlStopPayload)
        }

        const updatedChat = await settleActiveChat()
        return res.json({ ...payload, chat: publicChatDoc(updatedChat), writtenMessages })
      }

      let agreed = false
      const maxRounds = getMaxDiscussionRounds(rules)

      if (researchMode) {
        await writeResearch(
          'Research mode started. The Council must separate confirmed facts from source gaps and must not invent deals, deadlines, agencies, prices, or contract numbers.',
        )
        const researchRounds = Math.min(4, maxRounds)

        for (let round = 1; round <= researchRounds; round += 1) {
          await writeModerator(moderatorTag(
            round === 1 ? 'researchStart' : 'researchContinue',
            round === 1
              ? '@ChatGPT, start research. Bring findings and gaps to Claude.'
              : "@ChatGPT, continue the research discussion and fill Claude's gaps.",
          ))
          const chatgptPayload = await executeCouncilTurn({
            req,
            chatId,
            member: 'chatgpt',
            options: { phase: 'research', round },
          })

          if (chatgptPayload.error || chatgptPayload.aiIssue) {
            await stopForChatGptIssue()
            return res.json({ ...chatgptPayload, writtenMessages })
          }

          const chatgptStopPayload = await maybeStopForControlToken(chatgptPayload, 'chatgpt')

          if (chatgptStopPayload) {
            return res.json(chatgptStopPayload)
          }

          await writeModerator(moderatorTag(
            'researchReview',
            '@Claude, review ChatGPT research. Challenge gaps, do your own research, ask for more if needed, or end with AGREED.',
          ))
          const claudePayload = await executeCouncilTurn({
            req,
            chatId,
            member: 'claude',
            options: { phase: 'research', round },
          })
          agreed = Boolean(claudePayload.agreed)

          if (claudePayload.error) {
            await writeModerator(`@Kal, Claude has an issue, so I am stopping here. ${claudePayload.error}`)
            return res.json({ ...claudePayload, writtenMessages })
          }

          const claudeStopPayload = await maybeStopForControlToken(claudePayload, 'claude')

          if (claudeStopPayload) {
            return res.json(claudeStopPayload)
          }

          if (agreed) {
            break
          }
        }

        await writeModerator(moderatorTag(
          agreed ? 'claudeFinalAgreed' : 'claudeFinalForced',
          agreed
            ? '@Claude, you and ChatGPT agree. Give Kal the final answer.'
            : '@Claude, maximum discussion rounds reached. Give Kal the final answer now.',
        ))
        const finalPayload = await executeCouncilTurn({
          req,
          chatId,
          member: 'claude',
          options: { phase: 'final', agreed, research: true },
        })

        if (finalPayload.error) {
          return res.json({ ...finalPayload, writtenMessages })
        }

        const finalStopPayload = await maybeStopForControlToken(finalPayload, 'claude')

        if (finalStopPayload) {
          return res.json(finalStopPayload)
        }

        return res.json(await attachOutcomePayload(finalPayload, {
          status: agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
          outcome: agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
          reason: agreed
            ? 'Council reached AGREED and delivered final answer.'
            : 'Maximum discussion rounds reached before full agreement.',
          byMember: 'claude',
        }))
      }

      for (let round = 1; round <= maxRounds; round += 1) {
        await writeModerator(moderatorTag(
          round === 1 ? 'chatgptFirst' : 'chatgptContinue',
          round === 1
            ? '@ChatGPT, start the discussion with Claude.'
            : '@ChatGPT, respond to Claude so you can reach agreement.',
        ))
        const chatgptPayload = await executeCouncilTurn({
          req,
          chatId,
          member: 'chatgpt',
          options: { phase: 'discussion', round },
        })

        if (chatgptPayload.error || chatgptPayload.aiIssue) {
          await stopForChatGptIssue()
          return res.json({ ...chatgptPayload, writtenMessages })
        }

        const chatgptStopPayload = await maybeStopForControlToken(chatgptPayload, 'chatgpt')

        if (chatgptStopPayload) {
          return res.json(chatgptStopPayload)
        }

        await writeModerator(moderatorTag(
          'claudeDiscuss',
          '@Claude, respond to ChatGPT. If you are aligned, end with AGREED. If this is going nowhere, stop the discussion and end with AGREED.',
        ))
        const claudePayload = await executeCouncilTurn({
          req,
          chatId,
          member: 'claude',
          options: { phase: 'discussion', round },
        })
        agreed = Boolean(claudePayload.agreed)

        if (claudePayload.error) {
          await writeModerator(`@Kal, Claude has an issue, so I am stopping here. ${claudePayload.error}`)
          return res.json({ ...claudePayload, writtenMessages })
        }

        const claudeStopPayload = await maybeStopForControlToken(claudePayload, 'claude')

        if (claudeStopPayload) {
          return res.json(claudeStopPayload)
        }

        if (agreed) {
          break
        }
      }

      await writeModerator(moderatorTag(
        agreed ? 'claudeFinalAgreed' : 'claudeFinalForced',
        agreed
          ? '@Claude, you and ChatGPT agree. Give Kal the final answer.'
          : '@Claude, maximum discussion rounds reached. Give Kal the final answer now.',
      ))
      const finalPayload = await executeCouncilTurn({
        req,
        chatId,
        member: 'claude',
        options: { phase: 'final', agreed },
      })

      if (finalPayload.error) {
        return res.json({ ...finalPayload, writtenMessages })
      }

      const finalStopPayload = await maybeStopForControlToken(finalPayload, 'claude')

      if (finalStopPayload) {
        return res.json(finalStopPayload)
      }

      return res.json(await attachOutcomePayload(finalPayload, {
        status: agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
        outcome: agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
        reason: agreed
          ? 'Council reached AGREED and delivered final answer.'
          : 'Maximum discussion rounds reached before full agreement.',
        byMember: 'claude',
      }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/ai-council/chats/:chatId/turns/:member', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const chatId = normalizeText(req.params.chatId, 120)
      const member = normalizeText(req.params.member, 40).toLowerCase()

      if (!aiCouncilMembers.includes(member)) {
        throw { status: 400, message: 'Unsupported council member.' }
      }
      const payload = await executeCouncilTurn({
        req,
        chatId,
        member,
        options: {
          phase: normalizeText(req.body?.phase, 40).toLowerCase(),
          agreed: req.body?.agreed !== false,
          round: Number(req.body?.round) || 1,
          direct: req.body?.direct === true,
          research: req.body?.research === true,
        },
      })

      if (payload.error) {
        return res.json(payload)
      }

      const normalizedPhase = normalizeText(req.body?.phase, 40).toLowerCase()
      let outcomeSpec = null

      if (payload.objectionReason) {
        outcomeSpec = {
          status: 'ended_by_objection',
          outcome: 'ended_by_objection',
          reason: payload.objectionReason,
          byMember: member,
        }
      } else if (member === 'claude' && payload.loopDetectedReason) {
        outcomeSpec = {
          status: 'ended_by_manager',
          outcome: 'ended_by_manager',
          reason: payload.loopDetectedReason,
          byMember: 'claude',
        }
      } else if (normalizedPhase === 'final' && member === 'claude') {
        outcomeSpec = {
          status: payload.agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
          outcome: payload.agreed ? 'ended_by_agreement' : 'ended_by_round_limit',
          reason: payload.agreed
            ? 'Council reached AGREED and delivered final answer.'
            : 'Maximum discussion rounds reached before full agreement.',
          byMember: 'claude',
        }
      }

      if (!outcomeSpec) {
        return res.json(payload)
      }

      const now = nowIso()
      const { chatsCollection } = await getStores()

      await chatsCollection.updateOne(
        { id: chatId },
        {
          $set: {
            status: outcomeSpec.status,
            outcome: outcomeSpec.outcome,
            outcomeReason: normalizeLongText(outcomeSpec.reason, 1600) || null,
            outcomeByMember: normalizeTargetMember(outcomeSpec.byMember),
            outcomeAt: now,
            finishedAt: now,
            processingMember: null,
            updatedAt: now,
          },
        },
      )
      const updatedChat = await chatsCollection.findOne({ id: chatId }, { projection: { _id: 0 } })

      return res.json({
        ...payload,
        chat: publicChatDoc(updatedChat),
        outcome: outcomeSpec.outcome,
        outcomeReason: outcomeSpec.reason,
        outcomeByMember: outcomeSpec.byMember,
      })
    } catch (error) {
      next(error)
    }
  })
}
