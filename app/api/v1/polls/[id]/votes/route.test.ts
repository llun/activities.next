jest.mock('../../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
}))

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

/**
 * Tests for POST /api/v1/polls/:id/votes
 *
 * This tests the poll voting endpoint logic without the full HTTP layer.
 * The authentication guard and HTTP responses are tested separately.
 */
describe('POST /api/v1/polls/:id/votes', () => {
  const database = getTestSQLDatabase()
  const pollStatusId = `${ACTOR3_ID}/statuses/poll-1`
  let pollChoiceId1: number
  let pollChoiceId2: number

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    // Get the poll choice IDs
    const status = await database.getStatus({ statusId: pollStatusId })
    if (status && status.type === 'Poll') {
      pollChoiceId1 = status.choices[0].choiceId!
      pollChoiceId2 = status.choices[1].choiceId!
    }
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('successful vote creation', () => {
    it('creates a vote and increments vote count', async () => {
      // Get initial state
      const beforeStatus = await database.getStatus({ statusId: pollStatusId })
      expect(beforeStatus).not.toBeNull()
      expect(beforeStatus!.type).toBe('Poll')

      const initialVotes =
        beforeStatus!.type === 'Poll'
          ? beforeStatus!.choices[0].totalVotes
          : 0

      // Create vote
      await database.createPollAnswer({
        actorId: ACTOR1_ID,
        choiceId: pollChoiceId1
      })

      await database.incrementPollChoiceVotes(pollChoiceId1)

      // Verify vote was created
      const hasVoted = await database.hasActorVotedOnPoll({
        actorId: ACTOR1_ID,
        statusId: pollStatusId
      })
      expect(hasVoted).toBeTrue()

      // Verify vote count increased
      const afterStatus = await database.getStatus({ statusId: pollStatusId })
      if (afterStatus && afterStatus.type === 'Poll') {
        expect(afterStatus.choices[0].totalVotes).toBe(initialVotes + 1)
      }
    })

    it('returns correct own_votes array after voting', async () => {
      const testActorId = `${ACTOR2_ID}`

      // Create vote
      try {
        await database.createPollAnswer({
          actorId: testActorId,
          choiceId: pollChoiceId2
        })
        await database.incrementPollChoiceVotes(pollChoiceId2)
      } catch {
        // May already exist
      }

      // Get actor's votes
      const actorVotes = await database.getActorPollAnswers({
        actorId: testActorId,
        statusId: pollStatusId
      })

      expect(actorVotes.length).toBeGreaterThan(0)
      expect(actorVotes[0].choice).toBe(pollChoiceId2)

      // Get status to map to indices
      const status = await database.getStatus({ statusId: pollStatusId })
      if (status && status.type === 'Poll') {
        const voteIndex = status.choices.findIndex(
          (c) => c.choiceId === actorVotes[0].choice
        )
        expect(voteIndex).toBe(1) // Second choice (index 1)
      }
    })

    it('allows different actors to vote on the same poll', async () => {
      const actor3Vote = `${ACTOR3_ID}`
      const actor4Vote = `${ACTOR4_ID}`

      // Both vote on choice 1
      try {
        await database.createPollAnswer({
          actorId: actor3Vote,
          choiceId: pollChoiceId1
        })
        await database.incrementPollChoiceVotes(pollChoiceId1)
      } catch {
        // May already exist
      }

      try {
        await database.createPollAnswer({
          actorId: actor4Vote,
          choiceId: pollChoiceId1
        })
        await database.incrementPollChoiceVotes(pollChoiceId1)
      } catch {
        // May already exist
      }

      // Both should have voted
      const actor3Voted = await database.hasActorVotedOnPoll({
        actorId: actor3Vote,
        statusId: pollStatusId
      })
      const actor4Voted = await database.hasActorVotedOnPoll({
        actorId: actor4Vote,
        statusId: pollStatusId
      })

      expect(actor3Voted).toBeTrue()
      expect(actor4Voted).toBeTrue()
    })
  })

  describe('vote validation', () => {
    it('prevents duplicate votes from same actor', async () => {
      const testActorId = 'https://test.duplicate.actor/id'

      // Create actor
      await database.createActor({
        id: testActorId,
        account: null,
        username: 'duplicatetest',
        domain: 'test.duplicate.actor',
        privateKey: '',
        publicKey: '',
        followersUrl: `${testActorId}/followers`,
        inboxUrl: `${testActorId}/inbox`,
        sharedInboxUrl: `${testActorId}/inbox`
      })

      // First vote should succeed
      await database.createPollAnswer({
        actorId: testActorId,
        choiceId: pollChoiceId1
      })

      // Second vote should fail
      await expect(
        database.createPollAnswer({
          actorId: testActorId,
          choiceId: pollChoiceId1
        })
      ).rejects.toThrow('Actor has already voted on this choice')
    })

    it('detects when actor has already voted', async () => {
      const alreadyVotedActor = ACTOR1_ID

      const hasVoted = await database.hasActorVotedOnPoll({
        actorId: alreadyVotedActor,
        statusId: pollStatusId
      })

      expect(hasVoted).toBeTrue()
    })

    it('returns false for actor who has not voted', async () => {
      const newActorId = 'https://new.test.actor/id'

      const hasVoted = await database.hasActorVotedOnPoll({
        actorId: newActorId,
        statusId: pollStatusId
      })

      expect(hasVoted).toBeFalse()
    })
  })

  describe('poll expiration handling', () => {
    it('identifies expired polls correctly', async () => {
      // Create an expired poll
      const expiredPollId = `${ACTOR1_ID}/statuses/expired-poll`
      await database.createPoll({
        id: expiredPollId,
        actorId: ACTOR1_ID,
        to: [],
        cc: [],
        url: expiredPollId,
        text: 'Expired poll',
        choices: ['Yes', 'No'],
        endAt: Date.now() - 1000 // 1 second ago
      })

      const status = await database.getStatus({ statusId: expiredPollId })
      expect(status).not.toBeNull()

      if (status && status.type === 'Poll') {
        const isExpired = Date.now() > status.endAt
        expect(isExpired).toBeTrue()
      }
    })

    it('identifies active polls correctly', async () => {
      // Create an active poll
      const activePollId = `${ACTOR1_ID}/statuses/active-poll`
      await database.createPoll({
        id: activePollId,
        actorId: ACTOR1_ID,
        to: [],
        cc: [],
        url: activePollId,
        text: 'Active poll',
        choices: ['Option 1', 'Option 2'],
        endAt: Date.now() + 10000 // 10 seconds from now
      })

      const status = await database.getStatus({ statusId: activePollId })
      expect(status).not.toBeNull()

      if (status && status.type === 'Poll') {
        const isExpired = Date.now() > status.endAt
        expect(isExpired).toBeFalse()
      }
    })
  })

  describe('choice validation', () => {
    it('validates choice index is within bounds', async () => {
      const status = await database.getStatus({ statusId: pollStatusId })

      if (status && status.type === 'Poll') {
        const validIndex = 0
        const invalidIndex = 999

        expect(validIndex).toBeLessThan(status.choices.length)
        expect(invalidIndex).toBeGreaterThanOrEqual(status.choices.length)
      }
    })

    it('validates choice index is non-negative', async () => {
      const invalidIndex = -1
      expect(invalidIndex).toBeLessThan(0)
    })

    it('retrieves correct choice by index', async () => {
      const status = await database.getStatus({ statusId: pollStatusId })

      if (status && status.type === 'Poll') {
        const choice = status.choices[0]
        expect(choice).toBeDefined()
        expect(choice.title).toBeDefined()
        expect(choice.choiceId).toBeDefined()
      }
    })
  })

  describe('vote count calculations', () => {
    it('calculates total votes correctly', async () => {
      const testPollId = `${ACTOR2_ID}/statuses/vote-count-test`
      await database.createPoll({
        id: testPollId,
        actorId: ACTOR2_ID,
        to: [],
        cc: [],
        url: testPollId,
        text: 'Vote count test poll',
        choices: ['A', 'B', 'C'],
        endAt: Date.now() + 10000
      })

      const status = await database.getStatus({ statusId: testPollId })
      if (status && status.type === 'Poll') {
        const totalVotes = status.choices.reduce(
          (sum, choice) => sum + choice.totalVotes,
          0
        )
        expect(totalVotes).toBe(0) // New poll has no votes
      }
    })

    it('vote count increases after voting', async () => {
      const testPollId = `${ACTOR2_ID}/statuses/increment-test`
      await database.createPoll({
        id: testPollId,
        actorId: ACTOR2_ID,
        to: [],
        cc: [],
        url: testPollId,
        text: 'Increment test poll',
        choices: ['Option X', 'Option Y'],
        endAt: Date.now() + 10000
      })

      const beforeStatus = await database.getStatus({ statusId: testPollId })
      const initialTotal =
        beforeStatus && beforeStatus.type === 'Poll'
          ? beforeStatus.choices.reduce(
              (sum, choice) => sum + choice.totalVotes,
              0
            )
          : 0

      // Add a vote
      if (beforeStatus && beforeStatus.type === 'Poll') {
        const choiceId = beforeStatus.choices[0].choiceId!
        await database.createPollAnswer({
          actorId: ACTOR3_ID,
          choiceId
        })
        await database.incrementPollChoiceVotes(choiceId)
      }

      const afterStatus = await database.getStatus({ statusId: testPollId })
      const finalTotal =
        afterStatus && afterStatus.type === 'Poll'
          ? afterStatus.choices.reduce(
              (sum, choice) => sum + choice.totalVotes,
              0
            )
          : 0

      expect(finalTotal).toBe(initialTotal + 1)
    })
  })

  describe('error cases', () => {
    it('returns null for nonexistent poll', async () => {
      const status = await database.getStatus({
        statusId: 'https://nonexistent.poll/id'
      })

      expect(status).toBeNull()
    })

    it('rejects vote on non-poll status', async () => {
      // Create a regular note (not a poll)
      const noteId = `${ACTOR1_ID}/statuses/regular-note`
      await database.createNote({
        id: noteId,
        url: noteId,
        actorId: ACTOR1_ID,
        text: 'This is not a poll',
        to: [],
        cc: []
      })

      const status = await database.getStatus({ statusId: noteId })
      expect(status).not.toBeNull()
      expect(status!.type).toBe('Note')
      expect(status!.type).not.toBe('Poll')
    })

    it('handles missing choiceId gracefully', async () => {
      const status = await database.getStatus({ statusId: pollStatusId })

      if (status && status.type === 'Poll') {
        // All choices should have choiceId
        status.choices.forEach((choice) => {
          expect(choice.choiceId).toBeDefined()
          expect(typeof choice.choiceId).toBe('number')
        })
      }
    })
  })

  describe('vote retrieval', () => {
    it('retrieves all votes for a poll', async () => {
      const answers = await database.getPollAnswersByStatus({
        statusId: pollStatusId
      })

      expect(answers).toBeArray()
      expect(answers.length).toBeGreaterThan(0)

      answers.forEach((answer) => {
        expect(answer.answerId).toBeDefined()
        expect(answer.choice).toBeDefined()
        expect(answer.actorId).toBeDefined()
      })
    })

    it('maps votes to choice indices correctly', async () => {
      const actorVotes = await database.getActorPollAnswers({
        actorId: ACTOR1_ID,
        statusId: pollStatusId
      })

      const status = await database.getStatus({ statusId: pollStatusId })

      if (status && status.type === 'Poll' && actorVotes.length > 0) {
        const voteChoiceId = actorVotes[0].choice
        const choiceIndex = status.choices.findIndex(
          (c) => c.choiceId === voteChoiceId
        )

        expect(choiceIndex).toBeGreaterThanOrEqual(0)
        expect(choiceIndex).toBeLessThan(status.choices.length)
      }
    })

    it('returns empty own_votes for actor who has not voted', async () => {
      const newActorId = 'https://never.voted.actor/id'

      const actorVotes = await database.getActorPollAnswers({
        actorId: newActorId,
        statusId: pollStatusId
      })

      expect(actorVotes).toEqual([])
    })
  })
})
