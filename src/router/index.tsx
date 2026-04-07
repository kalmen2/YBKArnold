import { Navigate, createBrowserRouter } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import DashboardPage from '../pages/DashboardPage'
import SettingsPage from '../pages/SettingsPage'
import SupportPage from '../pages/SupportPage'
import TimesheetPage from '../pages/TimesheetPage'

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
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'support',
        element: <SupportPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
    ],
  },
])