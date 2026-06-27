import type { Notification } from '@/lib/types/database/operations'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'

import {
  followRequestStatusFromFollow,
  resolveFollowRequestStatus
} from './followRequestStatus'

const baseFollow: Follow = {
  id: 'follow-1',
  actorId: 'https://remote.example/users/alice',
  actorHost: 'remote.example',
  targetActorId: 'https://llun.social/users/llun',
  targetActorHost: 'llun.social',
  status: FollowStatus.enum.Requested,
  inbox: 'https://remote.example/users/alice/inbox',
  sharedInbox: 'https://remote.example/inbox',
  reblogs: true,
  notify: false,
  languages: null,
  createdAt: 1000,
  updatedAt: 1000
}

const followRequestNotification: Pick<
  Notification,
  'followId' | 'sourceActorId'
> = {
  followId: 'follow-1',
  sourceActorId: 'https://remote.example/users/alice'
}

const viewerActorId = 'https://llun.social/users/llun'

describe('followRequestStatusFromFollow', () => {
  it('returns resolved when there is no follow record', () => {
    expect(followRequestStatusFromFollow(null)).toBe('resolved')
  })

  it.each([
    [FollowStatus.enum.Requested, 'pending'],
    [FollowStatus.enum.Accepted, 'accepted'],
    [FollowStatus.enum.Rejected, 'rejected'],
    [FollowStatus.enum.Undo, 'resolved']
  ] as const)('maps a %s follow to %s', (status, expected) => {
    expect(followRequestStatusFromFollow({ ...baseFollow, status })).toBe(
      expected
    )
  })
})

describe('resolveFollowRequestStatus', () => {
  it('resolves the exact follow recorded on the notification by id', async () => {
    const getFollowFromId = vi.fn().mockResolvedValue({
      ...baseFollow,
      status: FollowStatus.enum.Accepted
    })
    const getAcceptedOrRequestedFollow = vi.fn()
    const database = { getFollowFromId, getAcceptedOrRequestedFollow }

    const result = await resolveFollowRequestStatus(
      database,
      followRequestNotification,
      viewerActorId
    )

    expect(getFollowFromId).toHaveBeenCalledWith({ followId: 'follow-1' })
    // The exact-id lookup is authoritative, so the requester/viewer pair lookup
    // must not run.
    expect(getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
    expect(result).toBe('accepted')
  })

  it('maps a rejected follow referenced by id to rejected', async () => {
    const getFollowFromId = vi.fn().mockResolvedValue({
      ...baseFollow,
      status: FollowStatus.enum.Rejected
    })
    const database = { getFollowFromId, getAcceptedOrRequestedFollow: vi.fn() }

    const result = await resolveFollowRequestStatus(
      database,
      followRequestNotification,
      viewerActorId
    )

    expect(result).toBe('rejected')
  })

  it('falls back to the requester/viewer pair when the notification has no followId', async () => {
    const getFollowFromId = vi.fn()
    const getAcceptedOrRequestedFollow = vi
      .fn()
      .mockResolvedValue({ ...baseFollow, status: FollowStatus.enum.Requested })
    const database = { getFollowFromId, getAcceptedOrRequestedFollow }

    const result = await resolveFollowRequestStatus(
      database,
      { followId: undefined, sourceActorId: baseFollow.actorId },
      viewerActorId
    )

    expect(getFollowFromId).not.toHaveBeenCalled()
    expect(getAcceptedOrRequestedFollow).toHaveBeenCalledWith({
      actorId: baseFollow.actorId,
      targetActorId: viewerActorId
    })
    expect(result).toBe('pending')
  })

  it('returns resolved when the referenced follow no longer exists', async () => {
    const database = {
      getFollowFromId: vi.fn().mockResolvedValue(null),
      getAcceptedOrRequestedFollow: vi.fn()
    }

    const result = await resolveFollowRequestStatus(
      database,
      followRequestNotification,
      viewerActorId
    )

    expect(result).toBe('resolved')
  })
})
