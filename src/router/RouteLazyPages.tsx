import { lazy, type ComponentType } from 'react'

const RECOVERABLE_LAZY_IMPORT_MESSAGE = 'Lazy route module missing default export (likely stale chunk during deploy).'

type LazyRouteModule<T extends ComponentType<object>> = {
	default: T
}

function lazyRoute<T extends ComponentType<object>>(loader: () => Promise<LazyRouteModule<T>>) {
	return lazy(async () => {
		const module = await loader()

		// During deploy rollovers, stale chunks can occasionally resolve without module data.
		if (!module || !module.default) {
			throw new Error(RECOVERABLE_LAZY_IMPORT_MESSAGE)
		}

		return module
	})
}

export const AppLayout = lazyRoute(() => import('../layout/AppLayout'))
export const DashboardPage = lazyRoute(() => import('../pages/DashboardPage'))
export const TimesheetPage = lazyRoute(() => import('../pages/TimesheetPage'))
export const SupportPage = lazyRoute(() => import('../pages/SupportPage'))
export const OrdersPage = lazyRoute(() => import('../pages/OrdersPage'))
export const ConfigPage = lazyRoute(() => import('../pages/ConfigPage'))
export const SalesNotificationsPage = lazyRoute(() => import('../pages/SalesNotificationsPage'))
export const TemplatesPage = lazyRoute(() => import('../pages/TemplatesPage'))
export const VisitorsPage = lazyRoute(() => import('../pages/VisitorsPage'))
export const AdminUsersPage = lazyRoute(() => import('../pages/AdminUsersPage'))
export const AdminSalesReviewPage = lazyRoute(() => import('../pages/AdminSalesReviewPage'))
export const AdminLogsPage = lazyRoute(() => import('../pages/AdminLogsPage'))
export const CrmDealersPage = lazyRoute(() => import('../pages/CrmDealersPage'))
export const CrmContactsPage = lazyRoute(() => import('../pages/CrmContactsPage'))
export const AiConfigPage = lazyRoute(() => import('../pages/AiConfigPage'))
export const AdminEmailWorkspacePage = lazyRoute(() => import('../pages/AdminEmailWorkspacePage'))
export const AdminAiCouncilPage = lazyRoute(() => import('../pages/AdminAiCouncilPage'))
export const AdminSettingsPage = lazyRoute(() => import('../pages/AdminSettingsPage'))
export const SalesPage = lazyRoute(() => import('../pages/SalesPage'))
export const PurchasingPage = lazyRoute(() => import('../pages/PurchasingPage'))
export const OperatingCostsPage = lazyRoute(() => import('../pages/OperatingCostsPage'))
export const ChatPage = lazyRoute(() => import('../pages/ChatPage'))
export const Public3dViewerPage = lazyRoute(() => import('../pages/Public3dViewerPage'))
