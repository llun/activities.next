import { AuthConfig, getAuthConfig } from './auth'

describe('Auth config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
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

    it('ignores legacy individual github env vars', () => {
      process.env.ACTIVITIES_AUTH_GITHUB_ID = 'env-id'
      process.env.ACTIVITIES_AUTH_GITHUB_SECRET = 'env-secret'

      const config = getAuthConfig()

      expect(config).toBeNull()
    })
  })
})
