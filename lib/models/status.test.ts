import { Note } from '../activities/entities/note'
import { compact } from '../jsonld'
import { Sqlite3Storage } from '../storage/sqlite3'
import { MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { getISOTimeUTC } from '../time'
import { Actor } from './actor'
import { Status } from './status'

describe('Status', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  describe('#fromNote', () => {
    it('returns status from json', async () => {
      const note = MockMastodonNote({
        content: 'Hello',
        inReplyTo: 'https://other.network/users/test/status/1',
        withContext: true
      })
      const compactedNote = (await compact(note)) as Note
      const status = Status.fromNote(compactedNote)
      expect(status.data).toEqual({
        id: note.id,
        url: note.url,
        actorId: 'https://llun.test/users/llun',
        type: 'Note',
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        attachments: [],
        tags: [],
        reply: 'https://other.network/users/test/status/1',
        createdAt: expect.toBeNumber(),
        updatedAt: expect.toBeNumber()
      })
    })

    it('returns empty string for undefined reply', async () => {
      const note = MockMastodonNote({
        content: 'Hello',
        withContext: true
      })
      const compactedNote = (await compact(note)) as Note
      const status = Status.fromNote(compactedNote)
      expect(status.data).toEqual({
        id: note.id,
        url: note.url,
        actorId: 'https://llun.test/users/llun',
        type: 'Note',
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        attachments: [],
        tags: [],
        reply: '',
        createdAt: expect.toBeNumber(),
        updatedAt: expect.toBeNumber()
      })
    })
  })

  describe('#toObject', () => {
    let actor1: Actor | undefined
    let actor2: Actor | undefined

    beforeAll(async () => {
      actor1 = await storage.getActorFromUsername({
        username: seedActor1.username
      })
      actor2 = await storage.getActorFromUsername({
        username: seedActor2.username
      })
    })

    it('converts status to Note object', async () => {
      const statusId = `${actor1?.id}/statuses/post-1`
      const status = await storage.getStatus({
        statusId
      })
      const note = status?.toObject()
      expect(note).toEqual({
        id: statusId,
        type: 'Note',
        summary: null,
        inReplyTo: null,
        published: getISOTimeUTC(status?.data.createdAt ?? 0),
        url: status?.data.url,
        attributedTo: status?.data.actorId,
        to: status?.data.to,
        cc: status?.data.cc,
        content: status?.data.text,
        attachment: [],
        tag: [],
        replies: {
          id: `${status?.data.id}/replies`,
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            next: `${status?.data.id}/replies?only_other_accounts=true&page=true`,
            partOf: `${status?.data.id}/replies`,
            items: []
          }
        }
      })
    })

    it('add mentions into Note object', async () => {
      const statusId = `${actor2?.id}/statuses/post-2`
      const status = await storage.getStatus({
        statusId
      })
      const note = status?.toObject()
      expect(note).toMatchObject({
        id: statusId,
        type: 'Note',
        summary: null,
        inReplyTo: `${actor1?.id}/statuses/post-1`,
        published: getISOTimeUTC(status?.data.createdAt ?? 0),
        url: status?.data.url,
        attributedTo: status?.data.actorId,
        to: status?.data.to,
        cc: status?.data.cc,
        content: status?.linkfyText(),
        attachment: [],
        tag: status?.getMentions(),
        replies: {
          id: `${status?.data.id}/replies`,
          type: 'Collection',
          first: {
            type: 'CollectionPage',
            next: `${status?.data.id}/replies?only_other_accounts=true&page=true`,
            partOf: `${status?.data.id}/replies`,
            items: []
          }
        }
      })
    })
  })
})
