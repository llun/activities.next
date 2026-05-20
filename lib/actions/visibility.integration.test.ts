import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@/lib/services/queue', () => ({
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

    it('rejects direct note without an explicit recipient', async () => {
      const status = await createNoteFromUserInput({
        text: 'Direct message without mention',
        currentActor: actor1,
        visibility: 'direct',
        database
      })

      expect(status).toBeNull()
    })

    it('creates direct note with explicit recipients in to only', async () => {
      const status = await createNoteFromUserInput({
        text: '@test2@llun.test direct message',
        currentActor: actor1,
        visibility: 'direct',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toHaveLength(1)
      expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.to).not.toContain(`${actor1.id}/followers`)
      expect(status?.cc).toHaveLength(0)
    })

    it('rejects direct reply to non-direct status without an explicit recipient', async () => {
      const parentStatus = await database.createNote({
        id: `${actor1.id}/statuses/public-parent-direct-no-recipient`,
        url: `${actor1.id}/statuses/public-parent-direct-no-recipient`,
        actorId: 'https://remote.test/actors/public-parent',
        text: 'Public parent',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      const status = await createNoteFromUserInput({
        text: 'quiet direct reply',
        currentActor: actor1,
        replyNoteId: parentStatus.id,
        visibility: 'direct',
        database
      })

      expect(status).toBeNull()
    })

    it('does not inherit non-direct parent audiences for explicit direct replies', async () => {
      const parentStatus = await database.createNote({
        id: `${actor1.id}/statuses/public-parent-direct-audience`,
        url: `${actor1.id}/statuses/public-parent-direct-audience`,
        actorId: 'https://remote.test/actors/public-parent-audience',
        text: 'Public parent with audiences',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [
          `${actor1.id}/followers`,
          'https://remote.test/actors/parent-mention'
        ]
      })

      const status = await createNoteFromUserInput({
        text: '@test2@llun.test direct reply',
        currentActor: actor1,
        replyNoteId: parentStatus.id,
        visibility: 'direct',
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toEqual([ACTOR2_ID])
      expect(status?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(status?.to).not.toContain(`${actor1.id}/followers`)
      expect(status?.to).not.toContain(parentStatus.actorId)
      expect(status?.cc).toEqual([])
    })

    it('preserves direct reply parent to and cc recipients without repeated mentions', async () => {
      const parentStatus = await database.createNote({
        id: `${actor1.id}/statuses/direct-parent-note-recipients`,
        url: `${actor1.id}/statuses/direct-parent-note-recipients`,
        actorId: 'https://remote.test/actors/sender',
        text: 'Direct parent',
        to: [actor1.id, 'https://remote.test/actors/primary'],
        cc: ['https://remote.test/actors/copied']
      })

      const status = await createNoteFromUserInput({
        text: 'Reply without mention prefixes',
        currentActor: actor1,
        replyNoteId: parentStatus.id,
        database
      })

      expect(status).toBeDefined()
      expect(status?.to).toEqual(
        expect.arrayContaining([
          actor1.id,
          'https://remote.test/actors/primary',
          'https://remote.test/actors/sender'
        ])
      )
      expect(status?.cc).toEqual(['https://remote.test/actors/copied'])
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

    it('rejects direct poll without an explicit recipient', async () => {
      const poll = await createPollFromUserInput({
        text: 'Direct poll',
        currentActor: actor1,
        visibility: 'direct',
        choices: ['Yes', 'No'],
        endAt: Date.now() + 86400000,
        database
      })

      expect(poll).toBeNull()
    })

    it('creates direct poll with explicit recipients in to only', async () => {
      await createPollFromUserInput({
        text: '@test2@llun.test Direct poll',
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

    it('rejects direct poll reply to non-direct status without an explicit recipient', async () => {
      const parentStatus = await database.createNote({
        id: `${actor1.id}/statuses/public-parent-direct-poll-no-recipient`,
        url: `${actor1.id}/statuses/public-parent-direct-poll-no-recipient`,
        actorId: 'https://remote.test/actors/public-poll-parent',
        text: 'Public poll parent',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      const poll = await createPollFromUserInput({
        text: 'quiet direct poll reply',
        currentActor: actor1,
        replyStatusId: parentStatus.id,
        visibility: 'direct',
        choices: ['Yes', 'No'],
        endAt: Date.now() + 86400000,
        database
      })

      expect(poll).toBeNull()
    })

    it('preserves direct reply parent to and cc recipients for polls', async () => {
      const parentStatus = await database.createNote({
        id: `${actor1.id}/statuses/direct-parent-poll-recipients`,
        url: `${actor1.id}/statuses/direct-parent-poll-recipients`,
        actorId: 'https://remote.test/actors/poll-sender',
        text: 'Direct parent for poll',
        to: [actor1.id, 'https://remote.test/actors/poll-primary'],
        cc: ['https://remote.test/actors/poll-copied']
      })

      await createPollFromUserInput({
        text: 'Poll reply without mention prefixes',
        currentActor: actor1,
        replyStatusId: parentStatus.id,
        choices: ['Yes', 'No'],
        endAt: Date.now() + 86400000,
        database
      })

      const statuses = await database.getActorStatuses({
        actorId: actor1.id
      })
      const poll = statuses.find((s) =>
        s.text.includes('Poll reply without mention prefixes')
      )

      expect(poll).toBeDefined()
      expect(poll?.to).toEqual(
        expect.arrayContaining([
          actor1.id,
          'https://remote.test/actors/poll-primary',
          'https://remote.test/actors/poll-sender'
        ])
      )
      expect(poll?.cc).toEqual(['https://remote.test/actors/poll-copied'])
    })
  })
})
