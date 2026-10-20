import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { runInReactCacheScope } from '@/lib/testing/reactCacheScope'
import { logger } from '@/lib/utils/logger'

import {
  getVisitedDomainIdentity,
  resolveDomainIdentity
} from './domainIdentity'
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
    vi.mocked(getConfig).mockReturnValue(baseConfig)
    resetServedDomainsForTests()
    for (const key of POLICY_KEYS) {
      await deleteServerSetting(testDb.db, { key })
    }
    invalidateServerSettingsCache(database)
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
