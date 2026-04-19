import { firebaseAuth } from '../auth/firebase'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser

  if (!user) {
    return {}
  }

  const token = await user.getIdToken()
  return { Authorization: `Bearer ${token}` }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders()

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}
