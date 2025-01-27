import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getSQLDatabase } from '@/lib/database/sql'
import { Actor } from '@/lib/models/actor'
import { expectCall, mockRequests } from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { getNoteFromStatusData } from '@/lib/utils/getNoteFromStatusData'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

enableFetchMocks()

describe('Create note action', () => {
  const database = getSQLDatabase({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
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

      expect(status.data).toMatchObject({
        actorId: actor1.id,
        text: 'Hello',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1.followersUrl],
        object: getNoteFromStatusData(status.data)
      })
    })

    it('set reply to replyStatus id', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        replyNoteId: `${actor2?.id}/statuses/post-2`,
        database
      })
      if (!status) fail('Fail to create status')

      expect(status.data).toMatchObject({
        reply: `${actor2?.id}/statuses/post-2`,
        cc: expect.toContainValue(actor2?.id)
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC, actor1.followersUrl],
        cc: [ACTOR2_ID],
        object: getNoteFromStatusData(status.data)
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
      expect(status.data).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`, ACTOR2_ID]
      })

      const note = getNoteFromStatusData(status.data)
      expect(note?.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note?.tag).toHaveLength(1)
      expect(note?.tag).toContainValue({
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
        object: getNoteFromStatusData(status.data)
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
      expect(status.data).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC]
      })
      expect(status.data.cc).toContainAllValues([
        `${actor1.id}/followers`,
        'https://somewhere.test/actors/test3',
        ACTOR2_ID
      ])

      const note = getNoteFromStatusData(status.data)
      expect(note?.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note?.tag).toHaveLength(2)
      expect(note?.tag).toContainValue({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })
      expect(note?.tag).toContainValue({
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
        object: getNoteFromStatusData(status.data)
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
        object: getNoteFromStatusData(status.data)
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
