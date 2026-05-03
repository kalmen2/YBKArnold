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
  supportZendeskAgents: (limit: number) => ['support', 'zendesk-agents', limit] as const,
  supportConversation: (ticketId: number) =>
    ['support', 'conversation', ticketId] as const,

  // CRM
  crmPageBootstrap: ['crm', 'page-bootstrap'] as const,
  crmDealers: ['crm', 'dealers'] as const,
  crmOpportunitiesDealers: ['crm', 'opportunities', 'dealers'] as const,
  crmOpportunitiesQuotes: ['crm', 'opportunities', 'quotes'] as const,
  crmOpportunitiesOrders: ['crm', 'opportunities', 'orders'] as const,
  crmOpportunityContacts: (dealerSourceId: string) =>
    ['crm', 'opportunities', 'contacts', dealerSourceId] as const,
  crmContacts: (opts: { limit: number; offset: number; search: string; dealerSourceId: string }) =>
    ['crm', 'contacts', opts.limit, opts.offset, opts.search, opts.dealerSourceId] as const,
  crmSalesReps: ['crm', 'sales-reps'] as const,

  // Timesheet — shared by TimesheetPage and WorkersPage
  timesheetBootstrap: ['timesheet', 'bootstrap'] as const,

  // QuickBooks — shared by QuickBooksPage and TimesheetPage
  quickbooksStatus: ['quickbooks', 'status'] as const,
  quickbooksOverview: ['quickbooks', 'overview'] as const,

  // Orders — Monday Orders/Shipped combined DB view
  ordersOverview: (includeShipped: boolean) => ['orders', 'overview', includeShipped] as const,
  ordersLedgerOverview: (search: string, status: 'all' | 'shipped' | 'not_shipped') =>
    ['orders-ledger', 'overview', search, status] as const,

  // Admin
  authBootstrap: ['auth', 'bootstrap'] as const,
  adminBootstrap: ['admin', 'bootstrap'] as const,
  authSignInLogs: (limit: number, signInsLimit: number) =>
    ['auth', 'sign-in-logs', limit, signInsLimit] as const,
  authSystemRunLogs: (limit: number) =>
    ['auth', 'system-run-logs', limit] as const,

  // Pictures
  photosIndex: ['pictures', 'photos-index'] as const,

  // Purchasing
  purchasingItems: (search: string, page: number, pageSize: number, aiAssistKey = 0) =>
    ['purchasing', 'items', search, page, pageSize, aiAssistKey] as const,
  purchasingItemDetail: (itemKey: string) => ['purchasing', 'item', itemKey] as const,
  purchasingItemPhotos: (itemKey: string) => ['purchasing', 'item-photos', itemKey] as const,
} as const
