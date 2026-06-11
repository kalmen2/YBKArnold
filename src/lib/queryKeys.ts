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
  crmQuoteChats: (quoteId: string) => ['crm', 'quote-chats', quoteId] as const,
  crmQuotes: (opts: {
    limit: number
    status: string
    dealerSourceId: string
    quoteNumber: string
    search: string
    salesRep: string
    dealerState: string
    projectType: string
    lifecycle: string
  }) => [
    'crm',
    'quotes',
    opts.limit,
    opts.status,
    opts.dealerSourceId,
    opts.quoteNumber,
    opts.search,
    opts.salesRep,
    opts.dealerState,
    opts.projectType,
    opts.lifecycle,
  ] as const,
  crmOpportunityContacts: (dealerSourceId: string) =>
    ['crm', 'opportunities', 'contacts', dealerSourceId] as const,
  crmContacts: (opts: { limit: number; offset: number; search: string; dealerSourceId: string }) =>
    ['crm', 'contacts', opts.limit, opts.offset, opts.search, opts.dealerSourceId] as const,
  crmSalesReps: ['crm', 'sales-reps'] as const,
  crmDeletionQueue: (limit: number) => ['crm', 'deletion-queue', limit] as const,
  crmEngagementReadiness: (status: string, search: string, limit: number) =>
    ['crm', 'engagement-readiness', status, search, limit] as const,

  // Timesheet — shared by TimesheetPage and WorkersPage
  timesheetBootstrap: ['timesheet', 'bootstrap'] as const,

  // QuickBooks — shared by reports/timesheet and orders dialogs
  quickbooksStatus: ['quickbooks', 'status'] as const,
  quickbooksOverview: ['quickbooks', 'overview'] as const,
  quickbooksOverviewFull: ['quickbooks', 'overview', 'full'] as const,

  // Orders — Monday Orders/Shipped combined DB view (single cache; client filters shipped)
  ordersOverview: ['orders', 'overview'] as const,
  ordersJobDetails: (mondayItemId: string, jobNumber: string, orderName: string) =>
    ['orders', 'job-details', mondayItemId, jobNumber, orderName] as const,

  // Admin
  authBootstrap: ['auth', 'bootstrap'] as const,
  adminBootstrap: ['admin', 'bootstrap'] as const,
  adminIssues: ['admin', 'issues'] as const,
  visitorsSaved: (limit: number) => ['visitors', 'saved', limit] as const,
  visitorsRecent: (windowMinutes: number, limit: number) =>
    ['visitors', 'recent', windowMinutes, limit] as const,
  adminVisitorsHistory: (
    search: string,
    uid: string,
    usersLimit: number,
    entriesPerUser: number,
  ) =>
    ['admin', 'visitors', 'history', search, uid, usersLimit, entriesPerUser] as const,
  alertsMy: (limit: number) => ['alerts', 'my', limit] as const,
  authSignInLogs: (limit: number, signInsLimit: number) =>
    ['auth', 'sign-in-logs', limit, signInsLimit] as const,
  authSystemRunLogs: (limit: number) =>
    ['auth', 'system-run-logs', limit] as const,
  adminApiDocs: ['admin', 'api-docs'] as const,
  adminApiKeys: (limit: number) =>
    ['admin', 'api-keys', limit] as const,
  adminEmailGoogleStatus: ['admin', 'email', 'google', 'status'] as const,
  adminEmailMicrosoftStatus: ['admin', 'email', 'microsoft', 'status'] as const,
  adminEmailReviewSummary: ['admin', 'email', 'review', 'summary'] as const,
  adminEmailReviewList: (
    status: 'pending' | 'approved' | 'rejected' | 'all',
    provider: 'google' | 'microsoft' | 'all',
    limit: number,
    offset: number,
  ) => ['admin', 'email', 'review', 'list', status, provider, limit, offset] as const,
  adminSmsBridgeLogs: (limit: number) =>
    ['admin', 'sms-bridge', 'logs', limit] as const,

  // Pictures
  photosIndex: ['pictures', 'photos-index'] as const,

  // Purchasing
  purchasingItems: (search: string, page: number, pageSize: number, aiAssistKey = 0) =>
    ['purchasing', 'items', search, page, pageSize, aiAssistKey] as const,
  purchasingPoContext: ['purchasing', 'po-context'] as const,
  purchasingItemDetail: (itemKey: string) => ['purchasing', 'item', itemKey] as const,
  purchasingItemPhotos: (itemKey: string) => ['purchasing', 'item-photos', itemKey] as const,
} as const
