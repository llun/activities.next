import {
  DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE,
  getWebVitalsConfig
} from './webVitals'

const KEYS = [
  'ACTIVITIES_WEB_VITALS_SAMPLE_RATE',
  'ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE'
]

describe('getWebVitalsConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of KEYS) delete process.env[key]
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('is off by default with the default cap and no warning', () => {
    const onInvalid = vi.fn()

    expect(getWebVitalsConfig({ onInvalid })).toEqual({
      sampleRate: 0,
      maxReportsPerMinute: DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE
    })
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each([
    ['0', 0],
    ['0.05', 0.05],
    [' 0.5 ', 0.5],
    ['1', 1],
    ['1e-2', 0.01]
  ])('reads a sample rate of %s', (value, expected) => {
    process.env.ACTIVITIES_WEB_VITALS_SAMPLE_RATE = value

    expect(getWebVitalsConfig().sampleRate).toBe(expected)
  })

  it.each([['abc'], ['-0.1'], ['1.5'], ['NaN'], ['Infinity'], ['5%']])(
    'turns reporting off with one warning for a sample rate of %s',
    (value) => {
      process.env.ACTIVITIES_WEB_VITALS_SAMPLE_RATE = value
      const onInvalid = vi.fn()

      expect(getWebVitalsConfig({ onInvalid }).sampleRate).toBe(0)
      expect(onInvalid).toHaveBeenCalledTimes(1)
    }
  )

  it('reads the report cap', () => {
    process.env.ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE = '50'

    expect(getWebVitalsConfig().maxReportsPerMinute).toBe(50)
  })

  it.each([['0'], ['-5'], ['1.5'], ['many'], ['1000001']])(
    'falls back to the default cap with one warning for %s',
    (value) => {
      process.env.ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE = value
      const onInvalid = vi.fn()

      expect(getWebVitalsConfig({ onInvalid }).maxReportsPerMinute).toBe(
        DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE
      )
      expect(onInvalid).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps a valid sample rate when the cap is invalid', () => {
    process.env.ACTIVITIES_WEB_VITALS_SAMPLE_RATE = '0.25'
    process.env.ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE = 'x'

    expect(getWebVitalsConfig()).toEqual({
      sampleRate: 0.25,
      maxReportsPerMinute: DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE
    })
  })
})
