import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createPollJob } from '@/lib/jobs/createPollJob'
import { CREATE_POLL_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

enableFetchMocks()

const REMOTE_ACTOR_ID = 'https://somewhere.test/actors/pollcreator'

interface QuestionOption {
  type: string
  name: string
  replies: { type: string; totalItems: number }
}

interface MockQuestionParams {
  id?: string
  from?: string
  content?: string
  summary?: string | null
  published?: number
  endTime?: number
  to?: string[]
  cc?: string[]
  inReplyTo?: string | null
  oneOf?: QuestionOption[]
  anyOf?: QuestionOption[]
  tags?: {
    type: string
    name: string
    href?: string
    updated?: string
    icon?: { type: string; url: string; mediaType?: string }
  }[]
}

const createOption = (name: string): QuestionOption => ({
  type: 'Note',
  name,
  replies: { type: 'Collection', totalItems: 0 }
})

const MockActivityPubQuestion = ({
  id = `https://somewhere.test/actors/pollcreator/questions/${Date.now()}`,
  from = REMOTE_ACTOR_ID,
  content = '<p>What is your favorite color?</p>',
  summary = null,
  published = Date.now(),
  endTime = Date.now() + 24 * 60 * 60 * 1000,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [`${from}/followers`],
  inReplyTo = null,
  oneOf,
  anyOf,
  tags = []
}: MockQuestionParams = {}) => {
  // Determine poll options - only include defined ones
  const pollOptions: { oneOf?: QuestionOption[]; anyOf?: QuestionOption[] } = {}
  if (anyOf !== undefined) {
    pollOptions.anyOf = anyOf
  } else if (oneOf !== undefined) {
    pollOptions.oneOf = oneOf
  } else {
    // Default to oneOf if neither is provided
    pollOptions.oneOf = [
      createOption('Red'),
      createOption('Blue'),
      createOption('Green')
    ]
  }

  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Question',
    attributedTo: from,
    to,
    cc,
    content,
    summary,
    published: getISOTimeUTC(published),
    endTime: getISOTimeUTC(endTime),
    inReplyTo,
    url: id,
    ...pollOptions,
    tag: tags
  }
}

describe('createPollJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
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
  })

  it('adds poll into database', async () => {
    const question = MockActivityPubQuestion({
      content: '<p>What is your favorite color?</p>'
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    expect(status).toBeDefined()
    expect(status?.id).toEqual(question.id)
    expect(status?.type).toEqual(StatusType.enum.Poll)
    expect(status?.actorId).toEqual(question.attributedTo)
    expect(status?.to).toEqual(question.to)
    expect(status?.cc).toEqual(question.cc)
  })

  it('creates poll with oneOf choices', async () => {
    const question = MockActivityPubQuestion({
      oneOf: [createOption('Option A'), createOption('Option B')]
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].title).toEqual('Option A')
    expect(status.choices[1].title).toEqual('Option B')
    expect(status.pollType).toEqual('oneOf')
  })

  it('creates poll with anyOf choices', async () => {
    const question = MockActivityPubQuestion({
      anyOf: [
        createOption('Choice 1'),
        createOption('Choice 2'),
        createOption('Choice 3')
      ]
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(3)
    expect(status.pollType).toEqual('anyOf')
  })

  it('does not add duplicate poll into database', async () => {
    const question = MockActivityPubQuestion({
      id: `${actor1?.id}/statuses/post-1`,
      content: 'Duplicate poll content'
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({
      statusId: `${actor1?.id}/statuses/post-1`
    })
    // Should not update existing status
    expect(status?.text).not.toEqual('Duplicate poll content')
  })

  it('fetches and stores remote actor when creating poll', async () => {
    const question = MockActivityPubQuestion({
      from: REMOTE_ACTOR_ID,
      content: '<p>Poll from remote actor</p>'
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const actor = await database.getActorFromId({ id: REMOTE_ACTOR_ID })
    expect(actor).toBeDefined()
    expect(actor?.id).toEqual(REMOTE_ACTOR_ID)
  })

  it('creates poll with summary (content warning)', async () => {
    const question = MockActivityPubQuestion({
      summary: 'CW: Sensitive topic',
      content: '<p>What do you think about this?</p>'
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.summary).toEqual('CW: Sensitive topic')
  })

  it('creates poll with end time', async () => {
    // Use a timestamp without milliseconds since ISO format truncates them
    const endTime = Math.floor((Date.now() + 48 * 60 * 60 * 1000) / 1000) * 1000
    const question = MockActivityPubQuestion({
      endTime
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.endAt).toEqual(endTime)
  })

  it('creates poll with emoji tags', async () => {
    const question = MockActivityPubQuestion({
      tags: [
        {
          type: 'Emoji',
          name: ':smile:',
          updated: new Date().toISOString(),
          icon: {
            type: 'Image',
            url: 'https://example.com/emoji/smile.png'
          }
        }
      ]
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    expect(status).toBeDefined()
    expect(status?.tags).toContainEqual(
      expect.objectContaining({
        name: ':smile:',
        type: 'emoji'
      })
    )
  })

  it('creates poll with mention tags', async () => {
    const question = MockActivityPubQuestion({
      tags: [
        {
          type: 'Mention',
          name: '@user@example.com',
          href: 'https://example.com/users/user'
        }
      ]
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    expect(status).toBeDefined()
    expect(status?.tags).toContainEqual(
      expect.objectContaining({
        name: '@user@example.com',
        type: 'mention'
      })
    )
  })

  it('handles poll as reply', async () => {
    const replyToId = `${actor1?.id}/statuses/post-1`
    const question = MockActivityPubQuestion({
      inReplyTo: replyToId
    })
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.reply).toEqual(replyToId)
  })

  it('handles to/cc as single strings', async () => {
    const question = {
      ...MockActivityPubQuestion(),
      to: ACTIVITY_STREAM_PUBLIC,
      cc: `${REMOTE_ACTOR_ID}/followers`
    }
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: question
    })

    const status = await database.getStatus({ statusId: question.id })
    expect(status).toBeDefined()
    expect(status?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
    expect(status?.cc).toEqual([`${REMOTE_ACTOR_ID}/followers`])
  })

  it('ignores non-Question types', async () => {
    const notAQuestion = {
      ...MockActivityPubQuestion(),
      type: 'Note'
    }
    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: notAQuestion
    })

    const status = await database.getStatus({ statusId: notAQuestion.id })
    // Should not be created as a poll since type is Note
    expect(status?.type).not.toEqual(StatusType.enum.Poll)
  })
})
