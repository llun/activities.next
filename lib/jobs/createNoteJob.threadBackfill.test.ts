import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { createPollJob } from '@/lib/jobs/createPollJob'
import {
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  FETCH_REMOTE_STATUS_JOB_NAME
} from '@/lib/jobs/names'
import {
  getForwardingTargetLocalActorIds,
  resolveForwardingInboxes,
  shouldForwardActivity
} from '@/lib/services/federation/forwardingDelivery'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import { resetParentBackfillStateForTesting } from '@/lib/services/statuses/parentBackfill'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { createDeferred } from '@/lib/testing/deferred'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

const mockQueue = {
  runsInline: false,
  publish: vi.fn<Queue['publish']>(),
  handle: vi.fn()
}

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

// Forwarding is off unless a test turns it on; the message builder is real.
vi.mock(
  '@/lib/services/federation/forwardingDelivery',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/services/federation/forwardingDelivery')
    >()),
    shouldForwardActivity: vi.fn(),
    getForwardingTargetLocalActorIds: vi.fn(),
    resolveForwardingInboxes: vi.fn()
  })
)

const REMOTE = 'https://remote.example/users/alice'

// An inbound reply (note or poll) whose parent is not stored queues the parent's fetch
// (Mastodon's ThreadResolveWorker); the dedupe and the policy checks live in
// queueMissingParentFetch, whose own tests cover them in full.
describe('createNoteJob and createPollJob thread backfill', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    await database.createDomainBlock({
      domain: 'blocked.example',
      severity: 'suspend'
    })
    await database.createNote({
      id: `${REMOTE}/statuses/stored-parent`,
      url: `${REMOTE}/statuses/stored-parent`,
      actorId: REMOTE,
      text: 'stored parent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    resetParentBackfillStateForTesting()
    mockQueue.runsInline = false
    mockQueue.publish.mockReset()
    mockQueue.publish.mockResolvedValue(undefined)
    vi.mocked(shouldForwardActivity).mockReset()
    vi.mocked(shouldForwardActivity).mockReturnValue(false)
    vi.mocked(getForwardingTargetLocalActorIds).mockReset()
    vi.mocked(resolveForwardingInboxes).mockReset()
    vi.mocked(getQueue).mockReset()
    vi.mocked(getQueue).mockReturnValue(
      mockQueue as unknown as ReturnType<typeof getQueue>
    )
  })

  const receiveReply = (inReplyTo: string) => {
    const note = MockMastodonActivityPubNote({
      content: '<p>reply</p>',
      inReplyTo
    })
    return createNoteJob(database, {
      id: note.id,
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })
  }

  const parentFetches = () =>
    mockQueue.publish.mock.calls
      .map(([message]) => message)
      .filter((message) => message.name === FETCH_REMOTE_STATUS_JOB_NAME)

  it('queues one parent fetch for replies to a missing parent', async () => {
    const parent = `${REMOTE}/statuses/missing-parent`
    await receiveReply(parent)
    await receiveReply(parent)

    expect(parentFetches()).toEqual([
      expect.objectContaining({
        data: { statusId: parent, ancestorsOnly: true, firstPageOnly: false }
      })
    ])
  })

  it.each([
    {
      description: 'a stored parent',
      parent: `${REMOTE}/statuses/stored-parent`
    },
    {
      description: 'a parent on a blocked domain',
      parent: 'https://blocked.example/users/bob/statuses/1'
    }
  ])('queues nothing for $description', async ({ parent }) => {
    await receiveReply(parent)

    expect(parentFetches()).toEqual([])
  })

  it('still queues the parent fetch when a forward fails to publish', async () => {
    vi.mocked(shouldForwardActivity).mockReturnValue(true)
    vi.mocked(getForwardingTargetLocalActorIds).mockResolvedValue([ACTOR1_ID])
    vi.mocked(resolveForwardingInboxes).mockResolvedValue([
      'https://follower.example/inbox'
    ])
    mockQueue.publish.mockImplementation(async (message) => {
      if (message.name !== FETCH_REMOTE_STATUS_JOB_NAME) {
        throw new Error('forward publish failed')
      }
    })
    const parent = `${REMOTE}/statuses/forward-failed-parent`

    await expect(receiveReply(parent)).rejects.toThrow('forward publish failed')

    expect(parentFetches()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ statusId: parent })
      })
    ])
  })

  it('does not wait for the parent fetch under the in-process queue', async () => {
    mockQueue.runsInline = true
    const run = createDeferred<void>()
    mockQueue.publish.mockImplementation(async (message) => {
      if (message.name === FETCH_REMOTE_STATUS_JOB_NAME) await run.promise
    })

    // Resolves while the inline fetch is still running.
    await receiveReply(`${REMOTE}/statuses/inline-parent`)

    expect(parentFetches()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ firstPageOnly: true })
      })
    ])
    run.resolve()
  })

  it('queues one parent fetch for an inbound poll replying to a missing parent', async () => {
    const parent = `${REMOTE}/statuses/missing-poll-parent`
    const id = `${ACTOR1_ID}/questions/thread-backfill`
    await createPollJob(database, {
      id,
      name: CREATE_POLL_JOB_NAME,
      data: {
        id,
        type: 'Question',
        attributedTo: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        content: '<p>Which?</p>',
        inReplyTo: parent,
        published: new Date().toISOString(),
        endTime: new Date(Date.now() + 86_400_000).toISOString(),
        oneOf: ['Red', 'Blue'].map((name) => ({
          type: 'Note',
          name,
          replies: { type: 'Collection', totalItems: 0 }
        }))
      }
    })

    expect(await database.getStatus({ statusId: id })).not.toBeNull()
    expect(parentFetches()).toEqual([
      expect.objectContaining({
        data: { statusId: parent, ancestorsOnly: true, firstPageOnly: false }
      })
    ])
  })

  it('queues nothing for a note that is not a reply', async () => {
    const note = MockMastodonActivityPubNote({ content: '<p>top level</p>' })
    await createNoteJob(database, {
      id: note.id,
      name: CREATE_NOTE_JOB_NAME,
      data: note
    })

    expect(parentFetches()).toEqual([])
  })
})
