// Sizes an element to exactly the space left below it in the viewport.
// The chat page previously guessed with calc(100vh - 180px), which drifts
// whenever the toolbar or page padding changes and leaves the page scrolling
// by a few pixels. Measuring removes the guess.
import { useCallback, useEffect, useRef, useState } from 'react'

export function useFillViewportHeight({
  bottomGap = 24,
  minHeight = 420,
}: {
  bottomGap?: number
  minHeight?: number
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  const measure = useCallback(() => {
    const node = ref.current

    if (!node) {
      return
    }

    const top = node.getBoundingClientRect().top
    // visualViewport tracks the real visible area on mobile, where browser
    // chrome slides in and out and innerHeight lies.
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight

    setHeight(Math.max(minHeight, Math.round(viewportHeight - top - bottomGap)))
  }, [bottomGap, minHeight])

  useEffect(() => {
    // After paint, so the first measurement sees the final layout and the
    // effect body never sets state synchronously.
    const frameId = window.requestAnimationFrame(measure)

    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [measure])

  return { ref, height }
}
