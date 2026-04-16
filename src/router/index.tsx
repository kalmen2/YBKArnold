import { Navigate, createBrowserRouter } from 'react-router-dom'
import AdminAlertsPage from '../pages/AdminAlertsPage'
import AppLayout from '../layout/AppLayout'
import AdminLogsPage from '../pages/AdminLogsPage'
import CrmContactsPage from '../pages/CrmContactsPage'
import CrmDealersPage from '../pages/CrmDealersPage'
import CrmPage from '../pages/CrmPage'
import AdminUsersPage from '../pages/AdminUsersPage'
import DashboardPage from '../pages/DashboardPage'
import PicturesPage from '../pages/PicturesPage.tsx'
import SupportPage from '../pages/SupportPage'
import TimesheetPage from '../pages/TimesheetPage'
import WorkersPage from '../pages/WorkersPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/timesheet" replace />,
      },
      {
        path: 'timesheet',
        element: <TimesheetPage />,
      },
      {
        path: 'manager-progress',
        element: <TimesheetPage initialView="manager-progress" />,
      },
      {
        path: 'workers',
        element: <WorkersPage />,
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'support',
        element: <SupportPage />,
      },
      {
        path: 'pictures',
        element: <PicturesPage />,
      },
      {
        path: 'admin/users',
        element: <AdminUsersPage />,
      },
      {
        path: 'admin/alerts',
        element: <AdminAlertsPage />,
      },
      {
        path: 'admin/logs',
        element: <AdminLogsPage />,
      },
      {
        path: 'admin/crm',
        element: <CrmPage />,
      },
      {
        path: 'admin/crm/dealers',
        element: <CrmDealersPage />,
      },
      {
        path: 'admin/crm/contacts',
        element: <CrmContactsPage />,
      },
    ],
  },
])