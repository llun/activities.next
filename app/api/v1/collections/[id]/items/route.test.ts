import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

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

describe('/api/v1/collections/[id]/items', () => {
  const database = getTestSQLDatabase()
  let collectionId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Items'
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

  it('adds a single account (spec form) and returns WrappedCollectionItem', async () => {
    const response = await POST(
      postRequest({ account_id: urlToId(ACTOR2_ID) }),
      context()
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.collection_item).toMatchObject({
      account_id: urlToId(ACTOR2_ID),
      state: 'pending'
    })
    expect(typeof data.collection_item.id).toBe('string')
    expect(typeof data.collection_item.created_at).toBe('string')
  })

  it('keeps the bulk account_ids extension returning an empty object', async () => {
    const response = await POST(
      postRequest({ account_ids: [urlToId(ACTOR2_ID)] }),
      context()
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('rejects a body with neither account_id nor account_ids', async () => {
    const response = await POST(postRequest({}), context())
    expect(response.status).toBe(422)
  })

  it('answers 422 for an unknown publicId account id without writing a member row', async () => {
    const unknownPublicId = generatePublicId()
    const response = await POST(
      postRequest({ account_id: unknownPublicId }),
      context()
    )
    expect(response.status).toBe(422)
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: unknownPublicId
      })
    ).toBeNull()
  })

  it('ignores unknown publicId account ids in the bulk form and adds the rest', async () => {
    const unknownPublicId = generatePublicId()
    const response = await POST(
      postRequest({ account_ids: [unknownPublicId, urlToId(ACTOR3_ID)] }),
      context()
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: unknownPublicId
      })
    ).toBeNull()
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: ACTOR3_ID
      })
    ).toMatchObject({ targetActorId: ACTOR3_ID })
  })
})
