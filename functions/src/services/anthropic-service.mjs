const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const FAST_MODEL = 'claude-3-5-haiku-latest'
const BETTER_MODEL = 'claude-sonnet-4-6'

function resolveModel(modelQuality, explicitModel) {
  const normalizedExplicit = String(explicitModel ?? '').trim()

  if (normalizedExplicit) {
    return normalizedExplicit
  }

  const normalized = String(modelQuality ?? '').trim().toLowerCase()

  if (normalized === 'better' || normalized === 'deep') {
    return BETTER_MODEL
  }

  return FAST_MODEL
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role ?? '').trim().toLowerCase()
      const normalizedRole = role === 'assistant' ? 'assistant' : 'user'
      const content = String(message?.content ?? '').trim()

      if (!content) {
        return null
      }

      return {
        role: normalizedRole,
        content,
      }
    })
    .filter(Boolean)
}

function parseAnthropicText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : []

  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block?.text ?? '').trim())
    .filter(Boolean)
    .join('')
    .trim()
}

export function createAnthropicService({ anthropicApiKey }) {
  async function callClaude(
    messages,
    {
      systemPrompt = '',
      maxTokens = 700,
      temperature = 0.45,
      modelQuality = 'better',
      model = '',
    } = {},
  ) {
    if (!anthropicApiKey) {
      throw {
        status: 503,
        message: 'Claude is not configured yet. Add ANTHROPIC_API_KEY to the server environment.',
      }
    }

    const normalizedMessages = normalizeMessages(messages)

    if (normalizedMessages.length === 0) {
      throw {
        status: 400,
        message: 'Claude call requires at least one message.',
      }
    }

    const requestBody = {
      model: resolveModel(modelQuality, model),
      system: String(systemPrompt ?? '').trim(),
      messages: normalizedMessages,
      max_tokens: maxTokens,
      temperature,
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      let errorMessage = `Anthropic API error (${response.status}).`

      try {
        const errorBody = await response.json()
        const details = String(
          errorBody?.error?.message
            || errorBody?.message
            || errorBody?.error?.type
            || '',
        ).trim()

        if (details) {
          errorMessage = details
        }
      } catch {
        // ignore parse failure
      }

      throw { status: 502, message: errorMessage }
    }

    const data = await response.json()
    const text = parseAnthropicText(data)

    if (!text) {
      throw { status: 502, message: 'Anthropic API returned no text.' }
    }

    return text
  }

  return {
    callClaude,
  }
}
