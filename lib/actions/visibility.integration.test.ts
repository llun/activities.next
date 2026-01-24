import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

describe('Visibility integration tests', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
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

  describe('createNote with visibility', () => {
    it('creates public note with correct to/cc', async () => {
      const status = await createNoteFromUserInput({
        text: 'Public test',
        currentActor: actor1,
        visibility: 'public',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.cc).toContain(`${actor1.id}/followers`)
    })

    it('creates unlisted note with correct to/cc', async () => {
      const status = await createNoteFromUserInput({
        text: 'Unlisted test',
        currentActor: actor1,
        visibility: 'unlisted',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toContain(`${actor1.id}/followers`)
      expect(status?.cc).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('creates private note with correct to/cc', async () => {
      const status = await createNoteFromUserInput({
        text: 'Private test',
        currentActor: actor1,
        visibility: 'private',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toContain(`${actor1.id}/followers`)
      expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.cc).toHaveLength(0)
    })

    it('creates direct note with correct to/cc', async () => {
      const status = await createNoteFromUserInput({
        text: 'Direct message without mention',
        currentActor: actor1,
        visibility: 'direct',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.to).not.toContain(`${actor1.id}/followers`)
      expect(status?.cc).toHaveLength(0)
      // For direct messages with no mentions, to should be empty or only contain reply author
      // This is the correct behavior for direct messages
    })
  })

  describe('createPoll with visibility', () => {
    it('creates public poll with correct to/cc', async () => {
      await createPollFromUserInput({
        text: 'Public poll',
        currentActor: actor1,
        visibility: 'public',
        choices: ['Yes', 'No'],
        endAt: Date.now() + 86400000,
        database
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Public poll'))

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).toContain(`${actor1.id}/followers`)
    })

    it('creates unlisted poll with correct to/cc', async () => {
      await createPollFromUserInput({
        text: 'Unlisted poll',
        currentActor: actor1,
        visibility: 'unlisted',
        choices: ['A', 'B'],
        endAt: Date.now() + 86400000,
        database
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Unlisted poll'))

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(`${actor1.id}/followers`)
      expect(poll?.cc).toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('creates private poll with correct to/cc', async () => {
      await createPollFromUserInput({
        text: 'Private poll',
        currentActor: actor1,
        visibility: 'private',
        choices: ['Option 1', 'Option 2'],
        endAt: Date.now() + 86400000,
        database
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Private poll'))

      expect(poll).toBeDefined()
      expect(poll?.to).toContain(`${actor1.id}/followers`)
      expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
    })

    it('creates direct poll with correct to/cc', async () => {
      await createPollFromUserInput({
        text: 'Direct poll',
        currentActor: actor1,
        visibility: 'direct',
        choices: ['Yes', 'No'],
        endAt: Date.now() + 86400000,
        database
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) => s.text.includes('Direct poll'))

      expect(poll).toBeDefined()
      expect(poll?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(poll?.to).not.toContain(`${actor1.id}/followers`)
      expect(poll?.cc).toHaveLength(0)
    })
  })
})
