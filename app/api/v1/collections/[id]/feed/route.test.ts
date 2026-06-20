import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

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

describe('GET /api/v1/collections/[id]/feed', () => {
  const database = getTestSQLDatabase()
  let publicCollectionId: string
  let privateCollectionId: string
  let publicPostId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    await database.createAccount({
      email: `feedmember@${TEST_DOMAIN}`,
      username: 'feedmember',
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: 'pk',
      publicKey: 'pub'
    })
    const member = await database.getActorFromUsername({
      username: 'feedmember',
      domain: TEST_DOMAIN
    })
    if (!member) throw new Error('member not created')

    const publicCollection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Public feed',
      visibility: 'public',
      publicFeed: true
    })
    publicCollectionId = publicCollection.id
    const privateCollection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Private',
      visibility: 'private'
    })
    privateCollectionId = privateCollection.id

    for (const id of [publicCollectionId]) {
      await database.addCollectionMembers({
        id,
        actorId: ACTOR1_ID,
        targetActorIds: [member.id]
      })
      await database.setCollectionMemberState({
        id,
        actorId: ACTOR1_ID,
        targetActorId: member.id,
        state: 'approved'
      })
    }

    const post = await database.createNote({
      id: `${member.id}/statuses/feed-1`,
      url: `${member.id}/statuses/feed-1`,
      actorId: member.id,
      text: 'public feed post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    publicPostId = post.id
    await database.addStatusToCollectionTimelines({ status: post })

    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    // Public feed is unauthenticated.
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (id: string) =>
    new NextRequest(`https://llun.test/api/v1/collections/${id}/feed`)

  it('serves the public feed of a public collection', async () => {
    const response = await GET(request(publicCollectionId), {
      params: Promise.resolve({ id: publicCollectionId })
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toContain(
      urlToId(publicPostId)
    )
  })

  it('returns 404 for a private collection', async () => {
    const response = await GET(request(privateCollectionId), {
      params: Promise.resolve({ id: privateCollectionId })
    })
    expect(response.status).toBe(404)
  })

  it('returns 404 for a non-existent collection', async () => {
    const response = await GET(request('does-not-exist'), {
      params: Promise.resolve({ id: 'does-not-exist' })
    })
    expect(response.status).toBe(404)
  })
})
