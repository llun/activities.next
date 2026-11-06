import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const file = (statusId: string, body: unknown) =>
  PUT(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/bookmark_folder`,
      {
        method: 'PUT',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('PUT /api/v1/statuses/[id]/bookmark_folder', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createStatus = async () => {
    const statusId = `${ACTOR2_ID}/statuses/file-route-${randomUUID()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'To be filed',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    return statusId
  }

  const createFolder = async (actorId: string) => {
    const result = await database.createBookmarkFolder({
      actorId,
      name: `Route ${randomUUID()}`
    })
    if (result.status !== 'ok') throw new Error(result.status)
    return result.folder
  }

  it('needs a signed-in actor, and its 401 carries the CORS headers', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await file(await createStatus(), { folder_id: null })
    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PUT'
    )
  })

  it('bookmarks and files an unbookmarked status, then null unfiles it', async () => {
    const statusId = await createStatus()
    const folder = await createFolder(ACTOR1_ID)

    const filed = await file(statusId, { folder_id: folder.id })

    expect(filed.status).toBe(200)
    await expect(filed.json()).resolves.toMatchObject({
      uri: statusId,
      bookmarked: true,
      bookmark_folder_id: folder.id
    })

    const unfiled = await file(statusId, { folder_id: null })

    expect(unfiled.status).toBe(200)
    await expect(unfiled.json()).resolves.toMatchObject({
      uri: statusId,
      bookmarked: true,
      bookmark_folder_id: null
    })
    await expect(
      database.isActorBookmarkedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBe(true)
  })

  it("answers 404 for another actor's folder and bookmarks nothing", async () => {
    const statusId = await createStatus()
    const theirs = await createFolder(ACTOR2_ID)

    const response = await file(statusId, { folder_id: theirs.id })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Bookmark folder not found'
    })
    await expect(
      database.isActorBookmarkedStatus({ actorId: ACTOR1_ID, statusId })
    ).resolves.toBe(false)
  })

  it('answers 404 for an unknown status', async () => {
    const response = await file(
      `${ACTOR2_ID}/statuses/missing-${randomUUID()}`,
      { folder_id: null }
    )
    expect(response.status).toBe(404)
  })

  it.each([
    ['a missing folder_id', {}],
    ['a numeric folder_id', { folder_id: 3 }],
    ['an empty folder_id', { folder_id: '' }]
  ])('answers 422 for %s', async (_, body) => {
    const response = await file(await createStatus(), body)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })
})
