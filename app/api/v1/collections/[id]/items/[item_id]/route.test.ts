import { NextRequest } from 'next/server'

import { POST } from '@/app/api/v1/collections/[id]/items/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { DELETE } from './route'

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

describe('DELETE /api/v1/collections/[id]/items/[item_id]', () => {
  const database = getTestSQLDatabase()
  let collectionId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Removable items'
    })
    collectionId = collection.id
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
    new NextRequest(
      `https://llun.test/api/v1/collections/${collectionId}/items`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify(body)
      }
    )
  const context = () => ({ params: Promise.resolve({ id: collectionId }) })

  const deleteRequest = (itemId: string) =>
    new NextRequest(
      `https://llun.test/api/v1/collections/${collectionId}/items/${itemId}`,
      { method: 'DELETE', headers: { origin: 'https://llun.test' } }
    )
  const itemContext = (itemId: string) => ({
    params: Promise.resolve({ id: collectionId, item_id: itemId })
  })

  it('removes a membership addressed by the item id from the spec POST', async () => {
    const created = await POST(
      postRequest({ account_id: urlToId(ACTOR2_ID) }),
      context()
    )
    const { collection_item } = await created.json()

    const response = await DELETE(
      deleteRequest(collection_item.id),
      itemContext(collection_item.id)
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(
      await database.getCollectionItem({
        collectionId,
        itemId: collection_item.id
      })
    ).toBeNull()
  })

  it('returns 404 for an unknown item id', async () => {
    const response = await DELETE(
      deleteRequest('missing'),
      itemContext('missing')
    )
    expect(response.status).toBe(404)
  })

  it('returns 404 when the caller does not own the collection', async () => {
    const created = await POST(
      postRequest({ account_id: urlToId(ACTOR2_ID) }),
      context()
    )
    const { collection_item } = await created.json()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await DELETE(
      deleteRequest(collection_item.id),
      itemContext(collection_item.id)
    )
    expect(response.status).toBe(404)
  })
})
