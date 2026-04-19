import { Navigate, createBrowserRouter } from 'react-router-dom'
import {
  RequireAdminRoute,
  RequireManagerOrAdminRoute,
} from './RouteGuards'
import {
  AdminAlertsPage,
  AdminLogsPage,
  AdminUsersPage,
  AppLayout,
  CrmContactsPage,
  CrmDealersPage,
  CrmPage,
  DashboardPage,
  PicturesPage,
  QuickBooksPage,
  SupportPage,
  TimesheetPage,
  WorkersPage,
  withRouteSuspense,
} from './RouteLazyPages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: withRouteSuspense(<AppLayout />),
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
        element: withRouteSuspense(<TimesheetPage initialView="reports" />),
      },
      {
        path: 'workers',
        element: withRouteSuspense(<WorkersPage />),
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
          <RequireAdminRoute>
            <CrmPage />
          </RequireAdminRoute>,
        ),
      },
      {
        path: 'admin/crm/dealers',
        element: withRouteSuspense(<CrmDealersPage />),
      },
      {
        path: 'admin/crm/contacts',
        element: withRouteSuspense(<CrmContactsPage />),
      },
    ],
  },
])