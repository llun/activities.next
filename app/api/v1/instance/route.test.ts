import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

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

describe('GET /api/v1/instance', () => {
  const database = getTestSQLDatabase()

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

  it('reports the configured host by default', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance'),
      params
    )
    await expect(response.json()).resolves.toMatchObject({ uri: 'llun.test' })
  })

  it('reports a trusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance', {
        headers: { 'x-forwarded-host': 'alias.llun.test' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({
      uri: 'alias.llun.test'
    })
  })

  it('ignores an untrusted forwarded host', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/instance', {
        headers: { 'x-forwarded-host': 'evil.example' }
      }),
      params
    )
    await expect(response.json()).resolves.toMatchObject({ uri: 'llun.test' })
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
    await database.setServerSetting({
      key: 'registrations.open',
      value: false
    })
    await database.setServerSetting({
      key: 'posts.maxCharacters',
      value: 2000
    })
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
      await database.deleteServerSetting({ key: 'registrations.open' })
      await database.deleteServerSetting({ key: 'posts.maxCharacters' })
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
})
