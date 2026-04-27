import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { canActorReadStatus, isStatusPubliclyReadable } from './statusAccess'

const ACTOR_ID = 'https://example.com/users/author'
const FOLLOWER_ID = 'https://example.com/users/follower'
const FOLLOWERS_URL = `${ACTOR_ID}/followers`

const actor = {
  id: FOLLOWER_ID
} as Actor

const note = ({ id, to, cc }: { id: string; to: string[]; cc: string[] }) =>
  ({
    id,
    actorId: ACTOR_ID,
    type: StatusType.enum.Note,
    to,
    cc
  }) as Status

describe('status access helpers', () => {
  it('treats public and unlisted statuses as publicly readable', () => {
    expect(
      isStatusPubliclyReadable(
        note({
          id: `${ACTOR_ID}/statuses/public`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      )
    ).toBe(true)

    expect(
      isStatusPubliclyReadable(
        note({
          id: `${ACTOR_ID}/statuses/unlisted`,
          to: [FOLLOWERS_URL],
          cc: [ACTIVITY_STREAM_PUBLIC]
        })
      )
    ).toBe(true)
  })

  it('does not treat followers-only or direct statuses as publicly readable', () => {
    expect(
      isStatusPubliclyReadable(
        note({
          id: `${ACTOR_ID}/statuses/private`,
          to: [FOLLOWERS_URL],
          cc: []
        })
      )
    ).toBe(false)

    expect(
      isStatusPubliclyReadable(
        note({
          id: `${ACTOR_ID}/statuses/direct`,
          to: [FOLLOWER_ID],
          cc: []
        })
      )
    ).toBe(false)
  })

  it('requires both an announce and its original status to be public', () => {
    const privateOriginal = note({
      id: `${ACTOR_ID}/statuses/private-original`,
      to: [FOLLOWERS_URL],
      cc: []
    })

    const announce = {
      id: `${FOLLOWER_ID}/statuses/announce`,
      actorId: FOLLOWER_ID,
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatus: privateOriginal
    } as Status

    expect(isStatusPubliclyReadable(announce)).toBe(false)
  })

  it('allows accepted followers to read followers-only statuses', async () => {
    const database = {
      getAcceptedOrRequestedFollow: jest.fn().mockResolvedValue({
        status: FollowStatus.enum.Accepted
      })
    }
    const status = note({
      id: `${ACTOR_ID}/statuses/private-for-follower`,
      to: [FOLLOWERS_URL],
      cc: []
    })

    await expect(
      canActorReadStatus({
        database: database as never,
        status,
        currentActor: actor
      })
    ).resolves.toBe(true)
  })

  it('does not allow requested followers to read followers-only statuses', async () => {
    const database = {
      getAcceptedOrRequestedFollow: jest.fn().mockResolvedValue({
        status: FollowStatus.enum.Requested
      })
    }
    const status = note({
      id: `${ACTOR_ID}/statuses/private-for-requested-follower`,
      to: [FOLLOWERS_URL],
      cc: []
    })

    await expect(
      canActorReadStatus({
        database: database as never,
        status,
        currentActor: actor
      })
    ).resolves.toBe(false)
  })

  it('allows direct recipients to read direct statuses', async () => {
    const database = {
      getAcceptedOrRequestedFollow: jest.fn()
    }
    const status = note({
      id: `${ACTOR_ID}/statuses/direct-for-recipient`,
      to: [FOLLOWER_ID],
      cc: []
    })

    await expect(
      canActorReadStatus({
        database: database as never,
        status,
        currentActor: actor
      })
    ).resolves.toBe(true)
    expect(database.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })

  it('uses pre-fetched follower state when provided', async () => {
    const database = {
      getAcceptedOrRequestedFollow: jest.fn()
    }
    const status = note({
      id: `${ACTOR_ID}/statuses/private-prefetched-follower`,
      to: [FOLLOWERS_URL],
      cc: []
    })

    await expect(
      canActorReadStatus({
        database: database as never,
        status,
        currentActor: actor,
        isFollower: true
      })
    ).resolves.toBe(true)
    expect(database.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })
})
