import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Status } from '@/lib/types/domain/status'
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
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  }),
  getBaseURL: () => 'https://llun.test'
}))

describe('GET /api/v1/timelines/collection/[id]', () => {
  const database = getTestSQLDatabase()
  let collectionId: string
  let memberPost: Status
  let nonMemberPost: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Curated'
    })
    collectionId = collection.id
    await database.addCollectionMembers({
      id: collectionId,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID]
    })
    await database.setCollectionMemberState({
      id: collectionId,
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      state: 'approved'
    })

    memberPost = await database.createNote({
      id: `${ACTOR2_ID}/statuses/collection-1`,
      url: `${ACTOR2_ID}/statuses/collection-1`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'collection timeline post'
    })
    await database.addStatusToCollectionTimelines({ status: memberPost })

    nonMemberPost = await database.createNote({
      id: `${ACTOR3_ID}/statuses/collection-outsider`,
      url: `${ACTOR3_ID}/statuses/collection-outsider`,
      actorId: ACTOR3_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'not in the collection'
    })
    await database.addStatusToCollectionTimelines({ status: nonMemberPost })

    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const request = (params: Record<string, string> = {}, id = collectionId) => {
    const url = new URL(`https://llun.test/api/v1/timelines/collection/${id}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }
  const context = (id = collectionId) => ({ params: Promise.resolve({ id }) })

  it("returns only approved members' posts, newest first, and excludes non-members", async () => {
    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      id: string
      account: { id: string }
    }[]
    expect(data[0].id).toBe(await statusPublicId(database, memberPost.id))
    expect(data.length).toBeGreaterThan(0)
    const memberPublicId = (
      await database.getActorPublicIds({ actorIds: [ACTOR2_ID] })
    ).get(ACTOR2_ID)
    expect(new Set(data.map((status) => status.account.id))).toEqual(
      new Set([memberPublicId])
    )
    expect(data.map((status) => status.id)).not.toContain(
      await statusPublicId(database, nonMemberPost.id)
    )
  })

  it('advertises next and prev Link cursors that are publicIds of the page boundaries', async () => {
    const response = await GET(request({ limit: '5' }), context())

    const data = (await response.json()) as { id: string }[]
    const link = response.headers.get('Link') ?? ''
    const base = `<https://llun.test/api/v1/timelines/collection/${collectionId}?limit=5`
    expect(link).toContain(
      `${base}&max_id=${data[data.length - 1].id}>; rel="next"`
    )
    expect(link).toContain(`${base}&min_id=${data[0].id}>; rel="prev"`)
  })

  it('omits the Link header and returns [] for an empty collection', async () => {
    const empty = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Empty'
    })

    const response = await GET(request({}, empty.id), context(empty.id))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  it('returns the activities_next domain shape with cursors in the body', async () => {
    const response = await GET(
      request({ format: 'activities_next' }),
      context()
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    const ids = data.statuses.map((status: { id: string }) => status.id)
    expect(ids[0]).toBe(memberPost.id)
    expect(ids).not.toContain(nonMemberPost.id)
    expect(data.prevMinStatusId).toBe(ids[0])
    expect(data.nextMaxStatusId).toBe(ids[ids.length - 1])
    expect(response.headers.get('Link')).toBeNull()
  })

  it('answers 404 for an unknown collection', async () => {
    const response = await GET(
      request({}, 'does-not-exist'),
      context('does-not-exist')
    )

    expect(response.status).toBe(404)
  })

  it('answers 404 when the collection belongs to someone else, even though it has posts', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const response = await GET(request(), context())

    expect(response.status).toBe(404)
  })

  it('answers 401 when the caller is not signed in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(request(), context())

    expect(response.status).toBe(401)
  })

  it.each([{ field: 'max_id' }, { field: 'min_id' }, { field: 'since_id' }])(
    'answers 400 (not 500) for a malformed $field cursor',
    async ({ field }) => {
      const response = await GET(request({ [field]: 'apurl_@@@@' }), context())

      expect(response.status).toBe(400)
    }
  )

  it('resolves a publicId max_id cursor to the stored status URI and queries the owner projection', async () => {
    const spy = vi.spyOn(database, 'getCollectionTimeline')

    await GET(
      request({
        max_id: await statusPublicId(database, memberPost.id),
        limit: '7'
      }),
      context()
    )

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: collectionId,
        actorId: ACTOR1_ID,
        projection: 'owner',
        limit: 7,
        maxStatusId: memberPost.id
      })
    )
  })

  it('uses since_id as the lower bound when min_id is absent, and prefers min_id when both are sent', async () => {
    const minUrl = 'https://llun.test/users/test2/statuses/min-cursor'
    const sinceUrl = 'https://llun.test/users/test2/statuses/since-cursor'
    const spy = vi
      .spyOn(database, 'getCollectionTimeline')
      .mockResolvedValue([])

    await GET(request({ since_id: urlToId(sinceUrl) }), context())
    expect(spy.mock.calls[0][0]).toMatchObject({ minStatusId: sinceUrl })

    await GET(
      request({ min_id: urlToId(minUrl), since_id: urlToId(sinceUrl) }),
      context()
    )
    expect(spy.mock.calls[1][0]).toMatchObject({ minStatusId: minUrl })
  })

  describe('keyword filters (home context)', () => {
    let hiddenPost: Status
    let warnedPost: Status

    beforeAll(async () => {
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Hide collection spoilers',
        context: ['home'],
        filterAction: 'hide',
        expiresAt: null,
        keywords: [{ keyword: 'collspoiler', wholeWord: false }]
      })
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Warn collection words',
        context: ['home'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: [{ keyword: 'collwarn', wholeWord: false }]
      })
      hiddenPost = await database.createNote({
        id: `${ACTOR2_ID}/statuses/collection-hidden`,
        url: `${ACTOR2_ID}/statuses/collection-hidden`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'collspoiler ahead'
      })
      warnedPost = await database.createNote({
        id: `${ACTOR2_ID}/statuses/collection-warned`,
        url: `${ACTOR2_ID}/statuses/collection-warned`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'collwarn inside'
      })
    })

    it.each([{ format: undefined }, { format: 'activities_next' }])(
      'drops hide-filtered posts from the page (format=$format)',
      async ({ format }) => {
        vi.spyOn(database, 'getCollectionTimeline').mockResolvedValue([
          memberPost,
          hiddenPost
        ])

        const response = await GET(request(format ? { format } : {}), context())

        const body = await response.json()
        const ids = format
          ? body.statuses.map((s: { id: string }) => s.id)
          : body.map((s: { id: string }) => s.id)
        const expectedKept = format
          ? memberPost.id
          : await statusPublicId(database, memberPost.id)
        const expectedDropped = format
          ? hiddenPost.id
          : await statusPublicId(database, hiddenPost.id)
        expect(ids).toContain(expectedKept)
        expect(ids).not.toContain(expectedDropped)
      }
    )

    it('keeps the next cursor when the whole page is hidden so older posts stay reachable', async () => {
      vi.spyOn(database, 'getCollectionTimeline').mockResolvedValue([
        hiddenPost
      ])

      const response = await GET(request(), context())

      expect(await response.json()).toEqual([])
      expect(response.headers.get('Link') ?? '').toContain('rel="next"')
    })

    it('keeps warn-filtered posts and annotates them with the matching filter', async () => {
      vi.spyOn(database, 'getCollectionTimeline').mockResolvedValue([
        warnedPost
      ])

      const response = await GET(request(), context())

      const [entity] = await response.json()
      expect(entity.id).toBe(await statusPublicId(database, warnedPost.id))
      expect(entity.filtered).toHaveLength(1)
      expect(entity.filtered[0].filter.title).toBe('Warn collection words')
    })
  })
})
