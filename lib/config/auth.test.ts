import { logger } from '@/lib/utils/logger'

import { AuthConfig, getAuthConfig } from './auth'

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: jest.fn()
  }
}))

describe('Auth config', () => {
  const originalEnv = process.env
  const mockWarn = logger.warn as jest.Mock

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockWarn.mockReset()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('AuthConfig schema', () => {
    it('ignores legacy github config', () => {
      const config = AuthConfig.parse({
        github: {
          id: 'github-id',
          secret: 'github-secret'
        }
      })

      expect(config).not.toHaveProperty('github')
    })

    it('parses config without optional auth settings', () => {
      const config = AuthConfig.parse({})

      expect(config).not.toHaveProperty('github')
    })

    it('parses credential auth settings', () => {
      const config = AuthConfig.parse({
        enableCredential: false
      })

      expect(config.enableCredential).toBe(false)
    })
  })

  describe('getAuthConfig', () => {
    it('returns null when no auth env vars', () => {
      const config = getAuthConfig()
      expect(config).toBeNull()
    })

    it('parses ACTIVITIES_AUTH json env var without legacy github config', () => {
      process.env.ACTIVITIES_AUTH = JSON.stringify({
        enableCredential: false,
        github: { id: 'test-id', secret: 'test-secret' }
      })

      const config = getAuthConfig()

      expect(config).not.toBeNull()
      expect(config?.auth.enableCredential).toBe(false)
      expect(config?.auth).not.toHaveProperty('github')
    })

    it('warns and ignores legacy individual github env vars', () => {
      process.env.ACTIVITIES_AUTH_GITHUB_ID = 'env-id'
      process.env.ACTIVITIES_AUTH_GITHUB_SECRET = 'env-secret'

      const config = getAuthConfig()

      expect(config).toBeNull()
      expect(mockWarn).toHaveBeenCalledWith({
        message:
          'ACTIVITIES_AUTH_GITHUB_ID and ACTIVITIES_AUTH_GITHUB_SECRET are no longer supported and will be ignored. Remove them from your environment.'
      })
    })

    it('throws a clear error when ACTIVITIES_AUTH is invalid JSON', () => {
      process.env.ACTIVITIES_AUTH = '{'

      expect(() => getAuthConfig()).toThrow('ACTIVITIES_AUTH is not valid JSON')
    })

    it('throws a clear error when ACTIVITIES_AUTH has an invalid schema', () => {
      process.env.ACTIVITIES_AUTH = JSON.stringify({
        enableCredential: 'false'
      })

      expect(() => getAuthConfig()).toThrow('ACTIVITIES_AUTH is invalid:')
    })
  })
})
