import { Navigate, createBrowserRouter } from 'react-router-dom'
import {
  RequireAdminRoute,
} from './RouteGuards'
import {
  AdminApiPage,
  AdminEmailWorkspacePage,
  AdminSettingsPage,
  AppLayout,
  ConfigPage,
  DashboardPage,
  OperatingCostsPage,
  OrdersPage,
  PicturesPage,
  PurchasingPage,
  SalesNotificationsPage,
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
        element: <Navigate to="/config?tab=templates" replace />,
      },
      {
        path: 'visitors',
        element: <Navigate to="/config?tab=visitors" replace />,
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
        path: 'notifications',
        element: withRouteSuspense(<SalesNotificationsPage />),
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
        path: 'config',
        element: withRouteSuspense(<ConfigPage />),
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
        element: <Navigate to="/admin/settings?tab=notifications" replace />,
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
        element: <Navigate to="/admin/settings?tab=notifications" replace />,
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
        element: <Navigate to="/sales?tab=opportunities" replace />,
      },
      {
        path: 'admin/ai-config',
        element: <Navigate to="/admin/settings?tab=ai-config" replace />,
      },
      {
        path: 'admin/email',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminEmailWorkspacePage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/sms-bridge',
        element: <Navigate to="/admin/settings?tab=sms-bridge" replace />,
      },
    ],
  },
])
