import type { Database } from '@/lib/database/types'
import {
  SERVED_DOMAIN_MAX_STALE_MS,
  refreshServedDomains,
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { logger } from '@/lib/utils/logger'

import {
  getPdsDomainForRequest,
  getPdsRequestHost,
  resetPdsHostCollisionWarningsForTests
} from './host'

const PDS_CONFIG_JSON = JSON.stringify({
  'social.example': {
    enabled: true,
    hostname: 'pds.social.example',
    allowEmails: [],
    allowActors: []
  },
  'disabled.example': {
    enabled: false,
    hostname: 'pds.disabled.example',
    allowEmails: [],
    allowActors: []
  },
  'port.example': {
    enabled: true,
    hostname: 'pds.port.example:8443',
    allowEmails: [],
    allowActors: []
  }
})

describe('PDS host routing', () => {
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = PDS_CONFIG_JSON
    resetServedDomainsForTests()
    setServedDomainsForTests([])
    resetPdsHostCollisionWarningsForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    resetServedDomainsForTests()
    resetPdsHostCollisionWarningsForTests()
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
  })

  it('uses header precedence x-activity-next-host > x-forwarded-host > host', () => {
    expect(
      getPdsRequestHost(
        new Headers({
          host: 'host.example',
          'x-forwarded-host': 'forwarded.example',
          'x-activity-next-host': 'override.example'
        })
      )
    ).toBe('override.example')

    expect(
      getPdsRequestHost(
        new Headers({
          host: 'host.example',
          'x-forwarded-host': 'first.example, second.example'
        })
      )
    ).toBeNull()

    expect(getPdsRequestHost(new Headers({ host: 'Host.Example:443' }))).toBe(
      'host.example'
    )
  })

  it('rejects comma-separated Host or malformed host values without falling back to primary host', () => {
    expect(
      getPdsRequestHost(
        new Headers({ host: 'pds.social.example, evil.example' })
      )
    ).toBeNull()
    expect(
      getPdsRequestHost(new Headers({ host: 'evil@pds.social.example' }))
    ).toBeNull()
    expect(
      getPdsRequestHost(new Headers({ host: 'pds.social.example/path' }))
    ).toBeNull()
    expect(getPdsRequestHost(new Headers())).toBeNull()
  })

  it('refuses an X-Forwarded-Host list instead of trusting its client-sent first entry', () => {
    expect(
      getPdsRequestHost(
        new Headers({
          'x-forwarded-host': 'pds.social.example, social.example',
          host: 'social.example'
        })
      )
    ).toBeNull()
  })

  it('matches an enabled PDS hostname exactly (case/trailing-dot/default-port normalized)', () => {
    const match = getPdsDomainForRequest(
      new Headers({ host: 'PDS.Social.Example.:443' })
    )
    expect(match).toEqual({
      domain: 'social.example',
      enabled: true,
      hostname: 'pds.social.example',
      did: 'did:web:pds.social.example',
      allowEmails: [],
      allowActors: []
    })

    const withPort = getPdsDomainForRequest(
      new Headers({ 'x-forwarded-host': 'pds.port.example:8443' })
    )
    expect(withPort?.did).toBe('did:web:pds.port.example%3A8443')
  })

  it('returns null for primary domain, disabled domain, unknown host, or unset config', () => {
    expect(
      getPdsDomainForRequest(new Headers({ host: 'social.example' }))
    ).toBeNull()
    expect(
      getPdsDomainForRequest(new Headers({ host: 'pds.disabled.example' }))
    ).toBeNull()
    expect(
      getPdsDomainForRequest(new Headers({ host: 'unknown.example' }))
    ).toBeNull()
    expect(
      getPdsDomainForRequest(new Headers({ host: 'pds.port.example' }))
    ).toBeNull()

    delete process.env.ACTIVITIES_BLUESKY_PDS
    expect(
      getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
    ).toBeNull()
  })

  it('refuses a PDS hostname that collides with ACTIVITIES_HOST, a concrete trusted host, or an active served domain and logs a warning once', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      // 1. Collides with ACTIVITIES_HOST
      expect(
        getPdsDomainForRequest(
          new Headers({ host: 'pds.social.example' }),
          undefined,
          {
            host: 'pds.social.example',
            trustedHosts: [],
            servedDomains: []
          }
        )
      ).toBeNull()
      // Repeat call for same collision does not warn a second time.
      expect(
        getPdsDomainForRequest(
          new Headers({ host: 'pds.social.example' }),
          undefined,
          {
            host: 'pds.social.example',
            trustedHosts: [],
            servedDomains: []
          }
        )
      ).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // 2. Collides with a concrete ACTIVITIES_TRUSTED_HOSTS entry
      resetPdsHostCollisionWarningsForTests()
      warnSpy.mockClear()
      expect(
        getPdsDomainForRequest(
          new Headers({ host: 'pds.social.example' }),
          undefined,
          {
            host: 'social.example',
            trustedHosts: ['pds.social.example'],
            servedDomains: []
          }
        )
      ).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // 3. Collides with an active served domain in the snapshot
      resetPdsHostCollisionWarningsForTests()
      warnSpy.mockClear()
      setServedDomainsForTests(['pds.social.example'])
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
      ).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // 4. Wildcard trusted host (*.social.example) is NOT a concrete served domain
      //    and must not falsely block a dedicated PDS subdomain.
      resetServedDomainsForTests()
      resetPdsHostCollisionWarningsForTests()
      warnSpy.mockClear()
      const allowed = getPdsDomainForRequest(
        new Headers({ host: 'pds.social.example' }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: ['*.social.example'],
          servedDomains: []
        }
      )
      expect(allowed?.hostname).toBe('pds.social.example')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('refuses a PDS hostname from X-Forwarded-Host or X-Activity-Next-Host when raw Host is a different served domain of the instance', () => {
    // 1. Raw Host matches ACTIVITIES_HOST -> refuse spoofed X-Forwarded-Host.
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'social.example',
          'x-forwarded-host': 'pds.social.example'
        }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: [],
          servedDomains: []
        }
      )
    ).toBeNull()

    // 2. Raw Host matches a concrete ACTIVITIES_TRUSTED_HOSTS entry -> refuse.
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'Alias.Example.:443',
          'x-forwarded-host': 'pds.social.example'
        }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: ['alias.example'],
          servedDomains: []
        }
      )
    ).toBeNull()

    // 3. Raw Host matches an active served domain in the snapshot -> refuse
    //    (including when X-Activity-Next-Host resolved the PDS hostname).
    setServedDomainsForTests(['community.example'])
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'community.example',
          'x-activity-next-host': 'pds.social.example'
        })
      )
    ).toBeNull()

    // 4. Comma-separated raw Host alongside X-Forwarded-Host -> refuse.
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'social.example, evil.example',
          'x-forwarded-host': 'pds.social.example'
        }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: [],
          servedDomains: []
        }
      )
    ).toBeNull()

    // 5. Internal/non-served backend Host behind a reverse proxy setting
    //    X-Forwarded-Host -> allowed.
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'internal-app:3000',
          'x-forwarded-host': 'pds.social.example'
        }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: ['alias.example'],
          servedDomains: ['community.example']
        }
      )?.hostname
    ).toBe('pds.social.example')

    // 6. Raw Host matches the resolved PDS hostname (modulo case/trailing dot/
    //    default port) -> allowed.
    expect(
      getPdsDomainForRequest(
        new Headers({
          host: 'PDS.Social.Example.:443',
          'x-forwarded-host': 'pds.social.example'
        }),
        undefined,
        {
          host: 'social.example',
          trustedHosts: [],
          servedDomains: []
        }
      )?.hostname
    ).toBe('pds.social.example')
  })

  it('fails closed (returns null) when the served-domain snapshot is unloaded, stale, or errored', async () => {
    vi.useFakeTimers()
    const errorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined)
    try {
      // 1. Never loaded -> fail closed.
      resetServedDomainsForTests()
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
      ).toBeNull()

      // 2. Loaded and fresh -> matches.
      const getActiveServedDomains = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('database offline'))
        .mockResolvedValueOnce([])
      const mockDb = { getActiveServedDomains } as unknown as Database
      await refreshServedDomains(mockDb)
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
          ?.hostname
      ).toBe('pds.social.example')

      // 3. Stale past SERVED_DOMAIN_MAX_STALE_MS -> fail closed.
      vi.advanceTimersByTime(SERVED_DOMAIN_MAX_STALE_MS + 1)
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
      ).toBeNull()
      // Wait for any background refresh triggered by getServedHostConfig to settle.
      await vi.advanceTimersByTimeAsync(0)

      // 4. Last refresh failed -> fail closed even if a prior snapshot existed.
      resetServedDomainsForTests()
      const failingRefresh = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('db unreachable'))
        .mockResolvedValueOnce([])
      const db2 = {
        getActiveServedDomains: failingRefresh
      } as unknown as Database
      await refreshServedDomains(db2)
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
          ?.hostname
      ).toBe('pds.social.example')

      await refreshServedDomains(db2)
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
      ).toBeNull()

      // 5. Recovers once a subsequent refresh succeeds.
      await refreshServedDomains(db2)
      expect(
        getPdsDomainForRequest(new Headers({ host: 'pds.social.example' }))
          ?.hostname
      ).toBe('pds.social.example')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
