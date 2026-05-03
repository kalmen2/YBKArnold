const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const FAST_MODEL = 'gpt-4o-mini'
const BETTER_MODEL = 'gpt-4o'

function resolveModel(modelQuality) {
  const normalized = String(modelQuality ?? '').trim().toLowerCase()

  if (normalized === 'better' || normalized === 'deep') {
    return BETTER_MODEL
  }

  return FAST_MODEL
}

function resolveRuleChatOptions(modelQuality, category) {
  const normalized = String(modelQuality ?? '').trim().toLowerCase()
  const normalizedCategory = String(category ?? '').trim().toLowerCase()
  const isGeneralCategory = normalizedCategory === 'general'

  if (normalized === 'deep') {
    return isGeneralCategory
      ? { maxTokens: 2200, temperature: 0.42, modelQuality: 'deep' }
      : { maxTokens: 1300, temperature: 0.45, modelQuality: 'deep' }
  }

  if (normalized === 'better') {
    return isGeneralCategory
      ? { maxTokens: 1600, temperature: 0.5, modelQuality: 'better' }
      : { maxTokens: 950, temperature: 0.55, modelQuality: 'better' }
  }

  return isGeneralCategory
    ? { maxTokens: 1100, temperature: 0.6, modelQuality: 'fast' }
    : { maxTokens: 700, temperature: 0.65, modelQuality: 'fast' }
}

export function createOpenAiService({ openAiApiKey }) {
  async function callOpenAi(
    messages,
    { maxTokens = 700, temperature = 0.65, jsonMode = false, modelQuality = 'fast' } = {},
  ) {
    if (!openAiApiKey) {
      throw {
        status: 503,
        message: 'AI is not configured yet. Add OPENAI_API_KEY to the server environment.',
      }
    }

    const requestBody = {
      model: resolveModel(modelQuality),
      messages,
      max_tokens: maxTokens,
      temperature,
    }

    if (jsonMode) {
      requestBody.response_format = { type: 'json_object' }
    }

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      let errorMessage = `OpenAI API error (${response.status}).`

      try {
        const errorBody = await response.json()

        if (errorBody?.error?.message) {
          errorMessage = errorBody.error.message
        }
      } catch {
        // ignore parse failure
      }

      throw { status: 502, message: errorMessage }
    }

    const data = await response.json()
    return String(data?.choices?.[0]?.message?.content ?? '').trim()
  }

  // Generates a professional draft reply for a Zendesk support ticket.
  // authorName is the logged-in agent's Zendesk display name — AI always signs as them.
  async function generateSupportReply({
    subject,
    requesterName,
    comments,
    generalRules,
    supportRules,
    businessContext,
    authorName,
    draftHint,
  }) {
    const generalRulesSection =
      generalRules && generalRules.trim()
        ? `\n\nGeneral business document and rules to apply first:\n${generalRules.trim()}`
        : ''
    const supportRulesSection =
      supportRules && supportRules.trim()
        ? `\n\nSupport-specific rules to apply after General rules:\n${supportRules.trim()}`
        : ''
    const businessContextSection =
      businessContext && businessContext.trim()
        ? `\n\nBusiness context summary from database:\n${businessContext.trim()}`
        : ''

    const signOff =
      authorName && authorName.trim()
        ? `\n\nAlways end your reply with this exact sign-off:\nBest regards,\n${authorName.trim()}`
        : ''

    const conversationLog = comments
      .map((comment) => {
        const prefix = comment.public === false ? '[Internal Note] ' : ''
        const body = String(comment.body ?? '').trim()
        return `${prefix}[${comment.authorName}]:\n${body}`
      })
      .join('\n\n---\n\n')

    const systemPrompt =
      `Return ONLY the reply text — no subject line, no meta-commentary. ` +
      `Use this order of context: General business document first, Support rules second, business context summary third, ticket conversation fourth.` +
      generalRulesSection +
      supportRulesSection +
      businessContextSection +
      signOff

    const draftSection =
      draftHint && draftHint.trim()
        ? `\n\nThe agent has started writing this reply — improve it, make it more professional and complete, keep the same intent:\n${draftHint.trim()}\n\nNow write the improved reply:`
        : `\n\nWrite a professional reply to the most recent message:`

    const userPrompt =
      `Ticket subject: ${subject}\n` +
      `Requester: ${requesterName}\n\n` +
      `Conversation:\n${conversationLog}` +
      draftSection

    return callOpenAi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 850, temperature: 0.45, modelQuality: 'deep' },
    )
  }

  // Batch-summarize an array of comments in a single OpenAI call.
  // Returns { [commentId: number]: summaryString }
  async function batchSummarizeComments(
    comments,
    { generalRules, summaryRules, businessContext } = {},
  ) {
    if (!Array.isArray(comments) || comments.length === 0) {
      return {}
    }

    const commentList = comments
      .map((c) => {
        const body = String(c.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
        return `"${c.id}": "${body}"`
      })
      .join('\n')

    const generalRulesSection =
      generalRules && generalRules.trim()
        ? `Company-wide business rules:\n${generalRules.trim()}\n\n`
        : ''
    const summaryRulesSection =
      summaryRules && summaryRules.trim()
        ? `${summaryRules.trim()}\n\n`
        : ''
    const businessContextSection =
      businessContext && businessContext.trim()
        ? `Business context summary:\n${businessContext.trim()}\n\n`
        : ''

    const systemPrompt =
      generalRulesSection +
      summaryRulesSection +
      businessContextSection +
      `Return ONLY valid JSON with comment IDs as string keys and the summary as the value. ` +
      `Example format: {"12345": "Order arrived damaged", "12346": "Requested replacement"}`

    const raw = await callOpenAi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: commentList },
      ],
      {
        maxTokens: Math.min(1200, 150 + comments.length * 45),
        temperature: 0.25,
        jsonMode: true,
        modelQuality: 'fast',
      },
    )

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }

    const result = {}
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key)
      if (Number.isFinite(id) && id > 0 && typeof value === 'string') {
        result[id] = String(value).trim()
      }
    }

    return result
  }

  // Chat interface for developing rules for a given category.
  // Returns { message: string, newRules: string | null }
  async function chatForRules({
    category,
    messages,
    currentRules,
    generalRules,
    businessContext,
    modelQuality,
  }) {
    const categoryLabel = String(category ?? '').trim() || 'general'
    const isGeneralCategory = categoryLabel === 'general'
    const currentRulesSection =
      currentRules && currentRules.trim()
        ? `Current ${categoryLabel} rules:\n${currentRules.trim()}`
        : `No ${categoryLabel} rules defined yet.`
    const generalRulesSection =
      isGeneralCategory || !generalRules || !generalRules.trim()
        ? ''
        : `\n\nCurrent general business rules, for context only:\n${generalRules.trim()}`
    const businessContextSection =
      businessContext && businessContext.trim()
        ? `\n\nDatabase business context loaded by the server for this request:\n${businessContext.trim()}`
        : ''

    const systemPrompt = isGeneralCategory
      ? (
        `You are an AI business analyst helping Arnold Contract admins build the master General business document used to train company AI behavior. ` +
        `You are allowed to hold a full conversation about the business and write long-form content. ` +
        `When asked for a full company picture or a 2-page explanation, provide a detailed structured write-up with clear sections and practical detail. ` +
        `The server has already searched available business data for this request. Never say you cannot search or browse the database when business context is provided. ` +
        `If something specific is missing from context, call it out and ask one focused follow-up question. ` +
        `When the admin asks to save/update the General document, end with a ---RULES--- block containing the full document text exactly as it should be saved. ` +
        `If the admin is still brainstorming, do not include ---RULES--- yet. ` +
        `You may use headings, short paragraphs, and bullet points in the document.` +
        `\n\n` +
        `${currentRulesSection}` +
        businessContextSection
      )
      : (
        `You are an AI assistant helping an admin team define operational rules for Arnold Contract's ${categoryLabel} operations. ` +
        `You only create or update rule bullets. Do not answer customer support, CRM, order, or operational questions directly. ` +
        `When the admin gives examples or corrections, use business context to propose better rules. ` +
        `Rules must be concise and actionable. ` +
        `If you need to clarify something, ask at most ONE question at a time, then propose rules after the answer. ` +
        `When you have an updated rules list, ask for confirmation in plain text and then end with a ---RULES--- block containing ONLY rule bullet points:\n` +
        `---RULES---\n• rule one\n• rule two\n\n` +
        `The ---RULES--- block must contain only rule bullet points, no commentary.\n\n` +
        `${currentRulesSection}` +
        generalRulesSection +
        businessContextSection
      )

    const openAiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: String(m.role ?? ''),
        content: String(m.content ?? ''),
      })),
    ]

    const options = resolveRuleChatOptions(modelQuality, categoryLabel)
    const rawResponse = await callOpenAi(openAiMessages, options)

    const splitIndex = rawResponse.indexOf('\n---RULES---\n')
    let messageText = rawResponse.trim()
    let newRules = null

    if (splitIndex !== -1) {
      messageText = rawResponse.slice(0, splitIndex).trim()
      newRules = rawResponse.slice(splitIndex + '\n---RULES---\n'.length).trim() || null
    } else if (rawResponse.startsWith('---RULES---\n')) {
      messageText = ''
      newRules = rawResponse.slice('---RULES---\n'.length).trim() || null
    }

    return { message: messageText, newRules }
  }

  async function findExactItemPurchaseOptions({
    itemName,
    itemSearchProfile,
    deliveryLocation,
    referencePrice,
    candidates,
  }) {
    const normalizedItemName = String(itemName ?? '').trim()
    const normalizedDeliveryLocation = String(deliveryLocation ?? '').trim() || 'United States (USA)'
    const normalizedProfile = itemSearchProfile && typeof itemSearchProfile === 'object'
      ? {
          original: String(itemSearchProfile.original ?? '').trim().slice(0, 320),
          preferredDescriptor: String(itemSearchProfile.preferredDescriptor ?? '').trim().slice(0, 260),
          keyTerms: (Array.isArray(itemSearchProfile.keyTerms) ? itemSearchProfile.keyTerms : [])
            .map((term) => String(term ?? '').trim())
            .filter(Boolean)
            .slice(0, 20),
        }
      : null

    function extractUnitPriceFromText(value) {
      const text = String(value ?? '')

      if (!text) {
        return null
      }

      const pattern = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g
      let match = pattern.exec(text)
      let bestPrice = null

      while (match) {
        const amount = Number(String(match[1] ?? '').replace(/,/g, ''))

        if (Number.isFinite(amount) && amount > 0.01 && amount < 1_000_000) {
          bestPrice = bestPrice == null ? amount : Math.min(bestPrice, amount)
        }

        match = pattern.exec(text)
      }

      return bestPrice == null ? null : Number(bestPrice.toFixed(2))
    }

    function resolveVendorNameFromUrl(value) {
      try {
        const host = new URL(String(value ?? '')).hostname.replace(/^www\./i, '')

        if (!host) {
          return 'Unknown vendor'
        }

        const first = host.split('.')[0] || host
        return first
          .replace(/[-_]+/g, ' ')
          .trim()
          .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unknown vendor'
      } catch {
        return 'Unknown vendor'
      }
    }

    const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
      .slice(0, 12)
      .map((candidate, index) => {
        const url = String(candidate?.url ?? '').trim()
        const title = String(candidate?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 260)
        const snippet = String(candidate?.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
        const pageExcerpt = String(candidate?.pageExcerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 2400)
        const detectedUnitPrice = extractUnitPriceFromText(`${title}\n${snippet}\n${pageExcerpt}`)

        if (!url || !/^https?:\/\//i.test(url)) {
          return null
        }

        return {
          index,
          url,
          title,
          snippet,
          pageExcerpt,
          detectedUnitPrice,
        }
      })
      .filter(Boolean)

    if (!normalizedItemName) {
      throw {
        status: 400,
        message: 'itemName is required for AI sourcing.',
      }
    }

    if (normalizedCandidates.length === 0) {
      return { options: [], excludedCount: 0 }
    }

    function buildFallbackOptions(maxItems = 6) {
      return normalizedCandidates.slice(0, maxItems).map((candidate) => {
        const inferredPrice = Number(candidate.detectedUnitPrice)
        const unitPrice = Number.isFinite(inferredPrice) && inferredPrice > 0
          ? Number(inferredPrice.toFixed(2))
          : null
        const notes = unitPrice == null
          ? 'Auto fallback candidate from web search. Price unavailable from preview evidence.'
          : 'Auto fallback candidate from web search.'

        return {
          sourceCandidateIndex: candidate.index,
          vendorName: resolveVendorNameFromUrl(candidate.url),
          productTitle: candidate.title || normalizedItemName,
          url: candidate.url,
          unitPrice,
          currency: 'USD',
          shippingEvidence: candidate.snippet,
          exactMatchEvidence: candidate.title || candidate.snippet,
          notes,
        }
      })
    }

    const referencePriceLabel = Number.isFinite(Number(referencePrice))
      ? `$${Number(referencePrice).toFixed(2)}`
      : 'unknown'
    const systemPrompt =
      'You are a procurement analyst. Return ONLY valid JSON. ' +
      'Only use candidate URLs and evidence provided by the server. Never invent URLs, vendors, titles, prices, or shipping details. ' +
      'Prioritize exact matches, but include likely matches when certainty is limited and explain uncertainty in notes.'

    const profileSection = normalizedProfile
      ? `\nNormalized exact-item profile:\n${JSON.stringify(normalizedProfile)}\n`
      : ''
    const userPrompt =
      `Reference item to source: ${normalizedItemName}\n` +
      `Current internal reference price: ${referencePriceLabel}\n` +
      `Delivery market: ${normalizedDeliveryLocation}\n\n` +
      'Goal: return useful supplier listing links for this item. Include best candidates even when price is unavailable.\n\n' +
      profileSection +
      'Candidate evidence JSON:\n' +
      JSON.stringify(normalizedCandidates)

    const raw = await callOpenAi(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            userPrompt +
            '\n\nReturn this JSON schema exactly:\n' +
            '{"options":[{"sourceCandidateIndex":0,"vendorName":"","productTitle":"","url":"","unitPrice":null,"currency":"USD","shipsToUsa":true,"shippingEvidence":"","exactMatchEvidence":"","notes":""}],"exclusions":[{"sourceCandidateIndex":0,"reason":""}]}' +
            '\nRules: options[].sourceCandidateIndex must refer to a provided candidate index. unitPrice can be null when unavailable. Use USD currency when the page does not explicitly show a currency.',
        },
      ],
      {
        maxTokens: 1800,
        temperature: 0.1,
        jsonMode: true,
        modelQuality: 'deep',
      },
    )

    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      // jsonMode can still occasionally return wrapped/non-strict JSON; recover best-effort.
      const looseJsonMatch = String(raw ?? '').match(/\{[\s\S]*\}/)

      if (looseJsonMatch) {
        try {
          parsed = JSON.parse(looseJsonMatch[0])
        } catch {
          parsed = null
        }
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      const fallbackOptions = buildFallbackOptions(6)
      return {
        options: fallbackOptions,
        excludedCount: Math.max(0, normalizedCandidates.length - fallbackOptions.length),
      }
    }

    const candidateByIndex = new Map(normalizedCandidates.map((candidate) => [candidate.index, candidate]))
    const seenUrls = new Set()
    const normalizedOptions = (Array.isArray(parsed?.options) ? parsed.options : [])
      .map((option) => {
        const sourceCandidateIndex = Number(option?.sourceCandidateIndex)
        const sourceCandidate = candidateByIndex.get(sourceCandidateIndex)

        if (!sourceCandidate) {
          return null
        }

        const aiPrice = Number(option?.unitPrice)
        const inferredPrice = Number(sourceCandidate.detectedUnitPrice)
        const hasAiPrice = Number.isFinite(aiPrice) && aiPrice > 0
        const hasInferredPrice = Number.isFinite(inferredPrice) && inferredPrice > 0
        const unitPrice = hasAiPrice
          ? Number(aiPrice.toFixed(2))
          : hasInferredPrice
            ? Number(inferredPrice.toFixed(2))
            : null
        const shippingEvidence = String(option?.shippingEvidence ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
        const shipsToUsa =
          typeof option?.shipsToUsa === 'boolean'
            ? option.shipsToUsa
            : typeof option?.shipsToNewJersey === 'boolean'
              ? option.shipsToNewJersey
              : null

        const baseNotes = String(option?.notes ?? '').replace(/\s+/g, ' ').trim()
        const notes = (
          shipsToUsa === false
            ? `${baseNotes}${baseNotes ? ' ' : ''}Marked as non-U.S. supplier by AI output.`
            : baseNotes
        )
          .trim()
        const notesWithPriceContext = (
          unitPrice == null
            ? `${notes}${notes ? ' ' : ''}Price unavailable from preview evidence.`
            : notes
        )
          .trim()
          .slice(0, 400)

        if (seenUrls.has(sourceCandidate.url)) {
          return null
        }
        seenUrls.add(sourceCandidate.url)

        return {
          sourceCandidateIndex,
          vendorName: String(option?.vendorName ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || resolveVendorNameFromUrl(sourceCandidate.url),
          productTitle: String(option?.productTitle ?? sourceCandidate.title).replace(/\s+/g, ' ').trim().slice(0, 260),
          url: sourceCandidate.url,
          unitPrice,
          currency: String(option?.currency ?? 'USD').replace(/\s+/g, ' ').trim().slice(0, 12) || 'USD',
          shippingEvidence: shippingEvidence || sourceCandidate.snippet,
          exactMatchEvidence: String(option?.exactMatchEvidence ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) || sourceCandidate.title,
          notes: notesWithPriceContext,
        }
      })
      .filter(Boolean)

    const resultOptions = normalizedOptions.length > 0
      ? normalizedOptions
      : buildFallbackOptions(6)

    return {
      options: resultOptions,
      excludedCount: Math.max(0, normalizedCandidates.length - resultOptions.length),
    }
  }

  async function resolvePurchasingItemSearchMatches({
    query,
    candidates,
    maxMatches = 12,
  }) {
    const normalizedQuery = String(query ?? '').trim().slice(0, 260)
    const resolvedLimit = Math.min(Math.max(Number(maxMatches) || 12, 1), 25)
    const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
      .slice(0, 260)
      .map((candidate, index) => {
        const itemKey = String(candidate?.itemKey ?? '').trim().slice(0, 220)
        const itemRaw = String(candidate?.itemRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 320)
        const descriptions = (Array.isArray(candidate?.descriptions) ? candidate.descriptions : [])
          .map((description) => String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, 240))
          .filter(Boolean)
          .slice(0, 4)
        const vendorRaws = (Array.isArray(candidate?.vendorRaws) ? candidate.vendorRaws : [])
          .map((vendorRaw) => String(vendorRaw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 6)

        if (!itemKey || !itemRaw) {
          return null
        }

        return {
          sourceCandidateIndex: index,
          itemKey,
          itemRaw,
          descriptions,
          vendorRaws,
        }
      })
      .filter(Boolean)

    if (!normalizedQuery || normalizedCandidates.length === 0) {
      return {
        matches: [],
        usedFallback: false,
      }
    }

    function normalizeComparableText(value) {
      return String(value ?? '')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[^a-z0-9./+ -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function tokenizeComparableText(value) {
      return normalizeComparableText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    }

    function buildFallbackMatches() {
      const normalizedComparableQuery = normalizeComparableText(normalizedQuery)
      const queryTokens = tokenizeComparableText(normalizedQuery)

      if (!normalizedComparableQuery || queryTokens.length === 0) {
        return normalizedCandidates
          .slice(0, resolvedLimit)
          .map((candidate, index) => ({
            sourceCandidateIndex: candidate.sourceCandidateIndex,
            confidence: Number((Math.max(0.3, 0.85 - index * 0.08)).toFixed(2)),
            reason: 'Fallback match based on available search candidates.',
          }))
      }

      const queryTokenSet = new Set(queryTokens)

      const scored = normalizedCandidates
        .map((candidate) => {
          const candidateComposite = [
            candidate.itemRaw,
            ...candidate.descriptions,
            ...candidate.vendorRaws,
          ].join(' ')
          const candidateNormalized = normalizeComparableText(candidateComposite)
          const candidateTokens = tokenizeComparableText(candidateComposite)

          if (!candidateNormalized || candidateTokens.length === 0) {
            return null
          }

          const overlapCount = [...queryTokenSet]
            .filter((token) => candidateTokens.some((candidateToken) =>
              candidateToken === token
              || candidateToken.startsWith(token)
              || token.startsWith(candidateToken)))
            .length
          const tokenOverlapScore = overlapCount / Math.max(queryTokenSet.size, 1)
          const containsWholeQuery = candidateNormalized.includes(normalizedComparableQuery)
          const containsMostTokens = overlapCount >= Math.max(1, Math.ceil(queryTokenSet.size * 0.65))
          const phraseBonus = containsWholeQuery ? 0.4 : containsMostTokens ? 0.2 : 0
          const score = Number(Math.min(1, tokenOverlapScore * 0.7 + phraseBonus).toFixed(4))

          if (score <= 0.08) {
            return null
          }

          return {
            sourceCandidateIndex: candidate.sourceCandidateIndex,
            confidence: Number(Math.max(0.2, Math.min(0.95, score)).toFixed(2)),
            reason: containsWholeQuery
              ? 'Candidate includes the full normalized query text.'
              : 'Candidate shares most query tokens.',
            score,
          }
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score)

      if (scored.length > 0) {
        return scored.slice(0, resolvedLimit).map(({ score, ...match }) => match)
      }

      return normalizedCandidates
        .slice(0, resolvedLimit)
        .map((candidate, index) => ({
          sourceCandidateIndex: candidate.sourceCandidateIndex,
          confidence: Number((Math.max(0.25, 0.75 - index * 0.07)).toFixed(2)),
          reason: 'Fallback ordering by available candidate quality.',
        }))
    }

    const systemPrompt =
      'You are matching a purchasing item search query to the exact intended item from a candidate list. ' +
      'Return ONLY strict JSON. Prefer exact material/spec/size matches. Penalize unrelated items, close-but-not-same variants, and vendor-only matches.'

    const userPrompt =
      `Search query: ${normalizedQuery}\n` +
      'Candidate items JSON:\n' +
      JSON.stringify(normalizedCandidates) +
      '\n\nReturn this schema exactly:\n' +
      '{"matches":[{"sourceCandidateIndex":0,"confidence":0.91,"reason":""}]}' +
      `\nRules: return at most ${resolvedLimit} matches sorted best-first. confidence is 0..1. sourceCandidateIndex must map to provided candidates.`

    let parsed = null

    try {
      const raw = await callOpenAi(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        {
          maxTokens: 900,
          temperature: 0.1,
          jsonMode: true,
          modelQuality: 'better',
        },
      )

      try {
        parsed = JSON.parse(raw)
      } catch {
        const looseJsonMatch = String(raw ?? '').match(/\{[\s\S]*\}/)

        if (looseJsonMatch) {
          try {
            parsed = JSON.parse(looseJsonMatch[0])
          } catch {
            parsed = null
          }
        }
      }
    } catch {
      parsed = null
    }

    const validIndexes = new Set(normalizedCandidates.map((candidate) => candidate.sourceCandidateIndex))
    const seenIndexes = new Set()
    const parsedMatches = (Array.isArray(parsed?.matches) ? parsed.matches : [])
      .map((match) => {
        const sourceCandidateIndex = Number(match?.sourceCandidateIndex)

        if (!Number.isInteger(sourceCandidateIndex) || !validIndexes.has(sourceCandidateIndex)) {
          return null
        }

        if (seenIndexes.has(sourceCandidateIndex)) {
          return null
        }

        seenIndexes.add(sourceCandidateIndex)

        const confidenceRaw = Number(match?.confidence)
        const confidence = Number.isFinite(confidenceRaw)
          ? Number(Math.max(0, Math.min(1, confidenceRaw)).toFixed(2))
          : 0.55

        return {
          sourceCandidateIndex,
          confidence,
          reason: String(match?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 260),
        }
      })
      .filter(Boolean)
      .slice(0, resolvedLimit)

    if (parsedMatches.length > 0) {
      return {
        matches: parsedMatches,
        usedFallback: false,
      }
    }

    return {
      matches: buildFallbackMatches(),
      usedFallback: true,
    }
  }

  return {
    generateSupportReply,
    batchSummarizeComments,
    chatForRules,
    findExactItemPurchaseOptions,
    resolvePurchasingItemSearchMatches,
  }
}
