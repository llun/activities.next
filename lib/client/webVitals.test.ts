/**
 * @vitest-environment jsdom
 */
import { WEB_VITALS_PATH, sendWebVitalsReport } from './webVitals'

const report = {
  metrics: [
    {
      name: 'LCP' as const,
      value: 1800,
      rating: 'good' as const,
      navigationType: 'navigate' as const,
      route: '/' as const,
      device: 'desktop' as const
    }
  ]
}

const readBlob = (blob: Blob) => blob.text()

describe('sendWebVitalsReport', () => {
  const originalBeacon = navigator.sendBeacon
  const originalFetch = globalThis.fetch

  afterEach(() => {
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: originalBeacon
    })
    globalThis.fetch = originalFetch
  })

  const setBeacon = (value: unknown) =>
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value
    })

  it('sends the report as a JSON blob through a beacon', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    const fetchMock = vi.fn()
    setBeacon(beacon)
    globalThis.fetch = fetchMock

    sendWebVitalsReport(report)

    expect(beacon).toHaveBeenCalledTimes(1)
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe(WEB_VITALS_PATH)
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await readBlob(blob))).toEqual(report)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to a keepalive fetch when the beacon refuses the payload', () => {
    setBeacon(vi.fn().mockReturnValue(false))
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    globalThis.fetch = fetchMock

    sendWebVitalsReport(report)

    expect(fetchMock).toHaveBeenCalledWith(WEB_VITALS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      credentials: 'omit',
      keepalive: true
    })
  })

  it('falls back to fetch when beacons are not supported', () => {
    setBeacon(undefined)
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    globalThis.fetch = fetchMock

    sendWebVitalsReport(report)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected fetch', async () => {
    setBeacon(undefined)
    // A plain function: vi.fn()/spyOn would chain onto the returned promise
    // and mark the rejection handled, hiding a missing `.catch`.
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      expect(() => sendWebVitalsReport(report)).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('swallows a beacon that throws', () => {
    setBeacon(
      vi.fn(() => {
        throw new Error('blocked')
      })
    )
    globalThis.fetch = vi.fn()

    expect(() => sendWebVitalsReport(report)).not.toThrow()
  })

  it('does nothing when neither transport exists', () => {
    setBeacon(undefined)
    // @ts-expect-error simulating an environment without fetch
    globalThis.fetch = undefined

    expect(() => sendWebVitalsReport(report)).not.toThrow()
  })
})
