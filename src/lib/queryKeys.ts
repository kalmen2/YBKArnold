/**
 * Central React Query key registry.
 * All useQuery calls must import keys from here — never use inline string arrays.
 * This ensures cross-page cache sharing is guaranteed and key mismatches are caught at compile time.
 */

export const QUERY_KEYS = {
  // Dashboard — shared by DashboardPage, PicturesPage, SupportPage
  dashboardBootstrap: ['dashboard', 'bootstrap'] as const,

  // Support — already on React Query, keys preserved as-is
  supportAlerts: ['support', 'alerts'] as const,
  supportAlertTickets: (limitPerBucket: number) =>
    ['support', 'alert-tickets', limitPerBucket] as const,
  supportTickets: (limit: number) => ['support', 'tickets', limit] as const,
  supportConversation: (ticketId: number) =>
    ['support', 'conversation', ticketId] as const,

  // CRM
  crmPageBootstrap: ['crm', 'page-bootstrap'] as const,
  crmDealers: ['crm', 'dealers'] as const,
  crmContacts: (opts: { limit: number; offset: number; search: string; dealerSourceId: string }) =>
    ['crm', 'contacts', opts.limit, opts.offset, opts.search, opts.dealerSourceId] as const,
  crmSalesReps: ['crm', 'sales-reps'] as const,

  // Timesheet — shared by TimesheetPage and WorkersPage
  timesheetBootstrap: ['timesheet', 'bootstrap'] as const,

  // QuickBooks — shared by QuickBooksPage and TimesheetPage
  quickbooksStatus: ['quickbooks', 'status'] as const,
  quickbooksOverview: ['quickbooks', 'overview'] as const,

  // Admin
  authBootstrap: ['auth', 'bootstrap'] as const,
  adminBootstrap: ['admin', 'bootstrap'] as const,
  authLogs: (limit: number) => ['auth', 'logs', limit] as const,

  // Pictures
  photosIndex: ['pictures', 'photos-index'] as const,
} as const
