import { Suspense, type ReactElement } from 'react'

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
