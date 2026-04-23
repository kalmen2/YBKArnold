import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

function toErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message || String(error)
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message

    if (typeof maybeMessage === 'string') {
      return maybeMessage
    }
  }

  return 'Unknown error.'
}

function isDynamicImportFailure(message: string) {
  return /(Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed)/i.test(
    message,
  )
}

export default function RouteErrorBoundary() {
  const error = useRouteError()

  if (isRouteErrorResponse(error)) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <section style={{ width: '100%', maxWidth: 700 }}>
          <h1 style={{ margin: '0 0 8px' }}>Unexpected Application Error</h1>
          <p style={{ margin: '0 0 6px', color: '#4b5563' }}>
            {error.status} {error.statusText}
          </p>
          <p style={{ margin: 0, color: '#4b5563' }}>
            {typeof error.data === 'string' && error.data ? error.data : 'Please try again.'}
          </p>
        </section>
      </main>
    )
  }

  const message = toErrorMessage(error)
  const dynamicImportFailure = isDynamicImportFailure(message)

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <section style={{ width: '100%', maxWidth: 760 }}>
        <h1 style={{ margin: '0 0 8px' }}>
          {dynamicImportFailure ? 'App Updated - Reload Required' : 'Unexpected Application Error'}
        </h1>

        <p style={{ margin: '0 0 10px', color: '#4b5563' }}>
          {dynamicImportFailure
            ? 'A new app version was deployed while this tab was open. Reload to continue.'
            : 'Something went wrong while rendering this page.'}
        </p>

        <pre
          style={{
            margin: '0 0 16px',
            padding: 12,
            borderRadius: 8,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: '#1f2937',
          }}
        >
          {message}
        </pre>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              window.location.reload()
            }}
            style={{
              border: '1px solid #0f172a',
              background: '#0f172a',
              color: '#fff',
              borderRadius: 8,
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>

          <button
            type="button"
            onClick={() => {
              window.location.assign('/dashboard')
            }}
            style={{
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#0f172a',
              borderRadius: 8,
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            Go to Dashboard
          </button>
        </div>
      </section>
    </main>
  )
}