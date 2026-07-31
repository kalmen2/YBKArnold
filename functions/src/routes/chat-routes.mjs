import { randomUUID } from 'node:crypto'

let appChatThreadsIndexesPromise
let appChatMessagesIndexesPromise

const chatTypeDirect = 'direct'
const chatTypeGroup = 'group'
const chatMessageTypeText = 'text'
const chatMessageTypeImage = 'image'
const chatMessageTypeVoice = 'voice'
const chatMessageTypeFile = 'file'
const chatMessageTypeMixed = 'mixed'
const chatMessageTypeDeleted = 'deleted'
const maxChatAttachmentBytes = 6 * 1024 * 1024
const allowedChatReactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function registerChatRoutes(app, deps) {
  const {
    authApprovalApproved,
    getCollections,
    normalizeEmail,
    normalizeOptionalShortText,
    requireFirebaseAuth,
    toBoundedInteger,
    toPublicAuthUser,
  } = deps

  function normalizeChatType(value) {
    return String(value ?? '').trim().toLowerCase() === chatTypeGroup
      ? chatTypeGroup
      : chatTypeDirect
  }

  function normalizeChatMessageType(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if (normalized === chatMessageTypeImage) {
      return chatMessageTypeImage
    }

    if (normalized === chatMessageTypeVoice) {
      return chatMessageTypeVoice
    }

    if (normalized === chatMessageTypeFile) {
      return chatMessageTypeFile
    }

    if (normalized === chatMessageTypeMixed) {
      return chatMessageTypeMixed
    }

    if (normalized === chatMessageTypeDeleted) {
      return chatMessageTypeDeleted
    }

    return chatMessageTypeText
  }

  function normalizeChatText(value) {
    return String(value ?? '').trim().slice(0, 4000)
  }

  function normalizeChatName(value) {
    return String(normalizeOptionalShortText(value, 120) ?? '').trim().slice(0, 120)
  }

  function normalizeChatOffset(value) {
    return toBoundedInteger(value, 0, 100000, 0)
  }

  function normalizeChatLimit(value) {
    return toBoundedInteger(value, 1, 300, 120)
  }

  function normalizeChatUidList(value, maxItems = 120) {
    const sourceItems = Array.isArray(value)
      ? value
      : [value]
    const seen = new Set()
    const normalized = []

    for (const sourceItem of sourceItems) {
      const nextValue = String(normalizeOptionalShortText(sourceItem, 220) ?? '').trim()

      if (!nextValue || seen.has(nextValue)) {
        continue
      }

      seen.add(nextValue)
      normalized.push(nextValue)

      if (normalized.length >= maxItems) {
        break
      }
    }

    return normalized
  }

  function normalizeChatAttachmentKind(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if (normalized === chatMessageTypeImage) {
      return chatMessageTypeImage
    }

    if (normalized === chatMessageTypeVoice) {
      return chatMessageTypeVoice
    }

    if (normalized === chatMessageTypeFile) {
      return chatMessageTypeFile
    }

    return null
  }

  function normalizeChatAttachmentBase64(value) {
    const normalized = String(value ?? '').trim().replace(/\s+/g, '')

    if (!normalized) {
      return null
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
      return null
    }

    return normalized
  }

  function sanitizeChatAttachmentFileName(value) {
    const normalized = String(normalizeOptionalShortText(value, 180) ?? '').trim()

    if (!normalized) {
      return null
    }

    const cleaned = normalized
      .replace(/[\\/]/g, '-')
      .replace(/[^A-Za-z0-9._\- ]+/g, '')
      .trim()
      .slice(0, 160)

    return cleaned || null
  }

  function normalizeChatAttachmentInput(value) {
    const source = value && typeof value === 'object'
      ? value
      : null

    if (!source) {
      return null
    }

    const kind = normalizeChatAttachmentKind(source.kind)

    if (!kind) {
      return null
    }

    const rawDataUrl = String(normalizeOptionalShortText(source.dataUrl, 10_000_000) ?? '').trim()
    const rawDataBase64 = String(normalizeOptionalShortText(source.dataBase64, 10_000_000) ?? '').trim()
    const dataUrlMatch = rawDataUrl.match(/^data:([^;,\s]+);base64,(.+)$/i)
    const mimeTypeFromDataUrl = dataUrlMatch
      ? String(dataUrlMatch[1] ?? '').trim().toLowerCase()
      : ''
    const base64FromDataUrl = dataUrlMatch
      ? normalizeChatAttachmentBase64(dataUrlMatch[2])
      : null
    const base64Payload = base64FromDataUrl || normalizeChatAttachmentBase64(rawDataBase64)

    if (!base64Payload) {
      return null
    }

    let sizeBytes = 0

    try {
      sizeBytes = Buffer.from(base64Payload, 'base64').byteLength
    } catch {
      return null
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxChatAttachmentBytes) {
      return null
    }

    const normalizedMimeTypeCandidate = String(normalizeOptionalShortText(source.mimeType, 120) ?? '')
      .trim()
      .toLowerCase()
    const normalizedMimeType = mimeTypeFromDataUrl || normalizedMimeTypeCandidate

    if (kind === chatMessageTypeImage) {
      const imageMimeType = normalizedMimeType.startsWith('image/')
        ? normalizedMimeType
        : 'image/jpeg'

      return {
        kind: chatMessageTypeImage,
        mimeType: imageMimeType,
        fileName: sanitizeChatAttachmentFileName(source.fileName),
        sizeBytes,
        dataUrl: `data:${imageMimeType};base64,${base64Payload}`,
      }
    }

    if (kind === chatMessageTypeFile) {
      const fileMimeType = normalizedMimeType || 'application/octet-stream'

      return {
        kind: chatMessageTypeFile,
        mimeType: fileMimeType,
        fileName: sanitizeChatAttachmentFileName(source.fileName) || 'attachment',
        sizeBytes,
        dataUrl: `data:${fileMimeType};base64,${base64Payload}`,
      }
    }

    const voiceMimeType = normalizedMimeType.startsWith('audio/')
      ? normalizedMimeType
      : 'audio/mp4'

    return {
      kind: chatMessageTypeVoice,
      mimeType: voiceMimeType,
      fileName: sanitizeChatAttachmentFileName(source.fileName),
      sizeBytes,
      durationMillis: toBoundedInteger(source.durationMillis, 0, 3_600_000, 0),
      dataUrl: `data:${voiceMimeType};base64,${base64Payload}`,
    }
  }

  function resolveChatMessageType({ text, attachment, deletedAt }) {
    if (deletedAt) {
      return chatMessageTypeDeleted
    }

    if (text && attachment) {
      return chatMessageTypeMixed
    }

    if (attachment?.kind === chatMessageTypeImage) {
      return chatMessageTypeImage
    }

    if (attachment?.kind === chatMessageTypeVoice) {
      return chatMessageTypeVoice
    }

    if (attachment?.kind === chatMessageTypeFile) {
      return chatMessageTypeFile
    }

    return chatMessageTypeText
  }

  function buildChatThreadLastMessagePreview(message) {
    if (message?.deletedAt) {
      return 'Message deleted.'
    }

    const normalizedText = normalizeChatText(message?.text)

    if (normalizedText) {
      return normalizedText.slice(0, 240)
    }

    if (message?.attachment?.kind === chatMessageTypeImage) {
      return 'Photo'
    }

    if (message?.attachment?.kind === chatMessageTypeVoice) {
      return 'Voice note'
    }

    if (message?.attachment?.kind === chatMessageTypeFile) {
      return message.attachment.fileName || 'File'
    }

    return 'Message'
  }

  function normalizeChatUserRecord(user) {
    const uid = String(normalizeOptionalShortText(user?.uid, 220) ?? '').trim()
    const email = normalizeEmail(user?.email)

    if (!uid || !email) {
      return null
    }

    return {
      uid,
      email,
      displayName: String(normalizeOptionalShortText(user?.displayName, 220) ?? '').trim() || null,
      imageUrl: String(normalizeOptionalShortText(user?.photoURL, 1000) ?? '').trim() || null,
      role: String(normalizeOptionalShortText(user?.role, 40) ?? '').trim() || 'standard',
      isAdmin: Boolean(user?.isAdmin),
      isManager: Boolean(user?.isManager),
      isSalesRep: Boolean(user?.isSalesRep),
      isShopWorker: Boolean(user?.isShopWorker),
      isOfficeWorker: Boolean(user?.isOfficeWorker),
      hasWebAccess: Boolean(user?.hasWebAccess),
      hasAppAccess: Boolean(user?.hasAppAccess),
    }
  }

  function canStartDirectChat(publicUser) {
    return Boolean(
      publicUser?.isApproved
      && (publicUser?.isAdmin || publicUser?.isManager || publicUser?.isOfficeWorker),
    )
  }

  function normalizeChatMemberSnapshots(value) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((entry) => normalizeChatUserRecord(entry))
      .filter(Boolean)
  }

  function buildChatDirectKey(memberUids) {
    const normalizedMembers = normalizeChatUidList(memberUids, 2).sort((left, right) => left.localeCompare(right))

    if (normalizedMembers.length !== 2) {
      return null
    }

    return normalizedMembers.join('::')
  }

  function buildChatUidFieldKey(uid) {
    const normalizedUid = String(normalizeOptionalShortText(uid, 220) ?? '').trim()

    if (!normalizedUid) {
      return null
    }

    return `uid_${Buffer.from(normalizedUid, 'utf8').toString('base64url')}`
  }

  function getChatHistoryClearedAt(thread, uid) {
    const fieldKey = buildChatUidFieldKey(uid)
    const clearedAtByUid = thread?.historyClearedAtByUid

    if (!fieldKey || !clearedAtByUid || typeof clearedAtByUid !== 'object') {
      return null
    }

    return String(clearedAtByUid[fieldKey] ?? '').trim() || null
  }

  function getChatUidTimestamp(record, uid) {
    const fieldKey = buildChatUidFieldKey(uid)

    if (!fieldKey || !record || typeof record !== 'object') {
      return null
    }

    return String(record[fieldKey] ?? '').trim() || null
  }

  function normalizeChatReactions(value, requesterUid = null) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((reaction) => {
        const emoji = String(reaction?.emoji ?? '').trim()
        const userUids = normalizeChatUidList(reaction?.userUids, 250)

        if (!allowedChatReactionEmojis.includes(emoji) || userUids.length === 0) {
          return null
        }

        return {
          emoji,
          count: userUids.length,
          reactedByMe: Boolean(requesterUid && userUids.includes(requesterUid)),
        }
      })
      .filter(Boolean)
  }

  function resolveChatMessageDeliveryStatus(message, thread, requesterUid = null) {
    const authorUid = String(normalizeOptionalShortText(message?.createdByUid, 220) ?? '').trim()
    const memberUids = normalizeChatUidList(thread?.memberUids, 250)
    const recipientUids = memberUids.filter((uid) => uid !== authorUid)
    const messageCreatedAt = String(message?.createdAt ?? '').trim()

    if (!authorUid || !requesterUid || authorUid !== requesterUid || recipientUids.length === 0 || !messageCreatedAt) {
      return 'sent'
    }

    const wasSeenByAll = recipientUids.every((uid) => {
      const readAt = getChatUidTimestamp(thread?.readAtByUid, uid)
      return Boolean(readAt && readAt >= messageCreatedAt)
    })

    if (wasSeenByAll) {
      return 'seen'
    }

    const wasDeliveredToAll = recipientUids.every((uid) => {
      const deliveredAt = getChatUidTimestamp(thread?.deliveredAtByUid, uid)
      return Boolean(deliveredAt && deliveredAt >= messageCreatedAt)
    })

    return wasDeliveredToAll ? 'delivered' : 'sent'
  }

  async function getChatCollections(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const authDatabase = collections?.databasesByDomain?.auth

    if (!authDatabase) {
      throw new Error('Auth database is unavailable.')
    }

    const chatThreadsCollection = authDatabase.collection('app_chats')
    const chatMessagesCollection = authDatabase.collection('app_chat_messages')

    if (!appChatThreadsIndexesPromise) {
      appChatThreadsIndexesPromise = Promise.all([
        chatThreadsCollection.createIndex({ id: 1 }, { unique: true }),
        chatThreadsCollection.createIndex({ memberUids: 1, updatedAt: -1 }),
        chatThreadsCollection.createIndex({ type: 1, updatedAt: -1 }),
        chatThreadsCollection.createIndex({ directKey: 1 }, { unique: true, sparse: true }),
        chatThreadsCollection.createIndex({ updatedAt: -1 }),
      ])
    }

    if (!appChatMessagesIndexesPromise) {
      appChatMessagesIndexesPromise = Promise.all([
        chatMessagesCollection.createIndex({ id: 1 }, { unique: true }),
        chatMessagesCollection.createIndex({ chatId: 1, createdAt: 1 }),
        chatMessagesCollection.createIndex({ chatId: 1, createdAt: -1 }),
        chatMessagesCollection.createIndex({ createdByUid: 1, createdAt: -1 }),
      ])
    }

    try {
      await Promise.all([appChatThreadsIndexesPromise, appChatMessagesIndexesPromise])
    } catch (error) {
      appChatThreadsIndexesPromise = undefined
      appChatMessagesIndexesPromise = undefined
      throw error
    }

    return {
      collections,
      chatThreadsCollection,
      chatMessagesCollection,
    }
  }

  async function buildApprovedUserMapByUid(authUsersCollection, uids) {
    const uniqueUids = normalizeChatUidList(uids, 300)

    if (uniqueUids.length === 0) {
      return new Map()
    }

    const userDocuments = await authUsersCollection
      .find(
        {
          uid: {
            $in: uniqueUids,
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

    const userMap = new Map()

    for (const userDocument of userDocuments) {
      const normalizedUser = normalizeChatUserRecord(toPublicAuthUser(userDocument))

      if (!normalizedUser?.uid) {
        continue
      }

      userMap.set(normalizedUser.uid, normalizedUser)
    }

    return userMap
  }

  async function resolveChatThreadWithMembers({
    authUsersCollection,
    requesterUid = null,
    thread,
  }) {
    if (!thread || typeof thread !== 'object') {
      return null
    }

    const memberUids = normalizeChatUidList(thread.memberUids, 250)
    const latestUserMapByUid = await buildApprovedUserMapByUid(authUsersCollection, memberUids)
    const fallbackMemberSnapshots = normalizeChatMemberSnapshots(thread.memberSnapshots)
    const fallbackMemberMapByUid = new Map(
      fallbackMemberSnapshots.map((member) => [member.uid, member]),
    )
    const memberProfiles = memberUids
      .map((uid) => latestUserMapByUid.get(uid) || fallbackMemberMapByUid.get(uid) || null)
      .filter(Boolean)
    const historyClearedAt = getChatHistoryClearedAt(thread, requesterUid)
    const lastMessageAt = String(thread.lastMessageAt ?? '').trim() || null
    const hasVisibleLastMessage = !historyClearedAt || Boolean(lastMessageAt && lastMessageAt > historyClearedAt)

    return {
      id: thread.id,
      type: normalizeChatType(thread.type),
      name: String(normalizeOptionalShortText(thread.name, 120) ?? '').trim() || null,
      memberUids,
      memberProfiles,
      createdAt: String(thread.createdAt ?? '').trim() || null,
      updatedAt: String(thread.updatedAt ?? '').trim() || null,
      lastMessageAt: hasVisibleLastMessage ? lastMessageAt : null,
      lastMessagePreview: hasVisibleLastMessage
        ? String(normalizeOptionalShortText(thread.lastMessagePreview, 400) ?? '').trim() || null
        : null,
      lastMessageType: hasVisibleLastMessage
        ? normalizeChatMessageType(thread.lastMessageType)
        : chatMessageTypeText,
      createdByUid: String(normalizeOptionalShortText(thread.createdByUid, 220) ?? '').trim() || null,
      createdByEmail: normalizeEmail(thread.createdByEmail) || null,
      createdByName: String(normalizeOptionalShortText(thread.createdByName, 220) ?? '').trim() || null,
      pinned: normalizeChatUidList(thread.pinnedByUids, 300).includes(String(requesterUid ?? '').trim()),
    }
  }

  function toPublicChatMessage(message, {
    requesterUid = null,
    thread = null,
  } = {}) {
    if (!message || typeof message !== 'object') {
      return null
    }

    const messageId = String(normalizeOptionalShortText(message.id, 220) ?? '').trim()
    const chatId = String(normalizeOptionalShortText(message.chatId, 220) ?? '').trim()

    if (!messageId || !chatId) {
      return null
    }

    const attachmentSource = message.attachment && typeof message.attachment === 'object'
      ? message.attachment
      : null
    const attachmentKind = normalizeChatAttachmentKind(attachmentSource?.kind)
    const attachmentDataUrl = String(normalizeOptionalShortText(attachmentSource?.dataUrl, 10_000_000) ?? '').trim()
    const attachment = attachmentKind
      ? {
          kind: attachmentKind,
          mimeType: String(normalizeOptionalShortText(attachmentSource?.mimeType, 120) ?? '').trim().toLowerCase() || null,
          fileName: sanitizeChatAttachmentFileName(attachmentSource?.fileName),
          sizeBytes: Number.isFinite(Number(attachmentSource?.sizeBytes))
            ? Math.max(0, Math.floor(Number(attachmentSource.sizeBytes)))
            : null,
          durationMillis: attachmentKind === chatMessageTypeVoice
            ? toBoundedInteger(attachmentSource?.durationMillis, 0, 3_600_000, 0)
            : null,
          dataUrl: attachmentDataUrl || null,
          deletedAt: String(attachmentSource?.deletedAt ?? '').trim() || null,
          deletedByUid: String(normalizeOptionalShortText(attachmentSource?.deletedByUid, 220) ?? '').trim() || null,
          deletedByEmail: normalizeEmail(attachmentSource?.deletedByEmail) || null,
        }
      : null
    const replySource = message.replyTo && typeof message.replyTo === 'object'
      ? message.replyTo
      : null
    const replyMessageId = String(normalizeOptionalShortText(replySource?.messageId, 220) ?? '').trim()
    const replyTo = replyMessageId
      ? {
          messageId: replyMessageId,
          text: normalizeChatText(replySource?.text) || null,
          messageType: normalizeChatMessageType(replySource?.messageType),
          createdByName: String(normalizeOptionalShortText(replySource?.createdByName, 220) ?? '').trim() || null,
          createdByEmail: normalizeEmail(replySource?.createdByEmail) || null,
        }
      : null

    return {
      id: messageId,
      chatId,
      text: normalizeChatText(message.text) || null,
      messageType: normalizeChatMessageType(message.messageType),
      attachment,
      replyTo,
      deliveryStatus: resolveChatMessageDeliveryStatus(message, thread, requesterUid),
      reactions: normalizeChatReactions(message.reactions, requesterUid),
      createdAt: String(message.createdAt ?? '').trim() || null,
      createdByUid: String(normalizeOptionalShortText(message.createdByUid, 220) ?? '').trim() || null,
      createdByEmail: normalizeEmail(message.createdByEmail) || null,
      createdByName: String(normalizeOptionalShortText(message.createdByName, 220) ?? '').trim() || null,
      updatedAt: String(message.updatedAt ?? '').trim() || null,
      updatedByUid: String(normalizeOptionalShortText(message.updatedByUid, 220) ?? '').trim() || null,
      updatedByEmail: normalizeEmail(message.updatedByEmail) || null,
      updatedByName: String(normalizeOptionalShortText(message.updatedByName, 220) ?? '').trim() || null,
      deletedAt: String(message.deletedAt ?? '').trim() || null,
      deletedByUid: String(normalizeOptionalShortText(message.deletedByUid, 220) ?? '').trim() || null,
      deletedByEmail: normalizeEmail(message.deletedByEmail) || null,
    }
  }

  function canManageChatMessage({
    publicUser,
    authUser,
    chatMessage,
  }) {
    if (publicUser?.isApproved && publicUser?.isAdmin) {
      return true
    }

    const requesterUid = String(normalizeOptionalShortText(authUser?.uid, 220) ?? '').trim()
    const requesterEmail = normalizeEmail(authUser?.email)
    const createdByUid = String(normalizeOptionalShortText(chatMessage?.createdByUid, 220) ?? '').trim()
    const createdByEmail = normalizeEmail(chatMessage?.createdByEmail)

    return Boolean(
      (requesterUid && createdByUid && requesterUid === createdByUid)
      || (requesterEmail && createdByEmail && requesterEmail === createdByEmail),
    )
  }

  async function refreshChatThreadLastMessage({
    chatThreadsCollection,
    chatMessagesCollection,
    chatId,
    now = new Date().toISOString(),
  }) {
    const latestMessage = await chatMessagesCollection.findOne(
      {
        chatId,
      },
      {
        projection: {
          _id: 0,
          id: 1,
          chatId: 1,
          text: 1,
          messageType: 1,
          attachment: 1,
          createdAt: 1,
          deletedAt: 1,
        },
        sort: {
          createdAt: -1,
          id: -1,
        },
      },
    )

    if (!latestMessage) {
      await chatThreadsCollection.updateOne(
        {
          id: chatId,
        },
        {
          $set: {
            updatedAt: now,
            lastMessageAt: null,
            lastMessagePreview: null,
            lastMessageType: chatMessageTypeText,
          },
        },
      )
      return
    }

    await chatThreadsCollection.updateOne(
      {
        id: chatId,
      },
      {
        $set: {
          updatedAt: now,
          lastMessageAt: String(latestMessage.createdAt ?? '').trim() || now,
          lastMessagePreview: buildChatThreadLastMessagePreview(latestMessage),
          lastMessageType: resolveChatMessageType({
            text: latestMessage.text,
            attachment: latestMessage.attachment,
            deletedAt: latestMessage.deletedAt,
          }),
        },
      },
    )
  }

  app.get('/api/chat/users', requireFirebaseAuth, async (req, res, next) => {
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
        .map((document) => normalizeChatUserRecord(toPublicAuthUser(document)))
        .filter(Boolean)
        // Admins, managers, and office workers may initiate direct chats.
        // Shop workers and sales reps only see conversations they were added to.
        .filter(() => canStartDirectChat(publicUser))
        .sort((left, right) => {
          const leftLabel = String(left.displayName || left.email).toLowerCase()
          const rightLabel = String(right.displayName || right.email).toLowerCase()

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

  app.get('/api/chat/threads', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const requesterUid = String(normalizeOptionalShortText(publicUser.uid, 220) ?? '').trim()

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      const requestedType = String(normalizeOptionalShortText(req.query?.type, 24) ?? '').trim().toLowerCase()
      const threadTypeFilter = requestedType === chatTypeGroup || requestedType === chatTypeDirect
        ? requestedType
        : null
      const { collections, chatThreadsCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const filter = {
        memberUids: requesterUid,
        hiddenForUids: {
          $ne: requesterUid,
        },
        ...(threadTypeFilter
          ? {
              type: threadTypeFilter,
            }
          : {}),
      }
      const threadDocuments = await chatThreadsCollection
        .find(
          filter,
          {
            projection: {
              _id: 0,
              id: 1,
              type: 1,
              name: 1,
              memberUids: 1,
              memberSnapshots: 1,
              createdAt: 1,
              updatedAt: 1,
              createdByUid: 1,
              createdByEmail: 1,
              createdByName: 1,
              lastMessageAt: 1,
              lastMessagePreview: 1,
              lastMessageType: 1,
              pinnedByUids: 1,
              historyClearedAtByUid: 1,
              deliveredAtByUid: 1,
              readAtByUid: 1,
            },
          },
        )
        .sort({ updatedAt: -1, lastMessageAt: -1, createdAt: -1 })
        .limit(400)
        .toArray()

      if (threadDocuments.length > 0) {
        const deliveredFieldKey = buildChatUidFieldKey(requesterUid)

        if (deliveredFieldKey) {
          await chatThreadsCollection.updateMany(
            {
              id: {
                $in: threadDocuments.map((thread) => thread.id).filter(Boolean),
              },
              memberUids: requesterUid,
            },
            {
              $set: {
                [`deliveredAtByUid.${deliveredFieldKey}`]: new Date().toISOString(),
              },
            },
          )
        }
      }

      const threads = await Promise.all(
        threadDocuments.map((thread) => resolveChatThreadWithMembers({
          authUsersCollection,
          requesterUid,
          thread,
        })),
      )
      const visibleThreads = threads.filter((thread) => Boolean(thread?.lastMessageAt))

      return res.json({
        threads: visibleThreads,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/chat/threads/direct', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      if (!canStartDirectChat(publicUser)) {
        return res.status(403).json({
          error: 'Only admins, managers, and office workers can start a new direct chat.',
        })
      }

      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const requesterEmail = normalizeEmail(req.authUser?.email) || null
      const targetUid = String(normalizeOptionalShortText(req.body?.targetUid, 220) ?? '').trim()

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      if (!targetUid) {
        return res.status(400).json({
          error: 'targetUid is required.',
        })
      }

      if (targetUid === requesterUid) {
        return res.status(400).json({
          error: 'You cannot create a direct chat with yourself.',
        })
      }

      const { collections, chatThreadsCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const participantMapByUid = await buildApprovedUserMapByUid(authUsersCollection, [requesterUid, targetUid])
      const requesterParticipant = participantMapByUid.get(requesterUid)
      const targetParticipant = participantMapByUid.get(targetUid)

      if (!requesterParticipant || !targetParticipant) {
        return res.status(404).json({
          error: 'Both users must be approved before starting a chat.',
        })
      }

      const memberUids = [requesterUid, targetUid].sort((left, right) => left.localeCompare(right))
      const directKey = buildChatDirectKey(memberUids)

      if (!directKey) {
        return res.status(400).json({
          error: 'A direct chat requires exactly two members.',
        })
      }

      const existingThread = await chatThreadsCollection.findOne(
        {
          directKey,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (existingThread) {
        const now = new Date().toISOString()
        await chatThreadsCollection.updateOne(
          {
            id: existingThread.id,
          },
          {
            $set: {
              updatedAt: now,
            },
          },
        )
        const hydratedThread = await resolveChatThreadWithMembers({
          authUsersCollection,
          requesterUid,
          thread: {
            ...existingThread,
            updatedAt: now,
          },
        })

        return res.json({
          thread: hydratedThread,
          created: false,
        })
      }

      const now = new Date().toISOString()
      const threadToInsert = {
        id: randomUUID(),
        type: chatTypeDirect,
        memberUids,
        memberSnapshots: [requesterParticipant, targetParticipant],
        directKey,
        createdAt: now,
        updatedAt: now,
        createdByUid: requesterUid,
        createdByEmail: requesterEmail,
        createdByName: String(normalizeOptionalShortText(publicUser?.displayName, 220) ?? '').trim() || null,
        lastMessageAt: null,
        lastMessagePreview: null,
        lastMessageType: chatMessageTypeText,
      }

      try {
        await chatThreadsCollection.insertOne(threadToInsert)
      } catch (error) {
        if (String(error?.code ?? '') !== '11000') {
          throw error
        }
      }

      const insertedThread = await chatThreadsCollection.findOne(
        {
          directKey,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      const hydratedThread = await resolveChatThreadWithMembers({
        authUsersCollection,
        requesterUid,
        thread: insertedThread,
      })

      return res.status(201).json({
        thread: hydratedThread,
        created: true,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/chat/groups', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved || !publicUser?.isAdmin) {
        return res.status(403).json({
          error: 'Admin access is required.',
        })
      }

      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const requesterEmail = normalizeEmail(req.authUser?.email) || null
      const groupName = normalizeChatName(req.body?.name)
      const requestedMembers = normalizeChatUidList(req.body?.memberUids, 250)

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      if (!groupName) {
        return res.status(400).json({
          error: 'Group name is required.',
        })
      }

      const requestedMemberSet = new Set(requestedMembers)
      requestedMemberSet.add(requesterUid)

      const requestedMemberUids = [...requestedMemberSet]

      if (requestedMemberUids.length < 2) {
        return res.status(400).json({
          error: 'Groups must include at least two members.',
        })
      }

      const { collections, chatThreadsCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const memberMapByUid = await buildApprovedUserMapByUid(authUsersCollection, requestedMemberUids)
      const memberProfiles = requestedMemberUids
        .map((uid) => memberMapByUid.get(uid) || null)
        .filter(Boolean)

      if (memberProfiles.length < 2) {
        return res.status(400).json({
          error: 'At least two approved users are required to create a group.',
        })
      }

      if (!memberProfiles.some((member) => member.isAdmin)) {
        return res.status(400).json({
          error: 'At least one admin must be a group member.',
        })
      }

      const now = new Date().toISOString()
      const memberUids = normalizeChatUidList(memberProfiles.map((member) => member.uid), 250)
      const threadToInsert = {
        id: randomUUID(),
        type: chatTypeGroup,
        name: groupName,
        memberUids,
        memberSnapshots: memberProfiles,
        createdAt: now,
        updatedAt: now,
        createdByUid: requesterUid,
        createdByEmail: requesterEmail,
        createdByName: String(normalizeOptionalShortText(publicUser?.displayName, 220) ?? '').trim() || null,
        lastMessageAt: null,
        lastMessagePreview: null,
        lastMessageType: chatMessageTypeText,
      }

      await chatThreadsCollection.insertOne(threadToInsert)

      const hydratedThread = await resolveChatThreadWithMembers({
        authUsersCollection,
        requesterUid,
        thread: threadToInsert,
      })

      return res.status(201).json({
        thread: hydratedThread,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/chat/groups/:threadId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved || !publicUser?.isAdmin) {
        return res.status(403).json({
          error: 'Admin access is required.',
        })
      }

      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()

      if (!threadId) {
        return res.status(400).json({
          error: 'threadId is required.',
        })
      }

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      const nextGroupName = String(normalizeOptionalShortText(req.body?.name, 120) ?? '').trim()
      const hasNameUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'name')
      const hasMembersUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'memberUids')

      if (!hasNameUpdate && !hasMembersUpdate) {
        return res.status(400).json({
          error: 'Provide at least one of name or memberUids.',
        })
      }

      const { collections, chatThreadsCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const existingThread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          type: chatTypeGroup,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!existingThread) {
        return res.status(404).json({
          error: 'Group chat not found.',
        })
      }

      const updateFields = {
        updatedAt: new Date().toISOString(),
      }

      if (hasNameUpdate) {
        if (!nextGroupName) {
          return res.status(400).json({
            error: 'Group name cannot be empty.',
          })
        }

        updateFields.name = nextGroupName
      }

      if (hasMembersUpdate) {
        const requestedMemberSet = new Set(normalizeChatUidList(req.body?.memberUids, 250))
        requestedMemberSet.add(requesterUid)

        const requestedMemberUids = [...requestedMemberSet]

        if (requestedMemberUids.length < 2) {
          return res.status(400).json({
            error: 'Groups must include at least two members.',
          })
        }

        const memberMapByUid = await buildApprovedUserMapByUid(authUsersCollection, requestedMemberUids)
        const memberProfiles = requestedMemberUids
          .map((uid) => memberMapByUid.get(uid) || null)
          .filter(Boolean)

        if (memberProfiles.length < 2) {
          return res.status(400).json({
            error: 'At least two approved users are required in a group.',
          })
        }

        if (!memberProfiles.some((member) => member.isAdmin)) {
          return res.status(400).json({
            error: 'At least one admin must be a group member.',
          })
        }

        updateFields.memberUids = normalizeChatUidList(memberProfiles.map((member) => member.uid), 250)
        updateFields.memberSnapshots = memberProfiles
      }

      await chatThreadsCollection.updateOne(
        {
          id: threadId,
          type: chatTypeGroup,
        },
        {
          $set: updateFields,
        },
      )

      const updatedThread = await chatThreadsCollection.findOne(
        {
          id: threadId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
      const hydratedThread = await resolveChatThreadWithMembers({
        authUsersCollection,
        requesterUid,
        thread: updatedThread,
      })

      return res.json({
        thread: hydratedThread,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/chat/threads/:threadId/preferences', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()

      if (!publicUser?.isApproved || !requesterUid) {
        return res.status(403).json({ error: 'Approved access is required.' })
      }

      if (!threadId || typeof req.body?.pinned !== 'boolean') {
        return res.status(400).json({ error: 'threadId and pinned are required.' })
      }

      const { collections, chatThreadsCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const thread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      await chatThreadsCollection.updateOne(
        {
          id: threadId,
        },
        req.body.pinned
          ? {
              $addToSet: {
                pinnedByUids: requesterUid,
              },
            }
          : {
              $pull: {
                pinnedByUids: requesterUid,
              },
            },
      )

      const updatedThread = await chatThreadsCollection.findOne(
        {
          id: threadId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      return res.json({
        thread: await resolveChatThreadWithMembers({
          authUsersCollection,
          requesterUid,
          thread: updatedThread,
        }),
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/chat/threads/:threadId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()

      if (!publicUser?.isApproved || !requesterUid) {
        return res.status(403).json({ error: 'Approved access is required.' })
      }

      if (!threadId) {
        return res.status(400).json({ error: 'threadId is required.' })
      }

      const deleteForEveryone = req.body?.deleteForEveryone === true

      if (deleteForEveryone && !publicUser?.isAdmin) {
        return res.status(403).json({ error: 'Only admins can delete a chat for everyone.' })
      }

      const { chatThreadsCollection } = await getChatCollections()
      const thread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            memberUids: 1,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      const affectedUids = deleteForEveryone
        ? normalizeChatUidList(thread.memberUids, 250)
        : [requesterUid]
      const now = new Date().toISOString()
      const historyBoundaryFields = Object.fromEntries(
        affectedUids
          .map((uid) => buildChatUidFieldKey(uid))
          .filter(Boolean)
          .map((fieldKey) => [`historyClearedAtByUid.${fieldKey}`, now]),
      )
      const result = await chatThreadsCollection.updateOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          $set: historyBoundaryFields,
          $addToSet: {
            hiddenForUids: {
              $each: affectedUids,
            },
          },
          $pull: {
            pinnedByUids: {
              $in: affectedUids,
            },
          },
        },
      )

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      return res.json({
        ok: true,
        threadId,
        deletedForEveryone: deleteForEveryone,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/chat/threads/:threadId/typing', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()

      if (!publicUser?.isApproved) {
        return res.status(403).json({ error: 'Approved access is required.' })
      }

      if (!threadId || !requesterUid) {
        return res.status(400).json({ error: 'threadId and authenticated user are required.' })
      }

      const typingFieldKey = buildChatUidFieldKey(requesterUid)
      const { chatThreadsCollection } = await getChatCollections()
      const now = new Date().toISOString()
      const result = await chatThreadsCollection.updateOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          $set: {
            [`typingByUid.${typingFieldKey}`]: {
              uid: requesterUid,
              displayName: String(normalizeOptionalShortText(publicUser?.displayName, 220) ?? '').trim() || null,
              email: normalizeEmail(req.authUser?.email) || null,
              isTyping: req.body?.isTyping === true,
              updatedAt: now,
            },
          },
        },
      )

      if (!result.matchedCount) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      return res.json({
        ok: true,
        isTyping: req.body?.isTyping === true,
        updatedAt: now,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/chat/threads/:threadId/activity', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()

      if (!publicUser?.isApproved) {
        return res.status(403).json({ error: 'Approved access is required.' })
      }

      if (!threadId || !requesterUid) {
        return res.status(400).json({ error: 'threadId and authenticated user are required.' })
      }

      const { chatThreadsCollection } = await getChatCollections()
      const thread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
            typingByUid: 1,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      const nowMs = Date.now()
      const typingUsers = Object.values(
        thread.typingByUid && typeof thread.typingByUid === 'object'
          ? thread.typingByUid
          : {},
      )
        .filter((entry) => {
          const entryUid = String(normalizeOptionalShortText(entry?.uid, 220) ?? '').trim()
          const updatedAtMs = Date.parse(String(entry?.updatedAt ?? '').trim())

          return Boolean(
            entryUid
            && entryUid !== requesterUid
            && entry?.isTyping === true
            && Number.isFinite(updatedAtMs)
            && nowMs - updatedAtMs <= 6500,
          )
        })
        .map((entry) => ({
          uid: String(normalizeOptionalShortText(entry?.uid, 220) ?? '').trim(),
          displayName: String(normalizeOptionalShortText(entry?.displayName, 220) ?? '').trim() || null,
          email: normalizeEmail(entry?.email) || null,
        }))

      return res.json({
        generatedAt: new Date().toISOString(),
        typingUsers,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/chat/threads/:threadId/messages', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()

      if (!threadId) {
        return res.status(400).json({
          error: 'threadId is required.',
        })
      }

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      const offset = normalizeChatOffset(req.query?.offset)
      const limit = normalizeChatLimit(req.query?.limit)
      const { collections, chatThreadsCollection, chatMessagesCollection } = await getChatCollections()
      const { authUsersCollection } = collections
      const thread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({
          error: 'Chat thread not found.',
        })
      }

      const receiptTimestamp = new Date().toISOString()
      const receiptFieldKey = buildChatUidFieldKey(requesterUid)
      const receiptThread = receiptFieldKey
        ? {
            ...thread,
            deliveredAtByUid: {
              ...(thread.deliveredAtByUid && typeof thread.deliveredAtByUid === 'object'
                ? thread.deliveredAtByUid
                : {}),
              [receiptFieldKey]: receiptTimestamp,
            },
            readAtByUid: {
              ...(thread.readAtByUid && typeof thread.readAtByUid === 'object'
                ? thread.readAtByUid
                : {}),
              [receiptFieldKey]: receiptTimestamp,
            },
          }
        : thread

      if (receiptFieldKey) {
        await chatThreadsCollection.updateOne(
          {
            id: threadId,
            memberUids: requesterUid,
          },
          {
            $set: {
              [`deliveredAtByUid.${receiptFieldKey}`]: receiptTimestamp,
              [`readAtByUid.${receiptFieldKey}`]: receiptTimestamp,
            },
          },
        )
      }

      const historyClearedAt = getChatHistoryClearedAt(thread, requesterUid)
      const filter = {
        chatId: threadId,
        ...(historyClearedAt
          ? {
              createdAt: {
                $gt: historyClearedAt,
              },
            }
          : {}),
      }
      const [total, messagesRaw] = await Promise.all([
        chatMessagesCollection.countDocuments(filter),
        chatMessagesCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
              },
            },
          )
          .sort({ createdAt: -1, id: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      const messages = messagesRaw
        .reverse()
        .map((message) => toPublicChatMessage(message, {
          requesterUid,
          thread: receiptThread,
        }))
        .filter(Boolean)
      const hydratedThread = await resolveChatThreadWithMembers({
        authUsersCollection,
        requesterUid,
        thread: receiptThread,
      })

      return res.json({
        thread: hydratedThread,
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

  app.post('/api/chat/threads/:threadId/messages', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const threadId = String(normalizeOptionalShortText(req.params.threadId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const requesterEmail = normalizeEmail(req.authUser?.email) || null
      const messageText = normalizeChatText(req.body?.text)
      const attachment = normalizeChatAttachmentInput(req.body?.attachment)
      const replyToMessageId = String(normalizeOptionalShortText(req.body?.replyToMessageId, 220) ?? '').trim()
      const requestedMentionUserUids = normalizeChatUidList(req.body?.mentionUserUids, 300)

      if (!threadId) {
        return res.status(400).json({
          error: 'threadId is required.',
        })
      }

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      if (!messageText && !attachment) {
        return res.status(400).json({
          error: 'Provide text or attachment.',
        })
      }

      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'attachment') && !attachment) {
        return res.status(400).json({
          error: 'Attachment is invalid or too large.',
        })
      }

      const { collections, chatThreadsCollection, chatMessagesCollection } = await getChatCollections()
      const { authUsersCollection, mobileAlertsCollection } = collections
      const thread = await chatThreadsCollection.findOne(
        {
          id: threadId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            memberUids: 1,
            type: 1,
            name: 1,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({
          error: 'Chat thread not found.',
        })
      }

      const replyTarget = replyToMessageId
        ? await chatMessagesCollection.findOne(
            {
              id: replyToMessageId,
              chatId: threadId,
            },
            {
              projection: {
                _id: 0,
                id: 1,
                text: 1,
                messageType: 1,
                createdByName: 1,
                createdByEmail: 1,
              },
            },
          )
        : null

      if (replyToMessageId && !replyTarget) {
        return res.status(400).json({
          error: 'The message being replied to was not found.',
        })
      }

      const now = new Date().toISOString()
      const mentionUsers = requestedMentionUserUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: { $in: requestedMentionUserUids },
              approvalStatus: authApprovalApproved,
            },
            {
              projection: {
                _id: 0,
                uid: 1,
                email: 1,
              },
            },
          )
          .toArray()
        : []
      const mentionRecipientUids = normalizeChatUidList(
        mentionUsers
          .map((user) => String(user?.uid ?? '').trim())
          .filter((uid) => uid && uid !== requesterUid),
        300,
      )
      const mentionEmailByUid = new Map(
        mentionUsers.map((user) => [String(user?.uid ?? '').trim(), normalizeEmail(user?.email)]),
      )
      const mentionRecipientEmails = mentionRecipientUids
        .map((uid) => mentionEmailByUid.get(uid))
        .filter(Boolean)
      const messageDocument = {
        id: randomUUID(),
        chatId: threadId,
        text: messageText || null,
        attachment: attachment
          ? {
              ...attachment,
            }
          : null,
        replyTo: replyTarget
          ? {
              messageId: replyTarget.id,
              text: normalizeChatText(replyTarget.text) || null,
              messageType: normalizeChatMessageType(replyTarget.messageType),
              createdByName: String(normalizeOptionalShortText(replyTarget.createdByName, 220) ?? '').trim() || null,
              createdByEmail: normalizeEmail(replyTarget.createdByEmail) || null,
            }
          : null,
        messageType: resolveChatMessageType({
          text: messageText,
          attachment,
          deletedAt: null,
        }),
        createdAt: now,
        createdByUid: requesterUid,
        createdByEmail: requesterEmail,
        createdByName: String(normalizeOptionalShortText(publicUser?.displayName, 220) ?? '').trim() || null,
        updatedAt: null,
        updatedByUid: null,
        updatedByEmail: null,
        updatedByName: null,
        deletedAt: null,
        deletedByUid: null,
        deletedByEmail: null,
        mentionUserUids: mentionRecipientUids,
        mentionUserEmails: mentionRecipientEmails,
      }

      await chatMessagesCollection.insertOne(messageDocument)

      if (mentionRecipientUids.length > 0) {
        const authorName = String(normalizeOptionalShortText(publicUser?.displayName || requesterEmail || 'A teammate', 120) ?? '').trim()
        const chatLabel = String(normalizeOptionalShortText(thread.name, 120) ?? '').trim() || 'chat'
        const alertNow = new Date().toISOString()

        await mobileAlertsCollection.insertOne({
          id: randomUUID(),
          title: `Mentioned in ${chatLabel}`,
          message: `${authorName} mentioned you: ${(messageText || 'Sent an attachment').slice(0, 300)}`,
          isUpdate: false,
          targetMode: 'selected',
          targetUserUids: mentionRecipientUids,
          createdByUid: requesterUid,
          createdByEmail: requesterEmail,
          delivery: {
            targetUserCount: mentionRecipientUids.length,
            pushTokenCount: 0,
            pushAcceptedCount: 0,
            pushErrorCount: 0,
            errorSamples: [],
          },
          metadata: {
            source: 'app_chat_mention',
            chatThreadId: threadId,
            chatMessageId: messageDocument.id,
          },
          createdAt: alertNow,
          updatedAt: alertNow,
        })
      }

      await chatThreadsCollection.updateOne(
        {
          id: threadId,
        },
        {
          $set: {
            updatedAt: now,
            lastMessageAt: now,
            lastMessagePreview: buildChatThreadLastMessagePreview(messageDocument),
            lastMessageType: messageDocument.messageType,
          },
          $pull: {
            hiddenForUids: {
              $in: normalizeChatUidList(thread.memberUids, 250),
            },
          },
        },
      )

      return res.status(201).json({
        message: toPublicChatMessage(messageDocument, {
          requesterUid,
          thread,
        }),
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/chat/messages/:messageId/reactions', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)
      const messageId = String(normalizeOptionalShortText(req.params.messageId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()
      const emoji = String(req.body?.emoji ?? '').trim()

      if (!publicUser?.isApproved) {
        return res.status(403).json({ error: 'Approved access is required.' })
      }

      if (!messageId || !requesterUid) {
        return res.status(400).json({ error: 'messageId and authenticated user are required.' })
      }

      if (!allowedChatReactionEmojis.includes(emoji)) {
        return res.status(400).json({ error: 'Unsupported reaction.' })
      }

      const { chatThreadsCollection, chatMessagesCollection } = await getChatCollections()
      const message = await chatMessagesCollection.findOne(
        {
          id: messageId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!message || message.deletedAt) {
        return res.status(404).json({ error: 'Chat message not found.' })
      }

      const thread = await chatThreadsCollection.findOne(
        {
          id: message.chatId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found.' })
      }

      const reactions = Array.isArray(message.reactions)
        ? message.reactions
          .map((reaction) => ({
            emoji: String(reaction?.emoji ?? '').trim(),
            userUids: normalizeChatUidList(reaction?.userUids, 250),
          }))
          .filter((reaction) => allowedChatReactionEmojis.includes(reaction.emoji))
        : []
      const reactionIndex = reactions.findIndex((reaction) => reaction.emoji === emoji)

      if (reactionIndex >= 0) {
        const existingUserIndex = reactions[reactionIndex].userUids.indexOf(requesterUid)

        if (existingUserIndex >= 0) {
          reactions[reactionIndex].userUids.splice(existingUserIndex, 1)
        } else {
          reactions[reactionIndex].userUids.push(requesterUid)
        }

        if (reactions[reactionIndex].userUids.length === 0) {
          reactions.splice(reactionIndex, 1)
        }
      } else {
        reactions.push({
          emoji,
          userUids: [requesterUid],
        })
      }

      const now = new Date().toISOString()
      await chatMessagesCollection.updateOne(
        {
          id: messageId,
          chatId: message.chatId,
        },
        {
          $set: {
            reactions,
            updatedAt: now,
          },
        },
      )

      return res.json({
        message: toPublicChatMessage(
          {
            ...message,
            reactions,
            updatedAt: now,
          },
          {
            requesterUid,
            thread,
          },
        ),
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/chat/messages/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const publicUser = toPublicAuthUser(req.authUser)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const messageId = String(normalizeOptionalShortText(req.params.messageId, 220) ?? '').trim()
      const requesterUid = String(normalizeOptionalShortText(req.authUser?.uid, 220) ?? '').trim()

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      if (!requesterUid) {
        return res.status(401).json({
          error: 'Authenticated user is required.',
        })
      }

      const { chatThreadsCollection, chatMessagesCollection } = await getChatCollections()
      const existingMessage = await chatMessagesCollection.findOne(
        {
          id: messageId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            chatId: 1,
            text: 1,
            attachment: 1,
            createdByUid: 1,
            createdByEmail: 1,
            deletedAt: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      const thread = await chatThreadsCollection.findOne(
        {
          id: existingMessage.chatId,
          memberUids: requesterUid,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            memberUids: 1,
          },
        },
      )

      if (!thread) {
        return res.status(404).json({
          error: 'Chat thread not found.',
        })
      }

      if (!canManageChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only delete your own messages unless you are an admin.',
        })
      }

      const now = new Date().toISOString()
      const deletedByUid = requesterUid
      const deletedByEmail = normalizeEmail(req.authUser?.email) || null
      const existingAttachment = existingMessage.attachment && typeof existingMessage.attachment === 'object'
        ? existingMessage.attachment
        : null
      const nextAttachment = existingAttachment
        ? {
            kind: normalizeChatAttachmentKind(existingAttachment.kind),
            mimeType: String(normalizeOptionalShortText(existingAttachment.mimeType, 120) ?? '').trim().toLowerCase() || null,
            fileName: sanitizeChatAttachmentFileName(existingAttachment.fileName),
            sizeBytes: Number.isFinite(Number(existingAttachment.sizeBytes))
              ? Math.max(0, Math.floor(Number(existingAttachment.sizeBytes)))
              : null,
            durationMillis: normalizeChatAttachmentKind(existingAttachment.kind) === chatMessageTypeVoice
              ? toBoundedInteger(existingAttachment.durationMillis, 0, 3_600_000, 0)
              : null,
            dataUrl: null,
            deletedAt: now,
            deletedByUid,
            deletedByEmail,
          }
        : null

      await chatMessagesCollection.updateOne(
        {
          id: messageId,
        },
        {
          $set: {
            text: null,
            attachment: nextAttachment,
            messageType: chatMessageTypeDeleted,
            deletedAt: now,
            deletedByUid,
            deletedByEmail,
            updatedAt: now,
            updatedByUid: deletedByUid,
            updatedByEmail: deletedByEmail,
            updatedByName: String(normalizeOptionalShortText(publicUser?.displayName, 220) ?? '').trim() || null,
          },
        },
      )

      await refreshChatThreadLastMessage({
        chatThreadsCollection,
        chatMessagesCollection,
        chatId: existingMessage.chatId,
        now,
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
