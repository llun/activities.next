import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { GET } from './route'

type MockDatabase = Pick<Database, 'getActorFromId' | 'getActorFromUsername'>

let mockDatabase: MockDatabase | null = null

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/well-known/webfinger', () => {
  const database: jest.Mocked<MockDatabase> = {
    getActorFromId: vi.fn(),
    getActorFromUsername: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    database.getActorFromId.mockResolvedValue(null)
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
    expect(data.links).toContainEqual(
      expect.objectContaining({
        rel: 'http://ostatus.org/schema/1.0/subscribe',
        template: 'https://test.llun.dev/authorize_interaction?uri={uri}'
      })
    )
  })

  it('returns the current handle for a renamed actor queried by its old handle', async () => {
    const actorId = 'https://old.example/users/alice'
    database.getActorFromUsername.mockResolvedValue({
      id: actorId,
      username: 'bob',
      domain: 'new.example',
      privateKey: 'key'
    } as never)

    const response = await GET(
      new NextRequest(
        'https://old.example/.well-known/webfinger?resource=acct%3Aalice%40old.example'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subject: 'acct:bob@new.example',
      aliases: expect.arrayContaining([
        'https://old.example/@alice',
        'https://old.example/users/alice'
      ])
    })
    expect(data.links).toContainEqual(
      expect.objectContaining({
        rel: 'self',
        type: 'application/activity+json',
        href: actorId
      })
    )
    expect(data.links).toContainEqual(
      expect.objectContaining({
        rel: 'self',
        type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        href: actorId
      })
    )
    expect(database.getActorFromUsername).toHaveBeenCalledWith({
      username: 'alice',
      domain: 'old.example'
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

  it('returns WebFinger JRD when queried with an actor URL resource', async () => {
    database.getActorFromUsername.mockResolvedValue({
      id: 'https://example.com/users/test',
      username: 'test',
      domain: 'example.com',
      privateKey: 'key'
    } as never)

    const response = await GET(
      new NextRequest(
        'https://example.com/.well-known/webfinger?resource=https%3A%2F%2Fexample.com%2Fusers%2Ftest'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(database.getActorFromUsername).toHaveBeenCalledWith({
      username: 'test',
      domain: 'example.com'
    })
    expect(database.getActorFromId).toHaveBeenCalledWith({
      id: 'https://example.com/users/test'
    })
    const data = await response.json()
    expect(data).toMatchObject({
      subject: 'acct:test@example.com',
      aliases: ['https://example.com/@test', 'https://example.com/users/test']
    })
  })

  it('resolves an actor URL by its exact immutable id before parsing a handle', async () => {
    const actorId = 'https://old.example/users/alice'
    database.getActorFromId.mockResolvedValue({
      id: actorId,
      username: 'bob',
      domain: 'new.example',
      privateKey: 'key'
    } as never)
    database.getActorFromUsername.mockResolvedValue({
      id: 'https://wrong.example/users/alice',
      username: 'alice',
      domain: 'old.example',
      privateKey: 'wrong-key'
    } as never)

    const response = await GET(
      new NextRequest(
        'https://old.example/.well-known/webfinger?resource=https%3A%2F%2Fold.example%2Fusers%2Falice'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.subject).toBe('acct:bob@new.example')
    expect(data.links).toContainEqual(
      expect.objectContaining({
        rel: 'self',
        type: 'application/activity+json',
        href: actorId
      })
    )
    expect(database.getActorFromId).toHaveBeenCalledWith({ id: actorId })
    expect(database.getActorFromUsername).not.toHaveBeenCalled()
  })
})
