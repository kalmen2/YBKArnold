// Data adapter only: the conversation UI itself is the shared ChatThread, so a
// quote thread behaves exactly like the dealer and order threads.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { firebaseAuth } from '../../auth/firebase'
import { ChatThread } from '../chat/ChatThread'
import { QUERY_KEYS } from '../../lib/queryKeys'
import {
  createCrmQuoteChatMessage,
  fetchCrmChatUsers,
  fetchCrmQuoteChats,
  removeCrmQuoteChatMessage,
  updateCrmQuoteChatMessage,
} from './api'

export function QuoteChatPanel({
  quoteId,
  canPost = true,
  maxHeight = 320,
}: {
  quoteId: string
  canPost?: boolean
  maxHeight?: number
}) {
  const queryClient = useQueryClient()
  const currentUserUid = firebaseAuth.currentUser?.uid ?? null

  const chatsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuoteChats(quoteId),
    queryFn: () => fetchCrmQuoteChats(quoteId, { limit: 150 }),
    enabled: Boolean(quoteId),
  })

  const chatUsersQuery = useQuery({
    queryKey: QUERY_KEYS.chatUsers,
    queryFn: () => fetchCrmChatUsers(),
    staleTime: 5 * 60 * 1000,
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(quoteId) })
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmOpportunitiesQuotes })
  }

  return (
    <ChatThread
      messages={Array.isArray(chatsQuery.data?.messages) ? chatsQuery.data.messages : []}
      users={Array.isArray(chatUsersQuery.data?.users) ? chatUsersQuery.data.users : []}
      currentUserUid={currentUserUid}
      isLoading={chatsQuery.isLoading}
      canPost={canPost}
      canManageMessage={(message) => Boolean(currentUserUid && message.createdByUid === currentUserUid)}
      composerLabel="Write update"
      emptyHint="No chat messages yet."
      maxHeight={maxHeight}
      onSend={async (payload) => {
        await createCrmQuoteChatMessage(quoteId, {
          message: payload.message,
          mentionUserUids: payload.mentionUserUids,
          reminder: payload.reminder
            ? {
              dueDate: payload.reminder.dueDate,
              note: payload.reminder.note,
              targetUserUids: payload.reminder.targetUserUids,
            }
            : null,
        })
        await refresh()
      }}
      onEdit={async (messageId, message) => {
        await updateCrmQuoteChatMessage(quoteId, messageId, message)
        await refresh()
      }}
      onDelete={async (messageId) => {
        await removeCrmQuoteChatMessage(quoteId, messageId)
        await refresh()
      }}
    />
  )
}
