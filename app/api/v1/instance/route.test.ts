import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import { invalidateDomainIdentityCache } from '@/lib/services/domains/domainIdentity'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  buildBaseURL: (host: string) => `https://${host}`
}))

const baseConfig = {
  host: 'llun.test',
  trustedHosts: ['alias.llun.test'],
  serviceName: undefined,
  serviceDescription: undefined,
  languages: ['en'],
  mediaStorage: undefined,
  registrationOpen: true,
  push: {
    vapidPublicKey: 'test-vapid-public-key',
    vapidPrivateKey: 'test-vapid-private-key',
    vapidEmail: 'mailto:push@llun.test'
  },
  email: { type: 'smtp', serviceFromAddress: 'admin@llun.test' }
}

const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance', () => {
  const { database, db } = createTestDatabase({ backend: 'sqlite' })

  beforeAll(async () => {
    await database.migrate()
    await database.createAccount({
      email: 'user@llun.test',
      username: 'user',
      passwordHash: 'hashed-password',
      domain: 'llun.test',
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue(baseConfig as unknown as Config)
  })

  it.each([
    {
      name: 'the configured host by default',
      headers: {} as Record<string, string>,
      expected: 'llun.test'
    },
    {
      name: 'a trusted forwarded host',
      headers: { 'x-forwarded-host': 'alias.llun.test' },
      expected: 'alias.llun.test'
    },
    {
      name: 'the configured host when the forwarded host is untrusted',
      headers: { 'x-forwarded-host': 'evil.example' },
      expected: 'llun.test'
    }
  ])('reports $name', async ({ headers, expected }) => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance', { headers }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      uri: expected
    })
  })

  it('passes the request domain to getInstanceStats', async () => {
    const peersSpy = vi
      .spyOn(database, 'getInstancePeers')
      .mockResolvedValue([])
    try {
      await GET(
        new NextRequest('https://llun.test/api/v1/instance', {
          headers: { 'x-forwarded-host': 'alias.llun.test' }
        }),
        params
      )
      expect(peersSpy).toHaveBeenCalledWith({
        localDomain: 'alias.llun.test'
      })
    } finally {
      peersSpy.mockRestore()
    }
  })

  it('serves the configured contact email instead of the placeholder', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    const body = await response.json()
    expect(body.email).toBe('admin@llun.test')
  })

  it('reports instance stats as integers', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    const body = await response.json()
    expect(body.stats).toEqual({
      user_count: 1,
      status_count: 0,
      domain_count: 0
    })
  })

  it('serves urls, thumbnail, registrations, rules and contact_account', async () => {
    const rule = await database.createInstanceRule({
      text: 'No spam',
      hint: '',
      position: 1
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    const body = await response.json()
    expect(body.urls).toEqual({ streaming_api: '' })
    expect(body.thumbnail).toBe('https://llun.test/logo.png')
    expect(body.registrations).toBe(true)
    expect(body.rules).toEqual([{ id: rule.id, text: 'No spam', hint: '' }])
    expect(body.contact_account).toBeNull()
  })

  it('reflects database-backed server settings', async () => {
    await database.setServerSettings([
      {
        key: 'registrations.open',
        value: false
      },
      {
        key: 'posts.maxCharacters',
        value: 2000
      }
    ])
    invalidateServerSettingsCache(database)
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance'),
        params
      )
      const body = await response.json()
      expect(body.registrations).toBe(false)
      expect(body.configuration.statuses.max_characters).toBe(2000)
    } finally {
      await deleteServerSetting(db, { key: 'registrations.open' })
      await deleteServerSetting(db, { key: 'posts.maxCharacters' })
      invalidateServerSettingsCache(database)
    }
  })

  it('advertises the stored media ceiling as max_media_attachments', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    const body = await response.json()
    expect(body.configuration.statuses.max_media_attachments).toBe(
      MAX_STORED_MEDIA_ATTACHMENTS
    )
  })

  it('keeps serving the static payload when the database is unavailable', async () => {
    mockDatabase = null
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance'),
        params
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.uri).toBe('llun.test')
      expect(body.stats).toEqual({
        user_count: 0,
        status_count: 0,
        domain_count: 0
      })
      expect(body.rules).toEqual([])
      expect(body.contact_account).toBeNull()
    } finally {
      mockDatabase = database
    }
  })

  it('degrades to an empty rules list when getInstanceRules rejects but the database is present (still 200)', async () => {
    // The DB-unavailable test above sets mockDatabase = null, which short-circuits
    // the `if (database)` guard before the rules try/catch. This exercises the
    // catch itself: a present database whose getInstanceRules() rejects must still
    // return 200 with rules: [], not a 500 on the public endpoint.
    const rulesSpy = vi
      .spyOn(database, 'getInstanceRules')
      .mockRejectedValue(new Error('rules query failed'))
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance'),
        params
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.rules).toEqual([])
    } finally {
      rulesSpy.mockRestore()
    }
  })

  // Sign-ups are per domain: the request's domain decides, and a served domain
  // without open sign-ups of its own reports closed, whatever the primary says.
  it('describes the visited domain with its own identity', async () => {
    invalidateDomainIdentityCache(database)
    await database.createServedDomain({
      domain: 'alias.llun.test',
      name: 'Alias Club',
      description: 'The alias',
      contactEmail: 'hello@alias.llun.test'
    })
    const visit = async (host: string) =>
      (
        await GET(
          new NextRequest('https://llun.test/api/v1/instance', {
            headers: { host }
          }),
          params
        )
      ).json()
    try {
      await expect(visit('alias.llun.test')).resolves.toMatchObject({
        uri: 'alias.llun.test',
        title: 'Alias Club',
        short_description: 'The alias',
        description: 'The alias',
        email: 'hello@alias.llun.test'
      })
      // The primary keeps the server's.
      await expect(visit('llun.test')).resolves.toMatchObject({
        title: 'Activities.next',
        email: 'admin@llun.test'
      })
    } finally {
      await database.deleteServedDomain({ domain: 'alias.llun.test' })
      invalidateDomainIdentityCache(database)
    }
  })

  it('reports the registrations of the domain the request arrived on', async () => {
    await database.createServedDomain({
      domain: 'alias.llun.test',
      signupsOpen: true
    })
    try {
      const open = await (
        await GET(
          new NextRequest('https://llun.test/api/v1/instance', {
            headers: { host: 'alias.llun.test' }
          }),
          params
        )
      ).json()
      expect(open.registrations).toBe(true)

      await database.updateServedDomain({
        domain: 'alias.llun.test',
        signupsOpen: false
      })
      const closed = await (
        await GET(
          new NextRequest('https://llun.test/api/v1/instance', {
            headers: { host: 'alias.llun.test' }
          }),
          params
        )
      ).json()
      expect(closed.uri).toBe('alias.llun.test')
      expect(closed.registrations).toBe(false)
    } finally {
      await database.deleteServedDomain({ domain: 'alias.llun.test' })
    }
  })

  // A stale snapshot would not trust the visited Admin › Domains host yet and
  // describe the primary instead.
  it('refreshes a stale snapshot before reading the visited host', async () => {
    // Loaded before photos.llun.test was turned on, so it does not list it.
    await refreshServedDomains(database)
    await database.createServedDomain({
      domain: 'photos.llun.test',
      status: 'on',
      signupsOpen: false
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + SERVED_DOMAIN_REFRESH_MS + 1)
    try {
      const body = await (
        await GET(
          new NextRequest('https://llun.test/api/v1/instance', {
            headers: { host: 'photos.llun.test' }
          }),
          params
        )
      ).json()
      expect(body.uri).toBe('photos.llun.test')
      expect(body.registrations).toBe(false)
    } finally {
      vi.useRealTimers()
      resetServedDomainsForTests()
      await database.deleteServedDomain({ domain: 'photos.llun.test' })
    }
  })

  it('lists the server rules, then the visited domain’s own, on that host only', async () => {
    const own = await database.createInstanceRule({
      domain: 'alias.llun.test',
      text: 'Alias only',
      hint: 'Only here',
      position: 0
    })
    const elsewhere = await database.createInstanceRule({
      domain: 'other.llun.test',
      text: 'Elsewhere only',
      hint: '',
      position: 0
    })
    const rulesOn = async (host: string) =>
      (
        await (
          await GET(
            new NextRequest('https://llun.test/api/v1/instance', {
              headers: { host }
            }),
            params
          )
        ).json()
      ).rules as { id: string; text: string; hint: string }[]
    try {
      const alias = await rulesOn('alias.llun.test')
      const primary = await rulesOn('llun.test')

      // Server rules first, then the domain's own, ids unique.
      expect(alias.at(-1)).toEqual({
        id: own.id,
        text: 'Alias only',
        hint: 'Only here'
      })
      expect(alias.slice(0, -1)).toEqual(primary)
      expect(new Set(alias.map((rule) => rule.id)).size).toBe(alias.length)
      expect(primary.map((rule) => rule.id)).not.toContain(own.id)
      expect(alias.map((rule) => rule.id)).not.toContain(elsewhere.id)
    } finally {
      await database.deleteInstanceRule({ id: own.id })
      await database.deleteInstanceRule({ id: elsewhere.id })
    }
  })
})
