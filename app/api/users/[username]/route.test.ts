import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

const mockDatabase = {}
let mockActor: Actor = {
  id: 'https://example.com/users/test',
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: 'https://example.com/users/test/followers',
  inboxUrl: 'https://example.com/users/test/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(mockDatabase, mockActor, req, query)
}))

const createRequest = (accept: string) =>
  new NextRequest('https://example.com/api/users/test', {
    headers: { accept }
  })

describe('GET /api/users/[username]', () => {
  beforeEach(() => {
    mockActor = {
      id: 'https://example.com/users/test',
      username: 'test',
      domain: 'example.com',
      name: 'Test Actor',
      summary: '',
      followersUrl: 'https://example.com/users/test/followers',
      inboxUrl: 'https://example.com/users/test/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: 1,
      updatedAt: 1,
      publicKey: 'public-key'
    }
  })

  it('returns ActivityPub JSON for combined weighted Accept headers', async () => {
    const response = await GET(
      createRequest(
        'application/json;q=0.9, application/activity+json;q=1, text/html;q=0.8'
      ),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      id: 'https://example.com/users/test',
      type: 'Person',
      preferredUsername: 'test'
    })
  })

  it('returns JSON-LD when the ActivityStreams profile is requested', async () => {
    const response = await GET(
      createRequest(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
      ),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    )
  })

  it('returns ActivityPub JSON for wildcard Accept headers', async () => {
    const response = await GET(createRequest('*/*'), {
      params: Promise.resolve({ username: 'test' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )
  })

  it('redirects to the profile page when HTML is preferred', async () => {
    const response = await GET(
      createRequest('text/html, application/xhtml+xml, */*;q=0.8'),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/@test')
    expect(response.headers.get('server')).toBe('activities.next')
    expect(response.headers.get('vary')).toBe('Accept')
  })

  it('returns a Service actor for the headless instance actor', async () => {
    mockActor = {
      ...mockActor,
      id: 'https://example.com/users/__instance__',
      type: 'Service',
      username: '__instance__',
      name: 'Instance actor',
      privateKey: 'private-key'
    }

    const response = await GET(createRequest('application/activity+json'), {
      params: Promise.resolve({ username: '__instance__' })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      id: 'https://example.com/users/__instance__',
      type: 'Service',
      preferredUsername: '__instance__',
      url: 'https://example.com/users/__instance__'
    })
  })

  it('does not redirect the headless instance actor to itself when HTML is preferred', async () => {
    mockActor = {
      ...mockActor,
      id: 'https://example.com/users/__instance__',
      type: 'Service',
      username: '__instance__',
      name: 'Instance actor',
      privateKey: 'private-key'
    }

    const response = await GET(
      createRequest('text/html, application/xhtml+xml, */*;q=0.8'),
      { params: Promise.resolve({ username: '__instance__' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      id: 'https://example.com/users/__instance__',
      type: 'Service',
      preferredUsername: '__instance__'
    })
  })

  it('redirects generic Service actors that are not the headless signer', async () => {
    mockActor = {
      ...mockActor,
      id: 'https://example.com/users/service',
      type: 'Service',
      username: 'service',
      name: 'Service actor'
    }

    const response = await GET(
      createRequest('text/html, application/xhtml+xml, */*;q=0.8'),
      { params: Promise.resolve({ username: 'service' }) }
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://example.com/@service'
    )
  })
})
