import { getWebVitalsConfig } from '@/lib/config'

import { WebVitals } from './WebVitals'
import { WebVitalsLoader } from './WebVitalsLoader'

const reporterModuleLoaded = vi.hoisted(() => vi.fn())

vi.mock('./WebVitalsReporter', () => {
  reporterModuleLoaded()
  return { WebVitalsReporter: () => null }
})

describe('WebVitals', () => {
  it('renders nothing while reporting is off', () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0,
      maxReportsPerMinute: 600
    })

    expect(WebVitals()).toBeNull()
    expect(reporterModuleLoaded).not.toHaveBeenCalled()
  })

  it('mounts the loader (not the reporter module) with the runtime sample rate', () => {
    vi.mocked(getWebVitalsConfig).mockReturnValue({
      sampleRate: 0.25,
      maxReportsPerMinute: 600
    })

    const element = WebVitals()

    expect(element?.type).toBe(WebVitalsLoader)
    expect(element?.props).toEqual({ sampleRate: 0.25 })
    expect(reporterModuleLoaded).not.toHaveBeenCalled()
  })
})
