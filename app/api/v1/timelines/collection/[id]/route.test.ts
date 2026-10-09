import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { ACTOR6_ID } from '@/lib/stub/seed/actor6'
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

  it("lists every member's posts for the owner, newest first, without non-members", async () => {
    // ACTOR5 and ACTOR6 have no seeded posts, so this collection holds exactly
    // the notes created here. The owner's feed covers pending members too.
    const ordering = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Ordering'
    })
    await database.addCollectionMembers({
      id: ordering.id,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR5_ID, ACTOR6_ID]
    })
    await database.setCollectionMemberState({
      id: ordering.id,
      actorId: ACTOR1_ID,
      targetActorId: ACTOR5_ID,
      state: 'approved'
    })
    const base = Date.UTC(2026, 0, 1)
    const note = async (actorId: string, name: string, offset: number) => {
      const status = await database.createNote({
        id: `${actorId}/statuses/ordering-${name}`,
        url: `${actorId}/statuses/ordering-${name}`,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: `ordering ${name}`,
        createdAt: base + offset
      })
      await database.addStatusToCollectionTimelines({ status })
      return status
    }
    const approvedOld = await note(ACTOR5_ID, 'approved-old', 0)
    const pendingMiddle = await note(ACTOR6_ID, 'pending-middle', 1000)
    const approvedNew = await note(ACTOR5_ID, 'approved-new', 2000)
    // Newest of all, but its author is not a member of this collection.
    const outsider = await note(ACTOR3_ID, 'outsider', 3000)

    const response = await GET(request({}, ordering.id), context(ordering.id))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { id: string }[]
    expect(data.map((status) => status.id)).toEqual(
      await Promise.all(
        [approvedNew, pendingMiddle, approvedOld].map((status) =>
          statusPublicId(database, status.id)
        )
      )
    )
    expect(data.map((status) => status.id)).not.toContain(
      await statusPublicId(database, outsider.id)
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

  const MIN_URL = 'https://llun.test/users/test2/statuses/min-cursor'
  const SINCE_URL = 'https://llun.test/users/test2/statuses/since-cursor'

  it.each<{
    name: string
    params: Record<string, string>
    expected: string
  }>([
    {
      name: 'uses since_id as the lower bound when min_id is absent',
      params: { since_id: urlToId(SINCE_URL) },
      expected: SINCE_URL
    },
    {
      name: 'prefers min_id when both min_id and since_id are sent',
      params: { min_id: urlToId(MIN_URL), since_id: urlToId(SINCE_URL) },
      expected: MIN_URL
    }
  ])('$name', async ({ params, expected }) => {
    const spy = vi
      .spyOn(database, 'getCollectionTimeline')
      .mockResolvedValue([])

    await GET(request(params), context())

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ minStatusId: expected })
  })

  describe('keyword filters (home context)', () => {
    let filteredId: string
    let keptPost: Status
    let warnedPost: Status
    let hiddenPost: Status

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

      // ACTOR4 has no seeded posts and belongs to no other collection here, so
      // this feed holds exactly the three notes below (oldest to newest).
      const filtered = await database.createCollection({
        actorId: ACTOR1_ID,
        title: 'Filtered'
      })
      filteredId = filtered.id
      await database.addCollectionMembers({
        id: filteredId,
        actorId: ACTOR1_ID,
        targetActorIds: [ACTOR4_ID]
      })
      const base = Date.UTC(2026, 1, 1)
      const note = async (name: string, text: string, offset: number) => {
        const status = await database.createNote({
          id: `${ACTOR4_ID}/statuses/collection-${name}`,
          url: `${ACTOR4_ID}/statuses/collection-${name}`,
          actorId: ACTOR4_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text,
          createdAt: base + offset
        })
        await database.addStatusToCollectionTimelines({ status })
        return status
      }
      keptPost = await note('kept', 'nothing to filter here', 0)
      warnedPost = await note('warned', 'collwarn inside', 1000)
      hiddenPost = await note('hidden', 'collspoiler ahead', 2000)
    })

    it('drops hide-filtered posts from the page', async () => {
      const response = await GET(request({}, filteredId), context(filteredId))

      const body = (await response.json()) as { id: string }[]
      expect(body.map((status) => status.id)).toEqual([
        await statusPublicId(database, warnedPost.id),
        await statusPublicId(database, keptPost.id)
      ])
    })

    it('drops hide-filtered posts from the activities_next page', async () => {
      const response = await GET(
        request({ format: 'activities_next' }, filteredId),
        context(filteredId)
      )

      const body = (await response.json()) as { statuses: { id: string }[] }
      expect(body.statuses.map((status) => status.id)).toEqual([
        warnedPost.id,
        keptPost.id
      ])
    })

    it('keeps the next cursor when the whole page is hidden so older posts stay reachable', async () => {
      const hiddenPublicId = await statusPublicId(database, hiddenPost.id)

      const response = await GET(
        request({ limit: '1' }, filteredId),
        context(filteredId)
      )

      expect(await response.json()).toEqual([])
      expect(response.headers.get('Link') ?? '').toContain(
        `max_id=${hiddenPublicId}>; rel="next"`
      )

      const older = await GET(
        request({ limit: '1', max_id: hiddenPublicId }, filteredId),
        context(filteredId)
      )
      const olderBody = (await older.json()) as { id: string }[]
      expect(olderBody.map((status) => status.id)).toEqual([
        await statusPublicId(database, warnedPost.id)
      ])
    })

    it('keeps warn-filtered posts and annotates them with the matching filter', async () => {
      const response = await GET(request({}, filteredId), context(filteredId))

      const body = (await response.json()) as {
        id: string
        filtered: { filter: { title: string } }[]
      }[]
      const warnedPublicId = await statusPublicId(database, warnedPost.id)
      const entity = body.find((status) => status.id === warnedPublicId)
      expect(entity?.filtered).toHaveLength(1)
      expect(entity?.filtered[0].filter.title).toBe('Warn collection words')
    })
  })
})
