import { Note } from '@llun/activities.schema'
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getSQLDatabase } from '@/lib/database/sql'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import {
  Status,
  StatusNote,
  StatusType,
  fromNote,
  toMastodonObject
} from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { compact } from '@/lib/utils/jsonld'

enableFetchMocks()

describe('Status', () => {
  const database = getTestSQLDatabase()
  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#fromNote', () => {
    it('returns status from json', async () => {
      const note = MockMastodonActivityPubNote({
        content: 'Hello',
        inReplyTo: 'https://other.network/users/test/status/1',
        withContext: true
      })
      const compactedNote = (await compact(note)) as Note
      const status = fromNote(compactedNote)
      expect(status).toEqual({
        id: note.id,
        url: note.url,
        actorId: ACTOR1_ID,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        edits: [],
        attachments: [],
        totalLikes: 0,
        isActorLiked: false,
        isActorAnnounced: false,
        isLocalActor: false,
        tags: [],
        reply: 'https://other.network/users/test/status/1',
        replies: [],
        createdAt: expect.toBeNumber(),
        updatedAt: expect.toBeNumber()
      })
    })

    it('returns empty string for undefined reply', async () => {
      const note = MockMastodonActivityPubNote({
        content: 'Hello',
        withContext: true
      })
      const compactedNote = (await compact(note)) as Note
      const status = fromNote(compactedNote)
      expect(status).toEqual({
        id: note.id,
        url: note.url,
        actorId: ACTOR1_ID,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Hello',
        summary: '',
        to: ['as:Public'],
        cc: [],
        edits: [],
        attachments: [],
        totalLikes: 0,
        isActorLiked: false,
        isActorAnnounced: false,
        isLocalActor: false,
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
      actor1 = await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })
      actor2 = await database.getActorFromUsername({
        username: seedActor2.username,
        domain: seedActor2.domain
      })
    })

    describe('Note', () => {
      it('converts status to Note object', async () => {
        const statusId = `${actor1?.id}/statuses/post-1`
        const status = (await database.getStatus({
          statusId,
          withReplies: true
        })) as StatusNote
        const note = toMastodonObject(status)
        expect(note).toEqual({
          id: statusId,
          type: StatusType.enum.Note,
          summary: null,
          inReplyTo: null,
          published: getISOTimeUTC(status?.createdAt ?? 0),
          updated: getISOTimeUTC(status?.updatedAt ?? 0),
          url: status.url,
          attributedTo: status.actorId,
          to: status.to,
          cc: status.cc,
          content: status.text,
          attachment: [],
          tag: [],
          replies: {
            id: `${status.id}/replies`,
            type: 'Collection',
            totalItems: 1,
            items: [
              toMastodonObject(
                (await database.getStatus({
                  statusId: `${ACTOR2_ID}/statuses/post-2`
                })) as Status
              )
            ]
          }
        })
      })

      it('add mentions into Note object', async () => {
        const statusId = `${actor2?.id}/statuses/post-2`
        const status = (await database.getStatus({
          statusId
        })) as Status
        const note = toMastodonObject(status)
        expect(note.tag).toHaveLength(1)
        expect(note.tag).toContainValue({
          type: 'Mention',
          name: '@test1',
          href: 'https://llun.test/@test1'
        })
      })
    })

    describe('Announce', () => {
      it('converts status to Announce object', async () => {
        const status2Id = `${actor2?.id}/statuses/post-2`
        const status2 = (await database.getStatus({
          statusId: status2Id
        })) as Status
        const note2 = toMastodonObject(status2)

        const status3Id = `${actor2?.id}/statuses/post-3`
        const status3 = (await database.getStatus({
          statusId: status3Id
        })) as Status
        const note3 = toMastodonObject(status3)
        expect(note3).toEqual(note2)
      })
    })
  })
})
