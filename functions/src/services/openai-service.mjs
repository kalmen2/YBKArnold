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

  return { generateSupportReply, batchSummarizeComments, chatForRules }
}
