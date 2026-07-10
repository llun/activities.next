import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, PATCH } from './route'

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

describe('/api/v1/collections/[id]', () => {
  const database = getTestSQLDatabase()
  let publicCollectionId: string
  let privateCollectionId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    const publicCollection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Nice accounts',
      topic: 'accounts',
      visibility: 'public'
    })
    publicCollectionId = publicCollection.id
    const privateCollection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Hidden',
      visibility: 'private'
    })
    privateCollectionId = privateCollection.id

    // actor2 is approved (publicly visible); an extra pending member proves the
    // public projection filters by consent.
    await database.createAccount({
      email: 'pending@llun.test',
      username: 'pending',
      passwordHash: 'hash',
      domain: 'llun.test',
      privateKey: 'pk',
      publicKey: 'pub'
    })
    const pending = await database.getActorFromUsername({
      username: 'pending',
      domain: 'llun.test'
    })
    if (!pending) throw new Error('pending member not created')
    await database.addCollectionMembers({
      id: publicCollectionId,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID, pending.id]
    })
    await database.setCollectionMemberState({
      id: publicCollectionId,
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      state: 'approved'
    })

    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue(null)
  })

  const getRequest = (id: string) =>
    new NextRequest(`https://llun.test/api/v1/collections/${id}`)
  const patchRequest = (id: string, body: unknown) =>
    new NextRequest(`https://llun.test/api/v1/collections/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  it('serves a discoverable collection anonymously as CollectionWithAccounts', async () => {
    const response = await GET(
      getRequest(publicCollectionId),
      context(publicCollectionId)
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.collection.id).toBe(publicCollectionId)
    expect(data.collection.name).toBe('Nice accounts')
    expect(data.collection.discoverable).toBe(true)
    // Public projection: the approved member only — pending consent never
    // leaks to anonymous viewers.
    expect(data.collection.items).toHaveLength(1)
    expect(data.collection.items[0]).toMatchObject({
      account_id: urlToId(ACTOR2_ID),
      state: 'accepted'
    })
    expect(data.collection.item_count).toBe(1)
    expect(data.accounts).toHaveLength(1)
    expect(data.accounts[0].id).toBe(urlToId(ACTOR2_ID))
  })

  it('returns 404 for a private collection read by a stranger', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await GET(
      getRequest(privateCollectionId),
      context(privateCollectionId)
    )
    expect(response.status).toBe(404)
  })

  it('returns 404 for a private collection read anonymously', async () => {
    const response = await GET(
      getRequest(privateCollectionId),
      context(privateCollectionId)
    )
    expect(response.status).toBe(404)
  })

  it('lets the owner read a private collection with all consent states', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const [privateResponse, publicResponse] = [
      await GET(getRequest(privateCollectionId), context(privateCollectionId)),
      await GET(getRequest(publicCollectionId), context(publicCollectionId))
    ]
    expect(privateResponse.status).toBe(200)
    const publicData = await publicResponse.json()
    // Owner projection: pending members are visible.
    expect(publicData.collection.items).toHaveLength(2)
    expect(publicData.collection.item_count).toBe(2)
    expect(
      publicData.collection.items.map((item: { state: string }) => item.state)
    ).toEqual(expect.arrayContaining(['accepted', 'pending']))
  })

  it.each([
    {
      vocabulary: 'name/tag_name',
      body: { name: 'Renamed', tag_name: 'birds' }
    },
    { vocabulary: 'title/topic', body: { title: 'Renamed', topic: 'birds' } }
  ])(
    'updates via $vocabulary and returns WrappedCollection',
    async ({ body }) => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const response = await PATCH(
        patchRequest(publicCollectionId, body),
        context(publicCollectionId)
      )
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.collection.name).toBe('Renamed')
      expect(data.collection.title).toBe('Renamed')
      expect(data.collection.topic).toBe('birds')
    }
  )

  it('maps discoverable=false to the unlisted visibility on update', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await PATCH(
      patchRequest(publicCollectionId, { discoverable: false }),
      context(publicCollectionId)
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.collection.discoverable).toBe(false)
    expect(data.collection.visibility).toBe('unlisted')
    // Restore for other tests.
    await PATCH(
      patchRequest(publicCollectionId, { discoverable: true }),
      context(publicCollectionId)
    )
  })
})
