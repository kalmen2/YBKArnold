import { RouterProvider } from 'react-router-dom'
import AuthGate from './auth/AuthGate'
import { router } from './router/index'

function App() {
  const isPublic3dViewer = window.location.pathname.startsWith('/3d/')

  if (isPublic3dViewer) {
    return <RouterProvider router={router} />
  }

  return (
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  )
}

export default App
