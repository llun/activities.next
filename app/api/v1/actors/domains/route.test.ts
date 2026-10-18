import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/actors/domains', () => {
  const { database, db } = createTestDatabase({ backend: 'sqlite' })

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockGetConfig.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/actors/domains', {
      method: 'GET'
    })

  it('returns the host as the only domain when allowActorDomains is not set', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: []
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domains).toEqual(['llun.test'])
    expect(data.host).toBe('llun.test')
  })

  it('returns allowActorDomains when it is set', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
    // allowActorDomains is a database-backed federation setting.
    await database.setServerSettings([
      {
        key: 'federation.allowActorDomains',
        value: ['domain1.test', 'domain2.test', 'llun.test']
      }
    ])
    invalidateServerSettingsCache(database)

    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({})
      })

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.domains).toEqual([
        'domain1.test',
        'domain2.test',
        'llun.test'
      ])
      expect(data.host).toBe('llun.test')
    } finally {
      await deleteServerSetting(db, {
        key: 'federation.allowActorDomains'
      })
      invalidateServerSettingsCache(database)
    }
  })

  // A wildcard rule names no single domain, so it is not offered as one; the
  // concrete entries come back normalised and de-duplicated.
  it('offers only concrete, normalised domains', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
    await database.setServerSettings([
      {
        key: 'federation.allowActorDomains',
        value: ['Domain1.Test.', '*.people.test', 'domain1.test', 'llun.test']
      }
    ])
    invalidateServerSettingsCache(database)

    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({})
      })

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.domains).toEqual(['domain1.test', 'llun.test'])
    } finally {
      await deleteServerSetting(db, {
        key: 'federation.allowActorDomains'
      })
      invalidateServerSettingsCache(database)
    }
  })

  it('returns trusted host rules when allowActorDomains is not set', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['alias.llun.test', 'other.llun.test'],
      allowEmails: []
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domains).toEqual([
      'llun.test',
      'alias.llun.test',
      'other.llun.test'
    ])
    expect(data.host).toBe('llun.test')
  })

  // A wildcard allowActorDomains entry approves no domain, so neither it nor
  // the request host it covers is listed.
  it('does not list a request host that only an allowActorDomains wildcard covers', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['*.people.test'],
      allowEmails: []
    })
    await database.setServerSettings([
      {
        key: 'federation.allowActorDomains',
        value: ['llun.test', '*.people.test']
      }
    ])
    invalidateServerSettingsCache(database)

    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/actors/domains', {
          headers: { 'x-forwarded-host': 'Alice.People.Test' }
        }),
        { params: Promise.resolve({}) }
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.domains).toEqual(['llun.test'])
    } finally {
      await deleteServerSetting(db, {
        key: 'federation.allowActorDomains'
      })
      invalidateServerSettingsCache(database)
    }
  })

  // Without allowActorDomains a wildcard trusted host (there to believe
  // X-Forwarded-Host on preview deployments) approves no actor domain, so
  // neither it nor a request host it covers is listed.
  it('does not list a wildcard trusted host or a host it covers', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['alias.llun.test', '*.preview.test'],
      allowEmails: []
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/actors/domains', {
        headers: { 'x-forwarded-host': 'pr-1.preview.test' }
      }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domains).toEqual(['llun.test', 'alias.llun.test'])
    expect(data.host).toBe('pr-1.preview.test')
  })

  it('returns host from request headers', async () => {
    mockGetConfig.mockReturnValue({
      host: 'main.test',
      trustedHosts: ['alias.main.test'],
      allowEmails: []
    })

    const response = await GET(
      new NextRequest('https://main.test/api/v1/actors/domains', {
        headers: { 'x-forwarded-host': 'alias.main.test' }
      }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.host).toBe('alias.main.test')
  })

  // With allowActorDomains empty, the Admin › Domains list decides: an added
  // domain is offered only while it is on and lets existing users add
  // profiles.
  it('offers an added domain only while it is on with existing users allowed', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
    await database.createServedDomain({
      domain: 'run.test',
      status: 'on',
      allowExistingUsers: true
    })
    await database.createServedDomain({
      domain: 'birds.test',
      status: 'on',
      allowExistingUsers: false
    })
    await database.createServedDomain({
      domain: 'old.test',
      status: 'off',
      allowExistingUsers: true
    })

    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({})
      })
      const data = await response.json()
      expect(data.domains).toEqual(['llun.test', 'run.test'])

      // A non-empty allowActorDomains keeps today's behaviour: it is the list.
      await database.setServerSettings([
        { key: 'federation.allowActorDomains', value: ['llun.test'] }
      ])
      invalidateServerSettingsCache(database)
      const listed = await (
        await GET(createRequest(), { params: Promise.resolve({}) })
      ).json()
      expect(listed.domains).toEqual(['llun.test'])
    } finally {
      for (const domain of ['run.test', 'birds.test', 'old.test']) {
        await database.deleteServedDomain({ domain })
      }
      await deleteServerSetting(db, { key: 'federation.allowActorDomains' })
      invalidateServerSettingsCache(database)
    }
  })
})
