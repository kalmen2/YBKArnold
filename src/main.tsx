import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CssBaseline, ThemeProvider } from '@mui/material'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import theme from './theme/theme.ts'

const dynamicImportReloadKey = 'ybk-last-dynamic-import-reload-at'

function shouldRecoverFromDynamicImportFailure(reason: unknown) {
  const message = (() => {
    if (typeof reason === 'string') {
      return reason
    }

    if (reason instanceof Error) {
      return reason.message || String(reason)
    }

    if (reason && typeof reason === 'object' && 'message' in reason) {
      const maybeMessage = (reason as { message?: unknown }).message

      if (typeof maybeMessage === 'string') {
        return maybeMessage
      }
    }

    return ''
  })()

  return /(Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed)/i.test(
    message,
  )
}

function reloadOnceForDynamicImportFailure() {
  const now = Date.now()
  const previous = Number(window.sessionStorage.getItem(dynamicImportReloadKey) || '0')

  if (Number.isFinite(previous) && now - previous < 60_000) {
    return
  }

  window.sessionStorage.setItem(dynamicImportReloadKey, String(now))
  window.location.reload()
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault()
    reloadOnceForDynamicImportFailure()
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!shouldRecoverFromDynamicImportFailure(event.reason)) {
      return
    }

    event.preventDefault()
    reloadOnceForDynamicImportFailure()
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data fresh for 5 minutes before background refetch
      staleTime: 5 * 60 * 1000,
      // Keep unused data in cache for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Don't retry on error more than once
      retry: 1,
      // Don't refetch when the window regains focus
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
