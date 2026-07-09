import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'
import { waitFor } from '@/lib/utils/waitFor'

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

describe('GET /api/v1/timelines/public', () => {
  const database = getTestSQLDatabase()
  let publicStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    publicStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-1`,
      url: `${ACTOR1_ID}/statuses/public-1`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'public timeline post'
    })
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    // No session → optional auth resolves currentActor = null (anonymous).
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (params: Record<string, string> = {}) => {
    const url = new URL('https://llun.test/api/v1/timelines/public')
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }

  it('returns the public timeline for a valid request', async () => {
    vi.spyOn(database, 'getTimeline').mockResolvedValue([publicStatus])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(publicStatus.id)
    ])
  })

  it.each([
    { description: 'junk opaque id', value: 'apurl_@@@@' },
    { description: 'percent signs', value: '%%%' },
    { description: 'spaces', value: 'a b c' }
  ])(
    'returns 400 (not 500) for a malformed max_id cursor ($description)',
    async ({ value }) => {
      const response = await GET(request({ max_id: value }), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(400)
    }
  )

  it('returns 200 with the bad row skipped when one status is un-hydratable', async () => {
    // A status whose shape throws during Mastodon serialization (here a Note
    // missing its tags/attachments arrays) must be dropped, not 500 the page.
    const brokenStatus = {
      id: `${ACTOR1_ID}/statuses/public-broken`,
      actorId: ACTOR1_ID,
      type: 'Note',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    } as unknown as Status
    vi.spyOn(database, 'getTimeline').mockResolvedValue([
      publicStatus,
      brokenStatus
    ])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(publicStatus.id)
    ])
  })

  it('returns an empty array and no Link header when there are no statuses', async () => {
    vi.spyOn(database, 'getTimeline').mockResolvedValue([])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })

  describe('local/remote scope', () => {
    const timelinesQueried = () => {
      const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])
      return { spy }
    }

    it('reads both local and federated sources by default (federated view)', async () => {
      const { spy } = timelinesQueried()
      await GET(request(), { params: Promise.resolve({}) })
      const queried = spy.mock.calls.map((call) => call[0].timeline)
      expect(queried).toContain('local-public')
      expect(queried).toContain('federated-public')
    })

    it('reads only the local source when local=true', async () => {
      const { spy } = timelinesQueried()
      await GET(request({ local: 'true' }), { params: Promise.resolve({}) })
      const queried = spy.mock.calls.map((call) => call[0].timeline)
      expect(queried).toContain('local-public')
      expect(queried).not.toContain('federated-public')
    })

    it('reads only the federated source when remote=true', async () => {
      const { spy } = timelinesQueried()
      await GET(request({ remote: 'true' }), { params: Promise.resolve({}) })
      const queried = spy.mock.calls.map((call) => call[0].timeline)
      expect(queried).toContain('federated-public')
      expect(queried).not.toContain('local-public')
    })
  })

  describe('min_id/since_id wiring and prev Link', () => {
    it.each([
      { description: 'min_id', param: 'min_id' },
      { description: 'since_id', param: 'since_id' }
    ])(
      'passes the decoded $description cursor to the timeline queries',
      async ({ param }) => {
        const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])
        const response = await GET(
          request({ [param]: urlToId(publicStatus.id) }),
          { params: Promise.resolve({}) }
        )
        expect(response.status).toBe(200)
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ minStatusId: publicStatus.id })
        )
      }
    )

    it('prefers min_id over since_id when both are provided', async () => {
      const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])
      await GET(
        request({
          min_id: urlToId(publicStatus.id),
          since_id: urlToId(`${ACTOR1_ID}/statuses/public-other`)
        }),
        { params: Promise.resolve({}) }
      )
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ minStatusId: publicStatus.id })
      )
    })

    it('emits a rel="prev" Link with a min_id cursor for a non-empty page', async () => {
      vi.spyOn(database, 'getTimeline').mockResolvedValue([publicStatus])
      const response = await GET(request(), { params: Promise.resolve({}) })
      const link = response.headers.get('Link')
      expect(link).toContain('rel="prev"')
      const prevPart = link!
        .split(', ')
        .find((part) => part.includes('rel="prev"'))
      const prevUrl = new URL(prevPart!.match(/<([^>]+)>/)![1])
      expect(prevUrl.searchParams.get('min_id')).toBe(urlToId(publicStatus.id))
    })
  })

  describe('only_media', () => {
    it('passes onlyMedia=true to the timeline queries', async () => {
      const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])
      await GET(request({ only_media: 'true' }), {
        params: Promise.resolve({})
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ onlyMedia: true })
      )
    })

    it('carries only_media into the pagination Links', async () => {
      vi.spyOn(database, 'getTimeline').mockResolvedValue([publicStatus])
      const response = await GET(request({ only_media: 'true' }), {
        params: Promise.resolve({})
      })
      expect(response.headers.get('Link')).toContain('only_media=true')
    })
  })

  describe('merged default scope and Link scope', () => {
    const REMOTE_ACTOR = 'https://somewhere.test/users/bob'

    beforeAll(async () => {
      await database.createActor({
        actorId: REMOTE_ACTOR,
        username: 'bob',
        domain: 'somewhere.test',
        followersUrl: `${REMOTE_ACTOR}/followers`,
        inboxUrl: `${REMOTE_ACTOR}/inbox`,
        sharedInboxUrl: 'https://somewhere.test/inbox',
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
    })

    const seedFederated = async (suffix: string) => {
      const id = `https://somewhere.test/statuses/fed-${suffix}`
      const status = await database.createNote({
        id,
        url: id,
        actorId: REMOTE_ACTOR,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: `federated ${suffix}`
      })
      await database.addStatusToFederatedTimeline({
        statusId: status.id,
        statusActorId: status.actorId
      })
      return status
    }

    it('merges local and federated statuses newest-first in the default scope', async () => {
      const federated = await seedFederated('merge-1')

      const response = await GET(request(), { params: Promise.resolve({}) })
      expect(response.status).toBe(200)
      const ids = (await response.json()).map(
        (status: { id: string }) => status.id
      )
      // Both sources present; the federated post (seeded last) is newest-first.
      expect(ids).toContain(urlToId(federated.id))
      expect(ids).toContain(urlToId(publicStatus.id))
      expect(ids[0]).toBe(urlToId(federated.id))
    })

    it('carries the remote scope into the next Link when paginating', async () => {
      await seedFederated('link-1')
      await waitFor(5)
      await seedFederated('link-2')

      const response = await GET(request({ remote: 'true', limit: '1' }), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(200)
      const link = response.headers.get('Link')
      expect(link).toContain('rel="next"')
      expect(link).toContain('remote=true')
      expect(link).not.toContain('local=true')
    })
  })
})
