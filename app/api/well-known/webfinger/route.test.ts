import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { GET } from './route'

type MockDatabase = Pick<Database, 'getActorFromUsername'>

let mockDatabase: MockDatabase | null = null

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/well-known/webfinger', () => {
  const database: jest.Mocked<MockDatabase> = {
    getActorFromUsername: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = database
  })

  it('returns WebFinger JRD for a local actor', async () => {
    database.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/test',
      username: 'test',
      domain: 'example.com',
      privateKey: 'key'
    } as never)

    const response = await GET(
      new NextRequest(
        'https://example.com/.well-known/webfinger?resource=acct:test@example.com'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toStartWith(
      'application/jrd+json'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      subject: 'acct:test@example.com',
      aliases: ['https://example.com/@test', 'https://example.com/users/test']
    })
  })

  it('returns WebFinger JRD for the headless instance actor without a profile page link', async () => {
    database.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/__instance__',
      type: 'Service',
      username: '__instance__',
      domain: 'example.com',
      privateKey: 'key'
    } as never)

    const response = await GET(
      new NextRequest(
        'https://example.com/.well-known/webfinger?resource=acct:__instance__@example.com'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subject: 'acct:__instance__@example.com',
      aliases: ['https://example.com/users/__instance__']
    })
    expect(data.links).not.toContainEqual(
      expect.objectContaining({
        rel: 'http://webfinger.net/rel/profile-page'
      })
    )
  })

  it('returns 404 when the resource is missing', async () => {
    const response = await GET(
      new NextRequest('https://example.com/.well-known/webfinger'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
    expect(database.getActorFromUsername).not.toHaveBeenCalled()
  })

  it('returns 404 for cached remote actors', async () => {
    database.getActorFromUsername.mockResolvedValue({
      id: 'https://remote.example/users/test',
      username: 'test',
      domain: 'remote.example',
      privateKey: null
    } as never)

    const response = await GET(
      new NextRequest(
        'https://example.com/.well-known/webfinger?resource=acct:test@remote.example'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
  })
})
