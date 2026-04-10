import { StatusBar } from 'expo-status-bar'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'

type DashboardOrder = {
  id: string
  name: string
  groupTitle: string
  statusLabel: string
  stageLabel: string
  readyLabel: string
  leadTimeDays: number | null
  progressPercent: number | null
  orderDate: string | null
  shippedAt: string | null
  dueDate: string | null
  computedDueDate: string | null
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isDone: boolean
  isLate: boolean
  daysLate: number
  updatedAt: string | null
  itemUrl: string | null
}

type MondayDashboardSnapshot = {
  board: {
    id: string
    name: string
    url: string | null
  }
  generatedAt: string
  metrics: {
    totalOrders: number
    activeOrders: number
    completedOrders: number
    lateOrders: number
    dueSoonOrders: number
    missingDueDateOrders: number
    averageLeadTimeDays: number | null
  }
  details: {
    lateOrders: DashboardOrder[]
    dueSoonOrders: DashboardOrder[]
    activeOrders: DashboardOrder[]
    completedOrders: DashboardOrder[]
    missingDueDateOrders: DashboardOrder[]
  }
  orders: DashboardOrder[]
}

type ZendeskTicketSummarySnapshot = {
  generatedAt: string
  agentUrl: string | null
  metrics: {
    newTickets: number
    inProgressTickets: number
    openTickets: number
    pendingTickets: number
    solvedTickets: number
    openTotalTickets: number
  }
}

type SupportTicket = {
  id: number
  subject: string
  orderNumber: string | null
  status: string
  statusLabel: string
  priority: string
  requesterName: string
  assigneeName: string
  createdAt: string
  updatedAt: string
  url: string | null
}

type SupportTicketsSnapshot = {
  generatedAt: string
  agentUrl: string | null
  tickets: SupportTicket[]
}

type OrderPhoto = {
  path: string
  url: string
  createdAt: string
}

type MetricTone = {
  cardBackground: string
  borderColor: string
  labelColor: string
  valueColor: string
}

type AppScreen = 'dashboard' | 'pictures'
type OrderMetricKey =
  | 'totalOrders'
  | 'activeOrders'
  | 'completedOrders'
  | 'dueSoonOrders'
  | 'missingDueDateOrders'
type TicketMetricKey =
  | 'newTickets'
  | 'inProgressTickets'
  | 'openTickets'
  | 'pendingTickets'
  | 'solvedTickets'

type DetailSelection =
  | {
      type: 'order'
      key: OrderMetricKey
      label: string
    }
  | {
      type: 'ticket'
      key: TicketMetricKey
      label: string
    }
  | null

const ORDER_TONES: MetricTone[] = [
  {
    cardBackground: '#e8f7ff',
    borderColor: '#9cd4f4',
    labelColor: '#21507a',
    valueColor: '#0a2f52',
  },
  {
    cardBackground: '#eaf6ee',
    borderColor: '#9fd8b2',
    labelColor: '#1d5f37',
    valueColor: '#0f3f24',
  },
  {
    cardBackground: '#fff4e8',
    borderColor: '#f2c999',
    labelColor: '#7a4d1f',
    valueColor: '#5b330b',
  },
  {
    cardBackground: '#fff9e8',
    borderColor: '#efd98d',
    labelColor: '#705718',
    valueColor: '#574107',
  },
  {
    cardBackground: '#ffeef1',
    borderColor: '#efb2bf',
    labelColor: '#7f2740',
    valueColor: '#5e1330',
  },
]

const TICKET_TONES: MetricTone[] = [
  {
    cardBackground: '#f0efff',
    borderColor: '#b5b0f0',
    labelColor: '#3d2f8a',
    valueColor: '#281a66',
  },
  {
    cardBackground: '#f2fbf8',
    borderColor: '#9edcc8',
    labelColor: '#1b6850',
    valueColor: '#0f4a37',
  },
  {
    cardBackground: '#ecf4ff',
    borderColor: '#9ec1ea',
    labelColor: '#224f84',
    valueColor: '#14335d',
  },
  {
    cardBackground: '#fff5f1',
    borderColor: '#f3c1ac',
    labelColor: '#7a3f2a',
    valueColor: '#582712',
  },
  {
    cardBackground: '#eff7ee',
    borderColor: '#b4d6a8',
    labelColor: '#325f27',
    valueColor: '#1e4617',
  },
]

const SIDEBAR_ITEMS: Array<{ id: AppScreen; label: string; shortLabel: string }> = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'DB' },
  { id: 'pictures', label: 'Pictures', shortLabel: 'PH' },
]

function withRefreshQuery(path: string, refreshRequested: boolean) {
  if (!refreshRequested) {
    return `${API_BASE_URL}${path}`
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${API_BASE_URL}${path}${separator}refresh=1`
}

async function request<T>(
  path: string,
  refreshRequested = false,
  init: RequestInit = {},
) {
  const response = await fetch(withRefreshQuery(path, refreshRequested), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(String((payload as { error?: string }).error ?? 'Request failed.'))
  }

  return payload as T
}

function formatSyncTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Unknown'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) {
    return 'Not set'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function normalizeTicketStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function MetricCard({
  label,
  value,
  helper,
  tone,
  onPress,
}: {
  label: string
  value: string
  helper?: string
  tone: MetricTone
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.metricCard,
        {
          backgroundColor: tone.cardBackground,
          borderColor: tone.borderColor,
        },
        pressed ? styles.metricCardPressed : null,
      ]}
    >
      <Text style={[styles.metricLabel, { color: tone.labelColor }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: tone.valueColor }]}>{value}</Text>
      {helper ? <Text style={[styles.metricHelper, { color: tone.labelColor }]}>{helper}</Text> : null}
      <Text style={styles.metricActionText}>Tap to view</Text>
    </Pressable>
  )
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<AppScreen>('dashboard')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [mondaySnapshot, setMondaySnapshot] = useState<MondayDashboardSnapshot | null>(null)
  const [zendeskSnapshot, setZendeskSnapshot] = useState<ZendeskTicketSummarySnapshot | null>(null)
  const [supportTicketsSnapshot, setSupportTicketsSnapshot] = useState<SupportTicketsSnapshot | null>(null)

  const [detailSelection, setDetailSelection] = useState<DetailSelection>(null)

  const [selectedPictureOrderId, setSelectedPictureOrderId] = useState<string | null>(null)
  const [isPicturesModalOpen, setIsPicturesModalOpen] = useState(false)
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const [orderPhotosByOrderId, setOrderPhotosByOrderId] = useState<Record<string, OrderPhoto[]>>({})
  const [isLoadingOrderPhotos, setIsLoadingOrderPhotos] = useState(false)
  const [isUploadingPicture, setIsUploadingPicture] = useState(false)
  const [pictureMessage, setPictureMessage] = useState<string | null>(null)

  const loadDashboard = useCallback(async (refreshRequested: boolean) => {
    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    setErrorMessage(null)

    try {
      const [mondayResult, zendeskResult, supportTicketsResult] = await Promise.allSettled([
        request<MondayDashboardSnapshot>('/api/dashboard/monday', refreshRequested),
        request<ZendeskTicketSummarySnapshot>('/api/dashboard/zendesk', refreshRequested),
        request<SupportTicketsSnapshot>('/api/support/tickets?limit=500', refreshRequested),
      ])

      const failedSlices: string[] = []

      if (mondayResult.status === 'fulfilled') {
        setMondaySnapshot(mondayResult.value)
      } else {
        failedSlices.push('orders')
      }

      if (zendeskResult.status === 'fulfilled') {
        setZendeskSnapshot(zendeskResult.value)
      } else {
        failedSlices.push('ticket summary')
      }

      if (supportTicketsResult.status === 'fulfilled') {
        setSupportTicketsSnapshot(supportTicketsResult.value)
      } else {
        failedSlices.push('ticket list')
      }

      if (failedSlices.length > 0) {
        setErrorMessage(`Could not refresh ${failedSlices.join(', ')}.`)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load data.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard(false)
  }, [loadDashboard])

  useEffect(() => {
    const firstOrderId = mondaySnapshot?.orders?.[0]?.id ?? null

    setSelectedPictureOrderId((previous) => {
      if (previous && mondaySnapshot?.orders?.some((order) => order.id === previous)) {
        return previous
      }

      return firstOrderId
    })
  }, [mondaySnapshot])

  const loadOrderPhotos = useCallback(
    async (orderId: string, forceRefresh = false) => {
      if (!orderId) {
        return
      }

      if (!forceRefresh && orderPhotosByOrderId[orderId]) {
        return
      }

      setIsLoadingOrderPhotos(true)
      setPictureMessage(null)

      try {
        const payload = await request<{ orderId: string; photos: OrderPhoto[] }>(
          `/api/orders/${encodeURIComponent(orderId)}/photos`,
        )

        setOrderPhotosByOrderId((previous) => ({
          ...previous,
          [orderId]: Array.isArray(payload.photos) ? payload.photos : [],
        }))
      } catch {
        setPictureMessage('Could not load saved pictures for this order.')
      } finally {
        setIsLoadingOrderPhotos(false)
      }
    },
    [orderPhotosByOrderId],
  )

  useEffect(() => {
    if (activeScreen !== 'pictures' || !selectedPictureOrderId) {
      return
    }

    void loadOrderPhotos(selectedPictureOrderId)
  }, [activeScreen, selectedPictureOrderId, loadOrderPhotos])

  const orderMetrics = useMemo(
    () => [
      {
        key: 'totalOrders' as const,
        label: 'Total Orders',
        value: mondaySnapshot?.metrics.totalOrders ?? 0,
        helper: 'All current orders',
        tone: ORDER_TONES[0],
      },
      {
        key: 'activeOrders' as const,
        label: 'Active',
        value: mondaySnapshot?.metrics.activeOrders ?? 0,
        helper: 'In progress now',
        tone: ORDER_TONES[1],
      },
      {
        key: 'completedOrders' as const,
        label: 'Shipped',
        value: mondaySnapshot?.metrics.completedOrders ?? 0,
        helper: 'Completed and sent',
        tone: ORDER_TONES[2],
      },
      {
        key: 'dueSoonOrders' as const,
        label: 'Due Soon',
        value: mondaySnapshot?.metrics.dueSoonOrders ?? 0,
        helper: 'Attention needed',
        tone: ORDER_TONES[3],
      },
      {
        key: 'missingDueDateOrders' as const,
        label: 'Missing Due Date',
        value: mondaySnapshot?.metrics.missingDueDateOrders ?? 0,
        helper: 'Needs scheduling',
        tone: ORDER_TONES[4],
      },
    ],
    [mondaySnapshot],
  )

  const ticketMetrics = useMemo(
    () => [
      {
        key: 'newTickets' as const,
        label: 'New',
        value: zendeskSnapshot?.metrics.newTickets ?? 0,
        tone: TICKET_TONES[0],
      },
      {
        key: 'inProgressTickets' as const,
        label: 'In Process',
        value: zendeskSnapshot?.metrics.inProgressTickets ?? 0,
        tone: TICKET_TONES[1],
      },
      {
        key: 'openTickets' as const,
        label: 'Open',
        value: zendeskSnapshot?.metrics.openTickets ?? 0,
        tone: TICKET_TONES[2],
      },
      {
        key: 'pendingTickets' as const,
        label: 'Pending',
        value: zendeskSnapshot?.metrics.pendingTickets ?? 0,
        tone: TICKET_TONES[3],
      },
      {
        key: 'solvedTickets' as const,
        label: 'Solved',
        value: zendeskSnapshot?.metrics.solvedTickets ?? 0,
        tone: TICKET_TONES[4],
      },
    ],
    [zendeskSnapshot],
  )

  const latestSyncText = useMemo(() => {
    const candidates = [
      mondaySnapshot?.generatedAt,
      zendeskSnapshot?.generatedAt,
      supportTicketsSnapshot?.generatedAt,
    ].filter((value): value is string => Boolean(value))

    if (!candidates.length) {
      return 'Unknown'
    }

    const newestRaw = candidates.reduce((latest, current) => {
      const latestTime = Date.parse(latest)
      const currentTime = Date.parse(current)

      if (Number.isNaN(latestTime)) {
        return current
      }

      if (Number.isNaN(currentTime)) {
        return latest
      }

      return currentTime > latestTime ? current : latest
    })

    return formatSyncTimestamp(newestRaw)
  }, [mondaySnapshot, zendeskSnapshot, supportTicketsSnapshot])

  const detailOrders = useMemo(() => {
    if (!mondaySnapshot || !detailSelection || detailSelection.type !== 'order') {
      return [] as DashboardOrder[]
    }

    switch (detailSelection.key) {
      case 'totalOrders':
        return mondaySnapshot.orders
      case 'activeOrders':
        return mondaySnapshot.details.activeOrders
      case 'completedOrders':
        return mondaySnapshot.details.completedOrders
      case 'dueSoonOrders':
        return mondaySnapshot.details.dueSoonOrders
      case 'missingDueDateOrders':
        return mondaySnapshot.details.missingDueDateOrders
      default:
        return [] as DashboardOrder[]
    }
  }, [detailSelection, mondaySnapshot])

  const detailTickets = useMemo(() => {
    if (!supportTicketsSnapshot || !detailSelection || detailSelection.type !== 'ticket') {
      return [] as SupportTicket[]
    }

    const allTickets = supportTicketsSnapshot.tickets

    return allTickets.filter((ticket) => {
      const status = normalizeTicketStatus(ticket.status)
      const statusLabel = normalizeTicketStatus(ticket.statusLabel)

      switch (detailSelection.key) {
        case 'newTickets':
          return status === 'new' || statusLabel.includes('new')
        case 'inProgressTickets':
          return (
            status === 'in_progress' ||
            statusLabel.includes('in progress') ||
            statusLabel.includes('in-progress')
          )
        case 'openTickets':
          return (
            (status === 'open' || statusLabel === 'open') &&
            !statusLabel.includes('in progress') &&
            !statusLabel.includes('in-progress')
          )
        case 'pendingTickets':
          return status === 'pending' || statusLabel.includes('pending')
        case 'solvedTickets':
          return (
            status === 'solved' ||
            status === 'closed' ||
            statusLabel.includes('solved') ||
            statusLabel.includes('closed')
          )
        default:
          return false
      }
    })
  }, [detailSelection, supportTicketsSnapshot])

  const allOrdersForPictures = useMemo(() => mondaySnapshot?.orders ?? [], [mondaySnapshot])

  const filteredOrdersForPictures = useMemo(() => {
    const normalizedQuery = orderSearchQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return allOrdersForPictures
    }

    return allOrdersForPictures.filter((order) =>
      String(order.id).toLowerCase().includes(normalizedQuery),
    )
  }, [allOrdersForPictures, orderSearchQuery])

  const selectedPictureOrder = useMemo(
    () => allOrdersForPictures.find((order) => order.id === selectedPictureOrderId) ?? null,
    [allOrdersForPictures, selectedPictureOrderId],
  )

  const selectedOrderPhotos = useMemo(() => {
    if (!selectedPictureOrder) {
      return [] as OrderPhoto[]
    }

    return orderPhotosByOrderId[selectedPictureOrder.id] ?? []
  }, [orderPhotosByOrderId, selectedPictureOrder])

  const handleTakePicture = useCallback(async () => {
    if (!selectedPictureOrder) {
      setPictureMessage('Select an order first.')
      return
    }

    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync()

      if (permissionResult.status !== 'granted') {
        setPictureMessage('Camera permission is required to take order pictures.')
        return
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.75,
        base64: true,
      })

      if (result.canceled || !result.assets?.length) {
        return
      }

      const capturedAsset = result.assets[0]

      if (!capturedAsset.base64) {
        setPictureMessage('Could not process picture data. Please try again.')
        return
      }

      setIsUploadingPicture(true)

      const payload = await request<{ photo: OrderPhoto }>(
        `/api/orders/${encodeURIComponent(selectedPictureOrder.id)}/photos`,
        false,
        {
          method: 'POST',
          body: JSON.stringify({
            imageBase64: capturedAsset.base64,
            mimeType: capturedAsset.mimeType || 'image/jpeg',
          }),
        },
      )

      setOrderPhotosByOrderId((previous) => ({
        ...previous,
        [selectedPictureOrder.id]: [
          payload.photo,
          ...(previous[selectedPictureOrder.id] ?? []),
        ],
      }))
      setPictureMessage(`Saved picture for order ${selectedPictureOrder.name}.`)
    } catch {
      setPictureMessage('Could not upload picture. Try again.')
    } finally {
      setIsUploadingPicture(false)
    }
  }, [selectedPictureOrder])

  useEffect(() => {
    if (activeScreen !== 'pictures') {
      setIsPicturesModalOpen(false)
    }
  }, [activeScreen])

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <View style={styles.contentPane}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.topBarCard}>
              <View style={styles.topBarLeftGroup}>
                <Pressable
                  style={styles.menuButton}
                  onPress={() => setIsSidebarOpen(true)}
                >
                  <View style={styles.menuIconWrap}>
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                  </View>
                </Pressable>
                <Text style={styles.topBarSyncText}>Last sync {latestSyncText}</Text>
              </View>

              <Pressable
                style={[styles.refreshButton, isRefreshing ? styles.buttonDisabled : null]}
                onPress={() => {
                  void loadDashboard(true)
                }}
                disabled={isRefreshing}
              >
                <Text style={styles.refreshButtonText}>{isRefreshing ? 'Refreshing' : 'Refresh'}</Text>
              </Pressable>
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {isLoading && !mondaySnapshot && !zendeskSnapshot ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#335ad8" />
                <Text style={styles.loadingText}>Loading dashboard...</Text>
              </View>
            ) : null}

            {activeScreen === 'dashboard' ? (
              <>
                <Text style={styles.sectionTitle}>Order Snapshot</Text>
                <View style={styles.metricsGrid}>
                  {orderMetrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={String(metric.value)}
                      helper={metric.helper}
                      tone={metric.tone}
                      onPress={() =>
                        setDetailSelection({
                          type: 'order',
                          key: metric.key,
                          label: metric.label,
                        })
                      }
                    />
                  ))}
                </View>

                <Text style={styles.sectionTitle}>Ticket Progress</Text>
                <View style={styles.metricsGrid}>
                  {ticketMetrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={String(metric.value)}
                      tone={metric.tone}
                      onPress={() =>
                        setDetailSelection({
                          type: 'ticket',
                          key: metric.key,
                          label: metric.label,
                        })
                      }
                    />
                  ))}
                </View>

              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Pictures</Text>
                <Text style={styles.sectionSubtitle}>
                  Search an order number, then tap an order to open its pictures popup.
                </Text>

                {allOrdersForPictures.length === 0 ? (
                  <View style={styles.emptyPicturesBox}>
                    <Text style={styles.emptyDetailText}>
                      No orders loaded yet. Refresh to pull current orders.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.ordersListCard}>
                    <TextInput
                      value={orderSearchQuery}
                      onChangeText={setOrderSearchQuery}
                      placeholder="Search by order #"
                      placeholderTextColor="#6a7ea8"
                      style={styles.orderSearchInput}
                      keyboardType="number-pad"
                    />

                    {filteredOrdersForPictures.length === 0 ? (
                      <Text style={styles.emptyDetailText}>No orders match your search.</Text>
                    ) : (
                      <ScrollView
                        style={styles.ordersListScroll}
                        contentContainerStyle={styles.ordersListContent}
                      >
                        {filteredOrdersForPictures.map((order) => (
                          <Pressable
                            key={order.id}
                            style={styles.orderListItem}
                            onPress={() => {
                              setSelectedPictureOrderId(order.id)
                              setPictureMessage(null)
                              setIsPicturesModalOpen(true)
                              void loadOrderPhotos(order.id)
                            }}
                          >
                            <Text style={styles.orderListName} numberOfLines={1}>
                              {order.name || `Order ${order.id}`}
                            </Text>
                            <Text style={styles.orderListMeta} numberOfLines={1}>
                              Order #{order.id}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>

        <Modal
          visible={Boolean(detailSelection)}
          transparent
          animationType="fade"
          onRequestClose={() => setDetailSelection(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{detailSelection?.label ?? 'Details'}</Text>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => setDetailSelection(null)}
                >
                  <Text style={styles.detailCloseButtonText}>Close</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {detailSelection?.type === 'order' ? (
                  detailOrders.length > 0 ? (
                    detailOrders.map((order) => (
                      <View key={`${order.id}-${order.name}`} style={styles.detailRow}>
                        <Text style={styles.detailPrimary} numberOfLines={1}>
                          {order.name || `Order ${order.id}`}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          Order #{order.id} • {order.groupTitle || 'No group'}
                        </Text>
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          {order.statusLabel || 'No status'} • Due {formatDisplayDate(order.effectiveDueDate)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyDetailText}>No orders in this section.</Text>
                  )
                ) : detailTickets.length > 0 ? (
                  detailTickets.map((ticket) => (
                    <View key={String(ticket.id)} style={styles.detailRow}>
                      <Text style={styles.detailPrimary} numberOfLines={1}>
                        Ticket #{ticket.id} • {ticket.assigneeName || 'Unassigned'}
                      </Text>
                      <Text style={styles.detailSecondary} numberOfLines={2}>
                        {ticket.subject || 'No subject'}
                      </Text>
                      {ticket.orderNumber ? (
                        <Text style={styles.detailSecondary} numberOfLines={1}>
                          Order #{ticket.orderNumber}
                        </Text>
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyDetailText}>No tickets in this section.</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={isPicturesModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsPicturesModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.detailHeader}>
                <View style={styles.pictureOrderTextBlock}>
                  <Text style={styles.detailTitle} numberOfLines={1}>
                    {selectedPictureOrder?.name ?? 'Order pictures'}
                  </Text>
                  <Text style={styles.pictureOrderMeta} numberOfLines={1}>
                    Order #{selectedPictureOrder?.id ?? '-'}
                  </Text>
                </View>
                <Pressable
                  style={styles.detailCloseButton}
                  onPress={() => setIsPicturesModalOpen(false)}
                >
                  <Text style={styles.detailCloseButtonText}>Close</Text>
                </Pressable>
              </View>

              <View style={styles.pictureModalActionRow}>
                <Pressable
                  style={[
                    styles.takePictureButton,
                    !selectedPictureOrder || isUploadingPicture ? styles.buttonDisabled : null,
                  ]}
                  onPress={() => {
                    void handleTakePicture()
                  }}
                  disabled={!selectedPictureOrder || isUploadingPicture}
                >
                  <Text style={styles.takePictureButtonText}>
                    {isUploadingPicture ? 'Saving...' : 'Take picture'}
                  </Text>
                </Pressable>
              </View>

              {pictureMessage ? <Text style={styles.pictureMessage}>{pictureMessage}</Text> : null}

              <ScrollView contentContainerStyle={styles.modalBodyContent}>
                {isLoadingOrderPhotos ? (
                  <View style={styles.inlineLoadingBox}>
                    <ActivityIndicator size="small" color="#335ad8" />
                    <Text style={styles.loadingText}>Loading saved pictures...</Text>
                  </View>
                ) : selectedOrderPhotos.length === 0 ? (
                  <Text style={styles.emptyDetailText}>No pictures saved for this order yet.</Text>
                ) : (
                  <View style={styles.photoGrid}>
                    {selectedOrderPhotos.map((photo, index) => (
                      <View key={`${photo.path}-${index}`} style={styles.photoTile}>
                        <Image source={{ uri: photo.url }} style={styles.photoImage} />
                        <Text style={styles.photoTileCaption}>
                          {formatDisplayDate(photo.createdAt)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {isSidebarOpen ? (
          <>
            <Pressable style={styles.sidebarScrim} onPress={() => setIsSidebarOpen(false)} />
            <View style={styles.sidebarDrawer}>
              <View style={styles.sidebarBrandBox}>
                <Text style={styles.sidebarBrandA}>A</Text>
                <Text style={styles.sidebarBrandText}>Arnold</Text>
              </View>

              <View style={styles.sidebarNav}>
                {SIDEBAR_ITEMS.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.sidebarItem, activeScreen === item.id ? styles.sidebarItemActive : null]}
                    onPress={() => {
                      setActiveScreen(item.id)
                      if (item.id !== 'dashboard') {
                        setDetailSelection(null)
                      }
                      if (item.id !== 'pictures') {
                        setIsPicturesModalOpen(false)
                      }
                      setIsSidebarOpen(false)
                    }}
                  >
                    <Text style={styles.sidebarItemShort}>{item.shortLabel}</Text>
                    <Text style={styles.sidebarItemLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1232',
  },
  shell: {
    flex: 1,
    position: 'relative',
  },
  contentPane: {
    flex: 1,
    backgroundColor: '#eef2ff',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    paddingBottom: 40,
    gap: 8,
  },
  topBarCard: {
    backgroundColor: '#111f4b',
    borderRadius: 14,
    borderColor: '#3559db',
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  topBarLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  menuButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3b57b5',
    backgroundColor: '#1a2b68',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconWrap: {
    gap: 3,
  },
  menuLine: {
    width: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#d5e0ff',
  },
  topBarSyncText: {
    color: '#b7c8ff',
    fontWeight: '600',
    flexShrink: 1,
  },
  refreshButton: {
    backgroundColor: '#3d65ef',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 95,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  refreshButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  loadingBox: {
    backgroundColor: '#f9fbff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cdd8f5',
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#445889',
  },
  errorBox: {
    marginBottom: 8,
    backgroundColor: '#ffe8ec',
    borderColor: '#ee9db0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#8e233f',
    fontWeight: '500',
  },
  sectionTitle: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a2550',
    marginBottom: 6,
  },
  sectionSubtitle: {
    color: '#425485',
    marginBottom: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 116,
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: '#1a2345',
    shadowOpacity: 0.09,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  metricCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    marginTop: 4,
    fontWeight: '800',
    fontSize: 24,
  },
  metricHelper: {
    marginTop: 4,
    fontSize: 11,
  },
  metricActionText: {
    marginTop: 6,
    fontSize: 11,
    color: '#1a2550',
    fontWeight: '700',
  },
  detailPanel: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 8,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  detailTitle: {
    color: '#1a2550',
    fontWeight: '800',
    fontSize: 17,
    flexShrink: 1,
  },
  detailCloseButton: {
    backgroundColor: '#273c84',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailCloseButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  detailRow: {
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  detailPrimary: {
    color: '#1b2a59',
    fontWeight: '700',
    fontSize: 13,
  },
  detailSecondary: {
    color: '#536895',
    fontSize: 12,
  },
  emptyDetailText: {
    color: '#5a6f99',
    fontSize: 13,
  },
  emptyPicturesBox: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
  },
  ordersListCard: {
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 10,
  },
  orderSearchInput: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    color: '#1b2a59',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontWeight: '600',
  },
  ordersListScroll: {
    maxHeight: 380,
  },
  ordersListContent: {
    gap: 8,
    paddingBottom: 8,
  },
  orderListItem: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    gap: 2,
  },
  orderListName: {
    color: '#22366f',
    fontSize: 13,
    fontWeight: '700',
  },
  orderListMeta: {
    color: '#4e6294',
    fontSize: 12,
    fontWeight: '600',
  },
  orderPickerChip: {
    borderWidth: 1,
    borderColor: '#c8d6ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    maxWidth: 210,
  },
  orderPickerChipSelected: {
    borderColor: '#3f63e8',
    backgroundColor: '#dce6ff',
  },
  orderPickerChipText: {
    color: '#22366f',
    fontSize: 12,
    fontWeight: '600',
  },
  orderPickerChipTextSelected: {
    color: '#1a2f72',
  },
  pictureActionCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 12,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 8,
  },
  pictureActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pictureOrderTextBlock: {
    flex: 1,
    gap: 1,
  },
  pictureOrderTitle: {
    color: '#1b2a59',
    fontWeight: '800',
    fontSize: 14,
  },
  pictureOrderMeta: {
    color: '#4e6294',
    fontSize: 12,
  },
  takePictureButton: {
    backgroundColor: '#204fc2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  takePictureButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  pictureMessage: {
    color: '#204fc2',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  pictureModalActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 4,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  photoTile: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e3ff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#e2e8ff',
  },
  photoTileCaption: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: '#4b6191',
    fontWeight: '600',
    fontSize: 11,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 16, 46, 0.46)',
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  modalCard: {
    maxHeight: '82%',
    borderWidth: 1,
    borderColor: '#c6d2f8',
    borderRadius: 14,
    backgroundColor: '#f9fbff',
    padding: 12,
    gap: 10,
  },
  modalBodyContent: {
    gap: 8,
    paddingBottom: 8,
  },
  sidebarScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 18, 50, 0.28)',
  },
  sidebarDrawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 220,
    backgroundColor: '#101836',
    borderRightWidth: 1,
    borderRightColor: '#1f2a56',
    paddingTop: 46,
    paddingHorizontal: 10,
  },
  sidebarBrandBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  sidebarBrandA: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#3c62f0',
    color: '#ffffff',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '800',
    overflow: 'hidden',
  },
  sidebarBrandText: {
    color: '#ced8ff',
    fontSize: 18,
    fontWeight: '700',
  },
  sidebarNav: {
    gap: 10,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a376f',
    backgroundColor: '#16224a',
  },
  sidebarItemActive: {
    borderColor: '#7fa2ff',
    backgroundColor: '#2a3f8e',
  },
  sidebarItemShort: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#0f1739',
    color: '#c8d4ff',
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
  sidebarItemLabel: {
    marginLeft: 10,
    color: '#d2dcff',
    fontWeight: '600',
  },
})
