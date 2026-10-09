import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId, statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { NotificationType } from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

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

interface ResponseRequest {
  id: string
  notifications_count: string
  account: { id: string }
  last_status?: { id: string }
}

describe('GET /api/v1/notifications/requests', () => {
  const database = getTestSQLDatabase()
  const SENDERS = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID]

  let clock = new Date('2026-03-01T00:00:00.000Z').getTime()
  const filteredFrom = async (
    sourceActorId: string,
    statusId?: string,
    actorId = ACTOR1_ID
  ) => {
    clock += 1000
    vi.setSystemTime(clock)
    return database.createNotification({
      actorId,
      type: statusId
        ? NotificationType.enum.mention
        : NotificationType.enum.follow,
      sourceActorId,
      statusId,
      filtered: true
    })
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    for (const actorId of [ACTOR1_ID, ACTOR2_ID]) {
      const existing = await database.getNotifications({
        actorId,
        limit: 1000,
        includeFiltered: true
      })
      for (const n of existing) await database.deleteNotification(n.id)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    mockDatabase = database
  })

  const get = (query = '') =>
    GET(
      new NextRequest(
        `https://llun.test/api/v1/notifications/requests${query}`
      ),
      { params: Promise.resolve({}) }
    )

  const idsOf = async (response: Response) =>
    ((await response.json()) as ResponseRequest[]).map((r) => r.id)

  const links = (response: Response) => {
    const header = response.headers.get('Link') ?? ''
    const parse = (rel: string) => {
      const match = header.match(new RegExp(`<([^>]+)>; rel="${rel}"`))
      return match ? new URL(match[1]) : null
    }
    return { next: parse('next'), prev: parse('prev') }
  }

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await get()

    expect(response.status).toBe(500)
  })

  it('returns an empty list and no Link header when nothing was filtered', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  it('groups filtered notifications per sender with a count and the latest status', async () => {
    const statusId = `${ACTOR2_ID}/statuses/request-last-status`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'Latest from a stranger',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await filteredFrom(ACTOR2_ID)
    await filteredFrom(ACTOR2_ID, statusId)
    await filteredFrom(ACTOR3_ID)

    const response = await get()
    const data: ResponseRequest[] = await response.json()

    expect(response.status).toBe(200)
    // Newest activity first: actor3's single follow, then actor2's two.
    expect(data).toHaveLength(2)
    const actor3Id = await actorPublicId(database, ACTOR3_ID)
    const actor2Id = await actorPublicId(database, ACTOR2_ID)
    expect(data[0]).toMatchObject({
      id: actor3Id,
      notifications_count: '1',
      account: { id: actor3Id }
    })
    expect(data[0].last_status).toBeUndefined()
    expect(data[1]).toMatchObject({
      id: actor2Id,
      notifications_count: '2',
      account: { id: actor2Id },
      last_status: { id: await statusPublicId(database, statusId) }
    })
  })

  it('ignores unfiltered notifications and other recipients', async () => {
    await database.createNotification({
      actorId: ACTOR1_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR2_ID
    })
    await filteredFrom(ACTOR3_ID, undefined, ACTOR2_ID)

    const response = await get()

    expect(await response.json()).toEqual([])
  })

  describe('pagination', () => {
    // Returns the public ids of the requests newest first.
    const makeRequests = async () => {
      for (const sender of SENDERS) await filteredFrom(sender)
      return Promise.all(
        [...SENDERS].reverse().map((id) => actorPublicId(database, id))
      )
    }

    it('limits the page and links to the neighbouring pages by request id', async () => {
      const [newest, , oldest] = await makeRequests()

      const response = await get('?limit=3')
      const { next, prev } = links(response)

      expect(next?.pathname).toBe('/api/v1/notifications/requests')
      expect(next?.searchParams.get('max_id')).toBe(oldest)
      expect(next?.searchParams.get('limit')).toBe('3')
      expect(prev?.searchParams.get('min_id')).toBe(newest)
    })

    it('limit caps the page size', async () => {
      const ids = await makeRequests()

      expect(await idsOf(await get('?limit=2'))).toEqual(ids.slice(0, 2))
    })

    it.each([
      ['0', 1],
      ['-5', 1],
      ['abc', 3],
      ['1000', 3]
    ])(
      'clamps limit=%s to a usable page size',
      async (limit, expectedCount) => {
        await makeRequests()

        const data = await idsOf(await get(`?limit=${limit}`))

        expect(data).toHaveLength(expectedCount)
      }
    )

    it('page selects an offset slice when no cursor is given', async () => {
      const ids = await makeRequests()

      expect(await idsOf(await get('?limit=1&page=2'))).toEqual([ids[1]])
      expect(await idsOf(await get('?limit=1&page=3'))).toEqual([ids[2]])
    })

    it.each(['0', '-1', 'abc'])(
      'treats page=%s as the first page',
      async (page) => {
        const ids = await makeRequests()

        expect(await idsOf(await get(`?limit=1&page=${page}`))).toEqual([
          ids[0]
        ])
      }
    )

    it('max_id returns the requests older than the cursor', async () => {
      const ids = await makeRequests()

      expect(await idsOf(await get(`?max_id=${ids[0]}`))).toEqual(ids.slice(1))
      expect(await idsOf(await get(`?max_id=${ids[1]}`))).toEqual(ids.slice(2))
    })

    it('since_id and min_id return the requests newer than the cursor', async () => {
      const ids = await makeRequests()

      expect(await idsOf(await get(`?since_id=${ids[2]}`))).toEqual(
        ids.slice(0, 2)
      )
      expect(await idsOf(await get(`?min_id=${ids[1]}`))).toEqual(
        ids.slice(0, 1)
      )
    })

    it('a cursor takes precedence over page', async () => {
      const ids = await makeRequests()

      expect(await idsOf(await get(`?max_id=${ids[0]}&page=3`))).toEqual(
        ids.slice(1)
      )
    })

    it.each(['max_id', 'since_id', 'min_id'])(
      'returns an empty page when the %s request no longer exists',
      async (param) => {
        await makeRequests()
        const gone = await actorPublicId(database, ACTOR1_ID)

        const response = await get(`?${param}=${gone}`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
        expect(response.headers.get('Link')).toBeNull()
      }
    )
  })
})
