import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: []
  })
}))

const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance/rules', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  it('returns stored rules as Mastodon Rule entities in position order', async () => {
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
      new NextRequest('https://llun.test/api/v1/instance/rules'),
      params
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      { id: first.id, text: 'No spam', hint: '' },
      {
        id: second.id,
        text: 'Be kind to each other',
        hint: 'Harassment is not tolerated'
      }
    ])
  })

  it('returns an error when the database is unavailable', async () => {
    mockDatabase = null
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/rules'),
        params
      )
      expect(response.status).toBe(500)
    } finally {
      mockDatabase = database
    }
  })

  it('returns a JSON 500 when loading rules throws', async () => {
    const spy = vi
      .spyOn(database, 'getInstanceRules')
      .mockRejectedValueOnce(new Error('connection lost'))
    try {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/rules'),
        params
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'Failed to load rules'
      })
    } finally {
      spy.mockRestore()
    }
  })

  it('adds the visited domain’s own rules after the server rules, on that host only', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['club.llun.test'],
      secretPhase: 'test-secret',
      allowEmails: []
    } as unknown as ReturnType<typeof getConfig>)
    const own = await database.createInstanceRule({
      domain: 'club.llun.test',
      text: 'Club only',
      hint: 'Only on the club',
      position: 0
    })
    const elsewhere = await database.createInstanceRule({
      domain: 'other.llun.test',
      text: 'Elsewhere only',
      hint: '',
      position: 0
    })
    const rulesOn = async (host: string) => {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/instance/rules', {
          headers: { host }
        }),
        params
      )
      expect(response.status).toBe(200)
      return (await response.json()) as { id: string; text: string }[]
    }
    try {
      const club = await rulesOn('club.llun.test')
      const primary = await rulesOn('llun.test')
      const untrusted = await rulesOn('evil.example')

      expect(club.at(-1)).toEqual({
        id: own.id,
        text: 'Club only',
        hint: 'Only on the club'
      })
      expect(club.slice(0, -1)).toEqual(primary)
      expect(untrusted).toEqual(primary)
      expect(primary.map((rule) => rule.id)).not.toContain(own.id)
      expect(club.map((rule) => rule.id)).not.toContain(elsewhere.id)
    } finally {
      await database.deleteInstanceRule({ id: own.id })
      await database.deleteInstanceRule({ id: elsewhere.id })
    }
  })
})
