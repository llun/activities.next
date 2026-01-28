import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createPollJob } from '@/lib/jobs/createPollJob'
import { CREATE_POLL_JOB_NAME, UPDATE_POLL_JOB_NAME } from '@/lib/jobs/names'
import { updatePollJob } from '@/lib/jobs/updatePollJob'
import { StatusType } from '@/lib/types/domain/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

enableFetchMocks()

const REMOTE_ACTOR_ID = 'https://somewhere.test/actors/pollcreator'

interface QuestionOption {
  type: string
  name: string
  replies: { type: string; totalItems: number }
}

const createOption = (name: string, votes = 0): QuestionOption => ({
  type: 'Note',
  name,
  replies: { type: 'Collection', totalItems: votes }
})

const MockActivityPubQuestion = (
  id: string,
  options: {
    content?: string
    summary?: string | null
    published?: number
    endTime?: number
    oneOf?: QuestionOption[]
    anyOf?: QuestionOption[]
    includeTag?: boolean
  } = {}
) => {
  const {
    content = '<p>What is your favorite color?</p>',
    summary = null,
    published = Date.now(),
    endTime = Date.now() + 24 * 60 * 60 * 1000,
    oneOf,
    anyOf,
    includeTag = true
  } = options

  // Determine poll options
  const pollOptions: { oneOf?: QuestionOption[]; anyOf?: QuestionOption[] } = {}
  if (anyOf !== undefined) {
    pollOptions.anyOf = anyOf
  } else if (oneOf !== undefined) {
    pollOptions.oneOf = oneOf
  } else {
    pollOptions.oneOf = [
      createOption('Red'),
      createOption('Blue'),
      createOption('Green')
    ]
  }

  const question: any = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Question',
    attributedTo: REMOTE_ACTOR_ID,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${REMOTE_ACTOR_ID}/followers`],
    content,
    summary,
    published: getISOTimeUTC(published),
    endTime: getISOTimeUTC(endTime),
    inReplyTo: null,
    url: id,
    ...pollOptions
  }

  // Only include tag if requested
  if (includeTag) {
    question.tag = []
  }

  return question
}

describe('updatePollJob', () => {
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
  })

  it('updates poll vote counts', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Red', 0), createOption('Blue', 0)]
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    const updatedPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Red', 5), createOption('Blue', 3)]
    })

    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    expect(status).toBeDefined()
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].totalVotes).toEqual(5)
    expect(status.choices[1].totalVotes).toEqual(3)
  })

  it('updates poll without tag field', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Option A', 0), createOption('Option B', 0)]
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    // Create update without tag field (simulating real ActivityPub payloads)
    const updatedPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Option A', 10), createOption('Option B', 7)],
      includeTag: false // Don't include tag field at all
    })

    // This should not throw even though tag is missing
    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    expect(status).toBeDefined()
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].totalVotes).toEqual(10)
    expect(status.choices[1].totalVotes).toEqual(7)
  })

  it('updates poll content', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      content: '<p>Original question</p>'
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    const updatedPoll = MockActivityPubQuestion(pollId, {
      content: '<p>Updated question</p>'
    })

    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    expect(status).toBeDefined()
    expect(status?.text).toEqual('<p>Updated question</p>')
  })

  it('does not update non-existent poll', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/nonexistent`
    const poll = MockActivityPubQuestion(pollId)

    // Should not throw, just return early
    await expect(
      updatePollJob(database, {
        id: 'id',
        name: UPDATE_POLL_JOB_NAME,
        data: poll
      })
    ).resolves.not.toThrow()

    const status = await database.getStatus({ statusId: pollId })
    expect(status).toBeNull()
  })
})
