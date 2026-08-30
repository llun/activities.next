import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { PROCESS_FORWARDED_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { processForwardedActivityJob } from '@/lib/jobs/processForwardedActivityJob'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'

enableFetchMocks()

const ACTIVITY_STREAM_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
const AUTHOR = 'https://writing.example/users/ninetiger'
const NOTE_ID = 'https://writing.example/users/ninetiger/statuses/1'

const noteDocument = (overrides: Record<string, unknown> = {}) => ({
  '@context': 'https://www.w3.org/ns/activitystreams',
  id: NOTE_ID,
  type: 'Note',
  attributedTo: AUTHOR,
  content: '<p>forwarded reply</p>',
  published: '2026-08-28T00:00:00Z',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  url: NOTE_ID,
  ...overrides
})

const forwardedActivity = (
  type: 'Create' | 'Update' | 'Delete',
  object: unknown,
  id = `${AUTHOR}/statuses/1/activity`
) => ({ id, type, actor: AUTHOR, object })

const jobMessage = (data: unknown, id = 'forwarded-job-1') => ({
  id,
  name: PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
  data
})

describe('processForwardedActivityJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    await database.deleteStatus({ statusId: NOTE_ID })
  })

  it('stores a forwarded Create by re-fetching the note from origin', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(noteDocument()))

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Create', { id: NOTE_ID, type: 'Note' }))
    )

    const status = await database.getStatus({ statusId: NOTE_ID })
    expect(status).toBeDefined()
    expect(status?.actorId).toEqual(AUTHOR)
  })

  it('ignores a forwarded Create whose fetched note is attributed to someone else', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(
        noteDocument({
          attributedTo: 'https://writing.example/users/other'
        })
      )
    )

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Create', { id: NOTE_ID, type: 'Note' }))
    )

    const status = await database.getStatus({ statusId: NOTE_ID })
    expect(status).toBeNull()
  })

  it('never fetches a cross-origin object pointer', async () => {
    const crossOriginNote = 'https://elsewhere.example/statuses/1'
    await processForwardedActivityJob(
      database,
      jobMessage(
        forwardedActivity('Create', { id: crossOriginNote, type: 'Note' })
      )
    )

    const calls = fetchMock.mock.calls.filter(
      (call) =>
        typeof call?.[0] === 'string' && call[0].includes('elsewhere.example')
    )
    expect(calls).toHaveLength(0)
    const status = await database.getStatus({ statusId: crossOriginNote })
    expect(status).toBeNull()
  })

  it.each([[404], [410]])(
    'deletes a stored status when origin confirms with %i',
    async (status) => {
      await database.createNote({
        id: NOTE_ID,
        url: NOTE_ID,
        actorId: AUTHOR,
        text: 'x',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      fetchMock.mockResponseOnce('', { status })

      await processForwardedActivityJob(
        database,
        jobMessage(forwardedActivity('Delete', NOTE_ID))
      )

      const stored = await database.getStatus({ statusId: NOTE_ID })
      expect(stored).toBeNull()
    }
  )

  it('deletes a stored status when origin serves a Tombstone', async () => {
    await database.createNote({
      id: NOTE_ID,
      url: NOTE_ID,
      actorId: AUTHOR,
      text: 'x',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    fetchMock.mockResponseOnce(
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: NOTE_ID,
        type: 'Tombstone'
      }),
      { status: 200 }
    )

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Delete', NOTE_ID))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeNull()
  })

  it('does not delete when origin still serves the live note', async () => {
    await database.createNote({
      id: NOTE_ID,
      url: NOTE_ID,
      actorId: AUTHOR,
      text: 'x',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    fetchMock.mockResponseOnce(JSON.stringify(noteDocument()), { status: 200 })

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Delete', NOTE_ID))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeDefined()
  })

  it('does not delete when the origin fetch fails', async () => {
    await database.createNote({
      id: NOTE_ID,
      url: NOTE_ID,
      actorId: AUTHOR,
      text: 'x',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    fetchMock.mockReject(new Error('network down'))

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Delete', NOTE_ID))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeDefined()
  })

  it('does not delete a status the claimed actor does not own', async () => {
    await database.createNote({
      id: NOTE_ID,
      url: NOTE_ID,
      actorId: 'https://writing.example/users/other',
      text: 'x',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    fetchMock.mockResponseOnce('', { status: 404 })

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Delete', NOTE_ID))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeDefined()
  })

  it('applies a forwarded Update to a stored status via the fetched copy', async () => {
    await database.createNote({
      id: NOTE_ID,
      url: NOTE_ID,
      actorId: AUTHOR,
      text: 'old',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    fetchMock.mockResponseOnce(
      JSON.stringify(noteDocument({ content: '<p>edited</p>' }))
    )

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Update', { id: NOTE_ID, type: 'Note' }))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeDefined()
    if (stored?.type === 'Note') {
      expect(stored.text).toEqual('<p>edited</p>')
    } else {
      expect.fail('Expected stored status to be a Note')
    }
  })

  it('stores a forwarded Update of a status never seen before', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(noteDocument()))

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Update', { id: NOTE_ID, type: 'Note' }))
    )

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeDefined()
    expect(stored?.actorId).toEqual(AUTHOR)
  })

  it('ignores malformed data', async () => {
    await expect(
      processForwardedActivityJob(database, jobMessage({ nope: true }))
    ).resolves.not.toThrow()

    await expect(
      processForwardedActivityJob(
        database,
        jobMessage(forwardedActivity('Create', 42 as unknown))
      )
    ).resolves.not.toThrow()

    const stored = await database.getStatus({ statusId: NOTE_ID })
    expect(stored).toBeNull()
  })

  it('ignores a local object pointer', async () => {
    const localActor = 'https://test.llun.dev/users/localuser'
    const localNote = 'https://test.llun.dev/users/localuser/statuses/1'

    await processForwardedActivityJob(
      database,
      jobMessage({
        id: `${localActor}/statuses/1/activity`,
        type: 'Create',
        actor: localActor,
        object: { id: localNote, type: 'Note' }
      })
    )

    const calls = fetchMock.mock.calls.filter(
      (call) => typeof call?.[0] === 'string' && call[0] === localNote
    )
    expect(calls).toHaveLength(0)
  })

  it('stores a forwarded Create of a Question by re-fetching from origin', async () => {
    const questionDoc = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: NOTE_ID,
      type: 'Question',
      attributedTo: AUTHOR,
      content: '<p>What is your choice?</p>',
      published: '2026-08-28T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      url: NOTE_ID,
      oneOf: [
        {
          type: 'Note',
          name: 'Option A',
          replies: { type: 'Collection', totalItems: 1 }
        },
        {
          type: 'Note',
          name: 'Option B',
          replies: { type: 'Collection', totalItems: 2 }
        }
      ]
    }
    fetchMock.mockResponseOnce(JSON.stringify(questionDoc))

    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Create', { id: NOTE_ID, type: 'Question' }))
    )

    const status = (await database.getStatus({
      statusId: NOTE_ID
    })) as StatusPoll
    expect(status).toBeDefined()
    expect(status.type).toEqual(StatusType.enum.Poll)
    expect(status.actorId).toEqual(AUTHOR)
    expect(status.choices).toHaveLength(2)
  })

  it('updates an existing poll on a forwarded Update of a Question', async () => {
    // First, store the poll
    const initialQuestion = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: NOTE_ID,
      type: 'Question',
      attributedTo: AUTHOR,
      content: '<p>Vote on this!</p>',
      published: '2026-08-28T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      url: NOTE_ID,
      oneOf: [
        {
          type: 'Note',
          name: 'Option 1',
          replies: { type: 'Collection', totalItems: 0 }
        }
      ]
    }
    fetchMock.mockResponseOnce(JSON.stringify(initialQuestion))
    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Create', { id: NOTE_ID, type: 'Question' }))
    )

    // Now update with new vote count
    const updatedQuestion = {
      ...initialQuestion,
      oneOf: [
        {
          type: 'Note',
          name: 'Option 1',
          replies: { type: 'Collection', totalItems: 10 }
        }
      ]
    }
    fetchMock.mockResponseOnce(JSON.stringify(updatedQuestion))
    await processForwardedActivityJob(
      database,
      jobMessage(forwardedActivity('Update', { id: NOTE_ID, type: 'Question' }))
    )

    const status = (await database.getStatus({
      statusId: NOTE_ID
    })) as StatusPoll
    expect(status).toBeDefined()
    expect(status.type).toEqual(StatusType.enum.Poll)
    expect(status.choices[0].totalVotes).toEqual(10)
  })
})
