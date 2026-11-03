import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import {
  CREATE_NOTE_JOB_NAME,
  FETCH_REMOTE_STATUS_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import { resetParentBackfillStateForTesting } from '@/lib/services/statuses/parentBackfill'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
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

const REMOTE = 'https://remote.example/users/alice'

// An inbound reply whose parent is not stored queues the parent's fetch
// (Mastodon's ThreadResolveWorker); the dedupe and the policy checks live in
// queueMissingParentFetch, whose own tests cover them in full.
describe('createNoteJob thread backfill', () => {
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
    mockQueue.publish.mockReset()
    mockQueue.publish.mockResolvedValue(undefined)
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
