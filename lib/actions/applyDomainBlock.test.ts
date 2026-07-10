import { applyDomainBlock } from '@/lib/actions/applyDomainBlock'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

describe('applyDomainBlock', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the block and severs follows with the domain in both directions', async () => {
    const domain = 'severed.test'
    const outbound = await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: `https://${domain}/users/followed`,
      inbox: `https://${domain}/users/followed/inbox`,
      sharedInbox: `https://${domain}/inbox`,
      status: FollowStatus.enum.Accepted
    })
    const inbound = await database.createFollow({
      actorId: `https://${domain}/users/follower`,
      targetActorId: ACTOR1_ID,
      inbox: `https://${domain}/users/follower/inbox`,
      sharedInbox: `https://${domain}/inbox`,
      status: FollowStatus.enum.Accepted
    })

    await applyDomainBlock({ database, actorId: ACTOR1_ID, domain })

    await expect(
      database.isDomainBlockedByActor({ actorId: ACTOR1_ID, domain })
    ).resolves.toBe(true)
    await expect(
      database.getFollowFromId({ followId: outbound.id })
    ).resolves.toMatchObject({ status: FollowStatus.enum.Undo })
    await expect(
      database.getFollowFromId({ followId: inbound.id })
    ).resolves.toMatchObject({ status: FollowStatus.enum.Undo })

    // Only the caller's own outbound follow federates an Undo Follow (its
    // actor is local and has a signing key); the dropped remote follower's
    // row is severed without federation, matching applyBlock.
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${outbound.id}/undo`),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: outbound.actorId,
        follow: outbound
      }
    })
  })

  it('decides federation from follow.actorId without a per-follow actor lookup', async () => {
    const domain = 'noquery.test'
    const outbound = await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: `https://${domain}/users/followed`,
      inbox: `https://${domain}/users/followed/inbox`,
      sharedInbox: `https://${domain}/inbox`,
      status: FollowStatus.enum.Accepted
    })
    await database.createFollow({
      actorId: `https://${domain}/users/follower`,
      targetActorId: ACTOR1_ID,
      inbox: `https://${domain}/users/follower/inbox`,
      sharedInbox: `https://${domain}/inbox`,
      status: FollowStatus.enum.Accepted
    })

    const getActorFromId = vi.spyOn(database, 'getActorFromId')
    try {
      await applyDomainBlock({ database, actorId: ACTOR1_ID, domain })
      // The caller's own outbound follow is identified by comparing
      // follow.actorId to the blocking actor — no getActorFromId call per
      // severed follow (that was an N+1 across up to SEVER_BATCH_SIZE rows every
      // batch). Assert before mockRestore(), which clears the recorded calls.
      expect(getActorFromId).not.toHaveBeenCalled()
    } finally {
      getActorFromId.mockRestore()
    }

    // Only the caller's own outbound follow federates an Undo Follow.
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${outbound.id}/undo`),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: outbound.actorId,
        follow: outbound
      }
    })
  })

  it('leaves follows with other domains untouched', async () => {
    const keptFollow = await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: 'https://kept.test/users/friend',
      inbox: 'https://kept.test/users/friend/inbox',
      sharedInbox: 'https://kept.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    await applyDomainBlock({
      database,
      actorId: ACTOR1_ID,
      domain: 'unrelated.test'
    })

    await expect(
      database.getFollowFromId({ followId: keptFollow.id })
    ).resolves.toMatchObject({ status: FollowStatus.enum.Accepted })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('is idempotent when the domain is already blocked', async () => {
    const domain = 'twice.test'

    const first = await applyDomainBlock({
      database,
      actorId: ACTOR1_ID,
      domain
    })
    const second = await applyDomainBlock({
      database,
      actorId: ACTOR1_ID,
      domain
    })

    expect(second.id).toBe(first.id)
    await expect(
      database.getActorDomainBlocks({ actorId: ACTOR1_ID })
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ domain })])
    )
  })
})
