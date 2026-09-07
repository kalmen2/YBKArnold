// Watches the shared thread cache and turns a rising unread count into a
// chime, a desktop notification and a tab-title badge. Mounted once in the app
// layout so it fires on every page, not only on the chat page.
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { fetchChatThreads, type AppChatThread } from './api'
import { buildThreadTitle } from './chatUi'
import { playChatChime, startChatRingtone, stopChatRingtone } from './chatNotifications'

const baseDocumentTitle = 'Arnold Contract'

function describeThread(thread: AppChatThread, currentUid: string) {
  return {
    title: buildThreadTitle(thread, currentUid),
    body: thread.lastMessagePreview || 'New message',
  }
}

export function useChatNotifications({
  currentUid,
  enabled,
}: {
  currentUid: string
  enabled: boolean
}) {
  const navigate = useNavigate()
  // Same key as the sidebar and the chat page, so all three share one request.
  const threadsQuery = useQuery({
    queryKey: QUERY_KEYS.chatThreads('all'),
    queryFn: () => fetchChatThreads('all'),
    enabled,
    staleTime: 10 * 1000,
    // Fast enough that a ringing call reaches people while it still matters.
    refetchInterval: 6 * 1000,
    retry: false,
  })

  const threads = threadsQuery.data?.threads
  // null until the first payload lands: the counts already waiting at sign-in
  // are history, not new arrivals, and must not ring.
  const seenCountsRef = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    if (!enabled || !threads) {
      return
    }

    const nextCounts = new Map(
      threads.map((thread) => [thread.id, Math.max(0, Number(thread.unreadCount) || 0)]),
    )

    if (!seenCountsRef.current) {
      seenCountsRef.current = nextCounts
      return
    }

    const previousCounts = seenCountsRef.current
    const grownThreads = threads.filter((thread) => (
      (nextCounts.get(thread.id) ?? 0) > (previousCounts.get(thread.id) ?? 0)
    ))

    seenCountsRef.current = nextCounts

    if (grownThreads.length === 0) {
      return
    }

    playChatChime()

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return
    }

    for (const thread of grownThreads) {
      const { title, body } = describeThread(thread, currentUid)
      // Tagged per thread so a burst of messages replaces itself instead of
      // stacking a dozen toasts.
      const notification = new Notification(title, {
        body,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: `arnold-chat-${thread.id}`,
      })

      notification.onclick = () => {
        window.focus()
        navigate('/chat')
        notification.close()
      }
    }
  }, [currentUid, enabled, navigate, threads])

  // --- incoming calls ------------------------------------------------------
  // Declined calls are remembered by room name, so dismissing one does not
  // make it ring again on the next poll.
  const [declinedRooms, setDeclinedRooms] = useState<string[]>([])

  const incomingCall = useMemo(() => {
    if (!enabled) {
      return null
    }

    const ringing = (threads ?? []).find((thread) => Boolean(
      thread.activeCall
      && thread.activeCall.startedByUid !== currentUid
      && !declinedRooms.includes(thread.activeCall.roomName),
    ))

    if (!ringing?.activeCall) {
      return null
    }

    return {
      threadId: ringing.id,
      threadTitle: buildThreadTitle(ringing, currentUid),
      isGroup: ringing.type === 'group',
      call: ringing.activeCall,
    }
  }, [currentUid, declinedRooms, enabled, threads])

  useEffect(() => {
    if (!incomingCall) {
      stopChatRingtone()
      return
    }

    startChatRingtone()

    return () => {
      stopChatRingtone()
    }
  }, [incomingCall])

  const declineIncomingCall = useCallback(() => {
    const roomName = incomingCall?.call.roomName

    stopChatRingtone()

    if (roomName) {
      setDeclinedRooms((current) => [...current.slice(-20), roomName])
    }
  }, [incomingCall])

  const totalUnread = (threads ?? []).reduce(
    (total, thread) => total + Math.max(0, Number(thread.unreadCount) || 0),
    0,
  )

  useEffect(() => {
    document.title = totalUnread > 0
      ? `(${totalUnread > 99 ? '99+' : totalUnread}) ${baseDocumentTitle}`
      : baseDocumentTitle

    return () => {
      document.title = baseDocumentTitle
    }
  }, [totalUnread])

  return { totalUnread, incomingCall, declineIncomingCall }
}
