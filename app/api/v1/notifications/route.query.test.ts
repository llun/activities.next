import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { NotificationType } from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET, POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// The OAuth guard is covered by its own tests; here the caller is always actor1.
vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: { currentActor: { id: string }; params: Promise<{}> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: { id: 'https://llun.test/users/test1' },
        params: context.params
      })
}))

const context = { params: Promise.resolve({}) }
const get = (query = '') =>
  GET(
    new NextRequest(`https://llun.test/api/v1/notifications${query}`),
    context
  )

interface ResponseNotification {
  id: string
  type: string
  group_key: string
  grouped_count?: number
  account: { id: string }
}

describe('GET /api/v1/notifications (real database)', () => {
  const database = getTestSQLDatabase()
  const statusId = `${ACTOR1_ID}/statuses/notification-route-status`

  // Creates notifications on a stepped clock so createdAt ordering (newest
  // first) is deterministic.
  let clock = new Date('2026-03-01T00:00:00.000Z').getTime()
  const notify = async (
    params: Parameters<typeof database.createNotification>[0]
  ) => {
    clock += 1000
    vi.setSystemTime(clock)
    return database.createNotification(params)
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Status that gets liked',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Fresh inbox for each test
    const existing = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 1000,
      includeFiltered: true
    })
    for (const n of existing) await database.deleteNotification(n.id)
  })

  afterEach(() => {
    vi.useRealTimers()
    mockDatabase = database
  })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await get()

    expect(response.status).toBe(500)
  })

  it('returns notifications newest first with the mastodon type and source account', async () => {
    const first = await notify({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR2_ID
    })
    const second = await notify({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.like,
      sourceActorId: ACTOR3_ID,
      statusId,
      groupKey: `like:${statusId}`
    })

    const response = await get()
    const data: ResponseNotification[] = await response.json()

    expect(response.status).toBe(200)
    expect(data.map((n) => [n.id, n.type])).toEqual([
      [second.id, 'favourite'],
      [first.id, 'follow']
    ])
    expect(data[0].account.id).toBe(await actorPublicId(database, ACTOR3_ID))
    expect(data[1].account.id).toBe(await actorPublicId(database, ACTOR2_ID))
  })

  it("never returns another recipient's notifications", async () => {
    await notify({
      actorId: ACTOR2_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR3_ID
    })

    const response = await get()

    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  describe('type filters', () => {
    beforeEach(async () => {
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.like,
        sourceActorId: ACTOR3_ID,
        statusId
      })
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.mention,
        sourceActorId: ACTOR3_ID,
        statusId
      })
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.reply,
        sourceActorId: ACTOR4_ID,
        statusId
      })
    })

    const typesOf = async (query: string) => {
      const data: ResponseNotification[] = await (await get(query)).json()
      return data.map((n) => n.type).sort()
    }

    it.each([
      ['types[]=follow', ['follow']],
      ['types=follow', ['follow']],
      ['types[]=follow&types[]=favourite', ['favourite', 'follow']]
    ])('%s keeps only the listed types', async (query, expected) => {
      expect(await typesOf(`?${query}`)).toEqual(expected)
    })

    it('treats the mastodon mention type as both mentions and replies', async () => {
      expect(await typesOf('?types[]=mention')).toEqual(['mention', 'mention'])
    })

    it('exclude_types[] removes the listed types', async () => {
      expect(await typesOf('?exclude_types[]=favourite')).toEqual([
        'follow',
        'mention',
        'mention'
      ])
    })

    it('exclude_types[] wins for a type that is also in types[]', async () => {
      expect(
        await typesOf(
          '?types[]=follow&types[]=favourite&exclude_types[]=follow'
        )
      ).toEqual(['favourite'])
    })

    it('returns nothing for an unknown type instead of failing', async () => {
      const response = await get('?types[]=not-a-type')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])
    })
  })

  describe('policy-filtered notifications', () => {
    it('hides them by default and shows them with include_filtered', async () => {
      const visible = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })
      const hidden = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR3_ID,
        filtered: true
      })

      const defaultIds = (
        (await (await get()).json()) as ResponseNotification[]
      ).map((n) => n.id)
      const allIds = (
        (await (
          await get('?include_filtered=true')
        ).json()) as ResponseNotification[]
      ).map((n) => n.id)

      expect(defaultIds).toEqual([visible.id])
      expect(allIds).toEqual([hidden.id, visible.id])
    })
  })

  describe('account_id', () => {
    it('limits results to one source account, by public id', async () => {
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })
      const fromActor3 = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR3_ID
      })

      const publicId = await actorPublicId(database, ACTOR3_ID)
      const data: ResponseNotification[] = await (
        await get(`?account_id=${publicId}`)
      ).json()

      expect(data.map((n) => n.id)).toEqual([fromActor3.id])
    })

    it('limits results to one source account, by raw actor uri', async () => {
      await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })
      const fromActor3 = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR3_ID
      })

      const data: ResponseNotification[] = await (
        await get(`?account_id=${encodeURIComponent(ACTOR3_ID)}`)
      ).json()

      expect(data.map((n) => n.id)).toEqual([fromActor3.id])
    })
  })

  describe('grouped=true', () => {
    it('collapses likes of one status into a single entry with a count', async () => {
      const groupKey = `like:${statusId}`
      const older = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.like,
        sourceActorId: ACTOR2_ID,
        statusId,
        groupKey
      })
      const newer = await notify({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.like,
        sourceActorId: ACTOR3_ID,
        statusId,
        groupKey
      })

      const grouped: ResponseNotification[] = await (
        await get('?grouped=true')
      ).json()
      const ungrouped: ResponseNotification[] = await (await get()).json()

      expect(grouped).toHaveLength(1)
      expect(grouped[0]).toMatchObject({
        group_key: groupKey,
        grouped_count: 2
      })
      expect(ungrouped.map((n) => n.id)).toEqual([newer.id, older.id])
    })
  })

  describe('pagination', () => {
    const makeFollows = async (count: number) => {
      const ids: string[] = []
      for (let i = 0; i < count; i++) {
        const n = await notify({
          actorId: ACTOR1_ID,
          type: NotificationType.enum.follow,
          sourceActorId: ACTOR2_ID
        })
        ids.push(n.id)
      }
      // newest first, like the API
      return ids.reverse()
    }

    const links = (response: Response) => {
      const header = response.headers.get('Link') ?? ''
      const parse = (rel: string) => {
        const match = header.match(new RegExp(`<([^>]+)>; rel="${rel}"`))
        return match ? new URL(match[1]) : null
      }
      return { next: parse('next'), prev: parse('prev') }
    }

    it('advertises next/prev links built from the first and last row of the page', async () => {
      const [newest, , oldest] = await makeFollows(3)

      const response = await get('?limit=3')
      const { next, prev } = links(response)

      expect(next?.pathname).toBe('/api/v1/notifications')
      expect(next?.searchParams.get('max_id')).toBe(oldest)
      expect(next?.searchParams.get('limit')).toBe('3')
      expect(prev?.searchParams.get('min_id')).toBe(newest)
    })

    it('walks pages with the next link cursor until the feed is exhausted', async () => {
      const ids = await makeFollows(5)

      const pages: string[][] = []
      let query = '?limit=2'
      // 5 rows at 2 per page is exactly 3 pages; each one must link onward.
      for (let i = 0; i < 3; i++) {
        const response = await get(query)
        const data: ResponseNotification[] = await response.json()
        pages.push(data.map((n) => n.id))
        const next = links(response).next
        expect(next).not.toBeNull()
        query = `?limit=2&max_id=${next!.searchParams.get('max_id')}`
      }

      expect(pages).toEqual([ids.slice(0, 2), ids.slice(2, 4), ids.slice(4)])

      // The page after the last cursor is empty and offers no further link.
      const past = await get(query)
      expect(await past.json()).toEqual([])
      expect(links(past).next).toBeNull()
    })

    it('min_id returns the page immediately newer than the cursor', async () => {
      const ids = await makeFollows(5)

      const data: ResponseNotification[] = await (
        await get(`?limit=2&min_id=${ids[4]}`)
      ).json()

      expect(data.map((n) => n.id)).toEqual(ids.slice(2, 4))
    })

    it('since_id returns the newest rows after the cursor', async () => {
      const ids = await makeFollows(5)

      const data: ResponseNotification[] = await (
        await get(`?limit=2&since_id=${ids[4]}`)
      ).json()

      expect(data.map((n) => n.id)).toEqual(ids.slice(0, 2))
    })

    it('carries every filter into the pagination links', async () => {
      await makeFollows(1)
      const publicId = await actorPublicId(database, ACTOR2_ID)

      const response = await get(
        `?types[]=follow&types[]=favourite&exclude_types[]=reblog&account_id=${publicId}&include_filtered=true&grouped=true&limit=5`
      )
      const next = links(response).next!

      expect(next.searchParams.getAll('types[]')).toEqual([
        'follow',
        'favourite'
      ])
      expect(next.searchParams.getAll('exclude_types[]')).toEqual(['reblog'])
      expect(next.searchParams.get('account_id')).toBe(publicId)
      expect(next.searchParams.get('include_filtered')).toBe('true')
      expect(next.searchParams.get('grouped')).toBe('true')
      expect(next.searchParams.get('limit')).toBe('5')
    })
  })

  it('rejects a repeated single-value cursor parameter with 422', async () => {
    const response = await get('?max_id=a&max_id=b')

    expect(response.status).toBe(422)
  })
})

describe('POST /api/v1/notifications (real database)', () => {
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

  const post = () =>
    POST(
      new NextRequest('https://llun.test/api/v1/notifications', {
        method: 'POST'
      }),
      context
    )

  const remaining = (actorId: string) =>
    database.getNotifications({ actorId, limit: 5000, includeFiltered: true })

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null
    const response = await post()
    mockDatabase = database

    expect(response.status).toBe(500)
  })

  it("deletes all of the caller's notifications, filtered ones included, and nobody else's", async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR2_ID
    })
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR3_ID,
      filtered: true
    })
    const others = await database.createNotification({
      actorId: ACTOR2_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR3_ID
    })

    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(await remaining(ACTOR1_ID)).toEqual([])
    expect((await remaining(ACTOR2_ID)).map((n) => n.id)).toEqual([others.id])
  })

  it('keeps deleting across more than one batch of 1000', async () => {
    for (let i = 0; i < 1005; i++) {
      await database.createNotification({
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })
    }

    const response = await post()

    expect(response.status).toBe(200)
    expect(await remaining(ACTOR1_ID)).toEqual([])
  })
})
