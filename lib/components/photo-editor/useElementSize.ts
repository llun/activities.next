'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

import type { Size } from '@/lib/services/medias/edit/geometry'

/** The content size of an element, kept up to date with a ResizeObserver. */
export const useElementSize = (
  ref: RefObject<HTMLElement | null>,
  /** False while the element is not rendered; measure again when it turns true. */
  active = true
): Size => {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const measure = (width: number, height: number) =>
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    const rect = element.getBoundingClientRect()
    measure(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, active])

  return size
}
