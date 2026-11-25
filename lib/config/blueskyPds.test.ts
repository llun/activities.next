vi.unmock('@/lib/config')

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn()
  }
}))

describe('Bluesky PDS config', () => {
  const originalEnv = process.env

  const setRequiredEnv = () => {
    process.env.ACTIVITIES_HOST = 'example.com'
    process.env.ACTIVITIES_SECRET_PHASE = 'test-secret-phase'
    process.env.ACTIVITIES_ALLOW_EMAILS = '[]'
    process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
    process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    setRequiredEnv()
    delete process.env.ACTIVITIES_BLUESKY_PDS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null when ACTIVITIES_BLUESKY_PDS is unset or blank', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const { getPdsConfig, getPdsDomainForHostname, isPdsAllowed } =
      await import('./blueskyPds')

    expect(getPdsConfig()).toBeNull()
    expect(getPdsDomainForHostname('pds.example.com')).toBeNull()
    expect(
      isPdsAllowed({
        email: 'alice@example.com',
        actorUsernameAtDomain: 'alice@example.com',
        domain: 'example.com'
      })
    ).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()

    vi.resetModules()
    process.env.ACTIVITIES_BLUESKY_PDS = '   '
    const mod2 = await import('./blueskyPds')
    expect(mod2.getPdsConfig()).toBeNull()
  })

  it('parses valid config, normalizes hosts/emails/actors, and defaults enabled to false', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'Example.COM.': {
        enabled: true,
        hostname: 'https://PDS.Example.COM:443',
        allowEmails: ['  Alice@Example.COM  ', 'alice@example.com'],
        allowActors: ['  @Alice@Example.COM ', 'Bob@Example.COM']
      },
      'disabled.example.com': {
        hostname: 'pds.disabled.example.com',
        allowEmails: ['carol@example.com']
      }
    })

    const { logger } = await import('@/lib/utils/logger')
    const { getConfig } = await import('./index')
    const { getPdsConfig, getPdsDomainForHostname, isPdsAllowed } =
      await import('./blueskyPds')

    const pds = getPdsConfig()
    expect(pds).toEqual(getConfig().blueskyPds)
    expect(pds).toEqual({
      'example.com': {
        domain: 'example.com',
        enabled: true,
        hostname: 'pds.example.com',
        did: 'did:web:pds.example.com',
        allowEmails: ['alice@example.com'],
        allowActors: ['alice@example.com', 'bob@example.com']
      },
      'disabled.example.com': {
        domain: 'disabled.example.com',
        enabled: false,
        hostname: 'pds.disabled.example.com',
        did: 'did:web:pds.disabled.example.com',
        allowEmails: ['carol@example.com'],
        allowActors: []
      }
    })

    expect(getPdsDomainForHostname('PDS.Example.COM.')).toEqual(
      pds?.['example.com']
    )
    expect(getPdsDomainForHostname('pds.disabled.example.com')).toBeNull()
    expect(getPdsDomainForHostname('other.example.com')).toBeNull()
    expect(getPdsDomainForHostname('')).toBeNull()

    expect(
      isPdsAllowed({
        email: 'ALICE@example.com',
        actorUsernameAtDomain: 'someone@example.com',
        domain: 'EXAMPLE.COM'
      })
    ).toBe(true)
    expect(
      isPdsAllowed({
        email: 'other@example.com',
        actorUsernameAtDomain: 'BOB@example.com',
        domain: 'example.com'
      })
    ).toBe(true)
    expect(
      isPdsAllowed({
        email: 'other@example.com',
        actorUsernameAtDomain: 'other@example.com',
        domain: 'example.com'
      })
    ).toBe(false)
    expect(
      isPdsAllowed({
        email: 'carol@example.com',
        domain: 'disabled.example.com'
      })
    ).toBe(false)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('fails closed with a warning on malformed JSON or invalid schema', async () => {
    const invalidValues = [
      'not json',
      '[]',
      'null',
      '"string"',
      JSON.stringify({ 'example.com': { enabled: true } }),
      JSON.stringify({
        'example.com': { enabled: 'yes', hostname: 'pds.example.com' }
      }),
      JSON.stringify({
        'example.com': { enabled: true, hostname: '*.example.com' }
      }),
      JSON.stringify({
        'example.com': { enabled: true, hostname: 'pds.example.com/path' }
      }),
      JSON.stringify({
        '*.example.com': { enabled: true, hostname: 'pds.example.com' }
      }),
      JSON.stringify({
        'Example.com': { enabled: true, hostname: 'pds1.example.com' },
        'example.com': { enabled: true, hostname: 'pds2.example.com' }
      })
    ]

    for (const value of invalidValues) {
      vi.resetModules()
      vi.clearAllMocks()
      process.env.ACTIVITIES_BLUESKY_PDS = value

      const { logger } = await import('@/lib/utils/logger')
      const { getConfig } = await import('./index')
      const { getPdsConfig } = await import('./blueskyPds')

      expect(() => getConfig()).not.toThrow()
      expect(getPdsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    }
  })

  it('warns and drops domains whose hostname collides with any served domain key', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'self.example.com': {
        enabled: true,
        hostname: 'self.example.com',
        allowEmails: ['a@example.com']
      },
      'cross.example.com': {
        enabled: true,
        hostname: 'ok.example.com',
        allowEmails: ['b@example.com']
      },
      'ok.example.com': {
        enabled: true,
        hostname: 'pds.ok.example.com',
        allowEmails: ['c@example.com']
      }
    })

    const { logger } = await import('@/lib/utils/logger')
    const { getPdsConfig, getPdsDomainForHostname } =
      await import('./blueskyPds')

    const pds = getPdsConfig()
    expect(pds).toEqual({
      'ok.example.com': {
        domain: 'ok.example.com',
        enabled: true,
        hostname: 'pds.ok.example.com',
        did: 'did:web:pds.ok.example.com',
        allowEmails: ['c@example.com'],
        allowActors: []
      }
    })
    expect(getPdsDomainForHostname('self.example.com')).toBeNull()
    expect(getPdsDomainForHostname('ok.example.com')).toBeNull()
    expect(getPdsDomainForHostname('pds.ok.example.com')?.domain).toBe(
      'ok.example.com'
    )
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('warns and drops domains sharing a duplicate PDS hostname', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'a.example.com': {
        enabled: true,
        hostname: 'pds.shared.example.com',
        allowEmails: ['a@example.com']
      },
      'b.example.com': {
        enabled: true,
        hostname: 'PDS.SHARED.EXAMPLE.COM',
        allowEmails: ['b@example.com']
      },
      'c.example.com': {
        enabled: true,
        hostname: 'pds.c.example.com',
        allowEmails: ['c@example.com']
      }
    })

    const { logger } = await import('@/lib/utils/logger')
    const { getPdsConfig, getPdsDomainForHostname } =
      await import('./blueskyPds')

    const pds = getPdsConfig()
    expect(Object.keys(pds ?? {})).toEqual(['c.example.com'])
    expect(getPdsDomainForHostname('pds.shared.example.com')).toBeNull()
    expect(getPdsDomainForHostname('pds.c.example.com')?.domain).toBe(
      'c.example.com'
    )
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('returns null when every domain is dropped', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'a.example.com': {
        enabled: true,
        hostname: 'a.example.com'
      }
    })

    const { getPdsConfig } = await import('./blueskyPds')
    expect(getPdsConfig()).toBeNull()
  })

  it('allows nobody when allowEmails and allowActors are empty', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'example.com': {
        enabled: true,
        hostname: 'pds.example.com',
        allowEmails: [],
        allowActors: []
      }
    })

    const { getPdsDomainForHostname, isPdsAllowed } =
      await import('./blueskyPds')

    expect(getPdsDomainForHostname('pds.example.com')?.enabled).toBe(true)
    expect(
      isPdsAllowed({
        email: 'alice@example.com',
        actorUsernameAtDomain: 'alice@example.com',
        domain: 'example.com'
      })
    ).toBe(false)
    expect(isPdsAllowed({ domain: 'example.com' })).toBe(false)
  })
})
