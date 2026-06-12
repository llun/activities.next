import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['alias.llun.test'],
    serviceName: undefined,
    serviceDescription: undefined,
    languages: ['en'],
    mediaStorage: undefined
  })
}))

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
    } finally {
      mockDatabase = database
    }
  })
})
