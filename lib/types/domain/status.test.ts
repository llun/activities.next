import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusType,
  fromNote,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

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

  describe('fromNote', () => {
    it('returns status from json', () => {
      const note = MockMastodonActivityPubNote({
        content: 'Hello',
        inReplyTo: 'https://other.network/users/test/status/1',
        withContext: true
      })
      const status = fromNote(note)
      expect(status).toEqual({
        id: note.id,
        url: note.url,
        actorId: ACTOR1_ID,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Hello',
        summary: '',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: [],
        attachments: [],
        totalLikes: 0,
        totalShares: 0,
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        isLocalActor: false,
        tags: [],
        reply: 'https://other.network/users/test/status/1',
        replies: [],
        createdAt: expect.toBeNumber(),
        updatedAt: expect.toBeNumber()
      })
    })

    it('requires explicit bookmark state for note statuses', () => {
      const createdAt = Date.UTC(2026, 0, 1)
      const status = {
        id: `${ACTOR1_ID}/statuses/bookmark-required`,
        actorId: ACTOR1_ID,
        actor: null,
        type: StatusType.enum.Note,
        url: `${ACTOR1_ID}/statuses/bookmark-required`,
        text: 'Bookmark state is explicit',
        summary: '',
        reply: '',
        replies: [],
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: [],
        isLocalActor: true,
        actorAnnounceStatusId: null,
        isActorLiked: false,
        totalLikes: 0,
        attachments: [],
        tags: [],
        createdAt,
        updatedAt: createdAt
      }

      expect(StatusNote.safeParse(status).success).toBe(false)
    })

    it('returns empty string for undefined reply', () => {
      const note = MockMastodonActivityPubNote({
        content: 'Hello',
        withContext: true
      })
      const status = fromNote(note)
      expect(status).toEqual({
        id: note.id,
        url: note.url,
        actorId: ACTOR1_ID,
        actor: null,
        type: StatusType.enum.Note,
        text: 'Hello',
        summary: '',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: [],
        attachments: [],
        totalLikes: 0,
        totalShares: 0,
        isActorLiked: false,
        isActorBookmarked: false,
        actorAnnounceStatusId: null,
        isLocalActor: false,
        tags: [],
        reply: '',
        replies: [],
        createdAt: expect.toBeNumber(),
        updatedAt: expect.toBeNumber()
      })
    })

    it('handles inReplyTo as an object with id property', () => {
      const note = MockMastodonActivityPubNote({
        content: 'Hello',
        withContext: true
      })
      // Override inReplyTo with an object (some servers send this format)
      // Cast through unknown since the runtime code handles both string and object formats
      const noteWithObjectReply = {
        ...note,
        inReplyTo: { id: 'https://other.network/users/test/status/2' }
      } as unknown as Parameters<typeof fromNote>[0]
      const status = fromNote(noteWithObjectReply)
      expect(status.reply).toBe('https://other.network/users/test/status/2')
    })
  })

  describe('toObject', () => {
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
        const note = toActivityPubObject(status)
        expect(note).toEqual({
          id: statusId,
          type: StatusType.enum.Note,
          summary: null,
          inReplyTo: null,
          published: getISOTimeUTC(status?.createdAt ?? 0),
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
            totalItems: 2,
            items: [
              toActivityPubObject(
                (await database.getStatus({
                  statusId: `${ACTOR2_ID}/statuses/reply-1`
                })) as Status
              ),
              toActivityPubObject(
                (await database.getStatus({
                  statusId: `${ACTOR2_ID}/statuses/post-2`
                })) as Status
              )
            ]
          },
          likes: {
            id: `${status.id}/likes`,
            type: 'Collection',
            totalItems: status.totalLikes
          },
          shares: {
            id: `${status.id}/shares`,
            type: 'Collection',
            totalItems: 0
          }
        })
        expect(note).not.toHaveProperty('updated')
      })

      it('includes updated in Note objects after an edit', async () => {
        const statusId = `${actor1?.id}/statuses/edited-activitypub-object`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: actor1?.id ?? ACTOR1_ID,
          text: 'Original ActivityPub object content',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const status = (await database.updateNote({
          statusId,
          text: 'Edited ActivityPub object content',
          summary: null
        })) as StatusNote

        const note = toActivityPubObject(status)

        expect(note).toMatchObject({
          id: statusId,
          content: 'Edited ActivityPub object content',
          updated: getISOTimeUTC(status.updatedAt)
        })
      })

      it('includes database-backed share totals in Note objects', async () => {
        const statusId = `${actor1?.id}/statuses/post-1`
        const status = (await database.getStatus({
          statusId
        })) as StatusNote

        const note = toActivityPubObject({
          ...status,
          totalShares: 2
        })

        expect(note.shares).toEqual({
          id: `${status.id}/shares`,
          type: 'Collection',
          totalItems: 2
        })
      })

      it('add mentions into Note object', async () => {
        const statusId = `${actor2?.id}/statuses/post-2`
        const status = (await database.getStatus({
          statusId
        })) as Status
        const note = toActivityPubObject(status)
        expect(note.tag).toHaveLength(1)
        expect(note.tag).toContainEqual({
          type: 'Mention',
          name: '@test1',
          href: 'https://llun.test/@test1'
        })
      })

      it('does not include fitness file references in Note attachments', async () => {
        const statusId = `${actor1?.id}/statuses/post-1`
        const status = (await database.getStatus({
          statusId
        })) as StatusNote

        const createdAt = Date.now()
        const note = toActivityPubObject({
          ...status,
          attachments: [
            {
              id: 'image-attachment',
              actorId: status.actorId,
              statusId: status.id,
              type: 'Document',
              mediaType: 'image/png',
              url: 'https://example.com/files/image.png',
              width: 100,
              height: 80,
              name: 'image.png',
              createdAt,
              updatedAt: createdAt
            },
            {
              id: 'fitness-attachment',
              actorId: status.actorId,
              statusId: status.id,
              type: 'Document',
              mediaType: 'application/gpx+xml',
              url: '/api/v1/fitness-files/fitness-file-id',
              width: 0,
              height: 0,
              name: 'activity.gpx',
              createdAt,
              updatedAt: createdAt
            }
          ]
        })

        const attachments = Array.isArray(note.attachment)
          ? note.attachment
          : []

        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toEqual(
          expect.objectContaining({
            mediaType: 'image/png',
            url: 'https://example.com/files/image.png'
          })
        )
      })
    })

    describe('Announce', () => {
      it('converts status to Announce object', async () => {
        const status2Id = `${actor2?.id}/statuses/post-2`
        const status2 = (await database.getStatus({
          statusId: status2Id
        })) as Status
        const note2 = toActivityPubObject(status2)

        const status3Id = `${actor2?.id}/statuses/post-3`
        const status3 = (await database.getStatus({
          statusId: status3Id
        })) as Status
        const note3 = toActivityPubObject(status3)
        expect(note3).toEqual(note2)
      })
    })

    describe('Poll', () => {
      it('serializes single-choice poll choices as ActivityPub Question oneOf options', () => {
        const createdAt = Date.UTC(2026, 0, 1)
        const status = Status.parse({
          id: `${ACTOR1_ID}/statuses/poll-1`,
          actorId: ACTOR1_ID,
          actor: null,
          type: StatusType.enum.Poll,
          url: `${ACTOR1_ID}/statuses/poll-1`,
          text: '<p>Pick one</p>',
          summary: null,
          reply: '',
          replies: [],
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${ACTOR1_ID}/followers`],
          edits: [],
          isLocalActor: true,
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isActorBookmarked: false,
          totalLikes: 0,
          attachments: [],
          tags: [],
          choices: [
            {
              statusId: `${ACTOR1_ID}/statuses/poll-1`,
              title: 'Red',
              totalVotes: 3,
              createdAt,
              updatedAt: createdAt
            },
            {
              statusId: `${ACTOR1_ID}/statuses/poll-1`,
              title: 'Blue',
              totalVotes: 5,
              createdAt,
              updatedAt: createdAt
            }
          ],
          endAt: createdAt + 60_000,
          pollType: 'oneOf',
          createdAt,
          updatedAt: createdAt
        })

        const question = toActivityPubObject(status)

        expect(question).toMatchObject({
          id: `${ACTOR1_ID}/statuses/poll-1`,
          type: 'Question',
          oneOf: [
            {
              type: 'Note',
              name: 'Red',
              replies: { type: 'Collection', totalItems: 3 }
            },
            {
              type: 'Note',
              name: 'Blue',
              replies: { type: 'Collection', totalItems: 5 }
            }
          ],
          votersCount: 8
        })
        expect('anyOf' in question).toBe(false)
      })

      it('omits votersCount for multiple-choice polls when unique voter count is unavailable', () => {
        const createdAt = Date.UTC(2026, 0, 1)
        const status = Status.parse({
          id: `${ACTOR1_ID}/statuses/poll-2`,
          actorId: ACTOR1_ID,
          actor: null,
          type: StatusType.enum.Poll,
          url: `${ACTOR1_ID}/statuses/poll-2`,
          text: '<p>Pick any</p>',
          summary: null,
          reply: '',
          replies: [],
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${ACTOR1_ID}/followers`],
          edits: [],
          isLocalActor: true,
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isActorBookmarked: false,
          totalLikes: 0,
          attachments: [],
          tags: [],
          choices: [
            {
              statusId: `${ACTOR1_ID}/statuses/poll-2`,
              title: 'Red',
              totalVotes: 3,
              createdAt,
              updatedAt: createdAt
            },
            {
              statusId: `${ACTOR1_ID}/statuses/poll-2`,
              title: 'Blue',
              totalVotes: 5,
              createdAt,
              updatedAt: createdAt
            }
          ],
          endAt: createdAt + 60_000,
          pollType: 'anyOf',
          createdAt,
          updatedAt: createdAt
        })

        const question = toActivityPubObject(status)

        expect(question).toMatchObject({
          id: `${ACTOR1_ID}/statuses/poll-2`,
          type: 'Question',
          anyOf: [
            {
              type: 'Note',
              name: 'Red',
              replies: { type: 'Collection', totalItems: 3 }
            },
            {
              type: 'Note',
              name: 'Blue',
              replies: { type: 'Collection', totalItems: 5 }
            }
          ]
        })
        expect('oneOf' in question).toBe(false)
        expect('votersCount' in question).toBe(false)
      })
    })
  })
})
