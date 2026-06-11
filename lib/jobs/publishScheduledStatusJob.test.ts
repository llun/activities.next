import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { publishScheduledStatusJob } from '@/lib/jobs/publishScheduledStatusJob'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { ScheduledStatusParams } from '@/lib/types/mastodon/scheduledStatus'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from './names'

enableFetchMocks()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: jest.fn()
}))

const baseParams = (
  overrides: Partial<ScheduledStatusParams> = {}
): ScheduledStatusParams => ({
  text: 'Scheduled post',
  poll: null,
  media_ids: null,
  sensitive: null,
  spoiler_text: null,
  visibility: 'public',
  in_reply_to_id: null,
  language: null,
  application_id: null,
  scheduled_at: null,
  idempotency: null,
  with_rate_limit: false,
  ...overrides
})

describe('publishScheduledStatusJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('publishes a due scheduled status and removes the scheduled row', async () => {
    const text = `Due scheduled note ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text, visibility: 'unlisted' })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-due',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    const published = statuses.find((status) => status.text.includes(text))
    expect(published).toBeDefined()
    expect(published?.actorId).toBe(actor1.id)

    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('publishes a due scheduled poll and removes the scheduled row', async () => {
    const text = `Due scheduled poll ${Date.now()}`
    const options = ['Red', 'Green', 'Blue']
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({
        text,
        poll: {
          options,
          expires_in: 3600,
          multiple: false,
          hide_totals: false
        }
      })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-poll',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    const published = statuses.find((status) => status.text.includes(text))
    expect(published).toBeDefined()
    expect(published?.type).toBe('Poll')
    const choices = (published as { choices: { title: string }[] }).choices
    expect(choices.map((choice) => choice.title)).toEqual(options)

    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('drops the scheduled row without re-publishing when the idempotency key already maps to a status', async () => {
    const text = `Idempotent scheduled note ${Date.now()}`
    const idempotency = `idem-${Date.now()}`
    // Simulate a prior publish: the idempotency key already maps to a status.
    await database.saveIdempotencyKey({
      actorId: actor1.id,
      key: idempotency,
      statusId: `${actor1.id}/statuses/already-published`
    })

    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text, idempotency })
    })

    const before = await database.getActorStatuses({ actorId: actor1.id })

    await publishScheduledStatusJob(database, {
      id: 'job-idempotent',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    // No duplicate status was created for the deduped scheduled post.
    const after = await database.getActorStatuses({ actorId: actor1.id })
    expect(after).toHaveLength(before.length)
    expect(after.some((status) => status.text.includes(text))).toBe(false)

    // The scheduled row is cleaned up regardless.
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('is idempotent by default (no client key) using a row-derived key', async () => {
    const text = `Default-idempotent scheduled note ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text, idempotency: null })
    })
    // Simulate a prior publish recorded under the row-derived fallback key
    // (what the job saves when the client supplied no Idempotency-Key).
    await database.saveIdempotencyKey({
      actorId: actor1.id,
      key: `scheduled-${scheduled.id}`,
      statusId: `${actor1.id}/statuses/already-published-default`
    })

    const before = await database.getActorStatuses({ actorId: actor1.id })

    await publishScheduledStatusJob(database, {
      id: 'job-default-idempotent',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    // The retry did not publish a duplicate, and the row is cleaned up.
    const after = await database.getActorStatuses({ actorId: actor1.id })
    expect(after).toHaveLength(before.length)
    expect(after.some((status) => status.text.includes(text))).toBe(false)
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('discards an obsolete job whose scheduledAt no longer matches the row', async () => {
    const text = `Rescheduled away ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-obsolete',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      // A scheduledAt that does not match the stored row — this job is from a
      // previous schedule and must be discarded without publishing.
      data: {
        scheduledStatusId: scheduled.id,
        scheduledAt: Date.now() - 999_999
      }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    expect(statuses.some((status) => status.text.includes(text))).toBe(false)
    expect(getQueue().publish).not.toHaveBeenCalled()
    // The row is left intact for the current schedule's own job to publish.
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).not.toBeNull()
  })

  it('publishes when the job scheduledAt matches the row', async () => {
    const text = `Matching schedule ${Date.now()}`
    const scheduledAt = Date.now() - 1_000
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt,
      params: baseParams({ text })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-matching',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id, scheduledAt }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    expect(statuses.some((status) => status.text.includes(text))).toBe(true)
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('is a no-op for an unknown scheduled status id', async () => {
    await expect(
      publishScheduledStatusJob(database, {
        id: 'job-missing',
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: 'does-not-exist' }
      })
    ).resolves.toBeUndefined()

    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('re-enqueues without publishing when the scheduled time is still far ahead', async () => {
    const text = `Future scheduled note ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() + 10 * 60 * 1000,
      params: baseParams({ text })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-early',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    // Re-enqueued with the remaining delay, not published.
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
    const publishArgs = (getQueue().publish as jest.Mock).mock.calls[0][0]
    expect(publishArgs).toMatchObject({
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })
    expect(publishArgs.delaySeconds).toBeGreaterThan(60)
    // The early re-enqueue uses a distinct dedup id (suffixed `-reenqueue`) so
    // QStash does not drop it as a duplicate of the original create enqueue.
    expect(publishArgs.id).toBe(
      getHashFromString(`${scheduled.id}-${scheduled.scheduledAt}-reenqueue`)
    )
    expect(publishArgs.id).not.toBe(
      getHashFromString(`${scheduled.id}-${scheduled.scheduledAt}`)
    )

    // No status was published and the scheduled row still exists.
    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    expect(statuses.some((status) => status.text.includes(text))).toBe(false)
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).not.toBeNull()
  })

  it('drops the scheduled row without publishing when the actor no longer exists', async () => {
    const scheduled = await database.createScheduledStatus({
      actorId: 'https://llun.test/users/ghost-actor',
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text: `Orphan scheduled note ${Date.now()}` })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-actor-missing',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    expect(getQueue().publish).not.toHaveBeenCalled()
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('drops the scheduled row without publishing when the media can no longer be resolved', async () => {
    const text = `Missing media scheduled note ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text, media_ids: ['999999999'] })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-media-missing',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    expect(statuses.some((status) => status.text.includes(text))).toBe(false)
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })

  it('drops the scheduled row without publishing when status creation returns null', async () => {
    // A direct-visibility note with no resolvable mentions is unpublishable:
    // createNoteFromUserInput returns null. The job must still clear the row.
    const text = `Direct with no mentions ${Date.now()}`
    const scheduled = await database.createScheduledStatus({
      actorId: actor1.id,
      scheduledAt: Date.now() - 1_000,
      params: baseParams({ text, visibility: 'direct' })
    })

    await publishScheduledStatusJob(database, {
      id: 'job-null-status',
      name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
      data: { scheduledStatusId: scheduled.id }
    })

    const statuses = await database.getActorStatuses({ actorId: actor1.id })
    expect(statuses.some((status) => status.text.includes(text))).toBe(false)
    const row = await database.getScheduledStatusById({ id: scheduled.id })
    expect(row).toBeNull()
  })
})
