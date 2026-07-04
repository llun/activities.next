import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
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
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/timelines/list/[list_id]', () => {
  const database = getTestSQLDatabase()
  let listId: string
  let listStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    const list = await database.createList({
      actorId: ACTOR1_ID,
      title: 'Test list'
    })
    listId = list.id

    listStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/list-1`,
      url: `${ACTOR1_ID}/statuses/list-1`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'list timeline post'
    })

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

  const request = (params: Record<string, string> = {}) => {
    const url = new URL(`https://llun.test/api/v1/timelines/list/${listId}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }

  it('returns the list timeline for a valid request with Link headers', async () => {
    vi.spyOn(database, 'getListTimeline').mockResolvedValue([listStatus])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(listStatus.id)
    ])
    const link = response.headers.get('Link') || ''
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="prev"')
  })

  it('returns the activities_next domain shape when format=activities_next', async () => {
    vi.spyOn(database, 'getListTimeline').mockResolvedValue([listStatus])

    const response = await GET(request({ format: 'activities_next' }), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    // The web UI consumes { statuses, nextMaxStatusId, prevMinStatusId } with
    // the internal Status shape (full URI ids), not Mastodon entities.
    expect(data.statuses.map((status: { id: string }) => status.id)).toEqual([
      listStatus.id
    ])
    expect(data.nextMaxStatusId).toBe(listStatus.id)
    expect(data.prevMinStatusId).toBe(listStatus.id)
    // The activities_next branch returns pagination in the body, not Link
    // headers.
    expect(response.headers.get('Link')).toBeNull()
  })

  it('returns 404 for a non-existent list', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ list_id: 'does-not-exist' })
    })
    expect(response.status).toBe(404)
  })

  it.each([
    { description: 'max_id', field: 'max_id' },
    { description: 'min_id', field: 'min_id' },
    { description: 'since_id', field: 'since_id' }
  ])(
    'returns 400 (not 500) for a malformed $description cursor',
    async ({ field }) => {
      const response = await GET(request({ [field]: 'apurl_@@@@' }), {
        params: Promise.resolve({ list_id: listId })
      })
      expect(response.status).toBe(400)
    }
  )

  it('passes min_id and since_id through as separate cursors', async () => {
    const minUrl = 'https://llun.test/users/test1/statuses/min-cursor'
    const sinceUrl = 'https://llun.test/users/test1/statuses/since-cursor'
    const spy = vi.spyOn(database, 'getListTimeline').mockResolvedValue([])

    await GET(
      request({ min_id: urlToId(minUrl), since_id: urlToId(sinceUrl) }),
      { params: Promise.resolve({ list_id: listId }) }
    )

    // Not collapsed — both reach getListTimeline in their own slots so min_id
    // gets adjacent-page and since_id gets newest-slice semantics.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ minStatusId: minUrl, sinceStatusId: sinceUrl })
    )
  })

  it.each([
    { field: 'min_id' as const, slot: 'minStatusId', other: 'sinceStatusId' },
    { field: 'since_id' as const, slot: 'sinceStatusId', other: 'minStatusId' }
  ])('routes $field alone to $slot', async ({ field, slot, other }) => {
    const url = 'https://llun.test/users/test1/statuses/cursor'
    const spy = vi.spyOn(database, 'getListTimeline').mockResolvedValue([])

    await GET(request({ [field]: urlToId(url) }), {
      params: Promise.resolve({ list_id: listId })
    })

    const call = spy.mock.calls[0][0] as Record<string, unknown>
    expect(call[slot]).toBe(url)
    // The absent cursor is passed as null (parseTimelineQuery's default), not
    // collapsed into the other slot.
    expect(call[other]).toBeNull()
  })

  it('returns 200 with the bad row skipped when one status is un-hydratable', async () => {
    // A status whose shape throws during Mastodon serialization (here a Note
    // missing its tags/attachments arrays) must be dropped, not 500 the page.
    const brokenStatus = {
      id: `${ACTOR1_ID}/statuses/list-broken`,
      actorId: ACTOR1_ID,
      type: 'Note',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    } as unknown as Status
    vi.spyOn(database, 'getListTimeline').mockResolvedValue([
      listStatus,
      brokenStatus
    ])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(listStatus.id)
    ])
  })

  it('returns an empty array and no Link header when there are no statuses', async () => {
    vi.spyOn(database, 'getListTimeline').mockResolvedValue([])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  describe('keyword (hide) filtering', () => {
    let spoilerStatus: Status
    let warnStatus: Status

    beforeAll(async () => {
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Spoilers',
        context: ['home'],
        filterAction: 'hide',
        expiresAt: null,
        keywords: [{ keyword: 'spoiler', wholeWord: false }]
      })
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Content warnings',
        context: ['home'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: [{ keyword: 'cwword', wholeWord: false }]
      })
      spoilerStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/spoiler-1`,
        url: `${ACTOR1_ID}/statuses/spoiler-1`,
        actorId: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'spoiler alert'
      })
      warnStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/warn-1`,
        url: `${ACTOR1_ID}/statuses/warn-1`,
        actorId: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'cwword inside'
      })
    })

    it('drops hide-filtered statuses from the Mastodon format', async () => {
      vi.spyOn(database, 'getListTimeline').mockResolvedValue([
        listStatus,
        spoilerStatus
      ])

      const response = await GET(request(), {
        params: Promise.resolve({ list_id: listId })
      })

      expect(response.status).toBe(200)
      const ids = (await response.json()).map((s: { id: string }) => s.id)
      expect(ids).toContain(urlToId(listStatus.id))
      expect(ids).not.toContain(urlToId(spoilerStatus.id))
    })

    it('drops hide-filtered statuses from the activities_next format', async () => {
      vi.spyOn(database, 'getListTimeline').mockResolvedValue([
        listStatus,
        spoilerStatus
      ])

      const response = await GET(request({ format: 'activities_next' }), {
        params: Promise.resolve({ list_id: listId })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      const ids = data.statuses.map((s: { id: string }) => s.id)
      expect(ids).toContain(listStatus.id)
      expect(ids).not.toContain(spoilerStatus.id)
    })

    it('keeps the next cursor when the whole page is hidden (no premature stop)', async () => {
      vi.spyOn(database, 'getListTimeline').mockResolvedValue([spoilerStatus])

      // Mastodon: empty body but a next Link so pagination reaches older posts.
      const mastodon = await GET(request(), {
        params: Promise.resolve({ list_id: listId })
      })
      expect(await mastodon.json()).toEqual([])
      expect(mastodon.headers.get('Link') || '').toContain('rel="next"')

      // activities_next: empty statuses but a non-null next cursor.
      const next = await GET(request({ format: 'activities_next' }), {
        params: Promise.resolve({ list_id: listId })
      })
      const data = await next.json()
      expect(data.statuses).toEqual([])
      expect(data.nextMaxStatusId).toBe(spoilerStatus.id)
    })

    it('keeps warn-filtered statuses, annotating them on the Mastodon path only', async () => {
      vi.spyOn(database, 'getListTimeline').mockResolvedValue([
        listStatus,
        warnStatus
      ])

      // Mastodon: warn matches are kept and annotated via `filtered`.
      const mastodon = await GET(request(), {
        params: Promise.resolve({ list_id: listId })
      })
      const mastodonBody = await mastodon.json()
      const warnEntity = mastodonBody.find(
        (s: { id: string }) => s.id === urlToId(warnStatus.id)
      )
      expect(warnEntity).toBeDefined()
      expect(warnEntity.filtered?.length ?? 0).toBeGreaterThan(0)

      // activities_next: kept, with no Mastodon `filtered` annotation.
      const next = await GET(request({ format: 'activities_next' }), {
        params: Promise.resolve({ list_id: listId })
      })
      const data = await next.json()
      const warnDomain = data.statuses.find(
        (s: { id: string }) => s.id === warnStatus.id
      )
      expect(warnDomain).toBeDefined()
      expect(warnDomain.filtered).toBeUndefined()
    })
  })
})
