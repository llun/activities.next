import type { Database } from '@/lib/database/types'
import type { ActorProfile } from '@/lib/types/domain/actor'

import { getFollowListBlockedActorIds } from './getFollowListBlockedActorIds'

const actorProfile = (id: string): ActorProfile => ({
  id,
  username: id.split('/').pop() ?? id,
  domain: 'example.test',
  name: id,
  summary: '',
  iconUrl: '',
  headerImageUrl: '',
  followersUrl: `${id}/followers`,
  inboxUrl: `${id}/inbox`,
  sharedInboxUrl: 'https://example.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
})

describe('getFollowListBlockedActorIds', () => {
  it('returns listed actors blocked in either direction with the current actor', async () => {
    const currentActorId = 'https://example.test/users/current'
    const blockedActorId = 'https://example.test/users/blocked'
    const blockingActorId = 'https://example.test/users/blocking'
    const unrelatedActorId = 'https://example.test/users/unrelated'
    const getBlockRelations = vi.fn(async () => [
      {
        actorId: currentActorId,
        targetActorId: blockedActorId
      },
      {
        actorId: blockingActorId,
        targetActorId: currentActorId
      },
      {
        actorId: currentActorId,
        targetActorId: 'https://example.test/users/not-listed'
      }
    ])
    const database = { getBlockRelations } as unknown as Pick<
      Database,
      'getBlockRelations'
    >

    await expect(
      getFollowListBlockedActorIds(database, currentActorId, [
        actorProfile(unrelatedActorId),
        actorProfile(blockedActorId),
        actorProfile(blockingActorId)
      ])
    ).resolves.toEqual([blockedActorId, blockingActorId])

    expect(getBlockRelations).toHaveBeenCalledWith({
      actorIds: [currentActorId],
      targetActorIds: [unrelatedActorId, blockedActorId, blockingActorId]
    })
  })

  it('does not query block relations without a current actor or users', async () => {
    const getBlockRelations = vi.fn()
    const database = { getBlockRelations } as unknown as Pick<
      Database,
      'getBlockRelations'
    >

    await expect(
      getFollowListBlockedActorIds(database, undefined, [
        actorProfile('https://example.test/users/blocked')
      ])
    ).resolves.toEqual([])
    await expect(
      getFollowListBlockedActorIds(
        database,
        'https://example.test/users/current',
        []
      )
    ).resolves.toEqual([])
    expect(getBlockRelations).not.toHaveBeenCalled()
  })
})
