import { Note } from '@llun/activities.schema'
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { StatusNote } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

enableFetchMocks()

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

describe('Create note action', () => {
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

  describe('#createNoteFromUserInput', () => {
    it('adds status to database and returns note', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: 'Hello',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })

      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('set reply to replyStatus id', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        replyNoteId: `${actor2?.id}/statuses/post-2`,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        reply: `${actor2?.id}/statuses/post-2`,
        cc: expect.toContainValue(actor2?.id)
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('linkfy and paragraph status text', async () => {
      const text = `
@test2@llun.test Hello, test2

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`, ACTOR2_ID]
      })

      const note = getNoteFromStatus(status) as Note
      expect(note.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note.tag).toHaveLength(1)
      expect(note.tag).toContainValue({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('cc multiple ids when replies multiple people', async () => {
      const text = `
@test2@llun.test @test3@somewhere.test Hello, people

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC]
      })
      expect(status.cc).toContainAllValues([
        `${actor1.id}/followers`,
        'https://somewhere.test/actors/test3',
        ACTOR2_ID
      ])

      const note = getNoteFromStatus(status) as Note
      expect(note.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note.tag).toHaveLength(2)
      expect(note.tag).toContainValue({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })
      expect(note.tag).toContainValue({
        type: 'Mention',
        href: 'https://somewhere.test/actors/test3',
        name: '@test3@somewhere.test'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('send to everyone inboxes', async () => {
      const text = `
@test2@llun.test @test3@somewhere.test @test4@no.shared.inbox @test5@somewhere.test

Hello, people

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: expect.toContainAllValues([
          `${actor1.id}/followers`,
          ACTOR2_ID,
          'https://somewhere.test/actors/test3',
          'https://no.shared.inbox/users/test4',
          'https://somewhere.test/actors/test5'
        ])
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })
  })
})
