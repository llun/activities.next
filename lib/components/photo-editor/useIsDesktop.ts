'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 768px)'

const subscribe = (callback: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', callback)
  return () => list.removeEventListener('change', callback)
}

const getSnapshot = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? true
    : window.matchMedia(QUERY).matches

/** True at the `md` breakpoint and up; true where `matchMedia` is missing. */
export const useIsDesktop = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => true)
