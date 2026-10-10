'use client'

import { useEffect, useState } from 'react'

/**
 * A number that goes up whenever the page's theme changes (the `.dark` class
 * or `data-theme` on the root element), so a colour resolved from a CSS token
 * can be resolved again. The editor has no provider of its own to ask.
 */
export const useThemeVersion = (): number => {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() =>
      setVersion((value) => value + 1)
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    })
    return () => observer.disconnect()
  }, [])
  return version
}
