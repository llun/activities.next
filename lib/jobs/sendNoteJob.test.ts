import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { DELIVER_ACTIVITY_JOB_NAME, SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import {
  MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
  getDeliveryJobId,
  sendNoteJob
} from '@/lib/jobs/sendNoteJob'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

enableFetchMocks()

const hoisted = vi.hoisted(() => ({
  database: null as unknown,
  publishSpy: vi.fn(),
  runsInline: true,
  failInbox: null as string | null,
  activePublishes: 0,
  maxConcurrentPublishes: 0,
  publishDelayMs: 0
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: hoisted.runsInline,
    publish: async (message: { name: string; data: { inbox?: string } }) => {
      hoisted.activePublishes++
      hoisted.maxConcurrentPublishes = Math.max(
        hoisted.maxConcurrentPublishes,
        hoisted.activePublishes
      )
      hoisted.publishSpy(message)
      try {
        if (hoisted.publishDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, hoisted.publishDelayMs)
          )
        }
        if (hoisted.failInbox && message.data?.inbox === hoisted.failInbox) {
          throw new Error('Simulated inbox delivery rejection')
        }
        if (hoisted.runsInline) {
          const { JOBS } = await import('@/lib/jobs')
          const job = (JOBS as Record<string, unknown>)[message.name] as
            ((db: unknown, msg: unknown) => Promise<void>) | undefined
          if (job && hoisted.database) {
            await job(hoisted.database, message)
          }
        }
      } finally {
        hoisted.activePublishes--
      }
    }
  })
}))

describe('sendNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    hoisted.database = database
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    hoisted.publishSpy.mockClear()
    hoisted.failInbox = null
    hoisted.runsInline = true
    hoisted.activePublishes = 0
    hoisted.maxConcurrentPublishes = 0
    hoisted.publishDelayMs = 0
  })

  it('does nothing when status is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    await expect(
      sendNoteJob(database, {
        id: 'job-1',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: 'https://nonexistent.test/statuses/missing'
        }
      })
    ).resolves.toBeUndefined()
  })

  it('does nothing when actor is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a status
    const statusId = `${actor1.id}/statuses/for-send-note-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: 'Test status',
      createdAt: Date.now()
    })

    await expect(
      sendNoteJob(database, {
        id: 'job-2',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: 'https://nonexistent.test/users/nobody',
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('sends note to follower inboxes', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a note status
    const statusId = `${actor1.id}/statuses/note-to-send-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note content to send',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'job-3',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    expect(
      fetchMock.mock.calls.some(
        (call) => call[0] === 'https://somewhere.test/inbox'
      )
    ).toBe(true)
  })

  it('enqueues a DeliverActivityJob for each federated inbox', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/fanout-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note content to test fanout',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'job-fanout',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    expect(hoisted.publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: DELIVER_ACTIVITY_JOB_NAME,
        data: expect.objectContaining({
          inbox: 'https://somewhere.test/inbox',
          actorId: actor1.id
        })
      })
    )
  })

  it('does not send notes to suspended domains', async () => {
    if (!actor1) fail('Actor1 is required')

    await database.createDomainBlock({
      domain: 'somewhere.test',
      severity: 'suspend'
    })

    const statusId = `${actor1.id}/statuses/blocked-note-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Blocked domain should not receive this',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'job-blocked',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    expect(
      fetchMock.mock.calls.some(
        (call) => call[0] === 'https://somewhere.test/inbox'
      )
    ).toBe(false)
  })

  it('handles note with mentions', async () => {
    if (!actor1) fail('Actor1 is required')

    // Create a note status with mention
    const statusId = `${actor1.id}/statuses/note-with-mention-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      text: '@test2@external.test Hello there!',
      createdAt: Date.now()
    })

    await expect(
      sendNoteJob(database, {
        id: 'job-4',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    ).resolves.toBeUndefined()
  })

  it('continues delivering to sibling inboxes when one inbox fails under inline queue (Promise.allSettled)', async () => {
    if (!actor1) fail('Actor1 is required')

    await database.createFollow({
      actorId: 'https://friend2.test/actors/user2',
      targetActorId: actor1.id,
      inbox: 'https://friend2.test/inbox/user2',
      sharedInbox: 'https://friend2.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    await database.createFollow({
      actorId: 'https://friend3.test/actors/user3',
      targetActorId: actor1.id,
      inbox: 'https://friend3.test/inbox/user3',
      sharedInbox: 'https://friend3.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    hoisted.failInbox = 'https://friend3.test/inbox'

    const statusId = `${actor1.id}/statuses/resilient-fanout-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Resilient fanout to multiple followers',
      createdAt: Date.now()
    })

    await expect(
      sendNoteJob(database, {
        id: 'job-resilient',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    ).resolves.toBeUndefined()

    expect(hoisted.publishSpy).toHaveBeenCalled()
    expect(
      fetchMock.mock.calls.some(
        (call) => call[0] === 'https://friend2.test/inbox'
      )
    ).toBe(true)
  })

  it('enqueues a DeliverActivityJob with deterministic child ID derived from parent message id and inbox', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/deterministic-id-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Deterministic ID note',
      createdAt: Date.now()
    })

    const parentId = 'job-deterministic-fanout'
    await sendNoteJob(database, {
      id: parentId,
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    const expectedId = getDeliveryJobId(parentId, 'https://friend2.test/inbox')
    expect(hoisted.publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        name: DELIVER_ACTIVITY_JOB_NAME,
        data: expect.objectContaining({
          inbox: 'https://friend2.test/inbox',
          actorId: actor1.id
        })
      })
    )
  })

  it('produces stable child delivery IDs on parent retry and distinct IDs across parent generations', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/stable-id-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note content for stable ID test',
      createdAt: Date.now()
    })

    // Generation 1 run 1
    await sendNoteJob(database, {
      id: 'parent-gen-1',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })
    const gen1Calls = [...hoisted.publishSpy.mock.calls]
    const gen1JobIds = gen1Calls.map((call) => (call[0] as { id: string }).id)

    // Generation 1 run 2 (retry with same parent message ID)
    hoisted.publishSpy.mockClear()
    await sendNoteJob(database, {
      id: 'parent-gen-1',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })
    const retryCalls = [...hoisted.publishSpy.mock.calls]
    const retryJobIds = retryCalls.map((call) => (call[0] as { id: string }).id)
    expect(retryJobIds).toEqual(gen1JobIds)

    // Generation 2 run (different parent message ID)
    hoisted.publishSpy.mockClear()
    await sendNoteJob(database, {
      id: 'parent-gen-2',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })
    const gen2Calls = [...hoisted.publishSpy.mock.calls]
    const gen2JobIds = gen2Calls.map((call) => (call[0] as { id: string }).id)
    expect(gen2JobIds).not.toEqual(gen1JobIds)
    const firstInbox = (gen2Calls[0][0] as { data: { inbox: string } }).data
      .inbox
    expect(gen2JobIds[0]).toBe(getDeliveryJobId('parent-gen-2', firstInbox))
  })

  it('deduplicates identical inbox URLs across multiple followers', async () => {
    if (!actor1) fail('Actor1 is required')

    const sharedInboxUrl = 'https://shared-instance.test/inbox'
    await database.createFollow({
      actorId: 'https://shared-instance.test/actors/alice',
      targetActorId: actor1.id,
      inbox: 'https://shared-instance.test/actors/alice/inbox',
      sharedInbox: sharedInboxUrl,
      status: FollowStatus.enum.Accepted
    })

    await database.createFollow({
      actorId: 'https://shared-instance.test/actors/bob',
      targetActorId: actor1.id,
      inbox: 'https://shared-instance.test/actors/bob/inbox',
      sharedInbox: sharedInboxUrl,
      status: FollowStatus.enum.Accepted
    })

    const statusId = `${actor1.id}/statuses/dedup-inbox-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note for dedup inbox test',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'parent-dedup-test',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    const callsToSharedInbox = hoisted.publishSpy.mock.calls.filter(
      (call) =>
        (call[0] as { data?: { inbox?: string } }).data?.inbox ===
        sharedInboxUrl
    )
    expect(callsToSharedInbox).toHaveLength(1)
  })

  it('awaits all attempted publications and propagates error when queue is asynchronous', async () => {
    if (!actor1) fail('Actor1 is required')

    hoisted.runsInline = false

    await database.createFollow({
      actorId: 'https://async-target-1.test/actors/user1',
      targetActorId: actor1.id,
      inbox: 'https://async-target-1.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    await database.createFollow({
      actorId: 'https://async-target-2.test/actors/user2',
      targetActorId: actor1.id,
      inbox: 'https://async-target-2.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    hoisted.failInbox = 'https://async-target-1.test/inbox'

    const statusId = `${actor1.id}/statuses/async-failure-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note for async failure propagation',
      createdAt: Date.now()
    })

    await expect(
      sendNoteJob(database, {
        id: 'parent-async-fail',
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    ).rejects.toThrow('Simulated inbox delivery rejection')

    const inboxesPublished = hoisted.publishSpy.mock.calls.map(
      (call) => (call[0] as { data?: { inbox?: string } }).data?.inbox
    )
    expect(inboxesPublished).toContain('https://async-target-1.test/inbox')
    expect(inboxesPublished).toContain('https://async-target-2.test/inbox')
  })

  it('limits concurrent publications to at most 10 without exceeding the limit', async () => {
    if (!actor1) fail('Actor1 is required')

    hoisted.runsInline = false
    hoisted.publishDelayMs = 20

    for (let i = 1; i <= 15; i++) {
      await database.createFollow({
        actorId: `https://concurrency-${i}.test/actors/user`,
        targetActorId: actor1.id,
        inbox: `https://concurrency-${i}.test/inbox`,
        status: FollowStatus.enum.Accepted
      })
    }

    const statusId = `${actor1.id}/statuses/concurrency-limit-test-${Date.now()}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor1.id}/followers`],
      text: 'Note for concurrency test',
      createdAt: Date.now()
    })

    await sendNoteJob(database, {
      id: 'parent-concurrency-test',
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId
      }
    })

    expect(hoisted.maxConcurrentPublishes).toBeLessThanOrEqual(
      MAX_CONCURRENT_DELIVERY_PUBLICATIONS
    )
    expect(hoisted.maxConcurrentPublishes).toBeGreaterThan(1)
    expect(hoisted.publishSpy.mock.calls.length).toBeGreaterThanOrEqual(15)
  })
})
