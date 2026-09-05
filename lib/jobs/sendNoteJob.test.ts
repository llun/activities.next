import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { DELIVER_ACTIVITY_JOB_NAME, SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { sendNoteJob } from '@/lib/jobs/sendNoteJob'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

enableFetchMocks()

const hoisted = vi.hoisted(() => ({
  database: null as unknown,
  publishSpy: vi.fn(),
  runsInline: true,
  failInbox: null as string | null
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: hoisted.runsInline,
    publish: async (message: { name: string; data: { inbox?: string } }) => {
      hoisted.publishSpy(message)
      if (hoisted.failInbox && message.data?.inbox === hoisted.failInbox) {
        throw new Error('Simulated inbox delivery rejection')
      }
      const { JOBS } = await import('@/lib/jobs')
      const job = (JOBS as Record<string, unknown>)[message.name] as
        ((db: unknown, msg: unknown) => Promise<void>) | undefined
      if (job && hoisted.database) {
        await job(hoisted.database, message)
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
      status: 'Accepted' as any
    })

    await database.createFollow({
      actorId: 'https://friend3.test/actors/user3',
      targetActorId: actor1.id,
      inbox: 'https://friend3.test/inbox/user3',
      sharedInbox: 'https://friend3.test/inbox',
      status: 'Accepted' as any
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
})
