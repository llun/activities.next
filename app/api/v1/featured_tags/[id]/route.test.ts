import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

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
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const deleteRequest = (id: string, query = '') =>
  new NextRequest(`https://llun.test/api/v1/featured_tags/${id}${query}`, {
    method: 'DELETE',
    headers: { host: 'llun.test', origin: 'https://llun.test' }
  })

const invoke = (id: string, query = '') =>
  DELETE(deleteRequest(id, query), { params: Promise.resolve({ id }) })

describe('DELETE /api/v1/featured_tags/:id', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unfeatures a tag owned by the current user', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const created = await database.createFeaturedTag({
      actorId: ACTOR1_ID,
      name: 'removeme'
    })

    const response = await invoke(created.id)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(
      (await database.getFeaturedTags({ actorId: ACTOR1_ID })).find(
        (tag) => tag.id === created.id
      )
    ).toBeUndefined()
  })

  it('returns 404 when the tag belongs to another account', async () => {
    const owned = await database.createFeaturedTag({
      actorId: ACTOR1_ID,
      name: 'notyours'
    })
    // Actor2 tries to delete Actor1's featured tag.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const response = await invoke(owned.id)
    expect(response.status).toBe(404)
    // The tag still exists for its owner.
    expect(
      (await database.getFeaturedTags({ actorId: ACTOR1_ID })).find(
        (tag) => tag.id === owned.id
      )
    ).toBeDefined()
  })

  it('returns 404 for an unknown id', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await invoke('does-not-exist')
    expect(response.status).toBe(404)
  })

  it('returns 409 and deletes nothing when the expected actor differs', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const created = await database.createFeaturedTag({
      actorId: ACTOR1_ID,
      name: 'staledelete'
    })

    const response = await invoke(created.id, '?actorId=another-actor')
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Actor changed' })
    expect(
      (await database.getFeaturedTags({ actorId: ACTOR1_ID })).find(
        (tag) => tag.id === created.id
      )
    ).toBeDefined()
  })

  it('deletes when the expected actor is the current one', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const created = await database.createFeaturedTag({
      actorId: ACTOR1_ID,
      name: 'sameactordelete'
    })

    const response = await invoke(created.id, `?actorId=${ACTOR1_ID}`)
    expect(response.status).toBe(200)
    expect(
      (await database.getFeaturedTags({ actorId: ACTOR1_ID })).find(
        (tag) => tag.id === created.id
      )
    ).toBeUndefined()
  })
})
