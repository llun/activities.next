import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
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

describe('GET /api/v2/instance', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
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

  it('serves the instance payload for an unauthenticated request', async () => {
    // No OAuthGuard mock: the route must work without any Authorization header,
    // matching Mastodon's public v2 instance endpoint. If a guard is ever
    // re-added, this tokenless request would fail.
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })

  it('reports the configured host by default', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })

  it('reports a trusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance', {
        headers: { 'x-forwarded-host': 'alias.llun.test' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'alias.llun.test'
    })
  })

  it('ignores an untrusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance', {
        headers: { 'x-forwarded-host': 'evil.example' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      domain: 'llun.test'
    })
  })

  it('includes stored instance rules in position order', async () => {
    const second = await database.createInstanceRule({
      text: 'Be kind to each other',
      hint: 'Harassment is not tolerated',
      position: 2
    })
    const first = await database.createInstanceRule({
      text: 'No spam',
      hint: '',
      position: 1
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.rules).toEqual([
      { id: first.id, text: 'No spam', hint: '' },
      {
        id: second.id,
        text: 'Be kind to each other',
        hint: 'Harassment is not tolerated'
      }
    ])
  })

  it('completes the v2 entity with usage, thumbnail, icon and api versions', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    const body = await response.json()
    expect(body.usage).toEqual({ users: { active_month: 0 } })
    expect(body.thumbnail).toEqual({
      url: 'https://llun.test/logo.png',
      versions: {
        '@1x': 'https://llun.test/logo.png',
        '@2x': 'https://llun.test/logo.png'
      }
    })
    expect(body.icon).toEqual([
      { src: 'https://llun.test/icon-192.png', size: '192x192' },
      { src: 'https://llun.test/icon-512.png', size: '512x512' }
    ])
    expect(body.api_versions).toEqual({ mastodon: 2 })
  })

  it('serves streaming and vapid configuration', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    const body = await response.json()
    expect(body.configuration.urls).toEqual({ streaming: '' })
    expect(body.configuration.vapid).toEqual({
      public_key: 'test-vapid-public-key'
    })
  })

  it('advertises the stored media ceiling as max_media_attachments', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    const body = await response.json()
    expect(body.configuration.statuses.max_media_attachments).toBe(
      MAX_STORED_MEDIA_ATTACHMENTS
    )
  })

  it('serves the contact email with a null account when no admin exists', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    const body = await response.json()
    expect(body.contact).toEqual({ email: 'admin@llun.test', account: null })
  })

  it.each([
    {
      description: 'reports registrations enabled when registration is open',
      registrationOpen: true
    },
    {
      description: 'reports registrations closed when registration is closed',
      registrationOpen: false
    }
  ])('$description', async ({ registrationOpen }) => {
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue({
      ...baseConfig,
      registrationOpen
    } as unknown as Config)

    const response = await GET(
      new NextRequest('https://llun.test/api/v2/instance'),
      params
    )
    const body = await response.json()
    expect(body.registrations).toEqual({
      enabled: registrationOpen,
      approval_required: false,
      message: null,
      url: null
    })
  })

  it('returns empty rules instead of failing when the database is unavailable', async () => {
    mockDatabase = null
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v2/instance'),
        params
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.domain).toBe('llun.test')
      expect(body.rules).toEqual([])
      expect(body.usage).toEqual({ users: { active_month: 0 } })
      expect(body.contact).toEqual({
        email: 'admin@llun.test',
        account: null
      })
    } finally {
      mockDatabase = database
    }
  })

  it('maps usage.users.active_month from the active-month stat, not another counter', async () => {
    // Distinct counters so a wrong-field mapping (e.g. active_month = userCount)
    // is caught; with the empty test DB all four are 0 and indistinguishable.
    const nodeInfoSpy = vi
      .spyOn(database, 'getNodeInfoStats')
      .mockResolvedValue({
        totalUsers: 9,
        activeMonth: 6,
        activeHalfyear: 8,
        localPosts: 15
      })
    const peersSpy = vi
      .spyOn(database, 'getInstancePeers')
      .mockResolvedValue(['a.test', 'b.test', 'c.test', 'd.test'])
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v2/instance'),
        params
      )
      const body = await response.json()
      expect(body.usage.users.active_month).toBe(6)
    } finally {
      nodeInfoSpy.mockRestore()
      peersSpy.mockRestore()
    }
  })
})
