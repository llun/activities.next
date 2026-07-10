import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  }),
  getBaseURL: () => 'https://llun.test'
}))

describe('/api/v1/collections', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const postRequest = (body: unknown) =>
    new NextRequest('https://llun.test/api/v1/collections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // sameOriginProof requires the Origin to match the base URL for
        // state-changing methods.
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  const context = { params: Promise.resolve({}) }

  it('creates a collection and returns the wrapped Mastodon entity', async () => {
    const response = await POST(postRequest({ title: 'Cool people' }), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.collection.title).toBe('Cool people')
    expect(data.collection.name).toBe('Cool people')
    expect(data.collection.visibility).toBe('public')
    expect(data.collection.discoverable).toBe(true)
    expect(data.collection.sensitive).toBe(false)
    expect(data.collection.feed_enabled).toBe(true)
    expect(data.collection.size).toBe(0)
    expect(data.collection.item_count).toBe(0)
    expect(data.collection.items).toEqual([])
    expect(data.collection.local).toBe(true)
    expect(typeof data.collection.id).toBe('string')
    expect(data.collection.account_id).toBe('llun.test:users:test1')
    expect(data.collection.uri).toBe(
      `https://llun.test/users/test1/collections/featured-collections/${data.collection.id}`
    )
    expect(data.collection.url).toBe(
      `https://llun.test/collections/${data.collection.id}`
    )
  })

  it.each([
    {
      vocabulary: 'the Mastodon 4.6 params',
      body: {
        name: 'Wildlife photographers',
        tag_name: 'birds',
        discoverable: false,
        sensitive: true
      }
    },
    {
      vocabulary: 'the activities.next extension params',
      body: {
        title: 'Wildlife photographers',
        topic: 'birds',
        visibility: 'unlisted',
        sensitive: true
      }
    }
  ])('creates a collection from $vocabulary', async ({ body }) => {
    const response = await POST(postRequest(body), context)
    expect(response.status).toBe(200)
    const { collection } = await response.json()
    expect(collection.name).toBe('Wildlife photographers')
    expect(collection.title).toBe('Wildlife photographers')
    expect(collection.tag).toEqual({
      name: 'birds',
      url: 'https://llun.test/tags/birds'
    })
    expect(collection.topic).toBe('birds')
    expect(collection.discoverable).toBe(false)
    expect(collection.visibility).toBe('unlisted')
    expect(collection.sensitive).toBe(true)
  })

  it('prefers the spec vocabulary when both are present', async () => {
    const response = await POST(
      postRequest({
        name: 'Spec name',
        title: 'Extension title',
        discoverable: true,
        visibility: 'private'
      }),
      context
    )
    expect(response.status).toBe(200)
    const { collection } = await response.json()
    expect(collection.name).toBe('Spec name')
    expect(collection.visibility).toBe('public')
  })

  it('rejects a collection with neither name nor title', async () => {
    const response = await POST(
      postRequest({ description: 'no name at all' }),
      context
    )
    expect(response.status).toBe(422)
  })

  it('features initial members from account_ids as pending items', async () => {
    const response = await POST(
      postRequest({
        name: 'Seeded',
        account_ids: [urlToId(ACTOR2_ID)]
      }),
      context
    )
    expect(response.status).toBe(200)
    const { collection } = await response.json()
    expect(collection.item_count).toBe(1)
    expect(collection.items).toHaveLength(1)
    expect(collection.items[0]).toMatchObject({
      account_id: urlToId(ACTOR2_ID),
      state: 'pending'
    })
    expect(typeof collection.items[0].id).toBe('string')
    // The consent gate keeps un-approved members out of the public size.
    expect(collection.size).toBe(0)
  })

  it.each([
    { description: 'with spaces', topic: 'two words' },
    { description: 'with a # symbol', topic: '#tag' }
  ])('rejects a topic $description', async ({ topic }) => {
    const response = await POST(postRequest({ title: 'T', topic }), context)
    expect(response.status).toBe(422)
  })

  it('accepts a valid single-hashtag topic', async () => {
    const response = await POST(
      postRequest({ title: 'Topical', topic: 'fediverse' }),
      context
    )
    expect(response.status).toBe(200)
    expect((await response.json()).collection.topic).toBe('fediverse')
  })

  it('lists the actor’s collections', async () => {
    await POST(postRequest({ title: 'Another collection' }), context)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/collections'),
      context
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBeGreaterThanOrEqual(1)
    expect(
      data.some((c: { title: string }) => c.title === 'Another collection')
    ).toBe(true)
  })
})
