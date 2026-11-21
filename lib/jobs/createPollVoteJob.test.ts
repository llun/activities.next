import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createPollVoteJob } from '@/lib/jobs/createPollVoteJob'
import { CREATE_POLL_VOTE_JOB_NAME } from '@/lib/jobs/names'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusPoll } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

const VOTER_ACTOR_ID = 'https://somewhere.test/actors/voter'
const VOTER2_ACTOR_ID = 'https://somewhere.test/actors/voter2'
const NON_FOLLOWER_ACTOR_ID = 'https://somewhere.test/actors/nonfollower'
const FOLLOWER_ACTOR_ID = 'https://somewhere.test/actors/follower'

describe('createPollVoteJob', () => {
  const { database, prepare } = createTestDatabase()
  let actor1: Actor | null | undefined
  let pollStatus: StatusPoll

  beforeAll(async () => {
    await prepare()
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
    pollStatus = (await database.createPoll({
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
    })) as StatusPoll
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

  it('ignores inbox poll votes whose attributedTo does not match the verified sender', async () => {
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote,
      verifiedSenderActorId: VOTER2_ACTOR_ID
    })

    const updatedPoll = (await database.getStatus({
      statusId: pollStatus.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(0)
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

    await expect(
      createPollVoteJob(database, {
        id: 'id',
        name: CREATE_POLL_VOTE_JOB_NAME,
        data: voteNote
      })
    ).resolves.toBeUndefined()
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

    await expect(
      createPollVoteJob(database, {
        id: 'id',
        name: CREATE_POLL_VOTE_JOB_NAME,
        data: voteNote
      })
    ).resolves.toBeUndefined()
  })

  it('ignores votes for a remote poll', async () => {
    const remoteActorId = 'https://remote.test/users/poller'
    await database.createActor({
      actorId: remoteActorId,
      username: 'poller',
      domain: 'remote.test',
      publicKey: 'fake-public-key',
      privateKey: '',
      inboxUrl: `${remoteActorId}/inbox`,
      sharedInboxUrl: 'https://remote.test/inbox',
      followersUrl: `${remoteActorId}/followers`,
      createdAt: Date.now()
    })
    const remotePoll = (await database.createPoll({
      id: `${remoteActorId}/polls/1`,
      url: `${remoteActorId}/polls/1`,
      actorId: remoteActorId,
      text: 'Remote poll',
      summary: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      reply: '',
      choices: ['Yes', 'No'],
      pollType: 'oneOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })) as StatusPoll

    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: remotePoll.id,
      name: 'Yes'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: remotePoll.id
    })) as StatusPoll
    expect(updatedPoll.choices.every((c) => c.totalVotes === 0)).toBe(true)
  })

  it('ignores votes for a followers-only poll from a non-follower', async () => {
    const followersOnlyPoll = (await database.createPoll({
      id: `${actor1?.id}/polls/followers-${Date.now()}`,
      url: `${actor1?.id}/polls/followers`,
      actorId: actor1?.id || '',
      text: 'Followers only poll',
      summary: '',
      to: [ACTOR1_FOLLOWER_URL],
      cc: [],
      reply: '',
      choices: ['Yes', 'No'],
      pollType: 'oneOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })) as StatusPoll

    // The voter exists but does not follow actor1, so the poll is not theirs
    // to see.
    await database.createActor({
      actorId: NON_FOLLOWER_ACTOR_ID,
      username: 'nonfollower',
      domain: 'somewhere.test',
      publicKey: 'fake-public-key',
      privateKey: '',
      inboxUrl: `${NON_FOLLOWER_ACTOR_ID}/inbox`,
      sharedInboxUrl: 'https://somewhere.test/inbox',
      followersUrl: `${NON_FOLLOWER_ACTOR_ID}/followers`,
      createdAt: Date.now()
    })

    const voteNote = createVoteNote({
      from: NON_FOLLOWER_ACTOR_ID,
      inReplyTo: followersOnlyPoll.id,
      name: 'Yes'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: followersOnlyPoll.id
    })) as StatusPoll
    expect(updatedPoll.choices.every((c) => c.totalVotes === 0)).toBe(true)
  })

  it('accepts votes for a followers-only poll from a follower', async () => {
    const followersOnlyPoll = (await database.createPoll({
      id: `${actor1?.id}/polls/followers-ok-${Date.now()}`,
      url: `${actor1?.id}/polls/followers-ok`,
      actorId: actor1?.id || '',
      text: 'Followers only poll',
      summary: '',
      to: [ACTOR1_FOLLOWER_URL],
      cc: [],
      reply: '',
      choices: ['Yes', 'No'],
      pollType: 'oneOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })) as StatusPoll

    await database.createActor({
      actorId: FOLLOWER_ACTOR_ID,
      username: 'follower',
      domain: 'somewhere.test',
      publicKey: 'fake-public-key',
      privateKey: '',
      inboxUrl: `${FOLLOWER_ACTOR_ID}/inbox`,
      sharedInboxUrl: 'https://somewhere.test/inbox',
      followersUrl: `${FOLLOWER_ACTOR_ID}/followers`,
      createdAt: Date.now()
    })
    await database.createFollow({
      actorId: FOLLOWER_ACTOR_ID,
      targetActorId: actor1?.id || '',
      status: FollowStatus.enum.Accepted,
      inbox: `${FOLLOWER_ACTOR_ID}/inbox`,
      sharedInbox: 'https://somewhere.test/inbox'
    })

    const voteNote = createVoteNote({
      from: FOLLOWER_ACTOR_ID,
      inReplyTo: followersOnlyPoll.id,
      name: 'Yes'
    })

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: voteNote
    })

    const updatedPoll = (await database.getStatus({
      statusId: followersOnlyPoll.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(1)
  })

  // A direct poll names its audience in `to`/`cc`. A voter who is one of those
  // recipients is in the audience whether or not this instance has stored an
  // actors row for them yet — the row is only written after the vote is
  // accepted. Resolving them to a null actor and refusing the vote dropped
  // every first-time voter on a direct poll.
  it('accepts a vote from an explicit recipient with no stored actor row', async () => {
    const directVoterId = `https://somewhere.test/actors/direct-voter-${Date.now()}`
    const directPoll = (await database.createPoll({
      id: `${actor1?.id}/polls/direct-${Date.now()}`,
      url: `${actor1?.id}/polls/direct`,
      actorId: actor1?.id || '',
      text: 'Direct poll',
      summary: '',
      to: [directVoterId],
      cc: [],
      reply: '',
      choices: ['Yes', 'No'],
      pollType: 'oneOf',
      endAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now()
    })) as StatusPoll

    expect(await database.getActorFromId({ id: directVoterId })).toBeNull()

    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: createVoteNote({
        from: directVoterId,
        inReplyTo: directPoll.id,
        name: 'Yes'
      })
    })

    const updatedPoll = (await database.getStatus({
      statusId: directPoll.id
    })) as StatusPoll
    expect(updatedPoll.choices[0].totalVotes).toEqual(1)
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

  it('records distinct anyOf selections from repeated federated activities', async () => {
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

    // Duplicate activity for an already-recorded choice should not inflate totals.
    const duplicateVote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: anyOfPoll.id,
      name: 'Choice 1'
    })
    await createPollVoteJob(database, {
      id: 'id',
      name: CREATE_POLL_VOTE_JOB_NAME,
      data: duplicateVote
    })

    const updatedPoll = (await database.getStatus({
      statusId: anyOfPoll.id
    })) as StatusPoll
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

  it('rethrows vote persistence failures so the queue can retry', async () => {
    const error = new Error('database unavailable')
    const recordPollVotesSpy = vi
      .spyOn(database, 'recordPollVotes')
      .mockRejectedValueOnce(error)
    const voteNote = createVoteNote({
      from: VOTER_ACTOR_ID,
      inReplyTo: pollStatus.id,
      name: 'Option A'
    })

    await expect(
      createPollVoteJob(database, {
        id: 'id',
        name: CREATE_POLL_VOTE_JOB_NAME,
        data: voteNote
      })
    ).rejects.toThrow(error)

    recordPollVotesSpy.mockRestore()
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
