import { createHmac, timingSafeEqual } from 'node:crypto'

const slackApiBaseUrl = 'https://slack.com/api'
const processedEventIds = new Map()
const processedEventTtlMs = 10 * 60 * 1000

function normalizeText(value, maxLength = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function parseAllowedChannelIds(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

function pruneProcessedEvents(now = Date.now()) {
  for (const [eventId, expiresAt] of processedEventIds.entries()) {
    if (expiresAt <= now) {
      processedEventIds.delete(eventId)
    }
  }
}

function rememberEvent(eventId) {
  const normalizedEventId = normalizeText(eventId, 120)

  if (!normalizedEventId) {
    return false
  }

  const now = Date.now()
  pruneProcessedEvents(now)

  if (processedEventIds.has(normalizedEventId)) {
    return true
  }

  processedEventIds.set(normalizedEventId, now + processedEventTtlMs)
  return false
}

function extractMentionText(text, botUserId) {
  const normalizedText = String(text ?? '')
  const botMention = botUserId ? new RegExp(`<@${botUserId}>`, 'g') : null
  const withoutBotMention = botMention
    ? normalizedText.replace(botMention, '')
    : normalizedText.replace(/<@[A-Z0-9]+>/g, '')

  return withoutBotMention.replace(/\s+/g, ' ').trim()
}

function isValidSlackSignature(req, signingSecret) {
  const normalizedSigningSecret = String(signingSecret ?? '').trim()

  if (!normalizedSigningSecret) {
    return false
  }

  const timestamp = String(req.get('x-slack-request-timestamp') ?? '').trim()
  const signature = String(req.get('x-slack-signature') ?? '').trim()
  const rawBody = req.rawBody

  if (!timestamp || !signature || !rawBody) {
    return false
  }

  const timestampSeconds = Number(timestamp)
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 60 * 5) {
    return false
  }

  const expectedSignature = `v0=${createHmac('sha256', normalizedSigningSecret)
    .update(`v0:${timestamp}:`)
    .update(rawBody)
    .digest('hex')}`

  const signatureBuffer = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)

  return (
    signatureBuffer.length === expectedSignatureBuffer.length
    && timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  )
}

async function callSlackApi(method, token, body) {
  const response = await fetch(`${slackApiBaseUrl}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data?.ok !== true) {
    const errorMessage = normalizeText(data?.error, 200) || `Slack API error (${response.status}).`
    throw new Error(errorMessage)
  }

  return data
}

async function fetchSlackConversationReplies({ token, channel, threadTs, botUserId }) {
  if (!threadTs) {
    return []
  }

  try {
    const url = new URL(`${slackApiBaseUrl}/conversations.replies`)
    url.searchParams.set('channel', channel)
    url.searchParams.set('ts', threadTs)
    url.searchParams.set('limit', '12')

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok || data?.ok !== true || !Array.isArray(data.messages)) {
      return []
    }

    return data.messages
      .filter((message) => !message.bot_id)
      .map((message) => ({
        user: message.user,
        userName: message.user === botUserId ? 'Arnold GPT' : message.user,
        text: extractMentionText(message.text, botUserId),
      }))
      .filter((message) => message.text)
  } catch (error) {
    console.warn('Unable to fetch Slack thread context.', error)
    return []
  }
}

export function registerSlackRoutes(app, deps) {
  const {
    generateSlackReply,
    slackAllowedChannelIds,
    slackBotToken,
    slackSigningSecret,
  } = deps

  const allowedChannelIds = parseAllowedChannelIds(slackAllowedChannelIds)

  app.post('/api/slack/events', async (req, res) => {
    if (!isValidSlackSignature(req, slackSigningSecret)) {
      return res.status(401).json({ error: 'Invalid Slack request signature.' })
    }

    const body = req.body ?? {}

    if (body.type === 'url_verification') {
      return res.status(200).json({ challenge: body.challenge })
    }

    if (body.type !== 'event_callback') {
      return res.status(200).json({ ok: true })
    }

    const event = body.event ?? {}
    const eventId = normalizeText(body.event_id, 120)

    if (rememberEvent(eventId)) {
      return res.status(200).json({ ok: true, duplicate: true })
    }

    res.status(200).json({ ok: true })

    if (event.type !== 'app_mention' || event.bot_id || event.subtype) {
      return
    }

    if (!slackBotToken) {
      console.error('SLACK_BOT_TOKEN is not configured.')
      return
    }

    const channel = normalizeText(event.channel, 80)
    const threadTs = normalizeText(event.thread_ts || event.ts, 80)
    const prompt = extractMentionText(event.text, body.authorizations?.[0]?.user_id)

    if (allowedChannelIds.size > 0 && !allowedChannelIds.has(channel)) {
      console.info('Ignoring Slack app mention outside allowed channel.', {
        channel,
        eventId,
      })
      return
    }

    try {
      const botUserId = normalizeText(body.authorizations?.[0]?.user_id, 80)
      const threadContext = await fetchSlackConversationReplies({
        token: slackBotToken,
        channel,
        threadTs,
        botUserId,
      })
      const replyText = await generateSlackReply({
        prompt,
        channelName: channel,
        userName: event.user,
        threadContext,
      })

      await callSlackApi('chat.postMessage', slackBotToken, {
        channel,
        text: replyText || 'I could not generate a reply.',
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      })
    } catch (error) {
      console.error('Slack app mention handling failed.', {
        channel,
        eventId,
        message: error instanceof Error ? error.message : 'Unknown Slack handler error.',
      })

      try {
        await callSlackApi('chat.postMessage', slackBotToken, {
          channel,
          text: 'I hit an error while generating that reply. Please try again.',
          thread_ts: threadTs,
          unfurl_links: false,
          unfurl_media: false,
        })
      } catch (postError) {
        console.error('Unable to post Slack error reply.', postError)
      }
    }
  })
}
