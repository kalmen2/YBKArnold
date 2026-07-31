import { RouterProvider } from 'react-router-dom'
import AuthGate from './auth/AuthGate'
import { router } from './router/index'
import DiagnosticReportProvider from './features/diagnostics/DiagnosticReportProvider'

function App() {
  const isPublic3dViewer = window.location.pathname.startsWith('/3d/')

  if (isPublic3dViewer) {
    return <RouterProvider router={router} />
  }

  return (
    <AuthGate>
      <DiagnosticReportProvider>
        <RouterProvider router={router} />
      </DiagnosticReportProvider>
    </AuthGate>
  )
}

export default App
