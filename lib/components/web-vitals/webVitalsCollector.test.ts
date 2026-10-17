/**
 * @vitest-environment jsdom
 */
import type { WebVitalsReport } from '@/lib/utils/webVitals/types'

import {
  WEB_VITALS_MAX_METRICS_PER_PAGE_LOAD,
  type WebVitalsMetricInput,
  createWebVitalsCollector
} from './webVitalsCollector'

const metric = (
  overrides: Partial<WebVitalsMetricInput> = {}
): WebVitalsMetricInput => ({
  id: 'v5-1',
  name: 'LCP',
  value: 1800.4,
  rating: 'good',
  navigationType: 'navigate',
  navigationURL: 'https://test.llun.dev/@alice@example.com/0190abcd',
  ...overrides
})

const setup = (viewportWidth = 1280, pathname = '/') => {
  const sent: WebVitalsReport[] = []
  const collector = createWebVitalsCollector({
    send: (report) => sent.push(report),
    getViewportWidth: () => viewportWidth,
    getPathname: () => pathname
  })
  return { sent, collector }
}

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  })

describe('createWebVitalsCollector', () => {
  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  it('sends the allowlisted fields only, with the route template and a rounded value', () => {
    const { sent, collector } = setup(390)

    collector.record(metric())
    collector.flush()

    expect(sent).toEqual([
      {
        metrics: [
          {
            name: 'LCP',
            value: 1800,
            rating: 'good',
            navigationType: 'navigate',
            route: '/[actor]/[status]',
            device: 'mobile'
          }
        ]
      }
    ])
    const text = JSON.stringify(sent)
    expect(text).not.toContain('alice')
    expect(text).not.toContain('0190abcd')
    expect(text).not.toContain('v5-1')
  })

  it('ignores everything else on the metric', () => {
    const { sent, collector } = setup()

    collector.record({
      ...metric(),
      entries: [{ element: '#secret', url: 'https://x.test/?token=1' }],
      attribution: { element: 'div.secret' }
    } as WebVitalsMetricInput)
    collector.flush()

    expect(Object.keys(sent[0].metrics[0]).sort()).toEqual([
      'device',
      'name',
      'navigationType',
      'rating',
      'route',
      'value'
    ])
    expect(JSON.stringify(sent)).not.toMatch(/secret|token/)
  })

  it('rounds CLS to three decimals', () => {
    const { sent, collector } = setup()

    collector.record(metric({ id: 'c', name: 'CLS', value: 0.123456 }))
    collector.flush()

    expect(sent[0].metrics[0].value).toBe(0.123)
  })

  it.each([['TTFB'], ['FCP'], ['Next.js-hydration']])('ignores %s', (name) => {
    const { sent, collector } = setup()

    collector.record(metric({ name }))
    collector.flush()

    expect(sent).toEqual([])
  })

  it.each([
    ['a missing rating', { rating: undefined }],
    ['an unknown rating', { rating: 'meh' }],
    ['NaN', { value: Number.NaN }],
    ['a negative value', { value: -1 }],
    ['an LCP past its limit', { value: 120_001 }],
    ['a CLS past its limit', { name: 'CLS', value: 11 }]
  ])('skips a metric with %s', (_, overrides) => {
    const { sent, collector } = setup()

    collector.record(metric(overrides))
    collector.flush()

    expect(sent).toEqual([])
  })

  it('keeps the latest value per metric id', () => {
    const { sent, collector } = setup()

    collector.record(metric({ id: 'a', value: 100 }))
    collector.record(metric({ id: 'a', value: 250 }))
    collector.flush()

    expect(sent).toHaveLength(1)
    expect(sent[0].metrics.map((m) => m.value)).toEqual([250])
  })

  it('sends a metric id once, even when it changes after the flush', () => {
    const { sent, collector } = setup()

    collector.record(metric({ id: 'a', value: 100 }))
    collector.flush()
    collector.record(metric({ id: 'a', value: 900 }))
    collector.flush()

    expect(sent).toHaveLength(1)
  })

  it('sends nothing when there is nothing to send', () => {
    const { sent, collector } = setup()

    collector.flush()

    expect(sent).toEqual([])
  })

  it('maps each soft navigation to its own route and navigation type', () => {
    const { sent, collector } = setup(1280, '/')

    collector.record(metric({ id: 'a', navigationURL: 'https://t.dev/' }))
    collector.record(
      metric({
        id: 'b',
        name: 'INP',
        navigationType: 'soft-navigation',
        navigationURL: 'https://t.dev/tags/secret-tag?q=1#x'
      })
    )
    collector.flush()

    expect(sent[0].metrics.map((m) => [m.route, m.navigationType])).toEqual([
      ['/', 'navigate'],
      ['/tags/[tag]', 'soft-navigation']
    ])
    expect(JSON.stringify(sent)).not.toContain('secret-tag')
  })

  it('uses the pathname the page loaded on when the metric has no URL', () => {
    const { sent, collector } = setup(1280, '/search')
    const stop = collector.start()

    collector.record(metric({ navigationURL: undefined }))
    collector.flush()
    stop()

    expect(sent[0].metrics[0].route).toBe('/search')
  })

  it('falls back to other for an unparseable navigation URL path', () => {
    const { sent, collector } = setup()

    collector.record(metric({ navigationURL: 'http://[bad' }))
    collector.flush()

    expect(sent[0].metrics[0].route).toBe('/')
  })

  it('maps an unknown navigation type to other', () => {
    const { sent, collector } = setup()

    collector.record(metric({ navigationType: 'teleport' }))
    collector.flush()

    expect(sent[0].metrics[0].navigationType).toBe('other')
  })

  it('splits a long queue into reports of at most six metrics', () => {
    const { sent, collector } = setup()

    for (let i = 0; i < 13; i += 1) collector.record(metric({ id: `m${i}` }))
    collector.flush()

    expect(sent.map((report) => report.metrics.length)).toEqual([6, 6, 1])
  })

  it('stops collecting past the per-page-load cap', () => {
    const { sent, collector } = setup()

    for (let i = 0; i < WEB_VITALS_MAX_METRICS_PER_PAGE_LOAD + 10; i += 1) {
      collector.record(metric({ id: `m${i}` }))
    }
    collector.flush()
    collector.record(metric({ id: 'late' }))
    collector.flush()

    const total = sent.reduce((sum, report) => sum + report.metrics.length, 0)
    expect(total).toBe(WEB_VITALS_MAX_METRICS_PER_PAGE_LOAD)
  })

  it('never throws into the page when sending fails', () => {
    const collector = createWebVitalsCollector({
      send: () => {
        throw new Error('boom')
      },
      getViewportWidth: () => 1280,
      getPathname: () => '/'
    })

    collector.record(metric())
    expect(() => collector.flush()).not.toThrow()
  })

  describe('start', () => {
    it('flushes when the page is hidden, and once more after the event', () => {
      vi.useFakeTimers()
      const { sent, collector } = setup()
      const stop = collector.start()

      collector.record(metric({ id: 'a' }))
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      // Web-vitals' own listener can run after the collector's.
      collector.record(metric({ id: 'b', name: 'CLS', value: 0.05 }))
      vi.runAllTimers()
      stop()

      expect(sent.map((report) => report.metrics.map((m) => m.name))).toEqual([
        ['LCP'],
        ['CLS']
      ])
    })

    it('does not flush while the page stays visible', () => {
      vi.useFakeTimers()
      const { sent, collector } = setup()
      const stop = collector.start()

      collector.record(metric())
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.runAllTimers()
      stop()

      expect(sent).toEqual([])
    })

    it('flushes on pagehide', () => {
      const { sent, collector } = setup()
      const stop = collector.start()

      collector.record(metric())
      window.dispatchEvent(new Event('pagehide'))
      stop()

      expect(sent).toHaveLength(1)
    })

    it('sends a metric once when the page is hidden and then unloaded', () => {
      vi.useFakeTimers()
      const { sent, collector } = setup()
      const stop = collector.start()

      collector.record(metric())
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
      vi.runAllTimers()
      stop()

      expect(sent).toHaveLength(1)
    })

    it('stops listening once cleaned up', () => {
      const { sent, collector } = setup()
      const stop = collector.start()
      stop()

      collector.record(metric())
      window.dispatchEvent(new Event('pagehide'))

      expect(sent).toEqual([])
    })
  })
})
