import { Ionicons } from '@expo/vector-icons'
import { Chat, defaultTheme, type MessageType, type Theme, type User } from '@flyerhq/react-native-chat-ui'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useWindowDimensions } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { styles } from '../appStyles'
import type { MobileChatMessage, MobileChatTypingUser, MobileChatUser } from '../appTypes'
import { formatSyncTimestamp } from '../appUtils'

type TranslateFn = (english: string, spanish: string) => string
const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

type ChatAttachmentDraft = {
  kind: 'image' | 'voice' | 'file'
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
  durationMillis?: number
}

type ChatThreadScreenProps = {
  threadTitle: string
  threadSubtitle: string
  locale: string
  t: TranslateFn
  messages: MobileChatMessage[]
  currentUserUid: string
  currentUserEmail: string
  isAdminUser: boolean
  isLoading: boolean
  isSendingMessage: boolean
  isRecordingVoice: boolean
  isProcessingVoice: boolean
  playingMessageId: string | null
  voicePlaybackState: {
    messageId: string
    positionMillis: number
    durationMillis: number
  } | null
  composerText: string
  attachmentDraft: ChatAttachmentDraft | null
  replyDraft: MobileChatMessage | null
  typingUsers: MobileChatTypingUser[]
  hasMoreMessages: boolean
  isGroupChat: boolean
  memberProfiles: MobileChatUser[]
  inlineMessage: string | null
  onBack: () => void
  onComposerTextChange: (value: string) => void
  onAttachImage: (source: 'library' | 'camera') => void
  onAttachFile: () => void
  onSendMessage: (text?: string) => void
  onStartVoiceRecording: () => Promise<void>
  onStopVoiceRecording: (sendImmediately?: boolean) => Promise<void>
  onToggleVoicePlayback: (messageId: string, dataUrl: string) => void
  onOpenFile: (dataUrl: string, fileName: string, mimeType: string) => void
  onDeleteMessage: (messageId: string) => void
  onLoadOlderMessages: () => void
  onReplyMessage: (message: MobileChatMessage) => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onCancelReply: () => void
  onRemoveAttachmentDraft: () => void
}

type ArnoldMessageMetadata = {
  canDelete: boolean
  createdAtIso: string | null
  imageUri?: string
  isDeleted: boolean
  isMine: boolean
  senderLabel: string
  text?: string
  voiceUri?: string
  fileUri?: string
  fileName?: string
  fileMimeType?: string
  fileSizeBytes?: number
  voiceDurationMillis?: number
  replyLabel?: string
  replyText?: string
  reactions?: MobileChatMessage['reactions']
}

function normalizeTextValue(value: unknown) {
  return String(value ?? '').trim()
}

function formatVoiceDuration(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMillis ?? 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function ChatThreadScreen({
  threadTitle,
  threadSubtitle,
  locale,
  t,
  messages,
  currentUserUid,
  currentUserEmail,
  isAdminUser,
  isLoading,
  isSendingMessage,
  isRecordingVoice,
  isProcessingVoice,
  playingMessageId,
  voicePlaybackState,
  composerText,
  attachmentDraft,
  replyDraft,
  typingUsers,
  hasMoreMessages,
  isGroupChat,
  memberProfiles,
  inlineMessage,
  onBack,
  onComposerTextChange,
  onAttachImage,
  onAttachFile,
  onSendMessage,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onToggleVoicePlayback,
  onOpenFile,
  onDeleteMessage,
  onLoadOlderMessages,
  onReplyMessage,
  onToggleReaction,
  onCancelReply,
  onRemoveAttachmentDraft,
}: ChatThreadScreenProps) {
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false)
  const [chatViewportWidth, setChatViewportWidth] = useState(0)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null)
  const { width: windowWidth } = useWindowDimensions()
  const messageContainerWidth = Math.min(
    chatViewportWidth > 0
      ? Math.floor(Math.max(0, chatViewportWidth - 18) * (isGroupChat ? 0.70 : 0.77))
      : Math.floor(windowWidth * (isGroupChat ? 0.57 : 0.62)),
    440,
  )
  const messageBubbleWidth = Math.max(0, messageContainerWidth - 7)
  const voiceRecordingStartPromiseRef = useRef<Promise<void> | null>(null)
  const normalizedCurrentUid = normalizeTextValue(currentUserUid)
  const normalizedCurrentEmail = normalizeTextValue(currentUserEmail).toLowerCase()
  const memberProfileByUid = useMemo(
    () => new Map(memberProfiles.map((profile) => [profile.uid, profile])),
    [memberProfiles],
  )
  const chatTheme = useMemo<Theme>(() => ({
    ...defaultTheme,
    borders: {
      ...defaultTheme.borders,
      messageBorderRadius: 10,
    },
    colors: {
      ...defaultTheme.colors,
      background: 'transparent',
      primary: '#315aa8',
      secondary: '#ffffff',
    },
    fonts: {
      ...defaultTheme.fonts,
      dateDividerTextStyle: {
        ...defaultTheme.fonts.dateDividerTextStyle,
        color: '#71809c',
      },
      receivedMessageBodyTextStyle: {
        ...defaultTheme.fonts.receivedMessageBodyTextStyle,
        color: '#26342f',
        fontSize: 14,
        lineHeight: 20,
      },
      sentMessageBodyTextStyle: {
        ...defaultTheme.fonts.sentMessageBodyTextStyle,
        color: '#26342f',
        fontSize: 14,
        lineHeight: 20,
      },
      sentMessageLinkDescriptionTextStyle: {
        ...defaultTheme.fonts.sentMessageLinkDescriptionTextStyle,
        color: '#344b73',
      },
      sentMessageLinkTitleTextStyle: {
        ...defaultTheme.fonts.sentMessageLinkTitleTextStyle,
        color: '#1f3567',
      },
    },
    insets: {
      messageInsetsHorizontal: 0,
      messageInsetsVertical: 0,
    },
  }), [])

  const chatUser = useMemo<User>(() => ({
    id: normalizedCurrentUid || normalizedCurrentEmail || 'me',
    firstName: t('You', 'Tu'),
  }), [normalizedCurrentEmail, normalizedCurrentUid, t])
  const sourceMessageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  )
  const mediaMessages = useMemo(
    () => messages.filter((message) => Boolean(
      !message.deletedAt
      && message.attachment?.dataUrl
      && ['image', 'voice', 'file'].includes(message.attachment.kind),
    )),
    [messages],
  )

  const chatMessages = useMemo<MessageType.Any[]>(() => {
    return [...messages]
      .sort((left, right) => {
        const createdAtDifference = Date.parse(String(right.createdAt ?? ''))
          - Date.parse(String(left.createdAt ?? ''))

        return Number.isFinite(createdAtDifference) && createdAtDifference !== 0
          ? createdAtDifference
          : String(right.id).localeCompare(String(left.id))
      })
      .map((message) => {
      const createdAtIso = normalizeTextValue(message.createdAt) || null
      const parsedCreatedAt = createdAtIso ? Date.parse(createdAtIso) : Number.NaN
      const createdAt = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : 0
      const messageUid = normalizeTextValue(message.createdByUid)
      const messageEmail = normalizeTextValue(message.createdByEmail).toLowerCase()
      const memberProfile = memberProfileByUid.get(messageUid)
      const isMine = (Boolean(messageUid) && messageUid === normalizedCurrentUid)
        || (Boolean(messageEmail) && messageEmail === normalizedCurrentEmail)
      const isLocalOnly = message.deliveryStatus === 'sending' || message.deliveryStatus === 'error'
      const canDelete = !isLocalOnly && (isAdminUser || isMine)
      const isDeleted = Boolean(message.deletedAt || message.messageType === 'deleted')
      const senderLabel = isMine
        ? t('You', 'Tu')
        : normalizeTextValue(message.createdByName)
          || normalizeTextValue(message.createdByEmail)
          || t('Teammate', 'Companero')
      const textValue = normalizeTextValue(message.text)
      const imageUri = message.attachment?.kind === 'image' ? normalizeTextValue(message.attachment.dataUrl) : ''
      const voiceUri = message.attachment?.kind === 'voice' ? normalizeTextValue(message.attachment.dataUrl) : ''
      const fileUri = message.attachment?.kind === 'file' ? normalizeTextValue(message.attachment.dataUrl) : ''
      const replyLabel = normalizeTextValue(message.replyTo?.createdByName)
        || normalizeTextValue(message.replyTo?.createdByEmail)
        || t('Message', 'Mensaje')
      const replyText = normalizeTextValue(message.replyTo?.text)
        || (message.replyTo?.messageType === 'image'
          ? t('Photo', 'Foto')
          : message.replyTo?.messageType === 'voice'
            ? t('Voice message', 'Mensaje de voz')
            : message.replyTo?.messageType === 'file'
              ? t('File', 'Archivo')
              : '')
      const messageAuthor: User = {
        id: messageUid || messageEmail || message.id,
        firstName: senderLabel,
        ...(memberProfile?.imageUrl ? { imageUrl: memberProfile.imageUrl } : {}),
      }
      const metadata: ArnoldMessageMetadata = {
        canDelete,
        createdAtIso,
        isDeleted,
        isMine,
        senderLabel,
        reactions: Array.isArray(message.reactions) ? message.reactions : [],
        ...(message.replyTo ? { replyLabel, replyText } : {}),
        ...(textValue ? { text: textValue } : {}),
        ...(imageUri ? { imageUri } : {}),
        ...(voiceUri ? { voiceUri } : {}),
        ...(voiceUri
          ? { voiceDurationMillis: Math.max(0, Number(message.attachment?.durationMillis ?? 0)) }
          : {}),
        ...(fileUri
          ? {
              fileUri,
              fileName: normalizeTextValue(message.attachment?.fileName) || t('File', 'Archivo'),
              fileMimeType: normalizeTextValue(message.attachment?.mimeType) || 'application/octet-stream',
              fileSizeBytes: Number(message.attachment?.sizeBytes ?? 0) || 0,
            }
          : {}),
      }

      if (isDeleted) {
        return {
          author: messageAuthor,
          createdAt,
          id: message.id,
          metadata,
          status: message.deliveryStatus,
          text: t('Message deleted.', 'Mensaje borrado.'),
          type: 'text',
        } as MessageType.Text
      }

      if (voiceUri || fileUri || (imageUri && textValue)) {
        return {
          author: messageAuthor,
          createdAt,
          id: message.id,
          metadata,
          status: message.deliveryStatus,
          type: 'custom',
        } as MessageType.Custom
      }

      if (imageUri) {
        return {
          author: messageAuthor,
          createdAt,
          id: message.id,
          metadata,
          name: normalizeTextValue(message.attachment?.fileName) || 'chat-image',
          size: Number(message.attachment?.sizeBytes ?? 0) || 0,
          status: message.deliveryStatus,
          type: 'image',
          uri: imageUri,
        } as MessageType.Image
      }

      return {
        author: messageAuthor,
        createdAt,
        id: message.id,
        metadata,
        status: message.deliveryStatus,
        text: textValue,
        type: 'text',
      } as MessageType.Text
      })
  }, [
    isAdminUser,
    messages,
    memberProfileByUid,
    normalizedCurrentEmail,
    normalizedCurrentUid,
    t,
  ])

  const renderBubble = useCallback((payload: {
    child: ReactNode
    message: MessageType.Any
    nextMessageInGroup: boolean
  }) => {
    const metadata = (payload.message.metadata ?? {}) as ArnoldMessageMetadata
    const isMine = Boolean(metadata.isMine)
    const senderLabel = metadata.senderLabel ?? ''
    const createdAtLabel = formatSyncTimestamp(metadata.createdAtIso ?? null, locale)
    const messageId = normalizeTextValue(payload.message.id)
    const sourceMessage = sourceMessageById.get(messageId)

    return (
      <View
        style={[
          styles.chatMessageRow,
          isMine ? styles.chatMessageRowMine : styles.chatMessageRowOther,
          { width: messageContainerWidth },
        ]}
      >
        <View style={styles.chatMessageMetaRow}>
          {!isGroupChat ? (
            <Text style={styles.chatMessageSender} numberOfLines={1}>{senderLabel}</Text>
          ) : null}
          <Text style={styles.chatMessageTime} numberOfLines={1}>{createdAtLabel}</Text>
        </View>

        <Swipeable
          containerStyle={{ width: messageBubbleWidth, overflow: 'visible' }}
          overshootRight={false}
          renderRightActions={() => (
            <View style={styles.chatMessageSwipeActions}>
              {sourceMessage && !metadata.isDeleted ? (
                <Pressable
                  style={[styles.chatMessageSwipeAction, styles.chatMessageReplyAction]}
                  onPress={() => onReplyMessage(sourceMessage)}
                >
                  <Ionicons name="return-up-back" size={15} color="#ffffff" />
                  <Text style={styles.chatMessageSwipeActionText}>{t('Reply', 'Responder')}</Text>
                </Pressable>
              ) : null}
              {metadata.canDelete && !metadata.isDeleted ? (
                <Pressable
                  style={[styles.chatMessageSwipeAction, styles.chatMessageDeleteAction]}
                  onPress={() => {
                    Alert.alert(
                      t('Delete message?', 'Borrar mensaje?'),
                      t('This action cannot be undone.', 'Esta accion no se puede deshacer.'),
                      [
                        { style: 'cancel', text: t('Cancel', 'Cancelar') },
                        {
                          style: 'destructive',
                          text: t('Delete', 'Borrar'),
                          onPress: () => onDeleteMessage(messageId),
                        },
                      ],
                    )
                  }}
                >
                  <Ionicons name="trash-outline" size={15} color="#ffffff" />
                  <Text style={styles.chatMessageSwipeActionText}>{t('Delete', 'Borrar')}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        >
          <View
            style={[
              styles.chatMessageBubble,
              isMine ? styles.chatMessageBubbleMine : styles.chatMessageBubbleOther,
              isMine
                ? (payload.nextMessageInGroup
                  ? styles.chatMessageBubbleMineGrouped
                  : styles.chatMessageBubbleMineNativeCorner)
                : (payload.nextMessageInGroup
                  ? styles.chatMessageBubbleOtherGrouped
                  : styles.chatMessageBubbleOtherNativeCorner),
              { width: messageBubbleWidth },
            ]}
          >
            {metadata.replyText ? (
              <View style={styles.chatReplyQuote}>
                <Text style={styles.chatReplyQuoteSender} numberOfLines={1}>{metadata.replyLabel}</Text>
                <Text style={styles.chatReplyQuoteText} numberOfLines={2}>{metadata.replyText}</Text>
              </View>
            ) : null}
            {payload.child}
            {sourceMessage && !metadata.isDeleted && !messageId.startsWith('local-') ? (
              <View style={styles.chatReactionRow}>
                {(metadata.reactions ?? []).map((reaction) => (
                  <Pressable
                    key={`${messageId}-${reaction.emoji}`}
                    style={[
                      styles.chatReactionChip,
                      reaction.reactedByMe ? styles.chatReactionChipActive : null,
                    ]}
                    onPress={() => onToggleReaction(messageId, reaction.emoji)}
                  >
                    <Text style={styles.chatReactionEmoji}>{reaction.emoji}</Text>
                    <Text style={styles.chatReactionCount}>{reaction.count}</Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityLabel={t('Add reaction', 'Agregar reaccion')}
                  style={styles.chatReactionAddButton}
                  onPress={() => setReactionMessageId(messageId)}
                >
                  <Ionicons name="happy-outline" size={15} color="#58709f" />
                </Pressable>
              </View>
            ) : null}
          </View>
        </Swipeable>
      </View>
    )
  }, [
    isGroupChat,
    locale,
    messageBubbleWidth,
    messageContainerWidth,
    onDeleteMessage,
    onReplyMessage,
    onToggleReaction,
    sourceMessageById,
    t,
  ])

  const renderImageMessage = useCallback((message: MessageType.Image) => {
    return (
      <Image
        source={{ uri: message.uri }}
        style={styles.chatImageAttachment}
        resizeMode="cover"
      />
    )
  }, [])

  const renderCustomMessage = useCallback((message: MessageType.Custom) => {
    const metadata = (message.metadata ?? {}) as ArnoldMessageMetadata
    const customText = normalizeTextValue(metadata.text)
    const imageUri = normalizeTextValue(metadata.imageUri)
    const voiceUri = normalizeTextValue(metadata.voiceUri)
    const fileUri = normalizeTextValue(metadata.fileUri)
    const fileName = normalizeTextValue(metadata.fileName) || t('File', 'Archivo')
    const fileMimeType = normalizeTextValue(metadata.fileMimeType) || 'application/octet-stream'
    const fileSizeBytes = Number(metadata.fileSizeBytes ?? 0)
    const isPlayingVoice = playingMessageId === message.id
    const activeVoiceState = voicePlaybackState?.messageId === message.id
      ? voicePlaybackState
      : null
    const voiceDurationMillis = Math.max(
      0,
      Number(activeVoiceState?.durationMillis ?? metadata.voiceDurationMillis ?? 0),
    )
    const voicePositionMillis = Math.max(0, Number(activeVoiceState?.positionMillis ?? 0))
    const voiceProgress = voiceDurationMillis > 0
      ? Math.min(1, voicePositionMillis / voiceDurationMillis)
      : 0

    return (
      <View style={{ gap: 6 }}>
        {customText ? (
          <Text style={styles.chatMessageText}>{customText}</Text>
        ) : null}

        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.chatImageAttachment}
            resizeMode="cover"
          />
        ) : null}

        {voiceUri ? (
          <Pressable
            style={[
              styles.chatVoicePlayButton,
              isPlayingVoice ? styles.chatVoicePlayButtonActive : null,
            ]}
            onPress={() => {
              onToggleVoicePlayback(String(message.id), voiceUri)
            }}
          >
            <Ionicons
              name={isPlayingVoice ? 'pause' : 'play'}
              size={16}
              color={isPlayingVoice ? '#ffffff' : '#2b4ea1'}
            />
            <View style={styles.chatVoiceTrack}>
              <View
                style={[
                  styles.chatVoiceTrackProgress,
                  isPlayingVoice ? styles.chatVoiceTrackProgressActive : null,
                  { width: `${voiceProgress * 100}%` },
                ]}
              />
            </View>
            <Text style={[
              styles.chatVoiceDuration,
              isPlayingVoice ? styles.chatVoicePlayButtonTextActive : null,
            ]}>
              {formatVoiceDuration(voiceDurationMillis)}
            </Text>
          </Pressable>
        ) : null}

        {fileUri ? (
          <Pressable
            style={styles.chatFileAttachmentButton}
            onPress={() => {
              onOpenFile(fileUri, fileName, fileMimeType)
            }}
          >
            <View style={styles.chatFileAttachmentIcon}>
              <Ionicons name="document-text" size={18} color="#ffffff" />
            </View>
            <View style={styles.chatFileAttachmentTextWrap}>
              <Text style={styles.chatFileAttachmentName} numberOfLines={1}>{fileName}</Text>
              <Text style={styles.chatFileAttachmentMeta}>
                {fileSizeBytes > 0 ? `${Math.ceil(fileSizeBytes / 1024)} KB` : t('File attachment', 'Archivo adjunto')}
              </Text>
            </View>
            <Ionicons name="open-outline" size={17} color="#315aa8" />
          </Pressable>
        ) : null}
      </View>
    )
  }, [onOpenFile, onToggleVoicePlayback, playingMessageId, t, voicePlaybackState])

  const showSendIcon = Boolean(normalizeTextValue(composerText) || attachmentDraft)
  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) {
      return ''
    }

    const labels = typingUsers
      .map((user) => normalizeTextValue(user.displayName) || normalizeTextValue(user.email))
      .filter(Boolean)

    if (labels.length === 0) {
      return t('Someone is typing…', 'Alguien esta escribiendo…')
    }

    if (labels.length === 1) {
      return `${labels[0]} ${t('is typing…', 'esta escribiendo…')}`
    }

    return t('Several people are typing…', 'Varias personas estan escribiendo…')
  }, [t, typingUsers])
  const customDateHeaderText = useCallback((dateTime: number) => {
    const messageDate = new Date(dateTime)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const isSameLocalDay = (left: Date, right: Date) => (
      left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate()
    )

    if (isSameLocalDay(messageDate, today)) {
      return t('Today', 'Hoy')
    }

    if (isSameLocalDay(messageDate, yesterday)) {
      return t('Yesterday', 'Ayer')
    }

    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(messageDate)
  }, [locale, t])

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setIsKeyboardVisible(true)
    })
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  const renderLoadingEmptyState = useCallback(() => {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <Text style={styles.chatEmptyMessagesText}>{t('Loading chat...', 'Cargando chat...')}</Text>
      </View>
    )
  }, [t])

  const renderCustomBottom = useCallback(() => {
    return (
      <View style={[styles.chatComposerBottom, isKeyboardVisible ? styles.chatComposerBottomKeyboard : null]}>
        {typingLabel ? (
          <View style={styles.chatTypingIndicator}>
            <View style={styles.chatTypingDots}>
              <View style={styles.chatTypingDot} />
              <View style={styles.chatTypingDot} />
              <View style={styles.chatTypingDot} />
            </View>
            <Text style={styles.chatTypingText}>{typingLabel}</Text>
          </View>
        ) : null}
        {replyDraft ? (
          <View style={styles.chatReplyDraft}>
            <View style={styles.chatReplyDraftText}>
              <Text style={styles.chatReplyQuoteSender} numberOfLines={1}>
                {t('Replying to', 'Respondiendo a')} {normalizeTextValue(replyDraft.createdByName)
                  || normalizeTextValue(replyDraft.createdByEmail)
                  || t('message', 'mensaje')}
              </Text>
              <Text style={styles.chatReplyQuoteText} numberOfLines={1}>
                {normalizeTextValue(replyDraft.text)
                  || (replyDraft.messageType === 'image'
                    ? t('Photo', 'Foto')
                    : replyDraft.messageType === 'voice'
                      ? t('Voice message', 'Mensaje de voz')
                      : t('File', 'Archivo'))}
              </Text>
            </View>
            <Pressable onPress={onCancelReply}>
              <Ionicons name="close-circle" size={21} color="#61749b" />
            </Pressable>
          </View>
        ) : null}
        {attachmentDraft ? (
          <View style={styles.chatAttachmentPreviewCard}>
            <View style={styles.chatAttachmentPreviewHeader}>
                <Text style={styles.chatAttachmentPreviewLabel}>
                  {attachmentDraft.kind === 'image'
                    ? t('Photo attached', 'Foto adjunta')
                    : attachmentDraft.kind === 'voice'
                      ? t('Voice note attached', 'Nota de voz adjunta')
                      : attachmentDraft.fileName}
              </Text>
              <Pressable onPress={onRemoveAttachmentDraft}>
                <Text style={styles.chatAttachmentRemoveText}>{t('Remove', 'Quitar')}</Text>
              </Pressable>
            </View>

            {attachmentDraft.kind === 'image' ? (
              <Image
                source={{ uri: attachmentDraft.dataUrl }}
                style={styles.chatAttachmentPreviewImage}
                resizeMode="cover"
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.chatComposerWrap}>
          {isAttachmentMenuOpen ? (
            <View style={styles.chatAttachmentMenu}>
              <Pressable
                style={styles.chatAttachmentMenuItem}
                onPress={() => {
                  setIsAttachmentMenuOpen(false)
                  onAttachImage('camera')
                }}
              >
                <View style={[styles.chatAttachmentMenuIcon, styles.chatAttachmentCameraIcon]}>
                  <Ionicons name="camera" size={18} color="#ffffff" />
                </View>
                <Text style={styles.chatAttachmentMenuText}>{t('Camera', 'Camara')}</Text>
              </Pressable>
              <Pressable
                style={styles.chatAttachmentMenuItem}
                onPress={() => {
                  setIsAttachmentMenuOpen(false)
                  onAttachImage('library')
                }}
              >
                <View style={[styles.chatAttachmentMenuIcon, styles.chatAttachmentGalleryIcon]}>
                  <Ionicons name="image" size={18} color="#ffffff" />
                </View>
                <Text style={styles.chatAttachmentMenuText}>{t('Photos', 'Fotos')}</Text>
              </Pressable>
              <Pressable
                style={styles.chatAttachmentMenuItem}
                onPress={() => {
                  setIsAttachmentMenuOpen(false)
                  onAttachFile()
                }}
              >
                <View style={[styles.chatAttachmentMenuIcon, styles.chatAttachmentFileIcon]}>
                  <Ionicons name="document-attach" size={18} color="#ffffff" />
                </View>
                <Text style={styles.chatAttachmentMenuText}>{t('Files', 'Archivos')}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.chatComposerBar}>
          <Pressable
            style={styles.chatComposerIconButton}
            onPress={() => setIsAttachmentMenuOpen((current) => !current)}
            disabled={isSendingMessage || isProcessingVoice}
          >
            <Ionicons name={isAttachmentMenuOpen ? 'close' : 'add'} size={20} color="#315aa8" />
          </Pressable>

          <TextInput
            value={composerText}
            onChangeText={onComposerTextChange}
            style={[styles.authInput, styles.chatComposerInput, styles.chatComposerInputInline]}
            placeholder={t('Write a message...', 'Escribe un mensaje...')}
            placeholderTextColor="#6a7ea8"
            multiline
          />

          <Pressable
            style={[
              styles.chatComposerPrimaryButton,
              isRecordingVoice ? styles.chatComposerPrimaryButtonRecording : null,
              (isProcessingVoice || isSendingMessage) ? styles.buttonDisabled : null,
            ]}
            disabled={isProcessingVoice || isSendingMessage}
            onPress={showSendIcon ? () => {
              onSendMessage(composerText)
            } : undefined}
            onPressIn={!showSendIcon ? () => {
              voiceRecordingStartPromiseRef.current = onStartVoiceRecording()
            } : undefined}
            onPressOut={!showSendIcon ? () => {
              const recordingStartPromise = voiceRecordingStartPromiseRef.current
              voiceRecordingStartPromiseRef.current = null

              if (recordingStartPromise) {
                void recordingStartPromise.then(() => onStopVoiceRecording(true))
              }
            } : undefined}
          >
            <Ionicons
              name={showSendIcon ? 'send' : 'mic'}
              size={isRecordingVoice ? 26 : 20}
              color="#ffffff"
            />
          </Pressable>
          </View>
        </View>

        {!showSendIcon ? (
          <Text style={styles.chatComposerHint}>
            {isRecordingVoice
              ? t('Recording… release to send.', 'Grabando… suelta para enviar.')
              : t('Hold the microphone to record. Release to send.', 'Mantén presionado el micrófono para grabar. Suelta para enviar.')}
          </Text>
        ) : null}

        {inlineMessage ? <Text style={styles.chatInlineMessage}>{inlineMessage}</Text> : null}
      </View>
    )
  }, [
    attachmentDraft,
    composerText,
    inlineMessage,
    isAttachmentMenuOpen,
    isKeyboardVisible,
    isProcessingVoice,
    isRecordingVoice,
    isSendingMessage,
    onComposerTextChange,
    onAttachImage,
    onAttachFile,
    onCancelReply,
    onRemoveAttachmentDraft,
    onSendMessage,
    onStartVoiceRecording,
    onStopVoiceRecording,
    replyDraft,
    showSendIcon,
    t,
    typingLabel,
  ])

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? -16 : 0}
      style={[styles.chatCard, styles.chatThreadScreen]}
    >
      <View style={styles.chatThreadHeaderRow}>
        <Pressable style={styles.chatThreadBackButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={18} color="#ffffff" />
        </Pressable>

        <View style={styles.chatThreadHeaderTextWrap}>
          <Text style={styles.chatThreadHeaderTitle} numberOfLines={1}>{threadTitle}</Text>
          <Text style={styles.chatThreadHeaderMeta} numberOfLines={1}>{threadSubtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Chat media', 'Medios del chat')}
          style={styles.chatThreadMenuButton}
          onPress={() => setIsMediaModalOpen(true)}
        >
          <Ionicons name="ellipsis-vertical" size={19} color="#ffffff" />
        </Pressable>
      </View>

      <View
        style={styles.chatMessagesWrap}
        onLayout={(event) => {
          const nextWidth = Math.floor(event.nativeEvent.layout.width)
          setChatViewportWidth((current) => current === nextWidth ? current : nextWidth)
        }}
      >
        <Chat
          customDateHeaderText={customDateHeaderText}
          customBottomComponent={renderCustomBottom}
          disableImageGallery={false}
          emptyState={() => <View />}
          enableAnimation
          isLastPage={!hasMoreMessages}
          locale={locale.startsWith('es') ? 'es' : 'en'}
          l10nOverride={{
            emptyChatPlaceholder: t('No messages yet. Send the first one.', 'Aun no hay mensajes. Envia el primero.'),
          }}
          messages={chatMessages}
          onEndReached={async () => {
            onLoadOlderMessages()
          }}
          onPreviewDataFetched={() => {}}
          onSendPress={(partialMessage) => {
            onSendMessage(partialMessage.text)
          }}
          renderBubble={renderBubble}
          renderCustomMessage={renderCustomMessage}
          renderImageMessage={renderImageMessage}
          showUserAvatars={isGroupChat}
          showUserNames={isGroupChat}
          theme={chatTheme}
          usePreviewData
          user={chatUser}
        />
        {chatMessages.length === 0 ? (
          <View pointerEvents="none" style={styles.chatEmptyOverlay}>
            {isLoading
              ? renderLoadingEmptyState()
              : (
                  <>
                    <Ionicons name="chatbubble-ellipses-outline" size={34} color="#91a19b" />
                    <Text style={styles.chatEmptyMessagesText}>
                      {t('No messages yet. Send the first one.', 'Aun no hay mensajes. Envia el primero.')}
                    </Text>
                  </>
                )}
          </View>
        ) : null}
      </View>

      <Modal
        visible={Boolean(reactionMessageId)}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionMessageId(null)}
      >
        <Pressable
          style={styles.chatReactionModalBackdrop}
          onPress={() => setReactionMessageId(null)}
        >
          <View style={styles.chatReactionModalCard}>
            <Text style={styles.chatReactionModalTitle}>{t('React to message', 'Reaccionar al mensaje')}</Text>
            <View style={styles.chatReactionPickerRow}>
              {CHAT_REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.chatReactionPickerButton}
                  onPress={() => {
                    if (reactionMessageId) {
                      onToggleReaction(reactionMessageId, emoji)
                    }
                    setReactionMessageId(null)
                  }}
                >
                  <Text style={styles.chatReactionPickerEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={isMediaModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsMediaModalOpen(false)}
      >
        <View style={styles.chatMediaModalBackdrop}>
          <View style={styles.chatMediaModalCard}>
            <View style={styles.chatMediaModalHeader}>
              <Text style={styles.chatMediaModalTitle}>{t('Chat media', 'Medios del chat')}</Text>
              <Pressable onPress={() => setIsMediaModalOpen(false)}>
                <Ionicons name="close" size={23} color="#263b66" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.chatMediaList}>
              {mediaMessages.map((message) => {
                const attachment = message.attachment

                if (!attachment?.dataUrl) return null

                if (attachment.kind === 'image') {
                  return (
                    <Image
                      key={message.id}
                      source={{ uri: attachment.dataUrl }}
                      style={styles.chatMediaImage}
                      resizeMode="cover"
                    />
                  )
                }

                return (
                  <Pressable
                    key={message.id}
                    style={styles.chatMediaFileRow}
                    onPress={() => {
                      if (attachment.kind === 'voice') {
                        onToggleVoicePlayback(message.id, attachment.dataUrl ?? '')
                      } else {
                        onOpenFile(
                          attachment.dataUrl ?? '',
                          attachment.fileName ?? t('File', 'Archivo'),
                          attachment.mimeType ?? 'application/octet-stream',
                        )
                      }
                    }}
                  >
                    <Ionicons
                      name={attachment.kind === 'voice' ? 'mic' : 'document-text'}
                      size={20}
                      color="#315aa8"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chatMediaFileName} numberOfLines={1}>
                        {attachment.kind === 'voice'
                          ? t('Voice message', 'Mensaje de voz')
                          : attachment.fileName ?? t('File', 'Archivo')}
                      </Text>
                      <Text style={styles.chatMediaFileMeta}>
                        {formatSyncTimestamp(message.createdAt, locale)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#7184aa" />
                  </Pressable>
                )
              })}
              {mediaMessages.length === 0 ? (
                <Text style={styles.chatMediaEmpty}>
                  {t('No media or files in this chat yet.', 'Aun no hay medios o archivos en este chat.')}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}
