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
    it('parses config with github', () => {
      const config = AuthConfig.parse({
        github: {
          id: 'github-id',
          secret: 'github-secret'
        }
      })

      expect(config.github?.id).toBe('github-id')
    })

    it('parses config without github', () => {
      const config = AuthConfig.parse({})

      expect(config.github).toBeUndefined()
    })
  })

  describe('getAuthConfig', () => {
    it('returns null when no auth env vars', () => {
      const config = getAuthConfig()
      expect(config).toBeNull()
    })

    it('parses ACTIVITIES_AUTH json env var', () => {
      process.env.ACTIVITIES_AUTH = JSON.stringify({
        github: { id: 'test-id', secret: 'test-secret' }
      })

      const config = getAuthConfig()

      expect(config).not.toBeNull()
      expect(config?.auth.github?.id).toBe('test-id')
    })

    it('builds config from individual env vars', () => {
      process.env.ACTIVITIES_AUTH_GITHUB_ID = 'env-id'
      process.env.ACTIVITIES_AUTH_GITHUB_SECRET = 'env-secret'

      const config = getAuthConfig()

      expect(config).not.toBeNull()
      expect(config?.auth.github?.id).toBe('env-id')
      expect(config?.auth.github?.secret).toBe('env-secret')
    })
  })
})
