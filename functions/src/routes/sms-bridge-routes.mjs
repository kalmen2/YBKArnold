import axios from 'axios'
import express from 'express'
import twilio from 'twilio'
import { normalizeText, nowIso } from '../utils/value-utils.mjs'

const smsBridgeLogsCollectionName = 'sms_telegram_bridge_logs'
const smsBridgePendingRepliesCollectionName = 'sms_telegram_bridge_pending_replies'
const twilioWebhookEmptyTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

let cachedTwilioClient = null
let cachedTwilioAccountSid = ''
let cachedTwilioAuthToken = ''

function normalizePhoneNumber(value) {
  return normalizeText(value, 40)
}

function normalizeTelegramUsername(value) {
  const normalized = normalizeText(value, 120).replace(/^@+/, '').toLowerCase()
  return normalized || null
}

function normalizeTelegramChatId(value) {
  const normalized = normalizeText(value, 120)
  return normalized || null
}

function resolveSmsBridgeConfig() {
  const twilioAccountSid = normalizeText(process.env.TWILIO_ACCOUNT_SID, 200)
  const twilioAuthToken = normalizeText(process.env.TWILIO_AUTH_TOKEN, 200)
  const twilioPhoneNumber = normalizePhoneNumber(process.env.TWILIO_PHONE_NUMBER)
  const telegramBotToken = normalizeText(process.env.TELEGRAM_BOT_TOKEN, 400)
  const telegramChatId = normalizeTelegramChatId(process.env.TELEGRAM_CHAT_ID)
  const manusBotUsername = normalizeText(process.env.MANUS_BOT_USERNAME, 120)
  const telegramWebhookSecret = normalizeText(process.env.TELEGRAM_WEBHOOK_SECRET, 200)
  const configuredWebhookUrl = normalizeText(process.env.TELEGRAM_WEBHOOK_URL, 1000)

  const missingConfigKeys = [
    !twilioAccountSid && 'TWILIO_ACCOUNT_SID',
    !twilioAuthToken && 'TWILIO_AUTH_TOKEN',
    !twilioPhoneNumber && 'TWILIO_PHONE_NUMBER',
    !telegramBotToken && 'TELEGRAM_BOT_TOKEN',
    !telegramChatId && 'TELEGRAM_CHAT_ID',
  ].filter(Boolean)

  if (missingConfigKeys.length > 0) {
    throw {
      status: 500,
      message: `SMS bridge is not configured. Missing env vars: ${missingConfigKeys.join(', ')}`,
    }
  }

  return {
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    telegramBotToken,
    telegramChatId,
    manusBotUsername,
    telegramWebhookSecret,
    configuredWebhookUrl,
  }
}

function resolveTwilioRequestUrls(req) {
  const originalUrl = normalizeText(req.originalUrl || req.url, 1200)
  const functionTarget = normalizeText(process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME, 120)
  const forwardedHost = normalizeText(req.headers?.['x-forwarded-host'], 320)
    .split(',')[0]
    .trim()
  const forwardedProto = normalizeText(req.headers?.['x-forwarded-proto'], 40)
    .split(',')[0]
    .trim()
  const directHost = normalizeText(req.get('host'), 320)
  const directProto = normalizeText(req.protocol, 20)
  const urlPathCandidates = []
  const urls = []

  if (originalUrl) {
    urlPathCandidates.push(originalUrl)
  }

  if (functionTarget && originalUrl) {
    const normalizedTarget = functionTarget.replace(/^\/+|\/+$/g, '')

    if (normalizedTarget) {
      const prefixedPath = originalUrl.startsWith(`/${normalizedTarget}/`)
        || originalUrl === `/${normalizedTarget}`
        ? originalUrl
        : `/${normalizedTarget}${originalUrl.startsWith('/') ? '' : '/'}${originalUrl}`

      urlPathCandidates.push(prefixedPath)
    }
  }

  for (const pathCandidate of urlPathCandidates) {
    if (forwardedHost) {
      urls.push(`${forwardedProto || 'https'}://${forwardedHost}${pathCandidate}`)
    }

    if (directHost) {
      urls.push(`${directProto || 'https'}://${directHost}${pathCandidate}`)
    }
  }

  return [...new Set(urls.filter(Boolean))]
}

function isTwilioRequestValid(req, twilioAuthToken) {
  const signature = normalizeText(req.headers?.['x-twilio-signature'], 500)

  if (!signature) {
    return false
  }

  const requestBody = req.body && typeof req.body === 'object'
    ? req.body
    : {}

  return resolveTwilioRequestUrls(req).some((url) => {
    try {
      return twilio.validateRequest(twilioAuthToken, signature, url, requestBody)
    } catch {
      return false
    }
  })
}

function getTwilioClient(accountSid, authToken) {
  if (
    !cachedTwilioClient
    || cachedTwilioAccountSid !== accountSid
    || cachedTwilioAuthToken !== authToken
  ) {
    cachedTwilioClient = twilio(accountSid, authToken)
    cachedTwilioAccountSid = accountSid
    cachedTwilioAuthToken = authToken
  }

  return cachedTwilioClient
}

function resolveWebhookBaseUrl(req) {
  const forwardedHost = normalizeText(req.headers?.['x-forwarded-host'], 320)
    .split(',')[0]
    .trim()
  const forwardedProto = normalizeText(req.headers?.['x-forwarded-proto'], 40)
    .split(',')[0]
    .trim()
  const directHost = normalizeText(req.get('host'), 320)
  const directProto = normalizeText(req.protocol, 20)
  const host = forwardedHost || directHost

  if (!host) {
    return null
  }

  return `${forwardedProto || directProto || 'https'}://${host}`
}

function resolveDefaultTelegramWebhookUrl(req) {
  const baseUrl = resolveWebhookBaseUrl(req)

  if (!baseUrl) {
    throw {
      status: 500,
      message: 'Unable to resolve Telegram webhook URL host.',
    }
  }

  return `${baseUrl}/api/integrations/sms-telegram/telegram-webhook`
}

function toIsoString(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    const normalized = normalizeText(value, 80)
    return normalized || null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value?.toDate === 'function') {
    try {
      const date = value.toDate()
      return date instanceof Date ? date.toISOString() : null
    } catch {
      return null
    }
  }

  return null
}

function toPublicSmsBridgeLog(documentSnapshot) {
  const raw = documentSnapshot?.data?.() ?? documentSnapshot ?? {}

  return {
    id: normalizeText(raw?.id ?? documentSnapshot?.id, 160),
    status: normalizeText(raw?.status, 80) || 'unknown',
    createdAt: toIsoString(raw?.createdAt),
    updatedAt: toIsoString(raw?.updatedAt),
    fromPhone: normalizePhoneNumber(raw?.fromPhone) || null,
    toPhone: normalizePhoneNumber(raw?.toPhone) || null,
    inboundText: normalizeText(raw?.inboundText, 3000) || null,
    telegramForwardText: normalizeText(raw?.telegramForwardText, 4000) || null,
    telegramReplyText: normalizeText(raw?.telegramReplyText, 4000) || null,
    telegramReplyFrom: normalizeText(raw?.telegramReplyFrom, 160) || null,
    twilioMessageSid: normalizeText(raw?.twilioMessageSid, 120) || null,
    twilioReplySid: normalizeText(raw?.twilioReplySid, 120) || null,
    telegramRequestMessageId: Number.isFinite(Number(raw?.telegramRequestMessageId))
      ? Number(raw.telegramRequestMessageId)
      : null,
    telegramReplyMessageId: Number.isFinite(Number(raw?.telegramReplyMessageId))
      ? Number(raw.telegramReplyMessageId)
      : null,
    errorMessage: normalizeText(raw?.errorMessage, 600) || null,
    manusBotUsername: normalizeText(raw?.manusBotUsername, 160) || null,
  }
}

function buildTelegramMessageBody({
  fromPhone,
  inboundText,
  manusBotUsername,
}) {
  const mention = normalizeText(manusBotUsername, 120)
  const mentionText = mention ? `${mention} ` : ''

  return `${mentionText}SMS received from ${fromPhone}:\n\n${inboundText}\n\nPlease reply directly to this message with the exact SMS response text.`
}

function resolveTelegramSenderDisplayName(message) {
  return normalizeText(
    message?.from?.username
    || message?.from?.first_name
    || message?.from?.last_name,
    160,
  ) || null
}

function isMessageFromManus(message, manusBotUsername) {
  const normalizedManusUsername = normalizeTelegramUsername(manusBotUsername)

  if (!normalizedManusUsername) {
    return true
  }

  const fromUsername = normalizeTelegramUsername(message?.from?.username)
  return fromUsername === normalizedManusUsername
}

function pendingReplyDocIdFromTelegramMessageId(telegramMessageId) {
  return `request_${String(telegramMessageId)}`
}

async function registerTelegramWebhook({
  telegramBotToken,
  webhookUrl,
  telegramWebhookSecret,
}) {
  const setWebhookResponse = await axios.post(
    `https://api.telegram.org/bot${telegramBotToken}/setWebhook`,
    {
      url: webhookUrl,
      ...(telegramWebhookSecret ? { secret_token: telegramWebhookSecret } : {}),
    },
    {
      timeout: 15 * 1000,
    },
  )

  if (!setWebhookResponse?.data?.ok) {
    throw new Error(
      normalizeText(setWebhookResponse?.data?.description, 240)
      || 'Telegram setWebhook failed.',
    )
  }

  const webhookInfoResponse = await axios.get(
    `https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`,
    {
      timeout: 15 * 1000,
    },
  )

  return {
    ok: true,
    webhookUrl,
    setWebhookResult: setWebhookResponse?.data ?? null,
    webhookInfo: webhookInfoResponse?.data?.result ?? null,
  }
}

async function sendTelegramMessage({
  telegramBotToken,
  telegramChatId,
  text,
}) {
  const response = await axios.post(
    `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
    {
      chat_id: telegramChatId,
      text,
    },
    {
      timeout: 15 * 1000,
    },
  )

  if (!response?.data?.ok || !response?.data?.result) {
    throw new Error('Telegram sendMessage failed.')
  }

  return response.data.result
}

async function sendTwilioMessage({
  twilioAccountSid,
  twilioAuthToken,
  twilioPhoneNumber,
  to,
  body,
}) {
  const client = getTwilioClient(twilioAccountSid, twilioAuthToken)
  const message = await client.messages.create({
    from: twilioPhoneNumber,
    to,
    body,
  })

  return {
    sid: normalizeText(message?.sid, 120) || null,
  }
}

export function registerSmsBridgeRoutes(app, deps) {
  const {
    getCollections,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
    toBoundedInteger,
  } = deps

  async function getSmsBridgeCollections() {
    const collections = await getCollections()
    const logsCollection = collections?.smsBridgeLogsCollection
    const pendingRepliesCollection = collections?.smsBridgePendingRepliesCollection

    if (!logsCollection || !pendingRepliesCollection) {
      throw {
        status: 500,
        message: 'SMS bridge persistence collections are not available.',
      }
    }

    return {
      logsCollection,
      pendingRepliesCollection,
    }
  }

  app.post(
    '/api/integrations/sms-telegram/webhook',
    express.urlencoded({ extended: false }),
    async (req, res) => {
      const now = nowIso()
      const requestBody = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const fromPhone = normalizePhoneNumber(requestBody?.From)
      const toPhone = normalizePhoneNumber(requestBody?.To)
      const inboundText = normalizeText(requestBody?.Body, 3000)
      const twilioMessageSid = normalizeText(requestBody?.MessageSid, 120)
      const logId = twilioMessageSid
        ? `twilio_${twilioMessageSid}`
        : randomUUID()
      const twilioAckResponse = () => {
        return res
          .status(200)
          .type('text/xml')
          .send(twilioWebhookEmptyTwiml)
      }

      try {
        const config = resolveSmsBridgeConfig()
        const {
          logsCollection,
          pendingRepliesCollection,
        } = await getSmsBridgeCollections()

        if (!isTwilioRequestValid(req, config.twilioAuthToken)) {
          return res.status(403).json({ error: 'Invalid Twilio signature.' })
        }

        if (twilioMessageSid) {
          const existingLog = await logsCollection.findOne(
            { id: logId },
            { projection: { id: 1 } },
          )

          if (existingLog) {
            return twilioAckResponse()
          }
        }

        if (!fromPhone || !inboundText) {
          await logsCollection.updateOne(
            { id: logId },
            {
              $set: {
                id: logId,
                status: 'failed',
                createdAt: now,
                updatedAt: now,
                fromPhone: fromPhone || null,
                toPhone: toPhone || null,
                inboundText: inboundText || null,
                twilioMessageSid: twilioMessageSid || null,
                errorMessage: 'Incoming Twilio payload is missing From or Body.',
              },
            },
            { upsert: true },
          )

          return twilioAckResponse()
        }

        const telegramForwardText = buildTelegramMessageBody({
          fromPhone,
          inboundText,
          manusBotUsername: config.manusBotUsername,
        })

        await logsCollection.updateOne(
          { id: logId },
          {
            $set: {
              id: logId,
              status: 'waiting_reply',
              createdAt: now,
              updatedAt: now,
              fromPhone,
              toPhone: toPhone || null,
              inboundText,
              twilioMessageSid: twilioMessageSid || null,
              telegramForwardText,
              manusBotUsername: config.manusBotUsername || null,
            },
          },
          { upsert: true },
        )

        const sentTelegramMessage = await sendTelegramMessage({
          telegramBotToken: config.telegramBotToken,
          telegramChatId: config.telegramChatId,
          text: telegramForwardText,
        })
        const telegramRequestMessageId = Number(sentTelegramMessage?.message_id)

        if (!Number.isFinite(telegramRequestMessageId)) {
          throw new Error('Telegram request message id was not returned.')
        }

        await pendingRepliesCollection.updateOne(
          {
            id: pendingReplyDocIdFromTelegramMessageId(telegramRequestMessageId),
          },
          {
            $set: {
              id: pendingReplyDocIdFromTelegramMessageId(telegramRequestMessageId),
              logId,
              fromPhone,
              toPhone: toPhone || null,
              twilioMessageSid: twilioMessageSid || null,
              telegramRequestMessageId,
              status: 'waiting_reply',
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        )

        await logsCollection.updateOne(
          { id: logId },
          {
            $set: {
              updatedAt: nowIso(),
              telegramRequestMessageId,
              status: 'forwarded',
            },
          },
          { upsert: true },
        )

        return twilioAckResponse()
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : normalizeText(error?.message || error?.details, 600) || 'SMS bridge request failed.'

        try {
          const { logsCollection } = await getSmsBridgeCollections()

          await logsCollection.updateOne(
            { id: logId },
            {
              $set: {
                id: logId,
                status: 'failed',
                updatedAt: nowIso(),
                fromPhone: fromPhone || null,
                toPhone: toPhone || null,
                inboundText: inboundText || null,
                twilioMessageSid: twilioMessageSid || null,
                errorMessage,
              },
            },
            { upsert: true },
          )
        } catch (logError) {
          console.error('Failed to persist SMS bridge error log.', logError)
        }

        console.error('SMS bridge Twilio webhook failed.', error)
        return twilioAckResponse()
      }
    },
  )

  app.post('/api/integrations/sms-telegram/telegram-webhook', async (req, res) => {
    try {
      const config = resolveSmsBridgeConfig()
      const {
        logsCollection,
        pendingRepliesCollection,
      } = await getSmsBridgeCollections()
      const secretHeader = normalizeText(req.headers?.['x-telegram-bot-api-secret-token'], 200)

      if (config.telegramWebhookSecret && secretHeader !== config.telegramWebhookSecret) {
        return res.status(403).json({ error: 'Invalid Telegram webhook secret.' })
      }

      const update = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const message = update?.message && typeof update.message === 'object'
        ? update.message
        : null

      if (!message) {
        return res.json({ ok: true, ignored: 'unsupported_update' })
      }

      const messageChatId = normalizeTelegramChatId(message?.chat?.id)

      if (messageChatId !== config.telegramChatId) {
        return res.json({ ok: true, ignored: 'chat_mismatch' })
      }

      if (!isMessageFromManus(message, config.manusBotUsername)) {
        return res.json({ ok: true, ignored: 'not_manus' })
      }

      const replyText = normalizeText(message?.text ?? message?.caption, 3000)

      if (!replyText) {
        return res.json({ ok: true, ignored: 'missing_text' })
      }

      const replyToMessageId = Number(message?.reply_to_message?.message_id)
      let pendingReply = null
      let pendingReplyId = null

      if (Number.isFinite(replyToMessageId)) {
        pendingReplyId = pendingReplyDocIdFromTelegramMessageId(replyToMessageId)
        pendingReply = await pendingRepliesCollection.findOne({ id: pendingReplyId })
      }

      if (!pendingReply) {
        pendingReply = await pendingRepliesCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(1)
          .next()
        pendingReplyId = normalizeText(pendingReply?.id, 160)
      }

      if (!pendingReply) {
        return res.json({ ok: true, ignored: 'no_pending_match' })
      }

      const destinationPhone = normalizePhoneNumber(pendingReply?.fromPhone)
      const logId = normalizeText(pendingReply?.logId, 160)

      if (!destinationPhone) {
        if (logId) {
          await logsCollection.updateOne(
            { id: logId },
            {
              $set: {
                status: 'failed',
                updatedAt: nowIso(),
                errorMessage: 'Pending SMS reply mapping did not contain a destination phone number.',
              },
            },
            { upsert: true },
          )
        }

        if (pendingReplyId) {
          await pendingRepliesCollection.deleteOne({ id: pendingReplyId })
        }
        return res.json({ ok: true, ignored: 'missing_destination_phone' })
      }

      const twilioReply = await sendTwilioMessage({
        twilioAccountSid: config.twilioAccountSid,
        twilioAuthToken: config.twilioAuthToken,
        twilioPhoneNumber: config.twilioPhoneNumber,
        to: destinationPhone,
        body: replyText,
      })

      if (pendingReplyId) {
        await pendingRepliesCollection.deleteOne({ id: pendingReplyId })
      }

      if (logId) {
        try {
          await logsCollection.updateOne(
            { id: logId },
            {
              $set: {
                status: 'replied',
                updatedAt: nowIso(),
                telegramReplyText: replyText,
                telegramReplyFrom: resolveTelegramSenderDisplayName(message),
                telegramReplyMessageId: Number(message?.message_id) || null,
                twilioReplySid: twilioReply.sid,
              },
            },
            { upsert: true },
          )
        } catch (logError) {
          console.error('Failed to update SMS bridge log after Telegram webhook reply.', logError)
        }
      }

      return res.json({
        ok: true,
        forwarded: true,
      })
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : normalizeText(error?.message || error?.details, 600) || 'Telegram webhook failed.'

      console.error('SMS bridge Telegram webhook failed.', error)
      return res.status(500).json({ error: errorMessage })
    }
  })

  app.post(
    '/api/admin/sms-bridge/telegram-webhook/register',
    requireFirebaseAuth,
    requireAdminRole,
    async (req, res, next) => {
      try {
        const config = resolveSmsBridgeConfig()
        const requestedWebhookUrl = normalizeText(req.body?.webhookUrl, 1200)
        const webhookUrl = requestedWebhookUrl
          || config.configuredWebhookUrl
          || resolveDefaultTelegramWebhookUrl(req)
        const registration = await registerTelegramWebhook({
          telegramBotToken: config.telegramBotToken,
          webhookUrl,
          telegramWebhookSecret: config.telegramWebhookSecret,
        })

        return res.json(registration)
      } catch (error) {
        next(error)
      }
    },
  )

  app.get('/api/admin/sms-bridge/logs', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const limit = toBoundedInteger(req.query?.limit, 10, 300, 120)
      const { logsCollection } = await getSmsBridgeCollections()
      const snapshot = await logsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
      const logs = snapshot.map((entry) => toPublicSmsBridgeLog(entry))

      return res.json({ logs })
    } catch (error) {
      next(error)
    }
  })
}
