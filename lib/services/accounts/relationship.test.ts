import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

import { getRelationship } from './relationship'

describe('getRelationship', () => {
  const mockDatabase = {
    getActorFromId: vi.fn(),
    isCurrentActorFollowing: vi.fn(),
    getAcceptedOrRequestedFollow: vi.fn(),
    isBlocking: vi.fn(),
    getMute: vi.fn(),
    getAccountNote: vi.fn(),
    getEndorsement: vi.fn()
  }

  const mockCurrentActor = {
    id: 'https://example.com/users/current',
    username: 'current',
    domain: 'example.com'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: 'Target user bio'
    })
    mockDatabase.isBlocking.mockResolvedValue(false)
    mockDatabase.getMute.mockResolvedValue(null)
    mockDatabase.getAccountNote.mockResolvedValue('')
    mockDatabase.getEndorsement.mockResolvedValue(null)
  })

  it('returns relationship with following=true when following', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(true) // current follows target
      .mockResolvedValueOnce(false) // target follows current
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.following).toBe(true)
    expect(relationship.followed_by).toBe(false)
    expect(relationship.requested).toBe(false)
  })

  it('returns relationship with followed_by=true when target follows current', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(false) // current follows target
      .mockResolvedValueOnce(true) // target follows current
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.following).toBe(false)
    expect(relationship.followed_by).toBe(true)
  })

  it('returns relationship with requested=true when follow is pending', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Requested
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.following).toBe(false)
    expect(relationship.requested).toBe(true)
  })

  it('returns requested_by=true when the target has a pending follow request to the current actor', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockImplementation(
      async ({ actorId }: { actorId: string }) =>
        actorId === 'https://example.com/users/target'
          ? { status: FollowStatus.enum.Requested }
          : null
    )

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.requested).toBe(false)
    expect(relationship.requested_by).toBe(true)
    expect(mockDatabase.getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: 'https://example.com/users/target',
      targetActorId: mockCurrentActor.id
    })
  })

  it('returns requested_by=false when the incoming follow is already accepted', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(false) // current follows target
      .mockResolvedValueOnce(true) // target follows current
    mockDatabase.getAcceptedOrRequestedFollow.mockImplementation(
      async ({ actorId }: { actorId: string }) =>
        actorId === 'https://example.com/users/target'
          ? { status: FollowStatus.enum.Accepted }
          : null
    )

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.followed_by).toBe(true)
    expect(relationship.requested_by).toBe(false)
  })

  it('returns correct Mastodon Relationship structure', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship).toMatchObject({
      id: expect.toBeString(),
      following: true,
      showing_reblogs: true,
      notifying: false,
      followed_by: true,
      blocking: false,
      blocked_by: false,
      muting: false,
      muting_notifications: false,
      requested: false,
      requested_by: false,
      domain_blocking: false,
      endorsed: false,
      muting_expires_at: null,
      // No stored language filter on this follow -> null (no filter), not a
      // misleading default.
      languages: null
    })
  })

  it('returns endorsed=true when the target is endorsed', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getEndorsement.mockResolvedValue({
      id: '1',
      actorId: mockCurrentActor.id,
      actorHost: 'example.com',
      targetActorId: 'https://example.com/users/target',
      targetActorHost: 'example.com',
      createdAt: 0
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.endorsed).toBe(true)
  })

  it('reports the stored language filter, and null once it is cleared', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(true)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValueOnce({
      status: FollowStatus.enum.Accepted,
      languages: ['en', 'th']
    })

    const withFilter = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })
    expect(withFilter.languages).toEqual(['en', 'th'])

    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValueOnce({
      status: FollowStatus.enum.Accepted,
      languages: null
    })
    const cleared = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })
    expect(cleared.languages).toBeNull()
  })

  it('sets blocking fields from block relationships in both directions', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.isBlocking
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.blocking).toBe(true)
    expect(relationship.blocked_by).toBe(true)
    expect(mockDatabase.isBlocking).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      targetActorId: 'https://example.com/users/target'
    })
    expect(mockDatabase.isBlocking).toHaveBeenCalledWith({
      actorId: 'https://example.com/users/target',
      targetActorId: mockCurrentActor.id
    })
  })

  it('includes the viewer private note about the target', async () => {
    // note is the viewer's private comment (Mastodon account note), not the
    // target's public bio/summary.
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: 'This is my bio'
    })
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getAccountNote.mockResolvedValue('remember to reply')

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.note).toBe('remember to reply')
  })

  it('returns empty note when no private note has been set', async () => {
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: 'This is my bio'
    })
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getAccountNote.mockResolvedValue('')

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.note).toBe('')
  })

  it('returns muting=true and muting_notifications=true when muted with notifications', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getMute.mockResolvedValue({
      id: 'mute-1',
      actorId: mockCurrentActor.id,
      targetActorId: 'https://example.com/users/target',
      notifications: true,
      endsAt: null
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.muting).toBe(true)
    expect(relationship.muting_notifications).toBe(true)
  })

  it('returns muting=true and muting_notifications=false when muted without notifications', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getMute.mockResolvedValue({
      id: 'mute-2',
      actorId: mockCurrentActor.id,
      targetActorId: 'https://example.com/users/target',
      notifications: false,
      endsAt: null
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.muting).toBe(true)
    expect(relationship.muting_notifications).toBe(false)
  })

  it('returns muting=false and muting_notifications=false when not muted', async () => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getMute.mockResolvedValue(null)

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.muting).toBe(false)
    expect(relationship.muting_notifications).toBe(false)
  })

  it.each([
    {
      description: 'reports muting_expires_at as ISO 8601 for a timed mute',
      endsAt: Date.UTC(2026, 5, 1, 12, 0, 0),
      expected: '2026-06-01T12:00:00.000Z'
    },
    {
      description: 'reports muting_expires_at=null for an indefinite mute',
      endsAt: null,
      expected: null
    }
  ])('$description', async ({ endsAt, expected }) => {
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockDatabase.getMute.mockResolvedValue({
      id: 'mute-3',
      actorId: mockCurrentActor.id,
      actorHost: 'example.com',
      targetActorId: 'https://example.com/users/target',
      targetActorHost: 'example.com',
      notifications: false,
      endsAt,
      createdAt: 0,
      updatedAt: 0
    })

    const relationship = await getRelationship({
      database: mockDatabase as unknown as Database,
      currentActor: mockCurrentActor as unknown as Actor,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.muting).toBe(true)
    expect(relationship.muting_expires_at).toEqual(expected)
  })
})
