import { FollowStatus } from '@/lib/models/follow'

import { getRelationship } from './relationship'

describe('#getRelationship', () => {
  const mockDatabase = {
    getActorFromId: jest.fn(),
    isCurrentActorFollowing: jest.fn(),
    getAcceptedOrRequestedFollow: jest.fn()
  }

  const mockCurrentActor = {
    id: 'https://example.com/users/current',
    username: 'current',
    domain: 'example.com'
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: 'Target user bio'
    })
  })

  it('returns relationship with following=true when following', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(true) // current follows target
      .mockResolvedValueOnce(false) // target follows current
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    const relationship = await getRelationship({
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
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
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
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
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.following).toBe(false)
    expect(relationship.requested).toBe(true)
  })

  it('returns correct Mastodon Relationship structure', async () => {
    mockDatabase.isCurrentActorFollowing
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: FollowStatus.enum.Accepted
    })

    const relationship = await getRelationship({
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
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
      languages: expect.toBeArray()
    })
  })

  it('includes note from target actor summary', async () => {
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: 'This is my bio'
    })
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)

    const relationship = await getRelationship({
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.note).toBe('This is my bio')
  })

  it('returns empty note when actor has no summary', async () => {
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://example.com/users/target',
      summary: null
    })
    mockDatabase.isCurrentActorFollowing.mockResolvedValue(false)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)

    const relationship = await getRelationship({
      database: mockDatabase as any,
      currentActor: mockCurrentActor as any,
      targetActorId: 'https://example.com/users/target'
    })

    expect(relationship.note).toBe('')
  })
})
