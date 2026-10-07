import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { deleteActor } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { deleteActorJob } from '@/lib/jobs/deleteActorJob'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { logger } from '@/lib/utils/logger'

enableFetchMocks()

const publish = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

// The sends are asserted at this seam: the stub accounts carry placeholder keys
// that cannot sign a real request.
vi.mock('@/lib/activities', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/activities')>('@/lib/activities')
  return { ...actual, deleteActor: vi.fn().mockResolvedValue(true) }
})

vi.mock('@/lib/services/email', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined)
}))

// This local factory shadows the global @/lib/config mock, so it has to supply
// every export the code under test reaches — including getBaseURL, which the
// shared email layout uses to build absolute links. Omitting it does not fail
// loudly: the job catches email errors by design, so the deletion email would
// silently stop sending while these tests still passed.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'test.social',
    email: {
      serviceFromAddress: 'noreply@test.social'
    }
  }),
  getBaseURL: vi.fn().mockReturnValue('https://test.social')
}))

// Account email addresses are personal data and must never reach the logs
// (and the error-reporting pipeline behind them), on success or failure.
const loggedCalls = () =>
  JSON.stringify([
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.error).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.debug).mock.calls
  ])

describe('deleteActorJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.clearAllMocks()
    // A factory mock keeps its implementation through clearAllMocks, so a
    // test that rejects or inspects the send would leak into the next one.
    vi.mocked(deleteActor).mockReset().mockResolvedValue(true)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: true,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
    vi.spyOn(logger, 'info')
    vi.spyOn(logger, 'error')
    vi.spyOn(logger, 'warn')
    vi.spyOn(logger, 'debug')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes actor and all associated data', async () => {
    // Create a new actor to delete
    const suffix = Date.now().toString()
    const username = `delete-job-test-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Verify actor exists
    let actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeDefined()

    // Schedule deletion first
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Verify actor is deleted
    actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeNull()

    // The deletion receipt actually goes out. Asserted explicitly because the
    // job swallows email failures, so without this a broken template would go
    // unnoticed here.
    const { sendMail } = await vi.importMock<
      typeof import('@/lib/services/email')
    >('@/lib/services/email')
    expect(sendMail).toHaveBeenCalledTimes(1)
    const message = sendMail.mock.calls[0][0]
    expect(message.to).toEqual([`${username}@test.social`])
    expect(message.subject).toBe(
      `Your actor @${username}@test.social has been deleted from test.social`
    )
    expect(message.content.html).toContain('Your actor was deleted')
    expect(message.content.text).toContain('Your actor was deleted')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Sent actor deletion email notification',
        actorId
      })
    )
    expect(loggedCalls()).not.toContain(`${username}@test.social`)
  })

  it('completes actor deletion when the email notification fails', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-mail-failure-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    const { sendMail } = await vi.importMock<
      typeof import('@/lib/services/email')
    >('@/lib/services/email')
    sendMail.mockRejectedValueOnce(new Error('SMTP failure'))

    await expect(
      deleteActorJob(database, {
        id: `delete-job-mail-failure-${suffix}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })
    ).resolves.toBeUndefined()

    expect(await database.getActorFromId({ id: actorId })).toBeNull()
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to send actor deletion email notification',
        actorId
      })
    )
    expect(loggedCalls()).not.toContain(`${username}@test.social`)
  })

  describe('federating the deletion', () => {
    const REMOTE_FOLLOWER_INBOX = 'https://remote.test/inbox'

    const createFollowedActor = async (suffix: string) => {
      const username = `delete-job-federate-${suffix}`
      const actorId = `https://test.social/users/${username}`
      await database.createAccount({
        email: `${username}@test.social`,
        username,
        domain: 'test.social',
        passwordHash: 'hash',
        privateKey: `privateKey-${suffix}`,
        publicKey: `publicKey-${suffix}`
      })
      await database.createFollow({
        actorId: 'https://remote.test/users/follower',
        targetActorId: actorId,
        inbox: 'https://remote.test/users/follower/inbox',
        sharedInbox: REMOTE_FOLLOWER_INBOX,
        status: FollowStatus.enum.Accepted
      })
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId: actorId,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: TEST_SHARED_INBOX,
        status: FollowStatus.enum.Accepted
      })
      await database.scheduleActorDeletion({ actorId, scheduledAt: null })
      return actorId
    }

    it('sends the Delete to remote follower inboxes only, while the deletion is still scheduled', async () => {
      const suffix = `${Date.now()}-remote`
      const actorId = await createFollowedActor(suffix)
      let statusDuringSend: string | null | undefined
      vi.mocked(deleteActor).mockImplementation(async () => {
        statusDuringSend = (
          await database.getActorDeletionStatus({ id: actorId })
        )?.status
        return true
      })

      await deleteActorJob(database, {
        id: `delete-job-federate-${suffix}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })

      expect(
        vi.mocked(deleteActor).mock.calls.map(([args]) => args.inbox)
      ).toEqual([REMOTE_FOLLOWER_INBOX])
      expect(vi.mocked(deleteActor).mock.calls[0][0].currentActor.id).toBe(
        actorId
      )
      expect(statusDuringSend).toBe('scheduled')
      expect(await database.getActorFromId({ id: actorId })).toBeNull()
    })

    it('keeps the actor when the deletion is cancelled while federating', async () => {
      const suffix = `${Date.now()}-cancel`
      const actorId = await createFollowedActor(suffix)
      vi.mocked(deleteActor).mockImplementation(async () => {
        await database.cancelActorDeletion({ actorId })
        return true
      })

      await deleteActorJob(database, {
        id: `delete-job-federate-${suffix}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })

      expect(await database.getActorFromId({ id: actorId })).not.toBeNull()
    })

    it('still deletes the actor when the Delete cannot be sent', async () => {
      const suffix = `${Date.now()}-failure`
      const actorId = await createFollowedActor(suffix)
      vi.mocked(deleteActor).mockRejectedValue(new Error('network down'))

      await expect(
        deleteActorJob(database, {
          id: `delete-job-federate-${suffix}`,
          name: DELETE_ACTOR_JOB_NAME,
          data: { actorId }
        })
      ).resolves.toBeUndefined()

      expect(await database.getActorFromId({ id: actorId })).toBeNull()
    })
  })

  it('handles non-existent actor gracefully', async () => {
    const nonExistentActorId = `https://test.social/users/non-existent-${Date.now()}`

    // Should not throw
    await expect(
      deleteActorJob(database, {
        id: 'delete-job-nonexistent',
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId: nonExistentActorId }
      })
    ).resolves.toBeUndefined()
  })

  it('marks actor as deleting before deletion', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-mark-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Schedule deletion first
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Verify it's scheduled
    let status = await database.getActorDeletionStatus({ id: actorId })
    expect(status?.status).toEqual('scheduled')

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-mark-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Actor should be deleted now
    const actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeNull()
  })

  it('does not delete actor if deletion was cancelled', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-cancel-${suffix}`
    const actorId = `https://test.social/users/${username}`

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })

    // Schedule deletion
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    // Cancel deletion before job runs
    await database.cancelActorDeletion({ actorId })

    // Run the delete job
    await deleteActorJob(database, {
      id: `delete-job-cancel-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    // Actor should still exist (not deleted)
    const actor = await database.getActorFromId({ id: actorId })
    expect(actor).toBeDefined()
    expect(actor?.deletionStatus).toBeNull()
  })

  describe('delayed deletions', () => {
    const createScheduled = async (label: string, scheduledAt: Date | null) => {
      const suffix = Date.now().toString()
      const username = `delete-job-${label}-${suffix}`
      const actorId = `https://test.social/users/${username}`
      await database.createAccount({
        email: `${username}@test.social`,
        username,
        domain: 'test.social',
        passwordHash: 'hash',
        privateKey: `privateKey-${suffix}`,
        publicKey: `publicKey-${suffix}`
      })
      await database.scheduleActorDeletion({ actorId, scheduledAt })
      return actorId
    }

    const run = (actorId: string, scheduledAt?: number) =>
      deleteActorJob(database, {
        id: `delete-job-${actorId}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId, ...(scheduledAt === undefined ? {} : { scheduledAt }) }
      })

    it('deletes an actor whose scheduled time has passed', async () => {
      const scheduledAt = new Date(Date.now() - 1000)
      const actorId = await createScheduled('due', scheduledAt)

      await run(actorId, scheduledAt.getTime())

      expect(await database.getActorFromId({ id: actorId })).toBeNull()
    })

    it('does not delete an actor before its scheduled time', async () => {
      const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      const actorId = await createScheduled('early', scheduledAt)

      await run(actorId)

      const status = await database.getActorDeletionStatus({ id: actorId })
      expect(status?.status).toBe('scheduled')
      expect(await database.getActorFromId({ id: actorId })).not.toBeNull()
      // The in-process queue cannot run it again later; the sweep will.
      expect(publish).not.toHaveBeenCalled()
    })

    it('re-queues an early job with the remaining delay under a real queue', async () => {
      vi.mocked(getQueue).mockReturnValue({
        runsInline: false,
        publish,
        handle: vi.fn()
      } as unknown as ReturnType<typeof getQueue>)
      const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
      const actorId = await createScheduled('requeue', scheduledAt)

      await run(actorId, scheduledAt.getTime())

      expect(await database.getActorFromId({ id: actorId })).not.toBeNull()
      expect(publish).toHaveBeenCalledTimes(1)
      const message = publish.mock.calls[0][0]
      expect(message.name).toBe(DELETE_ACTOR_JOB_NAME)
      expect(message.data).toEqual({
        actorId,
        scheduledAt: scheduledAt.getTime()
      })
      expect(message.delaySeconds).toBeGreaterThan(2 * 3600 - 5)
    })

    it('discards a job queued for a schedule that was since replaced', async () => {
      // A real queue, so the not-yet-due branch would re-publish: only the
      // supersede check keeps a stale job from queueing a duplicate.
      vi.mocked(getQueue).mockReturnValue({
        runsInline: false,
        publish,
        handle: vi.fn()
      } as unknown as ReturnType<typeof getQueue>)
      const oldSchedule = new Date(Date.now() - 1000)
      const actorId = await createScheduled('superseded', oldSchedule)
      // The user cancelled and scheduled again, further out.
      await database.cancelActorDeletion({ actorId })
      await database.scheduleActorDeletion({
        actorId,
        scheduledAt: new Date(Date.now() - 500 + 60 * 60 * 1000)
      })

      await run(actorId, oldSchedule.getTime())

      const status = await database.getActorDeletionStatus({ id: actorId })
      expect(status?.status).toBe('scheduled')
      expect(await database.getActorFromId({ id: actorId })).not.toBeNull()
      expect(publish).not.toHaveBeenCalled()
    })

    it('discards a stale job even when the replacement schedule is already due', async () => {
      // The replacement is due, so the not-yet-due branch cannot stop this
      // run: the supersede check alone keeps a job carrying another
      // schedule's time from deleting the actor. The current schedule's own
      // job does the deletion.
      const oldSchedule = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const actorId = await createScheduled('superseded-due', oldSchedule)
      await database.cancelActorDeletion({ actorId })
      await database.scheduleActorDeletion({
        actorId,
        scheduledAt: new Date(Date.now() - 60 * 1000)
      })

      await run(actorId, oldSchedule.getTime())

      const status = await database.getActorDeletionStatus({ id: actorId })
      expect(status?.status).toBe('scheduled')
      expect(await database.getActorFromId({ id: actorId })).not.toBeNull()
    })
  })
})
