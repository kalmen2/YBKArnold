import { Suspense, lazy, type ReactElement } from 'react'

export const AppLayout = lazy(() => import('../layout/AppLayout'))
export const DashboardPage = lazy(() => import('../pages/DashboardPage'))
export const TimesheetPage = lazy(() => import('../pages/TimesheetPage'))
export const QuickBooksPage = lazy(() => import('../pages/QuickBooksPage'))
export const SupportPage = lazy(() => import('../pages/SupportPage'))
export const PicturesPage = lazy(() => import('../pages/PicturesPage.tsx'))
export const AdminUsersPage = lazy(() => import('../pages/AdminUsersPage'))
export const AdminAlertsPage = lazy(() => import('../pages/AdminAlertsPage'))
export const AdminLogsPage = lazy(() => import('../pages/AdminLogsPage'))
export const CrmPage = lazy(() => import('../pages/CrmPage'))
export const CrmDealersPage = lazy(() => import('../pages/CrmDealersPage'))
export const CrmContactsPage = lazy(() => import('../pages/CrmContactsPage'))

const routeLoadingFallback = (
  <div
    style={{
      minHeight: '40vh',
      display: 'grid',
      placeItems: 'center',
      color: '#5f6b7a',
      fontSize: 14,
      fontWeight: 500,
    }}
  >
    Loading page...
  </div>
)

export function withRouteSuspense(element: ReactElement) {
  return <Suspense fallback={routeLoadingFallback}>{element}</Suspense>
}
