import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef
} from 'react'

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Detects whether the browser natively supports the CSS `field-sizing: content`
 * property for auto-resizing form controls (Chrome 123+).
 */
export const supportsFieldSizing = (): boolean => {
  if (
    typeof window === 'undefined' ||
    typeof CSS === 'undefined' ||
    typeof CSS.supports !== 'function'
  ) {
    return false
  }
  return CSS.supports('field-sizing', 'content')
}

/**
 * Manages automatic vertical growth for a textarea element.
 *
 * When the browser supports native `field-sizing: content`, this hook is a no-op,
 * leaving sizing completely to CSS (`field-sizing-content`).
 *
 * In browsers without native support (such as Safari and Firefox), this hook
 * provides a measured-height fallback: it measures `scrollHeight` on mount,
 * value changes, input events, and container width changes, updating
 * `element.style.height` while preserving `scrollTop` and caret positioning.
 */
export const useAutoResizeTextarea = (
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string
): void => {
  const lastWidthRef = useRef<number>(-1)

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (supportsFieldSizing()) return

    const previousScrollTop = textarea.scrollTop
    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    if (scrollHeight > 0) {
      textarea.style.height = `${scrollHeight}px`
    }
    textarea.scrollTop = previousScrollTop
  }, [textareaRef])

  // Run on mount and whenever the controlled value changes (typing, paste, reset)
  useIsomorphicLayoutEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  useEffect(() => {
    if (supportsFieldSizing()) return

    const textarea = textareaRef.current
    if (!textarea) return

    // Initial measurement
    lastWidthRef.current = textarea.getBoundingClientRect().width
    adjustHeight()

    // Listen to immediate native input events (paste, cut, IME, typing)
    const onInput = () => {
      adjustHeight()
    }
    textarea.addEventListener('input', onInput)

    // Listen to window and visualViewport resize (e.g. mobile virtual keyboard, orientation)
    const onWindowResize = () => {
      adjustHeight()
    }
    window.addEventListener('resize', onWindowResize)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', onWindowResize)

    // Observe width changes (line wrapping) without looping on height updates
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width
          if (width > 0 && Math.abs(width - lastWidthRef.current) >= 0.5) {
            lastWidthRef.current = width
            adjustHeight()
          }
        }
      })
      observer.observe(textarea)
    }

    return () => {
      textarea.removeEventListener('input', onInput)
      window.removeEventListener('resize', onWindowResize)
      viewport?.removeEventListener('resize', onWindowResize)
      observer?.disconnect()
    }
  }, [adjustHeight, textareaRef])
}
