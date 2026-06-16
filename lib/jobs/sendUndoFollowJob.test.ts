import { unfollow } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { sendUndoFollowJob } from '@/lib/jobs/sendUndoFollowJob'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR6_ID } from '@/lib/stub/seed/actor6'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX
} from '@/lib/stub/seed/external1'
import { FollowStatus } from '@/lib/types/domain/follow'

vi.mock('@/lib/activities', () => ({
  unfollow: vi.fn()
}))

describe('sendUndoFollowJob', () => {
  const database = getTestSQLDatabase()
  const mockUnfollow = unfollow as jest.MockedFunction<typeof unfollow>

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    mockUnfollow.mockReset()
    mockUnfollow.mockResolvedValue(true)
  })

  it('federates an undo follow when the queued follow is still undone', async () => {
    const follow = await database.createFollow({
      actorId: ACTOR6_ID,
      targetActorId: EXTERNAL_ACTOR1,
      inbox: EXTERNAL_ACTOR1_INBOX,
      sharedInbox: EXTERNAL_ACTOR1_INBOX,
      status: FollowStatus.enum.Accepted
    })
    await database.updateFollowStatus({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })

    await sendUndoFollowJob(database, {
      id: 'job-1',
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: ACTOR6_ID,
        follow
      }
    })

    expect(mockUnfollow).toHaveBeenCalledTimes(1)
    expect(mockUnfollow).toHaveBeenCalledWith(
      expect.objectContaining({ id: ACTOR6_ID }),
      expect.objectContaining({
        id: follow.id,
        status: FollowStatus.enum.Undo
      })
    )
  })

  it('skips a stale undo follow when the pair was followed again', async () => {
    const staleFollow = await database.createFollow({
      actorId: ACTOR4_ID,
      targetActorId: EXTERNAL_ACTOR1,
      inbox: EXTERNAL_ACTOR1_INBOX,
      sharedInbox: EXTERNAL_ACTOR1_INBOX,
      status: FollowStatus.enum.Accepted
    })
    await database.updateFollowStatus({
      followId: staleFollow.id,
      status: FollowStatus.enum.Undo
    })
    const activeFollow = await database.createFollow({
      actorId: ACTOR4_ID,
      targetActorId: EXTERNAL_ACTOR1,
      inbox: EXTERNAL_ACTOR1_INBOX,
      sharedInbox: EXTERNAL_ACTOR1_INBOX,
      status: FollowStatus.enum.Accepted
    })

    expect(activeFollow.id).not.toBe(staleFollow.id)

    await sendUndoFollowJob(database, {
      id: 'job-2',
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: ACTOR4_ID,
        follow: staleFollow
      }
    })

    expect(mockUnfollow).not.toHaveBeenCalled()
  })

  it('skips a stale undo follow when the queued row is no longer undone', async () => {
    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })
    if (!follow) fail('Seeded Actor3 -> Actor4 follow is required')

    await sendUndoFollowJob(database, {
      id: 'job-3',
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: ACTOR3_ID,
        follow
      }
    })

    expect(mockUnfollow).not.toHaveBeenCalled()
  })
})
