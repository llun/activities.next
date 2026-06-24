import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboard {
  /** True for `resetMs` after a successful copy, for transient UI feedback. */
  copied: boolean
  /** Copies `text`, then flips `copied` true → false after `resetMs`. */
  copy: (text: string) => Promise<void>
}

/**
 * Copies `text` to the clipboard, returning whether it succeeded.
 *
 * Prefers the async Clipboard API, but `navigator.clipboard` is unavailable in
 * insecure (`http`) contexts — which this project supports for self-hosted /
 * local deployments — so it falls back to a hidden-textarea + the legacy
 * `document.execCommand('copy')`. The same fallback also covers a denied
 * Clipboard API write.
 */
const writeToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy fallback below.
    }
  }

  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textArea)
    return ok
  } catch {
    return false
  }
}

/**
 * Copy-to-clipboard with transient "Copied" feedback.
 *
 * The pending reset timer is tracked in a ref and cleared on unmount (and before
 * each new copy), so it can never call `setState` after the component has
 * unmounted. Works over both HTTPS and insecure HTTP (see writeToClipboard).
 */
export const useCopyToClipboard = (resetMs = 1600): UseCopyToClipboard => {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timeoutRef.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      const ok = await writeToClipboard(text)
      // The write may be async, so the component can unmount while it is in
      // flight — skip the state update / timer if it did, or if it failed.
      if (!ok || !mountedRef.current) return
      setCopied(true)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), resetMs)
    },
    [resetMs]
  )

  return { copied, copy }
}
