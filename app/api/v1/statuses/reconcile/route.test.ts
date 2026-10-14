import { NextRequest } from 'next/server'

import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

import { OPTIONS, POST } from './route'

const mockCurrentActor = {
  id: 'https://llun.test/users/viewer',
  username: 'viewer',
  domain: 'llun.test'
}

let mockDatabase: {
  getStatusesByIds: ReturnType<typeof vi.fn>
  getStatusIdsByPublicIds: ReturnType<typeof vi.fn>
  getActorDomainBlocks: ReturnType<typeof vi.fn>
  getBlockRelations: ReturnType<typeof vi.fn>
  getMuteRelations: ReturnType<typeof vi.fn>
  getModerationStatesForActors: ReturnType<typeof vi.fn>
  getActiveFiltersForActor: ReturnType<typeof vi.fn>
  getActiveServerFilters: ReturnType<typeof vi.fn>
  getStatusPublicIds: ReturnType<typeof vi.fn>
  getAcceptedFollowTargetActorIds?: ReturnType<typeof vi.fn>
  getAcceptedOrRequestedFollow?: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<unknown>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<unknown> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

const createJsonRequest = (body: unknown) =>
  new NextRequest('https://llun.test/api/v1/statuses/reconcile', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  })

const createMockStatus = (
  id: string,
  overrides: Partial<StatusNote> = {}
): StatusNote => ({
  id,
  publicId: overrides.publicId ?? null,
  url: id,
  type: StatusType.enum.Note,
  actorId: overrides.actorId ?? 'https://llun.test/users/author',
  actor: overrides.actor ?? {
    id: overrides.actorId ?? 'https://llun.test/users/author',
    username: 'author',
    domain: 'llun.test',
    followersUrl: 'https://llun.test/users/author/followers',
    inboxUrl: 'https://llun.test/users/author/inbox',
    sharedInboxUrl: 'https://llun.test/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 1,
    lastStatusAt: null,
    createdAt: 1000
  },
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  cc: [],
  text: overrides.text ?? 'Hello world',
  summary: overrides.summary ?? '',
  sensitive: false,
  attachments: [],
  tags: [],
  reply: overrides.reply ?? '',
  replies: overrides.replies ?? [],
  edits: [],
  totalLikes: 0,
  totalShares: 0,
  isActorLiked: false,
  isActorBookmarked: false,
  actorAnnounceStatusId: null,
  isLocalActor: true,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

describe('POST /api/v1/statuses/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDatabase = {
      getStatusesByIds: vi.fn().mockResolvedValue([]),
      getStatusIdsByPublicIds: vi.fn().mockResolvedValue(new Map()),
      getActorDomainBlocks: vi.fn().mockResolvedValue([]),
      getBlockRelations: vi.fn().mockResolvedValue([]),
      getMuteRelations: vi.fn().mockResolvedValue([]),
      getModerationStatesForActors: vi.fn().mockResolvedValue(new Map()),
      getActiveFiltersForActor: vi.fn().mockResolvedValue([]),
      getActiveServerFilters: vi.fn().mockResolvedValue([]),
      getStatusPublicIds: vi.fn().mockResolvedValue(new Map()),
      getAcceptedFollowTargetActorIds: vi.fn().mockResolvedValue([]),
      getAcceptedOrRequestedFollow: vi.fn().mockResolvedValue(null)
    }
  })

  it('reconciles status IDs and partitions into visible statuses and removedStatusIds', async () => {
    const s1 = createMockStatus('https://llun.test/statuses/1', {
      publicId: '0190000000000001'
    })
    const s2 = createMockStatus('https://llun.test/statuses/2')

    mockDatabase.getStatusesByIds.mockResolvedValue([s1, s2])

    const req = createJsonRequest({
      statusIds: [
        'https://llun.test/statuses/1',
        'https://llun.test/statuses/2',
        'https://llun.test/statuses/missing'
      ]
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toHaveLength(2)
    expect(data.statuses.map((s: { id: string }) => s.id)).toEqual([
      'https://llun.test/statuses/1',
      'https://llun.test/statuses/2'
    ])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/missing'
    ])
  })

  it('resolves publicIds and keeps them mapped to visible statuses', async () => {
    const publicId = '0190000000000001'
    const statusUri = 'https://llun.test/statuses/1'
    const s1 = createMockStatus(statusUri, { publicId })

    mockDatabase.getStatusIdsByPublicIds.mockResolvedValue(
      new Map([[publicId, statusUri]])
    )
    mockDatabase.getStatusesByIds.mockResolvedValue([s1])

    const req = createJsonRequest({
      statusIds: [publicId, '0190000000009999']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toHaveLength(1)
    expect(data.statuses[0].id).toBe(statusUri)
    expect(data.removedStatusIds).toEqual(['0190000000009999'])
  })

  it('marks unreadable private statuses as removed', async () => {
    const privateStatus = createMockStatus(
      'https://llun.test/statuses/private',
      {
        to: ['https://llun.test/users/stranger'],
        cc: []
      }
    )

    mockDatabase.getStatusesByIds.mockResolvedValue([privateStatus])

    const req = createJsonRequest({
      statusIds: ['https://llun.test/statuses/private']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/private'
    ])
  })

  it('filters out statuses from domain-blocked authors', async () => {
    const blockedDomainStatus = createMockStatus(
      'https://blocked.social/statuses/1',
      {
        actorId: 'https://blocked.social/users/badactor',
        actor: {
          id: 'https://blocked.social/users/badactor',
          username: 'badactor',
          domain: 'blocked.social',
          followersUrl: '',
          inboxUrl: '',
          sharedInboxUrl: '',
          followingCount: 0,
          followersCount: 0,
          statusCount: 1,
          lastStatusAt: null,
          createdAt: 1000
        }
      }
    )

    mockDatabase.getStatusesByIds.mockResolvedValue([blockedDomainStatus])
    mockDatabase.getActorDomainBlocks.mockResolvedValue([
      { domain: 'blocked.social' }
    ])

    const req = createJsonRequest({
      statusIds: ['https://blocked.social/statuses/1']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual(['https://blocked.social/statuses/1'])
  })

  it('filters out statuses from blocked or muted authors', async () => {
    const s1 = createMockStatus('https://llun.test/statuses/blocked', {
      actorId: 'https://llun.test/users/blocked'
    })
    const s2 = createMockStatus('https://llun.test/statuses/muted', {
      actorId: 'https://llun.test/users/muted'
    })

    mockDatabase.getStatusesByIds.mockResolvedValue([s1, s2])
    mockDatabase.getBlockRelations.mockResolvedValue([
      {
        actorId: mockCurrentActor.id,
        targetActorId: 'https://llun.test/users/blocked'
      }
    ])
    mockDatabase.getMuteRelations.mockResolvedValue([
      {
        actorId: mockCurrentActor.id,
        targetActorId: 'https://llun.test/users/muted'
      }
    ])

    const req = createJsonRequest({
      statusIds: [
        'https://llun.test/statuses/blocked',
        'https://llun.test/statuses/muted'
      ]
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/blocked',
      'https://llun.test/statuses/muted'
    ])
  })

  it('filters out statuses from suspended authors', async () => {
    const suspendedStatus = createMockStatus(
      'https://llun.test/statuses/suspended',
      {
        actorId: 'https://llun.test/users/suspended'
      }
    )

    mockDatabase.getStatusesByIds.mockResolvedValue([suspendedStatus])
    mockDatabase.getModerationStatesForActors.mockResolvedValue(
      new Map([['https://llun.test/users/suspended', { suspendedAt: 1000 }]])
    )

    const req = createJsonRequest({
      statusIds: ['https://llun.test/statuses/suspended']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/suspended'
    ])
  })

  it('filters out statuses matching hide filter keywords', async () => {
    const filteredStatus = createMockStatus(
      'https://llun.test/statuses/spoilers',
      {
        text: 'Movie spoiler alert about the ending'
      }
    )

    mockDatabase.getStatusesByIds.mockResolvedValue([filteredStatus])
    mockDatabase.getActiveFiltersForActor.mockResolvedValue([
      {
        filter: {
          id: 'filter-1',
          actorId: mockCurrentActor.id,
          title: 'Spoilers',
          context: ['home'],
          filterAction: 'hide',
          expiresAt: null,
          createdAt: 1000,
          updatedAt: 1000
        },
        keywords: [
          {
            id: 'kw-1',
            filterId: 'filter-1',
            keyword: 'spoiler',
            wholeWord: false,
            createdAt: 1000,
            updatedAt: 1000
          }
        ],
        statuses: []
      }
    ])

    const req = createJsonRequest({
      statusIds: ['https://llun.test/statuses/spoilers']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/spoilers'
    ])
  })

  it('filters out Announce boosts when the boosted original status is unreadable', async () => {
    const originalPrivate = createMockStatus(
      'https://llun.test/statuses/orig-private',
      {
        to: ['https://llun.test/users/stranger'],
        cc: []
      }
    )
    const announceStatus: Status = {
      id: 'https://llun.test/statuses/boost-1',
      publicId: null,
      type: StatusType.enum.Announce,
      actorId: 'https://llun.test/users/booster',
      actor: {
        id: 'https://llun.test/users/booster',
        username: 'booster',
        domain: 'llun.test',
        followersUrl: '',
        inboxUrl: '',
        sharedInboxUrl: '',
        followingCount: 0,
        followersCount: 0,
        statusCount: 1,
        lastStatusAt: null,
        createdAt: 1000
      },
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      edits: [],
      isLocalActor: true,
      originalStatus: originalPrivate,
      createdAt: 1000,
      updatedAt: 1000
    }

    mockDatabase.getStatusesByIds.mockResolvedValue([announceStatus])

    const req = createJsonRequest({
      statusIds: ['https://llun.test/statuses/boost-1']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.statuses).toEqual([])
    expect(data.removedStatusIds).toEqual([
      'https://llun.test/statuses/boost-1'
    ])
  })

  const invalidBodies = [
    {},
    { statusIds: [] },
    {
      statusIds: Array.from(
        { length: 81 },
        (_, i) => `https://llun.test/statuses/${i}`
      )
    },
    { statusIds: [''] },
    { statusIds: ['   '] },
    { statusIds: [123] },
    null
  ]

  it.each(invalidBodies)(
    'rejects with 400 when statusIds body is %j',
    async (body) => {
      const req = createJsonRequest(body)

      const res = await POST(req, { params: Promise.resolve({}) })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ error: 'Bad Request' })
    }
  )

  it('returns 500 when database throws', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    mockDatabase.getStatusesByIds.mockRejectedValueOnce(new Error('DB failure'))

    const req = createJsonRequest({
      statusIds: ['https://llun.test/statuses/1']
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data).toEqual({ error: 'Internal Server Error' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('responds to OPTIONS with CORS headers', async () => {
    const req = new NextRequest('https://llun.test/api/v1/statuses/reconcile', {
      method: 'OPTIONS'
    })
    const res = await OPTIONS(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
  })
})
