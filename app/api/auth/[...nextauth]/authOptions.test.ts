import { getAuthOptions } from './authOptions'

describe('authOptions', () => {
  beforeEach(() => {
    // Clear memoization between tests
    getAuthOptions.cache.clear?.()
  })

  describe('#getAuthOptions', () => {
    it('returns auth options with required properties', () => {
      const options = getAuthOptions()

      expect(options).toHaveProperty('secret')
      expect(options).toHaveProperty('session')
      expect(options).toHaveProperty('providers')
      expect(options).toHaveProperty('pages')
      expect(options).toHaveProperty('callbacks')
      expect(options).toHaveProperty('adapter')
    })

    it('configures database session strategy', () => {
      const options = getAuthOptions()

      expect(options.session).toEqual({
        strategy: 'database'
      })
    })

    it('configures custom sign-in page', () => {
      const options = getAuthOptions()

      expect(options.pages).toEqual({
        signIn: '/auth/signin'
      })
    })

    it('includes credentials and github providers', () => {
      const options = getAuthOptions()

      expect(options.providers).toHaveLength(2)
      expect(options.providers[0].name).toBeDefined()
      expect(options.providers[1].name).toEqual('GitHub')
    })

    it('memoizes the result', () => {
      const options1 = getAuthOptions()
      const options2 = getAuthOptions()

      expect(options1).toBe(options2)
    })

    it('uses secret from config', () => {
      const options = getAuthOptions()

      // Secret should be set from config.secretPhase
      expect(options.secret).toBeDefined()
      expect(typeof options.secret).toBe('string')
    })
  })

  describe('signIn callback', () => {
    it('is defined as a function', () => {
      const options = getAuthOptions()
      const signIn = options.callbacks?.signIn

      expect(signIn).toBeDefined()
      expect(typeof signIn).toBe('function')
    })

    it('returns false for unknown provider types', async () => {
      const options = getAuthOptions()
      const signIn = options.callbacks?.signIn

      if (!signIn) {
        throw new Error('signIn callback not found')
      }

      const result = await signIn({
        user: { id: 'test', email: 'test@example.com' },
        account: {
          type: 'unknown' as 'credentials',
          provider: 'unknown',
          providerAccountId: 'test'
        },
        profile: undefined,
        email: undefined,
        credentials: undefined
      })

      expect(result).toBe(false)
    })

    it('returns false for null account type', async () => {
      const options = getAuthOptions()
      const signIn = options.callbacks?.signIn

      if (!signIn) {
        throw new Error('signIn callback not found')
      }

      const result = await signIn({
        user: { id: 'test', email: 'test@example.com' },
        account: null,
        profile: undefined,
        email: undefined,
        credentials: undefined
      })

      expect(result).toBe(false)
    })
  })

  describe('credentials provider', () => {
    it('has correct configuration', () => {
      const options = getAuthOptions()
      const credentialsProvider = options.providers[0]

      expect(credentialsProvider).toBeDefined()
      expect(credentialsProvider.type).toBe('credentials')
    })
  })

  describe('github provider', () => {
    it('has correct configuration', () => {
      const options = getAuthOptions()
      const githubProvider = options.providers[1]

      expect(githubProvider).toBeDefined()
      expect(githubProvider.name).toBe('GitHub')
      expect(githubProvider.type).toBe('oauth')
    })
  })

  describe('adapter', () => {
    it('is configured with StorageAdapter', () => {
      const options = getAuthOptions()

      expect(options.adapter).toBeDefined()
      // StorageAdapter returns an object with standard adapter methods
      expect(options.adapter).toHaveProperty('createUser')
      expect(options.adapter).toHaveProperty('getUser')
      expect(options.adapter).toHaveProperty('getUserByEmail')
      expect(options.adapter).toHaveProperty('getUserByAccount')
      expect(options.adapter).toHaveProperty('createSession')
      expect(options.adapter).toHaveProperty('getSessionAndUser')
      expect(options.adapter).toHaveProperty('deleteSession')
    })
  })
})
