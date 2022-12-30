import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockImageDocument } from '../stub/imageDocument'
import { MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { createNote, createNoteFromUserInput } from './createNote'

enableFetchMocks()

jest.mock('../config', () => ({
  __esModule: true,
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test'
  })
}))

describe('Create note action', () => {
  const storage = new Sqlite3Storage({
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
      username: seedActor1.username
    })
    actor2 = await storage.getActorFromUsername({
      username: seedActor2.username
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

      expect(status).toBeDefined()
      expect(status?.data.id).toEqual(note.id)
      expect(status?.data.text).toEqual(note.content)
      expect(status?.data.actorId).toEqual(note.attributedTo)
      expect(status?.data.to).toEqual(note.to)
      expect(status?.data.cc).toEqual(note.cc)
      expect(status?.data.type).toEqual('Note')
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
        text: `
<p>
Hello
</p>
`.trim(),
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
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
        to: expect.toContainValue(actor2?.id)
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
        text: Status.paragraphText(Status.linkfyText(text)),
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })

      const note = status?.toObject()
      expect(note?.content).toEqual(
        Status.paragraphText(Status.linkfyText(text))
      )
      expect(note?.tag).toHaveLength(1)
      expect(note?.tag).toContainValue({
        type: 'Mention',
        href: 'https://llun.test/users/test2',
        name: '@test2@llun.test'
      })
    })
  })
})
