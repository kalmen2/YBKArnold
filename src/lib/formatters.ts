import type { AppAuthRole, AppAuthUser } from '../auth/types'

const newJerseyTimeZone = 'America/New_York'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

export function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

export function formatDateTimeWithSeconds(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

export function formatDisplayDate(
  value: string | null | undefined,
  options: {
    emptyLabel?: string
    dateOnly?: boolean
  } = {},
): string {
  const { emptyLabel = '—', dateOnly = true } = options

  if (!value) {
    return emptyLabel
  }

  const parsed = new Date(dateOnly ? `${value}T00:00:00` : value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

export function formatCurrency(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatStatusLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function roleLabel(role: AppAuthRole): string {
  if (role === 'admin') return 'Admin'
  if (role === 'manager') return 'Manager'
  return 'Standard'
}

export function roleColor(role: AppAuthRole): 'default' | 'primary' | 'secondary' {
  if (role === 'admin') return 'secondary'
  if (role === 'manager') return 'primary'
  return 'default'
}

export function approvalLabel(user: AppAuthUser): string {
  return user.isApproved ? 'Approved' : 'Pending'
}

export function approvalColor(user: AppAuthUser): 'success' | 'warning' {
  return user.isApproved ? 'success' : 'warning'
}

export function formatLoginHours(user: AppAuthUser | null | undefined): string {
  if (
    !user?.hasLoginHoursRestriction ||
    user.accessStartHourUtc === null ||
    user.accessEndHourUtc === null
  ) {
    return 'Any time'
  }
  const timeZone = String(user.accessTimeZone ?? '').trim()
  const timeZoneLabel = timeZone === newJerseyTimeZone ? 'New Jersey (ET)' : 'UTC'
  return `${String(user.accessStartHourUtc).padStart(2, '0')}:00 - ${String(user.accessEndHourUtc).padStart(2, '0')}:00 ${timeZoneLabel}`
}
