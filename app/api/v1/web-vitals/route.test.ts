import { NextRequest } from 'next/server'

import { TEST_DOMAIN } from '@/lib/stub/const'
import { VERSION } from '@/lib/utils/version'

// Shared between the mock factories and the tests: the route keeps its
// per-minute counter in module state, so tests reload it with
// `vi.resetModules()`, which would otherwise hand the fresh module new mocks.
const mocks = vi.hoisted(() => ({
  config: { sampleRate: 0.1, maxReportsPerMinute: 600 },
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://test.llun.dev',
  getConfig: () => ({ host: 'test.llun.dev', secretPhase: 'test-secret' }),
  getWebVitalsConfig: () => mocks.config
}))

const logger = { info: mocks.info, warn: mocks.warn }

const ORIGIN = `https://${TEST_DOMAIN}`

const metric = (overrides: Record<string, unknown> = {}) => ({
  name: 'LCP',
  value: 1800,
  rating: 'good',
  navigationType: 'navigate',
  route: '/[actor]/[status]',
  device: 'mobile',
  ...overrides
})

const request = (
  body: unknown,
  headers: Record<string, string> = { Origin: ORIGIN }
) =>
  new NextRequest(`${ORIGIN}/api/v1/web-vitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

let POST: typeof import('./route').POST

const post = (body: unknown, headers?: Record<string, string>) =>
  POST(request(body, headers))

const enable = (config: {
  sampleRate?: number
  maxReportsPerMinute?: number
}) => {
  mocks.config = { sampleRate: 0.1, maxReportsPerMinute: 600, ...config }
}

describe('POST /api/v1/web-vitals', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.info.mockClear()
    mocks.warn.mockClear()
    enable({})
    ;({ POST } = await import('./route'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not found while reporting is off', async () => {
    enable({ sampleRate: 0 })

    const response = await post({ metrics: [metric()] })

    expect(response.status).toBe(404)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('logs one allowlisted line per metric and accepts the report', async () => {
    const response = await post({
      metrics: [
        metric(),
        metric({ name: 'CLS', value: 0.123, rating: 'good', route: '/' }),
        metric({
          name: 'INP',
          value: 350,
          rating: 'needs-improvement',
          navigationType: 'soft-navigation',
          route: '/settings/*',
          device: 'desktop'
        })
      ]
    })

    expect(response.status).toBe(202)
    expect(logger.info).toHaveBeenCalledTimes(3)
    expect(mocks.info.mock.calls).toEqual([
      [
        {
          message: 'web-vitals',
          webVitals: {
            name: 'LCP',
            value: 1800,
            rating: 'good',
            route: '/[actor]/[status]',
            device: 'mobile',
            navigationType: 'navigate'
          },
          release: VERSION
        }
      ],
      [
        {
          message: 'web-vitals',
          webVitals: {
            name: 'CLS',
            value: 0.123,
            rating: 'good',
            route: '/',
            device: 'mobile',
            navigationType: 'navigate'
          },
          release: VERSION
        }
      ],
      [
        {
          message: 'web-vitals',
          webVitals: {
            name: 'INP',
            value: 350,
            rating: 'needs-improvement',
            route: '/settings/*',
            device: 'desktop',
            navigationType: 'soft-navigation'
          },
          release: VERSION
        }
      ]
    ])
  })

  it('accepts a beacon that only carries a Referer on this origin', async () => {
    const response = await post(
      { metrics: [metric()] },
      { Referer: `${ORIGIN}/` }
    )

    expect(response.status).toBe(202)
  })

  it.each([
    ['a foreign Origin', { Origin: 'https://evil.example' }],
    ['no Origin or Referer', {}]
  ])('rejects %s without logging', async (_, headers) => {
    const response = await post({ metrics: [metric()] }, headers)

    expect(response.status).toBe(403)
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('rejects a body over the size cap', async () => {
    const response = await post({
      metrics: [metric()],
      padding: 'x'.repeat(4096)
    })

    expect(response.status).toBe(413)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('rejects an oversize body that declares no length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(4096)))
        controller.close()
      }
    })
    const req = new NextRequest(`${ORIGIN}/api/v1/web-vitals`, {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: stream,
      duplex: 'half'
    } as ConstructorParameters<typeof NextRequest>[1])

    expect((await POST(req)).status).toBe(413)
  })

  it('rejects a body that is not JSON', async () => {
    expect((await post('{not json')).status).toBe(400)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it.each([
    ['no metrics', { metrics: [] }],
    ['no metrics key', {}],
    ['a bare array', [metric()]],
    ['seven metrics', { metrics: Array.from({ length: 7 }, () => metric()) }],
    ['an unknown metric name', { metrics: [metric({ name: 'TTFB' })] }],
    [
      'a raw pathname as the route',
      { metrics: [metric({ route: '/@a@b.c/123' })] }
    ],
    ['an unknown device', { metrics: [metric({ device: 'watch' })] }],
    ['an unknown rating', { metrics: [metric({ rating: 'meh' })] }],
    [
      'an unknown navigation type',
      { metrics: [metric({ navigationType: 'x' })] }
    ],
    ['a negative value', { metrics: [metric({ value: -1 })] }],
    ['a string value', { metrics: [metric({ value: '12' })] }],
    ['an LCP over 120000', { metrics: [metric({ value: 120_001 })] }],
    [
      'an INP over 60000',
      { metrics: [metric({ name: 'INP', value: 60_001 })] }
    ],
    ['a CLS over 10', { metrics: [metric({ name: 'CLS', value: 10.5 })] }],
    [
      'an extra field on a metric',
      { metrics: [metric({ url: 'https://x.test/?q=1' })] }
    ],
    ['an extra field on the report', { metrics: [metric()], userAgent: 'x' }]
  ])('rejects %s', async (_, body) => {
    const response = await post(body)

    expect(response.status).toBe(422)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('accepts a value exactly at its limit', async () => {
    const response = await post({
      metrics: [
        metric({ value: 120_000 }),
        metric({ name: 'INP', value: 60_000 }),
        metric({ name: 'CLS', value: 10 }),
        metric({ value: 0 })
      ]
    })

    expect(response.status).toBe(202)
    expect(logger.info).toHaveBeenCalledTimes(4)
  })

  describe('per-minute cap', () => {
    it('drops reports over the cap silently and warns once per window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
      enable({ maxReportsPerMinute: 2 })

      const statuses: number[] = []
      for (let i = 0; i < 5; i += 1) {
        statuses.push((await POST(request({ metrics: [metric()] }))).status)
      }

      expect(statuses).toEqual([202, 202, 202, 202, 202])
      expect(logger.info).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })

    it('accepts reports again in the next window and warns again if it overflows', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
      enable({ maxReportsPerMinute: 1 })

      await POST(request({ metrics: [metric()] }))
      await POST(request({ metrics: [metric()] }))
      expect(logger.info).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-01-01T00:01:20Z'))
      await POST(request({ metrics: [metric()] }))
      await POST(request({ metrics: [metric()] }))

      expect(logger.info).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledTimes(2)
    })

    it('answers 202 without reading the body once the cap is spent', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
      enable({ maxReportsPerMinute: 1 })

      expect((await POST(request({ metrics: [metric()] }))).status).toBe(202)
      expect((await post('{not json')).status).toBe(202)
      expect(
        (await post({ metrics: [metric()], padding: 'x'.repeat(4096) })).status
      ).toBe(202)
      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it('does not spend the cap on a rejected origin', async () => {
      enable({ maxReportsPerMinute: 1 })

      await POST(
        request({ metrics: [metric()] }, { Origin: 'https://evil.example' })
      )
      const response = await POST(request({ metrics: [metric()] }))

      expect(response.status).toBe(202)
      expect(logger.info).toHaveBeenCalledTimes(1)
    })
  })
})
