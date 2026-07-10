import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
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

describe('POST /api/v1/collections/[id]/items/[item_id]/revoke', () => {
  const database = getTestSQLDatabase()
  let collectionId: string
  let itemId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Consenting members'
    })
    collectionId = collection.id
    await database.addCollectionMembers({
      id: collectionId,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID]
    })
    const item = await database.getCollectionItemByAccount({
      collectionId,
      targetActorId: ACTOR2_ID
    })
    itemId = item?.id ?? ''
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

  const revokeRequest = (segment: string) =>
    new NextRequest(
      `https://llun.test/api/v1/collections/${collectionId}/items/${segment}/revoke`,
      { method: 'POST', headers: { origin: 'https://llun.test' } }
    )
  const revokeContext = (segment: string) => ({
    params: Promise.resolve({ id: collectionId, item_id: segment })
  })

  it('lets the member revoke their own inclusion by item id', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await POST(revokeRequest(itemId), revokeContext(itemId))
    expect(response.status).toBe(200)
    expect(
      await database.getCollectionItem({ collectionId, itemId })
    ).toMatchObject({ featureState: 'revoked' })
  })

  it('returns 404 (not 403) when the item belongs to someone else, hiding membership', async () => {
    // The collection owner is NOT the member; acting on someone else's item is
    // rejected. It must answer 404 — indistinguishable from the unknown-item
    // case below — so a non-owner cannot use a 403/404 split to probe another
    // account's membership/consent state.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await POST(revokeRequest(itemId), revokeContext(itemId))
    expect(response.status).toBe(404)
  })

  it('keeps the legacy account-id addressing working for the member', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const segment = urlToId(ACTOR2_ID)
    const response = await POST(revokeRequest(segment), revokeContext(segment))
    expect(response.status).toBe(200)
  })

  it('returns 404 for an unknown item', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await POST(
      revokeRequest('missing'),
      revokeContext('missing')
    )
    expect(response.status).toBe(404)
  })
})
