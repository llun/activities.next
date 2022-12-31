import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { Note } from '../activities/entities/note'
import { compact } from '../jsonld'
import { ACTIVITY_STREAM_PUBLIC } from '../jsonld/activitystream'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockMastodonNote } from '../stub/note'
import { seedActor1 } from '../stub/seed/actor1'
import { seedActor2 } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { getISOTimeUTC } from '../time'
import { Actor } from './actor'
import { Status, StatusType } from './status'

enableFetchMocks()

jest.mock('../config', () => {
  const originalModule = jest.requireActual('../config')
  const { MOCK_SECRET_PHASES } = jest.requireActual('../stub/actor')
  return {
    __esModule: true,
    ...originalModule,
    getConfig: jest.fn().mockReturnValue({
      host: 'llun.test',
      database: {},
      allowEmails: [],
      secretPhase: MOCK_SECRET_PHASES,
      auth: {}
    })
  }
})

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

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
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
        type: StatusType.Note,
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        attachments: [],
        tags: [],
        reply: 'https://other.network/users/test/status/1',
        replies: [],
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
        type: StatusType.Note,
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        attachments: [],
        tags: [],
        reply: '',
        replies: [],
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

    describe('Note', () => {
      it('converts status to Note object', async () => {
        const statusId = `${actor1?.id}/statuses/post-1`
        const status = await storage.getStatus({
          statusId
        })
        const note = status?.toObject()
        expect(note).toEqual({
          id: statusId,
          type: StatusType.Note,
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
            totalItems: 1,
            items: [
              (
                await storage.getStatus({
                  statusId: 'https://llun.test/users/test2/statuses/post-2'
                })
              )?.toObject()
            ]
          }
        })
      })

      it('add mentions into Note object', async () => {
        const statusId = `${actor2?.id}/statuses/post-2`
        const status = await storage.getStatus({
          statusId
        })
        const note = status?.toObject()
        expect(note?.tag).toHaveLength(1)
        expect(note?.tag).toContainValue({
          type: 'Mention',
          name: '@test',
          href: 'https://llun.test/@test1'
        })
      })
    })

    describe('Announce', () => {
      it('converts status to Announce object', async () => {
        const statusId = `${actor2?.id}/statuses/post-3`
        const status = await storage.getStatus({
          statusId
        })
        const note = status?.toObject()
        expect(note).toEqual({
          id: statusId,
          type: StatusType.Announce,
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
            totalItems: 0,
            items: []
          }
        })
      })
    })
  })

  describe('#getMentions', () => {
    it('returns empty array for text with no mentions', async () => {
      expect(await Status.getMentions('Text without mentions')).toEqual([])
    })

    it('returns Mentions from text', async () => {
      const mentions = await Status.getMentions(
        '@llun@somewhere.test @test1@llun.test Test mentions'
      )
      expect(mentions).toHaveLength(2)
      expect(mentions[0]).toEqual({
        type: 'Mention',
        href: `https://somewhere.test/actors/llun`,
        name: '@llun@somewhere.test'
      })
      expect(mentions[1]).toEqual({
        type: 'Mention',
        href: `https://llun.test/users/test1`,
        name: '@test1@llun.test'
      })
    })
  })

  describe('#paragraphText', () => {
    it('returns single paragraph for single line text', () => {
      expect(Status.paragraphText('This is single line text')).toEqual(
        `
<p>This is single line text</p>
`.trim()
      )
    })

    it('returns two paragraph for two line text', () => {
      expect(
        Status.paragraphText(
          `
This is first line text
This is second line text
`.trim()
        )
      ).toEqual(
        `
<p>This is first line text<br />This is second line text</p>
`.trim()
      )
    })

    it('adds br when text has empty line in between', () => {
      expect(
        Status.paragraphText(
          `
This is first line text

This is second line text
`.trim()
        )
      ).toEqual(
        `
<p>This is first line text</p>
<p>This is second line text</p>
`.trim()
      )
    })

    it('adds br when text has multple empty line in between', () => {
      expect(
        Status.paragraphText(
          `
This is first line text


This is second line text
This is third line text
`.trim()
        )
      ).toEqual(
        `
<p>This is first line text</p>
<br />
<p>This is second line text<br />This is third line text</p>
`.trim()
      )
    })

    it('adds multiple br when text has multple empty line in between', () => {
      expect(
        Status.paragraphText(
          `
This is first line text



This is second line text
This is third line text
`.trim()
        )
      ).toEqual(
        `
<p>This is first line text</p>
<br />
<br />
<p>This is second line text<br />This is third line text</p>
`.trim()
      )
    })

    it('adds multiple br when text has multple empty line in between', () => {
      expect(
        Status.paragraphText(
          `
This is first line text


This is second line text
This is third line text

This is fourth line text
`.trim()
        )
      ).toEqual(
        `
<p>This is first line text</p>
<br />
<p>This is second line text<br />This is third line text</p>
<p>This is fourth line text</p>
`.trim()
      )
    })
  })
})
