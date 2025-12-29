import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

describe('PollAnswerDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    let pollChoiceId1: number
    let pollChoiceId2: number
    const pollStatusId = `${ACTOR3_ID}/statuses/poll-1`

    beforeAll(async () => {
      await seedDatabase(database as Database)

      // Get the poll choice IDs
      const status = await database.getStatus({ statusId: pollStatusId })
      if (status && status.type === 'Poll') {
        pollChoiceId1 = status.choices[0].choiceId!
        pollChoiceId2 = status.choices[1].choiceId!
      }
    })

    describe('createPollAnswer', () => {
      it('creates a new poll answer successfully', async () => {
        const answer = await database.createPollAnswer({
          actorId: ACTOR1_ID,
          choiceId: pollChoiceId1
        })

        expect(answer).toMatchObject({
          choice: pollChoiceId1,
          actorId: ACTOR1_ID
        })
        expect(answer.answerId).toBeDefined()
        expect(answer.createdAt).toBeDefined()
        expect(answer.updatedAt).toBeDefined()
      })

      it('throws error when actor has already voted on the same choice', async () => {
        // Create first vote
        await database.createPollAnswer({
          actorId: ACTOR2_ID,
          choiceId: pollChoiceId1
        })

        // Try to vote again on same choice
        await expect(
          database.createPollAnswer({
            actorId: ACTOR2_ID,
            choiceId: pollChoiceId1
          })
        ).rejects.toThrow('Actor has already voted on this choice')
      })

      it('allows different actors to vote on the same choice', async () => {
        const answer1 = await database.createPollAnswer({
          actorId: ACTOR3_ID,
          choiceId: pollChoiceId2
        })

        const answer2 = await database.createPollAnswer({
          actorId: ACTOR4_ID,
          choiceId: pollChoiceId2
        })

        expect(answer1.actorId).toBe(ACTOR3_ID)
        expect(answer2.actorId).toBe(ACTOR4_ID)
        expect(answer1.choice).toBe(pollChoiceId2)
        expect(answer2.choice).toBe(pollChoiceId2)
      })
    })

    describe('getActorPollAnswers', () => {
      beforeAll(async () => {
        // Ensure ACTOR1 has voted
        try {
          await database.createPollAnswer({
            actorId: ACTOR1_ID,
            choiceId: pollChoiceId1
          })
        } catch {
          // Already voted
        }
      })

      it('returns poll answers for an actor who has voted', async () => {
        const answers = await database.getActorPollAnswers({
          actorId: ACTOR1_ID,
          statusId: pollStatusId
        })

        expect(answers.length).toBeGreaterThan(0)
        expect(answers[0]).toMatchObject({
          actorId: ACTOR1_ID,
          choice: pollChoiceId1
        })
      })

      it('returns empty array for an actor who has not voted', async () => {
        const answers = await database.getActorPollAnswers({
          actorId: 'https://nonexistent.actor/id',
          statusId: pollStatusId
        })

        expect(answers).toEqual([])
      })

      it('returns empty array for a nonexistent poll', async () => {
        const answers = await database.getActorPollAnswers({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.poll/id'
        })

        expect(answers).toEqual([])
      })
    })

    describe('hasActorVotedOnPoll', () => {
      it('returns true when actor has voted on the poll', async () => {
        const hasVoted = await database.hasActorVotedOnPoll({
          actorId: ACTOR1_ID,
          statusId: pollStatusId
        })

        expect(hasVoted).toBeTrue()
      })

      it('returns false when actor has not voted on the poll', async () => {
        // Use an actor that hasn't voted yet
        const hasVoted = await database.hasActorVotedOnPoll({
          actorId: 'https://new.actor/id',
          statusId: pollStatusId
        })

        expect(hasVoted).toBeFalse()
      })

      it('returns false for a nonexistent poll', async () => {
        const hasVoted = await database.hasActorVotedOnPoll({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.poll/id'
        })

        expect(hasVoted).toBeFalse()
      })
    })

    describe('getPollAnswersByStatus', () => {
      it('returns all answers for a poll', async () => {
        const answers = await database.getPollAnswersByStatus({
          statusId: pollStatusId
        })

        expect(answers.length).toBeGreaterThan(0)
        answers.forEach((answer) => {
          expect(answer.answerId).toBeDefined()
          expect(answer.choice).toBeDefined()
          expect(answer.actorId).toBeDefined()
        })
      })

      it('returns empty array for a poll with no votes', async () => {
        // Create a new poll with no votes
        const newPollId = `${ACTOR1_ID}/statuses/new-poll-1`
        await database.createPoll({
          id: newPollId,
          actorId: ACTOR1_ID,
          to: [],
          cc: [],
          url: newPollId,
          text: 'New poll with no votes',
          choices: ['Option A', 'Option B'],
          endAt: Date.now() + 10000
        })

        const answers = await database.getPollAnswersByStatus({
          statusId: newPollId
        })

        expect(answers).toEqual([])
      })

      it('returns empty array for nonexistent poll', async () => {
        const answers = await database.getPollAnswersByStatus({
          statusId: 'https://nonexistent.poll/id'
        })

        expect(answers).toEqual([])
      })
    })

    describe('getPollAnswersByChoice', () => {
      it('returns all answers for a specific choice', async () => {
        const answers = await database.getPollAnswersByChoice({
          choiceId: pollChoiceId1
        })

        expect(answers.length).toBeGreaterThan(0)
        answers.forEach((answer) => {
          expect(answer.choice).toBe(pollChoiceId1)
          expect(answer.actorId).toBeDefined()
        })
      })

      it('returns empty array for a choice with no votes', async () => {
        // Create a new poll to get a choice with no votes
        const newPollId = `${ACTOR2_ID}/statuses/new-poll-2`
        await database.createPoll({
          id: newPollId,
          actorId: ACTOR2_ID,
          to: [],
          cc: [],
          url: newPollId,
          text: 'Another new poll',
          choices: ['Choice 1', 'Choice 2', 'Choice 3'],
          endAt: Date.now() + 10000
        })

        const newStatus = await database.getStatus({ statusId: newPollId })
        if (newStatus && newStatus.type === 'Poll') {
          const emptyChoiceId = newStatus.choices[2].choiceId!

          const answers = await database.getPollAnswersByChoice({
            choiceId: emptyChoiceId
          })

          expect(answers).toEqual([])
        }
      })

      it('returns empty array for nonexistent choice', async () => {
        const answers = await database.getPollAnswersByChoice({
          choiceId: 999999
        })

        expect(answers).toEqual([])
      })
    })

    describe('deletePollAnswer', () => {
      it('deletes an existing poll answer', async () => {
        // Create a vote to delete
        const testActorId = 'https://test.delete.actor/id'
        await database.createActor({
          id: testActorId,
          account: null,
          username: 'deletetest',
          domain: 'test.delete.actor',
          privateKey: '',
          publicKey: '',
          followersUrl: `${testActorId}/followers`,
          inboxUrl: `${testActorId}/inbox`,
          sharedInboxUrl: `${testActorId}/inbox`
        })

        await database.createPollAnswer({
          actorId: testActorId,
          choiceId: pollChoiceId1
        })

        // Verify vote exists
        const beforeDelete = await database.hasActorVotedOnPoll({
          actorId: testActorId,
          statusId: pollStatusId
        })
        expect(beforeDelete).toBeTrue()

        // Delete the vote
        const deleted = await database.deletePollAnswer({
          actorId: testActorId,
          choiceId: pollChoiceId1
        })

        expect(deleted).toBeTrue()

        // Verify vote is deleted
        const afterDelete = await database.hasActorVotedOnPoll({
          actorId: testActorId,
          statusId: pollStatusId
        })
        expect(afterDelete).toBeFalse()
      })

      it('returns false when deleting a nonexistent vote', async () => {
        const deleted = await database.deletePollAnswer({
          actorId: 'https://nonexistent.actor/id',
          choiceId: pollChoiceId1
        })

        expect(deleted).toBeFalse()
      })

      it('returns false for nonexistent choice', async () => {
        const deleted = await database.deletePollAnswer({
          actorId: ACTOR1_ID,
          choiceId: 999999
        })

        expect(deleted).toBeFalse()
      })
    })

    describe('Integration with status database', () => {
      it('vote counts can be incremented after creating poll answer', async () => {
        // Create a new poll to test with
        const integrationPollId = `${ACTOR4_ID}/statuses/integration-poll`
        await database.createPoll({
          id: integrationPollId,
          actorId: ACTOR4_ID,
          to: [],
          cc: [],
          url: integrationPollId,
          text: 'Integration test poll',
          choices: ['Option 1', 'Option 2'],
          endAt: Date.now() + 10000
        })

        const status = await database.getStatus({ statusId: integrationPollId })
        if (status && status.type === 'Poll') {
          const choice1Id = status.choices[0].choiceId!
          const initialVotes = status.choices[0].totalVotes

          // Create a vote
          await database.createPollAnswer({
            actorId: ACTOR1_ID,
            choiceId: choice1Id
          })

          // Increment vote count
          await database.incrementPollChoiceVotes(choice1Id)

          // Verify vote count increased
          const updatedStatus = await database.getStatus({
            statusId: integrationPollId
          })
          if (updatedStatus && updatedStatus.type === 'Poll') {
            expect(updatedStatus.choices[0].totalVotes).toBe(initialVotes + 1)
          }
        }
      })

      it('vote counts can be decremented after deleting poll answer', async () => {
        // Create a test poll
        const decrementPollId = `${ACTOR4_ID}/statuses/decrement-poll`
        await database.createPoll({
          id: decrementPollId,
          actorId: ACTOR4_ID,
          to: [],
          cc: [],
          url: decrementPollId,
          text: 'Decrement test poll',
          choices: ['Option A', 'Option B'],
          endAt: Date.now() + 10000
        })

        const status = await database.getStatus({ statusId: decrementPollId })
        if (status && status.type === 'Poll') {
          const choice1Id = status.choices[0].choiceId!

          // Create a vote and increment count
          await database.createPollAnswer({
            actorId: ACTOR2_ID,
            choiceId: choice1Id
          })
          await database.incrementPollChoiceVotes(choice1Id)

          const beforeDelete = await database.getStatus({
            statusId: decrementPollId
          })
          const votesBefore =
            beforeDelete && beforeDelete.type === 'Poll'
              ? beforeDelete.choices[0].totalVotes
              : 0

          // Delete vote and decrement count
          await database.deletePollAnswer({
            actorId: ACTOR2_ID,
            choiceId: choice1Id
          })
          await database.decrementPollChoiceVotes(choice1Id)

          // Verify vote count decreased
          const afterDelete = await database.getStatus({
            statusId: decrementPollId
          })
          if (afterDelete && afterDelete.type === 'Poll') {
            expect(afterDelete.choices[0].totalVotes).toBe(votesBefore - 1)
          }
        }
      })

      it('recalculatePollVoteCounts fixes inconsistent vote counts', async () => {
        // Create a test poll
        const recalcPollId = `${ACTOR4_ID}/statuses/recalc-poll`
        await database.createPoll({
          id: recalcPollId,
          actorId: ACTOR4_ID,
          to: [],
          cc: [],
          url: recalcPollId,
          text: 'Recalculation test poll',
          choices: ['Choice X', 'Choice Y'],
          endAt: Date.now() + 10000
        })

        const status = await database.getStatus({ statusId: recalcPollId })
        if (status && status.type === 'Poll') {
          const choice1Id = status.choices[0].choiceId!
          const choice2Id = status.choices[1].choiceId!

          // Create multiple votes
          const voters = [ACTOR1_ID, ACTOR2_ID, ACTOR3_ID]
          for (const voterId of voters) {
            try {
              await database.createPollAnswer({
                actorId: voterId,
                choiceId: choice1Id
              })
            } catch {
              // May already have voted in previous tests
            }
          }

          // Recalculate vote counts
          await database.recalculatePollVoteCounts(recalcPollId)

          // Verify counts match actual votes
          const answers = await database.getPollAnswersByChoice({
            choiceId: choice1Id
          })
          const updatedStatus = await database.getStatus({
            statusId: recalcPollId
          })

          if (updatedStatus && updatedStatus.type === 'Poll') {
            expect(updatedStatus.choices[0].totalVotes).toBe(answers.length)
            expect(updatedStatus.choices[1].totalVotes).toBe(0) // No votes for choice 2
          }
        }
      })
    })
  })
})
