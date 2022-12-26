import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { Sqlite3Storage } from '../storage/sqlite3'
import { MockActor } from '../stub/actor'
import { MockImageDocument } from '../stub/imageDocument'
import { MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { createNote, createNoteFromUserInput } from './createNote'

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

  describe('#createNote', () => {
    it('adds note into storage and returns note', async () => {
      const note = MockMastodonNote({ content: '<p>Hello</p>' })
      expect(await createNote({ storage, note })).toEqual(note)

      const status = await storage.getStatus({ statusId: note.id })

      expect(status).toBeDefined()
      console.log(status)
      expect(status?.id).toEqual(note.id)
      expect(status?.text).toEqual(note.content)
      expect(status?.actorId).toEqual(note.attributedTo)
      expect(status?.to).toEqual(note.to)
      expect(status?.cc).toEqual(note.cc)
      expect(status?.type).toEqual('Note')
      expect(status?.createdAt).toEqual(new Date(note.published).getTime())
    })

    it('add status and attachments with status id into storage', async () => {
      const note = MockMastodonNote({
        content: '<p>Hello</p>',
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

      expect(status?.attachments.length).toEqual(2)
      expect(status?.attachments[0]).toMatchObject({
        statusId: note.id,
        mediaType: 'image/jpeg',
        name: '',
        url: 'https://llun.dev/images/test1.jpg',
        width: 2000,
        height: 1500
      })
      expect(status?.attachments[1]).toMatchObject({
        statusId: note.id,
        mediaType: 'image/jpeg',
        url: 'https://llun.dev/images/test2.jpg',
        width: 2000,
        height: 1500,
        name: 'Second image'
      })
    })

    it('add add local followers in recipients', async () => {
      const note = MockMastodonNote({
        content: '<p>Hello</p>',
        cc: ['https://llun.dev/users/test2/followers']
      })
      expect(await createNote({ storage, note })).toEqual(note)
      const status = await storage.getStatus({ statusId: note.id })
      expect(status?.localRecipients).toContainValues([
        'as:Public',
        actor1?.id,
        actor2?.id
      ])
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

      const { status, note } = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        storage
      })
      expect(status).toMatchObject({
        actorId: actor1.id,
        text: 'Hello',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`],
        localRecipients: ['as:Public', actor1.id]
      })
      expect(note).toMatchObject({
        type: 'Note',
        content: 'Hello',
        attributedTo: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })
    })

    it.skip('adds local followers as recipients', async () => {
      const mockActor = MockActor({ id: 'https://mastodon.in.th/users/friend' })
      const { status, note } = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: mockActor,
        storage
      })
      expect(mockStorage.createStatus).toHaveBeenCalledWith({
        id: note.id,
        actorId: mockActor.id,
        type: 'Note',
        text: status.text,
        reply: '',
        summary: '',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${mockActor.id}/followers`],
        localRecipients: [
          'as:Public',
          'https://mastodon.in.th/users/friend',
          'https://llun.test/users/null'
        ],
        createdAt: expect.toBeNumber(),
        url: expect.toBeString()
      })
      expect(note).toMatchObject({
        type: 'Note',
        content: '<p>Hello</p>',
        attributedTo: mockActor.id,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${mockActor.id}/followers`]
      })
    })

    it.skip('set reply to replyStatus id', async () => {
      const mockActor = MockActor({ id: 'https://mastodon.in.th/users/friend' })
      const { status, note } = await createNoteFromUserInput({
        text: 'Hello',
        currentActor: mockActor,
        replyNoteId: 'https://activity.server/user/statuses/someid',
        storage
      })
      expect(mockStorage.createStatus).toHaveBeenCalledWith({
        id: note.id,
        actorId: mockActor.id,
        type: 'Note',
        text: status.text,
        reply: 'https://activity.server/user/statuses/someid',
        summary: '',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${mockActor.id}/followers`, 'https://earth.social/users/thai'],
        localRecipients: [
          'as:Public',
          'https://mastodon.in.th/users/friend',
          'https://llun.test/users/null'
        ],
        createdAt: expect.toBeNumber(),
        url: expect.toBeString()
      })
      expect(note).toMatchObject({
        type: 'Note',
        content: '<p>Hello</p>',
        attributedTo: mockActor.id,
        inReplyTo: 'https://activity.server/user/statuses/someid',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${mockActor.id}/followers`, 'https://earth.social/users/thai']
      })
    })
  })
})
