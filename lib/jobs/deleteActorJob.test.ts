import fs from 'fs/promises'
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import os from 'os'
import path from 'path'

import { deleteActor } from '@/lib/activities'
import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACTOR_DELETION_FEDERATION_BUDGET_MS,
  deleteActorJob
} from '@/lib/jobs/deleteActorJob'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { logger } from '@/lib/utils/logger'

enableFetchMocks()

const publish = vi.fn().mockResolvedValue(undefined)
// The visited or recipient domain's identity: another domain is named after
// itself, a missing host is the primary.
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  resolveDomainIdentity: vi.fn(
    async (_database: unknown, host?: string | null) => ({
      domain: host || 'test.social',
      source: host ? 'database' : 'primary',
      name: host ? `${host} name` : 'Main name',
      description: '',
      contactEmail: host ? `contact@${host}` : '',
      termsOfService: null,
      privacyPolicy: null
    })
  )
}))

const mockServedLinkDomain = vi.hoisted(() =>
  vi.fn<(domain: string) => string | null>(() => null)
)
vi.mock('@/lib/services/domains/localDomains', () => ({
  getServedLinkDomain: mockServedLinkDomain
}))

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
  getBaseURL: vi.fn().mockReturnValue('https://test.social'),
  buildBaseURL: (host: string) => `https://${host}`
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
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
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

  it("deletes the account export files and rows with the account's last actor", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delete-archives-'))
    vi.mocked(getConfig).mockReturnValue({
      host: 'test.social',
      email: { serviceFromAddress: 'noreply@test.social' },
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    } as unknown as ReturnType<typeof getConfig>)
    const suffix = `${Date.now()}-archives`
    const username = `delete-archives-${suffix}`
    const actorId = `https://test.social/users/${username}`
    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })
    const accountId = (await database.getActorFromId({ id: actorId }))!.account!
      .id
    const archiveId = crypto.randomUUID()
    const archiveRow = await database.createAccountArchive({
      id: archiveId,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await database.updateAccountArchive({ id: archiveId, status: 'ready' })
    const zip = path.join(
      root,
      'archives',
      archiveId,
      archiveRow.storageToken,
      'archive-1.zip'
    )
    await fs.mkdir(path.dirname(zip), { recursive: true })
    await fs.writeFile(zip, 'PRIVATE EXPORT')
    const other = path.join(root, 'archives', 'someone-else', 'archive.zip')
    await fs.mkdir(path.dirname(other), { recursive: true })
    await fs.writeFile(other, 'KEEP')

    await database.scheduleActorDeletion({ actorId, scheduledAt: null })
    await deleteActorJob(database, {
      id: `delete-job-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    expect(await database.getActorFromId({ id: actorId })).toBeNull()
    await expect(fs.stat(zip)).rejects.toThrow()
    expect((await fs.readFile(other)).toString()).toBe('KEEP')
    expect(await database.getAccountArchive({ id: archiveId })).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('still removes the exports when two actors of an account are deleted at once', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delete-race-'))
    vi.mocked(getConfig).mockReturnValue({
      host: 'test.social',
      email: { serviceFromAddress: 'noreply@test.social' },
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    } as unknown as ReturnType<typeof getConfig>)
    const suffix = `${Date.now()}-race`
    const first = `delete-race-a-${suffix}`
    const firstId = `https://test.social/users/${first}`
    await database.createAccount({
      email: `${first}@test.social`,
      username: first,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })
    const accountId = (await database.getActorFromId({ id: firstId }))!.account!
      .id
    const second = `delete-race-b-${suffix}`
    const secondId = await database.createActorForAccount({
      accountId,
      username: second,
      domain: 'test.social',
      publicKey: 'public',
      privateKey: 'private'
    })
    expect(secondId).toBeTruthy()

    const archiveId = crypto.randomUUID()
    const row = await database.createAccountArchive({
      id: archiveId,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await database.updateAccountArchive({ id: archiveId, status: 'ready' })
    const zip = path.join(
      root,
      'archives',
      archiveId,
      row.storageToken,
      'archive-1.zip'
    )
    await fs.mkdir(path.dirname(zip), { recursive: true })
    await fs.writeFile(zip, 'PRIVATE EXPORT')

    // Both jobs started while the other actor still existed: each one's check
    // before deleting sees a sibling, so neither purges there.
    const real = database.getActorsForAccount.bind(database)
    let calls = 0
    vi.spyOn(database, 'getActorsForAccount').mockImplementation(
      async (params) => {
        const actors = await real(params)
        calls += 1
        // The first lookup of each job (before its deletion) is stale.
        return calls % 2 === 1
          ? [...actors, { ...actors[0], id: 'https://test.social/users/other' }]
          : actors
      }
    )

    const actorIdToDelete = `https://test.social/users/${second}`
    for (const id of [firstId, actorIdToDelete]) {
      await database.scheduleActorDeletion({ actorId: id, scheduledAt: null })
      await deleteActorJob(database, {
        id: `delete-race-${id}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId: id }
      })
    }

    await expect(fs.stat(zip)).rejects.toThrow()
    expect(await database.getAccountArchive({ id: archiveId })).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
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

  it('names the served domain and its contact address in the deletion email', async () => {
    const suffix = Date.now().toString()
    const username = `delete-job-brand-${suffix}`
    const actorId = `https://test.social/users/${username}`
    mockServedLinkDomain.mockReturnValue('run.example')

    await database.createAccount({
      email: `${username}@test.social`,
      username,
      domain: 'test.social',
      passwordHash: 'hash',
      privateKey: `privateKey-${suffix}`,
      publicKey: `publicKey-${suffix}`
    })
    await database.scheduleActorDeletion({ actorId, scheduledAt: null })

    await deleteActorJob(database, {
      id: `delete-job-brand-${suffix}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })

    const { sendMail } = await vi.importMock<
      typeof import('@/lib/services/email')
    >('@/lib/services/email')
    const message = sendMail.mock.calls.at(-1)?.[0]
    expect(message?.content.html).toContain('contact@run.example')
    expect(message?.content.text).toContain('contact@run.example')
    mockServedLinkDomain.mockReturnValue(null)
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

    it('skips the sends once the federation budget is spent', async () => {
      const suffix = `${Date.now()}-budget`
      const actorId = await createFollowedActor(suffix)
      // Move the clock past the budget once the inboxes are being gathered,
      // after the deadline has been fixed.
      let clockOffset = 0
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset)
      const getLocalFollowers =
        database.getLocalFollowersForActorId.bind(database)
      vi.spyOn(database, 'getLocalFollowersForActorId').mockImplementation(
        async (params) => {
          clockOffset = ACTOR_DELETION_FEDERATION_BUDGET_MS + 1
          return getLocalFollowers(params)
        }
      )

      await deleteActorJob(database, {
        id: `delete-job-federate-${suffix}`,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })

      expect(deleteActor).not.toHaveBeenCalled()
      expect(await database.getActorFromId({ id: actorId })).toBeNull()
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
