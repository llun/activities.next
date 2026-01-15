import { RequestConfig, getRequestConfig } from './request'

describe('Request config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('RequestConfig schema', () => {
    it('parses valid config', () => {
      const config = RequestConfig.parse({
        timeoutInMilliseconds: 5000,
        numberOfRetry: 3,
        retryNoise: 50
      })

      expect(config.timeoutInMilliseconds).toBe(5000)
      expect(config.numberOfRetry).toBe(3)
      expect(config.retryNoise).toBe(50)
    })

    it('uses defaults for missing values', () => {
      const config = RequestConfig.parse({})

      expect(config.timeoutInMilliseconds).toBe(4000)
      expect(config.numberOfRetry).toBe(1)
    })
  })

  describe('getRequestConfig', () => {
    it('returns null when no request env vars', () => {
      const config = getRequestConfig()
      expect(config).toBeNull()
    })

    it('returns config when request env vars exist', () => {
      process.env.ACTIVITIES_REQUEST_TIMEOUT = '5000'
      process.env.ACTIVITIES_REQUEST_RETRY = '3'

      const config = getRequestConfig()

      expect(config).not.toBeNull()
      expect(config?.request.timeoutInMilliseconds).toBe(5000)
      expect(config?.request.numberOfRetry).toBe(3)
    })

    it('includes retry noise when set', () => {
      process.env.ACTIVITIES_REQUEST_TIMEOUT = '5000'
      process.env.ACTIVITIES_REQUEST_RETRY = '3'
      process.env.ACTIVITIES_REQUEST_RETRY_NOISE = '100'

      const config = getRequestConfig()

      expect(config?.request.retryNoise).toBe(100)
    })
  })
})
