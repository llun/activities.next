import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { runInReactCacheScope } from '@/lib/testing/reactCacheScope'
import { logger } from '@/lib/utils/logger'

import {
  getVisitedDomainIdentity,
  invalidateDomainIdentityCache,
  resolveDomainIdentity
} from './domainIdentity'
import {
  DOMAIN_IDENTITY_CACHE_MAX_ENTRIES,
  DOMAIN_IDENTITY_CACHE_TTL_MS
} from './domainIdentityCache'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from './servedDomainSnapshot'

// The server build of `cache`, so a request scope actually memoizes.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const { serverCache } = await import('@/lib/testing/reactCacheScope')
  return { ...actual, cache: serverCache }
})

const visitedHeaders = vi.hoisted(() => ({ value: new Headers() }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => visitedHeaders.value)
}))

const testDb = createTestDatabase()
vi.mock('@/lib/database', () => ({
  getDatabase: () => testDb.database
}))

const baseConfig = vi.mocked(getConfig)()

const POLICY_KEYS = ['policies.termsOfService', 'policies.privacyPolicy']

describe('domainIdentity', () => {
  let database: Database

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
    database = testDb.database
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      ...baseConfig,
      host: 'social.example',
      trustedHosts: ['club.example', '*.preview.example']
    })
    invalidateServerSettingsCache(database)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.mocked(getConfig).mockReturnValue(baseConfig)
    resetServedDomainsForTests()
    for (const key of POLICY_KEYS) {
      await deleteServerSetting(testDb.db, { key })
    }
    await testDb.db.deleteFrom('domains').execute()
    invalidateServerSettingsCache(database)
    invalidateDomainIdentityCache(database)
  })

  describe('resolveDomainIdentity', () => {
    it('serves the server identity with no policies by default', async () => {
      await expect(
        resolveDomainIdentity(database, 'Social.Example')
      ).resolves.toEqual({
        domain: 'social.example',
        source: 'primary',
        name: 'Activities.next',
        description: 'Personal activity pub server with Next.js',
        contactEmail: '',
        termsOfService: null,
        privacyPolicy: null
      })
    })

    it('carries the server policies with the time each last changed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'))
        await database.setServerSettings([
          { key: 'policies.termsOfService', value: '# Terms' },
          // Blank counts as none.
          { key: 'policies.privacyPolicy', value: '  \n' }
        ])
      } finally {
        vi.useRealTimers()
      }
      invalidateServerSettingsCache(database)

      const identity = await resolveDomainIdentity(database, 'social.example')

      expect(identity.termsOfService).toEqual({
        markdown: '# Terms',
        updatedAt: Date.UTC(2026, 2, 4, 5, 6, 7),
        source: 'server'
      })
      expect(identity.privacyPolicy).toBeNull()
    })

    it('carries an env-pinned policy with no date', async () => {
      const saved = process.env.ACTIVITIES_TERMS_OF_SERVICE
      process.env.ACTIVITIES_TERMS_OF_SERVICE = 'Pinned terms'
      invalidateServerSettingsCache(database)
      try {
        const identity = await resolveDomainIdentity(database, 'social.example')
        expect(identity.termsOfService).toEqual({
          markdown: 'Pinned terms',
          updatedAt: null,
          source: 'server'
        })
      } finally {
        if (saved === undefined) delete process.env.ACTIVITIES_TERMS_OF_SERVICE
        else process.env.ACTIVITIES_TERMS_OF_SERVICE = saved
      }
    })

    it.each([
      {
        name: 'an env domain',
        host: 'club.example',
        active: [],
        source: 'env'
      },
      {
        name: 'an active Admin › Domains row',
        host: 'run.example',
        active: ['run.example'],
        source: 'database'
      },
      {
        name: 'a wildcard preview host',
        host: 'pr-1.preview.example',
        active: [],
        source: 'other'
      }
    ])(
      'uses the server identity on $name, keeping the visited domain',
      async ({ host, active, source }) => {
        setServedDomainsForTests(active)
        await database.setServerSettings([
          { key: 'policies.privacyPolicy', value: 'No logs' }
        ])
        invalidateServerSettingsCache(database)

        const identity = await resolveDomainIdentity(database, host)

        expect(identity).toMatchObject({
          domain: host,
          source,
          name: 'Activities.next',
          privacyPolicy: { markdown: 'No logs', source: 'server' }
        })
      }
    )

    it('falls back to the primary for a missing host', async () => {
      const identity = await resolveDomainIdentity(database, null)
      expect(identity).toMatchObject({
        domain: 'social.example',
        source: 'primary'
      })
    })

    it('serves env + defaults without a database', async () => {
      const identity = await resolveDomainIdentity(null, 'social.example')
      expect(identity).toMatchObject({
        domain: 'social.example',
        name: 'Activities.next',
        termsOfService: null
      })
    })

    it('logs and still answers when the settings read fails', async () => {
      const failing = {
        getAllServerSettings: vi
          .fn()
          .mockRejectedValue(new Error('database unavailable'))
      } as unknown as Database
      const errorSpy = vi.spyOn(logger, 'error')
      try {
        const identity = await resolveDomainIdentity(failing, 'social.example')
        expect(identity).toMatchObject({
          domain: 'social.example',
          name: 'Activities.next'
        })
        expect(errorSpy).toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    })
  })

  describe('per-domain overrides', () => {
    const RUN_OVERRIDES = {
      name: 'Run Club',
      description: 'Running together',
      contactEmail: 'hello@run.example',
      termsOfService: '# Run terms',
      termsOfServiceUpdatedAt: Date.UTC(2026, 4, 1)
    }

    it('takes each field the domain sets and the server’s for the rest', async () => {
      await database.setServerSettings([
        { key: 'policies.privacyPolicy', value: 'Server privacy' }
      ])
      invalidateServerSettingsCache(database)
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        ...RUN_OVERRIDES
      })
      setServedDomainsForTests(['run.example'])

      const identity = await resolveDomainIdentity(database, 'run.example')

      expect(identity).toMatchObject({
        domain: 'run.example',
        source: 'database',
        name: 'Run Club',
        description: 'Running together',
        contactEmail: 'hello@run.example',
        termsOfService: {
          markdown: '# Run terms',
          updatedAt: Date.UTC(2026, 4, 1),
          source: 'domain'
        },
        privacyPolicy: { markdown: 'Server privacy', source: 'server' }
      })
    })

    it('falls back to the server for a field the domain leaves null', async () => {
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        name: 'Run Club'
      })
      setServedDomainsForTests(['run.example'])

      await expect(
        resolveDomainIdentity(database, 'run.example')
      ).resolves.toMatchObject({
        name: 'Run Club',
        description: 'Personal activity pub server with Next.js',
        contactEmail: '',
        termsOfService: null,
        privacyPolicy: null
      })
    })

    it('uses an env domain’s row whatever its stored status', async () => {
      await database.createServedDomain({
        domain: 'club.example',
        status: 'off',
        name: 'Club'
      })

      await expect(
        resolveDomainIdentity(database, 'club.example')
      ).resolves.toMatchObject({ source: 'env', name: 'Club' })
    })

    it('uses the server identity for an env domain without a row', async () => {
      await expect(
        resolveDomainIdentity(database, 'club.example')
      ).resolves.toMatchObject({ source: 'env', name: 'Activities.next' })
    })

    it('ignores the row of an added domain that is off', async () => {
      await database.createServedDomain({
        domain: 'run.example',
        status: 'off',
        ...RUN_OVERRIDES
      })
      // Still in a stale snapshot: the row itself decides.
      setServedDomainsForTests(['run.example'])

      await expect(
        resolveDomainIdentity(database, 'run.example')
      ).resolves.toMatchObject({
        name: 'Activities.next',
        termsOfService: null
      })
    })

    it('reads no row for a domain outside the snapshot or a wildcard host', async () => {
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        ...RUN_OVERRIDES
      })
      await database.createServedDomain({
        domain: 'pr-1.preview.example',
        status: 'on',
        ...RUN_OVERRIDES
      })
      const read = vi.spyOn(database, 'getServedDomainWithPolicies')
      try {
        for (const host of ['run.example', 'pr-1.preview.example']) {
          await expect(
            resolveDomainIdentity(database, host)
          ).resolves.toMatchObject({
            domain: host,
            source: 'other',
            name: 'Activities.next'
          })
        }
        // Nor for the primary, which never has a row.
        await resolveDomainIdentity(database, 'social.example')
        expect(read).not.toHaveBeenCalled()
      } finally {
        read.mockRestore()
      }
    })

    it('logs and serves the server identity when the row read fails', async () => {
      setServedDomainsForTests(['run.example'])
      const read = vi
        .spyOn(database, 'getServedDomainWithPolicies')
        .mockRejectedValue(new Error('database unavailable'))
      const errorSpy = vi.spyOn(logger, 'error')
      try {
        await expect(
          resolveDomainIdentity(database, 'run.example')
        ).resolves.toMatchObject({
          domain: 'run.example',
          source: 'database',
          name: 'Activities.next'
        })
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ domain: 'run.example' })
        )
      } finally {
        read.mockRestore()
        errorSpy.mockRestore()
      }
    })

    it('caches a row for the TTL and drops it on invalidation', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'))
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        name: 'Run Club'
      })
      setServedDomainsForTests(['run.example'])
      const read = vi.spyOn(database, 'getServedDomainWithPolicies')
      try {
        await resolveDomainIdentity(database, 'run.example')
        await database.updateServedDomain({
          domain: 'run.example',
          name: 'Renamed'
        })

        // Within the TTL: the cached row.
        vi.setSystemTime(Date.now() + DOMAIN_IDENTITY_CACHE_TTL_MS - 1)
        await expect(
          resolveDomainIdentity(database, 'run.example')
        ).resolves.toMatchObject({ name: 'Run Club' })
        expect(read).toHaveBeenCalledTimes(1)

        // Past it: read again.
        vi.setSystemTime(Date.now() + 2)
        await expect(
          resolveDomainIdentity(database, 'run.example')
        ).resolves.toMatchObject({ name: 'Renamed' })
        expect(read).toHaveBeenCalledTimes(2)

        // An admin write invalidates at once.
        await database.updateServedDomain({
          domain: 'run.example',
          name: 'Run Club again'
        })
        invalidateDomainIdentityCache(database)
        await expect(
          resolveDomainIdentity(database, 'run.example')
        ).resolves.toMatchObject({ name: 'Run Club again' })
        expect(read).toHaveBeenCalledTimes(3)

        // Invalidating without a database (another module copy) does too.
        invalidateDomainIdentityCache()
        await resolveDomainIdentity(database, 'run.example')
        expect(read).toHaveBeenCalledTimes(4)
      } finally {
        read.mockRestore()
      }
    })

    it('keeps at most the cap of domains', async () => {
      const domains = Array.from(
        { length: DOMAIN_IDENTITY_CACHE_MAX_ENTRIES + 1 },
        (_, index) => `d${index}.example`
      )
      setServedDomainsForTests(domains)
      const read = vi
        .spyOn(database, 'getServedDomainWithPolicies')
        .mockResolvedValue(null)
      try {
        for (const domain of domains) {
          await resolveDomainIdentity(database, domain)
        }
        expect(read).toHaveBeenCalledTimes(domains.length)
        // The newest is still cached; the oldest was dropped to make room.
        await resolveDomainIdentity(database, domains[domains.length - 1])
        expect(read).toHaveBeenCalledTimes(domains.length)
        await resolveDomainIdentity(database, domains[0])
        expect(read).toHaveBeenCalledTimes(domains.length + 1)
      } finally {
        read.mockRestore()
      }
    })
  })

  describe('getVisitedDomainIdentity', () => {
    it('resolves the trusted visited host once per request', async () => {
      visitedHeaders.value = new Headers({ host: 'club.example' })

      const [first, second] = await runInReactCacheScope(async () =>
        Promise.all([getVisitedDomainIdentity(), getVisitedDomainIdentity()])
      )

      // Each resolve builds a new object, so the same one twice is the memo.
      expect(first).toBe(second)
      expect(first).toMatchObject({ domain: 'club.example', source: 'env' })
    })

    it('ignores an untrusted host', async () => {
      visitedHeaders.value = new Headers({ host: 'evil.example' })

      await expect(getVisitedDomainIdentity()).resolves.toMatchObject({
        domain: 'social.example',
        source: 'primary'
      })
    })
  })
})
