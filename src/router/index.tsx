import { Navigate, createBrowserRouter } from 'react-router-dom'
import {
  RequireAdminRoute,
} from './RouteGuards'
import {
  AdminApiPage,
  AdminAlertsPage,
  AdminSettingsPage,
  AppLayout,
  DashboardPage,
  OperatingCostsPage,
  OrdersPage,
  PicturesPage,
  PurchasingPage,
  TemplatesPage,
  SalesPage,
  SupportPage,
  TimesheetPage,
  VisitorsPage,
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
          <RequireAdminRoute>
            <TimesheetPage initialView="reports" />
          </RequireAdminRoute>,
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
        path: 'visitors',
        element: withRouteSuspense(<VisitorsPage />),
      },
      {
        path: 'workers',
        element: <Navigate to="/timesheet" replace />,
      },
      {
        path: 'quickbooks',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <Navigate to="/reports" replace />
          </RequireAdminRoute>,
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
      {
        path: 'operating-costs',
        element: <Navigate to="/admin/operating-costs" replace />,
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
        element: <Navigate to="/admin/settings?tab=users" replace />,
      },
      {
        path: 'admin/alerts',
        element: withRouteSuspense(<AdminAlertsPage />),
      },
      {
        path: 'admin/api',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminApiPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/operating-costs',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <OperatingCostsPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/issues',
        element: <Navigate to="/admin/alerts" replace />,
      },
      {
        path: 'admin/logs',
        element: <Navigate to="/admin/settings?tab=logs" replace />,
      },
      {
        path: 'admin/visitors',
        element: <Navigate to="/admin/settings?tab=visitors" replace />,
      },
      {
        path: 'admin/settings',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminSettingsPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/sales-review',
        element: <Navigate to="/admin/settings?tab=sales-review" replace />,
      },
      {
        path: 'admin/crm',
        element: <Navigate to="/sales?tab=dealers" replace />,
      },
      {
        path: 'admin/ai-config',
        element: <Navigate to="/admin/settings?tab=ai" replace />,
      },
    ],
  },
])
