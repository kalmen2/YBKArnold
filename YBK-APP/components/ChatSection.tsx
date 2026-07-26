import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { styles } from '../appStyles'
import type { MobileChatMessage, MobileChatThread, MobileChatUser } from '../appTypes'
import { InlineLoading } from '../appSections'
import { ChatThreadScreen } from './ChatThreadScreen'

type TranslateFn = (english: string, spanish: string) => string

type ChatAttachmentDraft = {
  kind: 'image' | 'voice'
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

type ChatSectionProps = {
  t: TranslateFn
  locale: string
  chatViewMode: 'list' | 'thread'
  chatCardHeight: number
  chatThreadCardHeight: number
  isChatLoading: boolean
  isChatMessagesLoading: boolean
  sortedChatThreads: MobileChatThread[]
  selectedChatThread: MobileChatThread | null
  selectedChatMessages: MobileChatMessage[]
  chatAttachmentDraft: ChatAttachmentDraft | null
  chatComposerText: string
  chatPlayingMessageId: string | null
  isAdminUser: boolean
  isChatProcessingVoice: boolean
  isChatRecordingVoice: boolean
  isChatSendingMessage: boolean
  chatMessage: string | null
  availableChatUsers: MobileChatUser[]
  currentUserEmail: string
  currentUserUid: string
  resolveChatThreadTitle: (thread: MobileChatThread | null) => string
  resolveChatThreadSubtitle: (thread: MobileChatThread | null) => string
  onSelectThread: (threadId: string) => void
  onBackToList: () => void
  onStartChat: (targetUid: string) => void
  onComposerTextChange: (value: string) => void
  onOpenAttachmentMenu: () => void
  onRemoveAttachmentDraft: () => void
  onSendMessage: (text?: string) => void
  onStartVoiceRecording: () => void
  onStopVoiceRecording: (sendImmediately?: boolean) => void
  onToggleVoicePlayback: (messageId: string, dataUrl: string) => void
  onDeleteMessage: (messageId: string) => void
}

export function ChatSection({
  t,
  locale,
  chatViewMode,
  chatCardHeight,
  chatThreadCardHeight,
  isChatLoading,
  isChatMessagesLoading,
  sortedChatThreads,
  selectedChatThread,
  selectedChatMessages,
  chatAttachmentDraft,
  chatComposerText,
  chatPlayingMessageId,
  isAdminUser,
  isChatProcessingVoice,
  isChatRecordingVoice,
  isChatSendingMessage,
  chatMessage,
  availableChatUsers,
  currentUserEmail,
  currentUserUid,
  resolveChatThreadTitle,
  resolveChatThreadSubtitle,
  onSelectThread,
  onBackToList,
  onStartChat,
  onComposerTextChange,
  onOpenAttachmentMenu,
  onRemoveAttachmentDraft,
  onSendMessage,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onToggleVoicePlayback,
  onDeleteMessage,
}: ChatSectionProps) {
  const [isNewChatOpen, setIsNewChatOpen] = useState(false)

  if (chatViewMode === 'list') {
    return (
      <>
        <View style={styles.chatListHeader}>
          <View>
            <Text style={styles.sectionTitle}>{t('Messages', 'Mensajes')}</Text>
            <Text style={styles.chatListSubtitle}>
              {t('Arnold team conversations', 'Conversaciones del equipo Arnold')}
            </Text>
          </View>
          {isAdminUser ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Start a new chat', 'Iniciar un chat nuevo')}
              style={styles.chatNewButton}
              onPress={() => setIsNewChatOpen(true)}
            >
              <Ionicons name="chatbubble-ellipses" size={19} color="#ffffff" />
              <Text style={styles.chatNewButtonText}>{t('New chat', 'Nuevo chat')}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.chatCard, { height: chatCardHeight }]}> 
          <View style={styles.chatThreadsPanel}>
            <Text style={styles.chatSectionLabel}>{t('Chats', 'Chats')}</Text>

            {isChatLoading ? (
              <InlineLoading label={t('Loading chat...', 'Cargando chat...')} />
            ) : (
              <ScrollView
                style={styles.chatThreadsScroll}
                contentContainerStyle={styles.chatThreadsContent}
                showsVerticalScrollIndicator={false}
              >
                {sortedChatThreads.map((thread) => {
                  const isSelected = thread.id === selectedChatThread?.id

                  return (
                    <Pressable
                      key={`chat-thread-${thread.id}`}
                      style={[styles.chatThreadTab, isSelected ? styles.chatThreadTabActive : null]}
                      onPress={() => {
                        onSelectThread(thread.id)
                      }}
                    >
                      <Text
                        style={[styles.chatThreadTabTitle, isSelected ? styles.chatThreadTabTitleActive : null]}
                        numberOfLines={1}
                      >
                        {resolveChatThreadTitle(thread)}
                      </Text>
                      <Text
                        style={[styles.chatThreadTabMeta, isSelected ? styles.chatThreadTabMetaActive : null]}
                        numberOfLines={1}
                      >
                        {thread.lastMessagePreview || resolveChatThreadSubtitle(thread)}
                      </Text>
                    </Pressable>
                  )
                })}

                {sortedChatThreads.length === 0 ? (
                  <View style={styles.chatThreadEmptyCard}>
                    <Ionicons name="chatbubbles-outline" size={30} color="#82918b" />
                    <Text style={styles.chatThreadEmptyText}>
                      {isAdminUser
                        ? t('No chats yet. Start one with a worker.', 'Aun no hay chats. Inicia uno con un trabajador.')
                        : t(
                          'No chats yet. An administrator will start the conversation.',
                          'Aun no hay chats. Un administrador iniciara la conversacion.',
                        )}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>

          {chatMessage ? <Text style={styles.chatInlineMessage}>{chatMessage}</Text> : null}
        </View>

        <Modal
          visible={isNewChatOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsNewChatOpen(false)}
        >
          <View style={styles.chatContactModalBackdrop}>
            <View style={styles.chatContactModalCard}>
              <View style={styles.chatContactModalHeader}>
                <View>
                  <Text style={styles.chatContactModalTitle}>{t('New chat', 'Nuevo chat')}</Text>
                  <Text style={styles.chatContactModalSubtitle}>
                    {t('Choose a team member', 'Elige un miembro del equipo')}
                  </Text>
                </View>
                <Pressable
                  style={styles.chatContactModalClose}
                  onPress={() => setIsNewChatOpen(false)}
                >
                  <Ionicons name="close" size={22} color="#33443e" />
                </Pressable>
              </View>
              <ScrollView style={styles.chatContactList} showsVerticalScrollIndicator={false}>
                {availableChatUsers
                  .filter((user) => user.uid && user.uid !== currentUserUid)
                  .map((user) => (
                    <Pressable
                      key={`chat-contact-${user.uid}`}
                      style={styles.chatContactRow}
                      onPress={() => {
                        setIsNewChatOpen(false)
                        onStartChat(user.uid)
                      }}
                    >
                      <View style={styles.chatContactAvatar}>
                        <Text style={styles.chatContactAvatarText}>
                          {(user.displayName || user.email || 'A').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.chatContactText}>
                        <Text style={styles.chatContactName} numberOfLines={1}>
                          {user.displayName || user.email}
                        </Text>
                        <Text style={styles.chatContactEmail} numberOfLines={1}>{user.email}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#9aa6a1" />
                    </Pressable>
                  ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </>
    )
  }

  if (selectedChatThread) {
    return (
      <ChatThreadScreen
        attachmentDraft={chatAttachmentDraft}
        composerText={chatComposerText}
        currentUserEmail={currentUserEmail}
        currentUserUid={currentUserUid}
        inlineMessage={chatMessage}
        isAdminUser={isAdminUser}
        isLoading={isChatLoading || isChatMessagesLoading}
        isProcessingVoice={isChatProcessingVoice}
        isRecordingVoice={isChatRecordingVoice}
        isSendingMessage={isChatSendingMessage}
        locale={locale}
        messages={selectedChatMessages}
        onBack={onBackToList}
        onComposerTextChange={onComposerTextChange}
        onDeleteMessage={onDeleteMessage}
        onOpenAttachmentMenu={onOpenAttachmentMenu}
        onRemoveAttachmentDraft={onRemoveAttachmentDraft}
        onSendMessage={onSendMessage}
        onStartVoiceRecording={onStartVoiceRecording}
        onStopVoiceRecording={onStopVoiceRecording}
        onToggleVoicePlayback={onToggleVoicePlayback}
        playingMessageId={chatPlayingMessageId}
        t={t}
        threadCardHeight={chatThreadCardHeight}
        threadSubtitle={resolveChatThreadSubtitle(selectedChatThread)}
        threadTitle={resolveChatThreadTitle(selectedChatThread)}
      />
    )
  }

  return (
    <View style={[styles.chatCard, { height: chatCardHeight }]}> 
      <Text style={styles.chatThreadEmptyText}>
        {t('Select a chat to continue.', 'Selecciona un chat para continuar.')}
      </Text>
    </View>
  )
}
