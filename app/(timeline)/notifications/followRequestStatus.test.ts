import { Follow, FollowStatus } from '@/lib/types/domain/follow'

import { followRequestStatusFromFollow } from './followRequestStatus'

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

describe('followRequestStatusFromFollow', () => {
  it('returns resolved when there is no follow record', () => {
    expect(followRequestStatusFromFollow(null)).toBe('resolved')
  })

  it.each([
    [FollowStatus.enum.Requested, 'pending'],
    [FollowStatus.enum.Accepted, 'accepted'],
    [FollowStatus.enum.Rejected, 'resolved'],
    [FollowStatus.enum.Undo, 'resolved']
  ] as const)('maps a %s follow to %s', (status, expected) => {
    expect(followRequestStatusFromFollow({ ...baseFollow, status })).toBe(
      expected
    )
  })
})
