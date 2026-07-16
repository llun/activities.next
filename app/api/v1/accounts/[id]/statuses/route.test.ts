import { NextRequest } from 'next/server'

import { POST as pinStatus } from '@/app/api/v1/statuses/[id]/pin/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
const mockStoredToken = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetRemoteActorStatuses = vi.fn()
vi.mock('@/lib/services/mastodon/getRemoteActorStatuses', () => ({
  getRemoteActorStatuses: (...params: unknown[]) =>
    mockGetRemoteActorStatuses(...params)
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (
  query = '',
  init?: ConstructorParameters<typeof NextRequest>[1]
) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/statuses${query}`,
    init
  )

describe('GET /api/v1/accounts/[id]/statuses', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
    mockGetRemoteActorStatuses.mockResolvedValue([])
  })

  it('allows anonymous reads but only returns public and unlisted statuses', async () => {
    const publicStatusId = `${ACTOR1_ID}/statuses/account-public-read`
    const unlistedStatusId = `${ACTOR1_ID}/statuses/account-unlisted-read`
    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-read`
    const directStatusId = `${ACTOR1_ID}/statuses/account-direct-read`

    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account public read',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: unlistedStatusId,
      url: unlistedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account unlisted read',
      to: [`${ACTOR1_ID}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })
    await database.createNote({
      id: directStatusId,
      url: directStatusId,
      actorId: ACTOR1_ID,
      text: 'Account direct read',
      to: [ACTOR2_ID],
      cc: []
    })

    const response = await GET(createRequest('?limit=40'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(publicStatusId)
    expect(uris).toContain(unlistedStatusId)
    expect(uris).not.toContain(privateStatusId)
    expect(uris).not.toContain(directStatusId)
  })

  it('allows the owner to read their non-public account statuses', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-owner-read`
    const directStatusId = `${ACTOR1_ID}/statuses/account-direct-owner-read`

    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private owner read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })
    await database.createNote({
      id: directStatusId,
      url: directStatusId,
      actorId: ACTOR1_ID,
      text: 'Account direct owner read',
      to: [ACTOR2_ID],
      cc: []
    })

    const response = await GET(createRequest('?limit=40'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(privateStatusId)
    expect(uris).toContain(directStatusId)
  })

  it('allows accepted followers to read followers-only account statuses', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID,
      inbox: `${ACTOR2_ID}/inbox`,
      sharedInbox: `https://${TEST_DOMAIN}/inbox`,
      status: FollowStatus.enum.Accepted
    })

    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-follower-read`
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private follower read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await GET(createRequest('?limit=40'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(privateStatusId)
  })

  it('applies account visibility filtering before limiting results', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })

    const publicStatusId = `${ACTOR1_ID}/statuses/account-visible-before-limit`
    const privateStatusId = `${ACTOR1_ID}/statuses/account-hidden-before-limit`
    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account visible before limit',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account hidden before limit',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toEqual([publicStatusId])
    expect(uris).not.toContain(privateStatusId)
  })

  it('continues scanning when a public announce wraps a non-public original', async () => {
    const now = Date.now() + 10_000
    const publicStatusId = `${ACTOR1_ID}/statuses/account-public-after-unreadable-announce`
    const privateOriginalStatusId = `${ACTOR2_ID}/statuses/account-private-original-for-announce`
    const unreadableAnnounceId = `${ACTOR1_ID}/statuses/account-unreadable-announce`

    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account public after unreadable announce',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createNote({
      id: privateOriginalStatusId,
      url: privateOriginalStatusId,
      actorId: ACTOR2_ID,
      text: 'Private original for unreadable announce',
      to: [`${ACTOR2_ID}/followers`],
      cc: [],
      createdAt: now + 1
    })
    await database.createAnnounce({
      id: unreadableAnnounceId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: privateOriginalStatusId,
      createdAt: now + 2
    })

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toEqual([publicStatusId])
    expect(uris).not.toContain(unreadableAnnounceId)
  })

  it('caps scanning when batches contain no readable statuses', async () => {
    const now = Date.now() + 20_000
    const privateOriginal = {
      id: `${ACTOR2_ID}/statuses/account-private-original-scan-cap`,
      url: `${ACTOR2_ID}/statuses/account-private-original-scan-cap`,
      actorId: ACTOR2_ID,
      actor: null,
      type: StatusType.enum.Note,
      to: [`${ACTOR2_ID}/followers`],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: now,
      updatedAt: now,
      text: 'Private original for scan cap',
      summary: '',
      reply: '',
      replies: [],
      actorAnnounceStatusId: null,
      isActorLiked: false,
      totalLikes: 0,
      attachments: [],
      tags: []
    } as Status
    const unreadableAnnounce = {
      id: `${ACTOR1_ID}/statuses/account-unreadable-announce-scan-cap`,
      actorId: ACTOR1_ID,
      actor: null,
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: now + 1,
      updatedAt: now + 1,
      originalStatus: privateOriginal
    } as Status
    const getActorStatuses = vi
      .spyOn(database, 'getActorStatuses')
      .mockResolvedValue([unreadableAnnounce])

    try {
      const response = await GET(createRequest('?limit=1'), {
        params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual([])
      expect(getActorStatuses).toHaveBeenCalledTimes(10)
    } finally {
      getActorStatuses.mockRestore()
    }
  })

  it('returns bad request for invalid query params', async () => {
    const response = await GET(createRequest('?only_media=maybe'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(400)
  })

  it.each([
    // limit=0 clamps up to the minimum (1); the rest clamp down to the cap (40).
    ['?limit=0', 1],
    ['?limit=41', 40],
    ['?limit=100&pinned=true', 40]
  ])(
    'clamps out-of-range %s instead of rejecting it',
    async (query, expectedLimit) => {
      const getActorStatusesSpy = vi.spyOn(database, 'getActorStatuses')

      const response = await GET(createRequest(query), {
        params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
      })

      expect(response.status).toBe(200)
      // The clamped limit is what reaches the DB layer.
      expect(getActorStatusesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expectedLimit })
      )

      getActorStatusesSpy.mockRestore()
    }
  )

  it('allows OAuth tokens with read:statuses to read private owner statuses', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read:statuses'
    })

    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-read-statuses-token`
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private read:statuses token read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await GET(
      createRequest('?limit=40', {
        headers: { Authorization: 'Bearer read-statuses-token' }
      }),
      { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
    )

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    expect(data.map((status) => status.uri)).toContain(privateStatusId)
  })

  it('filters account statuses to media posts before limiting', async () => {
    const now = Date.now() + 30_000
    const mediaStatusId = `${ACTOR1_ID}/statuses/account-only-media`
    const textStatusId = `${ACTOR1_ID}/statuses/account-only-media-text`

    await database.createNote({
      id: mediaStatusId,
      url: mediaStatusId,
      actorId: ACTOR1_ID,
      text: 'Account media status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId: mediaStatusId,
      mediaType: 'image/png',
      url: 'https://llun.test/media/account-only-media.png'
    })
    await database.createNote({
      id: textStatusId,
      url: textStatusId,
      actorId: ACTOR1_ID,
      text: 'Account text status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 1
    })

    const response = await GET(createRequest('?only_media=true&limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{ uri: string }>

    expect(data.map((status) => status.uri)).toEqual([mediaStatusId])
  })

  it('excludes replies to other and missing accounts but keeps self-replies', async () => {
    const now = Date.now() + 40_000
    const parentStatusId = `${ACTOR1_ID}/statuses/account-reply-parent`
    const selfReplyStatusId = `${ACTOR1_ID}/statuses/account-self-reply`
    const otherParentStatusId = `${ACTOR2_ID}/statuses/account-other-reply-parent`
    const otherReplyStatusId = `${ACTOR1_ID}/statuses/account-other-reply`
    const missingReplyStatusId = `${ACTOR1_ID}/statuses/account-missing-reply`

    await database.createNote({
      id: parentStatusId,
      url: parentStatusId,
      actorId: ACTOR1_ID,
      text: 'Account reply parent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createNote({
      id: selfReplyStatusId,
      url: selfReplyStatusId,
      actorId: ACTOR1_ID,
      text: 'Account self reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: parentStatusId,
      createdAt: now + 1
    })
    await database.createNote({
      id: otherParentStatusId,
      url: otherParentStatusId,
      actorId: ACTOR2_ID,
      text: 'Account other reply parent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 2
    })
    await database.createNote({
      id: otherReplyStatusId,
      url: otherReplyStatusId,
      actorId: ACTOR1_ID,
      text: 'Account other reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: otherParentStatusId,
      createdAt: now + 3
    })
    await database.createNote({
      id: missingReplyStatusId,
      url: missingReplyStatusId,
      actorId: ACTOR1_ID,
      text: 'Account missing reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: `${ACTOR2_ID}/statuses/missing-account-reply-parent`,
      createdAt: now + 4
    })

    const response = await GET(
      createRequest('?exclude_replies=true&limit=40'),
      {
        params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
      }
    )

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(parentStatusId)
    expect(uris).toContain(selfReplyStatusId)
    expect(uris).not.toContain(otherReplyStatusId)
    expect(uris).not.toContain(missingReplyStatusId)
  })

  it('excludes reblogs from account statuses', async () => {
    const now = Date.now() + 50_000
    const originalStatusId = `${ACTOR2_ID}/statuses/account-exclude-reblog-original`
    const announceStatusId = `${ACTOR1_ID}/statuses/account-exclude-reblog-announce`
    const noteStatusId = `${ACTOR1_ID}/statuses/account-exclude-reblog-note`

    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: ACTOR2_ID,
      text: 'Account exclude reblog original',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createNote({
      id: noteStatusId,
      url: noteStatusId,
      actorId: ACTOR1_ID,
      text: 'Account exclude reblog note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 1
    })
    await database.createAnnounce({
      id: announceStatusId,
      actorId: ACTOR1_ID,
      originalStatusId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 2
    })

    const response = await GET(createRequest('?exclude_reblogs=true&limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{ uri: string }>

    expect(data.map((status) => status.uri)).toEqual([noteStatusId])
  })

  it('filters account statuses by normalized hashtag', async () => {
    const now = Date.now() + 60_000
    const taggedStatusId = `${ACTOR1_ID}/statuses/account-tagged-running`
    const untaggedStatusId = `${ACTOR1_ID}/statuses/account-tagged-cycling`

    await database.createNote({
      id: taggedStatusId,
      url: taggedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account tagged #Running status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createTag({
      statusId: taggedStatusId,
      name: '#Running',
      value: 'https://llun.test/tags/running',
      type: 'hashtag'
    })
    await database.createNote({
      id: untaggedStatusId,
      url: untaggedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account tagged #Cycling status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 1
    })
    await database.createTag({
      statusId: untaggedStatusId,
      name: '#Cycling',
      value: 'https://llun.test/tags/cycling',
      type: 'hashtag'
    })

    const response = await GET(createRequest('?tagged=running&limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{ uri: string }>

    expect(data.map((status) => status.uri)).toEqual([taggedStatusId])
  })

  it('returns only pinned account statuses with pinned serialization context', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const now = Date.now() + 70_000
    const pinnedStatusId = `${ACTOR1_ID}/statuses/account-pinned-status`
    const unpinnedStatusId = `${ACTOR1_ID}/statuses/account-unpinned-status`
    const getPinnedStatusIds = vi.spyOn(database, 'getPinnedStatusIds')

    await database.createNote({
      id: pinnedStatusId,
      url: pinnedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account pinned status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createNote({
      id: unpinnedStatusId,
      url: unpinnedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account unpinned status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now + 1
    })

    const pinResponse = await pinStatus(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(pinnedStatusId)}/pin`,
        {
          method: 'POST',
          headers: { Origin: 'https://llun.test' }
        }
      ),
      { params: Promise.resolve({ id: urlToId(pinnedStatusId) }) }
    )

    expect(pinResponse.status).toBe(200)
    await expect(pinResponse.json()).resolves.toMatchObject({
      id: urlToId(pinnedStatusId),
      pinned: true
    })
    getPinnedStatusIds.mockClear()

    const response = await GET(createRequest('?pinned=true&limit=40'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{
      uri: string
      pinned?: boolean
    }>

    expect(data.map((status) => status.uri)).toEqual([pinnedStatusId])
    expect(data[0]?.pinned).toBe(true)
    expect(data.map((status) => status.uri)).not.toContain(unpinnedStatusId)
    expect(getPinnedStatusIds).not.toHaveBeenCalled()
    getPinnedStatusIds.mockRestore()
  })

  it('does not expose profile owner pin state as viewer pin state', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const now = Date.now() + 75_000
    const pinnedStatusId = `${ACTOR1_ID}/statuses/account-pinned-other-viewer`
    await database.createNote({
      id: pinnedStatusId,
      url: pinnedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account pinned status viewed by another actor',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })

    const pinResponse = await pinStatus(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(pinnedStatusId)}/pin`,
        {
          method: 'POST',
          headers: { Origin: 'https://llun.test' }
        }
      ),
      { params: Promise.resolve({ id: urlToId(pinnedStatusId) }) }
    )
    expect(pinResponse.status).toBe(200)

    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const response = await GET(createRequest('?pinned=true&limit=40'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as Array<{
      uri: string
      pinned?: boolean
    }>

    const returnedStatus = data.find((status) => status.uri === pinnedStatusId)
    expect(returnedStatus).toBeDefined()
    expect(returnedStatus).not.toHaveProperty('pinned')
  })

  describe('remote actor live outbox fallback', () => {
    const buildRemoteStatus = (statusId: string): Status =>
      ({
        id: statusId,
        url: statusId,
        actorId: EXTERNAL_ACTOR1,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Live remote status',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: [],
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isLocalActor: false,
        totalLikes: 0,
        attachments: [],
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }) as Status

    const createRemoteRequest = (query = '') =>
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(EXTERNAL_ACTOR1)}/statuses${query}`
      )

    it('serves live outbox statuses without pagination links when the local store is empty', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const liveStatusId = `${EXTERNAL_ACTOR1}/statuses/live-1`
      mockGetRemoteActorStatuses.mockResolvedValue([
        buildRemoteStatus(liveStatusId)
      ])

      const response = await GET(createRemoteRequest('?exclude_replies=true'), {
        params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as Array<{ uri: string }>
      expect(data.map((status) => status.uri)).toEqual([liveStatusId])
      // Remote ids can't page the local store, so a live page must not
      // advertise cursors.
      expect(response.headers.get('Link')).toBeNull()
      expect(mockGetRemoteActorStatuses).toHaveBeenCalledWith({
        database,
        actorId: EXTERNAL_ACTOR1,
        limit: 20,
        excludeReplies: true,
        excludeReblogs: false,
        onlyMedia: false
      })
    })

    it('falls back to locally-stored statuses when the live fetch returns nothing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const localStatusId = `${EXTERNAL_ACTOR1}/statuses/local-fallback`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: EXTERNAL_ACTOR1,
        text: 'Local remote-actor status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await GET(createRemoteRequest(), {
        params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as Array<{ uri: string }>
      expect(data.map((status) => status.uri)).toContain(localStatusId)
      expect(mockGetRemoteActorStatuses).toHaveBeenCalled()
    })

    it('does not fetch remote statuses for anonymous viewers', async () => {
      const response = await GET(createRemoteRequest(), {
        params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
      })

      expect(response.status).toBe(200)
      expect(mockGetRemoteActorStatuses).not.toHaveBeenCalled()
    })

    it.each([
      { description: 'pagination requests', query: '?max_id=some-id' },
      { description: 'pinned requests', query: '?pinned=true' },
      { description: 'tagged requests', query: '?tagged=running' }
    ])('does not fetch remote statuses for $description', async ({ query }) => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const response = await GET(createRemoteRequest(query), {
        params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
      })

      expect(response.status).toBe(200)
      expect(mockGetRemoteActorStatuses).not.toHaveBeenCalled()
    })

    it('does not fetch remote statuses for local actors', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
      })

      expect(response.status).toBe(200)
      expect(mockGetRemoteActorStatuses).not.toHaveBeenCalled()
    })
  })

  it('preserves compatible filter params in pagination links', async () => {
    const now = Date.now() + 80_000
    const olderStatusId = `${ACTOR1_ID}/statuses/account-link-older`
    const newerStatusId = `${ACTOR1_ID}/statuses/account-link-newer`

    for (const [statusId, createdAt] of [
      [olderStatusId, now],
      [newerStatusId, now + 1]
    ] as const) {
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Account pagination link #linktag',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/png',
        url: `${statusId}/image.png`
      })
      await database.createTag({
        statusId,
        name: '#linktag',
        value: 'https://llun.test/tags/linktag',
        type: 'hashtag'
      })
    }

    const response = await GET(
      createRequest(
        '?limit=1&only_media=true&exclude_reblogs=true&tagged=linktag'
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
    )

    expect(response.status).toBe(200)
    const link = response.headers.get('Link') ?? ''

    expect(link).toContain('only_media=true')
    expect(link).toContain('exclude_reblogs=true')
    expect(link).toContain('tagged=linktag')
    expect(link).toContain('max_id=')
    expect(link).toContain('min_id=')
  })

  it('pages past an encoded max_id cursor instead of repeating the first page', async () => {
    const now = Date.now() + 90_000
    const olderStatusId = `${ACTOR1_ID}/statuses/account-cursor-older`
    const newerStatusId = `${ACTOR1_ID}/statuses/account-cursor-newer`

    for (const [statusId, createdAt] of [
      [olderStatusId, now],
      [newerStatusId, now + 1]
    ] as const) {
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Account cursor paging',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt
      })
    }

    const firstPage = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })
    expect(firstPage.status).toBe(200)
    const firstData = (await firstPage.json()) as Array<{ uri: string }>
    expect(firstData.map((status) => status.uri)).toEqual([newerStatusId])

    // Clients echo the opaque encoded id from the response/Link header.
    const secondPage = await GET(
      createRequest(`?limit=1&max_id=${urlToId(newerStatusId)}`),
      { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
    )
    expect(secondPage.status).toBe(200)
    const secondData = (await secondPage.json()) as Array<{ uri: string }>
    expect(secondData.map((status) => status.uri)).toEqual([olderStatusId])
  })
})
