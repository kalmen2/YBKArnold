/**
 * Creates a simple in-memory TTL cache.
 * Entries are lazily evicted on next access — no background sweep needed
 * because the number of distinct keys is small and bounded in all call sites.
 */
export function createTtlCache() {
  const store = new Map()

  return {
    get(key) {
      const entry = store.get(key)
      if (!entry) return undefined
      if (Date.now() > entry.expiresAt) {
        store.delete(key)
        return undefined
      }
      return entry.value
    },

    set(key, value, ttlMs) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },

    delete(key) {
      store.delete(key)
    },

    deleteByPrefix(prefix) {
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key)
        }
      }
    },
  }
}
