import { Navigate, createBrowserRouter } from 'react-router-dom'
import { CrmDealersProvider } from '../features/crm/CrmDealersContext'
import {
  RequireAdminRoute,
  RequireManagerOrAdminRoute,
} from './RouteGuards'
import {
  AdminAlertsPage,
  AdminLogsPage,
  AdminUsersPage,
  AppLayout,
  CrmPage,
  DashboardPage,
  PicturesPage,
  QuickBooksPage,
  SalesPage,
  SupportPage,
  TimesheetPage,
  withRouteSuspense,
} from './RouteLazyPages'
import RouteErrorBoundary from './RouteErrorBoundary'

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
        path: 'workers',
        element: <Navigate to="/timesheet" replace />,
      },
      {
        path: 'quickbooks',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <QuickBooksPage />
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
        path: 'admin/logs',
        element: withRouteSuspense(
          <RequireAdminRoute>
            <AdminLogsPage />
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
    ],
  },
])
