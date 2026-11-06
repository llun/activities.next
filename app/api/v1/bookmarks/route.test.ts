import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

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

describe('GET /api/v1/bookmarks', () => {
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

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/bookmarks${query}`)

  const createBookmarkedStatus = async (name: string) => {
    const statusId = `${ACTOR2_ID}/statuses/bookmark-route-${name}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: `Bookmarked route ${name}`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createBookmark({ actorId: ACTOR1_ID, statusId })
    return statusId
  }

  it('returns bookmarked statuses with bookmarked=true', async () => {
    const statusId = await createBookmarkedStatus('list-one')

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toContainEqual(
      expect.objectContaining({
        id: await statusPublicId(database, statusId),
        bookmarked: true
      })
    )
  })

  it('returns activities_next statuses with bookmark cursors when requested', async () => {
    const statusId = await createBookmarkedStatus('activities-next')

    const response = await GET(
      createRequest('?format=activities_next&limit=1'),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      statuses: [
        expect.objectContaining({
          id: statusId,
          isActorBookmarked: true
        })
      ],
      nextMaxBookmarkId: expect.any(String),
      prevMinBookmarkId: expect.any(String)
    })
  })

  it('returns bookmarked statuses in bookmark order', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const olderStatusId = `${ACTOR1_ID}/statuses/bookmark-route-order-older`
    const newerStatusId = `${ACTOR1_ID}/statuses/bookmark-route-order-newer`
    await database.createNote({
      id: newerStatusId,
      url: newerStatusId,
      actorId: ACTOR1_ID,
      text: 'Created first but bookmarked second',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: olderStatusId,
      url: olderStatusId,
      actorId: ACTOR1_ID,
      text: 'Created second but bookmarked first',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createBookmark({
      actorId: ACTOR2_ID,
      statusId: olderStatusId
    })
    await database.createBookmark({
      actorId: ACTOR2_ID,
      statusId: newerStatusId
    })

    const response = await GET(createRequest('?limit=2'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      await statusPublicId(database, newerStatusId),
      await statusPublicId(database, olderStatusId)
    ])
  })

  it('batches viewer pin-state lookup when serializing bookmark lists', async () => {
    const firstStatusId = `${ACTOR1_ID}/statuses/bookmark-route-own-first`
    const secondStatusId = `${ACTOR1_ID}/statuses/bookmark-route-own-second`
    for (const statusId of [firstStatusId, secondStatusId]) {
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Own bookmarked route status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({ actorId: ACTOR1_ID, statusId })
    }
    const getPinnedStatusIds = vi.spyOn(database, 'getPinnedStatusIds')

    try {
      const response = await GET(createRequest('?limit=2'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toHaveLength(2)
      expect(getPinnedStatusIds).toHaveBeenCalledTimes(1)
      expect(getPinnedStatusIds).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        statusIds: [secondStatusId, firstStatusId]
      })
    } finally {
      getPinnedStatusIds.mockRestore()
    }
  })

  it('paginates with Mastodon Link headers using opaque cursors', async () => {
    await createBookmarkedStatus('page-one')
    await createBookmarkedStatus('page-two')

    const firstResponse = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    expect(firstPage).toHaveLength(1)

    const linkHeader = firstResponse.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('rel="prev"')

    const maxId = linkHeader?.match(/[?&]max_id=([^&>]+)/)?.[1]
    expect(maxId).toBeTruthy()

    const secondResponse = await GET(
      createRequest(`?limit=1&max_id=${maxId}`),
      {
        params: Promise.resolve({})
      }
    )
    expect(secondResponse.status).toBe(200)
    const secondPage = await secondResponse.json()
    expect(secondPage).toHaveLength(1)
    expect(secondPage[0].id).not.toBe(firstPage[0].id)
  })

  it('keeps paging after the bookmark the cursor names is unbookmarked', async () => {
    await createBookmarkedStatus('cursor-gone-one')
    await createBookmarkedStatus('cursor-gone-two')

    const firstResponse = await GET(
      createRequest('?format=activities_next&limit=1'),
      { params: Promise.resolve({}) }
    )
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    const cursor = firstPage.nextMaxBookmarkId as string
    expect(cursor).toBeTruthy()

    // The owner unbookmarks the post the cursor sits on.
    await database.deleteBookmark({
      actorId: ACTOR1_ID,
      statusId: firstPage.statuses[0].id
    })

    const secondResponse = await GET(
      createRequest(`?format=activities_next&limit=1&max_id=${cursor}`),
      { params: Promise.resolve({}) }
    )
    expect(secondResponse.status).toBe(200)
    const secondPage = await secondResponse.json()
    expect(secondPage.statuses).toHaveLength(1)
    expect(secondPage.statuses[0].id).not.toBe(firstPage.statuses[0].id)
  })

  it('returns an empty list for invalid pagination cursors', async () => {
    await createBookmarkedStatus('invalid-cursor')

    const response = await GET(createRequest('?max_id=not-a-number'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })

  describe('folder_id filter', () => {
    const fileInto = async (name: string, folderId: string | null) => {
      const statusId = await createBookmarkedStatus(name)
      await database.fileBookmark({ actorId: ACTOR1_ID, statusId, folderId })
      return statusId
    }

    it('lists one folder, carries folder_id into the Link header, and none lists the unfiled', async () => {
      const created = await database.createBookmarkFolder({
        actorId: ACTOR1_ID,
        name: 'Route filter folder'
      })
      if (created.status !== 'ok') throw new Error(created.status)
      const folderId = created.folder.id
      const filedOld = await fileInto('filter-filed-old', folderId)
      const unfiled = await fileInto('filter-unfiled', null)
      const filedNew = await fileInto('filter-filed-new', folderId)

      const first = await GET(createRequest(`?folder_id=${folderId}&limit=1`), {
        params: Promise.resolve({})
      })
      expect(first.status).toBe(200)
      const firstPage = await first.json()
      expect(firstPage).toEqual([
        expect.objectContaining({
          id: await statusPublicId(database, filedNew),
          bookmark_folder_id: folderId
        })
      ])
      const link = first.headers.get('Link') ?? ''
      expect(link).toContain(`folder_id=${folderId}`)
      const maxId = link.match(/[?&]max_id=([^&>]+)/)?.[1]

      const second = await GET(
        createRequest(`?folder_id=${folderId}&limit=1&max_id=${maxId}`),
        { params: Promise.resolve({}) }
      )
      expect(
        (await second.json()).map((status: { id: string }) => status.id)
      ).toEqual([await statusPublicId(database, filedOld)])

      const none = await GET(createRequest('?folder_id=none&limit=40'), {
        params: Promise.resolve({})
      })
      const noneIds = (await none.json()).map(
        (status: { id: string }) => status.id
      )
      expect(noneIds).toContain(await statusPublicId(database, unfiled))
      expect(noneIds).not.toContain(await statusPublicId(database, filedNew))
      expect(noneIds).not.toContain(await statusPublicId(database, filedOld))

      const all = await GET(createRequest('?limit=40'), {
        params: Promise.resolve({})
      })
      const allIds = (await all.json()).map(
        (status: { id: string }) => status.id
      )
      expect(allIds).toEqual(
        expect.arrayContaining([
          await statusPublicId(database, filedNew),
          await statusPublicId(database, unfiled),
          await statusPublicId(database, filedOld)
        ])
      )
    })

    it("answers 404 for another actor's folder or an unknown one", async () => {
      const theirs = await database.createBookmarkFolder({
        actorId: ACTOR2_ID,
        name: 'Not yours'
      })
      if (theirs.status !== 'ok') throw new Error(theirs.status)

      for (const folderId of [theirs.folder.id, 'no-such-folder']) {
        const response = await GET(createRequest(`?folder_id=${folderId}`), {
          params: Promise.resolve({})
        })
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Not Found' })
      }
    })
  })
})
