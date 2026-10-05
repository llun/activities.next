/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

import {
  FALLBACK_TIME_ZONE,
  readViewerTimeZone,
  useViewerTimeZone
} from './useViewerTimeZone'

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions

/**
 * Makes the browser's DEFAULT zone `zone`. The suite runs in UTC, so a format
 * that resolves to UTC is one built without an explicit zone; one built with
 * an explicit zone (as `canonicalTimeZone` does) keeps its real answer.
 */
const stubBrowserZone = (zone: string) => {
  let current = zone
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(
    function (this: Intl.DateTimeFormat) {
      const real = realResolvedOptions.call(this)
      return real.timeZone === 'UTC' ? { ...real, timeZone: current } : real
    }
  )
  return {
    set: (next: string) => {
      current = next
    }
  }
}

function ZoneProbe() {
  const zone = useViewerTimeZone()
  return <span>{zone ?? 'unknown'}</span>
}

describe('useViewerTimeZone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is unknown on the server, so nothing zone-dependent is rendered there', () => {
    expect(renderToString(<ZoneProbe />)).toBe('<span>unknown</span>')
  })

  it('reports the browser zone on the client', () => {
    stubBrowserZone('America/New_York')

    const { result } = renderHook(() => useViewerTimeZone())

    expect(result.current).toBe('America/New_York')
  })

  it('re-reads the zone when the page regains focus', () => {
    const browser = stubBrowserZone('Asia/Tokyo')
    const { result } = renderHook(() => useViewerTimeZone())
    expect(result.current).toBe('Asia/Tokyo')

    browser.set('Europe/Amsterdam')
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current).toBe('Europe/Amsterdam')
  })
})

describe('readViewerTimeZone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      description: 'a canonical zone as is',
      zone: 'Europe/Amsterdam',
      expected: 'Europe/Amsterdam'
    },
    {
      description: 'a zone in its canonical spelling',
      zone: 'europe/amsterdam',
      expected: 'Europe/Amsterdam'
    },
    {
      description: 'an offset form, which the routes reject, as UTC',
      zone: '+05:30',
      expected: FALLBACK_TIME_ZONE
    },
    {
      description: 'an unknown zone as UTC',
      zone: 'Not/AZone',
      expected: FALLBACK_TIME_ZONE
    },
    {
      description: 'an empty zone as UTC',
      zone: '',
      expected: FALLBACK_TIME_ZONE
    }
  ])('reads $description', ({ zone, expected }) => {
    stubBrowserZone(zone)

    expect(readViewerTimeZone()).toBe(expected)
  })
})
