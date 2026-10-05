import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import type { FitnessWindowActivity } from '@/lib/fitness/calendar/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

import { GET, OPTIONS } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<
  Database,
  'getFitnessActivitiesInWindow' | 'getStatusesByIds' | 'getActorIdByPublicId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const ORIGIN = 'https://client.example'
const OTHER_ACTOR_ID = 'https://llun.test/users/other'

const actorProfile = (id: string, username: string): ActorProfile => ({
  id,
  username,
  domain: 'llun.test',
  followersUrl: `${id}/followers`,
  inboxUrl: `${id}/inbox`,
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000
})

const note = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: `${ACTOR1_ID}/statuses/1`,
  publicId: '0190d8a6-7a3e-7cc1-8f2a-00000000000a',
  actorId: ACTOR1_ID,
  actor: actorProfile(ACTOR1_ID, 'test1'),
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: 1000,
  updatedAt: 1000,
  type: StatusType.enum.Note,
  url: `${ACTOR1_ID}/statuses/1`,
  text: '<p>🏃 Morning run</p><p>Felt strong</p>',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  ...overrides
})

const windowActivity = (
  overrides: Partial<FitnessWindowActivity> = {}
): FitnessWindowActivity => ({
  id: 'file-1',
  statusId: `${ACTOR1_ID}/statuses/1`,
  activityType: 'running',
  startTime: Date.UTC(2026, 9, 4, 5, 12),
  totalDistanceMeters: 10000,
  totalDurationSeconds: 3000,
  elevationGainMeters: 42,
  description: 'From the watch',
  fileName: 'Morning_Run.fit',
  ...overrides
})

describe('GET /api/v1/accounts/[id]/fitness-calendar/day', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessActivitiesInWindow: vi.fn(),
    getStatusesByIds: vi.fn(),
    getActorIdByPublicId: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-calendar/day`
  const validQuery = 'date=2026-10-04&time_zone=Europe/Amsterdam'

  const callGet = (query: string) =>
    GET(
      new NextRequest(`${baseUrl}?${query}`, { headers: { Origin: ORIGIN } }),
      { params: Promise.resolve({ id: encodedId }) }
    )

  const expectCorsError = async (response: Response, status: number) => {
    expect(response.status).toBe(status)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const body = await response.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = mockDb
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([])
  })

  it('answers the CORS preflight', async () => {
    const response = await OPTIONS(
      new NextRequest(baseUrl, {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN }
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'OPTIONS,GET'
    )
  })

  it('returns 401 when not logged in', async () => {
    mockGetServerSession.mockResolvedValue(null)
    await expectCorsError(await callGet(validQuery), 401)
    expect(mockDb.getFitnessActivitiesInWindow).not.toHaveBeenCalled()
  })

  it('returns 401 when the session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)
    await expectCorsError(await callGet(validQuery), 401)
    expect(mockDb.getFitnessActivitiesInWindow).not.toHaveBeenCalled()
  })

  it("returns 403 for another actor's day", async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: OTHER_ACTOR_ID
    })
    await expectCorsError(await callGet(validQuery), 403)
    expect(mockDb.getFitnessActivitiesInWindow).not.toHaveBeenCalled()
    expect(mockDb.getStatusesByIds).not.toHaveBeenCalled()
  })

  it('returns 500 with CORS headers when the database is not available', async () => {
    mockDatabase = null
    await expectCorsError(await callGet(validQuery), 500)
  })

  it.each([
    ['a missing date', 'time_zone=UTC'],
    [
      'a range instead of a date',
      'from=2026-10-01&to=2026-10-04&time_zone=UTC'
    ],
    ['an impossible date', 'date=2026-02-29&time_zone=UTC'],
    ['a malformed date', 'date=04-10-2026&time_zone=UTC'],
    ['a missing time_zone', 'date=2026-10-04'],
    ['an offset time_zone', 'date=2026-10-04&time_zone=%2B05:30'],
    ['an unknown time_zone', 'date=2026-10-04&time_zone=Not/AZone']
  ])('returns 400 with CORS headers for %s', async (_label, query) => {
    await expectCorsError(await callGet(query), 400)
    expect(mockDb.getFitnessActivitiesInWindow).not.toHaveBeenCalled()
  })

  it("reads the signed-in actor's local-day window, 23 hours on the DST day", async () => {
    const response = await callGet('date=2026-03-29&time_zone=europe/amsterdam')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      date: '2026-03-29',
      timeZone: 'Europe/Amsterdam',
      activities: [],
      hasMore: false,
      nextOffset: 0
    })
    expect(mockDb.getFitnessActivitiesInWindow).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      startDate: Date.UTC(2026, 2, 28, 23),
      endDate: Date.UTC(2026, 2, 29, 22),
      limit: 20,
      offset: 0
    })
    expect(mockDb.getStatusesByIds).not.toHaveBeenCalled()
  })

  it('clamps limit and offset rather than rejecting them', async () => {
    await callGet(`${validQuery}&limit=500&offset=-4`)
    expect(mockDb.getFitnessActivitiesInWindow).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 })
    )
  })

  it('pages by rows: nextOffset adds the rows returned, hasMore comes from the database', async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [
        windowActivity({ id: 'file-21' }),
        windowActivity({ id: 'file-22', statusId: null })
      ],
      hasMore: true
    })
    mockDb.getStatusesByIds.mockResolvedValue([note()])

    const response = await callGet(`${validQuery}&limit=2&offset=20`)
    const body = await response.json()

    expect(mockDb.getFitnessActivitiesInWindow).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, offset: 20 })
    )
    expect(body.hasMore).toBe(true)
    // Counts both rows, including the one without a post.
    expect(body.nextOffset).toBe(22)
  })

  it('returns the minimal row, titled from the first line and linked to the existing status page', async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [windowActivity()],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([note()])

    const response = await callGet(validQuery)
    const body = await response.json()

    expect(mockDb.getStatusesByIds).toHaveBeenCalledWith({
      statusIds: [`${ACTOR1_ID}/statuses/1`],
      currentActorId: ACTOR1_ID,
      withReplies: false
    })
    expect(body.activities).toEqual([
      {
        id: 'file-1',
        activityType: 'running',
        startTime: Date.UTC(2026, 9, 4, 5, 12),
        totalDistanceMeters: 10000,
        totalDurationSeconds: 3000,
        elevationGainMeters: 42,
        title: 'Morning run',
        statusPath: '/@test1@llun.test/0190d8a6-7a3e-7cc1-8f2a-00000000000a'
      }
    ])
    // Nothing of the post beyond its first line leaves the server.
    expect(JSON.stringify(body)).not.toContain('Felt strong')
  })

  it('falls back to the description, then the file name, when the post has no text', async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [
        windowActivity({ id: 'file-1' }),
        windowActivity({ id: 'file-2', description: null })
      ],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([note({ text: '' })])

    const body = await (await callGet(validQuery)).json()

    expect(body.activities.map((row: { title: string }) => row.title)).toEqual([
      'From the watch',
      'Morning_Run.fit'
    ])
  })

  it('returns a null title and statusPath when the post is missing', async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [
        // Deleting a status only clears the column.
        windowActivity({ id: 'file-unposted', statusId: null }),
        // Deleted between the two queries, so the batch read drops it.
        windowActivity({
          id: 'file-gone',
          statusId: `${ACTOR1_ID}/statuses/gone`
        })
      ],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([])

    const body = await (await callGet(validQuery)).json()

    expect(body.activities).toEqual([
      expect.objectContaining({
        id: 'file-unposted',
        title: null,
        statusPath: null
      }),
      expect.objectContaining({
        id: 'file-gone',
        title: null,
        statusPath: null
      })
    ])
    expect(mockDb.getStatusesByIds).toHaveBeenCalledWith(
      expect.objectContaining({
        statusIds: [`${ACTOR1_ID}/statuses/gone`]
      })
    )
  })

  it("titles and links the owner's own private post, as the rest of the fitness area does", async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [windowActivity()],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([
      note({ to: [`${ACTOR1_ID}/followers`], cc: [] })
    ])

    const body = await (await callGet(validQuery)).json()

    expect(body.activities[0]).toMatchObject({
      title: 'Morning run',
      statusPath: '/@test1@llun.test/0190d8a6-7a3e-7cc1-8f2a-00000000000a'
    })
  })

  it("never surfaces another actor's post text or link", async () => {
    const foreignId = `${OTHER_ACTOR_ID}/statuses/9`
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [windowActivity({ statusId: foreignId })],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([
      note({
        id: foreignId,
        actorId: OTHER_ACTOR_ID,
        actor: actorProfile(OTHER_ACTOR_ID, 'other'),
        to: [OTHER_ACTOR_ID],
        text: '<p>Secret direct message</p>'
      })
    ])

    const body = await (await callGet(validQuery)).json()

    expect(body.activities[0]).toMatchObject({ title: null, statusPath: null })
    expect(JSON.stringify(body)).not.toContain('Secret')
  })

  it('treats a boost as unavailable rather than naming it from the boosted post', async () => {
    const boostId = `${ACTOR1_ID}/statuses/boost`
    const boost: Status = {
      id: boostId,
      actorId: ACTOR1_ID,
      actor: actorProfile(ACTOR1_ID, 'test1'),
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: 1000,
      updatedAt: 1000,
      type: StatusType.enum.Announce,
      originalStatus: note({
        id: `${OTHER_ACTOR_ID}/statuses/9`,
        actorId: OTHER_ACTOR_ID,
        actor: actorProfile(OTHER_ACTOR_ID, 'other')
      })
    }
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [windowActivity({ statusId: boostId })],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockResolvedValue([boost])

    const body = await (await callGet(validQuery)).json()

    expect(body.activities[0]).toMatchObject({ title: null, statusPath: null })
  })

  it('returns 500 with CORS headers when the query fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error')
    mockDb.getFitnessActivitiesInWindow.mockRejectedValue(new Error('db down'))
    await expectCorsError(await callGet(validQuery), 500)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) })
    )
    errorSpy.mockRestore()
  })

  it('returns 500 with CORS headers when loading the posts fails', async () => {
    mockDb.getFitnessActivitiesInWindow.mockResolvedValue({
      activities: [windowActivity()],
      hasMore: false
    })
    mockDb.getStatusesByIds.mockRejectedValue(new Error('db down'))
    await expectCorsError(await callGet(validQuery), 500)
  })
})
