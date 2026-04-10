import { Navigate, createBrowserRouter } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import AdminLogsPage from '../pages/AdminLogsPage'
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
        path: 'admin/logs',
        element: <AdminLogsPage />,
      },
    ],
  },
])