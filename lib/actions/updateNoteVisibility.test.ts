import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

describe('Update note visibility action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null | undefined
  let actor3: Actor | null | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor3 = await database.getActorFromUsername({
      username: seedActor3.username,
      domain: seedActor3.domain
    })
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

  describe('#updateNoteVisibilityFromUserInput', () => {
    it('returns null when status does not exist', async () => {
      if (!actor1) fail('Actor1 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/does-not-exist`,
        currentActor: actor1,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('returns null when status is not a Note type (Poll)', async () => {
      if (!actor3) fail('Actor3 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR3_ID}/statuses/poll-1`,
        currentActor: actor3,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('returns null when status belongs to a different actor', async () => {
      if (!actor1) fail('Actor1 is required')

      // post-1 belongs to actor1, but we pass actor3 as the currentActor
      if (!actor3) fail('Actor3 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        currentActor: actor3,
        visibility: 'public',
        database
      })

      expect(result).toBeNull()
    })

    it('updates visibility to unlisted correctly', async () => {
      if (!actor1) fail('Actor1 is required')

      const result = await updateNoteVisibilityFromUserInput({
        statusId: `${ACTOR1_ID}/statuses/post-2`,
        currentActor: actor1,
        visibility: 'unlisted',
        database
      })

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        actorId: actor1.id,
        to: [`${actor1.id}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${ACTOR1_ID}/statuses/post-2`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: `${ACTOR1_ID}/statuses/post-2`
        }
      })
    })

    it('preserves mention recipients when changing visibility', async () => {
      if (!actor1) fail('Actor1 is required')

      const mentionedActorId = 'https://llun.test/@test2'
      const statusId = `${ACTOR1_ID}/statuses/post-with-mention`

      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`],
        text: '@test2 hello'
      })
      await database.createTag({
        statusId,
        name: '@test2',
        value: mentionedActorId,
        type: 'mention'
      })

      const result = await updateNoteVisibilityFromUserInput({
        statusId,
        currentActor: actor1,
        visibility: 'private',
        database
      })

      expect(result).not.toBeNull()
      // For private visibility, cc should contain mention hrefs
      expect(result?.cc).toContain(mentionedActorId)
    })
  })
})
