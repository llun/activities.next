import { applyBlock } from '@/lib/actions/applyBlock'
import { applyUnblock } from '@/lib/actions/applyUnblock'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

describe('applyBlock', () => {
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

  it('creates a block and tears down accepted/requested follows in both directions', async () => {
    const forward = await database.getAcceptedOrRequestedFollow({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    })
    expect(forward?.status).toBe(FollowStatus.enum.Accepted)

    const reverse = await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID,
      status: FollowStatus.enum.Requested,
      inbox: `${ACTOR2_ID}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })

    const block = await applyBlock({
      database,
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID,
      uri: `${ACTOR2_ID}#blocks/test-block`
    })

    expect(block).toMatchObject({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID
    })
    await expect(
      database.getFollowFromId({ followId: forward!.id })
    ).resolves.toMatchObject({
      status: FollowStatus.enum.Undo
    })
    await expect(
      database.getFollowFromId({ followId: reverse.id })
    ).resolves.toMatchObject({
      status: FollowStatus.enum.Undo
    })
    expect(getQueue().publish).toHaveBeenCalledTimes(2)
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${forward!.id}/undo`),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: forward!.actorId,
        follow: forward
      }
    })
    expect(getQueue().publish).toHaveBeenCalledWith({
      id: getHashFromString(`${reverse.id}/undo`),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: reverse.actorId,
        follow: reverse
      }
    })
  })

  it('unblocks without restoring follows', async () => {
    const block = await applyUnblock({
      database,
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID
    })

    expect(block).toMatchObject({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID
    })
    await expect(
      database.getAcceptedOrRequestedFollow({
        actorId: ACTOR3_ID,
        targetActorId: ACTOR2_ID
      })
    ).resolves.toBeNull()
    await expect(
      database.isBlocking({ actorId: ACTOR2_ID, targetActorId: ACTOR3_ID })
    ).resolves.toBe(false)
  })
})
