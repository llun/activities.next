import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getRemoteActorStatuses } from './getRemoteActorStatuses'

vi.mock('@/lib/activities/getActorPerson')
vi.mock('@/lib/activities/getActorPosts')
vi.mock('@/lib/services/federation/domainPolicy')
vi.mock('@/lib/services/federation/getFederationSigningActor')

const actorId = 'https://remote.example/users/actor'
const knownAuthorId = 'https://remote.example/users/known'
const unknownAuthorId = 'https://remote.example/users/unknown'

const mockGetActorsFromIds = vi.fn()
const mockDatabase = {
  getActorsFromIds: (...params: unknown[]) => mockGetActorsFromIds(...params)
} as unknown as Database

const mockInstanceActor = {
  id: 'https://local.example/users/__instance__'
}

const buildNote = (id: string, overrides: Partial<Status> = {}): Status =>
  ({
    id,
    url: id,
    actorId,
    actor: null,
    type: StatusType.enum.Note,
    text: 'Remote note',
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
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as Status

const buildAnnounce = (id: string, originalAuthorId: string): Status =>
  ({
    id,
    actorId,
    actor: null,
    type: StatusType.enum.Announce,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: 1,
    updatedAt: 1,
    originalStatus: buildNote(`${originalAuthorId}/statuses/original`, {
      actorId: originalAuthorId
    } as Partial<Status>)
  }) as Status

describe('getRemoteActorStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(canFederateWithDomain as jest.Mock).mockResolvedValue(true)
    ;(getFederationSigningActor as jest.Mock).mockResolvedValue(
      mockInstanceActor
    )
    ;(getActorPerson as jest.Mock).mockResolvedValue({
      id: actorId,
      type: 'Person',
      preferredUsername: 'actor',
      outbox: `${actorId}/outbox`
    })
    mockGetActorsFromIds.mockResolvedValue([])
  })

  it('returns the actor recent public posts signed by the instance actor', async () => {
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [buildNote(`${actorId}/statuses/1`)],
      statusesCount: 1,
      nextPageUrl: null,
      prevPageUrl: null
    })

    const statuses = await getRemoteActorStatuses({
      database: mockDatabase,
      actorId,
      limit: 20
    })

    expect(statuses.map((status) => status.id)).toEqual([
      `${actorId}/statuses/1`
    ])
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId,
      signingActor: mockInstanceActor
    })
    expect(getActorPosts).toHaveBeenCalledWith({
      database: mockDatabase,
      person: expect.objectContaining({ id: actorId }),
      signingActor: mockInstanceActor
    })
  })

  it.each([
    {
      description: 'drops non-public statuses',
      status: buildNote(`${actorId}/statuses/private`, {
        to: [`${actorId}/followers`],
        cc: []
      }),
      options: {}
    },
    {
      description: 'drops replies when excludeReplies is set',
      status: buildNote(`${actorId}/statuses/reply`, {
        reply: `${actorId}/statuses/parent`
      }),
      options: { excludeReplies: true }
    },
    {
      description: 'drops posts without media when onlyMedia is set',
      status: buildNote(`${actorId}/statuses/no-media`),
      options: { onlyMedia: true }
    },
    {
      description: 'drops reblogs when excludeReblogs is set',
      status: buildAnnounce(`${actorId}/statuses/announce`, knownAuthorId),
      options: { excludeReblogs: true }
    },
    {
      description: 'drops reblogs whose original author is unknown locally',
      status: buildAnnounce(
        `${actorId}/statuses/unknown-announce`,
        unknownAuthorId
      ),
      options: {}
    }
  ])('$description', async ({ status, options }) => {
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [status],
      statusesCount: 1,
      nextPageUrl: null,
      prevPageUrl: null
    })

    await expect(
      getRemoteActorStatuses({
        database: mockDatabase,
        actorId,
        limit: 20,
        ...options
      })
    ).resolves.toEqual([])
  })

  it('keeps reblogs whose original author is known locally', async () => {
    mockGetActorsFromIds.mockResolvedValue([{ id: knownAuthorId }])
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [buildAnnounce(`${actorId}/statuses/announce`, knownAuthorId)],
      statusesCount: 1,
      nextPageUrl: null,
      prevPageUrl: null
    })

    const statuses = await getRemoteActorStatuses({
      database: mockDatabase,
      actorId,
      limit: 20
    })

    expect(statuses.map((status) => status.id)).toEqual([
      `${actorId}/statuses/announce`
    ])
    expect(mockGetActorsFromIds).toHaveBeenCalledWith({
      ids: [knownAuthorId]
    })
  })

  it('caps the returned statuses at the requested limit', async () => {
    ;(getActorPosts as jest.Mock).mockResolvedValue({
      statuses: [
        buildNote(`${actorId}/statuses/1`),
        buildNote(`${actorId}/statuses/2`),
        buildNote(`${actorId}/statuses/3`)
      ],
      statusesCount: 3,
      nextPageUrl: null,
      prevPageUrl: null
    })

    await expect(
      getRemoteActorStatuses({ database: mockDatabase, actorId, limit: 2 })
    ).resolves.toHaveLength(2)
  })

  it('returns an empty list for blocked federation domains without fetching', async () => {
    ;(canFederateWithDomain as jest.Mock).mockResolvedValue(false)

    await expect(
      getRemoteActorStatuses({ database: mockDatabase, actorId, limit: 20 })
    ).resolves.toEqual([])
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('returns an empty list when the remote fetch fails', async () => {
    ;(getActorPosts as jest.Mock).mockRejectedValue(new Error('network down'))

    await expect(
      getRemoteActorStatuses({ database: mockDatabase, actorId, limit: 20 })
    ).resolves.toEqual([])
  })
})
