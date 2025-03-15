import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/models/actor'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { urlToId } from '@/lib/utils/urlToId'

enableFetchMocks()

// Define a custom fail function
function fail(message: string): never {
  throw new Error(message)
}

// Mock the queue
jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

describe('Create note action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
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

  describe('#createNoteFromUserInput', () => {
    it('adds status to database and returns note', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        database
      })
      if (!status) fail('Fail to create status')

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: 'Hello',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      // Verify queue was called
      const { getQueue } = require('../services/queue')
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: expect.stringContaining(
          `send-note-${urlToId(status.id).substring(0, 10)}`
        ),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1.followersUrl],
        object: getNoteFromStatus(status)
      })
    })

    it('set reply to replyStatus id', async () => {
      if (!actor1) fail('Actor1 is required')
      if (!actor2) fail('Actor2 is required')

      const status = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        replyNoteId: `${actor2.id}/statuses/post-2`,
        database
      })
      if (!status) fail('Fail to create status')

      expect(status).toMatchObject({
        reply: `${actor2.id}/statuses/post-2`,
        cc: expect.toContainValue(actor2.id)
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC, actor1.followersUrl],
        cc: [ACTOR2_ID],
        object: getNoteFromStatus(status)
      })
    })

    it('linkfy and paragraph status text', async () => {
      if (!actor1) fail('Actor1 is required')

      const text = `
@test2@llun.test Hello, test2

How are you?
`
      const status = await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })
      if (!status) fail('Fail to create status')
      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`, ACTOR2_ID]
      })

      const note = getNoteFromStatus(status)
      if (!note) fail('Failed to get note from status')
      expect(note.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note.tag).toHaveLength(1)
      expect(note.tag).toContainValue({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1.followersUrl, ACTOR2_ID],
        object: getNoteFromStatus(status)
      })
    })

    it('cc multiple ids when replies multiple people', async () => {
      if (!actor1) fail('Actor1 is required')

      const text = `
@test2@llun.test @test3@somewhere.test Hello, people

How are you?
`
      const status = await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })
      if (!status) fail('Fail to create status')
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

      const note = getNoteFromStatus(status)
      if (!note) fail('Failed to get note from status')
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

      const followersInboxCall = fetchMock.mock.calls.find(
        (call) => call[0] === 'https://somewhere.test/inbox'
      )
      if (!followersInboxCall) {
        fail('Follower inbox call must be exist')
      }

      const request = followersInboxCall[1]
      const body = JSON.parse(request?.body as string)

      expect(followersInboxCall[0]).toEqual('https://somewhere.test/inbox')
      expect(followersInboxCall[1]?.method).toEqual('POST')
      expect(body).toMatchObject({
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: expect.toContainAllValues([
          actor1.followersUrl,
          ACTOR2_ID,
          'https://somewhere.test/actors/test3'
        ]),
        object: getNoteFromStatus(status)
      })
    })

    it('send to everyone inboxes', async () => {
      if (!actor1) fail('Actor1 is required')

      const text = `
@test2@llun.test @test3@somewhere.test @test4@no.shared.inbox @test5@somewhere.test

Hello, people

How are you?
`
      const status = await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })
      if (!status) fail('Fail to create status')

      const matchObject = {
        id: status.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: expect.toContainAllValues([
          actor1.followersUrl,
          ACTOR2_ID,
          'https://somewhere.test/actors/test3',
          'https://no.shared.inbox/users/test4',
          'https://somewhere.test/actors/test5'
        ]),
        object: getNoteFromStatus(status)
      }

      expectCall(
        fetchMock,
        'https://no.shared.inbox/users/test4/inbox',
        'POST',
        matchObject
      )
      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', matchObject)
    })
  })
})
