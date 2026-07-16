import { randomUUID } from 'node:crypto'

let appChatThreadsIndexesPromise
let appChatMessagesIndexesPromise

const chatTypeDirect = 'direct'
const chatTypeGroup = 'group'
const chatMessageTypeText = 'text'
const chatMessageTypeImage = 'image'
const chatMessageTypeVoice = 'voice'
const chatMessageTypeMixed = 'mixed'
const chatMessageTypeDeleted = 'deleted'
const maxChatAttachmentBytes = 6 * 1024 * 1024
const defaultChatOwnerEmail = 'cal@arnoldcontract.us'

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

  function isDefaultChatOwnerEmail(value) {
    return normalizeEmail(value) === defaultChatOwnerEmail
  }

  function isDefaultChatOwnerUser(user) {
    return Boolean(user?.isAdmin && isDefaultChatOwnerEmail(user?.email))
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

    const voiceMimeType = normalizedMimeType.startsWith('audio/')
      ? normalizedMimeType
      : 'audio/mp4'

    return {
      kind: chatMessageTypeVoice,
      mimeType: voiceMimeType,
      fileName: sanitizeChatAttachmentFileName(source.fileName),
      sizeBytes,
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
      isAdmin: Boolean(user?.isAdmin),
      isManager: Boolean(user?.isManager),
      isSalesRep: Boolean(user?.isSalesRep),
      hasWebAccess: Boolean(user?.hasWebAccess),
      hasAppAccess: Boolean(user?.hasAppAccess),
    }
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

    return {
      id: thread.id,
      type: normalizeChatType(thread.type),
      name: String(normalizeOptionalShortText(thread.name, 120) ?? '').trim() || null,
      memberUids,
      memberProfiles,
      createdAt: String(thread.createdAt ?? '').trim() || null,
      updatedAt: String(thread.updatedAt ?? '').trim() || null,
      lastMessageAt: String(thread.lastMessageAt ?? '').trim() || null,
      lastMessagePreview: String(normalizeOptionalShortText(thread.lastMessagePreview, 400) ?? '').trim() || null,
      lastMessageType: normalizeChatMessageType(thread.lastMessageType),
      createdByUid: String(normalizeOptionalShortText(thread.createdByUid, 220) ?? '').trim() || null,
      createdByEmail: normalizeEmail(thread.createdByEmail) || null,
      createdByName: String(normalizeOptionalShortText(thread.createdByName, 220) ?? '').trim() || null,
    }
  }

  function toPublicChatMessage(message) {
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
          dataUrl: attachmentDataUrl || null,
          deletedAt: String(attachmentSource?.deletedAt ?? '').trim() || null,
          deletedByUid: String(normalizeOptionalShortText(attachmentSource?.deletedByUid, 220) ?? '').trim() || null,
          deletedByEmail: normalizeEmail(attachmentSource?.deletedByEmail) || null,
        }
      : null

    return {
      id: messageId,
      chatId,
      text: normalizeChatText(message.text) || null,
      messageType: normalizeChatMessageType(message.messageType),
      attachment,
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
        .filter((user) => {
          if (publicUser?.isAdmin) {
            return true
          }

          return isDefaultChatOwnerUser(user)
        })
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
            },
          },
        )
        .sort({ updatedAt: -1, lastMessageAt: -1, createdAt: -1 })
        .limit(400)
        .toArray()

      const threads = await Promise.all(
        threadDocuments.map((thread) => resolveChatThreadWithMembers({
          authUsersCollection,
          thread,
        })),
      )
      const visibleThreads = threads
        .filter(Boolean)
        .filter((thread) => {
          if (publicUser?.isAdmin) {
            return true
          }

          if (normalizeChatType(thread.type) !== chatTypeDirect) {
            return true
          }

          return thread.memberProfiles.some((member) => isDefaultChatOwnerEmail(member?.email))
        })

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

      if (!publicUser?.isAdmin) {
        if (!targetParticipant.isAdmin) {
          return res.status(403).json({
            error: 'Workers can only start direct chats with admins.',
          })
        }

        if (!isDefaultChatOwnerEmail(targetParticipant.email)) {
          return res.status(403).json({
            error: 'Workers can only start direct chats with Owner.',
          })
        }
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
        const hydratedThread = await resolveChatThreadWithMembers({
          authUsersCollection,
          thread: existingThread,
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
        thread: updatedThread,
      })

      return res.json({
        thread: hydratedThread,
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

      const filter = {
        chatId: threadId,
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
          .sort({ createdAt: 1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      const messages = messagesRaw
        .map((message) => toPublicChatMessage(message))
        .filter(Boolean)
      const hydratedThread = await resolveChatThreadWithMembers({
        authUsersCollection,
        thread,
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

      const { chatThreadsCollection, chatMessagesCollection } = await getChatCollections()
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
          },
        },
      )

      if (!thread) {
        return res.status(404).json({
          error: 'Chat thread not found.',
        })
      }

      const now = new Date().toISOString()
      const messageDocument = {
        id: randomUUID(),
        chatId: threadId,
        text: messageText || null,
        attachment: attachment
          ? {
              ...attachment,
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
      }

      await chatMessagesCollection.insertOne(messageDocument)

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
        },
      )

      return res.status(201).json({
        message: toPublicChatMessage(messageDocument),
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
