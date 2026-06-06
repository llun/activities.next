import { useEffect, useRef, useState } from 'react'

interface UseLoadMoreOnVisibleParams {
  // When false, the observer is not attached (e.g. there is nothing more to load).
  enabled?: boolean
  onLoadMore: () => void
}

/**
 * Infinite-scroll helper shared by the paginated timelines: observes a sentinel
 * element and invokes `onLoadMore` whenever it scrolls into view, while exposing
 * its visibility (used to toggle the scroll-to-top button). Returns the ref to
 * attach to the sentinel.
 */
export const useLoadMoreOnVisible = ({
  enabled = true,
  onLoadMore
}: UseLoadMoreOnVisibleParams) => {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [isLoadMoreVisible, setIsLoadMoreVisible] = useState(false)

  // Keep the latest callback in a ref so the observer is created only when
  // `enabled` changes — not on every render when a caller passes an
  // unmemoized onLoadMore.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    if (!enabled) return

    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement || typeof IntersectionObserver === 'undefined') return

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
    }
  }, [enabled])

  return { loadMoreRef, isLoadMoreVisible }
}
