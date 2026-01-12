import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createPollVoteJob } from '@/lib/jobs/createPollVoteJob'
import { CREATE_POLL_VOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusPoll } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

const VOTER_ACTOR_ID = 'https://somewhere.test/actors/voter'
const VOTER2_ACTOR_ID = 'https://somewhere.test/actors/voter2'

describe('createPollVoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined
  let pollStatus: StatusPoll

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

  beforeEach(async () => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)

    // Create a fresh poll for each test
    pollStatus = await database.createPoll({
      id: `${actor1?.id}/polls/${Date.now()}-${Math.random()}`,
      url: `${actor1?.id}/polls/${Date.now()}`,
      actorId: actor1?.id || '',
      text: 'Test poll question',
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${actor1?.id}/followers`],
      reply: '',
      choices: ['Option A', 'Option B', 'Option C'],
      pollType: 'oneOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })
  })

  const createVoteNote = (params: {
    from: string
    inReplyTo: string
    name: string
    content?: string
  }) => ({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${params.from}/votes/${Date.now()}-${Math.random()}`,
    type: 'Note',
    attributedTo: params.from,
    inReplyTo: params.inReplyTo,
    name: params.name,
    content: params.content,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    published: new Date().toISOString(),
    tag: []
  })

  it('creates a vote for a valid poll choice', async () => {
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(1)
  })

  it('ignores vote with content (not a poll vote)', async () => {
    const noteWithContent = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A',
      content: '<p>This is a regular reply</p>'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: noteWithContent
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
  })

  it('ignores vote without inReplyTo', async () => {
    const noteWithoutReply = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${VOTER_ACTOR_ID}/votes/${Date.now()}`,
      type: 'Note',
      attributedTo: VOTER_ACTOR_ID,
      name: 'Option A',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: new Date().toISOString(),
      tag: []
    }

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: noteWithoutReply
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
  })

  it('ignores vote without name', async () => {
    const noteWithoutName = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${VOTER_ACTOR_ID}/votes/${Date.now()}`,
      type: 'Note',
      attributedTo: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: new Date().toISOString(),
      tag: []
    }

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: noteWithoutName
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
  })

  it('ignores vote for non-existent poll', async () => {
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: 'https://example.com/nonexistent/poll',
      name: 'Option A'
    })

    // Should not throw
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })
  })

  it('ignores vote for non-poll status', async () => {
    // Create a regular note status
    const noteStatus = await database.createNote({
      id: `${actor1?.id}/statuses/regular-note-${Date.now()}`,
      url: `${actor1?.id}/statuses/regular-note`,
      actorId: actor1?.id || '',
      text: 'Regular note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: noteStatus.id,
      name: 'Option A'
    })

    // Should not throw
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })
  })

  it('ignores vote for invalid choice', async () => {
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Invalid Option'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    // No votes should be recorded
    expect(updatedPoll.choices.every((c) => c.totalVotes === 0)).toBe(true)
  })

  it('ignores vote for expired poll', async () => {
    // Create an expired poll
    const expiredPoll = await database.createPoll({
      id: `${actor1?.id}/polls/expired-${Date.now()}`,
      url: `${actor1?.id}/polls/expired`,
      actorId: actor1?.id || '',
      text: 'Expired poll',
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: '',
      choices: ['Yes', 'No'],
      pollType: 'oneOf',
      endAt: Date.now() - 1000, // Already expired
      createdAt: Date.now() - 24 * 60 * 60 * 1000
    })

    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: expiredPoll.id,
      name: 'Yes'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: expiredPoll.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
  })

  it('prevents duplicate votes in oneOf poll', async () => {
    // First vote
    const firstVote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: firstVote
    })

    // Second vote from same actor
    const secondVote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option B'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: secondVote
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    // Only first vote should be counted
    expect(updatedPoll.choices[0].totalVotes).toEqual(1)
    expect(updatedPoll.choices[1].totalVotes).toEqual(0)
  })

  it('allows multiple votes in anyOf poll', async () => {
    // Create an anyOf poll
    const anyOfPoll = await database.createPoll({
      id: `${actor1?.id}/polls/anyof-${Date.now()}`,
      url: `${actor1?.id}/polls/anyof`,
      actorId: actor1?.id || '',
      text: 'Multi-choice poll',
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: '',
      choices: ['Choice 1', 'Choice 2', 'Choice 3'],
      pollType: 'anyOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })

    // First vote
    const firstVote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: anyOfPoll.id,
      name: 'Choice 1'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: firstVote
    })

    // Second vote from same actor for different choice
    const secondVote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: anyOfPoll.id,
      name: 'Choice 2'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: secondVote
    })

    const updatedPoll = (await database.getStatus({
      statusId: anyOfPoll.id
    })) as StatusPoll
    // Both votes should be counted
    expect(updatedPoll.choices[0].totalVotes).toEqual(1)
    expect(updatedPoll.choices[1].totalVotes).toEqual(1)
  })

  it('fetches and stores remote voter actor', async () => {
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const actor = await database.getActorFromId({ id: VOTER_ACTOR_ID })
    expect(actor).toBeDefined()
    expect(actor?.id).toEqual(VOTER_ACTOR_ID)
  })

  it('allows votes from different actors', async () => {
    // Vote from first actor
    const vote1 = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: vote1
    })

    // Vote from second actor
    const vote2 = createVoteNote({
      from: VOTER2_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: vote2
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(2)
  })

  it('ignores non-Note types', async () => {
    const notANote = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${VOTER_ACTOR_ID}/votes/${Date.now()}`,
      type: 'Article',
      attributedTo: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: new Date().toISOString(),
      tag: []
    }

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: notANote
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
  })
})
