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
        allowActors: ['alice@example.com', 'bob@example.com'],
        relays: ['https://bsky.network']
      },
      'disabled.example.com': {
        domain: 'disabled.example.com',
        enabled: false,
        hostname: 'pds.disabled.example.com',
        did: 'did:web:pds.disabled.example.com',
        allowEmails: ['carol@example.com'],
        allowActors: [],
        relays: ['https://bsky.network']
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
        allowActors: [],
        relays: ['https://bsky.network']
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

  it('normalizes and deduplicates per-domain relays and allows an empty list', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      'custom.example.com': {
        enabled: true,
        hostname: 'pds.custom.example.com',
        relays: [
          '  https://Relay.Example.COM/ ',
          'https://relay.example.com:443',
          'https://relay2.example.com:8443/'
        ]
      },
      'none.example.com': {
        enabled: true,
        hostname: 'pds.none.example.com',
        relays: []
      }
    })

    const { logger } = await import('@/lib/utils/logger')
    const { getPdsConfig } = await import('./blueskyPds')

    const pds = getPdsConfig()
    expect(pds?.['custom.example.com']?.relays).toEqual([
      'https://relay.example.com',
      'https://relay2.example.com:8443'
    ])
    expect(pds?.['none.example.com']?.relays).toEqual([])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns and disables the whole config when any relay URL is invalid', async () => {
    const invalidRelayConfigs = [
      ['http://bsky.network'],
      ['https://bsky.network/xrpc'],
      ['https://bsky.network//'],
      ['https://bsky.network?foo=1'],
      ['https://bsky.network/#frag'],
      ['https://user:pass@bsky.network'],
      ['https://user@bsky.network'],
      ['https://@bsky.network'],
      ['bsky.network'],
      [''],
      'https://bsky.network'
    ]

    for (const relays of invalidRelayConfigs) {
      vi.resetModules()
      vi.clearAllMocks()
      process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
        'example.com': {
          enabled: true,
          hostname: 'pds.example.com',
          relays
        },
        'other.example.com': {
          enabled: true,
          hostname: 'pds.other.example.com'
        }
      })

      const { logger } = await import('@/lib/utils/logger')
      const { getPdsConfig } = await import('./blueskyPds')

      expect(getPdsConfig()).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    }
  })

  it('returns null for an unset or blank rotation key without warning', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const { getPdsRotationKeyHex } = await import('./blueskyPds')

    expect(getPdsRotationKeyHex()).toBeNull()

    vi.resetModules()
    vi.clearAllMocks()
    process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY = '   '
    const mod2 = await import('./blueskyPds')
    expect(mod2.getPdsRotationKeyHex()).toBeNull()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns a valid rotation key lowercased without warning', async () => {
    process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY =
      ' 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF '

    const { logger } = await import('@/lib/utils/logger')
    const { getPdsRotationKeyHex } = await import('./blueskyPds')

    expect(getPdsRotationKeyHex()).toBe(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns once and returns null for an invalid rotation key without logging the value', async () => {
    const invalidValues = [
      'secret-rotation-key-value-that-must-not-leak',
      'a'.repeat(63),
      'a'.repeat(65),
      'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    ]

    for (const value of invalidValues) {
      vi.resetModules()
      vi.clearAllMocks()
      process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY = value

      const { logger } = await import('@/lib/utils/logger')
      const { getPdsRotationKeyHex } = await import('./blueskyPds')

      expect(getPdsRotationKeyHex()).toBeNull()
      // A second call with the same value does not warn again.
      expect(getPdsRotationKeyHex()).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)

      const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
      expect(logged).not.toContain(value)
    }
  })

  it('defaults the PLC directory URL and normalizes a valid https origin', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const { DEFAULT_PLC_DIRECTORY_URL, getPlcDirectoryUrl } =
      await import('./blueskyPds')

    expect(getPlcDirectoryUrl()).toBe(DEFAULT_PLC_DIRECTORY_URL)
    expect(DEFAULT_PLC_DIRECTORY_URL).toBe('https://plc.directory')

    vi.resetModules()
    vi.clearAllMocks()
    process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL =
      '  https://PLC.Example.COM:443/  '
    const mod2 = await import('./blueskyPds')
    expect(mod2.getPlcDirectoryUrl()).toBe('https://plc.example.com')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns and falls back to the default for an invalid PLC directory URL', async () => {
    const invalidValues = [
      'http://plc.directory',
      'https://plc.directory/path',
      'https://plc.directory?foo=1',
      'https://plc.directory/#frag',
      'https://user:pass@plc.directory',
      'https://user@plc.directory',
      'plc.directory',
      'not a url'
    ]

    for (const value of invalidValues) {
      vi.resetModules()
      vi.clearAllMocks()
      process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL = value

      const { logger } = await import('@/lib/utils/logger')
      const { DEFAULT_PLC_DIRECTORY_URL, getPlcDirectoryUrl } =
        await import('./blueskyPds')

      expect(getPlcDirectoryUrl()).toBe(DEFAULT_PLC_DIRECTORY_URL)
      expect(logger.warn).toHaveBeenCalledTimes(1)
    }
  })
  it('defaults the AppView URL and DID to Bluesky’s and accepts overrides', async () => {
    delete process.env.ACTIVITIES_BLUESKY_APPVIEW_URL
    delete process.env.ACTIVITIES_BLUESKY_APPVIEW_DID
    const { logger } = await import('@/lib/utils/logger')
    const config = await import('./blueskyPds')
    expect(config.getBlueskyAppViewUrl()).toBe('https://api.bsky.app')
    expect(config.getBlueskyAppViewDid()).toBe(
      'did:web:api.bsky.app#bsky_appview'
    )

    process.env.ACTIVITIES_BLUESKY_APPVIEW_URL = ' https://AppView.Example/ '
    process.env.ACTIVITIES_BLUESKY_APPVIEW_DID =
      'did:web:appview.example#bsky_appview'
    expect(config.getBlueskyAppViewUrl()).toBe('https://appview.example')
    expect(config.getBlueskyAppViewDid()).toBe(
      'did:web:appview.example#bsky_appview'
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns once and uses the defaults for an invalid AppView URL or DID', async () => {
    const { logger } = await import('@/lib/utils/logger')
    const config = await import('./blueskyPds')
    for (const value of [
      'http://api.bsky.app',
      'https://api.bsky.app/xrpc',
      'https://user@api.bsky.app',
      'not a url'
    ]) {
      process.env.ACTIVITIES_BLUESKY_APPVIEW_URL = value
      expect(config.getBlueskyAppViewUrl()).toBe(
        config.DEFAULT_BLUESKY_APPVIEW_URL
      )
    }
    for (const value of ['api.bsky.app', 'did:web:', 'did:web:x#a#b']) {
      process.env.ACTIVITIES_BLUESKY_APPVIEW_DID = value
      expect(config.getBlueskyAppViewDid()).toBe(
        config.DEFAULT_BLUESKY_APPVIEW_DID
      )
    }
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })
})
