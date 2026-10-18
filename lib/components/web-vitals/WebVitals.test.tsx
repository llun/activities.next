import { getWebVitalsConfig } from '@/lib/config'

import { WebVitals } from './WebVitals'
import { WebVitalsReporter } from './WebVitalsReporter'

vi.mock('./WebVitalsReporter', () => ({ WebVitalsReporter: () => null }))

describe('WebVitals', () => {
  it('renders nothing while reporting is off', () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0,
      maxReportsPerMinute: 600
    })

    expect(WebVitals()).toBeNull()
  })

  it('mounts the reporter with the runtime sample rate', () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0.25,
      maxReportsPerMinute: 600
    })

    const element = WebVitals()

    expect(element?.type).toBe(WebVitalsReporter)
    expect(element?.props).toEqual({ sampleRate: 0.25 })
  })
})
