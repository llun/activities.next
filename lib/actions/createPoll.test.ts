import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

enableFetchMocks()

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

describe('Create poll action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor
  let actor2: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    jest.clearAllMocks()
  })

  describe('#createPollFromUserInput', () => {
    it('creates a poll with correct recipients', async () => {
      await createPollFromUserInput({
        text: 'What is your favorite color?',
        currentActor: actor1,
        choices: ['Red', 'Blue', 'Green'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) =>
        s.text.includes('What is your favorite color?')
      )

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).toContain(`${actor1.id}/followers`)
    })

    it('creates a poll with mentions in cc', async () => {
      await createPollFromUserInput({
        text: `@${actor2.username}@${actor2.domain} What do you think?`,
        currentActor: actor1,
        choices: ['Yes', 'No'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('What do you think?'))

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).toContain(ACTOR2_ID)
    })

    it('creates a poll as reply with correct recipients', async () => {
      // Use actor2's post-2 which exists in seed data
      const replyStatusId = `${actor2.id}/statuses/post-2`

      await createPollFromUserInput({
        text: 'Poll reply',
        replyStatusId,
        currentActor: actor1,
        choices: ['Option A', 'Option B'],
        database,
        endAt: Date.now() + 24 * 60 * 60 * 1000
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Poll reply'))

      expect(poll).toBeDefined()
      expect(poll?.reply).toBe(replyStatusId)
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('creates poll with end time', async () => {
      const endAt = Date.now() + 48 * 60 * 60 * 1000

      await createPollFromUserInput({
        text: 'Timed poll',
        currentActor: actor1,
        choices: ['Now', 'Later'],
        database,
        endAt
      })

      // Find the created poll
      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Timed poll'))

      expect(poll).toBeDefined()
    })
  })
})
