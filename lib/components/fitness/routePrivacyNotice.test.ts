/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ROUTE_PRIVACY_NOTICE_STORAGE_KEY,
  dismissRoutePrivacyNotice,
  isRoutePrivacyNoticeDismissed
} from '@/lib/components/fitness/routePrivacyNotice'

describe('routePrivacyNotice', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reports not dismissed when nothing is stored', () => {
    expect(isRoutePrivacyNoticeDismissed()).toBe(false)
  })

  it('remembers the dismissal for later reads', () => {
    dismissRoutePrivacyNotice()

    expect(window.localStorage.getItem(ROUTE_PRIVACY_NOTICE_STORAGE_KEY)).toBe(
      'true'
    )
    expect(isRoutePrivacyNoticeDismissed()).toBe(true)
  })

  it.each([
    { description: 'an unrelated value', stored: 'maybe' },
    { description: 'the false string', stored: 'false' },
    { description: 'an empty value', stored: '' }
  ])('reports not dismissed for $description', ({ stored }) => {
    window.localStorage.setItem(ROUTE_PRIVACY_NOTICE_STORAGE_KEY, stored)

    expect(isRoutePrivacyNoticeDismissed()).toBe(false)
  })

  it('reports not dismissed when storage access throws', () => {
    // Private modes and sandboxed iframes throw on access rather than returning
    // null; the notice degrades to non-persistent instead of crashing the map.
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    expect(isRoutePrivacyNoticeDismissed()).toBe(false)
  })

  it('swallows a storage write failure', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => dismissRoutePrivacyNotice()).not.toThrow()
  })
})
