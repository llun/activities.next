import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import { overlayStoredViewerState } from './overlayViewerState'

const mockGetStatusesByIds = vi.fn()
// The access check in statusRouteAccess resolves the follower state through
// this batched lookup; a non-following viewer is the empty array.
const mockGetAcceptedFollowTargetActorIds = vi.fn()
const mockDatabase = {
  getStatusesByIds: mockGetStatusesByIds,
  getAcceptedFollowTargetActorIds: mockGetAcceptedFollowTargetActorIds
} as unknown as Database

const currentActor = {
  id: 'https://local.example/users/me'
} as unknown as Actor

const actorId = 'https://remote.example/users/actor'

const liveNote = (
  statusId: string,
  overrides: Partial<StatusNote> = {}
): StatusNote => ({
  id: statusId,
  actorId,
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: 100,
  updatedAt: 100,
  type: StatusType.enum.Note,
  url: statusId,
  text: 'Live status content',
  summary: 'Live summary',
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

describe('overlayStoredViewerState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatusesByIds.mockResolvedValue([])
    mockGetAcceptedFollowTargetActorIds.mockResolvedValue([])
  })

  it('a stored, liked status keeps its live text and attachments', async () => {
    const liveStatusId = `${actorId}/statuses/stored-liked`
    const liveAttachment = {
      id: 'https://remote.example/photo.jpg',
      actorId,
      statusId: liveStatusId,
      type: 'Document' as const,
      mediaType: 'image/jpeg',
      url: 'https://remote.example/photo.jpg',
      name: 'Live photo description',
      createdAt: 100,
      updatedAt: 100
    }
    const live = liveNote(liveStatusId, { attachments: [liveAttachment] })

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        totalLikes: 1,
        text: 'Stale stored text that must not overwrite live',
        summary: 'Stale summary',
        attachments: []
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: [liveStatusId],
      currentActorId: currentActor.id,
      withReplies: false
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(liveStatusId)
    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(true)
    expect(note.totalLikes).toBe(1)
    expect(note.text).toBe('Live status content')
    expect(note.summary).toBe('Live summary')
    expect(note.attachments).toEqual([liveAttachment])
  })

  it('a stored, bookmarked and reposted one carries isActorBookmarked and actorAnnounceStatusId', async () => {
    const liveStatusId = `${actorId}/statuses/stored-reposted`
    const live = liveNote(liveStatusId, {
      text: 'Another live status',
      totalShares: 2
    })
    const announceId = 'https://local.example/statuses/announce-777'

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: false,
        isActorBookmarked: true,
        actorAnnounceStatusId: announceId,
        totalLikes: 0
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    const note = result[0] as StatusNote
    expect(note.isActorBookmarked).toBe(true)
    expect(note.actorAnnounceStatusId).toBe(announceId)
    expect(note.totalShares).toBe(2)
  })

  it('an unstored one is unchanged', async () => {
    const unstoredStatusId = `${actorId}/statuses/unstored-1`
    const live = liveNote(unstoredStatusId, {
      text: 'Unstored post',
      summary: null
    })

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    expect(result[0]).toEqual(live)
  })

  it('a live Announce gets the overlay on originalStatus', async () => {
    const originalStatusId = 'https://other.example/users/bob/statuses/1'
    const announceStatusId = `${actorId}/statuses/announce-live-1`
    const originalLiveNote: StatusNote = liveNote(originalStatusId, {
      actorId: 'https://other.example/users/bob',
      text: 'Original bob status',
      createdAt: 50,
      updatedAt: 50
    })
    const liveAnnounce: Status = {
      id: announceStatusId,
      actorId,
      actor: null,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: false,
      createdAt: 100,
      updatedAt: 100,
      type: StatusType.enum.Announce,
      originalStatus: originalLiveNote as unknown as Status
    }

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: originalStatusId,
        actorId: 'https://other.example/users/bob',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId: 'https://local.example/statuses/announce-bob',
        totalLikes: 3
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [liveAnnounce]
    })

    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: [originalStatusId],
      currentActorId: currentActor.id,
      withReplies: false
    })
    expect(result[0].id).toBe(announceStatusId)
    expect(result[0].type).toBe(StatusType.enum.Announce)
    const original = (result[0] as unknown as { originalStatus: StatusNote })
      .originalStatus
    expect(original.id).toBe(originalStatusId)
    expect(original.isActorLiked).toBe(true)
    expect(original.isActorBookmarked).toBe(true)
    expect(original.actorAnnounceStatusId).toBe(
      'https://local.example/statuses/announce-bob'
    )
    expect(original.totalLikes).toBe(3)
  })

  it('a live note matching an unreadable stored status comes back with no overlay', async () => {
    const liveStatusId = `${actorId}/statuses/unreadable-stored`
    const live = liveNote(liveStatusId, {
      text: 'Live note text',
      summary: null
    })

    // Stored status has same id and actorId, but is private/unreadable for the viewer
    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: ['https://remote.example/users/secret'],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId:
          'https://local.example/statuses/announce-unreadable',
        totalLikes: 42,
        reactions: [
          {
            name: '❤️',
            count: 1,
            me: true,
            url: null,
            static_url: null
          }
        ]
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    expect(result[0].id).toBe(liveStatusId)
    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(false)
    expect(note.isActorBookmarked).toBe(false)
    expect(note.actorAnnounceStatusId).toBeNull()
    expect(note.totalLikes).toBe(0)
    expect(note.reactions).toBeUndefined()
  })

  it('a live note matching a stored public status with a different actorId comes back unchanged', async () => {
    const hijackedStatusId = `${actorId}/statuses/hijacked-target`
    const live = liveNote(hijackedStatusId, {
      text: 'Live note text claiming another status id',
      summary: null
    })

    // Stored status is public and liked, but authored by a different actor
    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: hijackedStatusId,
        actorId: 'https://victim.example/users/victim',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId: 'https://local.example/statuses/announce-victim',
        totalLikes: 99,
        reactions: [
          {
            name: '🔥',
            count: 5,
            me: true,
            url: null,
            static_url: null
          }
        ]
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    expect(result[0].id).toBe(hijackedStatusId)
    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(false)
    expect(note.isActorBookmarked).toBe(false)
    expect(note.actorAnnounceStatusId).toBeNull()
    expect(note.totalLikes).toBe(0)
    expect(note.reactions).toBeUndefined()
  })

  it('a stored followers-only row is not overlaid when the viewer does not follow the author', async () => {
    const liveStatusId = `${actorId}/statuses/followers-not-following`
    const live = liveNote(liveStatusId, {
      text: 'Followers only',
      summary: null,
      totalLikes: 2
    })

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [`${actorId}/followers`],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId: 'https://local.example/statuses/announce-fo',
        totalLikes: 9,
        reactions: [
          {
            name: '🎉',
            count: 3,
            me: true,
            url: null,
            static_url: null
          }
        ]
      }
    ])
    mockGetAcceptedFollowTargetActorIds.mockResolvedValueOnce([])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(false)
    expect(note.isActorBookmarked).toBe(false)
    expect(note.actorAnnounceStatusId).toBeNull()
    expect(note.totalLikes).toBe(2)
    expect(note.reactions).toBeUndefined()
  })

  it('a stored followers-only row is overlaid when the viewer follows the author', async () => {
    const liveStatusId = `${actorId}/statuses/followers-following`
    const live = liveNote(liveStatusId, {
      text: 'Followers only',
      summary: null,
      totalLikes: 2
    })
    const storedReactions = [
      {
        name: '🎉',
        count: 3,
        me: true,
        url: null,
        static_url: null
      }
    ]

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [`${actorId}/followers`],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: true,
        actorAnnounceStatusId: 'https://local.example/statuses/announce-fo',
        totalLikes: 9,
        reactions: storedReactions
      }
    ])
    mockGetAcceptedFollowTargetActorIds.mockResolvedValueOnce([actorId])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(true)
    expect(note.isActorBookmarked).toBe(true)
    expect(note.actorAnnounceStatusId).toBe(
      'https://local.example/statuses/announce-fo'
    )
    // The stored count only fills in when the live count is 0.
    expect(note.totalLikes).toBe(2)
    expect(note.reactions).toEqual(storedReactions)
  })

  it('a failing getStatusesByIds returns the live statuses and logs the error', async () => {
    const liveStatusId = `${actorId}/statuses/db-error`
    const live = liveNote(liveStatusId, {
      text: 'Live note text',
      summary: null
    })
    const loggerError = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined)
    mockGetStatusesByIds.mockRejectedValueOnce(
      new Error('database unavailable')
    )

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    expect(result).toEqual([live])
    expect(loggerError).toHaveBeenCalledWith({
      message: 'Failed to overlay viewer state on live statuses',
      err: expect.any(Error)
    })
    loggerError.mockRestore()
  })

  it('a liked post with a live totalLikes > 0 keeps its live count', async () => {
    const liveStatusId = `${actorId}/statuses/live-count-wins`
    const live = liveNote(liveStatusId, {
      text: 'Live note text',
      summary: null,
      totalLikes: 5
    })

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: true,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        totalLikes: 10
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    const note = result[0] as StatusNote
    expect(note.isActorLiked).toBe(true)
    expect(note.totalLikes).toBe(5)
  })

  it('stored reactions are applied when present', async () => {
    const liveStatusId = `${actorId}/statuses/stored-reactions`
    const live = liveNote(liveStatusId, {
      text: 'Live note text',
      summary: null
    })
    const storedReactions = [
      {
        name: '🔥',
        count: 4,
        me: false,
        url: null,
        static_url: null
      }
    ]

    mockGetStatusesByIds.mockResolvedValueOnce([
      {
        id: liveStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        type: StatusType.enum.Note,
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        totalLikes: 0,
        reactions: storedReactions
      }
    ])

    const result = await overlayStoredViewerState({
      database: mockDatabase,
      currentActor,
      statuses: [live]
    })

    const note = result[0] as StatusNote
    expect(note.reactions).toEqual(storedReactions)
  })
})
