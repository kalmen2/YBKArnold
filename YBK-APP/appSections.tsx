import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Picker } from '@react-native-picker/picker'
import { StatusBar } from 'expo-status-bar'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
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
  totalHours: number
  workerCount: number
  savedReadyPercent: number
  editReadyPercent: number
}

type ManagerCalendarDayCell = {
  date: string
  dayNumber: number
  hasOrders: boolean
  hasMissingProgress: boolean
  isSelected: boolean
}

function parseCalendarIsoDate(value: string) {
  const normalized = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)

  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

function formatCalendarIsoDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function monthStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
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
  managerDatesWithOrders,
  managerDatesMissingProgress,
  onSelectManagerDate,
  isManagerLoading,
  managerRows,
  managerMessage,
  isManagerSaving,
  onManagerProgressChange,
  onSaveManagerProgress,
}: {
  t: TranslateFn
  locale: string
  managerDate: string
  managerDatesWithOrders: string[]
  managerDatesMissingProgress: string[]
  onSelectManagerDate: (value: string) => void
  isManagerLoading: boolean
  managerRows: ManagerProgressRow[]
  managerMessage: string | null
  isManagerSaving: boolean
  onManagerProgressChange: (jobName: string, value: string) => void
  onSaveManagerProgress: () => void
}) {
  const resolvedSelectedDate = useMemo(
    () => parseCalendarIsoDate(managerDate) ?? new Date(),
    [managerDate],
  )
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(resolvedSelectedDate))

  useEffect(() => {
    setVisibleMonth(monthStart(resolvedSelectedDate))
  }, [resolvedSelectedDate])

  const managerOrderDateSet = useMemo(
    () => new Set(managerDatesWithOrders),
    [managerDatesWithOrders],
  )
  const managerMissingDateSet = useMemo(
    () => new Set(managerDatesMissingProgress),
    [managerDatesMissingProgress],
  )

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(visibleMonth),
    [locale, visibleMonth],
  )

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })

    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 7 + index)))
  }, [locale])

  const managerCalendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear()
    const month = visibleMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<ManagerCalendarDayCell | null> = []

    for (let index = 0; index < firstDay.getDay(); index += 1) {
      cells.push(null)
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cellDate = formatCalendarIsoDate(new Date(year, month, day))

      cells.push({
        date: cellDate,
        dayNumber: day,
        hasOrders: managerOrderDateSet.has(cellDate),
        hasMissingProgress: managerMissingDateSet.has(cellDate),
        isSelected: managerDate.trim() === cellDate,
      })
    }

    const fullGridCellCount = Math.ceil(cells.length / 7) * 7

    while (cells.length < fullGridCellCount) {
      cells.push(null)
    }

    return cells
  }, [managerDate, managerMissingDateSet, managerOrderDateSet, visibleMonth])

  return (
    <>
      <Text style={styles.sectionTitle}>{t('Manager Sheet', 'Hoja de gerente')}</Text>
      <Text style={styles.sectionSubtitle}>
        {t(
          'Only dates with orders can be selected. Red bubble means missing manager progress.',
          'Solo se pueden seleccionar fechas con ordenes. Burbuja roja significa progreso de gerente faltante.',
        )}
      </Text>

      <View style={styles.managerSheetCard}>
        <View style={styles.timesheetDateButton}>
          <Text style={styles.timesheetDateButtonText}>{t('Date', 'Fecha')}: {formatDisplayDate(managerDate, locale)}</Text>
          <Text style={styles.timesheetDateHint}>{managerDate}</Text>
        </View>

        <View style={styles.managerCalendarHeader}>
          <Pressable
            style={styles.managerCalendarNavButton}
            onPress={() => {
              setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
            }}
          >
            <Text style={styles.managerCalendarNavButtonText}>{t('Prev', 'Anterior')}</Text>
          </Pressable>

          <Text style={styles.managerCalendarMonthLabel}>{monthLabel}</Text>

          <Pressable
            style={styles.managerCalendarNavButton}
            onPress={() => {
              setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
            }}
          >
            <Text style={styles.managerCalendarNavButtonText}>{t('Next', 'Siguiente')}</Text>
          </Pressable>
        </View>

        <View style={styles.managerCalendarWeekRow}>
          {weekdayLabels.map((label, index) => (
            <Text key={`${label}-${index}`} style={styles.managerCalendarWeekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.managerCalendarGrid}>
          {managerCalendarCells.map((cell, index) => {
            if (!cell) {
              return <View key={`blank-${index}`} style={styles.managerCalendarBlankCell} />
            }

            const isDisabled = !cell.hasOrders

            return (
              <Pressable
                key={cell.date}
                style={({ pressed }) => [
                  styles.managerCalendarDayCell,
                  isDisabled ? styles.managerCalendarDayCellDisabled : null,
                  cell.isSelected ? styles.managerCalendarDayCellSelected : null,
                  pressed && !isDisabled ? styles.managerCalendarDayCellPressed : null,
                ]}
                onPress={() => onSelectManagerDate(cell.date)}
                disabled={isDisabled}
              >
                {cell.hasMissingProgress ? <View style={styles.managerCalendarMissingBubble} /> : null}
                <Text
                  style={[
                    styles.managerCalendarDayLabel,
                    isDisabled ? styles.managerCalendarDayLabelDisabled : null,
                    cell.isSelected ? styles.managerCalendarDayLabelSelected : null,
                  ]}
                >
                  {cell.dayNumber}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.managerCalendarLegend}>
          {t(
            'White days have no orders and cannot be clicked. Red bubble means manager progress is missing.',
            'Los dias blancos no tienen ordenes y no se pueden tocar. La burbuja roja significa que falta progreso de gerente.',
          )}
        </Text>

        {managerDatesWithOrders.length === 0 ? (
          <Text style={styles.managerCalendarEmptyText}>
            {t('No order dates are available yet.', 'Aun no hay fechas con ordenes disponibles.')}
          </Text>
        ) : null}

        {isManagerLoading ? (
          <InlineLoading label={t('Loading manager sheet...', 'Cargando hoja de gerente...')} />
        ) : managerRows.length === 0 ? (
          <Text style={styles.emptyDetailText}>{t('No orders found for this date yet.', 'Aun no se encontraron ordenes para esta fecha.')}</Text>
        ) : (
          <View style={styles.managerProgressList}>
            {managerRows.map((row) => (
              <View key={row.jobName} style={styles.managerProgressRow}>
                <Text style={styles.managerProgressJob} numberOfLines={1}>{row.jobName}</Text>
                <Text style={styles.managerProgressMeta}>
                  {t('Hours', 'Horas')}: {row.totalHours.toFixed(2)} • {t('Workers', 'Trabajadores')}: {row.workerCount}
                </Text>
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
    </>
  )
}

export function AlertsSection({
  t,
  locale,
  isAlertsLoading,
  alerts,
  alertsMessage,
  resolveAlertLink,
  onMarkAlertAsRead,
  onOpenAlertLink,
}: {
  t: TranslateFn
  locale: string
  isAlertsLoading: boolean
  alerts: MobileAlert[]
  alertsMessage: string | null
  resolveAlertLink: (alertItem: MobileAlert) => string | null
  onMarkAlertAsRead: (alertItem: MobileAlert) => void
  onOpenAlertLink: (url: string, alertItem?: MobileAlert) => void
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
              const alertLink = resolveAlertLink(alertItem)
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
                  {alertLink ? (
                    <Pressable
                      style={styles.alertLinkButton}
                      onPress={() => {
                        onOpenAlertLink(alertLink, alertItem)
                      }}
                    >
                      <Text style={styles.alertLinkButtonText}>
                        {t('Open update link', 'Abrir enlace de actualizacion')}
                      </Text>
                    </Pressable>
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
