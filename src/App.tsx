import { RouterProvider } from 'react-router-dom'
import AuthGate from './auth/AuthGate'
import { router } from './router/index'
import DiagnosticReportProvider from './features/diagnostics/DiagnosticReportProvider'

function App() {
  return (
    <AuthGate>
      <DiagnosticReportProvider>
        <RouterProvider router={router} />
      </DiagnosticReportProvider>
    </AuthGate>
  )
}

export default App
