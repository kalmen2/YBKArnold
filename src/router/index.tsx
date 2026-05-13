import { Navigate, createBrowserRouter } from 'react-router-dom'
import { CrmDealersProvider } from '../features/crm/CrmDealersContext'
import {
  RequireAdminRoute,
  RequireManagerOrAdminRoute,
} from './RouteGuards'
import {
  AiConfigPage,
  AdminAlertsPage,
  AdminIssuesPage,
  AdminLogsPage,
  AdminSalesReviewPage,
  AdminUsersPage,
  AppLayout,
  CrmPage,
  DashboardPage,
  OrdersPage,
  PicturesPage,
  PurchasingPage,
  QuickBooksPage,
  TemplatesPage,
  SalesPage,
  SupportPage,
  TimesheetPage,
} from './RouteLazyPages'
import RouteErrorBoundary from './RouteErrorBoundary'
import { withRouteSuspense } from './withRouteSuspense'

export const router = createBrowserRouter([
  {
    path: '/',
    element: withRouteSuspense(<AppLayout />),
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'timesheet',
        element: withRouteSuspense(<TimesheetPage />),
      },
      {
        path: 'reports',
        element: withRouteSuspense(
          <RequireManagerOrAdminRoute>
            <TimesheetPage initialView="reports" />
          </RequireManagerOrAdminRoute>,
        ),
      },
      {
        path: 'orders',
        element: withRouteSuspense(<OrdersPage />),
      },
      {
        path: 'templates',
        element: withRouteSuspense(<TemplatesPage />),
      },
      {
        path: 'workers',
        element: <Navigate to="/timesheet" replace />,
      },
      {
        path: 'quickbooks',
        element: withRouteSuspense(
          <RequireManagerOrAdminRoute>
            <QuickBooksPage />
          </RequireManagerOrAdminRoute>,
        ),
      },
      {
        path: 'dashboard',
        element: withRouteSuspense(<DashboardPage />),
      },
      {
        path: 'support',
        element: withRouteSuspense(<SupportPage />),
      },
      {
        path: 'pictures',
        element: withRouteSuspense(<PicturesPage />),
      },
      {
        path: 'sales',
        element: withRouteSuspense(<SalesPage />),
      },
      {
        path: 'purchasing',
        element: withRouteSuspense(<PurchasingPage />),
      },
      // Redirect old individual routes to the unified Sales page
      {
        path: 'admin/crm/dealers',
        element: <Navigate to="/sales?tab=dealers" replace />,
      },
      {
        path: 'admin/crm/contacts',
        element: <Navigate to="/sales?tab=contacts" replace />,
      },
      {
        path: 'admin/users',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminUsersPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/alerts',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminAlertsPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/issues',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminIssuesPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/logs',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminLogsPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/sales-review',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminSalesReviewPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/crm',
        element: withRouteSuspense(
          <CrmDealersProvider>
            <RequireAdminRoute>
              <CrmPage />
            </RequireAdminRoute>
          </CrmDealersProvider>,
        ),
      },
      {
        path: 'admin/ai-config',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AiConfigPage />
          </RequireAdminRoute>,
        ),
      },
    ],
  },
])
