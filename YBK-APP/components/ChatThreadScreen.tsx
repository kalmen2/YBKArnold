import { Ionicons } from '@expo/vector-icons'
import { Chat, type MessageType, type User } from '@flyerhq/react-native-chat-ui'
import { type ReactNode, useCallback, useMemo } from 'react'
import { Alert, Image, Pressable, Text, TextInput, View } from 'react-native'
import { styles } from '../appStyles'
import type { MobileChatMessage } from '../appTypes'
import { formatSyncTimestamp } from '../appUtils'

type TranslateFn = (english: string, spanish: string) => string

type ChatAttachmentDraft = {
  kind: 'image' | 'voice'
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

type ChatThreadScreenProps = {
  threadCardHeight: number
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
  composerText: string
  attachmentDraft: ChatAttachmentDraft | null
  inlineMessage: string | null
  onBack: () => void
  onComposerTextChange: (value: string) => void
  onOpenAttachmentMenu: () => void
  onSendMessage: (text?: string) => void
  onStartVoiceRecording: () => void
  onStopVoiceRecording: (sendImmediately?: boolean) => void
  onToggleVoicePlayback: (messageId: string, dataUrl: string) => void
  onDeleteMessage: (messageId: string) => void
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
}

function normalizeTextValue(value: unknown) {
  return String(value ?? '').trim()
}

export function ChatThreadScreen({
  threadCardHeight,
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
  composerText,
  attachmentDraft,
  inlineMessage,
  onBack,
  onComposerTextChange,
  onOpenAttachmentMenu,
  onSendMessage,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onToggleVoicePlayback,
  onDeleteMessage,
  onRemoveAttachmentDraft,
}: ChatThreadScreenProps) {
  const normalizedCurrentUid = normalizeTextValue(currentUserUid)
  const normalizedCurrentEmail = normalizeTextValue(currentUserEmail).toLowerCase()

  const chatUser = useMemo<User>(() => ({
    id: normalizedCurrentUid || normalizedCurrentEmail || 'me',
    firstName: t('You', 'Tu'),
  }), [normalizedCurrentEmail, normalizedCurrentUid, t])

  const chatMessages = useMemo<MessageType.Any[]>(() => {
    return messages.map((message) => {
      const createdAtIso = normalizeTextValue(message.createdAt) || null
      const parsedCreatedAt = createdAtIso ? Date.parse(createdAtIso) : Number.NaN
      const createdAt = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : 0
      const messageUid = normalizeTextValue(message.createdByUid)
      const messageEmail = normalizeTextValue(message.createdByEmail).toLowerCase()
      const isMine = (Boolean(messageUid) && messageUid === normalizedCurrentUid)
        || (Boolean(messageEmail) && messageEmail === normalizedCurrentEmail)
      const canDelete = isAdminUser || isMine
      const isDeleted = Boolean(message.deletedAt || message.messageType === 'deleted')
      const senderLabel = isMine
        ? t('You', 'Tu')
        : normalizeTextValue(message.createdByName)
          || normalizeTextValue(message.createdByEmail)
          || t('Teammate', 'Companero')
      const textValue = normalizeTextValue(message.text)
      const imageUri = message.attachment?.kind === 'image' ? normalizeTextValue(message.attachment.dataUrl) : ''
      const voiceUri = message.attachment?.kind === 'voice' ? normalizeTextValue(message.attachment.dataUrl) : ''
      const metadata: ArnoldMessageMetadata = {
        canDelete,
        createdAtIso,
        isDeleted,
        isMine,
        senderLabel,
        ...(textValue ? { text: textValue } : {}),
        ...(imageUri ? { imageUri } : {}),
        ...(voiceUri ? { voiceUri } : {}),
      }

      if (isDeleted) {
        return {
          author: {
            id: messageUid || messageEmail || message.id,
            firstName: senderLabel,
          },
          createdAt,
          id: message.id,
          metadata,
          text: t('Message deleted.', 'Mensaje borrado.'),
          type: 'text',
        } as MessageType.Text
      }

      if (voiceUri || (imageUri && textValue)) {
        return {
          author: {
            id: messageUid || messageEmail || message.id,
            firstName: senderLabel,
          },
          createdAt,
          id: message.id,
          metadata,
          type: 'custom',
        } as MessageType.Custom
      }

      if (imageUri) {
        return {
          author: {
            id: messageUid || messageEmail || message.id,
            firstName: senderLabel,
          },
          createdAt,
          id: message.id,
          metadata,
          name: normalizeTextValue(message.attachment?.fileName) || 'chat-image',
          size: Number(message.attachment?.sizeBytes ?? 0) || 0,
          type: 'image',
          uri: imageUri,
        } as MessageType.Image
      }

      return {
        author: {
          id: messageUid || messageEmail || message.id,
          firstName: senderLabel,
        },
        createdAt,
        id: message.id,
        metadata,
        text: textValue,
        type: 'text',
      } as MessageType.Text
    })
  }, [
    isAdminUser,
    messages,
    normalizedCurrentEmail,
    normalizedCurrentUid,
    t,
  ])

  const handleMessageLongPress = useCallback((message: MessageType.Any) => {
    const metadata = (message.metadata ?? {}) as ArnoldMessageMetadata
    const messageId = normalizeTextValue(message.id)

    if (!messageId || !metadata.canDelete || metadata.isDeleted) {
      return
    }

    Alert.alert(
      t('Delete message?', 'Borrar mensaje?'),
      t('This action cannot be undone.', 'Esta accion no se puede deshacer.'),
      [
        {
          style: 'cancel',
          text: t('Cancel', 'Cancelar'),
        },
        {
          style: 'destructive',
          text: t('Delete', 'Borrar'),
          onPress: () => {
            onDeleteMessage(messageId)
          },
        },
      ],
    )
  }, [onDeleteMessage, t])

  const renderBubble = useCallback((payload: {
    child: ReactNode
    message: MessageType.Any
    nextMessageInGroup: boolean
  }) => {
    const metadata = (payload.message.metadata ?? {}) as ArnoldMessageMetadata
    const isMine = Boolean(metadata.isMine)
    const senderLabel = metadata.senderLabel ?? ''
    const createdAtLabel = formatSyncTimestamp(metadata.createdAtIso ?? null, locale)

    return (
      <View
        style={[
          styles.chatMessageRow,
          isMine ? styles.chatMessageRowMine : styles.chatMessageRowOther,
        ]}
      >
        <View style={styles.chatMessageMetaRow}>
          <Text style={styles.chatMessageSender} numberOfLines={1}>{senderLabel}</Text>
          <Text style={styles.chatMessageTime} numberOfLines={1}>{createdAtLabel}</Text>
        </View>

        <View
          style={[
            styles.chatMessageBubble,
            isMine ? styles.chatMessageBubbleMine : styles.chatMessageBubbleOther,
          ]}
        >
          {payload.child}
        </View>
      </View>
    )
  }, [locale])

  const renderTextMessage = useCallback((message: MessageType.Text) => {
    return (
      <Text style={[styles.chatMessageText, message.metadata?.isDeleted ? styles.chatDeletedText : null]}>
        {message.text}
      </Text>
    )
  }, [])

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
              playingMessageId === message.id ? styles.chatVoicePlayButtonActive : null,
            ]}
            onPress={() => {
              onToggleVoicePlayback(String(message.id), voiceUri)
            }}
          >
            <Ionicons
              name={playingMessageId === message.id ? 'pause' : 'play'}
              size={14}
              color={playingMessageId === message.id ? '#ffffff' : '#2b4ea1'}
            />
            <Text
              style={[
                styles.chatVoicePlayButtonText,
                playingMessageId === message.id ? styles.chatVoicePlayButtonTextActive : null,
              ]}
            >
              {playingMessageId === message.id
                ? t('Stop voice', 'Detener voz')
                : t('Play voice', 'Reproducir voz')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    )
  }, [onToggleVoicePlayback, playingMessageId, t])

  const showSendIcon = Boolean(normalizeTextValue(composerText) || attachmentDraft)

  const renderLoadingEmptyState = useCallback(() => {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <Text style={styles.chatEmptyMessagesText}>{t('Loading chat...', 'Cargando chat...')}</Text>
      </View>
    )
  }, [t])

  const renderCustomBottom = useCallback(() => {
    return (
      <View style={{ gap: 8 }}>
        {attachmentDraft ? (
          <View style={styles.chatAttachmentPreviewCard}>
            <View style={styles.chatAttachmentPreviewHeader}>
              <Text style={styles.chatAttachmentPreviewLabel}>
                {attachmentDraft.kind === 'image'
                  ? t('Photo attached', 'Foto adjunta')
                  : t('Voice note attached', 'Nota de voz adjunta')}
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

        <View style={styles.chatComposerBar}>
          <Pressable
            style={styles.chatComposerIconButton}
            onPress={onOpenAttachmentMenu}
            disabled={isSendingMessage || isProcessingVoice}
          >
            <Ionicons name="add" size={20} color="#23457f" />
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
            onPress={() => {
              if (showSendIcon) {
                onSendMessage(composerText)
              }
            }}
            onPressIn={() => {
              if (!showSendIcon) {
                onStartVoiceRecording()
              }
            }}
            onPressOut={() => {
              if (!showSendIcon && isRecordingVoice) {
                onStopVoiceRecording(true)
              }
            }}
          >
            <Ionicons
              name={showSendIcon ? 'send' : 'mic'}
              size={18}
              color="#ffffff"
            />
          </Pressable>
        </View>

        {!showSendIcon ? (
          <Text style={styles.chatComposerHint}>
            {isRecordingVoice
              ? t('Recording... release to send.', 'Grabando... suelta para enviar.')
              : t('Hold mic to record and release to send.', 'Manten el microfono para grabar y suelta para enviar.')}
          </Text>
        ) : null}

        {inlineMessage ? <Text style={styles.chatInlineMessage}>{inlineMessage}</Text> : null}
      </View>
    )
  }, [
    attachmentDraft,
    composerText,
    inlineMessage,
    isProcessingVoice,
    isRecordingVoice,
    isSendingMessage,
    onComposerTextChange,
    onOpenAttachmentMenu,
    onRemoveAttachmentDraft,
    onSendMessage,
    onStartVoiceRecording,
    onStopVoiceRecording,
    showSendIcon,
    t,
  ])

  return (
    <View style={[styles.chatCard, styles.chatThreadScreen, { height: threadCardHeight }]}> 
      <View style={styles.chatThreadHeaderRow}>
        <Pressable style={styles.chatThreadBackButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={18} color="#1f3567" />
        </Pressable>

        <View style={styles.chatThreadHeaderTextWrap}>
          <Text style={styles.chatThreadHeaderTitle} numberOfLines={1}>{threadTitle}</Text>
          <Text style={styles.chatThreadHeaderMeta} numberOfLines={1}>{threadSubtitle}</Text>
        </View>
      </View>

      <View style={styles.chatMessagesWrap}>
        <Chat
          customBottomComponent={renderCustomBottom}
          emptyState={isLoading ? renderLoadingEmptyState : undefined}
          locale={locale.startsWith('es') ? 'es' : 'en'}
          l10nOverride={{
            emptyChatPlaceholder: t('No messages yet. Send the first one.', 'Aun no hay mensajes. Envia el primero.'),
          }}
          messages={chatMessages}
          onMessageLongPress={handleMessageLongPress}
          onSendPress={(partialMessage) => {
            onSendMessage(partialMessage.text)
          }}
          renderBubble={renderBubble}
          renderCustomMessage={renderCustomMessage}
          renderImageMessage={renderImageMessage}
          renderTextMessage={renderTextMessage}
          showUserNames={false}
          user={chatUser}
        />
      </View>
    </View>
  )
}
