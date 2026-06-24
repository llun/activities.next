import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboard {
  /** True for `resetMs` after a successful copy, for transient UI feedback. */
  copied: boolean
  /** Copies `text`, then flips `copied` true → false after `resetMs`. */
  copy: (text: string) => Promise<void>
}

/**
 * Copy-to-clipboard with transient "Copied" feedback.
 *
 * The pending reset timer is tracked in a ref and cleared on unmount (and before
 * each new copy), so it can never call `setState` after the component has
 * unmounted. No-ops where `navigator.clipboard` is unavailable (insecure `http`
 * contexts and older browsers); callers should keep a manual-selection fallback.
 */
export const useCopyToClipboard = (resetMs = 1600): UseCopyToClipboard => {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = useCallback(
    async (text: string) => {
      if (!navigator.clipboard) return
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCopied(false), resetMs)
      } catch {
        // Clipboard access can be denied; the caller's selectable field remains.
      }
    },
    [resetMs]
  )

  return { copied, copy }
}
