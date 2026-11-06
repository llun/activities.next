import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  type StoredTokenSeed,
  hashToken,
  stubAccessTokenLookup
} from '@/lib/services/guards/OAuthGuard.testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { MAX_BOOKMARK_FOLDERS_PER_ACTOR } from '@/lib/types/domain/bookmark'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { DELETE, PATCH } from './[id]/route'
import { GET, POST } from './route'

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

const mockStoredTokens = new Map<string, StoredTokenSeed>()

const BASE = 'https://llun.test/api/v1/bookmark_folders'

const request = (
  method: string,
  path = '',
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: {
      Origin: 'https://llun.test',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

const noParams = { params: Promise.resolve({}) }
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('/api/v1/bookmark_folders', () => {
  const { database, db, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    stubAccessTokenLookup(database, (hashedToken) =>
      mockStoredTokens.get(hashedToken)
    )
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoredTokens.clear()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      referenceId: ACTOR1_ID,
      clientId: 'client-app-1',
      expiresAt: Date.now() + 3600000,
      scopes: JSON.stringify(scopes)
    })
  }

  const createFolder = async (actorId: string, name: string) => {
    const result = await database.createBookmarkFolder({ actorId, name })
    if (result.status !== 'ok') throw new Error(result.status)
    return result.folder
  }

  describe('auth and scopes', () => {
    it('needs a signed-in actor', async () => {
      mockGetServerSession.mockResolvedValue(null)
      expect((await GET(request('GET'), noParams)).status).toBe(401)
      expect(
        (await POST(request('POST', '', { name: 'x' }), noParams)).status
      ).toBe(401)
      expect(
        (await PATCH(request('PATCH', '/x', { name: 'y' }), idParams('x')))
          .status
      ).toBe(401)
      expect(
        (await DELETE(request('DELETE', '/x'), idParams('x'))).status
      ).toBe(401)
    })

    it.each(['read', 'read:bookmarks'])(
      'GET takes a token with only %s',
      async (scope) => {
        mockGetServerSession.mockResolvedValue(null)
        setToken('read-token', [scope])
        const response = await GET(
          request('GET', '', undefined, {
            Authorization: 'Bearer read-token'
          }),
          noParams
        )
        expect(response.status).toBe(200)
      }
    )

    it('GET refuses a token with an unrelated scope', async () => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('statuses-token', ['read:statuses'])
      const response = await GET(
        request('GET', '', undefined, {
          Authorization: 'Bearer statuses-token'
        }),
        noParams
      )
      expect(response.status).toBe(401)
    })

    it('POST takes write:bookmarks and refuses read:bookmarks', async () => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('write-token', ['write:bookmarks'])
      setToken('read-only-token', ['read:bookmarks'])
      const created = await POST(
        request(
          'POST',
          '',
          { name: `Token ${randomUUID()}` },
          { Authorization: 'Bearer write-token' }
        ),
        noParams
      )
      expect(created.status).toBe(200)
      const refused = await POST(
        request(
          'POST',
          '',
          { name: `Token ${randomUUID()}` },
          { Authorization: 'Bearer read-only-token' }
        ),
        noParams
      )
      expect(refused.status).toBe(401)
    })
  })

  it("GET lists only the viewer's folders, by name, without counts", async () => {
    const suffix = randomUUID()
    await createFolder(ACTOR1_ID, `beta ${suffix}`)
    await createFolder(ACTOR1_ID, `Alpha ${suffix}`)
    await createFolder(ACTOR2_ID, `Alpha other ${suffix}`)

    const response = await GET(request('GET'), noParams)

    expect(response.status).toBe(200)
    const folders = (await response.json()) as Record<string, unknown>[]
    const mine = folders.filter((folder) =>
      String(folder.name).endsWith(suffix)
    )
    expect(mine.map((folder) => folder.name)).toEqual([
      `Alpha ${suffix}`,
      `beta ${suffix}`
    ])
    expect(Object.keys(mine[0]).sort()).toEqual([
      'created_at',
      'id',
      'name',
      'updated_at'
    ])
    expect(mine[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  it('POST creates a trimmed folder', async () => {
    const name = `Recipes ${randomUUID()}`
    const response = await POST(
      request('POST', '', { name: `  ${name}  ` }),
      noParams
    )

    expect(response.status).toBe(200)
    const folder = await response.json()
    expect(folder).toMatchObject({ id: expect.any(String), name })
    await expect(
      database.getBookmarkFolder({ id: folder.id, actorId: ACTOR1_ID })
    ).resolves.toMatchObject({ name })
  })

  it.each([
    ['no body', undefined],
    ['a blank name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(121) }],
    ['a non-string name', { name: 12 }]
  ])('POST answers 422 for %s', async (_, body) => {
    const response = await POST(request('POST', '', body), noParams)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })

  it('POST answers 422 for a duplicate name, ignoring case', async () => {
    const name = `Travel ${randomUUID()}`
    await createFolder(ACTOR1_ID, name)
    const response = await POST(
      request('POST', '', { name: name.toUpperCase() }),
      noParams
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'You already have a folder with that name'
    })
  })

  it('POST answers 422 past the folder cap', async () => {
    const actor = await database.getActorFromId({ id: ACTOR3_ID })
    mockGetServerSession.mockResolvedValue({
      user: { email: actor!.account!.email }
    })
    const count = (await database.getBookmarkFolders({ actorId: ACTOR3_ID }))
      .length
    const now = new Date()
    await db
      .insertInto('bookmark_folders')
      .values(
        Array.from(
          { length: MAX_BOOKMARK_FOLDERS_PER_ACTOR - count },
          (_, index) => ({
            id: randomUUID(),
            actorId: ACTOR3_ID,
            name: `cap ${index}`,
            createdAt: now,
            updatedAt: now
          })
        )
      )
      .execute()

    const response = await POST(
      request('POST', '', { name: 'One too many' }),
      noParams
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: `You can have up to ${MAX_BOOKMARK_FOLDERS_PER_ACTOR} bookmark folders`
    })
  })

  it('PATCH renames, and 422s a duplicate or blank name', async () => {
    const folder = await createFolder(ACTOR1_ID, `Old ${randomUUID()}`)
    const taken = await createFolder(ACTOR1_ID, `Taken ${randomUUID()}`)
    const name = `New ${randomUUID()}`

    const renamed = await PATCH(
      request('PATCH', `/${folder.id}`, { name }),
      idParams(folder.id)
    )
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ id: folder.id, name })

    const duplicate = await PATCH(
      request('PATCH', `/${folder.id}`, { name: taken.name.toLowerCase() }),
      idParams(folder.id)
    )
    expect(duplicate.status).toBe(422)

    const blank = await PATCH(
      request('PATCH', `/${folder.id}`, { name: '' }),
      idParams(folder.id)
    )
    expect(blank.status).toBe(422)
  })

  it("PATCH and DELETE answer 404 for another actor's folder", async () => {
    const theirs = await createFolder(ACTOR2_ID, `Theirs ${randomUUID()}`)

    const patched = await PATCH(
      request('PATCH', `/${theirs.id}`, { name: 'Mine now' }),
      idParams(theirs.id)
    )
    expect(patched.status).toBe(404)
    expect(await patched.json()).toEqual({ error: 'Not Found' })
    const invalid = await PATCH(
      request('PATCH', `/${theirs.id}`, { name: '' }),
      idParams(theirs.id)
    )
    expect(invalid.status).toBe(404)
    const deleted = await DELETE(
      request('DELETE', `/${theirs.id}`),
      idParams(theirs.id)
    )
    expect(deleted.status).toBe(404)

    await expect(
      database.getBookmarkFolder({ id: theirs.id, actorId: ACTOR2_ID })
    ).resolves.toMatchObject({ name: theirs.name })
  })

  it('DELETE removes the folder and keeps its bookmarks, unfiled', async () => {
    const folder = await createFolder(ACTOR1_ID, `Delete ${randomUUID()}`)
    const statusId = `${ACTOR2_ID}/statuses/folder-route-${randomUUID()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'Filed',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.fileBookmark({
      actorId: ACTOR1_ID,
      statusId,
      folderId: folder.id
    })

    const response = await DELETE(
      request('DELETE', `/${folder.id}`),
      idParams(folder.id)
    )

    expect(response.status).toBe(200)
    await expect(
      database.getBookmarkFolder({ id: folder.id, actorId: ACTOR1_ID })
    ).resolves.toBeNull()
    const [bookmark] = await database.getBookmarks({
      actorId: ACTOR1_ID,
      limit: 1
    })
    expect(bookmark).toMatchObject({ statusId, folderId: null })
  })
})
