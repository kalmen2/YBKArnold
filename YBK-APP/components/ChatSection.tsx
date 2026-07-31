import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'
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
  canStartDirectChat: boolean
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
  onCreateGroup: (name: string, memberUids: string[]) => void
  onSetPinned: (threadId: string, pinned: boolean) => void
  onDeleteThread: (threadId: string) => void
  onComposerTextChange: (value: string) => void
  onAttachImage: (source: 'library' | 'camera') => void
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
  canStartDirectChat,
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
  onCreateGroup,
  onSetPinned,
  onDeleteThread,
  onComposerTextChange,
  onAttachImage,
  onRemoveAttachmentDraft,
  onSendMessage,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onToggleVoicePlayback,
  onDeleteMessage,
}: ChatSectionProps) {
  const [isNewChatOpen, setIsNewChatOpen] = useState(false)
  const [newChatMode, setNewChatMode] = useState<'direct' | 'group'>('direct')
  const [groupName, setGroupName] = useState('')
  const [selectedGroupMemberUids, setSelectedGroupMemberUids] = useState<string[]>([])

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
          {canStartDirectChat ? (
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
                    <Swipeable
                      key={`chat-thread-${thread.id}`}
                      overshootRight={false}
                      renderRightActions={() => (
                        <View style={styles.chatSwipeActions}>
                          <Pressable
                            style={[styles.chatSwipeAction, styles.chatSwipePinAction]}
                            onPress={() => onSetPinned(thread.id, !thread.pinned)}
                          >
                            <Ionicons
                              name={thread.pinned ? 'pin' : 'pin-outline'}
                              size={18}
                              color="#ffffff"
                            />
                            <Text style={styles.chatSwipeActionText}>
                              {thread.pinned ? t('Unpin', 'Desfijar') : t('Pin', 'Fijar')}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[styles.chatSwipeAction, styles.chatSwipeDeleteAction]}
                            onPress={() => {
                              Alert.alert(
                                t('Delete chat?', 'Borrar chat?'),
                                t(
                                  'This removes the conversation from your chat list.',
                                  'Esto elimina la conversacion de tu lista.',
                                ),
                                [
                                  { text: t('Cancel', 'Cancelar'), style: 'cancel' },
                                  {
                                    text: t('Delete', 'Borrar'),
                                    style: 'destructive',
                                    onPress: () => onDeleteThread(thread.id),
                                  },
                                ],
                              )
                            }}
                          >
                            <Ionicons name="trash-outline" size={18} color="#ffffff" />
                            <Text style={styles.chatSwipeActionText}>{t('Delete', 'Borrar')}</Text>
                          </Pressable>
                        </View>
                      )}
                    >
                      <Pressable
                        style={[styles.chatThreadTab, isSelected ? styles.chatThreadTabActive : null]}
                        onPress={() => {
                          onSelectThread(thread.id)
                        }}
                      >
                        <View style={styles.chatThreadTitleRow}>
                          <Text
                            style={[styles.chatThreadTabTitle, isSelected ? styles.chatThreadTabTitleActive : null]}
                            numberOfLines={1}
                          >
                            {resolveChatThreadTitle(thread)}
                          </Text>
                          {thread.pinned ? <Ionicons name="pin" size={14} color="#18775b" /> : null}
                        </View>
                        <Text
                          style={[styles.chatThreadTabMeta, isSelected ? styles.chatThreadTabMetaActive : null]}
                          numberOfLines={1}
                        >
                          {thread.lastMessagePreview || resolveChatThreadSubtitle(thread)}
                        </Text>
                      </Pressable>
                    </Swipeable>
                  )
                })}

                {sortedChatThreads.length === 0 ? (
                  <View style={styles.chatThreadEmptyCard}>
                    <Ionicons name="chatbubbles-outline" size={30} color="#82918b" />
                    <Text style={styles.chatThreadEmptyText}>
                      {canStartDirectChat
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
              {isAdminUser ? (
                <View style={styles.chatNewModeRow}>
                  <Pressable
                    style={[
                      styles.chatNewModeButton,
                      newChatMode === 'direct' ? styles.chatNewModeButtonActive : null,
                    ]}
                    onPress={() => setNewChatMode('direct')}
                  >
                    <Text style={[
                      styles.chatNewModeText,
                      newChatMode === 'direct' ? styles.chatNewModeTextActive : null,
                    ]}>
                      {t('Direct', 'Directo')}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.chatNewModeButton,
                      newChatMode === 'group' ? styles.chatNewModeButtonActive : null,
                    ]}
                    onPress={() => setNewChatMode('group')}
                  >
                    <Text style={[
                      styles.chatNewModeText,
                      newChatMode === 'group' ? styles.chatNewModeTextActive : null,
                    ]}>
                      {t('Group', 'Grupo')}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {newChatMode === 'group' && isAdminUser ? (
                <TextInput
                  value={groupName}
                  onChangeText={setGroupName}
                  style={[styles.authInput, styles.chatGroupNameInput]}
                  placeholder={t('Group name', 'Nombre del grupo')}
                  placeholderTextColor="#71827c"
                />
              ) : null}
              <ScrollView style={styles.chatContactList} showsVerticalScrollIndicator={false}>
                {availableChatUsers
                  .filter((user) => user.uid && user.uid !== currentUserUid)
                  .map((user) => {
                    const isSelectedForGroup = selectedGroupMemberUids.includes(user.uid)
                    return (
                      <Pressable
                      key={`chat-contact-${user.uid}`}
                      style={[
                        styles.chatContactRow,
                        isSelectedForGroup ? styles.chatContactRowSelected : null,
                      ]}
                      onPress={() => {
                        if (newChatMode === 'group' && isAdminUser) {
                          setSelectedGroupMemberUids((current) => (
                            current.includes(user.uid)
                              ? current.filter((uid) => uid !== user.uid)
                              : [...current, user.uid]
                          ))
                          return
                        }

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
                      <Ionicons
                        name={newChatMode === 'group'
                          ? (isSelectedForGroup ? 'checkmark-circle' : 'ellipse-outline')
                          : 'chevron-forward'}
                        size={20}
                        color={isSelectedForGroup ? '#18775b' : '#9aa6a1'}
                      />
                    </Pressable>
                    )
                  })}
              </ScrollView>
              {newChatMode === 'group' && isAdminUser ? (
                <Pressable
                  style={[
                    styles.chatNewButton,
                    (!groupName.trim() || selectedGroupMemberUids.length === 0)
                      ? styles.buttonDisabled
                      : null,
                  ]}
                  disabled={!groupName.trim() || selectedGroupMemberUids.length === 0}
                  onPress={() => {
                    onCreateGroup(groupName, selectedGroupMemberUids)
                    setGroupName('')
                    setSelectedGroupMemberUids([])
                    setIsNewChatOpen(false)
                  }}
                >
                  <Ionicons name="people" size={18} color="#ffffff" />
                  <Text style={styles.chatNewButtonText}>{t('Create group', 'Crear grupo')}</Text>
                </Pressable>
              ) : null}
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
        onAttachImage={onAttachImage}
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
