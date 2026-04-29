const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MODEL = 'gpt-4o-mini'

export function createOpenAiService({ openAiApiKey }) {
  async function callOpenAi(messages, { maxTokens = 700, temperature = 0.65 } = {}) {
    if (!openAiApiKey) {
      throw {
        status: 503,
        message: 'AI is not configured yet. Add OPENAI_API_KEY to the server environment.',
      }
    }

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
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
  // Returns the reply text only (no subject, no meta-commentary).
  async function generateSupportReply({ subject, requesterName, comments, rules }) {
    const rulesSection =
      rules && rules.trim()
        ? `\n\nOperational rules to follow:\n${rules.trim()}`
        : ''

    const conversationLog = comments
      .map((comment) => {
        const prefix = comment.public === false ? '[Internal Note] ' : ''
        const body = String(comment.body ?? '').trim()
        return `${prefix}[${comment.authorName}]:\n${body}`
      })
      .join('\n\n---\n\n')

    const systemPrompt =
      `You are a professional customer support agent for Arnold Contract, a contract furniture manufacturer. ` +
      `Write clear, concise, and professional replies to customer support tickets. ` +
      `Be helpful, warm, and solution-focused. Keep replies brief and actionable. ` +
      `Return ONLY the reply text — no subject line, no signature placeholder, no meta-commentary.` +
      rulesSection

    const userPrompt =
      `Ticket subject: ${subject}\n` +
      `Requester: ${requesterName}\n\n` +
      `Conversation:\n${conversationLog}\n\n` +
      `Write a professional reply to the most recent message:`

    return callOpenAi(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 500, temperature: 0.6 },
    )
  }

  // Chat interface for developing rules for a given category.
  // The AI always includes a ---RULES--- block when it has a rules update.
  // Returns { message: string, newRules: string | null }
  async function chatForRules({ category, messages, currentRules }) {
    const categoryLabel = String(category ?? '').trim() || 'general'
    const currentRulesSection =
      currentRules && currentRules.trim()
        ? `Current ${categoryLabel} rules:\n${currentRules.trim()}`
        : `No ${categoryLabel} rules defined yet.`

    const systemPrompt =
      `You are an AI assistant helping an admin team define operational rules for Arnold Contract's ${categoryLabel} operations. ` +
      `Rules must be extremely concise — short bullet points, max 1-2 sentences each, as few words as possible. ` +
      `Ask clarifying questions if needed. ` +
      `Whenever you have a complete or updated rules list (even a first draft), include it in a ---RULES--- block at the END of your response, formatted as:\n` +
      `---RULES---\n• rule one\n• rule two\n\n` +
      `${currentRulesSection}`

    const openAiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: String(m.role ?? ''),
        content: String(m.content ?? ''),
      })),
    ]

    const rawResponse = await callOpenAi(openAiMessages, { maxTokens: 700, temperature: 0.65 })

    // Split on the ---RULES--- delimiter
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

  return { generateSupportReply, chatForRules }
}
