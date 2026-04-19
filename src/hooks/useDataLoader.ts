import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'

type Options<T> = {
  fetcher: () => Promise<T>
  onSuccess: (data: T) => void
  onError?: (error: Error) => void
  fallbackErrorMessage?: string
}

type Result = {
  isLoading: boolean
  isRefreshing: boolean
  errorMessage: string | null
  load: (refresh?: boolean) => void
  setErrorMessage: Dispatch<SetStateAction<string | null>>
}

export function useDataLoader<T>({
  fetcher,
  onSuccess,
  onError,
  fallbackErrorMessage = 'Failed to load data.',
}: Options<T>): Result {
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setErrorMessage(null)
      if (refresh) {
        setIsRefreshing(true)
      } else {
        setIsLoading(true)
      }
      try {
        const data = await fetcher()
        onSuccess(data)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(fallbackErrorMessage)
        setErrorMessage(err.message)
        onError?.(err)
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetcher, onSuccess, onError, fallbackErrorMessage],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(false), 0)
    return () => window.clearTimeout(timeoutId)
  }, [load])

  return { isLoading, isRefreshing, errorMessage, load, setErrorMessage }
}
