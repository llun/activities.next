import { useEffect, useRef, useState } from 'react'

interface UseLoadMoreOnVisibleParams {
  // When false, the observer is not attached (e.g. there is nothing more to load).
  enabled?: boolean
  onLoadMore: () => void
}

/**
 * Infinite-scroll helper shared by the paginated timelines: observes a sentinel
 * element and invokes `onLoadMore` whenever it scrolls into view, while exposing
 * its visibility (used to toggle the scroll-to-top button).
 *
 * Returns a callback ref to attach to the sentinel. A callback ref (rather than a
 * plain `useRef`) is required because the sentinel is conditionally rendered:
 * storing the node in state re-runs the observer effect when the element mounts
 * or unmounts, which a ref mutation would not do.
 */
export const useLoadMoreOnVisible = ({
  enabled = true,
  onLoadMore
}: UseLoadMoreOnVisibleParams) => {
  const [loadMoreElement, setLoadMoreElement] = useState<HTMLDivElement | null>(
    null
  )
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState(false)

  // Keep the latest callback in a ref so the observer is recreated only when
  // `enabled` or the sentinel element changes — not on every render when a
  // caller passes an unmemoized onLoadMore.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    if (
      !enabled ||
      !loadMoreElement ||
      typeof IntersectionObserver === 'undefined'
    ) {
      // No active observer ⇒ the sentinel is not visible; reset so callers
      // (e.g. the scroll-to-top button) don't read a stale `true`.
      setIsLoadMoreVisible(false)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        setIsLoadMoreVisible(entry.isIntersecting)

        if (entry.isIntersecting) {
          onLoadMoreRef.current()
        }
      },
      {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
      }
    )

    observer.observe(loadMoreElement)

    return () => {
      observer.disconnect()
      setIsLoadMoreVisible(false)
    }
  }, [enabled, loadMoreElement])

  return { loadMoreRef: setLoadMoreElement, isLoadMoreVisible }
}
