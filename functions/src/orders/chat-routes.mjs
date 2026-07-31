// Order chat endpoints: per-order chat threads with @mention reminders that
// the reminder cron turns into push alerts when due.

import { randomUUID } from 'node:crypto'
import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import { normalizeOrderNumberInput } from './order-shared.mjs'

let ordersChatsIndexesPromise

export function registerOrderChatRoutes(app, {
  authApprovalApproved,
  getCollections,
  mobileAlertTargetModeSelected,
  normalizeEmail,
  requireFirebaseAuth,
  toPublicAuthUser,
}) {
  function normalizeOrderChatUidList(input, maxItems = 25) {
    const sourceItems = Array.isArray(input)
      ? input
      : [input]
    const seen = new Set()
    const normalized = []

    for (const rawValue of sourceItems) {
      const value = normalizeOptionalShortText(rawValue, 200)

      if (!value || seen.has(value)) {
        continue
      }

      seen.add(value)
      normalized.push(value)

      if (normalized.length >= maxItems) {
        break
      }
    }

    return normalized
  }

  function normalizeOrderChatReminderDate(value) {
    const normalized = String(normalizeOptionalShortText(value, 16) ?? '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return ''
    }

    const parsed = new Date(`${normalized}T00:00:00.000Z`)

    if (Number.isNaN(parsed.getTime())) {
      return ''
    }

    return normalized
  }

  function normalizeOrderChatReminderInput(input) {
    const source = input && typeof input === 'object'
      ? input
      : {}
    const dueDate = normalizeOrderChatReminderDate(source.dueDate)

    if (!dueDate) {
      return null
    }

    return {
      dueDate,
      note: normalizeOptionalShortText(source.note, 500) || null,
      targetUserUids: normalizeOrderChatUidList(source.targetUserUids, 25),
    }
  }

  function normalizeOrderChatMessage(value) {
    return String(value ?? '').trim().slice(0, 4000)
  }

  function normalizeOrderChatContext(input) {
    const source = input && typeof input === 'object'
      ? input
      : {}

    return {
      orderNumber: normalizeOrderNumberInput(source.orderNumber) || null,
      mondayItemId: normalizeOptionalShortText(source.mondayItemId, 120) || null,
      orderName: normalizeOptionalShortText(source.orderName, 250) || null,
    }
  }

  function normalizeOrderChatOffset(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0
    }

    return Math.floor(parsed)
  }

  function normalizeOrderChatLimit(value) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 150
    }

    return Math.min(500, Math.max(1, Math.floor(parsed)))
  }

  async function getOrdersChatsCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const ordersDatabase = collections?.databasesByDomain?.orders

    if (!ordersDatabase) {
      throw new Error('Orders database is unavailable.')
    }

    const ordersChatsCollection = ordersDatabase.collection('orders_chats')

    if (!ordersChatsIndexesPromise) {
      ordersChatsIndexesPromise = Promise.all([
        ordersChatsCollection.createIndex({ id: 1 }, { unique: true }),
        ordersChatsCollection.createIndex({ orderId: 1, createdAt: 1 }),
        ordersChatsCollection.createIndex({ 'reminder.dueDate': 1, 'reminder.notifiedAt': 1 }),
        ordersChatsCollection.createIndex({ createdAt: -1 }),
      ])
    }

    try {
      await ordersChatsIndexesPromise
    } catch (error) {
      ordersChatsIndexesPromise = undefined
      throw error
    }

    return ordersChatsCollection
  }

  function canManageOrderChatMessage({ publicUser, authUser, chatMessage }) {
    if (publicUser?.isApproved && publicUser?.isAdmin) {
      return true
    }

    const requesterUid = normalizeOptionalShortText(authUser?.uid, 200)
    const requesterEmail = normalizeEmail(authUser?.email)
    const createdByUid = normalizeOptionalShortText(chatMessage?.createdByUid, 200)
    const createdByEmail = normalizeEmail(chatMessage?.createdByEmail)

    return Boolean(
      (requesterUid && createdByUid && requesterUid === createdByUid)
      || (requesterEmail && createdByEmail && requesterEmail === createdByEmail),
    )
  }

  async function createOrderChatInAppAlert({
    mobileAlertsCollection,
    title,
    message,
    createdByUid,
    createdByEmail,
    recipientUids,
    metadata,
  }) {
    if (!Array.isArray(recipientUids) || recipientUids.length === 0) {
      return
    }

    const now = new Date().toISOString()

    await mobileAlertsCollection.insertOne({
      id: randomUUID(),
      title,
      message,
      isUpdate: false,
      targetMode: mobileAlertTargetModeSelected,
      targetUserUids: recipientUids,
      createdByUid: createdByUid || null,
      createdByEmail: createdByEmail || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: metadata && typeof metadata === 'object'
        ? metadata
        : {},
      createdAt: now,
      updatedAt: now,
    })
  }

  app.get('/api/orders/chat-users', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { authUsersCollection } = await getCollections()
      const userDocuments = await authUsersCollection
        .find(
          {
            approvalStatus: authApprovalApproved,
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .toArray()

      const users = userDocuments
        .map((document) => toPublicAuthUser(document))
        .map((user) => {
          const uid = normalizeOptionalShortText(user?.uid, 200)
          const email = normalizeEmail(user?.email)

          if (!uid || !email) {
            return null
          }

          return {
            uid,
            email,
            displayName: normalizeOptionalShortText(user?.displayName, 200) || null,
            isAdmin: Boolean(user?.isAdmin),
            isSalesRep: Boolean(user?.isSalesRep),
            hasWebAccess: Boolean(user?.hasWebAccess),
            hasAppAccess: Boolean(user?.hasAppAccess),
            lastActivityAt: String(user?.lastActivityAt ?? '').trim() || null,
          }
        })
        .filter(Boolean)
        .sort((left, right) => {
          const leftLabel = String(left.displayName ?? left.email).toLowerCase()
          const rightLabel = String(right.displayName ?? right.email).toLowerCase()

          if (leftLabel === rightLabel) {
            return left.email.localeCompare(right.email)
          }

          return leftLabel.localeCompare(rightLabel)
        })

      return res.json({
        users,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/orders/:orderId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const offset = normalizeOrderChatOffset(req.query?.offset)
      const limit = normalizeOrderChatLimit(req.query?.limit)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)
      const filter = {
        orderId,
      }

      const [total, messages] = await Promise.all([
        ordersChatsCollection.countDocuments(filter),
        ordersChatsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                id: 1,
                orderId: 1,
                orderNumber: 1,
                mondayItemId: 1,
                orderName: 1,
                message: 1,
                mentionUserUids: 1,
                mentionUserEmails: 1,
                reminder: 1,
                createdAt: 1,
                createdByUid: 1,
                createdByEmail: 1,
                createdByName: 1,
                updatedAt: 1,
                updatedByUid: 1,
                updatedByEmail: 1,
                updatedByName: 1,
              },
            },
          )
          .sort({ createdAt: 1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        messages,
        total,
        offset,
        limit,
        hasMore: offset + messages.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/orders/:orderId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const body = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const messageText = normalizeOrderChatMessage(body.message)
      const requestedMentionUserUids = normalizeOrderChatUidList(body.mentionUserUids, 300)
      const requestedReminder = normalizeOrderChatReminderInput(body.reminder)
      const orderContext = normalizeOrderChatContext(body)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      if (body.reminder && !requestedReminder) {
        return res.status(400).json({
          error: 'reminder.dueDate must be a valid ISO date in YYYY-MM-DD format.',
        })
      }

      const collections = await getCollections()
      const { authUsersCollection, mobileAlertsCollection } = collections
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const now = new Date().toISOString()
      const requesterUid = normalizeOptionalShortText(req.authUser?.uid, 200)
      const requesterEmail = normalizeEmail(req.authUser?.email) || null
      const requestedRecipientUids = normalizeOrderChatUidList([
        ...requestedMentionUserUids,
        ...(requestedReminder?.targetUserUids ?? []),
      ], 350)
      const recipientUsers = requestedRecipientUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: {
                $in: requestedRecipientUids,
              },
              approvalStatus: authApprovalApproved,
            },
            {
              projection: {
                _id: 0,
              },
            },
          )
          .toArray()
        : []
      const recipientByUid = new Map(
        recipientUsers
          .map((document) => toPublicAuthUser(document))
          .filter((user) => Boolean(user?.uid))
          .map((user) => [user.uid, user]),
      )
      const mentionRecipientUids = requestedMentionUserUids
        .filter((uid) => uid !== requesterUid)
        .filter((uid) => recipientByUid.has(uid))
      const mentionRecipientEmails = mentionRecipientUids
        .map((uid) => normalizeEmail(recipientByUid.get(uid)?.email))
        .filter(Boolean)
      const reminderRecipientUids = (requestedReminder?.targetUserUids ?? [])
        .filter((uid) => recipientByUid.has(uid))
      const reminderRecipientEmails = reminderRecipientUids
        .map((uid) => normalizeEmail(recipientByUid.get(uid)?.email))
        .filter(Boolean)
      const reminder = requestedReminder
        ? {
          id: randomUUID(),
          dueDate: requestedReminder.dueDate,
          note: requestedReminder.note || null,
          targetUserUids: reminderRecipientUids,
          targetUserEmails: reminderRecipientEmails,
          notifiedAt: null,
          createdAt: now,
        }
        : null

      const message = {
        id: randomUUID(),
        orderId,
        orderNumber: orderContext.orderNumber,
        mondayItemId: orderContext.mondayItemId,
        orderName: orderContext.orderName,
        message: messageText,
        mentionUserUids: mentionRecipientUids,
        mentionUserEmails: mentionRecipientEmails,
        reminder,
        createdAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: normalizeOptionalShortText(publicUser?.displayName, 200) || null,
      }

      await ordersChatsCollection.insertOne(message)

      if (mentionRecipientUids.length > 0) {
        const orderLabel = orderContext.orderNumber || orderContext.orderName || orderId
        await createOrderChatInAppAlert({
          mobileAlertsCollection,
          title: `Mentioned in order chat: ${orderLabel}`,
          message: `${normalizeOptionalShortText(publicUser?.displayName || requesterEmail || 'A teammate', 120)} mentioned you: ${messageText.slice(0, 300)}`,
          createdByUid: requesterUid,
          createdByEmail: requesterEmail,
          recipientUids: mentionRecipientUids,
          metadata: {
            source: 'orders_chat_mention',
            orderId,
            orderNumber: orderContext.orderNumber,
            mondayItemId: orderContext.mondayItemId,
            orderName: orderContext.orderName,
            chatMessageId: message.id,
          },
        })
      }

      return res.status(201).json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/orders/:orderId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const messageId = normalizeOptionalShortText(req.params.messageId, 160)
      const body = req.body && typeof req.body === 'object'
        ? req.body
        : {}
      const messageText = normalizeOrderChatMessage(body.message)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const existingMessage = await ordersChatsCollection.findOne(
        {
          id: messageId,
          orderId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageOrderChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only edit your own chat messages unless you are an admin.',
        })
      }

      const now = new Date().toISOString()
      const message = await ordersChatsCollection.findOneAndUpdate(
        {
          id: messageId,
          orderId,
        },
        {
          $set: {
            message: messageText,
            updatedAt: now,
            updatedByUid: normalizeOptionalShortText(req.authUser?.uid, 200) || null,
            updatedByEmail: normalizeEmail(req.authUser?.email) || null,
            updatedByName: normalizeOptionalShortText(publicUser?.displayName, 200) || null,
          },
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            orderNumber: 1,
            mondayItemId: 1,
            orderName: 1,
            message: 1,
            mentionUserUids: 1,
            mentionUserEmails: 1,
            reminder: 1,
            createdAt: 1,
            createdByUid: 1,
            createdByEmail: 1,
            createdByName: 1,
            updatedAt: 1,
            updatedByUid: 1,
            updatedByEmail: 1,
            updatedByName: 1,
          },
        },
      )

      return res.json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/orders/:orderId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const orderId = normalizeOptionalShortText(req.params.orderId, 220)
      const messageId = normalizeOptionalShortText(req.params.messageId, 160)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      const collections = await getCollections()
      const ordersChatsCollection = await getOrdersChatsCollection(collections)

      const existingMessage = await ordersChatsCollection.findOne(
        {
          id: messageId,
          orderId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            orderId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageOrderChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only delete your own chat messages unless you are an admin.',
        })
      }

      await ordersChatsCollection.deleteOne({
        id: messageId,
        orderId,
      })

      return res.json({
        ok: true,
        messageId,
      })
    } catch (error) {
      next(error)
    }
  })
}
