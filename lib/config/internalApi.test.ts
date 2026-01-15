import { InternalApiConfig, getInternalApiConfig } from './internalApi'

describe('InternalApi config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('InternalApiConfig schema', () => {
    it('parses valid config', () => {
      const config = InternalApiConfig.parse({
        sharedKey: 'my-secret-key'
      })

      expect(config.sharedKey).toBe('my-secret-key')
    })
  })

  describe('getInternalApiConfig', () => {
    it('returns null when no internal api env vars', () => {
      const config = getInternalApiConfig()
      expect(config).toBeNull()
    })

    it('returns config when internal api env vars exist', () => {
      process.env.ACTIVITIES_INTERNAL_API_ENABLED = 'true'
      process.env.ACTIVITIES_INTERNAL_SHARED_KEY = 'test-shared-key'

      const config = getInternalApiConfig()

      expect(config).not.toBeNull()
      expect(config?.internalApi.sharedKey).toBe('test-shared-key')
    })
  })
})
