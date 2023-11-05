import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { SqlStorage } from '../storage/sql'
import { expectCall, mockRequests } from '../stub/activities'
import { MockImageDocument } from '../stub/imageDocument'
import { MockLitepubNote, MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { formatText } from '../text/formatText'
import { createNote, createNoteFromUserInput } from './createNote'

enableFetchMocks()
jest.mock('../config')

// Actor id for testing pulling actor information when create status
const FRIEND_ACTOR_ID = 'https://somewhere.test/actors/friend'

describe('Create note action', () => {
  const storage = new SqlStorage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined
  let actor2: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor1 = await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    actor2 = await storage.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#createNote', () => {
    it('adds note into storage and returns note', async () => {
      const note = MockMastodonNote({ content: '<p>Hello</p>' })
      expect(await createNote({ storage, note })).toEqual(note)

      const status = await storage.getStatus({ statusId: note.id })
      if (status?.data.type !== StatusType.Note) {
        fail('Stauts type must be note')
      }
      expect(status).toBeDefined()
      expect(status?.data.id).toEqual(note.id)
      expect(status?.data.text).toEqual('<p>Hello</p>')
      expect(status?.data.actorId).toEqual(note.attributedTo)
      expect(status?.data.to).toEqual(note.to)
      expect(status?.data.cc).toEqual(note.cc)
      expect(status?.data.type).toEqual(StatusType.Note)
      expect(status?.data.createdAt).toEqual(new Date(note.published).getTime())
    })

    it('adds litepub note into storage and returns note', async () => {
      const note = MockLitepubNote({ content: '<p>Hello</p>' })
      expect(await createNote({ storage, note })).toEqual(note)

      const status = await storage.getStatus({ statusId: note.id })
      if (status?.data.type !== StatusType.Note) {
        fail('Stauts type must be note')
      }
      expect(status).toBeDefined()
      expect(status?.data.id).toEqual(note.id)
      expect(status?.data.text).toEqual('<p>Hello</p>')
      expect(status?.data.actorId).toEqual(note.attributedTo)
      expect(status?.data.to).toEqual(note.to)
      expect(status?.data.cc).toEqual(note.cc)
      expect(status?.data.type).toEqual(StatusType.Note)
      expect(status?.data.createdAt).toEqual(new Date(note.published).getTime())
    })

    it('add status and attachments with status id into storage', async () => {
      const note = MockMastodonNote({
        content: 'Hello',
        documents: [
          MockImageDocument({ url: 'https://llun.dev/images/test1.jpg' }),
          MockImageDocument({
            url: 'https://llun.dev/images/test2.jpg',
            name: 'Second image'
          })
        ]
      })
      expect(await createNote({ storage, note })).toEqual(note)
      const status = await storage.getStatus({ statusId: note.id })
      if (status?.data.type !== StatusType.Note) {
        fail('Stauts type must be note')
      }
      expect(status?.data.attachments.length).toEqual(2)
      expect(status?.data.attachments[0]).toMatchObject({
        statusId: note.id,
        mediaType: 'image/jpeg',
        name: '',
        url: 'https://llun.dev/images/test1.jpg',
        width: 2000,
        height: 1500
      })
      expect(status?.data.attachments[1]).toMatchObject({
        statusId: note.id,
        mediaType: 'image/jpeg',
        url: 'https://llun.dev/images/test2.jpg',
        width: 2000,
        height: 1500,
        name: 'Second image'
      })
    })

    it('does not add duplicate note into storage', async () => {
      const note = MockMastodonNote({
        id: `${actor1?.id}/statuses/post-1`,
        content: 'Test duplicate'
      })
      expect(await createNote({ storage, note })).toEqual(note)
      const status = await storage.getStatus({
        statusId: `${actor1?.id}/statuses/post-1`
      })
      expect(status).not.toEqual('Test duplicate')
    })

    it('get public profile and add non-exist actor to storage', async () => {
      const note = MockMastodonNote({
        from: FRIEND_ACTOR_ID,
        content: '<p>Hello</p>'
      })
      expect(await createNote({ storage, note })).toEqual(note)

      const actor = await storage.getActorFromId({ id: FRIEND_ACTOR_ID })
      expect(actor).toBeDefined()
      expect(actor).toMatchObject({
        id: FRIEND_ACTOR_ID,
        username: 'friend',
        domain: 'somewhere.test',
        createdAt: expect.toBeNumber()
      })
    })

    it.only('adds note with single content map when contentMap is array', async () => {
      const note = MockMastodonNote({
        content: '<p>Hello</p>',
        contentMap: ['<p>Hello</p>']
      })
      expect(await createNote({ storage, note })).toEqual(note)

      const status = await storage.getStatus({ statusId: note.id })
      if (status?.data.type !== StatusType.Note) {
        fail('Stauts type must be note')
      }
      expect(status.data.text).toEqual('<p>Hello</p>')
    })
  })

  describe('#createNoteFromUserInput', () => {
    it('adds status to database and returns note', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        storage
      })
      expect(status?.data).toMatchObject({
        actorId: actor1.id,
        text: '<p>Hello</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1.followersUrl],
        object: status?.toObject()
      })
    })

    it('set reply to replyStatus id', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        replyNoteId: `${actor2?.id}/statuses/post-2`,
        storage
      })
      expect(status?.data).toMatchObject({
        reply: `${actor2?.id}/statuses/post-2`,
        cc: expect.toContainValue(actor2?.id)
      })

      expectCall(fetchMock, 'https://somewhere.test/inbox', 'POST', {
        id: status?.id,
        type: 'Create',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC, actor1.followersUrl],
        cc: [ACTOR2_ID],
        object: status?.toObject()
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
        storage
      })
      expect(status?.data).toMatchObject({
        actorId: actor1.id,
        text: formatText(text),
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`, ACTOR2_ID]
      })

      const note = status?.toObject()
      expect(note?.content).toEqual(formatText(text))
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
        object: status?.toObject()
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
        storage
      })
      expect(status?.data).toMatchObject({
        actorId: actor1.id,
        text: formatText(text),
        to: [ACTIVITY_STREAM_PUBLIC]
      })
      expect(status?.data.cc).toContainAllValues([
        `${actor1.id}/followers`,
        'https://somewhere.test/actors/test3',
        ACTOR2_ID
      ])

      const note = status?.toObject()
      expect(note?.content).toEqual(formatText(text))
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
        object: status?.toObject()
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
        storage
      })

      const matchObject = {
        id: status?.id,
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
        object: status?.toObject()
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
