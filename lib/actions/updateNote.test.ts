import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

describe('Update note action', () => {
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
    vi.clearAllMocks()
  })

  describe('updateNoteFromUserInput', () => {
    it('update status to new text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: '<p>This is an updated note</p>'
      })) as Status

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: '<p>This is an updated note</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: expect.toBeArrayOfSize(1)
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(statusId),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('format text when updating text', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        database,
        text: 'This is markdown **text** that should get format'
      })

      expect(status).toMatchObject({
        text: 'This is markdown **text** that should get format'
      })
    })

    it('re-detects the content language when the edited text changes', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
        language: 'en'
      })) as Status

      expect(status).toMatchObject({
        language: 'en',
        detectedLanguage: 'th'
      })
    })

    it('clears a stale detected language when the edit no longer detects confidently', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const detected = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร'
      })) as Status
      expect(detected).toMatchObject({ detectedLanguage: 'th' })

      const edited = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'ok'
      })) as Status

      expect(edited).toMatchObject({ text: 'ok', detectedLanguage: null })
    })

    it('updates content warning without changing text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`
      const before = await database.getStatus({ statusId })
      if (!before || before.type !== 'Note') fail('Note is required')

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Updated warning'
      })) as Status

      expect(status).toMatchObject({
        text: before.text,
        summary: 'Updated warning'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(statusId),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    })

    it('does not publish when publish is false', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Draft warning',
        publish: false
      })) as Status

      expect(status).toMatchObject({
        summary: 'Draft warning'
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
      expect(getQueue().publish).not.toHaveBeenCalled()
    })
  })
})
