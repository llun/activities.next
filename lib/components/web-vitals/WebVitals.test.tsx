import { getWebVitalsConfig } from '@/lib/config'

import { WebVitals } from './WebVitals'
import { WebVitalsReporter } from './WebVitalsReporter'

const mocks = vi.hoisted(() => ({ connection: vi.fn() }))

vi.mock('next/server', () => ({ connection: mocks.connection }))

vi.mock('./WebVitalsReporter', () => ({ WebVitalsReporter: () => null }))

describe('WebVitals', () => {
  beforeEach(() => {
    mocks.connection.mockReset().mockResolvedValue(undefined)
  })

  it('renders nothing while reporting is off', async () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0,
      maxReportsPerMinute: 600
    })

    expect(await WebVitals()).toBeNull()
  })

  it('mounts the reporter with the runtime sample rate', async () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0.25,
      maxReportsPerMinute: 600
    })

    const element = await WebVitals()

    expect(element?.type).toBe(WebVitalsReporter)
    expect(element?.props).toEqual({ sampleRate: 0.25 })
  })

  it('waits for a request before reading the rate', async () => {
    const order: string[] = []
    mocks.connection.mockImplementation(async () => {
      order.push('connection')
    })
    vi.mocked(getWebVitalsConfig).mockImplementation(() => {
      order.push('config')
      return { sampleRate: 0.5, maxReportsPerMinute: 600 }
    })

    await WebVitals()

    expect(order).toEqual(['connection', 'config'])
  })
})
