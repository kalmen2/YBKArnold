import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Picker } from '@react-native-picker/picker'
import { StatusBar } from 'expo-status-bar'
import { type ReactNode, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type {
  DashboardOrder,
  MobileAlert,
  MobileTimesheetEntry,
  MobileTimesheetStage,
  MobileTimesheetWorker,
  MetricTone,
  OrderMetricKey,
  TicketMetricKey,
} from './appTypes'
import { formatDisplayDate, formatSyncTimestamp } from './appUtils'
import { styles } from './appStyles'

export type TranslateFn = (english: string, spanish: string) => string

type SettingsMenuId = 'security' | 'language' | 'notifications' | 'updates' | 'account'

type OrderMetricItem = {
  key: OrderMetricKey
  label: string
  value: number
  helper?: string
  tone: MetricTone
}

type TicketMetricItem = {
  key: TicketMetricKey
  label: string
  value: number
  tone: MetricTone
}

type ManagerProgressRow = {
  jobName: string
  displayOrderNumber: string
  mondayOrderId: string | null
  mondayItemName: string | null
  shopDrawingUrl: string | null
  shopDrawingCachedUrl: string | null
  totalHours: number
  workerCount: number
  workerHoursByWorker: Array<{
    workerId: string
    workerName: string
    hours: number
  }>
  savedReadyPercent: number
  editReadyPercent: number
}

export function MetricCard({
  label,
  value,
  helper,
  actionLabel,
  tone,
  onPress,
}: {
  label: string
  value: string
  helper?: string
  actionLabel: string
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
      <Text style={styles.metricActionText}>{actionLabel}</Text>
    </Pressable>
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.authShell}>
      <StatusBar style="light" />
      <View style={styles.authCard}>{children}</View>
    </SafeAreaView>
  )
}

export function AuthButton({ label, onPress, disabled = false, variant = 'primary', textVariant }: {
  label: string
  onPress: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  textVariant?: 'primary' | 'secondary'
}) {
  const resolvedTextVariant = textVariant ?? variant

  return (
    <Pressable
      style={[
        variant === 'secondary' ? styles.authButtonSecondary : styles.authButtonPrimary,
        disabled ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={resolvedTextVariant === 'secondary' ? styles.authButtonSecondaryText : styles.authButtonText}>
        {label}
      </Text>
    </Pressable>
  )
}

export function InlineLoading({ label }: { label: string }) {
  return (
    <View style={styles.inlineLoadingBox}>
      <ActivityIndicator size="small" color="#335ad8" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  )
}

export function DashboardSection({
  dashboardUnreadSummary,
  orderMetrics,
  ticketMetrics,
  t,
  onSelectOrderMetric,
  onSelectTicketMetric,
}: {
  dashboardUnreadSummary: string | null
  orderMetrics: OrderMetricItem[]
  ticketMetrics: TicketMetricItem[]
  t: TranslateFn
  onSelectOrderMetric: (key: OrderMetricKey, label: string) => void
  onSelectTicketMetric: (key: TicketMetricKey, label: string) => void
}) {
  return (
    <>
      {dashboardUnreadSummary ? (
        <View style={styles.unreadSummaryBox}>
          <Text style={styles.unreadSummaryText}>{dashboardUnreadSummary}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t('Order Snapshot', 'Resumen de ordenes')}</Text>
      <View style={styles.metricsGrid}>
        {orderMetrics.map((metric) => (
          <MetricCard
            key={metric.key}
            label={metric.label}
            value={String(metric.value)}
            helper={metric.helper}
            actionLabel={t('Tap to view', 'Tocar para ver')}
            tone={metric.tone}
            onPress={() => onSelectOrderMetric(metric.key, metric.label)}
          />
        ))}
      </View>

      <Text style={styles.sectionTitle}>{t('Ticket Progress', 'Progreso de tickets')}</Text>
      <View style={styles.metricsGrid}>
        {ticketMetrics.map((metric) => (
          <MetricCard
            key={metric.key}
            label={metric.label}
            value={String(metric.value)}
            actionLabel={t('Tap to view', 'Tocar para ver')}
            tone={metric.tone}
            onPress={() => onSelectTicketMetric(metric.key, metric.label)}
          />
        ))}
      </View>
    </>
  )
}

export function PicturesSection({
  t,
  allOrdersForPictures,
  filteredOrdersForPictures,
  orderSearchQuery,
  onOrderSearchQueryChange,
  picturesCardHeight,
  onOpenPicturesModalForOrder,
}: {
  t: TranslateFn
  allOrdersForPictures: DashboardOrder[]
  filteredOrdersForPictures: DashboardOrder[]
  orderSearchQuery: string
  onOrderSearchQueryChange: (value: string) => void
  picturesCardHeight: number
  onOpenPicturesModalForOrder: (orderId: string) => void
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>{t('Pictures', 'Fotos')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Search an order number, then tap an order to open its pictures popup.',
          'Busca un numero de orden y toca una orden para abrir su ventana de fotos.',
        )}
      </Text>

      {allOrdersForPictures.length === 0 ? (
        <View style={styles.emptyPicturesBox}>
          <Text style={styles.emptyDetailText}>
            {t('No orders loaded yet. Refresh to pull current orders.', 'Aun no hay ordenes cargadas. Actualiza para traer las ordenes actuales.')}
          </Text>
        </View>
      ) : (
        <View style={[styles.ordersListCard, { height: picturesCardHeight }]}> 
          <TextInput
            value={orderSearchQuery}
            onChangeText={onOrderSearchQueryChange}
            placeholder={t('Search by order #', 'Buscar por orden #')}
            placeholderTextColor="#6a7ea8"
            style={styles.orderSearchInput}
            keyboardType="number-pad"
          />

          {filteredOrdersForPictures.length === 0 ? (
            <Text style={styles.emptyDetailText}>{t('No orders match your search.', 'No hay ordenes que coincidan con tu busqueda.')}</Text>
          ) : (
            <ScrollView
              style={styles.ordersListScroll}
              contentContainerStyle={styles.ordersListContent}
            >
              {filteredOrdersForPictures.map((order) => (
                <Pressable
                  key={order.id}
                  style={styles.orderListItem}
                  onPress={() => onOpenPicturesModalForOrder(order.id)}
                >
                  <Text style={styles.orderListName} numberOfLines={1}>
                    {order.name || `Order ${order.id}`}
                  </Text>
                  <Text style={styles.orderListMeta} numberOfLines={1}>
                    {t('Order', 'Orden')} #{order.id}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </>
  )
}

export function OrdersSection({
  t,
  locale,
  allOrders,
  filteredOrders,
  orderSearchQuery,
  onOrderSearchQueryChange,
  ordersCardHeight,
  hasManagerInsights,
  managerInsightsByOrderId,
  ordersPage,
  ordersTotalPages,
  onPreviousOrdersPage,
  onNextOrdersPage,
  onOpenOrderDetails,
}: {
  t: TranslateFn
  locale: string
  allOrders: DashboardOrder[]
  filteredOrders: DashboardOrder[]
  orderSearchQuery: string
  onOrderSearchQueryChange: (value: string) => void
  ordersCardHeight: number
  hasManagerInsights: boolean
  managerInsightsByOrderId: Record<string, {
    readyPercent: number | null
    workerCount: number
    totalHours: number
    updatedAt: string | null
  }>
  ordersPage: number
  ordersTotalPages: number
  onPreviousOrdersPage: () => void
  onNextOrdersPage: () => void
  onOpenOrderDetails: (order: DashboardOrder) => void
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>{t('Orders', 'Ordenes')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Quick order list for mobile. Tap any order to view key details and shop drawing.',
          'Lista rapida de ordenes para movil. Toca una orden para ver detalles y shop drawing.',
        )}
      </Text>

      {allOrders.length === 0 ? (
        <View style={styles.emptyPicturesBox}>
          <Text style={styles.emptyDetailText}>
            {t('No orders loaded yet. Refresh to pull current orders.', 'Aun no hay ordenes cargadas. Actualiza para traer las ordenes actuales.')}
          </Text>
        </View>
      ) : (
        <View style={[styles.ordersListCard, { height: ordersCardHeight }]}>
          <TextInput
            value={orderSearchQuery}
            onChangeText={onOrderSearchQueryChange}
            placeholder={t('Search by order # or name', 'Buscar por orden # o nombre')}
            placeholderTextColor="#6a7ea8"
            style={styles.orderSearchInput}
          />

          {filteredOrders.length === 0 ? (
            <Text style={styles.emptyDetailText}>{t('No orders match your search.', 'No hay ordenes que coincidan con tu busqueda.')}</Text>
          ) : (
            <ScrollView
              style={styles.ordersListScroll}
              contentContainerStyle={styles.ordersListContent}
            >
              {filteredOrders.map((order) => (
                <Pressable
                  key={order.id}
                  style={({ pressed }) => [styles.orderListItem, pressed ? styles.orderListItemPressed : null]}
                  onPress={() => onOpenOrderDetails(order)}
                >
                  {(() => {
                    const managerInsight = managerInsightsByOrderId[String(order.id)]
                    const managerReadyPercent = managerInsight?.readyPercent
                    const hasReadyPercent = typeof managerReadyPercent === 'number'
                      && Number.isFinite(managerReadyPercent)
                    const displayReadyPercent = hasReadyPercent
                      ? Math.min(100, Math.max(0, managerReadyPercent))
                      : null
                    const workerCount = managerInsight?.workerCount ?? 0
                    const totalHours = managerInsight?.totalHours ?? 0

                    return (
                      <>
                        <View style={styles.orderListTopRow}>
                          <View style={styles.orderListIdBadge}>
                            <Text style={styles.orderListIdText}>#{order.id}</Text>
                          </View>
                          <Text style={styles.orderListStatusPill} numberOfLines={1}>
                            {order.statusLabel || t('No status', 'Sin estado')}
                          </Text>
                        </View>

                        <Text style={styles.orderListName} numberOfLines={1}>
                          {order.name || `${t('Order', 'Orden')} ${order.id}`}
                        </Text>

                        <Text style={styles.orderListMeta} numberOfLines={1}>
                          {t('Due', 'Vence')}: {formatDisplayDate(order.effectiveDueDate, locale)}
                        </Text>

                        {hasManagerInsights ? (
                          <>
                            <View style={styles.orderProgressRow}>
                              <Text style={styles.orderProgressLabel} numberOfLines={1}>
                                {displayReadyPercent === null
                                  ? t('Manager: no update yet', 'Gerente: sin actualizacion')
                                  : t(
                                    `Manager: ${Math.round(displayReadyPercent)}% ready`,
                                    `Gerente: ${Math.round(displayReadyPercent)}% listo`,
                                  )}
                              </Text>
                              <Text style={styles.orderProgressWorkersMeta} numberOfLines={1}>
                                {t(
                                  `${workerCount} workers • ${totalHours.toFixed(1)}h`,
                                  `${workerCount} trabajadores • ${totalHours.toFixed(1)}h`,
                                )}
                              </Text>
                            </View>

                            <View style={styles.orderProgressTrack}>
                              <View
                                style={[
                                  styles.orderProgressFill,
                                  { width: `${displayReadyPercent ?? 0}%` },
                                ]}
                              />
                            </View>

                            {managerInsight?.updatedAt ? (
                              <Text style={styles.orderProgressMeta} numberOfLines={1}>
                                {t('Updated', 'Actualizado')}: {formatSyncTimestamp(managerInsight.updatedAt, locale)}
                              </Text>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    )
                  })()}
                </Pressable>
              ))}
            </ScrollView>
          )}

          {ordersTotalPages > 1 ? (
            <View style={styles.ordersPaginationRow}>
              <Pressable
                style={[styles.ordersPaginationButton, ordersPage <= 1 ? styles.buttonDisabled : null]}
                disabled={ordersPage <= 1}
                onPress={onPreviousOrdersPage}
              >
                <Text style={styles.ordersPaginationButtonText}>{t('Previous', 'Anterior')}</Text>
              </Pressable>

              <Text style={styles.ordersPaginationMeta}>
                {t(`Page ${ordersPage} of ${ordersTotalPages}`, `Pagina ${ordersPage} de ${ordersTotalPages}`)}
              </Text>

              <Pressable
                style={[styles.ordersPaginationButton, ordersPage >= ordersTotalPages ? styles.buttonDisabled : null]}
                disabled={ordersPage >= ordersTotalPages}
                onPress={onNextOrdersPage}
              >
                <Text style={styles.ordersPaginationButtonText}>{t('Next', 'Siguiente')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </>
  )
}

export function TimesheetSection({
  t,
  locale,
  timesheetWorker,
  timesheetDate,
  onOpenDatePicker,
  isTimesheetDatePickerOpen,
  selectedTimesheetDate,
  onTimesheetDateChange,
  timesheetStages,
  timesheetStageId,
  onTimesheetStageIdChange,
  timesheetJobNumber,
  onTimesheetJobNumberChange,
  timesheetHours,
  onTimesheetHoursChange,
  timesheetNotes,
  onTimesheetNotesChange,
  isTimesheetSaving,
  onSaveTimesheetEntry,
  timesheetMessage,
  isTimesheetLoading,
  timesheetEntriesForSelectedDate,
  timesheetStageNamesById,
}: {
  t: TranslateFn
  locale: string
  timesheetWorker: MobileTimesheetWorker | null
  timesheetDate: string
  onOpenDatePicker: () => void
  isTimesheetDatePickerOpen: boolean
  selectedTimesheetDate: Date
  onTimesheetDateChange: (event: DateTimePickerEvent, value?: Date) => void
  timesheetStages: MobileTimesheetStage[]
  timesheetStageId: string
  onTimesheetStageIdChange: (value: string) => void
  timesheetJobNumber: string
  onTimesheetJobNumberChange: (value: string) => void
  timesheetHours: string
  onTimesheetHoursChange: (value: string) => void
  timesheetNotes: string
  onTimesheetNotesChange: (value: string) => void
  isTimesheetSaving: boolean
  onSaveTimesheetEntry: () => void
  timesheetMessage: string | null
  isTimesheetLoading: boolean
  timesheetEntriesForSelectedDate: MobileTimesheetEntry[]
  timesheetStageNamesById: Record<string, string>
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>{t('My Daily Timesheet', 'Mi hoja diaria de horas')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Submit your own daily entries. Reports are managed on the website.',
          'Envia tus propias entradas diarias. Los reportes se manejan en el sitio web.',
        )}
      </Text>

      <View style={styles.timesheetCard}>
        <Text style={styles.timesheetWorkerText}>
          {timesheetWorker
            ? `${t('Worker', 'Trabajador')} #${timesheetWorker.workerNumber} • ${timesheetWorker.fullName}`
            : t('No linked worker profile found yet.', 'Aun no se encontro un perfil de trabajador vinculado.')}
        </Text>

        <Pressable
          style={styles.timesheetDateButton}
          onPress={onOpenDatePicker}
        >
          <Text style={styles.timesheetDateButtonText}>{t('Date', 'Fecha')}: {formatDisplayDate(timesheetDate, locale)}</Text>
          <Text style={styles.timesheetDateHint}>{timesheetDate}</Text>
        </Pressable>

        {isTimesheetDatePickerOpen ? (
          <View style={styles.timesheetDatePickerWrap}>
            <DateTimePicker
              value={selectedTimesheetDate}
              mode="date"
              display={Platform.OS === 'android' ? 'calendar' : 'default'}
              onChange={onTimesheetDateChange}
            />
          </View>
        ) : null}

        <View style={styles.timesheetStagePickerWrap}>
          <Picker
            selectedValue={timesheetStageId}
            onValueChange={(value) => onTimesheetStageIdChange(String(value ?? ''))}
            enabled={timesheetStages.length > 0}
            style={styles.timesheetStagePicker}
          >
            <Picker.Item
              label={timesheetStages.length > 0 ? t('Select stage', 'Seleccionar etapa') : t('No stages available', 'No hay etapas disponibles')}
              value=""
            />
            {timesheetStages.map((stage) => (
              <Picker.Item key={stage.id} label={stage.name} value={stage.id} />
            ))}
          </Picker>
        </View>

        {timesheetStages.length === 0 ? (
          <Text style={styles.timesheetInlineHint}>
            {t('No stages found. Add stages on the website first.', 'No se encontraron etapas. Agrega etapas primero en el sitio web.')}
          </Text>
        ) : null}

        <TextInput
          value={timesheetJobNumber}
          onChangeText={onTimesheetJobNumberChange}
          placeholder={t('Job number', 'Numero de trabajo')}
          placeholderTextColor="#6a7ea8"
          style={styles.orderSearchInput}
        />

        <TextInput
          value={timesheetHours}
          onChangeText={onTimesheetHoursChange}
          placeholder={t('Hours', 'Horas')}
          placeholderTextColor="#6a7ea8"
          style={styles.orderSearchInput}
          keyboardType="decimal-pad"
        />

        <TextInput
          value={timesheetNotes}
          onChangeText={onTimesheetNotesChange}
          placeholder={t('Notes (optional)', 'Notas (opcional)')}
          placeholderTextColor="#6a7ea8"
          style={[styles.orderSearchInput, styles.timesheetNotesInput]}
          multiline
        />

        <AuthButton
          label={isTimesheetSaving ? t('Saving...', 'Guardando...') : t('Save Daily Entry', 'Guardar entrada diaria')}
          onPress={onSaveTimesheetEntry}
          disabled={isTimesheetSaving || !timesheetWorker || !timesheetStageId || timesheetStages.length === 0}
        />

        {timesheetMessage ? <Text style={styles.timesheetMessage}>{timesheetMessage}</Text> : null}
      </View>

      <View style={styles.timesheetCard}>
        <Text style={styles.timesheetListTitle}>
          {t('Entries for', 'Entradas para')} {timesheetDate.trim() || t('selected date', 'fecha seleccionada')}
        </Text>
        {isTimesheetLoading ? (
          <InlineLoading label={t('Loading your entries...', 'Cargando tus entradas...')} />
        ) : timesheetEntriesForSelectedDate.length === 0 ? (
          <Text style={styles.emptyDetailText}>{t('No entries for this date yet.', 'Aun no hay entradas para esta fecha.')}</Text>
        ) : (
          <View style={styles.timesheetList}>
            {timesheetEntriesForSelectedDate.map((entry) => (
              <View key={entry.id} style={styles.timesheetEntryRow}>
                <Text style={styles.detailPrimary}>{entry.jobName}</Text>
                <Text style={styles.detailSecondary}>
                  {t('Stage', 'Etapa')}: {timesheetStageNamesById[String(entry.stageId ?? '')] || t('Not set', 'Sin definir')}
                </Text>
                <Text style={styles.detailSecondary}>{entry.hours} {t('hours', 'horas')}</Text>
                {entry.notes ? (
                  <Text style={styles.detailSecondary}>{entry.notes}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  )
}

export function ManagerSheetSection({
  t,
  locale,
  managerDate,
  onOpenManagerDatePicker,
  isManagerDatePickerOpen,
  selectedManagerDate,
  onManagerDateChange,
  isManagerLoading,
  managerRows,
  managerMessage,
  isManagerSaving,
  onManagerProgressChange,
  onSaveManagerProgress,
  onOpenManagerShopDrawingPreview,
}: {
  t: TranslateFn
  locale: string
  managerDate: string
  onOpenManagerDatePicker: () => void
  isManagerDatePickerOpen: boolean
  selectedManagerDate: Date
  onManagerDateChange: (event: DateTimePickerEvent, value?: Date) => void
  isManagerLoading: boolean
  managerRows: ManagerProgressRow[]
  managerMessage: string | null
  isManagerSaving: boolean
  onManagerProgressChange: (jobName: string, value: string) => void
  onSaveManagerProgress: () => void
  onOpenManagerShopDrawingPreview: (row: ManagerProgressRow) => void
}) {
  const [workersPopupRow, setWorkersPopupRow] = useState<ManagerProgressRow | null>(null)

  return (
    <>
      <Text style={styles.sectionTitle}>{t('Manager Sheet', 'Hoja de gerente')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Date defaults to today. Tap Date to open the calendar picker.',
          'La fecha por defecto es hoy. Toca Fecha para abrir el calendario.',
        )}
      </Text>

      <View style={styles.managerSheetCard}>
        <Pressable style={styles.timesheetDateButton} onPress={onOpenManagerDatePicker}>
          <Text style={styles.timesheetDateButtonText}>{t('Date', 'Fecha')}: {formatDisplayDate(managerDate, locale)}</Text>
          <Text style={styles.timesheetDateHint}>{managerDate}</Text>
        </Pressable>

        {isManagerDatePickerOpen ? (
          <View style={styles.timesheetDatePickerWrap}>
            <DateTimePicker
              value={selectedManagerDate}
              mode="date"
              display={Platform.OS === 'android' ? 'calendar' : 'default'}
              onChange={onManagerDateChange}
            />
          </View>
        ) : null}

        {isManagerLoading ? (
          <InlineLoading label={t('Loading manager sheet...', 'Cargando hoja de gerente...')} />
        ) : managerRows.length === 0 ? (
          <Text style={styles.emptyDetailText}>{t('No orders found for this date yet.', 'Aun no se encontraron ordenes para esta fecha.')}</Text>
        ) : (
          <View style={styles.managerProgressList}>
            {managerRows.map((row) => (
              <View key={row.jobName} style={styles.managerProgressRow}>
                <Text style={styles.managerProgressJob} numberOfLines={1}>
                  {t('Order #', 'Orden #')}{row.displayOrderNumber}
                </Text>
                <Text style={styles.managerProgressMeta} numberOfLines={2}>
                  {t('Item', 'Item')}: {row.mondayItemName || row.jobName}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.managerProgressMeta}>
                    {t('Shop Drawing', 'Shop Drawing')}:
                  </Text>
                  {row.shopDrawingCachedUrl || (row.shopDrawingUrl && row.mondayOrderId) ? (
                    <Pressable
                      onPress={() => onOpenManagerShopDrawingPreview(row)}
                      style={{
                        borderWidth: 1,
                        borderColor: '#8fa8f2',
                        borderRadius: 8,
                        backgroundColor: '#eef3ff',
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ color: '#234ebf', fontSize: 12, fontWeight: '700' }}>
                        {t('Preview', 'Vista previa')}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.managerProgressMeta}>{t('Not available', 'No disponible')}</Text>
                  )}
                </View>
                <Text style={styles.managerProgressMeta}>
                  {t('Hours', 'Horas')}: {row.totalHours.toFixed(2)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.managerProgressMeta}>{t('Workers', 'Trabajadores')}: </Text>
                  {row.workerCount > 0 ? (
                    <Pressable
                      onPress={() => setWorkersPopupRow(row)}
                    >
                      <Text
                        style={{
                          color: '#214fc5',
                          fontSize: 12,
                          fontWeight: '700',
                          textDecorationLine: 'underline',
                        }}
                      >
                        {row.workerCount}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.managerProgressMeta}>0</Text>
                  )}
                </View>
                <Text style={styles.managerProgressMeta}>
                  {t('Current ready', 'Listo actual')}: {row.savedReadyPercent.toFixed(1)}%
                </Text>
                <TextInput
                  value={row.editReadyPercent.toString()}
                  onChangeText={(value) => onManagerProgressChange(row.jobName, value)}
                  placeholder={t('Ready %', 'Listo %')}
                  placeholderTextColor="#6a7ea8"
                  keyboardType="decimal-pad"
                  style={styles.managerProgressInput}
                />
              </View>
            ))}
          </View>
        )}

        <AuthButton
          label={
            isManagerSaving
              ? t('Saving...', 'Guardando...')
              : t('Save Manager Progress', 'Guardar progreso de gerente')
          }
          onPress={onSaveManagerProgress}
          disabled={isManagerSaving || managerRows.length === 0}
        />

        {managerMessage ? <Text style={styles.managerSheetMessage}>{managerMessage}</Text> : null}
      </View>

      <Modal
        visible={Boolean(workersPopupRow)}
        transparent
        animationType="fade"
        onRequestClose={() => setWorkersPopupRow(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '60%' }]}> 
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>
                {workersPopupRow
                  ? `${t('Workers - Order #', 'Trabajadores - Orden #')}${workersPopupRow.displayOrderNumber}`
                  : t('Workers', 'Trabajadores')}
              </Text>
              <Pressable
                style={styles.detailCloseButton}
                onPress={() => setWorkersPopupRow(null)}
              >
                <Text style={styles.detailCloseButtonText}>{t('Close', 'Cerrar')}</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBodyContent}>
              {!workersPopupRow || workersPopupRow.workerHoursByWorker.length === 0 ? (
                <Text style={styles.emptyDetailText}>
                  {t('No workers found for this order.', 'No se encontraron trabajadores para esta orden.')}
                </Text>
              ) : (
                workersPopupRow.workerHoursByWorker.map((workerRow) => (
                  <View key={workerRow.workerId} style={styles.detailRow}>
                    <Text style={styles.detailPrimary}>{workerRow.workerName}</Text>
                    <Text style={styles.detailSecondary}>
                      {t('Hours', 'Horas')}: {workerRow.hours.toFixed(2)}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

export function AlertsSection({
  t,
  locale,
  isAlertsLoading,
  alerts,
  alertsMessage,
  onMarkAlertAsRead,
}: {
  t: TranslateFn
  locale: string
  isAlertsLoading: boolean
  alerts: MobileAlert[]
  alertsMessage: string | null
  onMarkAlertAsRead: (alertItem: MobileAlert) => void
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>{t('Notifications', 'Notificaciones')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Important updates from Admin will appear here and as push notifications.',
          'Las actualizaciones importantes de Admin apareceran aqui y como notificaciones push.',
        )}
      </Text>

      <View style={styles.alertsCard}>
        {isAlertsLoading ? (
          <InlineLoading label={t('Loading notifications...', 'Cargando notificaciones...')} />
        ) : alerts.length === 0 ? (
          <Text style={styles.emptyDetailText}>{t('No notifications yet.', 'Aun no hay notificaciones.')}</Text>
        ) : (
          <View style={styles.alertsList}>
            {alerts.map((alertItem) => {
              const isRead = Boolean(alertItem.isRead)

              return (
                <Pressable
                  key={alertItem.id}
                  style={[styles.alertRow, !isRead ? styles.alertRowUnread : null]}
                  onPress={() => {
                    if (!isRead) {
                      onMarkAlertAsRead(alertItem)
                    }
                  }}
                >
                  <View style={styles.alertHeaderRow}>
                    <Text style={styles.alertTitle}>{alertItem.title}</Text>
                    {!isRead ? (
                      <View style={styles.alertUnreadBadge}>
                        <Text style={styles.alertUnreadBadgeText}>{t('Unread', 'Sin leer')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.alertBody}>{alertItem.message}</Text>
                  <Text style={styles.alertMeta}>
                    {formatSyncTimestamp(alertItem.createdAt, locale)}
                    {alertItem.createdByEmail ? ` • ${alertItem.createdByEmail}` : ''}
                  </Text>
                  {!isRead ? (
                    <Text style={styles.alertTapHint}>
                      {t('Tap this notification to mark it as read.', 'Toca esta notificacion para marcarla como leida.')}
                    </Text>
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        )}

        {alertsMessage ? <Text style={styles.alertMessage}>{alertsMessage}</Text> : null}
      </View>
    </>
  )
}

export function SettingsOverviewSection({
  t,
  appVersionLabel,
  isNotificationsEnabled,
  settingsMenuItems,
  onSelectSettingsMenu,
}: {
  t: TranslateFn
  appVersionLabel: string
  isNotificationsEnabled: boolean
  settingsMenuItems: Array<{ id: SettingsMenuId; title: string; subtitle: string; status: string }>
  onSelectSettingsMenu: (id: SettingsMenuId) => void
}) {
  return (
    <>
      <View style={styles.settingsPageHero}>
        <Text style={styles.settingsPageTitle}>{t('Settings', 'Configuracion')}</Text>
        <Text style={styles.settingsPageSubtitle}>
          {t(
            'Everything for your app account, notifications, and updates in one organized page.',
            'Todo para tu cuenta, notificaciones y actualizaciones en una pagina organizada.',
          )}
        </Text>
        <View style={styles.settingsMetaRow}>
          <View style={styles.settingsMetaChip}>
            <Text style={styles.settingsMetaChipText}>{t('Version', 'Version')} {appVersionLabel}</Text>
          </View>
          <View style={styles.settingsMetaChip}>
            <Text style={styles.settingsMetaChipText}>
              {isNotificationsEnabled
                ? t('Push ready', 'Push listo')
                : t('Push blocked', 'Push bloqueado')}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.settingsMenuCard}>
        {settingsMenuItems.map((menuItem) => (
          <Pressable
            key={menuItem.id}
            style={({ pressed }) => [
              styles.settingsMenuRow,
              pressed ? styles.settingsMenuRowPressed : null,
            ]}
            onPress={() => onSelectSettingsMenu(menuItem.id)}
          >
            <View style={styles.settingsMenuTextBlock}>
              <Text style={styles.settingsMenuTitle}>{menuItem.title}</Text>
              <Text style={styles.settingsMenuSubtitle}>{menuItem.subtitle}</Text>
            </View>
            <View style={styles.settingsMenuMetaBlock}>
              <Text style={styles.settingsMenuStatus}>{menuItem.status}</Text>
              <Text style={styles.settingsMenuChevron}>›</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  )
}
